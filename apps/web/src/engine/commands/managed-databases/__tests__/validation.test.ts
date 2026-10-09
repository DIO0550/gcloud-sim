// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { Now, run, type Session, session } from "@/engine/__tests__/setup";
import { cacheOf } from "@/engine/domains/managed-databases/cache";
import { emptyManagedDatabases } from "@/engine/domains/managed-databases/model";
import { RoleCatalog } from "@/engine/domains/role-catalog";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import {
  type ManagedDatabaseLesson,
  ManagedDatabasePrelude,
  ManagedDatabaseSolutions,
  managedDatabaseSatisfied,
} from "@/engine/missions/managed-databases";
import { Snapshot } from "@/engine/snapshot";

const p = F.devProjectId;
const ready = (...lines: readonly string[]) => {
  let s = run(session(), ...ManagedDatabasePrelude);
  for (const line of lines) {
    s = run(s, line);
    expect(s.text, line).not.toContain("ERROR:");
  }
  return s;
};
const lesson = (key: ManagedDatabaseLesson, end?: number) =>
  ready(...ManagedDatabaseSolutions[key].slice(0, end));
const rejected = (s: Session, line: string, reason = "") => {
  const next = run(s, line);
  expect(next.text, line).toContain("ERROR:");
  expect(next.text.toLowerCase(), line).toContain(reason.toLowerCase());
  expect(next.world, line).toEqual(s.world);
};
const noApi = (s: Session, api: string) =>
  session({
    ...s.world,
    projects: s.world.projects.map((v) =>
      v.projectId === p ? { ...v, enabledApis: v.enabledApis.filter((a) => a !== api) } : v,
    ),
  });

