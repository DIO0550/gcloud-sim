import { Region, SqlDatabaseVersion } from "@/engine/domains/catalog";
import { ResourceName } from "@/engine/domains/compute";
import { Ipv4 } from "@/engine/domains/gke-control-plane";
import type { World } from "@/engine/domains/world";
import { Decoder as D } from "@/utils/Decoder";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

export type Kind = "sql" | "alloy";
export type Ref = Readonly<{ projectId: string; kind: Kind; name: string }>;
export type Server = Ref &
  Readonly<{
    region: string;
    engine: string;
    network: string;
    publicIp: boolean;
    authorizedNetworks: readonly string[];
    availability: "ZONAL" | "REGIONAL";
    master: string;
    pitr: boolean;
    frozen: boolean;
    failovers: number;
  }>;
export type Cell = string | number | readonly number[];
export type Column = Readonly<{
  name: string;
  type: "integer" | "text" | "vector";
  primary: boolean;
  required: boolean;
}>;
export type Table = Readonly<{
  name: string;
  columns: readonly Column[];
  rows: readonly Readonly<Record<string, Cell>>[];
}>;
export type Database = Readonly<{
  projectId: string;
  kind: Kind;
  server: string;
  name: string;
  vector: boolean;
  tables: readonly Table[];
}>;
export type User = Readonly<{
  projectId: string;
  kind: Kind;
  server: string;
  name: string;
  role: "reader" | "writer";
}>;
export type AlloyInstance = Readonly<{
  projectId: string;
  name: string;
  cluster: string;
  region: string;
  type: "PRIMARY" | "READ_POOL";
  nodes: number;
}>;
export type Copy = Readonly<{
  projectId: string;
  name: string;
  kind: Kind;
  source: string;
  region: string;
  engine: string;
  type: "BACKUP" | "POINT" | "EXPORT";
  timestamp: string;
  token: string;
  databases: readonly Database[];
}>;
export type Profile = Readonly<{
  projectId: string;
  name: string;
  region: string;
  instance: string;
  user: string;
  network: string;
}>;
export type Migration = Readonly<{
  projectId: string;
  name: string;
  region: string;
  source: string;
  destination: string;
  state: "DRAFT" | "RUNNING" | "STOPPED" | "COMPLETED";
  phase: "NONE" | "INITIAL_COPY" | "CDC" | "PROMOTED";
  tested: boolean;
  copies: number;
}>;
export type Query = Readonly<{
  projectId: string;
  kind: Kind;
  server: string;
  database: string;
  user: string;
  mode: string;
  endpoint: string;
  transaction: "NONE" | "COMMIT" | "ROLLBACK";
  rows: readonly Readonly<Record<string, Cell>>[];
  affected: number;
}>;
export type Recovery = Readonly<{
  projectId: string;
  kind: Kind;
  target: string;
  source: string;
  copy: string;
  type: "BACKUP" | "POINT" | "IMPORT";
}>;
export const recordRecovery = (world: World, recovery: Recovery): World => ({
  ...world,
  relational: {
    ...world.relational,
    recoveries: [...world.relational.recoveries, recovery].slice(-100),
  },
});
export type RelationalLab = Readonly<{
  servers: readonly Server[];
  databases: readonly Database[];
  users: readonly User[];
  alloyInstances: readonly AlloyInstance[];
  copies: readonly Copy[];
  profiles: readonly Profile[];
  migrations: readonly Migration[];
  queries: readonly Query[];
  recoveries: readonly Recovery[];
  decisions: Readonly<Record<string, string>>;
}>;
export const emptyRelational = (): RelationalLab => ({
  servers: [],
  databases: [],
  users: [],
  alloyInstances: [],
  copies: [],
  profiles: [],
  migrations: [],
  queries: [],
  recoveries: [],
  decisions: {},
});
export const sameRef = (a: Ref, b: Ref): boolean =>
  a.projectId === b.projectId && a.kind === b.kind && a.name === b.name;
export const findServer = (world: World, ref: Ref): Server | undefined =>
  world.relational.servers.find((s) => sameRef(s, ref));
