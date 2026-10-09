import { Flag, type ParsedArgs, type ProjectContext } from "@/engine/cli/command-spec";
import { Candidates } from "@/engine/commands/shared";
import { Zone } from "@/engine/domains/catalog";
import {
  type BigtableCopy,
  type BigtableInstance,
  type BigtableTable,
  type Cell,
  type Cluster,
  patch,
  recovered,
  same,
  validKey,
} from "@/engine/domains/managed-databases/model";
import { validIdentifier, validTimestamp } from "@/engine/domains/relational/model";
import { Result } from "@/utils/Result";
import {
  command,
  finish,
  integer,
  invalid,
  missing,
  name,
  observed,
  permit,
  sf,
  source,
  text,
  validName,
} from "./shared";

const api = "bigtableadmin.googleapis.com";
const scope = [sf("instance", true, source("bigtableInstances")), sf("cluster")];
const findInstance = (ctx: ProjectContext, args: ParsedArgs) => {
  const i = ctx.world.managedDatabases.bigtableInstances.find(
    (i) => i.projectId === ctx.project.projectId && i.name === text(args, "instance"),
  );
  return i ? Result.ok(i) : missing("Bigtable instance does not exist in this project.");
};
const put = (ctx: ProjectContext, i: BigtableInstance) =>
  patch(ctx.world, {
    bigtableInstances: ctx.world.managedDatabases.bigtableInstances.map((old) =>
      same(old, i) ? i : old,
    ),
  });
const cluster = (i: BigtableInstance, args: ParsedArgs) =>
  i.clusters.find((c) => c.name === text(args, "cluster", i.clusters[0]?.name));
const writeTables = (
  i: BigtableInstance,
  c: Cluster,
  tables: readonly BigtableTable[],
): BigtableInstance => ({
  ...i,
  tables,
  version: i.version + 1,
  clusters: i.clusters.map((old) => (old === c ? { ...old, tables, version: i.version + 1 } : old)),
});
const writable = (i: BigtableInstance, c?: Cluster) => c && c.version === i.version;
const data = (ctx: ProjectContext, args: ParsedArgs) =>
  Result.flatMap(findInstance(ctx, args), (i) => {
    const c = cluster(i, args);
    if (!c) {
      return missing("Cluster does not exist in this instance.");
    }
    const table = c.tables.find((t) => t.name === text(args, "table", name(args)));
    if (!table) {
      return missing("Table does not exist on this cluster; advance replication if needed.");
    }
    return Result.ok({ i, c, table });
  });
