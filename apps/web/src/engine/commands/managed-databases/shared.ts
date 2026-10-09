import { CommandFailure } from "@/engine/cli/command-failure";
import {
  type CandidateSource,
  CommandOutput,
  type CommandResult,
  type CommandSpec,
  Flag,
  type FlagSpec,
  ParsedArgs,
  Positional,
  type ProjectContext,
} from "@/engine/cli/command-spec";
import { Candidates, projectCommand } from "@/engine/commands/shared";
import type { ApiName } from "@/engine/domains/catalog";
import { ResourceName } from "@/engine/domains/compute";
import {
  type Observation,
  observe,
  validateManagedDatabases,
} from "@/engine/domains/managed-databases/model";
import { allows } from "@/engine/domains/serverless-lab/runtime";
import type { World } from "@/engine/domains/world";
import type { JsonRecord } from "@/types/Json";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

export const invalid = (message: string) => Result.err(CommandFailure.invalidArgumentWith(message));
export const missing = (message: string) => Result.err(CommandFailure.notFoundWith(message));
export const text = (args: ParsedArgs, flag: string, fallback = ""): string =>
  Option.unwrapOr(ParsedArgs.string(args, flag), fallback);
export const integer = (args: ParsedArgs, flag: string, fallback: number): number =>
  Option.unwrapOr(ParsedArgs.integer(args, flag), fallback);
export const name = (args: ParsedArgs): string => ParsedArgs.requiredPositional(args, 0);
export const sf = (key: string, required = false, candidates?: CandidateSource): FlagSpec =>
  Flag.string(key, `${key} for this lesson.`, { required, candidates });
export const regionFlag = sf("region", false, Candidates.regions);
export const source =
  (
    key:
      | "spannerInstances"
      | "spannerDatabases"
      | "spannerCopies"
      | "bigtableInstances"
      | "bigtableCopies"
      | "indexes"
      | "firestoreCopies",
  ): CandidateSource =>
  (w, p) => {
    if (!p.some) {
      return [];
    }
    return w.managedDatabases[key].filter((r) => r.projectId === p.value).map((r) => r.name);
  };
export const validName = (value: string): boolean => ResourceName.parse(value).ok;
export const permit = (ctx: ProjectContext, permission: string) => {
  if (!allows(ctx.world, ctx.project.projectId, ctx.principal, permission)) {
    return Result.err(CommandFailure.invalidArgumentWith(`Permission ${permission} is required.`));
  }
  return Result.ok(true);
};
export const finish = (world: World, record: JsonRecord): CommandResult =>
  Result.ok({ world, output: CommandOutput.yaml(record) });
export const observed = (
  world: World,
  ctx: ProjectContext,
  service: Observation["service"],
  resource: string,
  operation: string,
  record: JsonRecord,
): CommandResult =>
  finish(
    observe(world, {
      projectId: ctx.project.projectId,
      service,
      resource,
      operation,
      result: JSON.stringify(record),
    }),
    record,
  );
export const command = (
  path: readonly string[],
  api: ApiName,
  permission: string,
  run: (ctx: ProjectContext, args: ParsedArgs) => CommandResult,
  flags: readonly FlagSpec[] = [],
  positional = true,
  candidates?: CandidateSource,
  destructive = false,
): CommandSpec =>
  projectCommand({
    path,
    summary: `${path.join(" ")}: deterministic database lesson; no external SDK execution.`,
    flags: [
      ...flags,
      ...(path[0] === "sim"
        ? [sf("project", false, Candidates.projects), sf("account", false, Candidates.accounts)]
        : []),
      ...(destructive && path[0] === "sim" ? [Flag.boolean("quiet", "Skip confirmation.")] : []),
    ],
    positionals: positional
      ? [Positional.required("NAME", "Resource name or key.", candidates)]
      : [],
    permission,
    requiredApis: [api],
    destructive,
    run: (ctx, args) =>
      Result.flatMap(run(ctx, args), (value) =>
        Result.map(
          Result.mapErr(validateManagedDatabases(value.world), CommandFailure.invalidState),
          () => value,
        ),
      ),
  });
