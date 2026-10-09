import {
  type CommandResult,
  Flag,
  type ParsedArgs,
  type ProjectContext,
} from "@/engine/cli/command-spec";
import {
  patch,
  recovered,
  type SpannerCopy,
  type SpannerDatabase,
  type SpannerInstance,
  spannerConfigs,
  validCapacity,
} from "@/engine/domains/managed-databases/model";
import { spannerSql } from "@/engine/domains/managed-databases/spanner-sql";
import { validIdentifier } from "@/engine/domains/relational/model";
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

const api = "spanner.googleapis.com";
const instanceFlag = sf("instance", true, source("spannerInstances"));
const instance = (ctx: ProjectContext, args: ParsedArgs) => {
  const found = ctx.world.managedDatabases.spannerInstances.find(
    (i) => i.projectId === ctx.project.projectId && i.name === text(args, "instance"),
  );
  if (!found) {
    return missing("Spanner instance does not exist in this project.");
  }
  return Result.ok(found);
};
const database = (ctx: ProjectContext, args: ParsedArgs) =>
  Result.flatMap(instance(ctx, args), (i) => {
    const found = ctx.world.managedDatabases.spannerDatabases.find(
      (d) => d.projectId === i.projectId && d.instance === i.name && d.name === name(args),
    );
    return found ? Result.ok(found) : missing("Database does not exist in this Spanner instance.");
  });
const execute = (
  ctx: ProjectContext,
  args: ParsedArgs,
  schema = false,
  readOnly = false,
): CommandResult =>
  Result.flatMap(database(ctx, args), (db) => {
    const sql = text(args, schema ? "ddl" : "sql");
    if (schema && !/^CREATE TABLE /i.test(sql.trim())) {
      return invalid("Only CREATE TABLE DDL is supported in this schema lesson.");
    }
    if (!schema && /^CREATE TABLE /i.test(sql.trim())) {
      return invalid("Use databases ddl update for schema changes.");
    }
    const evaluated = spannerSql(db.tables, sql);
    if (!evaluated.ok) {
      return invalid(evaluated.error);
    }
    if (readOnly && evaluated.value.attemptedWrite) {
      return invalid("execute-sql is read-only here; use sim spanner execute for mutations.");
    }
    const permission = evaluated.value.attemptedWrite
      ? "spanner.databases.write"
      : "spanner.databases.read";
    const authorized = permit(ctx, schema ? "spanner.databases.updateDdl" : permission);
    if (!authorized.ok) {
      return authorized;
    }
    const updated = { ...db, tables: evaluated.value.database.tables };
    const world = patch(ctx.world, {
      spannerDatabases: ctx.world.managedDatabases.spannerDatabases.map((d) =>
        d === db ? updated : d,
      ),
    });
    return observed(
      world,
      ctx,
      "spanner",
      `${db.instance}/${db.name}`,
      schema ? "schema" : "query",
      { rows: evaluated.value.rows, affectedRows: evaluated.value.affected, consistency: "STRONG" },
    );
  });
