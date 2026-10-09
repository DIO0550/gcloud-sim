import {
  type CommandResult,
  Flag,
  ParsedArgs,
  type ProjectContext,
} from "@/engine/cli/command-spec";
import { labCandidates } from "@/engine/commands/serverless-lab/shared";
import {
  documentValue,
  type FirestoreCopy,
  firestoreLocations,
  type Index,
  patch,
  recovered,
  validCollection,
} from "@/engine/domains/managed-databases/model";
import { validIdentifier } from "@/engine/domains/relational/model";
import { publishEvent } from "@/engine/domains/serverless-lab/runtime";
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

const api = "firestore.googleapis.com";
const dbFlag = sf("database", true, labCandidates("databases"));
const database = (ctx: ProjectContext, args: ParsedArgs) => {
  const db = ctx.world.serverlessLab.databases.find(
    (d) =>
      d.projectId === ctx.project.projectId &&
      d.name === text(args, "database") &&
      d.mode === "firestore-native",
  );
  if (!db) {
    return missing("Firestore Native database does not exist.");
  }
  if (text(args, "location") && text(args, "location") !== db.region) {
    return missing("Database location does not match; location is immutable.");
  }
  return Result.ok(db);
};
const query = (ctx: ProjectContext, args: ParsedArgs): CommandResult =>
  Result.flatMap(database(ctx, args), (db) => {
    const collection = name(args);
    const field = text(args, "where-field");
    const order = text(args, "order-by");
    const limit = integer(args, "limit", 20);
    if (
      !validCollection(collection) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 200 ||
      Boolean(field) !== Boolean(text(args, "equals")) ||
      (field !== "" && !validIdentifier(field)) ||
      (order !== "" && !validIdentifier(order)) ||
      (ParsedArgs.boolean(args, "descending") && order === "")
    ) {
      return invalid("Specify a collection, limit 1–200 and both --where-field and --equals.");
    }
    let value: unknown;
    try {
      value = field ? JSON.parse(text(args, "equals")) : undefined;
    } catch {
      return invalid("--equals must be a JSON scalar (quote strings inside JSON).");
    }
    if (field && value !== null && !["number", "string", "boolean"].includes(typeof value)) {
      return invalid("Only scalar equality is supported.");
    }
    if (
      field &&
      order &&
      field !== order &&
      !ctx.world.managedDatabases.indexes.some(
        (i) =>
          i.projectId === db.projectId &&
          i.database === db.name &&
          i.collection === collection &&
          i.fields.join(",") === [field, order].join(","),
      )
    ) {
      return invalid("Missing composite index for equality field + order-by field.");
    }
    const docs = ctx.world.serverlessLab.documents.filter(
      (d) =>
        d.projectId === db.projectId &&
        d.database === db.name &&
        d.path.slice(0, d.path.lastIndexOf("/")) === collection,
    );
    const records: { path: string; data: Record<string, string | number | boolean | null> }[] = [];
    for (const doc of docs) {
      const data = documentValue(doc.data);
      if (!data.ok) {
        return invalid(data.error);
      }
      if (field && data.value[field] !== value) {
        continue;
      }
      if (order && !(order in data.value)) {
        continue;
      }
      if (order && !["number", "string"].includes(typeof data.value[order])) {
        return invalid("Ordering supports numeric or text fields only.");
      }
      records.push({
        path: doc.path,
        data: data.value as Record<string, string | number | boolean | null>,
      });
    }
    if (order && new Set(records.map((r) => typeof r.data[order])).size > 1) {
      return invalid("Mixed-type ordering is unsupported in this lesson.");
    }
    const descending = ParsedArgs.boolean(args, "descending");
    const ordered = [...records].sort((a, b) => {
      if (!order) {
        return a.path.localeCompare(b.path);
      }
      const av = a.data[order];
      const bv = b.data[order];
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return descending ? -cmp : cmp;
    });
    return observed(ctx.world, ctx, "firestore", db.name, "query", {
      consistency: "STRONG",
      location: db.region,
      collection,
      documents: ordered.slice(0, limit),
    });
  });