export const putServer = (world: World, server: Server): World => ({
  ...world,
  relational: {
    ...world.relational,
    servers: [...world.relational.servers.filter((s) => !sameRef(s, server)), server],
  },
});
export const databasesOf = (world: World, server: Ref): readonly Database[] =>
  world.relational.databases.filter(
    (d) => d.projectId === server.projectId && d.kind === server.kind && d.server === server.name,
  );
export const replaceData = (world: World, server: Ref, databases: readonly Database[]): World => ({
  ...world,
  relational: {
    ...world.relational,
    databases: [
      ...world.relational.databases.filter(
        (d) =>
          !(d.projectId === server.projectId && d.kind === server.kind && d.server === server.name),
      ),
      ...databases.map((d) => ({
        ...d,
        projectId: server.projectId,
        kind: server.kind,
        server: server.name,
      })),
    ],
  },
});
export const defaultServer = (ref: Ref, region: string, engine: string): Server => ({
  ...ref,
  region,
  engine,
  network: "",
  publicIp: ref.kind === "sql",
  authorizedNetworks: [],
  availability: ref.kind === "alloy" ? "REGIONAL" : "ZONAL",
  master: "",
  pitr: false,
  frozen: false,
  failovers: 0,
});
export const defaultUser = (server: Server): User => ({
  projectId: server.projectId,
  kind: server.kind,
  server: server.name,
  name: server.engine.startsWith("MYSQL") ? "root" : "postgres",
  role: "writer",
});
export const syncReplicas = (world: World, source: Server): World =>
  world.relational.servers
    .filter((s) => s.projectId === source.projectId && s.kind === "sql" && s.master === source.name)
    .reduce((w, replica) => replaceData(w, replica, databasesOf(w, source)), world);
export const validTimestamp = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().replace(".000Z", "Z") === value.replace(".000Z", "Z");
export const validIdentifier = (text: string): boolean =>
  /^[a-z][a-z0-9_]{0,62}$/.test(text) && !["constructor", "prototype", "__proto__"].includes(text);
