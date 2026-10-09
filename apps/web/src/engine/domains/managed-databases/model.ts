import { Region, Zone } from "@/engine/domains/catalog";
import { ResourceName } from "@/engine/domains/compute";
import {
  type Table,
  tableDecoder,
  validIdentifier,
  validTable,
  validTimestamp,
} from "@/engine/domains/relational/model";
import type { Document } from "@/engine/domains/serverless-lab/model";
import type { World } from "@/engine/domains/world";
import { Decoder as D } from "@/utils/Decoder";
import { Result } from "@/utils/Result";

export type Ref = Readonly<{ projectId: string; name: string }>;
export type Index = Ref &
  Readonly<{ database: string; collection: string; fields: readonly string[] }>;
export type FirestoreCopy = Ref &
  Readonly<{ database: string; location: string; documents: readonly Document[] }>;
export type SpannerInstance = Ref & Readonly<{ config: string; processingUnits: number }>;
export type SpannerDatabase = Ref & Readonly<{ instance: string; tables: readonly Table[] }>;
export type SpannerCopy = SpannerDatabase & Readonly<{ database: string; config: string }>;
export type Family = Readonly<{ name: string; maxVersions: number; maxAgeSeconds: number }>;
export type Cell = Readonly<{
  row: string;
  family: string;
  qualifier: string;
  value: string;
  timestamp: string;
}>;
export type BigtableTable = Readonly<{
  name: string;
  families: readonly Family[];
  cells: readonly Cell[];
}>;
export type Cluster = Readonly<{
  name: string;
  zone: string;
  nodes: number;
  version: number;
  tables: readonly BigtableTable[];
}>;
export type BigtableInstance = Ref &
  Readonly<{ version: number; clusters: readonly Cluster[]; tables: readonly BigtableTable[] }>;
export type BigtableCopy = Ref &
  Readonly<{ instance: string; cluster: string; zone: string; table: BigtableTable }>;
export type CacheEntry = Readonly<{ key: string; value: string; expiresAt: number }>;
export type Cache = Ref &
  Readonly<{
    region: string;
    tier: "BASIC" | "STANDARD_HA";
    failovers: number;
    entries: readonly CacheEntry[];
  }>;
export type Observation = Readonly<{
  projectId: string;
  service: "firestore" | "spanner" | "bigtable" | "redis";
  resource: string;
  operation: string;
  result: string;
}>;
export type Recovery = Readonly<{
  projectId: string;
  service: "firestore" | "spanner" | "bigtable";
  source: string;
  target: string;
  backup: string;
}>;
export type ManagedDatabases = Readonly<{
  indexes: readonly Index[];
  firestoreCopies: readonly FirestoreCopy[];
  spannerInstances: readonly SpannerInstance[];
  spannerDatabases: readonly SpannerDatabase[];
  spannerCopies: readonly SpannerCopy[];
  bigtableInstances: readonly BigtableInstance[];
  bigtableCopies: readonly BigtableCopy[];
  caches: readonly Cache[];
  clock: number;
  observations: readonly Observation[];
  recoveries: readonly Recovery[];
}>;

export const emptyManagedDatabases = (): ManagedDatabases => ({
  indexes: [],
  firestoreCopies: [],
  spannerInstances: [],
  spannerDatabases: [],
  spannerCopies: [],
  bigtableInstances: [],
  bigtableCopies: [],
  caches: [],
  clock: 0,
  observations: [],
  recoveries: [],
});
export const patch = (world: World, changes: Partial<ManagedDatabases>): World => ({
  ...world,
  managedDatabases: { ...world.managedDatabases, ...changes },
});
export const same = (a: Ref, b: Ref): boolean => a.projectId === b.projectId && a.name === b.name;
export const observe = (world: World, observation: Observation): World =>
  patch(world, {
    observations: [...world.managedDatabases.observations, observation].slice(-100),
  });