const indexes = ["create", "list", "describe", "delete"].map((action) =>
  command(
    ["sim", "firestore", "indexes", action],
    api,
    `datastore.indexes.${action === "describe" ? "get" : action}`,
    (ctx, args) =>
      Result.flatMap(database(ctx, args), (db) => {
        const items = ctx.world.managedDatabases.indexes;
        const scoped = items.filter((i) => i.projectId === db.projectId && i.database === db.name);
        if (action === "list") {
          return finish(ctx.world, { indexes: scoped });
        }
        const found = scoped.find((i) => i.name === name(args));
        if (action === "create") {
          const fields = text(args, "fields").split(",");
          const i: Index = {
            projectId: db.projectId,
            database: db.name,
            name: name(args),
            collection: text(args, "collection"),
            fields,
          };
          if (!validName(i.name) || found) {
            return invalid("Index already exists or name is invalid.");
          }
          return finish(patch(ctx.world, { indexes: [...items, i] }), { ...i, state: "READY" });
        }
        if (!found) {
          return missing("Index does not exist in this database.");
        }
        if (action === "describe") {
          return finish(ctx.world, { ...found, state: "READY" });
        }
        return finish(patch(ctx.world, { indexes: items.filter((i) => i !== found) }), {
          deleted: found.name,
        });
      }),
    [dbFlag, ...(action === "create" ? [sf("collection", true), sf("fields", true)] : [])],
    action !== "list",
    source("indexes"),
    action === "delete",
  ),
);
const backups = ["create", "list", "describe", "delete"].map((action) =>
  command(
    ["sim", "firestore", "backups", action],
    api,
    `datastore.backups.${action === "describe" ? "get" : action}`,
    (ctx, args) => {
      const copies = ctx.world.managedDatabases.firestoreCopies;
      const scoped = copies.filter(
        (c) =>
          c.projectId === ctx.project.projectId &&
          (!text(args, "location") || c.location === text(args, "location")) &&
          (!text(args, "database") || c.database === text(args, "database")),
      );
      if (action === "list") {
        return finish(ctx.world, {
          backups: scoped.map((b) => ({
            name: b.name,
            database: b.database,
            location: b.location,
            documentCount: b.documents.length,
          })),
        });
      }
      const old = scoped.find((c) => c.name === name(args));
      if (action === "create") {
        const access = permit(ctx, "datastore.entities.get");
        if (!access.ok) {
          return access;
        }
        return Result.flatMap(database(ctx, args), (db) => {
          if (
            !validName(name(args)) ||
            copies.some((c) => c.projectId === db.projectId && c.name === name(args))
          ) {
            return invalid("Backup name invalid or already exists.");
          }
          const copy: FirestoreCopy = {
            name: name(args),
            projectId: db.projectId,
            database: db.name,
            location: db.region,
            documents: ctx.world.serverlessLab.documents.filter(
              (d) => d.projectId === db.projectId && d.database === db.name,
            ),
          };
          return finish(patch(ctx.world, { firestoreCopies: [...copies, copy] }), {
            name: copy.name,
            location: copy.location,
            documentCount: copy.documents.length,
          });
        });
      }
      if (!old) {
        return missing("Backup does not exist in this project/location.");
      }
      if (action === "describe") {
        return finish(ctx.world, {
          name: old.name,
          location: old.location,
          database: old.database,
          documentCount: old.documents.length,
        });
      }
      return finish(patch(ctx.world, { firestoreCopies: copies.filter((c) => c !== old) }), {
        deleted: old.name,
      });
    },
    [sf("database", false, labCandidates("databases")), sf("location")],
    action !== "list",
    source("firestoreCopies"),
    action === "delete",
  ),
);
const restore = command(
  ["sim", "firestore", "backups", "restore"],
  api,
  "datastore.databases.create",
  (ctx, args) => {
    const allowed = permit(ctx, "datastore.backups.get");
    if (!allowed.ok) {
      return allowed;
    }
    const b = ctx.world.managedDatabases.firestoreCopies.find(
      (c) => c.projectId === ctx.project.projectId && c.name === name(args),
    );
    if (!b) {
      return missing("Backup does not exist.");
    }
    const target = text(args, "destination-database");
    if (
      !/^[a-z][a-z0-9-]{2,62}$/.test(target) ||
      ctx.world.serverlessLab.databases.some(
        (d) => d.projectId === b.projectId && d.name === target,
      ) ||
      text(args, "location", b.location) !== b.location
    ) {
      return invalid("Restore requires a new database ID in the backup location.");
    }
    const world = {
      ...ctx.world,
      serverlessLab: {
        ...ctx.world.serverlessLab,
        databases: [
          ...ctx.world.serverlessLab.databases,
          {
            projectId: b.projectId,
            name: target,
            region: b.location,
            mode: "firestore-native" as const,
          },
        ],
        documents: [
          ...ctx.world.serverlessLab.documents,
          ...b.documents.map((d) => ({ ...d, database: target })),
        ],
      },
    };
    return finish(
      recovered(world, {
        projectId: b.projectId,
        service: "firestore",
        source: b.database,
        target,
        backup: b.name,
      }),
      { database: target, documents: b.documents.length, indexesRestored: false },
    );
  },
  [sf("destination-database", true), sf("location")],
  true,
  source("firestoreCopies"),
);

