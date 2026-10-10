import type { CommandFailure } from "@/engine/cli/command-failure";
import {
  type CommandResult,
  Flag,
  ParsedArgs,
  type ProjectContext,
} from "@/engine/cli/command-spec";
import { storageNow } from "@/engine/commands/storage-lab/runtime";
import {
  type Database,
  databasesOf,
  type Kind,
  recordRecovery,
  replaceData,
  type Server,
  sourceIpAllowed,
  syncReplicas,
  validIdentifier,
} from "@/engine/domains/relational/model";
import { evaluateSql } from "@/engine/domains/relational/sql";
import { GsUrl } from "@/engine/domains/storage";
import { keyAccess, putObject, storageAllows } from "@/engine/domains/storage-lab/model";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";
import {
  candidates,
  clusterFlag,
  command,
  finish,
  instanceFlag,
  invalid,
  missing,
  nameArg,
  regionFlag,
  serverArg,
  textFlag,
  userOf,
} from "./shared";
import { capture, migrationLocked } from "./sql-instances";

const parent = (ctx: ProjectContext, args: ParsedArgs, kind: Kind) =>
  serverArg(ctx, textFlag(args, kind === "sql" ? "instance" : "cluster"), kind, args);
const readOnly = (world: World, s: Server, args: ParsedArgs): boolean =>
  Boolean(
    s.master ||
      (s.kind === "alloy" &&
        world.relational.alloyInstances.some(
          (i) =>
            i.projectId === s.projectId &&
            i.cluster === s.name &&
            i.name === textFlag(args, "instance") &&
            i.type === "READ_POOL",
        )),
  );
const writable = (world: World, s: Server): boolean =>
  !s.master && !s.frozen && !migrationLocked(world, s);
const connection = (
  ctx: ProjectContext,
  args: ParsedArgs,
  s: Server,
): Result<string, CommandFailure> => {
  const user = textFlag(args, "user", s.engine.startsWith("MYSQL") ? "root" : "postgres");
  if (!userOf(ctx.world, s, user)) {
    return invalid(
      "Database user does not exist. IAM does not replace database authorization in this lesson.",
    );
  }
  if (s.kind === "alloy") {
    const instance = ctx.world.relational.alloyInstances.find(
      (i) =>
        i.projectId === s.projectId &&
        i.cluster === s.name &&
        i.name === textFlag(args, "instance"),
    );
    if (!instance || instance.region !== s.region) {
      return missing("AlloyDB target instance does not exist in this cluster/region.");
    }
  }
  const mode = textFlag(args, "via", s.kind === "sql" ? "proxy" : "private");
  if (mode === "proxy") {
    if (s.kind !== "sql" || !s.publicIp) {
      return invalid(
        "This lesson's proxy path uses the public endpoint; private endpoints require --via=private --network.",
      );
    }
  }
  if (
    mode === "private" &&
    (!s.network ||
      textFlag(args, "network") !== s.network ||
      !ctx.world.networks.some((n) => n.projectId === s.projectId && n.name === s.network))
  ) {
    return invalid("Private connection requires the instance's existing VPC network.");
  }
  if (mode === "public" && (!s.publicIp || !sourceIpAllowed(s, textFlag(args, "source-ip")))) {
    return invalid(
      "Public connection requires enabled public IP and an authorized source IPv4 address.",
    );
  }
  return Result.ok(user);
};
const createDatabase = (ctx: ProjectContext, args: ParsedArgs, kind: Kind): CommandResult =>
  Result.flatMap(parent(ctx, args, kind), (s) => {
    const name = ParsedArgs.requiredPositional(args, 0);
    if (!validIdentifier(name) || databasesOf(ctx.world, s).some((d) => d.name === name)) {
      return invalid("Invalid database name or database already exists.");
    }
    if (
      !writable(ctx.world, s) ||
      (kind === "alloy" &&
        !ctx.world.relational.alloyInstances.some(
          (i) => i.projectId === s.projectId && i.cluster === s.name && i.type === "PRIMARY",
        ))
    ) {
      return invalid("Database creation requires a writable primary.");
    }
    const d: Database = {
      projectId: s.projectId,
      kind,
      server: s.name,
      name,
      vector: false,
      tables: [],
    };
    const world = syncReplicas(replaceData(ctx.world, s, [...databasesOf(ctx.world, s), d]), s);
    return finish(world, d);
  });