const instances = ["create", "list", "describe", "delete"].map((action) =>
  command(
    ["gcloud", "bigtable", "instances", action],
    api,
    `bigtable.instances.${action === "describe" ? "get" : action}`,
    (ctx, args) => {
      const items = ctx.world.managedDatabases.bigtableInstances;
      if (action === "list") {
        return finish(ctx.world, {
          instances: items.filter((i) => i.projectId === ctx.project.projectId),
        });
      }
      const old = items.find((i) => i.projectId === ctx.project.projectId && i.name === name(args));
      if (action === "create") {
        const zone = text(args, "cluster-zone");
        const c = {
          name: text(args, "cluster"),
          zone,
          nodes: integer(args, "cluster-num-nodes", 1),
          version: 0,
          tables: [],
        };
        if (
          old ||
          !validName(name(args)) ||
          !validName(c.name) ||
          !Zone.parse(zone).some ||
          c.nodes < 1 ||
          c.nodes > 100
        ) {
          return invalid("Unique instance/cluster, catalog zone and 1–100 nodes are required.");
        }
        const i: BigtableInstance = {
          projectId: ctx.project.projectId,
          name: name(args),
          version: 0,
          tables: [],
          clusters: [c],
        };
        return finish(patch(ctx.world, { bigtableInstances: [...items, i] }), i);
      }
      if (!old) {
        return missing("Bigtable instance does not exist.");
      }
      if (action === "describe") {
        return finish(ctx.world, old);
      }
      if (old.tables.length > 0) {
        return invalid("Delete tables before the instance; backups remain independent.");
      }
      return finish(patch(ctx.world, { bigtableInstances: items.filter((i) => i !== old) }), {
        deleted: old.name,
      });
    },
    [
      sf("cluster"),
      sf("cluster-zone", false, Candidates.zones),
      Flag.integer("cluster-num-nodes", "Cluster capacity 1–100 nodes."),
    ],
    action !== "list",
    source("bigtableInstances"),
    action === "delete",
  ),
);
const clusters = ["create", "list", "describe", "update", "delete"].map((action) =>
  command(
    ["gcloud", "bigtable", "clusters", action],
    api,
    `bigtable.clusters.${action === "describe" ? "get" : action}`,
    (ctx, args) =>
      Result.flatMap(findInstance(ctx, args), (i) => {
        if (action === "list") {
          return finish(ctx.world, { clusters: i.clusters });
        }
        const old = i.clusters.find((c) => c.name === name(args));
        if (action === "create") {
          const zone = text(args, "zone");
          const c: Cluster = {
            name: name(args),
            zone,
            nodes: integer(args, "num-nodes", 1),
            version: i.version,
            tables: i.tables,
          };
          if (
            old ||
            !validName(c.name) ||
            !Zone.parse(zone).some ||
            i.clusters.length >= 4 ||
            i.clusters.some((r) => r.zone === zone) ||
            c.nodes < 1 ||
            c.nodes > 100
          ) {
            return invalid(
              "Use a unique cluster in a different zone, 1–100 nodes, max four clusters.",
            );
          }
          return finish(put(ctx, { ...i, clusters: [...i.clusters, c] }), c);
        }
        if (!old) {
          return missing("Cluster does not exist in this instance.");
        }
        if (text(args, "zone") && text(args, "zone") !== old.zone) {
          return invalid("Cluster zone is immutable.");
        }
        if (action === "describe") {
          return finish(ctx.world, { ...old, caughtUp: old.version === i.version });
        }
        if (action === "update") {
          const nodes = integer(args, "num-nodes", 0);
          if (nodes < 1 || nodes > 100) {
            return invalid("Specify 1–100 nodes.");
          }
          const c = { ...old, nodes };
          return finish(
            put(ctx, { ...i, clusters: i.clusters.map((v) => (v === old ? c : v)) }),
            c,
          );
        }
        if (
          i.clusters.length === 1 ||
          !i.clusters.some((c) => c !== old && c.version === i.version)
        ) {
          return invalid("Keep at least one caught-up cluster before deletion.");
        }
        return finish(put(ctx, { ...i, clusters: i.clusters.filter((c) => c !== old) }), {
          deleted: old.name,
        });
      }),
    [
      sf("instance", true, source("bigtableInstances")),
      sf("zone", false, Candidates.zones),
      Flag.integer("num-nodes", "1–100 nodes."),
    ],
    action !== "list",
    undefined,
    action === "delete",
  ),
);
const tables = ["create", "list", "describe", "delete"].map((action) =>
  command(
    ["sim", "bigtable", "tables", action],
    api,
    `bigtable.tables.${action === "describe" ? "get" : action}`,
    (ctx, args) =>
      Result.flatMap(findInstance(ctx, args), (i) => {
        const c = cluster(i, args);
        if (!c) {
          return missing("Cluster does not exist.");
        }
        if (action === "list") {
          return finish(ctx.world, { tables: c.tables });
        }
        const old = c.tables.find((t) => t.name === name(args));
        if (action === "describe") {
          return old
            ? finish(ctx.world, { ...old, cluster: c.name, caughtUp: c.version === i.version })
            : missing("Table does not exist on this cluster.");
        }
        if (!writable(i, c)) {
          return invalid("Advance replication before writing on a stale cluster.");
        }
        if (action === "create") {
          const familyNames = text(args, "column-families", "data").split(",");
          if (
            old ||
            !validIdentifier(name(args)) ||
            familyNames.length > 20 ||
            new Set(familyNames).size !== familyNames.length ||
            !familyNames.every(validIdentifier)
          ) {
            return invalid("Unique table/column-family identifiers required.");
          }
          const t: BigtableTable = {
            name: name(args),
            families: familyNames.map((n) => ({ name: n, maxVersions: 1, maxAgeSeconds: 0 })),
            cells: [],
          };
          return finish(put(ctx, writeTables(i, c, [...i.tables, t])), t);
        }
        if (!old) {
          return missing("Table does not exist.");
        }
        return finish(
          put(
            ctx,
            writeTables(
              i,
              c,
              i.tables.filter((t) => t.name !== old.name),
            ),
          ),
          { deleted: old.name },
        );
      }),
    [...scope, ...(action === "create" ? [sf("column-families")] : [])],
    action !== "list",
    undefined,
    action === "delete",
  ),
);
const families = command(
  ["sim", "bigtable", "families", "set-gc"],
  api,
  "bigtable.tables.update",
  (ctx, args) =>
    Result.flatMap(data(ctx, args), ({ i, c, table }) => {
      const family = table.families.find((f) => f.name === name(args));
      const maxVersions = integer(args, "max-versions", family?.maxVersions ?? 1);
      const maxAgeSeconds = integer(args, "max-age-seconds", family?.maxAgeSeconds ?? 0);
      if (
        !family ||
        !writable(i, c) ||
        maxVersions < 1 ||
        maxVersions > 100 ||
        maxAgeSeconds < 0 ||
        maxAgeSeconds > 31536000
      ) {
        return invalid("Existing family on a caught-up cluster and bounded GC rules required.");
      }
      const t = {
        ...table,
        families: table.families.map((f) =>
          f === family ? { ...f, maxVersions, maxAgeSeconds } : f,
        ),
      };
      return finish(
        put(
          ctx,
          writeTables(
            i,
            c,
            i.tables.map((v) => (v.name === t.name ? t : v)),
          ),
        ),
        t,
      );
    }),
  [
    ...scope,
    sf("table", true),
    Flag.integer("max-versions", "Keep 1–100 versions per cell."),
    Flag.integer("max-age-seconds", "0 disables age GC."),
  ],
);
const rowFlags = (action: string) => {
  const common = [...scope, sf("table", true)];
  if (action === "write") {
    return [
      ...common,
      sf("family", true),
      sf("qualifier", true),
      sf("value", true),
      sf("timestamp", true),
    ];
  }
  if (action === "scan") {
    return [...common, sf("prefix")];
  }
  return common;
};

