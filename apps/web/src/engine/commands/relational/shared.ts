import { CommandFailure } from "@/engine/cli/command-failure";
import {
  type CandidateSource,
  CommandContext,
  CommandOutput,
  type CommandResult,
  type CommandSpec,
  Flag,
  ParsedArgs,
  Positional,
  type ProjectContext,
} from "@/engine/cli/command-spec";
import { Candidates, projectCommand } from "@/engine/commands/shared";
import type { ApiName } from "@/engine/domains/catalog";
import { ResourceName } from "@/engine/domains/compute";
import {
  databasesOf,
  findServer,
  type Kind,
  type Server,
  type User,
  validateRelational,
} from "@/engine/domains/relational/model";
import { allows } from "@/engine/domains/serverless-lab/runtime";
import type { World } from "@/engine/domains/world";
import type { JsonRecord } from "@/types/Json";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";
export const invalid = (message: string) => Result.err(CommandFailure.invalidArgumentWith(message));
export const missing = (message: string) => Result.err(CommandFailure.notFoundWith(message));
export const finish = (world: World, record: JsonRecord): CommandResult =>
  Result.ok({ world, output: CommandOutput.yaml(record) });
export const textFlag = (args: ParsedArgs, flag: string, fallback = ""): string =>
  Option.unwrapOr(ParsedArgs.string(args, flag), fallback);
export const intFlag = (args: ParsedArgs, flag: string, fallback: number): number =>
  Option.unwrapOr(ParsedArgs.integer(args, flag), fallback);
export const candidates =
  (
    key:
      | "servers"
      | "profiles"
      | "migrations"
      | "alloyInstances"
      | "users"
      | "databases"
      | "copies",
    kind?: Kind,
  ): CandidateSource =>
  (world, project) => {
    if (!project.some) {
      return [];
    }
    return world.relational[key]
      .filter((r) => r.projectId === project.value && (!kind || !("kind" in r) || r.kind === kind))
      .map((r) => r.name);
  };
const resourceCandidates = (path: readonly string[]): CandidateSource => {
  if (path.includes("connection-profiles")) {
    return candidates("profiles");
  }
  if (path.includes("migration-jobs") || path.includes("dms")) {
    return candidates("migrations");
  }
  const kind: Kind = path.includes("alloydb") ? "alloy" : "sql";
  if (path.includes("users")) {
    return candidates("users", kind);
  }
  if (path.includes("databases") && !path.includes("choose")) {
    return candidates("databases", kind);
  }
  if (path.includes("backups")) {
    return candidates("copies", kind);
  }
  if (path.includes("instances") && kind === "alloy") {
    return candidates("alloyInstances");
  }
  if (path.includes("choose")) {
    return () => [
      "existing-mysql",
      "global-transactions",
      "warehouse",
      "mobile-documents",
      "telemetry",
      "session-cache",
    ];
  }
  return candidates("servers", kind);
};
export const regionFlag = Flag.string("region", "Resource region.", {
  candidates: Candidates.regions,
});
export const instanceFlag = Flag.string("instance", "Cloud SQL instance.", {
  required: true,
  candidates: candidates("servers", "sql"),
  aliases: ["-i"],
});
export const clusterFlag = Flag.string("cluster", "AlloyDB cluster.", {
  required: true,
  candidates: candidates("servers", "alloy"),
});
export const nameArg = (name = "NAME", source?: CandidateSource) =>
  Positional.required(name, "Resource name.", source);
export const regionArg = (ctx: ProjectContext, args: ParsedArgs) =>
  CommandContext.resolveRegion(ctx, ParsedArgs.string(args, "region"));
export const permission = (ctx: ProjectContext, p: string): Result<true, CommandFailure> =>
  allows(ctx.world, ctx.project.projectId, ctx.principal, p)
    ? Result.ok(true)
    : invalid(`Permission ${p} is required.`);
export const validName = (name: string): Result<string, CommandFailure> =>
  Result.mapErr(ResourceName.parse(name), (m) => CommandFailure.invalidArgumentWith(m));
export const serverArg = (
  ctx: ProjectContext,
  name: string,
  kind: Kind = "sql",
  args?: ParsedArgs,
): Result<Server, CommandFailure> => {
  const server = findServer(ctx.world, { projectId: ctx.project.projectId, kind, name });
  if (!server) {
    return missing(
      kind === "sql" ? "The Cloud SQL instance does not exist." : "AlloyDB cluster does not exist.",
    );
  }
  if (args?.flags.region || kind === "alloy") {
    if (!args) {
      return invalid("Region is required.");
    }
    const region = regionArg(ctx, args);
    if (!region.ok) {
      return region;
    }
    if (region.value !== server.region) {
      return missing("Database resource does not exist in the requested region.");
    }
  }
  return Result.ok(server);
};
export const userOf = (world: World, server: Server, user: string): User | undefined =>
  world.relational.users.find(
    (u) =>
      u.projectId === server.projectId &&
      u.kind === server.kind &&
      u.server === server.name &&
      u.name === user,
  );
export const recordServer = (world: World, s: Server): JsonRecord => ({
  ...s,
  databases: databasesOf(world, s).map((d) => ({
    name: d.name,
    vector: d.vector,
    tables: d.tables,
  })),
  users: world.relational.users.filter(
    (u) => u.projectId === s.projectId && u.kind === s.kind && u.server === s.name,
  ),
  copies: world.relational.copies
    .filter((c) => c.projectId === s.projectId && c.kind === s.kind && c.source === s.name)
    .map((c) => ({ name: c.name, type: c.type, timestamp: c.timestamp })),
});
export const command = (
  path: readonly string[],
  api: ApiName,
  p: string,
  run: (ctx: ProjectContext, args: ParsedArgs) => CommandResult,
  flags: readonly ReturnType<typeof Flag.string>[] = [],
  positionals = [nameArg("NAME", resourceCandidates(path))],
  destructive = false,
): CommandSpec =>
  projectCommand({
    path,
    summary: `${path.join(" ")} (deterministic database lesson).`,
    positionals,
    flags,
    permission: p,
    requiredApis: [api],
    run: (ctx, args) =>
      Result.flatMap(run(ctx, args), (value) =>
        Result.map(
          Result.mapErr(validateRelational(value.world), (m) => CommandFailure.invalidState(m)),
          () => value,
        ),
      ),
    destructive,
  });
