import { CommandFailure } from "@/engine/cli/command-failure";
import {
  type CandidateSource,
  Column,
  CommandContext,
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
import { observeCompute, type Ref, validateComputeLab } from "@/engine/domains/compute-lab/model";
import type { World } from "@/engine/domains/world";
import type { JsonRecord } from "@/types/Json";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

export const invalid = (s: string) => Result.err(CommandFailure.invalidArgumentWith(s));
export const missing = (s: string) => Result.err(CommandFailure.notFoundWith(s));
export const text = (a: ParsedArgs, k: string, d = "") =>
  Option.unwrapOr(ParsedArgs.string(a, k), d);
export const integer = (a: ParsedArgs, k: string, d: number) =>
  Option.unwrapOr(ParsedArgs.integer(a, k), d);
export const name = (a: ParsedArgs) => ParsedArgs.requiredPositional(a, 0);
export const sf = (k: string, required = false): FlagSpec =>
  Flag.string(k, `${k} for this bounded lesson.`, { required });
export const zf = Flag.string("zone", "Zone (or configured compute/zone).", {
  candidates: Candidates.zones,
});
export const rf = Flag.string("region", "Region; cannot be combined with --zone.", {
  candidates: Candidates.regions,
});
export const finish = (world: World, record: JsonRecord): CommandResult =>
  Result.map(Result.mapErr(validateComputeLab(world), CommandFailure.invalidState), (world) => ({
    world,
    output: CommandOutput.yaml(record),
  }));
export const list = (world: World, records: readonly JsonRecord[]): CommandResult =>
  Result.ok({
    world,
    output: CommandOutput.table(records, [
      Column.create("NAME", "name"),
      Column.create("LOCATION", "location"),
      Column.create("STATE", "state"),
    ]),
  });
export const observed = (w: World, r: Ref, op: string, record: JsonRecord): CommandResult =>
  finish(observeCompute(w, r, op, JSON.stringify(record)), record);
export const location = (ctx: ProjectContext, a: ParsedArgs) => {
  if (ParsedArgs.has(a, "zone") && ParsedArgs.has(a, "region")) {
    return invalid("Choose exactly one of --zone and --region.");
  }
  if (ParsedArgs.has(a, "region")) {
    return CommandContext.resolveRegion(ctx, ParsedArgs.string(a, "region"));
  }
  return CommandContext.resolveZone(ctx, ParsedArgs.string(a, "zone"));
};
export const ref = (ctx: ProjectContext, a: ParsedArgs) =>
  Result.map(location(ctx, a), (location) => ({
    projectId: ctx.project.projectId,
    name: name(a),
    location,
  }));
const resourceCandidates =
  (path: readonly string[]): CandidateSource =>
  (w, project) => {
    if (!project.some) {
      return [];
    }
    const p = project.value;
    const group = path.join(" ");
    if (group.includes("tpus tpu-vm")) {
      return w.computeLab.tpus.filter((r) => r.projectId === p).map((r) => r.name);
    }
    if (group.includes("os-policy-assignments")) {
      return w.computeLab.osPolicies.filter((r) => r.projectId === p).map((r) => r.name);
    }
    if (group.includes("resource-policies") || group.includes("snapshot-schedules")) {
      return w.computeLab.schedules.filter((r) => r.projectId === p).map((r) => r.name);
    }
    if (group.includes("images")) {
      return w.computeLab.images.filter((r) => r.projectId === p).map((r) => r.name);
    }
    if (group.includes("disks")) {
      return [...w.disks, ...w.computeLab.disks]
        .filter((r) => r.projectId === p)
        .map((r) => r.name);
    }
    if (group.includes("instance-groups")) {
      return w.instanceGroups.filter((r) => r.projectId === p).map((r) => r.name);
    }
    return w.instances.filter((r) => r.projectId === p).map((r) => r.name);
  };
export const command = (
  path: readonly string[],
  permission: string | readonly string[],
  run: (c: ProjectContext, a: ParsedArgs) => CommandResult,
  flags: readonly FlagSpec[] = [],
  positional = true,
  api: ApiName = "compute.googleapis.com",
  destructive = false,
): CommandSpec =>
  projectCommand({
    path,
    summary: `${path.join(" ")}: bounded Compute lesson; no cloud execution.`,
    flags: [
      ...flags,
      ...(path[0] === "sim" ? [sf("project"), sf("account")] : []),
      ...(destructive && path[0] === "sim" ? [Flag.boolean("quiet", "Skip confirmation.")] : []),
    ],
    positionals: positional
      ? [Positional.required("NAME", "Resource name.", resourceCandidates(path))]
      : [],
    ...(typeof permission === "string" ? { permission } : { permissions: permission }),
    requiredApis: [api],
    destructive,
    run: (c, a) =>
      Result.flatMap(run(c, a), (result) =>
        Result.map(
          Result.mapErr(validateComputeLab(result.world), CommandFailure.invalidState),
          () => result,
        ),
      ),
  });