export const validCell = (cell: unknown, column: Column): boolean => {
  if (column.type === "text") {
    return typeof cell === "string" && cell.length <= 4096;
  }
  if (column.type === "integer") {
    return typeof cell === "number" && Number.isSafeInteger(cell);
  }
  return (
    Array.isArray(cell) &&
    cell.length === 3 &&
    cell.every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1000000) &&
    cell.some((n) => n !== 0)
  );
};
export const validTable = (t: Table): boolean => {
  const names = t.columns.map((c) => c.name);
  const primary = t.columns.find((c) => c.primary);
  if (
    !validIdentifier(t.name) ||
    names.length === 0 ||
    names.length > 20 ||
    new Set(names).size !== names.length ||
    t.rows.length > 200 ||
    t.columns.filter((c) => c.primary).length > 1 ||
    names.some((n) => !validIdentifier(n))
  ) {
    return false;
  }
  if (
    !t.rows.every(
      (row) =>
        Object.keys(row).length === names.length &&
        t.columns.every((c) => validCell(row[c.name], c)),
    )
  ) {
    return false;
  }
  return (
    !primary ||
    new Set(t.rows.map((row) => JSON.stringify(row[primary.name]))).size === t.rows.length
  );
};
const integer = D.map(D.number, (n) =>
  Number.isSafeInteger(n) && n >= 0
    ? Result.ok(n)
    : Result.err("Expected non-negative safe integer."),
);
const kind = D.literal(["sql", "alloy"] as const);
const name = D.validated(ResourceName.parse);
const region = D.parsed(Region.parse, "region");
const identifier = D.map(D.string, (v) =>
  validIdentifier(v) ? Result.ok(v) : Result.err("Invalid SQL identifier."),
);
const cell: D<Cell> = (v, path) => {
  if (typeof v === "string" || (typeof v === "number" && Number.isFinite(v))) {
    return Result.ok(v);
  }
  return D.array(D.number)(v, path);
};
const row = D.record(cell);
const table = D.map(
  D.object<Table>({
    name: identifier,
    columns: D.array(
      D.object<Column>({
        name: identifier,
        type: D.literal(["integer", "text", "vector"]),
        primary: D.boolean,
        required: D.boolean,
      }),
    ),
    rows: D.array(row),
  }),
  (v) => (validTable(v) ? Result.ok(v) : Result.err("Invalid table schema or rows.")),
);
const database = D.object<Database>({
  projectId: D.string,
  kind,
  server: name,
  name: identifier,
  vector: D.boolean,
  tables: D.array(table),
});
export const relationalDecoder = D.object<RelationalLab>({
  servers: D.array(
    D.object<Server>({
      projectId: D.string,
      kind,
      name,
      region,
      engine: D.parsed(SqlDatabaseVersion.parse, "SQL engine"),
      network: D.string,
      publicIp: D.boolean,
      authorizedNetworks: D.array(
        D.map(D.string, (v) =>
          Option.isSome(Ipv4.range(v)) ? Result.ok(v) : Result.err("Invalid CIDR."),
        ),
      ),
      availability: D.literal(["ZONAL", "REGIONAL"]),
      master: D.string,
      pitr: D.boolean,
      frozen: D.boolean,
      failovers: integer,
    }),
  ),
  databases: D.array(database),
  users: D.array(
    D.object<User>({
      projectId: D.string,
      kind,
      server: name,
      name: identifier,
      role: D.literal(["reader", "writer"]),
    }),
  ),
  alloyInstances: D.array(
    D.object<AlloyInstance>({
      projectId: D.string,
      name,
      cluster: name,
      region,
      type: D.literal(["PRIMARY", "READ_POOL"]),
      nodes: integer,
    }),
  ),
  copies: D.array(
    D.object<Copy>({
      projectId: D.string,
      name: D.string,
      kind,
      source: name,
      region,
      engine: D.parsed(SqlDatabaseVersion.parse, "SQL engine"),
      type: D.literal(["BACKUP", "POINT", "EXPORT"]),
      timestamp: D.string,
      token: D.string,
      databases: D.array(database),
    }),
  ),
  profiles: D.array(
    D.object<Profile>({
      projectId: D.string,
      name,
      region,
      instance: name,
      user: identifier,
      network: name,
    }),
  ),
  migrations: D.array(
    D.object<Migration>({
      projectId: D.string,
      name,
      region,
      source: name,
      destination: name,
      state: D.literal(["DRAFT", "RUNNING", "STOPPED", "COMPLETED"]),
      phase: D.literal(["NONE", "INITIAL_COPY", "CDC", "PROMOTED"]),
      tested: D.boolean,
      copies: integer,
    }),
  ),
  queries: D.array(
    D.object<Query>({
      projectId: D.string,
      kind,
      server: name,
      database: identifier,
      user: identifier,
      mode: D.literal(["proxy", "private", "public"]),
      endpoint: D.string,
      transaction: D.literal(["NONE", "COMMIT", "ROLLBACK"]),
      rows: D.array(row),
      affected: integer,
    }),
  ),
  recoveries: D.array(
    D.object<Recovery>({
      projectId: D.string,
      kind,
      target: name,
      source: name,
      copy: D.string,
      type: D.literal(["BACKUP", "POINT", "IMPORT"]),
    }),
  ),
  decisions: D.record(D.string),
});
export const validateRelational = (world: World): Result<World, string> => {
  const lab = world.relational;
  if (
    world.sqlBackups.some(
      (b) => !world.sqlInstances.some((i) => i.projectId === b.projectId && i.name === b.instance),
    )
  ) {
    return Result.err("backup belongs to a missing Cloud SQL instance");
  }
  const unique = (values: readonly string[]) => new Set(values).size === values.length;
  const parent = (v: { projectId: string; kind: Kind; server: string }) =>
    findServer(world, { projectId: v.projectId, kind: v.kind, name: v.server });
  for (const key of [
    "servers",
    "databases",
    "users",
    "alloyInstances",
    "copies",
    "profiles",
    "migrations",
  ] as const) {
    const ids = lab[key].map((v) =>
      JSON.stringify([
        v.projectId,
        "kind" in v ? v.kind : "",
        "server" in v ? v.server : "",
        "cluster" in v ? v.cluster : "",
        "type" in v && key === "copies" ? v.type : "",
        v.name,
      ]),
    );
    if (!unique(ids) || lab[key].length > 500) {
      return Result.err(`Invalid relational collection: ${key}.`);
    }
  }
  if (lab.queries.length > 100 || lab.recoveries.length > 100) {
    return Result.err("Too many query records.");
  }
  for (const s of lab.servers) {
    if (!world.projects.some((p) => p.projectId === s.projectId) || s.failovers < 0) {
      return Result.err("Invalid database project or failovers.");
    }
    if (
      s.kind === "sql" &&
      !world.sqlInstances.some(
        (i) =>
          i.projectId === s.projectId &&
          i.name === s.name &&
          i.region === s.region &&
          i.databaseVersion === s.engine,
      )
    ) {
      return Result.err("Missing Cloud SQL base instance.");
    }
    const base = world.sqlInstances.find((i) => i.projectId === s.projectId && i.name === s.name);
    if (s.kind === "sql" && s.availability === "REGIONAL" && !base?.tier.startsWith("db-custom")) {
      return Result.err("HA requires a dedicated tier.");
    }
    if (s.kind === "alloy" && (!s.engine.startsWith("POSTGRES") || !s.network || s.publicIp)) {
      return Result.err("Invalid AlloyDB cluster configuration.");
    }
    if (
      s.network &&
      !world.networks.some((n) => n.projectId === s.projectId && n.name === s.network)
    ) {
      return Result.err("Missing database private network.");
    }
    if (!s.publicIp && !s.network) {
      return Result.err("Database needs public or private connectivity.");
    }
    if (s.master) {
      const m = findServer(world, { projectId: s.projectId, kind: "sql", name: s.master });
      if (
        !m ||
        m.master ||
        m.engine !== s.engine ||
        s.master === s.name ||
        s.availability !== "ZONAL"
      ) {
        return Result.err("Invalid read replica master.");
      }
    }
  }
  if (
    world.sqlInstances.some(
      (i) => !findServer(world, { projectId: i.projectId, kind: "sql", name: i.name }),
    )
  ) {
    return Result.err("Missing Cloud SQL configuration.");
  }
  for (const d of lab.databases) {
    if (
      !parent(d) ||
      !unique(d.tables.map((t) => t.name)) ||
      d.tables.length > 20 ||
      !d.tables.every(validTable) ||
      (d.vector && !parent(d)?.engine.startsWith("POSTGRES"))
    ) {
      return Result.err("Invalid database parent, schema or extension.");
    }
  }
  if (lab.users.some((u) => !parent(u))) {
    return Result.err("Missing database user parent.");
  }
  for (const i of lab.alloyInstances) {
    const s = findServer(world, { projectId: i.projectId, kind: "alloy", name: i.cluster });
    if (
      !s ||
      s.region !== i.region ||
      i.nodes < 1 ||
      i.nodes > 20 ||
      (i.type === "PRIMARY" && i.nodes !== 1) ||
      (i.type === "READ_POOL" &&
        !lab.alloyInstances.some(
          (p) => p.projectId === i.projectId && p.cluster === i.cluster && p.type === "PRIMARY",
        ))
    ) {
      return Result.err("Invalid AlloyDB instance.");
    }
  }
  if (
    !unique(
      lab.alloyInstances
        .filter((i) => i.type === "PRIMARY")
        .map((i) => `${i.projectId}/${i.cluster}`),
    )
  ) {
    return Result.err("Duplicate AlloyDB primary.");
  }
  for (const c of lab.copies) {
    if (
      (c.kind === "sql" &&
        !findServer(world, { projectId: c.projectId, kind: c.kind, name: c.source })) ||
      !world.projects.some((p) => p.projectId === c.projectId) ||
      !validTimestamp(c.timestamp) ||
      !unique(c.databases.map((d) => d.name)) ||
      c.databases.some(
        (d) =>
          d.projectId !== c.projectId ||
          d.kind !== c.kind ||
          d.server !== c.source ||
          !d.tables.every(validTable),
      )
    ) {
      return Result.err("Invalid database copy.");
    }
    if (
      c.type === "BACKUP" &&
      c.kind === "sql" &&
      !world.sqlBackups.some(
        (b) => b.projectId === c.projectId && b.instance === c.source && b.id === c.name,
      )
    ) {
      return Result.err("Missing Cloud SQL backup.");
    }
  }
  for (const p of lab.profiles) {
    const s = findServer(world, { projectId: p.projectId, kind: "sql", name: p.instance });
    if (
      !s?.engine.startsWith("POSTGRES") ||
      s.region !== p.region ||
      s.network !== p.network ||
      !lab.users.some(
        (u) =>
          u.projectId === p.projectId &&
          u.kind === "sql" &&
          u.server === p.instance &&
          u.name === p.user,
      )
    ) {
      return Result.err("Invalid DMS connection profile.");
    }
  }
  const activeDestinations = lab.migrations
    .filter((j) => j.state !== "COMPLETED")
    .map((j) => lab.profiles.find((p) => p.projectId === j.projectId && p.name === j.destination))
    .map((p) => `${p?.projectId}/${p?.instance}`);
  if (!unique(activeDestinations)) {
    return Result.err("Duplicate active migration destination.");
  }
  for (const j of lab.migrations) {
    const profiles = [j.source, j.destination].map((n) =>
      lab.profiles.find(
        (p) => p.projectId === j.projectId && p.region === j.region && p.name === n,
      ),
    );
    if (
      profiles.some((p) => !p) ||
      profiles[0]?.instance === profiles[1]?.instance ||
      j.copies < 0 ||
      (j.state !== "DRAFT" && !j.tested) ||
      (["CDC", "PROMOTED"].includes(j.phase) && j.copies < 1) ||
      (j.state === "COMPLETED" && j.phase !== "PROMOTED") ||
      (j.state === "DRAFT" && j.phase !== "NONE") ||
      ((j.state === "RUNNING" || j.state === "STOPPED") &&
        !["INITIAL_COPY", "CDC"].includes(j.phase))
    ) {
      return Result.err("Invalid DMS migration job.");
    }
  }
  return Result.ok(world);
};
export const migrateRelational = (value: Record<string, unknown>): Record<string, unknown> => {
  const lab = emptyRelational();
  const servers = Array.isArray(value.sqlInstances)
    ? value.sqlInstances.flatMap((i) => {
        if (
          !i ||
          typeof i !== "object" ||
          !("projectId" in i) ||
          !("name" in i) ||
          !("region" in i) ||
          !("databaseVersion" in i)
        ) {
          return [];
        }
        return [
          defaultServer(
            { projectId: String(i.projectId), kind: "sql", name: String(i.name) },
            String(i.region),
            String(i.databaseVersion),
          ),
        ];
      })
    : [];
  const copies = Array.isArray(value.sqlBackups)
    ? value.sqlBackups.flatMap((b) => {
        if (
          !b ||
          typeof b !== "object" ||
          !("instance" in b) ||
          !("projectId" in b) ||
          !("id" in b) ||
          !("windowStartTime" in b)
        ) {
          return [];
        }
        const source = servers.find((s) => s.projectId === b.projectId && s.name === b.instance);
        if (!source) {
          return [];
        }
        return [
          {
            projectId: source.projectId,
            kind: source.kind,
            name: String(b.id),
            source: source.name,
            region: source.region,
            engine: source.engine,
            type: "BACKUP" as const,
            timestamp: String(b.windowStartTime),
            token: "",
            databases: [],
          },
        ];
      })
    : [];
  return { ...value, relational: { ...lab, servers, users: servers.map(defaultUser), copies } };
};
export const sourceIpAllowed = (server: Server, ip: string): boolean =>
  Option.isSome(Ipv4.address(ip)) &&
  server.authorizedNetworks.some((cidr) => Ipv4.contains(cidr, ip));