const instances = ["create", "list", "describe", "update", "delete"].map((action) =>
  command(
    ["gcloud", "spanner", "instances", action],
    api,
    `spanner.instances.${action === "describe" ? "get" : action}`,
    (ctx, args) => {
      const items = ctx.world.managedDatabases.spannerInstances;
      const own = items.filter((i) => i.projectId === ctx.project.projectId);
      if (action === "list") {
        return finish(ctx.world, { instances: own });
      }
      const old = own.find((i) => i.name === name(args));
      if (action === "create") {
        if (!validName(name(args)) || old) {
          return invalid("Instance name invalid or already exists.");
        }
        const units = integer(args, "processing-units", integer(args, "nodes", 1) * 1000);
        if (args.flags.nodes && args.flags["processing-units"]) {
          return invalid("Specify nodes or processing-units, not both.");
        }
        const i: SpannerInstance = {
          projectId: ctx.project.projectId,
          name: name(args),
          config: text(args, "config", "regional-us-central1"),
          processingUnits: units,
        };
        if (!spannerConfigs().includes(i.config) || !validCapacity(units)) {
          return invalid(
            "Unsupported instance config/capacity. Use regional catalog configs or nam3; 100–900 PU by 100, 1000–10000 by 1000.",
          );
        }
        return finish(patch(ctx.world, { spannerInstances: [...items, i] }), i);
      }
      if (!old) {
        return missing("Spanner instance does not exist.");
      }
      if (action === "describe") {
        return finish(ctx.world, {
          ...old,
          configurationType: old.config.startsWith("regional-") ? "REGIONAL" : "MULTI_REGION",
          consistency: "STRONG",
        });
      }
      if (action === "update") {
        if (
          text(args, "config") ||
          Boolean(args.flags.nodes) === Boolean(args.flags["processing-units"])
        ) {
          return invalid("Config is immutable; update requires exactly one capacity flag.");
        }
        const units = integer(args, "processing-units", integer(args, "nodes", 1) * 1000);
        if (!validCapacity(units)) {
          return invalid("Unsupported capacity.");
        }
        const i = { ...old, processingUnits: units };
        return finish(
          patch(ctx.world, { spannerInstances: items.map((v) => (v === old ? i : v)) }),
          i,
        );
      }
      if (
        ctx.world.managedDatabases.spannerDatabases.some(
          (d) => d.projectId === old.projectId && d.instance === old.name,
        )
      ) {
        return invalid("Delete databases before their instance.");
      }
      return finish(patch(ctx.world, { spannerInstances: items.filter((i) => i !== old) }), {
        deleted: old.name,
      });
    },
    [
      sf("config", false, () => spannerConfigs()),
      Flag.integer("processing-units", "100–10000 processing units."),
      Flag.integer("nodes", "1–10 nodes."),
    ],
    action !== "list",
    source("spannerInstances"),
    action === "delete",
  ),
);
const databases = ["create", "list", "describe", "delete"].map((action) =>
  command(
    ["gcloud", "spanner", "databases", action],
    api,
    `spanner.databases.${action === "describe" ? "get" : action}`,
    (ctx, args) =>
      Result.flatMap(instance(ctx, args), (i) => {
        const all = ctx.world.managedDatabases.spannerDatabases;
        const own = all.filter((d) => d.projectId === i.projectId && d.instance === i.name);
        if (action === "list") {
          return finish(ctx.world, { databases: own });
        }
        const old = own.find((d) => d.name === name(args));
        if (action === "create") {
          if (!validIdentifier(name(args)) || old) {
            return invalid("Database name invalid or already exists.");
          }
          let db: SpannerDatabase = {
            projectId: i.projectId,
            instance: i.name,
            name: name(args),
            tables: [],
          };
          if (text(args, "ddl")) {
            if (!/^CREATE TABLE /i.test(text(args, "ddl"))) {
              return invalid("Only CREATE TABLE is accepted as initial DDL.");
            }
            const parsed = spannerSql([], text(args, "ddl"));
            if (!parsed.ok) {
              return invalid(parsed.error);
            }
            db = { ...db, tables: parsed.value.database.tables };
          }
          return finish(patch(ctx.world, { spannerDatabases: [...all, db] }), db);
        }
        if (!old) {
          return missing("Database does not exist in this instance.");
        }
        if (action === "describe") {
          return finish(ctx.world, old);
        }
        return finish(patch(ctx.world, { spannerDatabases: all.filter((d) => d !== old) }), {
          deleted: old.name,
        });
      }),
    [instanceFlag, ...(action === "create" ? [sf("ddl")] : [])],
    action !== "list",
    source("spannerDatabases"),
    action === "delete",
  ),
);
const backups = ["create", "list", "describe", "delete"].map((action) =>
  command(
    ["gcloud", "spanner", "backups", action],
    api,
    `spanner.backups.${action === "describe" ? "get" : action}`,
    (ctx, args) =>
      Result.flatMap(instance(ctx, args), (i) => {
        const copies = ctx.world.managedDatabases.spannerCopies;
        const own = copies.filter((b) => b.projectId === i.projectId && b.instance === i.name);
        if (action === "list") {
          return finish(ctx.world, { backups: own });
        }
        const old = own.find((b) => b.name === name(args));
        if (action === "create") {
          const allowed = permit(ctx, "spanner.databases.read");
          if (!allowed.ok) {
            return allowed;
          }
          const db = ctx.world.managedDatabases.spannerDatabases.find(
            (d) =>
              d.projectId === i.projectId &&
              d.instance === i.name &&
              d.name === text(args, "database"),
          );
          if (!db || old || !validName(name(args))) {
            return invalid("Existing database and unique backup name are required.");
          }
          const b: SpannerCopy = { ...db, name: name(args), database: db.name, config: i.config };
          return finish(patch(ctx.world, { spannerCopies: [...copies, b] }), b);
        }
        if (!old) {
          return missing("Backup does not exist in this instance.");
        }
        if (action === "describe") {
          return finish(ctx.world, old);
        }
        return finish(patch(ctx.world, { spannerCopies: copies.filter((b) => b !== old) }), {
          deleted: old.name,
        });
      }),
    [
      instanceFlag,
      ...(action === "create" ? [sf("database", true, source("spannerDatabases"))] : []),
    ],
    action !== "list",
    source("spannerCopies"),
    action === "delete",
  ),
);
const restore = command(
  ["gcloud", "spanner", "databases", "restore"],
  api,
  "spanner.databases.create",
  (ctx, args) =>
    Result.flatMap(instance(ctx, args), (i) => {
      const access = permit(ctx, "spanner.backups.get");
      if (!access.ok) {
        return access;
      }
      const b = ctx.world.managedDatabases.spannerCopies.find(
        (b) =>
          b.projectId === i.projectId &&
          b.instance === text(args, "backup-instance", i.name) &&
          b.name === text(args, "backup"),
      );
      if (!b) {
        return missing("Backup does not exist in the specified source instance.");
      }
      if (
        b.config !== i.config ||
        !validIdentifier(name(args)) ||
        ctx.world.managedDatabases.spannerDatabases.some(
          (d) => d.projectId === i.projectId && d.instance === i.name && d.name === name(args),
        )
      ) {
        return invalid("Restore requires a new database on a compatible instance config.");
      }
      const db: SpannerDatabase = {
        projectId: i.projectId,
        instance: i.name,
        name: name(args),
        tables: b.tables,
      };
      return finish(
        recovered(
          patch(ctx.world, {
            spannerDatabases: [...ctx.world.managedDatabases.spannerDatabases, db],
          }),
          {
            projectId: i.projectId,
            service: "spanner",
            source: `${b.instance}/${b.database}`,
            target: `${i.name}/${db.name}`,
            backup: b.name,
          },
        ),
        db,
      );
    }),
  [instanceFlag, sf("backup", true, source("spannerCopies")), sf("backup-instance")],
);
export const SpannerCommands = [
  ...instances,
  ...databases,
  ...backups,
  restore,
  command(
    ["gcloud", "spanner", "databases", "ddl", "update"],
    api,
    "spanner.databases.updateDdl",
    (ctx, args) => execute(ctx, args, true),
    [instanceFlag, sf("ddl", true)],
    true,
    source("spannerDatabases"),
  ),
  command(
    ["gcloud", "spanner", "databases", "execute-sql"],
    api,
    "spanner.databases.read",
    (ctx, args) => execute(ctx, args, false, true),
    [instanceFlag, sf("sql", true)],
    true,
    source("spannerDatabases"),
  ),
  command(
    ["sim", "spanner", "execute"],
    api,
    "spanner.databases.read",
    (ctx, args) => execute(ctx, args),
    [instanceFlag, sf("sql", true)],
    true,
    source("spannerDatabases"),
  ),
];