export const recovered = (world: World, recovery: Recovery): World =>
  patch(world, {
    recoveries: [...world.managedDatabases.recoveries, recovery].slice(-100),
  });
export const firestoreLocations = (): readonly string[] => [...Region.all(), "nam5", "eur3"];
export const validCollection = (value: string): boolean => {
  const parts = value.split("/");
  return value.length <= 500 && parts.length % 2 === 1 && parts.every(validKey);
};
export const validKey = (value: string): boolean =>
  value.length > 0 &&
  value.length <= 500 &&
  ![".", "..", "__proto__", "constructor", "prototype"].includes(value);
export const documentValue = (data: string): Result<Readonly<Record<string, unknown>>, string> => {
  try {
    const value: unknown = JSON.parse(data);
    if (!value || typeof value !== "object" || Array.isArray(value) || data.length > 4096) {
      return Result.err("Expected a JSON object of at most 4096 characters.");
    }
    const safe = (v: unknown): boolean => {
      if (typeof v === "number") {
        return Number.isFinite(v);
      }
      if (!v || typeof v !== "object") {
        return true;
      }
      return Object.entries(v).every(([k, child]) => validKey(k) && safe(child));
    };
    if (!safe(value)) {
      return Result.err("Forbidden document field name.");
    }
    return Result.ok(value as Readonly<Record<string, unknown>>);
  } catch {
    return Result.err("Invalid document JSON.");
  }
};
export const spannerConfigs = (): readonly string[] => [
  ...Region.all().map((r) => `regional-${r}`),
  "nam3",
];
export const validCapacity = (units: number): boolean =>
  Number.isSafeInteger(units) &&
  units >= 100 &&
  units <= 10000 &&
  (units < 1000 ? units % 100 === 0 : units % 1000 === 0);
export const validBtTable = (table: BigtableTable): boolean => {
  const names = table.families.map((f) => f.name);
  if (
    !validIdentifier(table.name) ||
    names.length === 0 ||
    names.length > 20 ||
    new Set(names).size !== names.length ||
    table.cells.length > 1000
  ) {
    return false;
  }
  if (
    !table.families.every(
      (f) =>
        validIdentifier(f.name) &&
        Number.isSafeInteger(f.maxVersions) &&
        f.maxVersions >= 1 &&
        f.maxVersions <= 100 &&
        Number.isSafeInteger(f.maxAgeSeconds) &&
        f.maxAgeSeconds >= 0 &&
        f.maxAgeSeconds <= 31536000,
    )
  ) {
    return false;
  }
  const ids = table.cells.map(
    (c) => `${c.row}/${c.family}/${c.qualifier}/${Date.parse(c.timestamp)}`,
  );
  return (
    new Set(ids).size === ids.length &&
    table.cells.every(
      (c) =>
        validKey(c.row) &&
        !c.row.includes("/") &&
        names.includes(c.family) &&
        validIdentifier(c.qualifier) &&
        c.value.length <= 4096 &&
        validTimestamp(c.timestamp),
    )
  );
};
const ref = { projectId: D.string, name: D.string };
const documentDecoder = D.object<Document>({
  projectId: D.string,
  database: D.string,
  path: D.string,
  data: D.string,
  version: D.number,
});
const btTable = D.object<BigtableTable>({
  name: D.string,
  families: D.array(
    D.object<Family>({ name: D.string, maxVersions: D.number, maxAgeSeconds: D.number }),
  ),
  cells: D.array(
    D.object<Cell>({
      row: D.string,
      family: D.string,
      qualifier: D.string,
      value: D.string,
      timestamp: D.string,
    }),
  ),
});
export const managedDatabasesDecoder = D.object<ManagedDatabases>({
  indexes: D.array(
    D.object<Index>({
      ...ref,
      database: D.string,
      collection: D.string,
      fields: D.array(D.string),
    }),
  ),
  firestoreCopies: D.array(
    D.object<FirestoreCopy>({
      ...ref,
      database: D.string,
      location: D.string,
      documents: D.array(documentDecoder),
    }),
  ),
  spannerInstances: D.array(
    D.object<SpannerInstance>({ ...ref, config: D.string, processingUnits: D.number }),
  ),
  spannerDatabases: D.array(
    D.object<SpannerDatabase>({ ...ref, instance: D.string, tables: D.array(tableDecoder) }),
  ),
  spannerCopies: D.array(
    D.object<SpannerCopy>({
      ...ref,
      instance: D.string,
      database: D.string,
      config: D.string,
      tables: D.array(tableDecoder),
    }),
  ),
  bigtableInstances: D.array(
    D.object<BigtableInstance>({
      ...ref,
      version: D.number,
      tables: D.array(btTable),
      clusters: D.array(
        D.object<Cluster>({
          name: D.string,
          zone: D.string,
          nodes: D.number,
          version: D.number,
          tables: D.array(btTable),
        }),
      ),
    }),
  ),
  bigtableCopies: D.array(
    D.object<BigtableCopy>({
      ...ref,
      instance: D.string,
      cluster: D.string,
      zone: D.string,
      table: btTable,
    }),
  ),
  caches: D.array(
    D.object<Cache>({
      ...ref,
      region: D.string,
      tier: D.literal(["BASIC", "STANDARD_HA"]),
      failovers: D.number,
      entries: D.array(
        D.object<CacheEntry>({ key: D.string, value: D.string, expiresAt: D.number }),
      ),
    }),
  ),
  clock: D.number,
  observations: D.array(
    D.object<Observation>({
      projectId: D.string,
      service: D.literal(["firestore", "spanner", "bigtable", "redis"]),
      resource: D.string,
      operation: D.string,
      result: D.string,
    }),
  ),
  recoveries: D.array(
    D.object<Recovery>({
      projectId: D.string,
      service: D.literal(["firestore", "spanner", "bigtable"]),
      source: D.string,
      target: D.string,
      backup: D.string,
    }),
  ),
});

