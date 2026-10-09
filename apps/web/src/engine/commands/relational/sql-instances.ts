import {
  Column,
  CommandOutput,
  type CommandResult,
  Flag,
  ParsedArgs,
  type ProjectContext,
} from "@/engine/cli/command-spec";
import { CommonFlags } from "@/engine/commands/shared";
import {
  SqlDatabaseVersion,
  SqlDatabaseVersions,
  SqlTier,
  SqlTiers,
} from "@/engine/domains/catalog";
import { SqlBackup, SqlInstance } from "@/engine/domains/data";
import { Ipv4 } from "@/engine/domains/gke-control-plane";
import {
  type Copy,
  databasesOf,
  defaultServer,
  defaultUser,
  findServer,
  putServer,
  recordRecovery,
  replaceData,
  type Server,
  syncReplicas,
  validTimestamp,
} from "@/engine/domains/relational/model";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";
import {
  candidates,
  command,
  finish,
  instanceFlag,
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

const api = "sqladmin.googleapis.com" as const;
const path = (...tail: string[]) => ["gcloud", "sql", ...tail];
const columns = [
  Column.create("NAME", "name"),
  Column.create("DATABASE_VERSION", "databaseVersion"),
  Column.create("LOCATION", "gceZone"),
  Column.create("TIER", "settings.tier"),
  Column.create("PRIMARY_ADDRESS", "primaryAddress"),
  Column.create("PRIVATE_ADDRESS", "privateAddress"),
  Column.create("STATUS", "state"),
];
const baseRecord = (world: World, s: Server) => {
  const i = world.sqlInstances.find((i) => i.projectId === s.projectId && i.name === s.name);
  if (!i) {
    return recordServer(world, s);
  }
  return {
    ...SqlInstance.toRecord(i),
    ...recordServer(world, s),
    settings: { tier: i.tier, availabilityType: s.availability },
    primaryAddress: s.publicIp ? i.ipAddress : "-",
    privateAddress: s.network ? `10.90.${s.failovers % 256}.2` : "-",
  };
};
const configuration = (
  ctx: ProjectContext,
  args: ParsedArgs,
  s: Server,
): Result<Server, import("@/engine/cli/command-failure").CommandFailure> => {
  const network = textFlag(args, "network", s.network);
  if (
    network &&
    !ctx.world.networks.some((n) => n.projectId === s.projectId && n.name === network)
  ) {
    return missing("Private network does not exist in this project.");
  }
  if (network && !ctx.project.enabledApis.includes("compute.googleapis.com")) {
    return invalid("Compute Engine API is required for private connectivity.");
  }
  if (network && !permission(ctx, "compute.networks.get").ok) {
    return invalid("Permission compute.networks.get is required.");
  }
  const authorizedNetworks = args.flags["authorized-networks"]
    ? ParsedArgs.list(args, "authorized-networks")
    : s.authorizedNetworks;
  if (authorizedNetworks.some((c) => !Option.isSome(Ipv4.range(c)))) {
    return invalid("Authorized networks must be canonical IPv4 CIDRs.");
  }
  const availability = textFlag(
    args,
    "availability-type",
    s.availability.toLowerCase(),
  ).toUpperCase() as Server["availability"];
  const publicIp = Option.unwrapOr(ParsedArgs.booleanChoice(args, "assign-ip"), s.publicIp);
  const pitr = Option.unwrapOr(
    ParsedArgs.booleanChoice(args, "enable-point-in-time-recovery"),
    s.pitr,
  );
  if (!network && !publicIp) {
    return invalid("At least one connection path is required.");
  }
  if (s.master && (availability !== "ZONAL" || pitr)) {
    return invalid("Read replica cannot be configured as HA primary or PITR source.");
  }
  return Result.ok({ ...s, network, authorizedNetworks, availability, publicIp, pitr });
};
const configFlags = [
  Flag.enum("availability-type", "HA primary or single-zone instance.", ["zonal", "regional"]),
  Flag.string("network", "Private VPC network (same project)."),
  Flag.boolean("assign-ip", "Enable public IP; --no-assign-ip for private only."),
  Flag.list("authorized-networks", "Public IPv4 CIDRs."),
  Flag.boolean("enable-point-in-time-recovery", "Enable explicit virtual recovery checkpoints."),
];
const createInstance = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const name = ParsedArgs.requiredPositional(args, 0);
  const checked = validName(name);
  if (!checked.ok) {
    return checked;
  }
  if (findServer(ctx.world, { projectId: ctx.project.projectId, kind: "sql", name })) {
    return invalid("Instance already exists.");
  }
  const region = regionArg(ctx, args);
  if (!region.ok) {
    return region;
  }
  const masterName = textFlag(args, "master-instance-name");
  let master: Server | undefined;
  if (masterName) {
    master = findServer(ctx.world, {
      projectId: ctx.project.projectId,
      kind: "sql",
      name: masterName,
    });
    if (!master || master.master || master.engine.startsWith("SQLSERVER")) {
      return invalid("Replica requires an existing supported primary.");
    }
    const granted = permission(ctx, "cloudsql.instances.get");
    if (!granted.ok) {
      return granted;
    }
  }
  const engine = textFlag(args, "database-version", master?.engine ?? SqlDatabaseVersions.Mysql80);
  const tier = textFlag(args, "tier", SqlTiers.F1Micro);
  const version = SqlDatabaseVersion.parse(engine);
  const machine = SqlTier.parse(tier);
  if (!version.some || !machine.some) {
    return invalid("Unknown SQL engine or machine tier.");
  }
  if (master && master.engine !== engine) {
    return invalid("Replica engine must match its primary.");
  }
  const config = configuration(ctx, args, {
    ...defaultServer({ projectId: ctx.project.projectId, kind: "sql", name }, region.value, engine),
    master: masterName,
    network: master?.network ?? "",
  });
  if (!config.ok) {
    return config;
  }
  if (
    config.value.availability === "REGIONAL" &&
    (machine.value === SqlTiers.F1Micro || machine.value === SqlTiers.G1Small)
  ) {
    return invalid("HA requires a dedicated db-custom tier.");
  }
  const numbered = World.nextNumber(ctx.world);
  const instance = SqlInstance.create({
    projectId: ctx.project.projectId,
    name,
    region: region.value,
    databaseVersion: version.value,
    tier: machine.value,
    ipAddress: `35.243.${(numbered.number >> 8) % 256}.${numbered.number % 256}`,
    createTime: ctx.now,
  });
  if (!instance.ok) {
    return invalid(instance.error);
  }
  let world: World = {
    ...numbered.world,
    sqlInstances: [...numbered.world.sqlInstances, instance.value],
  };
  world = putServer(world, config.value);
  const users = master
    ? world.relational.users
        .filter(
          (u) => u.projectId === master.projectId && u.kind === "sql" && u.server === master.name,
        )
        .map((u) => ({ ...u, server: name }))
    : [defaultUser(config.value)];
  world = {
    ...world,
    relational: { ...world.relational, users: [...world.relational.users, ...users] },
  };
  if (master) {
    world = replaceData(world, config.value, databasesOf(world, master));
  }
  return finish(world, baseRecord(world, config.value));
};
const patch = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const server = serverArg(ctx, ParsedArgs.requiredPositional(args, 0), "sql", args);
  if (!server.ok) {
    return server;
  }
  const next = configuration(ctx, args, server.value);
  if (!next.ok) {
    return next;
  }
  const base = ctx.world.sqlInstances.find(
    (i) => i.projectId === server.value.projectId && i.name === server.value.name,
  );
  const tier = textFlag(args, "tier", base?.tier);
  const parsed = SqlTier.parse(tier);
  if (!parsed.some) {
    return invalid("Unknown machine tier.");
  }
  if (
    next.value.availability === "REGIONAL" &&
    tier.startsWith("db-") &&
    !tier.startsWith("db-custom")
  ) {
    return invalid("HA requires a dedicated db-custom tier.");
  }
  const referenced = ctx.world.relational.profiles.some(
    (p) => p.projectId === server.value.projectId && p.instance === server.value.name,
  );
  if (referenced && next.value.network !== server.value.network) {
    return invalid("Delete DMS profiles before changing their connection network.");
  }
  const world = putServer(
    {
      ...ctx.world,
      sqlInstances: ctx.world.sqlInstances.map((i) =>
        i === base ? { ...i, tier: parsed.value } : i,
      ),
    },
    next.value,
  );
  return finish(world, baseRecord(world, next.value));
};
export const removeServer = (world: World, s: Server): World => ({
  ...world,
  sqlInstances: world.sqlInstances.filter(
    (i) => !(s.kind === "sql" && i.projectId === s.projectId && i.name === s.name),
  ),
  sqlBackups: world.sqlBackups.filter(
    (b) => !(s.kind === "sql" && b.projectId === s.projectId && b.instance === s.name),
  ),
  relational: {
    ...world.relational,
    servers: world.relational.servers.filter(
      (v) => !(v.projectId === s.projectId && v.kind === s.kind && v.name === s.name),
    ),
    databases: world.relational.databases.filter(
      (d) => !(d.projectId === s.projectId && d.kind === s.kind && d.server === s.name),
    ),
    users: world.relational.users.filter(
      (u) => !(u.projectId === s.projectId && u.kind === s.kind && u.server === s.name),
    ),
    copies: world.relational.copies.filter(
      (c) =>
        !(
          s.kind === "sql" &&
          c.projectId === s.projectId &&
          c.kind === s.kind &&
          c.source === s.name
        ),
    ),
    alloyInstances: world.relational.alloyInstances.filter(
      (i) => !(s.kind === "alloy" && i.projectId === s.projectId && i.cluster === s.name),
    ),
  },
});
export const deleteAllowed = (world: World, s: Server): boolean =>
  !world.relational.servers.some((v) => v.projectId === s.projectId && v.master === s.name) &&
  !world.relational.profiles.some(
    (p) => s.kind === "sql" && p.projectId === s.projectId && p.instance === s.name,
  );
