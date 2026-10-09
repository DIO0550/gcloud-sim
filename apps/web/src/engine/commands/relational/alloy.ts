import {
  type CommandResult,
  Flag,
  ParsedArgs,
  type ProjectContext,
} from "@/engine/cli/command-spec";
import {
  type AlloyInstance,
  databasesOf,
  defaultServer,
  defaultUser,
  findServer,
  putServer,
  recordRecovery,
  replaceData,
} from "@/engine/domains/relational/model";
import { Result } from "@/utils/Result";
import {
  candidates,
  clusterFlag,
  command,
  finish,
  intFlag,
  invalid,
  missing,
  nameArg,
  permission,
  recordServer,
  regionArg,
  regionFlag,
  serverArg,
  textFlag,
  validName,
} from "./shared";
import { capture, removeServer } from "./sql-instances";

const api = "alloydb.googleapis.com" as const;
const path = (...tail: string[]) => ["gcloud", "alloydb", ...tail];
const cluster = (ctx: ProjectContext, args: ParsedArgs) =>
  serverArg(ctx, ParsedArgs.requiredPositional(args, 0), "alloy", args);
const scope = [regionFlag];
const createCluster = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const name = ParsedArgs.requiredPositional(args, 0);
  const valid = validName(name);
  if (!valid.ok) {
    return valid;
  }
  const region = regionArg(ctx, args);
  if (!region.ok) {
    return region;
  }
  if (findServer(ctx.world, { projectId: ctx.project.projectId, kind: "alloy", name })) {
    return invalid("AlloyDB cluster already exists (names are project-scoped in this lesson).");
  }
  const network = textFlag(args, "network");
  if (
    !ctx.project.enabledApis.includes("compute.googleapis.com") ||
    !permission(ctx, "compute.networks.get").ok ||
    !ctx.world.networks.some((n) => n.projectId === ctx.project.projectId && n.name === network)
  ) {
    return invalid(
      "AlloyDB requires Compute API, network read permission and an existing private VPC.",
    );
  }
  const s = {
    ...defaultServer(
      { projectId: ctx.project.projectId, kind: "alloy", name },
      region.value,
      "POSTGRES_16",
    ),
    network,
  };
  const world = putServer(ctx.world, s);
  return finish(
    {
      ...world,
      relational: { ...world.relational, users: [...world.relational.users, defaultUser(s)] },
    },
    recordServer(world, s),
  );
};
const createInstance = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const s = serverArg(ctx, textFlag(args, "cluster"), "alloy", args);
  if (!s.ok) {
    return s;
  }
  const name = ParsedArgs.requiredPositional(args, 0);
  const valid = validName(name);
  if (!valid.ok) {
    return valid;
  }
  const existing = ctx.world.relational.alloyInstances.filter(
    (i) => i.projectId === s.value.projectId && i.cluster === s.value.name,
  );
  if (existing.some((i) => i.name === name)) {
    return invalid("AlloyDB instance already exists.");
  }
  const type = textFlag(args, "instance-type", "PRIMARY") as AlloyInstance["type"];
  const nodes = intFlag(args, "read-pool-node-count", 1);
  if (
    nodes < 1 ||
    nodes > 20 ||
    (type === "PRIMARY" && (nodes !== 1 || existing.some((i) => i.type === "PRIMARY"))) ||
    (type === "READ_POOL" && !existing.some((i) => i.type === "PRIMARY"))
  ) {
    return invalid(
      "Exactly one primary must precede read pools; primary has 1 node, read pools have 1–20.",
    );
  }
  const i: AlloyInstance = {
    projectId: s.value.projectId,
    name,
    cluster: s.value.name,
    region: s.value.region,
    type,
    nodes,
  };
  return finish(
    {
      ...ctx.world,
      relational: {
        ...ctx.world.relational,
        alloyInstances: [...ctx.world.relational.alloyInstances, i],
      },
    },
    i,
  );
};
const restoreCluster = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const name = ParsedArgs.requiredPositional(args, 0);
  const valid = validName(name);
  if (!valid.ok) {
    return valid;
  }
  const region = regionArg(ctx, args);
  if (!region.ok) {
    return region;
  }
  const granted = permission(ctx, "alloydb.backups.get");
  if (!granted.ok) {
    return granted;
  }
  const copy = ctx.world.relational.copies.find(
    (c) =>
      c.projectId === ctx.project.projectId &&
      c.kind === "alloy" &&
      c.type === "BACKUP" &&
      c.name === textFlag(args, "backup") &&
      c.region === region.value,
  );
  if (!copy) {
    return missing("AlloyDB backup does not exist in this project/region.");
  }
  if (findServer(ctx.world, { projectId: ctx.project.projectId, kind: "alloy", name })) {
    return invalid("Restore target cluster must be new.");
  }
  const created = createCluster(ctx, args);
  if (!created.ok) {
    return created;
  }
  const s = findServer(created.value.world, {
    projectId: ctx.project.projectId,
    kind: "alloy",
    name,
  });
  if (!s) {
    return invalid("Restore target was not created.");
  }
  const world = recordRecovery(replaceData(created.value.world, s, copy.databases), {
    projectId: s.projectId,
    kind: "alloy",
    target: s.name,
    source: copy.source,
    copy: copy.name,
    type: "BACKUP",
  });
  return finish(world, {
    restoredFrom: copy.name,
    cluster: name,
    databases: databasesOf(world, s),
    next: "Create a PRIMARY instance before connecting.",
  });
};
export const AlloyCommands = [
  command(path("clusters", "create"), api, "alloydb.clusters.create", createCluster, [
    ...scope,
    Flag.string("network", "Private VPC.", { required: true }),
  ]),
  command(
    path("clusters", "list"),
    api,
    "alloydb.clusters.list",
    (ctx, args) =>
      Result.flatMap(regionArg(ctx, args), (r) =>
        finish(ctx.world, {
          clusters: ctx.world.relational.servers.filter(
            (s) => s.projectId === ctx.project.projectId && s.kind === "alloy" && s.region === r,
          ),
        }),
      ),
    scope,
    [],
  ),
  command(
    path("clusters", "describe"),
    api,
    "alloydb.clusters.get",
    (ctx, args) =>
      Result.flatMap(cluster(ctx, args), (s) => finish(ctx.world, recordServer(ctx.world, s))),
    scope,
  ),
  command(
    path("clusters", "delete"),
    api,
    "alloydb.clusters.delete",
    (ctx, args) =>
      Result.flatMap(cluster(ctx, args), (s) => {
        if (
          ctx.world.relational.alloyInstances.some(
            (i) => i.projectId === s.projectId && i.cluster === s.name,
          )
        ) {
          return invalid("Delete read pools and primary instances first.");
        }
        return finish(removeServer(ctx.world, s), { deleted: s.name });
      }),
    scope,
    undefined,
    true,
  ),
  command(path("clusters", "restore"), api, "alloydb.clusters.restore", restoreCluster, [
    ...scope,
    Flag.string("network", "Private VPC.", { required: true }),
    Flag.string("backup", "Same-region AlloyDB backup.", { required: true }),
  ]),
  command(path("instances", "create"), api, "alloydb.instances.create", createInstance, [
    clusterFlag,
    ...scope,
    Flag.enum("instance-type", "Primary or read pool.", ["PRIMARY", "READ_POOL"]),
    Flag.integer("read-pool-node-count", "Read pool nodes 1–20."),
  ]),
  ...(["list", "describe", "delete"] as const).map((op) =>
    command(
      path("instances", op),
      api,
      `alloydb.instances.${op === "describe" ? "get" : op}`,
      (ctx, args) =>
        Result.flatMap(serverArg(ctx, textFlag(args, "cluster"), "alloy", args), (s) => {
          const items = ctx.world.relational.alloyInstances.filter(
            (i) => i.projectId === s.projectId && i.cluster === s.name,
          );
          if (op === "list") {
            return finish(ctx.world, { instances: items });
          }
          const i = items.find((i) => i.name === ParsedArgs.requiredPositional(args, 0));
          if (!i) {
            return missing("AlloyDB instance does not exist in this cluster.");
          }
          if (op === "describe") {
            return finish(ctx.world, i);
          }
          if (i.type === "PRIMARY" && items.some((i) => i.type === "READ_POOL")) {
            return invalid("Delete read pools before the primary.");
          }
          return finish(
            {
              ...ctx.world,
              relational: {
                ...ctx.world.relational,
                alloyInstances: ctx.world.relational.alloyInstances.filter((v) => v !== i),
              },
            },
            { deleted: i.name },
          );
        }),
      [clusterFlag, ...scope],
      op === "list" ? [] : [nameArg("INSTANCE", candidates("alloyInstances"))],
      op === "delete",
    ),
  ),
  command(
    path("backups", "create"),
    api,
    "alloydb.backups.create",
    (ctx, args) =>
      Result.flatMap(serverArg(ctx, textFlag(args, "cluster"), "alloy", args), (s) => {
        const name = ParsedArgs.requiredPositional(args, 0);
        const valid = validName(name);
        if (!valid.ok) {
          return valid;
        }
        if (
          !ctx.world.relational.alloyInstances.some(
            (i) => i.projectId === s.projectId && i.cluster === s.name && i.type === "PRIMARY",
          ) ||
          ctx.world.relational.copies.some(
            (c) => c.projectId === s.projectId && c.kind === "alloy" && c.name === name,
          )
        ) {
          return invalid("Backup requires a primary and unique backup name.");
        }
        const copy = capture(ctx.world, s, name, "BACKUP", ctx.now);
        return finish(
          {
            ...ctx.world,
            relational: { ...ctx.world.relational, copies: [...ctx.world.relational.copies, copy] },
          },
          { name, source: s.name, status: "READY" },
        );
      }),
    [clusterFlag, ...scope],
  ),
  ...(["list", "describe", "delete"] as const).map((op) =>
    command(
      path("backups", op),
      api,
      `alloydb.backups.${op === "describe" ? "get" : op}`,
      (ctx, args) =>
        Result.flatMap(regionArg(ctx, args), (r) => {
          const copies = ctx.world.relational.copies.filter(
            (c) =>
              c.projectId === ctx.project.projectId &&
              c.kind === "alloy" &&
              c.type === "BACKUP" &&
              c.region === r,
          );
          if (op === "list") {
            return finish(ctx.world, {
              backups: copies.map((c) => ({
                name: c.name,
                source: c.source,
                timestamp: c.timestamp,
              })),
            });
          }
          const copy = copies.find((c) => c.name === ParsedArgs.requiredPositional(args, 0));
          if (!copy) {
            return missing("AlloyDB backup not found in this region.");
          }
          if (op === "describe") {
            return finish(ctx.world, copy);
          }
          return finish(
            {
              ...ctx.world,
              relational: {
                ...ctx.world.relational,
                copies: ctx.world.relational.copies.filter((c) => c !== copy),
              },
            },
            { deleted: copy.name },
          );
        }),
      scope,
      op === "list" ? [] : [nameArg()],
      op === "delete",
    ),
  ),
];
