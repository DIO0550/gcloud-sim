import { CommandFailure } from "@/engine/cli/command-failure";
import {
  type CandidateSource,
  CommandContext,
  CommandOutput,
  type CommandResult,
  Flag,
  ParsedArgs,
  type ProjectContext,
} from "@/engine/cli/command-spec";
import { CommonFlags } from "@/engine/commands/shared";
import { Region } from "@/engine/domains/catalog";
import { EffectivePermissions } from "@/engine/domains/effective-permissions";
import { LbScope } from "@/engine/domains/load-balancing";
import { type LbResource, lbBackend, lbFind, lbLink } from "@/engine/domains/load-balancing/graph";
import { validateLbGraph } from "@/engine/domains/load-balancing/validation";
import { Principal } from "@/engine/domains/principal";
import type { World } from "@/engine/domains/world";
import type { JsonRecord } from "@/types/Json";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

export const ScopeFlags = [Flag.boolean("global", "Global resource."), CommonFlags.region];
export const invalid = (message: string): CommandResult =>
  Result.err(CommandFailure.invalidArgumentWith(message));
export const value = (args: ParsedArgs, flag: string, fallback: string): string =>
  Option.unwrapOr(ParsedArgs.string(args, flag), fallback);
export const integer = (args: ParsedArgs, flag: string, fallback: number): number =>
  Option.unwrapOr(ParsedArgs.integer(args, flag), fallback);
export const finish = (world: World, record: JsonRecord): CommandResult => {
  const error = validateLbGraph(world);
  if (error !== undefined) {
    return Result.err(CommandFailure.invalidState(error));
  }
  return Result.ok({ world, output: CommandOutput.yaml(record) });
};
export const resolveScope = (
  ctx: ProjectContext,
  args: ParsedArgs,
  globalDefault = false,
): Result<LbScope, CommandFailure> => {
  if (ParsedArgs.boolean(args, "global") && Option.isSome(ParsedArgs.string(args, "region"))) {
    return Result.err(CommandFailure.invalidArgumentWith("Choose --global or --region, not both."));
  }
  if (
    ParsedArgs.boolean(args, "global") ||
    (globalDefault && !Option.isSome(ParsedArgs.string(args, "region")))
  ) {
    return Result.ok(LbScope.Global);
  }
  return Result.map(
    CommandContext.resolveRegion(ctx, ParsedArgs.string(args, "region")),
    LbScope.region,
  );
};
export const requireLb = (
  ctx: ProjectContext,
  permissions: readonly string[],
): Result<unknown, CommandFailure> =>
  Result.mapErr(
    EffectivePermissions.require(
      EffectivePermissions.resolve(ctx.world, Principal.toMember(ctx.principal), {
        type: "project",
        id: ctx.project.projectId,
      }),
      permissions,
    ),
    CommandFailure.permissionDenied,
  );