const increment = command(
  ["sim", "firestore", "documents", "increment"],
  api,
  "datastore.entities.update",
  (ctx, args) =>
    Result.flatMap(database(ctx, args), (db) => {
      const old = ctx.world.serverlessLab.documents.find(
        (d) => d.projectId === db.projectId && d.database === db.name && d.path === name(args),
      );
      const expected = integer(args, "expected-version", -1);
      const amount = integer(args, "amount", 1);
      if (!old) {
        return missing("Document does not exist.");
      }
      const value = documentValue(old.data);
      if (!value.ok) {
        return invalid(value.error);
      }
      const field = text(args, "field");
      const current = value.value[field];
      if (
        old.version !== expected ||
        typeof current !== "number" ||
        !Number.isSafeInteger(current + amount)
      ) {
        return invalid(
          "Transaction conflict, nonnumeric field or overflow. Read the current version first.",
        );
      }
      const updated = {
        ...old,
        version: old.version + 1,
        data: JSON.stringify({ ...value.value, [field]: current + amount }),
      };
      if (!Number.isSafeInteger(updated.version) || !documentValue(updated.data).ok) {
        return invalid("Updated document exceeds the version or size limit.");
      }
      let world = publishEvent(
        {
          ...ctx.world,
          serverlessLab: {
            ...ctx.world.serverlessLab,
            documents: ctx.world.serverlessLab.documents.map((d) => (d === old ? updated : d)),
          },
        },
        {
          projectId: db.projectId,
          kind: "firestore",
          source: db.name,
          document: old.path,
          eventType: "google.cloud.firestore.document.v1.updated",
        },
      );
      world = publishEvent(world, {
        projectId: db.projectId,
        kind: "firestore",
        source: db.name,
        document: old.path,
        eventType: "google.cloud.firestore.document.v1.written",
      });
      return observed(world, ctx, "firestore", db.name, "transaction", {
        path: old.path,
        version: updated.version,
        data: updated.data,
      });
    }),
  [
    dbFlag,
    sf("field", true),
    Flag.integer("amount", "Atomic increment."),
    Flag.integer("expected-version", "Optimistic transaction version.", { required: true }),
  ],
);
export const FirestoreLessonCommands = [
  command(["sim", "firestore", "query"], api, "datastore.entities.list", query, [
    dbFlag,
    sf("location"),
    sf("where-field"),
    sf("equals"),
    sf("order-by"),
    Flag.boolean("descending", "Descending order."),
    Flag.integer("limit", "1–200 results."),
  ]),
  ...indexes,
  ...backups,
  restore,
  increment,
];
export { firestoreLocations };