export const validateManagedDatabases = (world: World): Result<World, string> => {
  const m = world.managedDatabases;
  const exists = (p: string) => world.projects.some((v) => v.projectId === p);
  const unique = (ids: readonly string[]) => new Set(ids).size === ids.length;
  const invalid = (reason: string) => Result.err(reason);
  for (const key of [
    "indexes",
    "firestoreCopies",
    "spannerInstances",
    "spannerDatabases",
    "spannerCopies",
    "bigtableInstances",
    "bigtableCopies",
    "caches",
  ] as const) {
    const resources = m[key];
    const ids = resources.map(
      (r) =>
        `${r.projectId}/${"cluster" in r ? r.cluster : ""}/${"instance" in r ? r.instance : ""}/${"region" in r ? r.region : ""}/${"database" in r && key === "indexes" ? r.database : ""}/${r.name}`,
    );
    if (
      resources.length > 200 ||
      !unique(ids) ||
      resources.some((r) => !exists(r.projectId) || !ResourceName.parse(r.name).ok)
    ) {
      return invalid(`Invalid or duplicate ${key}.`);
    }
  }
  for (const i of m.indexes) {
    if (
      !world.serverlessLab.databases.some(
        (d) =>
          d.projectId === i.projectId && d.name === i.database && d.mode === "firestore-native",
      ) ||
      !validCollection(i.collection) ||
      i.fields.length < 2 ||
      i.fields.length > 5 ||
      !unique(i.fields) ||
      !i.fields.every(validIdentifier)
    ) {
      return invalid("Invalid Firestore index or database reference.");
    }
  }
  for (const b of m.firestoreCopies) {
    if (
      !firestoreLocations().includes(b.location) ||
      !unique(b.documents.map((d) => d.path)) ||
      b.documents.length > 2000 ||
      b.documents.some(
        (d) =>
          d.projectId !== b.projectId ||
          d.database !== b.database ||
          d.path.split("/").length % 2 !== 0 ||
          !d.path.split("/").every(validKey) ||
          !documentValue(d.data).ok ||
          !Number.isSafeInteger(d.version) ||
          d.version < 1,
      )
    ) {
      return invalid("Invalid Firestore backup.");
    }
  }
  if (
    m.spannerInstances.some(
      (i) => !spannerConfigs().includes(i.config) || !validCapacity(i.processingUnits),
    )
  ) {
    return invalid("Invalid Spanner config/capacity.");
  }
  for (const db of m.spannerDatabases) {
    if (
      !m.spannerInstances.some((i) => i.projectId === db.projectId && i.name === db.instance) ||
      !validIdentifier(db.name) ||
      db.tables.length > 20 ||
      !unique(db.tables.map((t) => t.name)) ||
      !db.tables.every((t) => validTable(t) && t.columns.some((c) => c.primary))
    ) {
      return invalid("Invalid Spanner database/schema.");
    }
  }
  if (
    m.spannerCopies.some(
      (b) =>
        !spannerConfigs().includes(b.config) ||
        b.tables.length > 20 ||
        !unique(b.tables.map((t) => t.name)) ||
        !b.tables.every((t) => validTable(t) && t.columns.some((c) => c.primary)),
    )
  ) {
    return invalid("Invalid Spanner backup.");
  }
  for (const i of m.bigtableInstances) {
    const tables = [i.tables, ...i.clusters.map((c) => c.tables)];
    if (
      !Number.isSafeInteger(i.version) ||
      i.version < 0 ||
      i.clusters.length < 1 ||
      i.clusters.length > 4 ||
      !unique(i.clusters.map((c) => c.name)) ||
      !unique(i.clusters.map((c) => c.zone)) ||
      tables.some(
        (ts) => ts.length > 20 || !unique(ts.map((t) => t.name)) || !ts.every(validBtTable),
      )
    ) {
      return invalid("Invalid Bigtable instance/tables.");
    }
    for (const c of i.clusters) {
      if (
        !ResourceName.parse(c.name).ok ||
        !Zone.parse(c.zone).some ||
        !Number.isSafeInteger(c.nodes) ||
        c.nodes < 1 ||
        c.nodes > 100 ||
        !Number.isSafeInteger(c.version) ||
        c.version < 0 ||
        c.version > i.version ||
        (c.version === i.version && JSON.stringify(c.tables) !== JSON.stringify(i.tables))
      ) {
        return invalid("Invalid Bigtable cluster/replication checkpoint.");
      }
    }
  }
  if (m.bigtableCopies.some((b) => !Zone.parse(b.zone).some || !validBtTable(b.table))) {
    return invalid("Invalid Bigtable backup.");
  }
  if (
    !Number.isSafeInteger(m.clock) ||
    m.clock < 0 ||
    m.clock > 3153600000 ||
    m.observations.length > 100 ||
    m.recoveries.length > 100
  ) {
    return invalid("Invalid database lesson clock/history.");
  }
  for (const c of m.caches) {
    if (
      !world.serverlessLab.redis.some((r) => same(r, c) && r.region === c.region) ||
      !Number.isSafeInteger(c.failovers) ||
      c.failovers < 0 ||
      (c.tier === "BASIC" && c.failovers !== 0) ||
      c.entries.length > 200 ||
      !unique(c.entries.map((e) => e.key)) ||
      c.entries.some(
        (e) =>
          !validKey(e.key) ||
          e.value.length > 4096 ||
          !Number.isSafeInteger(e.expiresAt) ||
          e.expiresAt < 0 ||
          e.expiresAt > 3153686400,
      )
    ) {
      return invalid("Invalid Redis cache/config.");
    }
  }
  if (
    m.observations.some((o) => !exists(o.projectId) || o.result.length > 100000) ||
    m.recoveries.some((r) => !exists(r.projectId))
  ) {
    return invalid("Invalid database lesson history project.");
  }
  return Result.ok(world);
};