export const refFor = (
  ctx: ProjectContext,
  location: string,
  kind: string,
  name: string,
): string => {
  if (name.includes("/")) {
    return name.startsWith("https://www.googleapis.com/compute/v1/")
      ? name
      : `https://www.googleapis.com/compute/v1/${name}`;
  }
  return `https://www.googleapis.com/compute/v1/projects/${ctx.project.projectId}/${location}/${kind}/${name}`;
};
export const resourceArg = (
  ctx: ProjectContext,
  args: ParsedArgs,
  kind: LbResource["kind"],
): Result<LbResource, CommandFailure> => {
  if (kind === "networkEndpointGroups") {
    return Result.flatMap(
      CommandContext.resolveZone(ctx, ParsedArgs.string(args, "zone")),
      (zone) => findResource(ctx, `zones/${zone}`, kind, ParsedArgs.requiredPositional(args, 0)),
    );
  }
  return Result.flatMap(resolveScope(ctx, args, true), (scope) =>
    findResource(ctx, LbScope.toPath(scope), kind, ParsedArgs.requiredPositional(args, 0)),
  );
};
export const findResource = (
  ctx: ProjectContext,
  location: string,
  kind: LbResource["kind"],
  name: string,
): Result<LbResource, CommandFailure> => {
  const ref = refFor(ctx, location, kind, name);
  const resource = lbFind(ctx.world, ref);
  if (
    resource === undefined ||
    resource.projectId !== ctx.project.projectId ||
    resource.kind !== kind ||
    resource.location !== location
  ) {
    return Result.err(CommandFailure.notFound(ref));
  }
  return Result.ok(resource);
};
export const resolveBackendTarget = (
  ctx: ProjectContext,
  location: string,
  name: string,
  bucket = false,
): Result<string, CommandFailure> => {
  const ref = refFor(ctx, location, bucket ? "backendBuckets" : "backendServices", name);
  const backend = lbBackend(ctx.world, ref);
  const resource = lbFind(ctx.world, ref);
  const valid = bucket
    ? resource?.kind === "backendBuckets" && resource.location === location
    : backend !== undefined && LbScope.toPath(backend.scope) === location;
  if (
    !valid ||
    !ref.startsWith(`https://www.googleapis.com/compute/v1/projects/${ctx.project.projectId}/`)
  ) {
    return Result.err(CommandFailure.notFound(ref));
  }
  let permission = `compute.${location === "global" ? "backendServices" : "regionBackendServices"}.use`;
  if (bucket) {
    permission = "compute.backendBuckets.use";
  }
  return Result.map(requireLb(ctx, [permission]), () => ref);
};
export const replaceResource = (world: World, next: LbResource): World => ({
  ...world,
  lbResources: world.lbResources.map((r) => (lbLink(r) === lbLink(next) ? next : r)),
});

export const corePermission = (
  kind: "backendServices" | "forwardingRules" | "addresses",
  scope: LbScope,
  verb: string,
): string => {
  if (kind === "backendServices") {
    return `compute.${scope.kind === "global" ? "backendServices" : "regionBackendServices"}.${verb}`;
  }
  return `compute.${scope.kind === "global" ? `global${kind[0]?.toUpperCase()}${kind.slice(1)}` : kind}.${verb}`;
};
/** Resource scope determines IAM permission; all checks happen before the command mutates World. */
export const scopePermission =
  (
    kind: "backendServices" | "forwardingRules" | "addresses",
    verb: string,
    run: (ctx: ProjectContext, args: ParsedArgs) => CommandResult,
  ) =>
  (ctx: ProjectContext, args: ParsedArgs): CommandResult =>
    Result.flatMap(resolveScope(ctx, args), (scope) =>
      Result.flatMap(requireLb(ctx, [corePermission(kind, scope, verb)]), () => run(ctx, args)),
    );

export const resourceCandidates =
  (kind: LbResource["kind"]): CandidateSource =>
  (world, projectId) =>
    Option.isSome(projectId)
      ? world.lbResources
          .filter((r) => r.projectId === projectId.value && r.kind === kind)
          .map((r) => r.name)
      : [];
export const ListScopeFlags = [
  Flag.boolean("global", "List global resources."),
  Flag.list("regions", "List resources in these regions."),
];
export const listScopeAccess = (
  ctx: ProjectContext,
  args: ParsedArgs,
  globalPermission: string,
  regionalPermission?: string,
): Result<(location: string) => boolean, CommandFailure> => {
  const regions = ParsedArgs.list(args, "regions");
  if (
    regions.some((r) => !Option.isSome(Region.parse(r))) ||
    (regionalPermission === undefined && regions.length > 0)
  ) {
    return Result.err(CommandFailure.invalidArgumentWith("Invalid/unsupported list region."));
  }
  const global = ParsedArgs.boolean(args, "global");
  const all = !global && regions.length === 0;
  const permissions: string[] = [];
  if (all || global) {
    permissions.push(globalPermission);
  }
  if ((all || regions.length > 0) && regionalPermission !== undefined) {
    permissions.push(regionalPermission);
  }
  return Result.map(
    requireLb(ctx, permissions),
    () => (location) =>
      all || (global && location === "global") || regions.some((r) => location === `regions/${r}`),
  );
};
