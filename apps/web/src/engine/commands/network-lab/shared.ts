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
import { invalid } from "@/engine/commands/compute-lab/shared";
import { Candidates, projectCommand } from "@/engine/commands/shared";
import type { ApiName } from "@/engine/domains/catalog";
import {
  type NetworkLab,
  patchNetwork,
  same,
  validateNetworkLab,
} from "@/engine/domains/network-lab/model";
import type { World } from "@/engine/domains/world";
import type { JsonRecord } from "@/types/Json";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

export {
  integer,
  invalid,
  missing,
  name,
  rf,
  sf,
  text,
  zf,
} from "@/engine/commands/compute-lab/shared";
export const finish = (world: World, record: JsonRecord): CommandResult =>
  Result.map(Result.mapErr(validateNetworkLab(world), CommandFailure.invalidState), (world) => ({
    world,
    output: CommandOutput.yaml(record),
  }));
export const list = (world: World, records: readonly JsonRecord[]): CommandResult =>
  Result.ok({
    world,
    output: CommandOutput.table(records, [
      Column.create("NAME", "name"),
      Column.create("REGION", "region"),
      Column.create("STATE", "state"),
    ]),
  });
export const ref = (c: ProjectContext, a: ParsedArgs, regional = false) =>
  Result.map(
    regional
      ? CommandContext.resolveRegion(c, ParsedArgs.string(a, "region"))
      : Result.ok("global"),
    (region) => ({
      projectId: c.project.projectId,
      name: ParsedArgs.requiredPositional(a, 0),
      region,
    }),
  );
type Collection = Exclude<keyof NetworkLab, "shared" | "checks" | "logs">;
const candidates =
  (collection: Collection): CandidateSource =>
  (w, p) =>
    p.some
      ? w.networkLab[collection].filter((r) => r.projectId === p.value).map((r) => r.name)
      : [];
const nameCandidates = (path: readonly string[], collection?: Collection): CandidateSource => {
  if (collection) {
    return candidates(collection);
  }
  if (path.includes("shared-vpc")) {
    return Candidates.projects;
  }
  if (path.includes("connectivity") || path.includes("secure-tags")) {
    return Candidates.instances;
  }
  return Candidates.networks;
};
export const command = (
  path: readonly string[],
  permission: string,
  run: (c: ProjectContext, a: ParsedArgs) => CommandResult,
  flags: readonly FlagSpec[] = [],
  positional = true,
  api: ApiName = "compute.googleapis.com",
  destructive = false,
  collection?: Collection,
): CommandSpec =>
  projectCommand({
    path,
    summary: `${path.join(" ")}: bounded network configuration or diagnosis; no traffic is sent.`,
    positionals: positional
      ? [Positional.required("NAME", "Resource name.", nameCandidates(path, collection))]
      : [],
    flags: [
      ...flags,
      ...(path[0] === "sim"
        ? [Flag.string("project", "Project."), Flag.string("account", "Principal.")]
        : []),
      ...(destructive && path[0] === "sim" ? [Flag.boolean("quiet", "Skip confirmation.")] : []),
    ],
    permission,
    requiredApis: [api],
    destructive,
    run,
  });
export const lifecycle = (
  group: readonly string[],
  collection: Collection,
  permission: string,
  regional = false,
  extraFlags: readonly FlagSpec[] = [],
): readonly CommandSpec[] => [
  command(
    [...group, "list"],
    `${permission}.list`,
    (c, a) =>
      list(
        c.world,
        c.world.networkLab[collection].filter(
          (r) =>
            r.projectId === c.project.projectId &&
            (!ParsedArgs.has(a, "region") ||
              r.region === Option.unwrapOr(ParsedArgs.string(a, "region"), "")),
        ) as readonly JsonRecord[],
      ),
    regional ? [Flag.string("region", "Region.")] : [],
    false,
    "compute.googleapis.com",
    false,
    collection,
  ),
  command(
    [...group, "describe"],
    `${permission}.get`,
    (c, a) =>
      Result.flatMap(ref(c, a, regional), (r) => {
        const found = c.world.networkLab[collection].find((v) => same(v, r));
        return found
          ? finish(c.world, found as JsonRecord)
          : Result.err(CommandFailure.notFoundWith("Network resource not found in this scope."));
      }),
    [...(regional ? [Flag.string("region", "Region.")] : []), ...extraFlags],
    true,
    "compute.googleapis.com",
    false,
    collection,
  ),
  command(
    [...group, "delete"],
    `${permission}.delete`,
    (c, a) =>
      Result.flatMap(ref(c, a, regional), (r) => {
        const found = c.world.networkLab[collection].find((v) => same(v, r));
        if (!found) {
          return Result.err(
            CommandFailure.notFoundWith("Network resource not found in this scope."),
          );
        }
        if (collection === "policies" && "network" in found && found.network) {
          return invalid("Delete the VPC association before deleting a firewall policy.");
        }
        return finish(
          patchNetwork(c.world, {
            [collection]: c.world.networkLab[collection].filter((v) => v !== found),
          }),
          { deleted: r.name },
        );
      }),
    [...(regional ? [Flag.string("region", "Region.")] : []), ...extraFlags],
    true,
    "compute.googleapis.com",
    true,
    collection,
  ),
];
