import { CommandFailure } from "@/engine/cli/command-failure";
import {
  type CommandContext,
  CommandOutput,
  type CommandResult,
  type CommandSpec,
  Flag,
  type FlagSpec,
  ParsedArgs,
  type PositionalSpec,
  type TargetContext,
} from "@/engine/cli/command-spec";
import { targetCommand } from "@/engine/commands/shared";
import { validScope } from "@/engine/domains/admin-lab/model";
import type { ApiName } from "@/engine/domains/catalog";
import { EffectivePermissions } from "@/engine/domains/effective-permissions";
import { Principal } from "@/engine/domains/principal";
import type { PolicyTarget } from "@/engine/domains/resource-hierarchy";
import { World } from "@/engine/domains/world";
import type { JsonRecord } from "@/types/Json";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

export const invalid = (s: string) => Result.err(CommandFailure.invalidArgumentWith(s));
export const missing = (s: string) => Result.err(CommandFailure.notFoundWith(s));
export const text = (a: ParsedArgs, key: string, fallback = "") =>
  Option.unwrapOr(ParsedArgs.string(a, key), fallback);
export const sf = (key: string, required = false): FlagSpec =>
  Flag.string(key, `${key}.`, {
    required,
    singleUse: true,
    candidates: (world) => {
      if (key === "group-email") {
        return world.adminLab.groups.map((g) => g.email);
      }
      if (key === "member-email") {
        return world.adminLab.users.filter((u) => u.active).map((u) => u.email);
      }
      if (key === "customer") {
        return ["C01simulator"];
      }
      if (key === "service-account") {
        return world.serviceAccounts.map((s) => s.email);
      }
      if (["pool", "workload-identity-pool", "workforce-pool"].includes(key)) {
        return world.adminLab.pools.map((p) => p.name);
      }
      if (key === "provider") {
        return world.adminLab.providers.map((p) => p.name);
      }
      if (key === "token") {
        return world.adminLab.credentials.map((c) => c.id);
      }
      return [];
    },
  });
export const finish = (world: World, record: JsonRecord): CommandResult =>
  Result.ok({ world, output: CommandOutput.yaml(record) });
export const records = (world: World, values: readonly JsonRecord[]): CommandResult =>
  Result.ok({ world, output: CommandOutput.yamlList(values) });
export const ScopeFlags = [sf("organization"), sf("folder")];
export const scopeArgument = (
  ctx: CommandContext,
  a: ParsedArgs,
  defaultProject = false,
): Result<string, CommandFailure> => {
  const choices = ["organization", "folder", "project"].filter((k) => ParsedArgs.has(a, k));
  if (choices.length === 0 && defaultProject && ctx.projectId.some) {
    return Result.ok(`projects/${ctx.projectId.value}`);
  }
  if (choices.length !== 1) {
    return invalid("Specify exactly one of --organization, --folder or --project.");
  }
  const prefixes: Readonly<Record<string, string>> = {
    organization: "organizations",
    folder: "folders",
    project: "projects",
  };
  const choice = choices[0] ?? "";
  const scope = `${prefixes[choice]}/${text(a, choice)}`;
  return validScope(ctx.world, scope)
    ? Result.ok(scope)
    : missing(`Scope ${scope} does not exist.`);
};
export const scopeTarget = (scope: string): PolicyTarget => {
  const [kind, id = ""] = scope.split("/");
  if (kind === "organizations") {
    return { type: "organization", id };
  }
  if (kind === "folders") {
    return { type: "folder", id };
  }
  return { type: "project", id };
};
export const apiCheck = (ctx: CommandContext, api: ApiName) => {
  if (!ctx.projectId.some) {
    return invalid("Choose a project for the API consumer before this operation.");
  }
  if (!World.findActiveProject(ctx.world, ctx.projectId.value).some) {
    return missing("Choose an active project for the API consumer.");
  }
  if (!World.hasApi(ctx.world, ctx.projectId.value, api)) {
    return Result.err(CommandFailure.apiDisabled(api, api, ctx.projectId.value));
  }
  return Result.ok(ctx.projectId.value);
};
export const permitTarget = (ctx: TargetContext, permission: string) =>
  Result.mapErr(
    EffectivePermissions.require(
      EffectivePermissions.resolve(ctx.world, Principal.toMember(ctx.principal), ctx.target),
      [permission],
    ),
    CommandFailure.permissionDenied,
  );
export const scoped = (
  input: Readonly<{
    path: readonly string[];
    permission: string | readonly string[];
    api: ApiName;
    scope: (ctx: CommandContext, a: ParsedArgs) => Result<string, CommandFailure>;
    run: (ctx: TargetContext, a: ParsedArgs, scope: string) => CommandResult;
    flags?: readonly FlagSpec[];
    positionals?: readonly PositionalSpec[];
    destructive?: boolean;
  }>,
): CommandSpec =>
  targetCommand({
    path: input.path,
    summary: "Configure bounded administration resources in the simulator.",
    permissions: typeof input.permission === "string" ? [input.permission] : input.permission,
    resolveTarget: (ctx, a) => Result.map(input.scope(ctx, a), scopeTarget),
    flags: [
      ...(input.flags ?? []),
      ...(input.path[0] === "sim"
        ? [sf("project"), sf("account"), Flag.boolean("quiet", "Skip confirmation.")]
        : []),
    ],
    positionals: input.positionals ?? [],
    destructive: input.destructive ?? false,
    run: (ctx, a) =>
      Result.flatMap(apiCheck(ctx, input.api), () =>
        Result.flatMap(input.scope(ctx, a), (scope) => input.run(ctx, a, scope)),
      ),
  });
export const readJson = (ctx: CommandContext, name: string): Result<unknown, CommandFailure> => {
  const content = ctx.world.kubeFiles[name] ?? ctx.world.terraform.files[name];
  if (content === undefined) {
    return missing(`Virtual file ${name} not found. Use sim files write FILE --content='JSON'.`);
  }
  try {
    return Result.ok(JSON.parse(content));
  } catch {
    return invalid("This lesson accepts JSON configuration only; YAML is unsupported.");
  }
};
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