test("Firestore composite index controls filter/sort and excludes other tenants", () => {
  const s = lesson("index", 4);
  const query = `sim firestore query orders --database=index-app --where-field=tenant --equals='"a"' --order-by=total --descending`;
  rejected(s, query, "index");
  const done = run(s, ManagedDatabaseSolutions.index[4] ?? "", query);
  expect(done.text).toContain("total: 20");
  const rows = JSON.parse(
    done.world.managedDatabases.observations.at(-1)?.result ?? "{}",
  ).documents;
  expect(rows.map((v: { path: string }) => v.path)).toEqual(["orders/two", "orders/one"]);
  const removed = run(
    done,
    "sim firestore indexes delete tenant-total --database=index-app --quiet",
  );
  rejected(removed, query, "index");
});
test("Firestore query validates location, limit, mode and unsupported filter values", () => {
  const s = lesson("document");
  rejected(s, "sim firestore query orders --database=doc-app --location=us-central1", "location");
  rejected(s, "sim firestore query orders --database=doc-app --limit=0", "limit");
  rejected(s, "sim firestore query orders --database=doc-app --where-field=count", "both");
  rejected(
    s,
    "sim firestore query orders --database=doc-app --where-field=count --equals='{}'",
    "scalar",
  );
  const datastore = ready(
    "gcloud firestore databases create datastore-db --location=us-central1 --type=datastore-mode",
  );
  rejected(datastore, "sim firestore query orders --database=datastore-db", "Native");
});
test("Firestore transaction version conflicts never modify documents or emit events", () => {
  const s = lesson("document", 2);
  const before = s.world.serverlessLab.events.length;
  rejected(
    s,
    "sim firestore documents increment orders/one --database=doc-app --field=count --expected-version=2",
    "conflict",
  );
  const next = run(
    s,
    "sim firestore documents increment orders/one --database=doc-app --field=count --amount=-1 --expected-version=1",
  );
  expect(next.world.serverlessLab.documents[0]?.data).toBe('{"count":0}');
  expect(next.world.serverlessLab.events.length).toBeGreaterThan(before);
  rejected(
    next,
    "sim firestore documents increment orders/one --database=doc-app --field=count --expected-version=1",
    "conflict",
  );
});
test("Firestore data rejects malformed, oversized and forbidden JSON without mutation", () => {
  const s = lesson("document", 1);
  for (const data of [
    "[]",
    '{"nested":{"__proto__":1}}',
    "not-json",
    JSON.stringify({ value: "x".repeat(4096) }),
  ]) {
    rejected(s, `sim firestore documents write orders/one --database=doc-app --data='${data}'`);
  }
});
test("Firestore backup is immutable, project/location scoped and survives source deletion", () => {
  let s = lesson("firestoreRestore", 4);
  rejected(
    s,
    "sim firestore backups restore docs-copy --destination-database=recovered-docs --location=asia-northeast1",
    "location",
  );
  rejected(s, "sim firestore backups restore docs-copy --destination-database=source-docs", "new");
  s = run(s, "gcloud firestore databases delete source-docs --location=us-central1 --quiet");
  expect(s.text).not.toContain("ERROR:");
  s = run(s, "sim firestore backups restore docs-copy --destination-database=recovered-docs");
  expect(s.world.serverlessLab.documents.find((d) => d.database === "recovered-docs")?.data).toBe(
    '{"note":"before"}',
  );
  rejected(
    s,
    "sim firestore backups restore docs-copy --project=ace-prod-01 --destination-database=other-docs",
  );
});
test("Firestore viewer can query but cannot mutate data or create indexes", () => {
  const s = run(
    lesson("index"),
    "gcloud auth login reader@example.com",
    `gcloud projects add-iam-policy-binding ${p} --member=user:reader@example.com --role=roles/datastore.viewer --account=${F.owner}`,
  );
  expect(run(s, "sim firestore query orders --database=index-app").text).not.toContain("ERROR:");
  rejected(
    s,
    "sim firestore documents write orders/one --database=index-app --data='{}'",
    "permission",
  );
  rejected(
    s,
    "sim firestore indexes create forbidden --database=index-app --collection=orders --fields=tenant,total",
    "permission",
  );
});
test("Spanner preserves GoogleSQL data and refuses unsupported statements atomically", () => {
  const s = lesson("spanner");
  const q = (sql: string) => `sim spanner execute app --instance=global-app --sql="${sql}"`;
  rejected(s, q("INSERT INTO orders VALUES (1, 'duplicate')"), "primary");
  rejected(s, q("UPDATE orders SET missing = 'x' WHERE id = 1"), "unknown");
  rejected(s, q("DELETE FROM orders; DROP TABLE orders"), "one statement");
  rejected(s, q("SELECT * FROM orders WHERE id > 0"), "equality");
  rejected(
    s,
    "gcloud spanner databases create bad --instance=global-app --ddl='CREATE TABLE broken (id INT64)'",
    "primary",
  );
  const next = run(
    s,
    q("UPDATE orders SET note = 'INT64 ARRAY<FLOAT64>' WHERE id = 1"),
    q("SELECT * FROM orders"),
  );
  expect(next.text).toContain("INT64 ARRAY<FLOAT64>");
});
test("Spanner capacity/config updates and instance dependencies are enforced", () => {
  const s = lesson("spanner");
  for (const units of [0, 150, 1100, 11000]) {
    rejected(
      s,
      `gcloud spanner instances update global-app --processing-units=${units}`,
      "capacity",
    );
  }
  rejected(
    s,
    "gcloud spanner instances update global-app --nodes=1 --processing-units=1000",
    "exactly",
  );
  rejected(
    s,
    "gcloud spanner instances update global-app --config=regional-us-central1 --nodes=1",
    "immutable",
  );
  rejected(s, "gcloud spanner instances delete global-app --quiet", "databases");
  rejected(s, "gcloud spanner instances create other --config=arbitrary", "config");
});
test("Spanner restore validates backup affiliation and config; primary key/schema are preserved", () => {
  const s = lesson("spannerRestore");
  rejected(
    s,
    "gcloud spanner databases restore other --instance=restore-spanner --backup=spanner-copy --backup-instance=wrong",
    "source",
  );
  const incompatible = run(s, "gcloud spanner instances create other --config=nam3");
  rejected(
    incompatible,
    "gcloud spanner databases restore recovered --instance=other --backup=spanner-copy --backup-instance=restore-spanner",
    "compatible",
  );
  rejected(
    s,
    "gcloud spanner databases restore recovered --instance=restore-spanner --backup=spanner-copy",
    "new",
  );
  expect(s.world.managedDatabases.spannerCopies[0]?.tables[0]?.rows[0]?.note).toBe("before");
});
test("Spanner database reader cannot mutate or change schemas", () => {
  const s = run(
    lesson("spanner"),
    "gcloud auth login reader@example.com",
    `gcloud projects add-iam-policy-binding ${p} --member=user:reader@example.com --role=roles/spanner.databaseReader --account=${F.owner}`,
  );
  expect(
    run(
      s,
      "gcloud spanner databases execute-sql app --instance=global-app --sql='SELECT * FROM orders'",
    ).text,
  ).toContain("committed");
  rejected(
    s,
    "sim spanner execute app --instance=global-app --sql='DELETE FROM orders'",
    "permission",
  );
  rejected(
    s,
    "gcloud spanner databases execute-sql app --instance=global-app --sql='DELETE FROM orders'",
    "read-only",
  );
  rejected(
    s,
    "gcloud spanner databases ddl update app --instance=global-app --ddl='CREATE TABLE other (id INT64) PRIMARY KEY (id)'",
    "permission",
  );
});
test("Spanner vector search computes cosine rank and rejects zero/malformed dimensions", () => {
  const s = lesson("vector");
  const rows = JSON.parse(s.world.managedDatabases.observations.at(-1)?.result ?? "{}").rows;
  expect(rows.map((r: { id: number }) => r.id)).toEqual([1, 2]);
  expect(rows[1].distance).toBeCloseTo(1 - 4 / Math.sqrt(17), 8);
  for (const vector of ["[0,0,0]", "[1,0]", "[1,,0]"]) {
    rejected(
      s,
      `sim spanner execute app --instance=vector-spanner --sql="INSERT INTO items VALUES (4, 'bad', ${vector})"`,
    );
  }
});
test("Bigtable secondary is stale before explicit replication and rejects stale writes", () => {
  const s = lesson("bigtableReplication", 4);
  const read =
    "sim bigtable rows read sensor-1 --instance=replicated --cluster=secondary --table=readings";
  const stale = run(s, read);
  expect(stale.text).toContain("caughtUp: false");
  expect(stale.text).toContain("cells: []");
  expect(managedDatabaseSatisfied(stale.world, "bigtableReplication")).toBe(false);
  rejected(
    stale,
    "sim bigtable rows write sensor-1 --instance=replicated --cluster=secondary --table=readings --family=data --qualifier=value --value=lost --timestamp=2026-10-01T11:00:00Z",
    "stale",
  );
  rejected(
    stale,
    "gcloud bigtable clusters delete primary --instance=replicated --quiet",
    "caught-up",
  );
  const synced = run(stale, "sim bigtable replication advance --instance=replicated", read);
  expect(synced.text).toContain("replicated");
});
test("Bigtable row scan uses prefix and latest version; invalid family/timestamps never mutate", () => {
  const s = lesson("bigtableGc", 4);
  const prefix =
    "sim bigtable rows scan --instance=telemetry --cluster=primary --table=readings --prefix=sensor";
  const read = run(s, prefix);
  expect(read.text).toContain("latest");
  expect(read.text).not.toContain("value: old");
  expect(read.text).toContain("versionCount: 2");
  const line =
    "sim bigtable rows write sensor-1 --instance=telemetry --cluster=primary --table=readings --family=missing --qualifier=value --value=wrong --timestamp=2026-10-01T10:00:00Z";
  rejected(s, line, "family");
  rejected(
    s,
    line.replace("family=missing", "family=data").replace("2026-10-01", "2026-02-30"),
    "UTC",
  );
  rejected(
    s,
    "gcloud bigtable clusters create bad --instance=telemetry --zone=us-central1-a",
    "different zone",
  );
});
test("Bigtable GC honors both version and age conditions at the explicit boundary", () => {
  const s = lesson("bigtableGc");
  rejected(
    s,
    "sim bigtable gc readings --instance=telemetry --cluster=primary --at=2026-10-01T10:00:00Z",
    "after",
  );
  const expired = run(
    s,
    "sim bigtable gc readings --instance=telemetry --cluster=primary --at=2026-10-01T11:10:00Z",
  );
  expect(expired.world.managedDatabases.bigtableInstances[0]?.tables[0]?.cells).toEqual([]);
});
test("Bigtable backup survives later writes and validates source/target region", () => {
  const s = lesson("bigtableRestore");
  expect(s.world.managedDatabases.bigtableCopies[0]?.table.cells[0]?.value).toBe("before");
  rejected(
    s,
    "sim bigtable backups restore bt-copy --instance=restore-bigtable --cluster=primary --table=recovered",
    "new",
  );
  const other = run(
    s,
    "gcloud bigtable instances create other --cluster=target --cluster-zone=asia-northeast1-a",
  );
  rejected(
    other,
    "sim bigtable backups restore bt-copy --instance=other --cluster=target --backup-instance=restore-bigtable --backup-cluster=primary --table=restored",
    "region",
  );
  rejected(s, "gcloud bigtable clusters delete primary --instance=restore-bigtable --quiet", "one");
});
test("Bigtable reader cannot write, run GC or change replication", () => {
  const s = run(
    lesson("bigtableGc"),
    "gcloud auth login reader@example.com",
    `gcloud projects add-iam-policy-binding ${p} --member=user:reader@example.com --role=roles/bigtable.reader --account=${F.owner}`,
  );
  expect(
    run(
      s,
      "sim bigtable rows read sensor-1 --instance=telemetry --cluster=primary --table=readings",
    ).text,
  ).toContain("latest");
  rejected(
    s,
    "sim bigtable rows delete sensor-1 --instance=telemetry --cluster=primary --table=readings --quiet",
    "permission",
  );
  rejected(
    s,
    "sim bigtable gc readings --instance=telemetry --cluster=primary --at=2026-10-01T11:10:00Z",
    "permission",
  );
  rejected(s, "sim bigtable replication advance --instance=telemetry", "permission");
});
test("Redis private connection requires matching project, region and authorized VPC", () => {
  const s = lesson("redisHa");
  const line =
    "sim redis cache get visits --instance=ha-cache --region=us-central1 --network=default";
  rejected(s, line.replace("network=default", "network=other"), "VPC");
  rejected(s, line.replace("region=us-central1", "region=asia-northeast1"), "region");
  rejected(s, `${line} --project=ace-prod-01`, "project");
  rejected(s, "gcloud redis instances create bad --region=us-central1 --network=missing", "VPC");
});
test("Redis TTL uses explicit time; INCR preserves TTL and SET overwrites it", () => {
  let s = lesson("redisTtl", 2);
  const base = "visits --instance=ttl-cache --region=us-central1 --network=default";
  s = run(s, `sim redis cache increment ${base}`);
  const r = s.world.serverlessLab.redis[0];
  if (!r) {
    throw new Error("Missing Redis instance");
  }
  expect(cacheOf(s.world, r).entries[0]?.expiresAt).toBe(10);
  s = run(
    s,
    `sim redis cache set ${base} --value=3`,
    "sim databases time advance --seconds=10",
    `sim redis cache get ${base}`,
  );
  expect(JSON.parse(s.world.managedDatabases.observations.at(-1)?.result ?? "{}").value).toBe("3");
  expect(cacheOf(s.world, r).entries[0]?.expiresAt).toBe(0);
  rejected(s, `sim redis cache set ${base} --value=x --ttl=-1`, "TTL");
  const textValue = run(s, `sim redis cache set ${base} --value=not-a-number`);
  rejected(textValue, `sim redis cache increment ${base}`, "integer");
});
test("Redis BASIC cannot fail over; HA keeps endpoint and exercises current data", () => {
  const basic = lesson("redisTtl", 1);
  rejected(basic, "gcloud redis instances failover ttl-cache --region=us-central1", "STANDARD_HA");
  const ha = lesson("redisHa");
  expect(ha.world.serverlessLab.redis[0]?.host).toBe("10.200.0.1");
  expect(ha.world.managedDatabases.caches[0]?.failovers).toBe(1);
  const deleted = run(ha, "gcloud redis instances delete ha-cache --region=us-central1 --quiet");
  expect(deleted.world.managedDatabases.caches).toEqual([]);
  expect(Snapshot.fromUnknown(Snapshot.create(deleted.world, Now))).toMatchObject({ ok: true });
});
test("Functions reads real Firestore data using runtime SA and rechecks revoked permissions", () => {
  const s = lesson("functionsFirestore");
  const call =
    "sim functions database read document-reader --region=us-central1 --document=orders/one";
  const sa = `database-worker@${p}.iam.gserviceaccount.com`;
  const revoked = run(
    s,
    `gcloud projects remove-iam-policy-binding ${p} --member=serviceAccount:${sa} --role=roles/datastore.viewer`,
  );
  rejected(revoked, call, "Runtime SA");
  rejected(noApi(s, "firestore.googleapis.com"), call, "API");
  rejected(s, call.replace("orders/one", "orders/missing"), "document");
});
test("Functions Redis handler mutates the cache; wrong connector blocks effects", () => {
  const s = lesson("functionsRedis");
  const call =
    "sim functions database increment-cache cache-counter --region=us-central1 --key=visits";
  const bad = run(
    s,
    "gcloud functions deploy cache-counter --region=us-central1 --vpc-connector=''",
  );
  rejected(bad, call, "connector");
  rejected(noApi(s, "redis.googleapis.com"), call, "API");
  expect(s.world.managedDatabases.caches[0]?.entries[0]?.value).toBe("2");
});
test("Functions data handler follows serving revision rather than non-serving latest revision", () => {
  const s = lesson("functionsFirestore");
  const next = run(
    s,
    "gcloud functions deploy document-reader --region=us-central1 --update-env-vars=FIRESTORE_DATABASE=missing",
  );
  expect(next.text).not.toContain("ERROR:");
  const previousTraffic = session({
    ...next.world,
    serverlessLab: {
      ...next.world.serverlessLab,
      deployments: next.world.serverlessLab.deployments.map((d) =>
        d.name === "document-reader" ? { ...d, traffic: { [d.revisions[0]?.name ?? ""]: 100 } } : d,
      ),
    },
  });
  expect(
    run(
      previousTraffic,
      "sim functions database read document-reader --region=us-central1 --document=orders/one",
    ).text,
  ).toContain("runtime-read");
});
test("Missing database APIs and caller permissions block operations without changes", () => {
  const fs = lesson("document");
  rejected(
    noApi(fs, "firestore.googleapis.com"),
    "sim firestore query orders --database=doc-app",
    "API",
  );
  const sp = lesson("spanner");
  rejected(
    noApi(sp, "spanner.googleapis.com"),
    "sim spanner execute app --instance=global-app --sql='SELECT * FROM orders'",
    "API",
  );
  const bt = lesson("bigtableGc");
  rejected(
    noApi(bt, "bigtable.googleapis.com"),
    "sim bigtable rows read sensor-1 --instance=telemetry --cluster=primary --table=readings",
    "API",
  );
  rejected(
    noApi(bt, "bigtableadmin.googleapis.com"),
    "gcloud bigtable clusters list --instance=telemetry",
    "API",
  );
  const r = lesson("redisHa");
  rejected(
    noApi(r, "redis.googleapis.com"),
    "sim redis cache get visits --instance=ha-cache --region=us-central1 --network=default",
    "API",
  );
});
test("v33 migration keeps serverless Firestore/Redis data and defaults new state", () => {
  const s = lesson("functionsRedis");
  const old = JSON.parse(JSON.stringify(Snapshot.create(s.world, Now)));
  old.schemaVersion = 33;
  delete old.world.managedDatabases;
  const decoded = Snapshot.fromUnknown(old);
  if (!decoded.ok) {
    throw new Error(JSON.stringify(decoded.error));
  }
  expect(decoded.value.serverlessLab).toEqual(s.world.serverlessLab);
  expect(decoded.value.managedDatabases).toEqual(emptyManagedDatabases());
});
test("Snapshot rejects malformed capacity, references, duplicate families, clocks and timestamps", () => {
  const s = ready(
    ...ManagedDatabaseSolutions.spanner,
    ...ManagedDatabaseSolutions.bigtableGc,
    ...ManagedDatabaseSolutions.redisHa,
    ...ManagedDatabaseSolutions.index,
  );
  const raw = () => JSON.parse(JSON.stringify(Snapshot.create(s.world, Now)));
  const variants = [
    (v: ReturnType<typeof raw>) => {
      v.world.managedDatabases.spannerInstances[0].processingUnits = 150;
    },
    (v: ReturnType<typeof raw>) => {
      v.world.managedDatabases.spannerDatabases[0].instance = "missing";
    },
    (v: ReturnType<typeof raw>) => {
      v.world.managedDatabases.bigtableInstances[0].clusters[0].version = 1000;
    },
    (v: ReturnType<typeof raw>) => {
      v.world.managedDatabases.bigtableInstances[0].tables[0].families.push(
        v.world.managedDatabases.bigtableInstances[0].tables[0].families[0],
      );
    },
    (v: ReturnType<typeof raw>) => {
      v.world.managedDatabases.bigtableInstances[0].tables[0].cells[0].timestamp =
        "2026-02-30T10:00:00Z";
    },
    (v: ReturnType<typeof raw>) => {
      v.world.managedDatabases.caches[0].region = "us-east1";
    },
    (v: ReturnType<typeof raw>) => {
      v.world.managedDatabases.clock = -1;
    },
    (v: ReturnType<typeof raw>) => {
      v.world.managedDatabases.indexes[0].database = "missing";
    },
  ];
  for (const change of variants) {
    const snapshot = raw();
    change(snapshot);
    expect(() => Snapshot.fromUnknown(snapshot)).not.toThrow();
    expect(Snapshot.fromUnknown(snapshot)).toMatchObject({ ok: false });
  }
});
test("Service selection rejects unknown scenarios and wrong choices cannot complete mission", () => {
  let s = ready();
  rejected(s, "sim databases choose arbitrary --service=firestore", "Unknown");
  s = run(
    s,
    ...ManagedDatabaseSolutions.selection.slice(0, 3),
    "sim databases choose global-transactions --service=bigtable",
  );
  expect(managedDatabaseSatisfied(s.world, "selection")).toBe(false);
  expect(RoleCatalog.isKnownPermission("spanner.databases.write")).toBe(true);
  expect(RoleCatalog.isKnownPermission("datastore.entities.list")).toBe(true);
});
test("CLI help and project-scoped completion expose database resources", () => {
  const s = lesson("spanner");
  expect(run(s, "sim spanner execute --help").text).toContain("--sql");
  expect(Engine.completionCandidates(s.world, "gcloud spanner instances describe ")).toContain(
    "global-app",
  );
  expect(Engine.completionCandidates(s.world, "sim spanner execute app --instance=")).toContain(
    "--instance=global-app",
  );
  expect(
    Engine.completionCandidates(s.world, "gcloud spanner instances create other --config="),
  ).toContain("--config=nam3");
});