const createUser = (ctx: ProjectContext, args: ParsedArgs, kind: Kind): CommandResult =>
  Result.flatMap(parent(ctx, args, kind), (s) => {
    const name = ParsedArgs.requiredPositional(args, 0);
    if (!validIdentifier(name) || userOf(ctx.world, s, name) || !writable(ctx.world, s)) {
      return invalid("User already exists, invalid name or instance is read-only.");
    }
    const role = textFlag(args, "role", "writer") as "reader" | "writer";
    const user = { projectId: s.projectId, kind, server: s.name, name, role };
    const replicas = ctx.world.relational.servers.filter(
      (r) => r.projectId === s.projectId && r.master === s.name,
    );
    const users = [user, ...replicas.map((r) => ({ ...user, server: r.name }))];
    return finish(
      {
        ...ctx.world,
        relational: { ...ctx.world.relational, users: [...ctx.world.relational.users, ...users] },
      },
      user,
    );
  });
const execute = (ctx: ProjectContext, args: ParsedArgs, kind: Kind): CommandResult => {
  const s =
    kind === "sql"
      ? serverArg(ctx, ParsedArgs.requiredPositional(args, 0), kind, args)
      : parent(ctx, args, kind);
  if (!s.ok) {
    return s;
  }
  const connected = connection(ctx, args, s.value);
  if (!connected.ok) {
    return connected;
  }
  const database = textFlag(args, "database");
  const d = databasesOf(ctx.world, s.value).find((d) => d.name === database);
  if (!d) {
    return missing("Database does not exist on this instance.");
  }
  const result = evaluateSql(d, textFlag(args, "sql"), s.value.engine.startsWith("POSTGRES"));
  if (!result.ok) {
    return invalid(result.error);
  }
  if (
    result.value.attemptedWrite &&
    (!writable(ctx.world, s.value) ||
      readOnly(ctx.world, s.value, args) ||
      userOf(ctx.world, s.value, connected.value)?.role !== "writer")
  ) {
    return invalid(
      "SQL write denied: read-only endpoint/user, paused source or migration destination.",
    );
  }
  let world = ctx.world;
  if (result.value.write) {
    world = replaceData(
      world,
      s.value,
      databasesOf(world, s.value).map((db) => (db.name === d.name ? result.value.database : db)),
    );
    world = syncReplicas(world, s.value);
  }
  const query = {
    projectId: s.value.projectId,
    kind,
    server: s.value.name,
    database,
    user: connected.value,
    endpoint: kind === "alloy" ? textFlag(args, "instance") : s.value.name,
    transaction: result.value.transaction,
    mode: textFlag(args, "via", kind === "sql" ? "proxy" : "private"),
    rows: result.value.rows,
    affected: result.value.affected,
  };
  world = {
    ...world,
    relational: { ...world.relational, queries: [...world.relational.queries, query].slice(-100) },
  };
  return finish(world, {
    rows: query.rows,
    affectedRows: query.affected,
    database,
    endpoint: kind === "alloy" ? textFlag(args, "instance") : s.value.name,
  });
};
const connectionFlags = [
  Flag.string("user", "Existing database user."),
  Flag.enum("via", "Connection path.", ["proxy", "public", "private"]),
  Flag.string("network", "Client VPC for private connection."),
  Flag.string("source-ip", "IPv4 client for public connection."),
];
export const DatabaseCommands = (["sql", "alloy"] as const).flatMap((kind) => {
  const api = kind === "sql" ? "sqladmin.googleapis.com" : "alloydb.googleapis.com";
  const prefix = kind === "sql" ? ["gcloud", "sql"] : ["sim", "alloydb"];
  const scope = kind === "sql" ? [instanceFlag] : [clusterFlag, regionFlag];
  const permissions = kind === "sql" ? "cloudsql" : "alloydb";
  return [
    command(
      [...prefix, "databases", "create"],
      api,
      `${permissions}.databases.create`,
      (ctx, args) => createDatabase(ctx, args, kind),
      scope,
    ),
    command(
      [...prefix, "databases", "list"],
      api,
      `${permissions}.databases.list`,
      (ctx, args) =>
        Result.flatMap(parent(ctx, args, kind), (s) =>
          finish(ctx.world, { databases: databasesOf(ctx.world, s) }),
        ),
      scope,
      [],
    ),
    command(
      [...prefix, "databases", "describe"],
      api,
      `${permissions}.databases.get`,
      (ctx, args) =>
        Result.flatMap(parent(ctx, args, kind), (s) => {
          const d = databasesOf(ctx.world, s).find(
            (d) => d.name === ParsedArgs.requiredPositional(args, 0),
          );
          return d ? finish(ctx.world, d) : missing("Database does not exist.");
        }),
      scope,
    ),
    command(
      [...prefix, "databases", "delete"],
      api,
      `${permissions}.databases.delete`,
      (ctx, args) =>
        Result.flatMap(parent(ctx, args, kind), (s) => {
          const name = ParsedArgs.requiredPositional(args, 0);
          if (!databasesOf(ctx.world, s).some((d) => d.name === name)) {
            return missing("Database does not exist.");
          }
          if (!writable(ctx.world, s)) {
            return invalid("Database is read-only.");
          }
          return finish(
            syncReplicas(
              replaceData(
                ctx.world,
                s,
                databasesOf(ctx.world, s).filter((d) => d.name !== name),
              ),
              s,
            ),
            { deleted: name },
          );
        }),
      scope,
      undefined,
      true,
    ),
    command(
      ["gcloud", kind === "sql" ? "sql" : "alloydb", "users", "create"],
      api,
      `${permissions}.users.create`,
      (ctx, args) => createUser(ctx, args, kind),
      [
        ...scope,
        Flag.enum("role", "Lesson database role (IAM is separate).", ["reader", "writer"]),
      ],
    ),
    command(
      ["gcloud", kind === "sql" ? "sql" : "alloydb", "users", "list"],
      api,
      `${permissions}.users.list`,
      (ctx, args) =>
        Result.flatMap(parent(ctx, args, kind), (s) =>
          finish(ctx.world, {
            users: ctx.world.relational.users.filter(
              (u) => u.projectId === s.projectId && u.kind === kind && u.server === s.name,
            ),
          }),
        ),
      scope,
      [],
    ),
    command(
      ["gcloud", kind === "sql" ? "sql" : "alloydb", "users", "delete"],
      api,
      `${permissions}.users.delete`,
      (ctx, args) =>
        Result.flatMap(parent(ctx, args, kind), (s) => {
          const name = ParsedArgs.requiredPositional(args, 0);
          if (!userOf(ctx.world, s, name)) {
            return missing("Database user does not exist.");
          }
          if (
            !writable(ctx.world, s) ||
            ctx.world.relational.profiles.some(
              (p) =>
                kind === "sql" &&
                p.projectId === s.projectId &&
                p.instance === s.name &&
                p.user === name,
            )
          ) {
            return invalid("Delete DMS profiles first; user deletion requires writable primary.");
          }
          const names = [
            s.name,
            ...ctx.world.relational.servers
              .filter((r) => r.projectId === s.projectId && r.master === s.name)
              .map((r) => r.name),
          ];
          return finish(
            {
              ...ctx.world,
              relational: {
                ...ctx.world.relational,
                users: ctx.world.relational.users.filter(
                  (u) =>
                    !(
                      u.projectId === s.projectId &&
                      u.kind === kind &&
                      names.includes(u.server) &&
                      u.name === name
                    ),
                ),
              },
            },
            { deleted: name },
          );
        }),
      scope,
      undefined,
      true,
    ),
    command(
      ["sim", kind === "sql" ? "sql" : "alloydb", "execute"],
      api,
      kind === "sql" ? "cloudsql.instances.connect" : "alloydb.instances.connect",
      (ctx, args) => execute(ctx, args, kind),
      [
        ...(kind === "sql"
          ? [regionFlag]
          : [
              clusterFlag,
              regionFlag,
              Flag.string("instance", "AlloyDB primary or read pool.", { required: true }),
            ]),
        Flag.string("database", "Database.", { required: true }),
        Flag.string("sql", "Supported SQL text.", { required: true }),
        ...connectionFlags,
      ],
      kind === "sql" ? [nameArg("INSTANCE", candidates("servers", "sql"))] : [],
    ),
  ];
});
export const ConnectCommands = [
  command(
    ["gcloud", "sql", "connect"],
    "sqladmin.googleapis.com",
    "cloudsql.instances.connect",
    (ctx, args) =>
      Result.flatMap(serverArg(ctx, ParsedArgs.requiredPositional(args, 0), "sql", args), (s) =>
        Result.flatMap(connection(ctx, args, s), (user) =>
          finish(ctx.world, {
            connected: true,
            instance: s.name,
            user,
            connectionName: `${s.projectId}:${s.region}:${s.name}`,
            next: "sim sql execute INSTANCE --database=DATABASE --sql='SELECT ...'",
          }),
        ),
      ),
    [regionFlag, ...connectionFlags],
  ),
];
const transfer = (ctx: ProjectContext, args: ParsedArgs, importing: boolean): CommandResult => {
  const s = serverArg(ctx, ParsedArgs.requiredPositional(args, 0));
  if (!s.ok) {
    return s;
  }
  if (importing && !writable(ctx.world, s.value)) {
    return invalid("Import requires a writable primary.");
  }
  const url = GsUrl.parse(ParsedArgs.requiredPositional(args, 1));
  if (!url.ok || !url.value.object) {
    return invalid("Provide gs://BUCKET/OBJECT.");
  }
  const b = World.findBucket(ctx.world, url.value.bucket);
  if (!b.some) {
    return missing("Transfer bucket does not exist.");
  }
  if (!ctx.project.enabledApis.includes("storage.googleapis.com")) {
    return invalid("Cloud Storage API is required.");
  }
  if (
    b.value.projectId !== s.value.projectId ||
    ![s.value.region, "us", "asia", "eu"].includes(b.value.location.toLowerCase())
  ) {
    return invalid("Use a same-project regional or supported multi-region bucket.");
  }
  const permitted = (permission: string) =>
    storageAllows(ctx.world, b.value, ctx.principal, permission);
  const p = importing ? "storage.objects.get" : "storage.objects.create";
  if (!permitted(p)) {
    return invalid(`Permission ${p} on the bucket is required.`);
  }
  const uri = ParsedArgs.requiredPositional(args, 1);
  if (importing) {
    const current = b.value.objects.find((o) => o.name === url.value.object);
    const key = keyAccess(ctx.world, b.value, current?.kmsKey ?? "", "Decrypt");
    if (!key.ok) {
      return invalid(key.error);
    }
    const copy = ctx.world.relational.copies.find(
      (c) =>
        c.projectId === s.value.projectId &&
        c.kind === "sql" &&
        c.name === uri &&
        c.type === "EXPORT",
    );
    if (
      !copy ||
      !b.value.objects.some(
        (o) =>
          o.name === url.value.object &&
          o.contentType === `application/sql;sim-token=${copy.token}` &&
          o.size === new TextEncoder().encode(JSON.stringify(copy.databases)).length,
      ) ||
      copy.engine !== s.value.engine
    ) {
      return invalid("Import requires an existing compatible simulator SQL export object.");
    }
    return finish(
      recordRecovery(syncReplicas(replaceData(ctx.world, s.value, copy.databases), s.value), {
        projectId: s.value.projectId,
        kind: "sql",
        target: s.value.name,
        source: copy.source,
        copy: copy.name,
        type: "IMPORT",
      }),
      {
        imported: uri,
        databases: databasesOf(ctx.world, s.value),
      },
    );
  }
  const numbered = World.nextNumber(ctx.world);
  const copy = {
    ...capture(ctx.world, s.value, uri, "EXPORT", ctx.now),
    token: `dump-${numbered.number}`,
  };
  const object = {
    name: url.value.object,
    size: new TextEncoder().encode(JSON.stringify(copy.databases)).length,
    contentType: `application/sql;sim-token=${copy.token}`,
    updated: ctx.now,
    storageClass: Option.none,
  };
  if (b.value.objects.some((o) => o.name === object.name) && !permitted("storage.objects.delete")) {
    return invalid("Overwrite requires storage.objects.delete.");
  }
  const stored = putObject(
    {
      ...numbered.world,
      relational: {
        ...ctx.world.relational,
        copies: [
          ...ctx.world.relational.copies.filter(
            (c) => !(c.projectId === copy.projectId && c.type === "EXPORT" && c.name === uri),
          ),
          copy,
        ],
      },
    },
    b.value.name,
    object,
    storageNow(ctx),
  );
  if (!stored.ok) {
    return invalid(stored.error);
  }
  const world = stored.value;
  return finish(world, { exported: uri, bytes: object.size });
};
export const TransferCommands = [
  command(
    ["gcloud", "sql", "export", "sql"],
    "sqladmin.googleapis.com",
    "cloudsql.instances.export",
    (ctx, args) => transfer(ctx, args, false),
    [],
    [nameArg("INSTANCE"), nameArg("URI")],
  ),
  command(
    ["gcloud", "sql", "import", "sql"],
    "sqladmin.googleapis.com",
    "cloudsql.instances.import",
    (ctx, args) => transfer(ctx, args, true),
    [],
    [nameArg("INSTANCE"), nameArg("URI")],
  ),
];