const rows = ["write", "read", "scan", "delete"].map((action) =>
  command(
    ["sim", "bigtable", "rows", action],
    "bigtable.googleapis.com",
    `bigtable.tables.${action === "read" || action === "scan" ? "readRows" : "mutateRows"}`,
    (ctx, args) =>
      Result.flatMap(data(ctx, args), ({ i, c, table }) => {
        const row = action === "scan" ? "" : name(args);
        if (row && (!validKey(row) || row.includes("/"))) {
          return invalid("Row key must be a nonempty single segment.");
        }
        if (action === "read" || action === "scan") {
          const cells = table.cells
            .filter((v) => (row ? v.row === row : v.row.startsWith(text(args, "prefix"))))
            .sort(
              (a, b) =>
                a.row.localeCompare(b.row) ||
                a.family.localeCompare(b.family) ||
                a.qualifier.localeCompare(b.qualifier) ||
                Date.parse(b.timestamp) - Date.parse(a.timestamp),
            );
          const latest = cells.filter(
            (cell, index) =>
              !cells
                .slice(0, index)
                .some(
                  (other) =>
                    other.row === cell.row &&
                    other.family === cell.family &&
                    other.qualifier === cell.qualifier,
                ),
          );
          return observed(ctx.world, ctx, "bigtable", `${i.name}/${table.name}`, `read:${c.name}`, {
            cluster: c.name,
            caughtUp: c.version === i.version,
            cells: latest,
            versionCount: cells.length,
          });
        }
        if (!writable(i, c)) {
          return invalid("Advance replication before writing on a stale cluster.");
        }
        let cells: readonly Cell[] = table.cells.filter((v) => v.row !== row);
        if (action === "write") {
          const family = text(args, "family");
          const qualifier = text(args, "qualifier");
          const timestamp = text(args, "timestamp");
          const value = text(args, "value");
          if (
            !table.families.some((f) => f.name === family) ||
            !validIdentifier(qualifier) ||
            !validTimestamp(timestamp) ||
            value.length > 4096
          ) {
            return invalid(
              "Existing column family, qualifier and explicit valid UTC timestamp required.",
            );
          }
          cells = [
            ...table.cells.filter(
              (v) =>
                !(
                  v.row === row &&
                  v.family === family &&
                  v.qualifier === qualifier &&
                  Date.parse(v.timestamp) === Date.parse(timestamp)
                ),
            ),
            { row, family, qualifier, value, timestamp },
          ];
        }
        const t = { ...table, cells };
        return finish(
          put(
            ctx,
            writeTables(
              i,
              c,
              i.tables.map((v) => (v.name === t.name ? t : v)),
            ),
          ),
          { row, action },
        );
      }),
    rowFlags(action),
    action !== "scan",
    undefined,
    action === "delete",
  ),
);
const gc = command(
  ["sim", "bigtable", "gc"],
  api,
  "bigtable.tables.update",
  (ctx, args) =>
    Result.flatMap(data(ctx, args), ({ i, c, table }) => {
      const at = text(args, "at");
      if (
        !writable(i, c) ||
        !validTimestamp(at) ||
        table.cells.some((cell) => Date.parse(cell.timestamp) > Date.parse(at))
      ) {
        return invalid(
          "GC requires a caught-up cluster and an explicit UTC time after all stored cells.",
        );
      }
      const sorted = [...table.cells].sort(
        (a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp),
      );
      const kept = sorted.filter((cell, index) => {
        const f = table.families.find((f) => f.name === cell.family);
        if (!f) {
          return false;
        }
        const version = sorted
          .slice(0, index)
          .filter(
            (other) =>
              other.row === cell.row &&
              other.family === cell.family &&
              other.qualifier === cell.qualifier,
          ).length;
        const age = (Date.parse(at) - Date.parse(cell.timestamp)) / 1000;
        return version < f.maxVersions && (f.maxAgeSeconds === 0 || age < f.maxAgeSeconds);
      });
      const t = { ...table, cells: kept };
      return observed(
        put(
          ctx,
          writeTables(
            i,
            c,
            i.tables.map((v) => (v.name === t.name ? t : v)),
          ),
        ),
        ctx,
        "bigtable",
        `${i.name}/${t.name}`,
        "gc",
        { removed: sorted.length - kept.length, remaining: kept.length },
      );
    }),
  [...scope, sf("at", true)],
);
const sync = command(
  ["sim", "bigtable", "replication", "advance"],
  api,
  "bigtable.clusters.update",
  (ctx, args) =>
    Result.flatMap(findInstance(ctx, args), (i) => {
      const updated = {
        ...i,
        clusters: i.clusters.map((c) => ({ ...c, tables: i.tables, version: i.version })),
      };
      return finish(put(ctx, updated), {
        version: i.version,
        caughtUpClusters: updated.clusters.map((c) => c.name),
        model: "Explicit deterministic replication checkpoint; no timing guarantee.",
      });
    }),
  [sf("instance", true, source("bigtableInstances"))],
  false,
);
const backups = ["create", "list", "describe", "delete"].map((action) =>
  command(
    ["gcloud", "bigtable", "backups", action],
    api,
    `bigtable.backups.${action === "describe" ? "get" : action}`,
    (ctx, args) => {
      const copies = ctx.world.managedDatabases.bigtableCopies;
      const scoped = copies.filter(
        (b) =>
          b.projectId === ctx.project.projectId &&
          b.instance === text(args, "instance") &&
          b.cluster === text(args, "cluster"),
      );
      if (action === "list") {
        return finish(ctx.world, { backups: scoped });
      }
      const old = scoped.find((b) => b.name === name(args));
      if (action === "create") {
        const access = permit(ctx, "bigtable.tables.readRows");
        if (!access.ok) {
          return access;
        }
        return Result.flatMap(data(ctx, args), ({ i, c, table }) => {
          if (old || !validName(name(args)) || !writable(i, c)) {
            return invalid("Use a unique backup ID on a caught-up cluster.");
          }
          const b: BigtableCopy = {
            projectId: i.projectId,
            name: name(args),
            instance: i.name,
            cluster: c.name,
            zone: c.zone,
            table,
          };
          return finish(patch(ctx.world, { bigtableCopies: [...copies, b] }), b);
        });
      }
      if (!old) {
        return missing("Backup does not exist in the specified instance/cluster.");
      }
      if (action === "describe") {
        return finish(ctx.world, old);
      }
      return finish(patch(ctx.world, { bigtableCopies: copies.filter((b) => b !== old) }), {
        deleted: old.name,
      });
    },
    [sf("instance", true, source("bigtableInstances")), sf("cluster", true), sf("table")],
    action !== "list",
    source("bigtableCopies"),
    action === "delete",
  ),
);
const restore = command(
  ["sim", "bigtable", "backups", "restore"],
  api,
  "bigtable.tables.create",
  (ctx, args) =>
    Result.flatMap(findInstance(ctx, args), (i) => {
      const access = permit(ctx, "bigtable.backups.get");
      if (!access.ok) {
        return access;
      }
      const c = cluster(i, args);
      const b = ctx.world.managedDatabases.bigtableCopies.find(
        (b) =>
          b.projectId === i.projectId &&
          b.instance === text(args, "backup-instance", i.name) &&
          b.cluster === text(args, "backup-cluster", c?.name) &&
          b.name === name(args),
      );
      const target = text(args, "table");
      if (!b || !c) {
        return missing("Backup or target cluster does not exist.");
      }
      if (
        !writable(i, c) ||
        Zone.region(c.zone as Zone) !== Zone.region(b.zone as Zone) ||
        !validIdentifier(target) ||
        i.tables.some((t) => t.name === target)
      ) {
        return invalid("Restore requires a new table on a caught-up cluster in the backup region.");
      }
      const t = { ...b.table, name: target };
      return finish(
        recovered(put(ctx, writeTables(i, c, [...i.tables, t])), {
          projectId: i.projectId,
          service: "bigtable",
          source: `${b.instance}/${b.table.name}`,
          target: `${i.name}/${target}`,
          backup: b.name,
        }),
        t,
      );
    }),
  [...scope, sf("table", true), sf("backup-instance"), sf("backup-cluster")],
  true,
  source("bigtableCopies"),
);
export const BigtableCommands = [
  ...instances,
  ...clusters,
  ...tables,
  families,
  ...rows,
  gc,
  sync,
  ...backups,
  restore,
];