test("Redis and connector references prevent deleting their VPC", () => {
  const s = lesson("functionsRedis");
  rejected(s, "gcloud compute networks delete default --quiet", "used by Redis or VPC connector");
});

test("Unknown flags on data operations never claim success", () => {
  const s = lesson("redisHa");
  rejected(
    s,
    "sim redis cache get visits --instance=ha-cache --region=us-central1 --network=default --ttl=20",
    "unrecognized",
  );
  const bt = lesson("bigtableGc");
  rejected(
    bt,
    "sim bigtable rows read sensor-1 --instance=telemetry --cluster=primary --table=readings --value=changed",
    "unrecognized",
  );
});

test("Bigtable compares cell timestamps chronologically and overwrites equivalent instants", () => {
  const s = lesson("bigtableGc", 3);
  const prefix =
    "sim bigtable rows write sensor-1 --instance=telemetry --cluster=primary --table=readings --family=data --qualifier=value";
  const overwritten = run(s, `${prefix} --value=same-instant --timestamp=2026-10-01T10:00:00.000Z`);
  expect(overwritten.world.managedDatabases.bigtableInstances[0]?.tables[0]?.cells).toHaveLength(1);
  const next = run(
    overwritten,
    `${prefix} --value=millisecond --timestamp=2026-10-01T10:00:00.500Z`,
    "sim bigtable rows read sensor-1 --instance=telemetry --cluster=primary --table=readings",
  );
  expect(
    JSON.parse(next.world.managedDatabases.observations.at(-1)?.result ?? "{}").cells[0].value,
  ).toBe("millisecond");
});

test("Firestore backup lookup uses the selected project and supports retained copies", () => {
  const s = run(
    lesson("firestoreRestore"),
    "gcloud services enable firestore.googleapis.com --project=ace-prod-01",
  );
  rejected(s, "sim firestore backups describe docs-copy --project=ace-prod-01", "does not exist");
});