export const capture = (
  world: World,
  s: Server,
  name: string,
  type: Copy["type"],
  timestamp: string,
): Copy => ({
  projectId: s.projectId,
  name,
  kind: s.kind,
  source: s.name,
  region: s.region,
  engine: s.engine,
  type,
  timestamp,
  token: "",
  databases: databasesOf(world, s),
});
const backup = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const s = serverArg(ctx, textFlag(args, "instance"));
  if (!s.ok) {
    return s;
  }
  const numbered = World.nextNumber(ctx.world);
  const b = SqlBackup.create({
    projectId: s.value.projectId,
    instance: s.value.name,
    description: textFlag(args, "description"),
    windowStartTime: ctx.now,
    sequence: numbered.number,
  });
  const copy = capture(ctx.world, s.value, b.id, "BACKUP", ctx.now);
  const world = {
    ...World.withSqlBackup(numbered.world, b),
    relational: { ...ctx.world.relational, copies: [...ctx.world.relational.copies, copy] },
  };
  return finish(world, SqlBackup.toRecord(b));
};
const restore = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const target = serverArg(ctx, textFlag(args, "restore-instance"));
  const source = serverArg(
    ctx,
    textFlag(args, "backup-instance", textFlag(args, "restore-instance")),
  );
  if (!target.ok) {
    return target;
  }
  if (!source.ok) {
    return source;
  }
  const copy = ctx.world.relational.copies.find(
    (c) =>
      c.projectId === source.value.projectId &&
      c.kind === "sql" &&
      c.source === source.value.name &&
      c.type === "BACKUP" &&
      c.name === ParsedArgs.requiredPositional(args, 0),
  );
  if (!copy) {
    return missing("Backup does not belong to the requested source instance.");
  }
  if (
    target.value.master ||
    target.value.frozen ||
    target.value.engine !== copy.engine ||
    migrationLocked(ctx.world, target.value)
  ) {
    return invalid("Restore requires a writable instance with the same database engine/version.");
  }
  const granted = permission(ctx, "cloudsql.instances.restoreBackup");
  if (!granted.ok) {
    return granted;
  }
  const world = recordRecovery(
    syncReplicas(replaceData(ctx.world, target.value, copy.databases), target.value),
    {
      projectId: target.value.projectId,
      kind: "sql",
      target: target.value.name,
      source: copy.source,
      copy: copy.name,
      type: "BACKUP",
    },
  );
  return finish(world, {
    restoredFrom: copy.name,
    source: copy.source,
    target: target.value.name,
    databases: databasesOf(world, target.value),
  });
};
export const migrationLocked = (world: World, s: Server): boolean =>
  s.kind === "sql" &&
  world.relational.migrations.some(
    (j) =>
      j.projectId === s.projectId &&
      ["RUNNING", "STOPPED"].includes(j.state) &&
      world.relational.profiles.some(
        (p) => p.projectId === s.projectId && p.name === j.destination && p.instance === s.name,
      ),
  );
const checkpoint = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const s = serverArg(ctx, ParsedArgs.requiredPositional(args, 0));
  if (!s.ok) {
    return s;
  }
  const timestamp = textFlag(args, "timestamp");
  if (!s.value.pitr || s.value.master || !validTimestamp(timestamp)) {
    return invalid("PITR requires an enabled primary and an ISO UTC virtual timestamp.");
  }
  const points = ctx.world.relational.copies.filter(
    (c) => c.projectId === s.value.projectId && c.source === s.value.name && c.type === "POINT",
  );
  if (points.some((c) => Date.parse(c.timestamp) >= Date.parse(timestamp))) {
    return invalid("Virtual checkpoint timestamps must increase.");
  }
  const copy = capture(ctx.world, s.value, `point-${points.length + 1}`, "POINT", timestamp);
  return finish(
    {
      ...ctx.world,
      relational: { ...ctx.world.relational, copies: [...ctx.world.relational.copies, copy] },
    },
    { checkpoint: copy.name, timestamp },
  );
};
const clone = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const granted = permission(ctx, "cloudsql.backupRuns.get");
  if (!granted.ok) {
    return granted;
  }
  const source = serverArg(ctx, ParsedArgs.requiredPositional(args, 0));
  if (!source.ok) {
    return source;
  }
  const name = ParsedArgs.requiredPositional(args, 1);
  const valid = validName(name);
  if (!valid.ok) {
    return valid;
  }
  if (findServer(ctx.world, { projectId: ctx.project.projectId, kind: "sql", name })) {
    return invalid("Clone target already exists.");
  }
  const timestamp = textFlag(args, "point-in-time");
  if (!source.value.pitr || !validTimestamp(timestamp)) {
    return invalid("PITR must be enabled and point-in-time must be an ISO timestamp.");
  }
  const points = ctx.world.relational.copies
    .filter(
      (c) =>
        c.projectId === source.value.projectId &&
        c.source === source.value.name &&
        c.kind === "sql" &&
        c.type === "POINT",
    )
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  if (
    !points.length ||
    Date.parse(timestamp) < Date.parse(points[0]?.timestamp ?? "") ||
    Date.parse(timestamp) > Date.parse(points.at(-1)?.timestamp ?? "")
  ) {
    return invalid("Requested time is outside the explicit virtual recovery interval.");
  }
  const point = points.filter((c) => Date.parse(c.timestamp) <= Date.parse(timestamp)).at(-1);
  const base = ctx.world.sqlInstances.find(
    (i) => i.projectId === source.value.projectId && i.name === source.value.name,
  );
  if (!point || !base) {
    return invalid("No recoverable checkpoint.");
  }
  const next = { ...source.value, name, master: "", frozen: false, failovers: 0 };
  const numbered = World.nextNumber(ctx.world);
  let world = putServer(
    {
      ...numbered.world,
      sqlInstances: [
        ...ctx.world.sqlInstances,
        {
          ...base,
          name,
          gceZone: `${next.region}-a`,
          ipAddress: `35.243.${(numbered.number >> 8) % 256}.${numbered.number % 256}`,
          createTime: ctx.now,
        },
      ],
    },
    next,
  );
  world = {
    ...world,
    relational: { ...world.relational, users: [...world.relational.users, defaultUser(next)] },
  };
  world = recordRecovery(replaceData(world, next, point.databases), {
    projectId: next.projectId,
    kind: "sql",
    target: next.name,
    source: source.value.name,
    copy: point.name,
    type: "POINT",
  });
  return finish(world, {
    source: source.value.name,
    target: name,
    point: point.timestamp,
    databases: databasesOf(world, next),
  });
};
export const SqlInstanceCommands = [
  command(
    path("instances", "create"),
    api,
    "cloudsql.instances.create",
    createInstance,
    [
      Flag.enum("database-version", "Engine version.", Object.values(SqlDatabaseVersions)),
      Flag.enum("tier", "Machine tier.", Object.values(SqlTiers)),
      regionFlag,
      ...configFlags,
      Flag.string("master-instance-name", "Create a read replica.", {
        candidates: candidates("servers", "sql"),
      }),
    ],
    [nameArg("INSTANCE", candidates("servers", "sql"))],
  ),
  command(path("instances", "patch"), api, "cloudsql.instances.update", patch, [
    regionFlag,
    ...configFlags,
    Flag.enum("tier", "Machine tier.", Object.values(SqlTiers)),
  ]),
  command(
    path("instances", "list"),
    api,
    "cloudsql.instances.list",
    (ctx) =>
      Result.ok({
        world: ctx.world,
        output: CommandOutput.table(
          ctx.world.relational.servers
            .filter((s) => s.projectId === ctx.project.projectId && s.kind === "sql")
            .map((s) => baseRecord(ctx.world, s)),
          columns,
        ),
      }),
    [],
    [],
  ),
  command(
    path("instances", "describe"),
    api,
    "cloudsql.instances.get",
    (ctx, args) =>
      Result.flatMap(serverArg(ctx, ParsedArgs.requiredPositional(args, 0), "sql", args), (s) =>
        finish(ctx.world, baseRecord(ctx.world, s)),
      ),
    [regionFlag],
  ),
  command(
    path("instances", "delete"),
    api,
    "cloudsql.instances.delete",
    (ctx, args) =>
      Result.flatMap(serverArg(ctx, ParsedArgs.requiredPositional(args, 0)), (s) =>
        deleteAllowed(ctx.world, s)
          ? finish(removeServer(ctx.world, s), { deleted: s.name })
          : invalid("Delete dependent replicas and DMS profiles first."),
      ),
    [],
    undefined,
    true,
  ),
  command(path("instances", "failover"), api, "cloudsql.instances.failover", (ctx, args) =>
    Result.flatMap(serverArg(ctx, ParsedArgs.requiredPositional(args, 0)), (s) => {
      if (s.availability !== "REGIONAL" || s.master) {
        return invalid("Failover requires an HA primary, not a read replica.");
      }
      const next = { ...s, failovers: s.failovers + 1 };
      const world = putServer(
        {
          ...ctx.world,
          sqlInstances: ctx.world.sqlInstances.map((i) =>
            i.projectId === s.projectId && i.name === s.name
              ? { ...i, gceZone: `${s.region}-${next.failovers % 2 ? "b" : "a"}` }
              : i,
          ),
        },
        next,
      );
      return finish(world, baseRecord(world, next));
    }),
  ),
  command(
    path("instances", "clone"),
    api,
    "cloudsql.instances.create",
    clone,
    [Flag.string("point-in-time", "Virtual recovery time.", { required: true })],
    [nameArg("SOURCE"), nameArg("DESTINATION")],
  ),
  command(
    path("backups", "create"),
    api,
    "cloudsql.backupRuns.create",
    backup,
    [instanceFlag, Flag.string("description", "Description."), CommonFlags.async],
    [],
  ),
  command(
    path("backups", "list"),
    api,
    "cloudsql.instances.get",
    (ctx, args) =>
      Result.flatMap(serverArg(ctx, textFlag(args, "instance")), (s) =>
        Result.ok({
          world: ctx.world,
          output: CommandOutput.table(
            World.sqlBackupsOf(ctx.world, s.projectId, s.name).map((b) => ({
              ...SqlBackup.toRecord(b),
              error: "-",
            })),
            [
              Column.create("ID", "id"),
              Column.create("WINDOW_START_TIME", "windowStartTime"),
              Column.create("ERROR", "error"),
              Column.create("STATUS", "status"),
            ],
          ),
        }),
      ),
    [instanceFlag],
    [],
  ),
  command(
    path("backups", "describe"),
    api,
    "cloudsql.backupRuns.get",
    (ctx, args) => {
      const b = ctx.world.sqlBackups.find(
        (b) =>
          b.projectId === ctx.project.projectId &&
          b.instance === textFlag(args, "instance") &&
          b.id === ParsedArgs.requiredPositional(args, 0),
      );
      return b
        ? finish(ctx.world, SqlBackup.toRecord(b))
        : missing("Backup does not belong to this instance.");
    },
    [instanceFlag],
  ),
  command(path("backups", "restore"), api, "cloudsql.backupRuns.get", restore, [
    Flag.string("restore-instance", "Writable restore target.", {
      required: true,
      candidates: candidates("servers", "sql"),
    }),
    Flag.string("backup-instance", "Source instance.", {
      candidates: candidates("servers", "sql"),
    }),
  ]),
  command(["sim", "sql", "checkpoint"], api, "cloudsql.backupRuns.create", checkpoint, [
    Flag.string("timestamp", "Explicit virtual recovery timestamp.", { required: true }),
  ]),
  command(["sim", "sql", "writes", "pause"], api, "cloudsql.instances.update", (ctx, args) =>
    Result.flatMap(serverArg(ctx, ParsedArgs.requiredPositional(args, 0)), (s) =>
      finish(putServer(ctx.world, { ...s, frozen: true }), { writes: "paused" }),
    ),
  ),
  command(["sim", "sql", "writes", "resume"], api, "cloudsql.instances.update", (ctx, args) =>
    Result.flatMap(serverArg(ctx, ParsedArgs.requiredPositional(args, 0)), (s) => {
      const promoted = ctx.world.relational.migrations.some(
        (j) =>
          j.projectId === s.projectId &&
          j.state === "COMPLETED" &&
          ctx.world.relational.profiles.some(
            (p) => p.projectId === s.projectId && p.name === j.source && p.instance === s.name,
          ),
      );
      if (promoted) {
        return invalid("The promoted migration source remains fenced against dual writes.");
      }
      return finish(putServer(ctx.world, { ...s, frozen: false }), { writes: "resumed" });
    }),
  ),
];
