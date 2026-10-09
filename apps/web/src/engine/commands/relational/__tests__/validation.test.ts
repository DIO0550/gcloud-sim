// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { Now, run, type Session, session } from "@/engine/__tests__/setup";
import { databasesOf, findServer } from "@/engine/domains/relational/model";
import { evaluateSql } from "@/engine/domains/relational/sql";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import {
  RelationalPrelude,
  RelationalSolutions,
  relationalSatisfied,
} from "@/engine/missions/relational";
import { Snapshot } from "@/engine/snapshot";

const p = F.devProjectId;
const create =
  "gcloud sql instances create source-db --region=us-central1 --database-version=POSTGRES_16 --network=default";
const query = (sql: string, flags = "") =>
  `sim sql execute source-db --database=app --sql="${sql}" ${flags}`;
const fresh = () =>
  run(
    session(),
    ...RelationalPrelude,
    create,
    "gcloud sql databases create app --instance=source-db",
    query(
      "CREATE TABLE orders (id integer PRIMARY KEY, note text); INSERT INTO orders VALUES (1, 'before')",
    ),
  );
const rejected = (s: Session, line: string, reason?: string) => {
  const next = run(s, line);
  expect(next.text, line).toContain("ERROR:");
  if (reason) {
    expect(next.text.toLowerCase(), line).toContain(reason.toLowerCase());
  }
  expect(next.world, line).toEqual(s.world);
};
const solution = (lesson: keyof typeof RelationalSolutions) => {
  let s = run(session(), ...RelationalPrelude);
  for (const raw of RelationalSolutions[lesson]) {
    s = run(s, raw.replace("BACKUP_ID", s.world.sqlBackups.at(-1)?.id ?? "MISSING"));
    expect(s.text, raw).not.toContain("ERROR:");
  }
  return s;
};
test("SQL equality and UPDATE/DELETE operate on actual rows; failures are atomic", () => {
  const s = fresh();
  rejected(
    s,
    query(
      "BEGIN; UPDATE orders SET note = 'lost' WHERE id = 1; INSERT INTO orders VALUES (1, 'duplicate'); COMMIT",
    ),
    "Duplicate primary key",
  );
  rejected(s, query("UPDATE orders SET missing = 'x' WHERE id = 1"), "Unknown");
  rejected(s, query("SELECT * FROM orders WHERE id > 0"), "equality");
  rejected(s, query("DROP TABLE orders"), "Unsupported SQL");
  rejected(s, query("SELECT missing FROM orders"), "projection");
  rejected(s, query("INSERT INTO orders VALUES (2, 'unterminated)"), "Unterminated");
  rejected(s, query("CREATE TABLE constructor (id integer)"), "invalid name");
  const rollback = run(
    s,
    query("BEGIN; DELETE FROM orders; ROLLBACK"),
    query("SELECT * FROM orders"),
  );
  expect(rollback.text).toContain("before");
  const updated = run(
    s,
    query("UPDATE orders SET note = 'after' WHERE id = 1"),
    query("SELECT * FROM orders WHERE id = 1"),
  );
  expect(updated.text).toContain("after");
  const deleted = run(
    updated,
    query("DELETE FROM orders WHERE id = 1"),
    query("SELECT * FROM orders"),
  );
  expect(deleted.text).toContain("rows: []");
});
test("database read-only users and replicas reject writes including rolled-back writes", () => {
  const s = run(
    fresh(),
    "gcloud sql users create reader --instance=source-db --role=reader",
    "gcloud sql instances create replica-db --region=us-central1 --master-instance-name=source-db",
  );
  rejected(s, query("DELETE FROM orders", "--user=reader"), "write denied");
  rejected(s, query("BEGIN; DELETE FROM orders; ROLLBACK", "--user=reader"), "write denied");
  rejected(
    s,
    "sim sql execute replica-db --database=app --sql='DELETE FROM orders'",
    "write denied",
  );
  rejected(s, "gcloud sql databases create wrong --instance=replica-db", "writable");
  rejected(s, "gcloud sql instances failover replica-db", "HA primary");
  rejected(s, "gcloud sql instances delete source-db --quiet", "dependent replicas");
  expect(run(s, query("SELECT * FROM orders", "--user=reader")).text).toContain("before");
});
test("public CIDR, private VPC, DB user, region and API are validated", () => {
  let s = fresh();
  rejected(s, query("SELECT * FROM orders", "--via=public --source-ip=203.0.113.4"), "authorized");
  rejected(s, query("SELECT * FROM orders", "--via=private --network=other"), "Private connection");
  rejected(s, query("SELECT * FROM orders", "--user=missing"), "user does not exist");
  rejected(s, query("SELECT * FROM orders", "--region=asia-northeast1"), "region");
  rejected(s, "gcloud sql instances patch source-db --authorized-networks=not-cidr", "CIDR");
  s = run(s, "gcloud sql instances patch source-db --authorized-networks=203.0.113.0/24");
  expect(
    run(s, query("SELECT * FROM orders", "--via=public --source-ip=203.0.113.4")).text,
  ).toContain("before");
  s = run(s, "gcloud sql instances patch source-db --no-assign-ip");
  rejected(s, query("SELECT * FROM orders"), "proxy path");
  expect(run(s, query("SELECT * FROM orders", "--via=private --network=default")).text).toContain(
    "before",
  );
  rejected(s, "gcloud sql instances patch source-db --availability-type=regional", "dedicated");
  const disabled = {
    ...s.world,
    projects: s.world.projects.map((project) =>
      project.projectId === p
        ? {
            ...project,
            enabledApis: project.enabledApis.filter((a) => a !== "sqladmin.googleapis.com"),
          }
        : project,
    ),
  };
  rejected(session(disabled), query("SELECT * FROM orders"), "API");
});
test("IAM client permission is distinct from database writer role and admin", () => {
  let s = run(fresh(), `gcloud auth login ${F.developer}`);
  rejected(s, query("SELECT * FROM orders"), "permission");
  s = run(
    s,
    `gcloud projects add-iam-policy-binding ${p} --member=user:${F.developer} --role=roles/cloudsql.client --account=${F.owner}`,
  );
  expect(run(s, query("SELECT * FROM orders")).text).toContain("before");
  rejected(s, "gcloud sql databases create forbidden --instance=source-db", "permission");
  s = run(
    s,
    `gcloud projects remove-iam-policy-binding ${p} --member=user:${F.developer} --role=roles/cloudsql.client --account=${F.owner}`,
  );
  rejected(s, query("SELECT * FROM orders"), "permission");
});
test("backup affiliation and engine/target checks prevent unintended restoration", () => {
  let s = run(
    fresh(),
    "gcloud sql backups create --instance=source-db",
    "gcloud sql instances create other-db --region=us-central1 --database-version=POSTGRES_16",
    "gcloud sql instances create mysql-db --region=us-central1",
  );
  const id = s.world.sqlBackups.at(-1)?.id;
  rejected(
    s,
    `gcloud sql backups restore ${id} --backup-instance=other-db --restore-instance=other-db --quiet`,
    "belong",
  );
  rejected(
    s,
    `gcloud sql backups restore ${id} --backup-instance=source-db --restore-instance=mysql-db --quiet`,
    "same database engine",
  );
  s = run(
    s,
    query("DELETE FROM orders"),
    `gcloud sql backups restore ${id} --backup-instance=source-db --restore-instance=other-db --quiet`,
    `sim sql execute other-db --database=app --sql='SELECT * FROM orders'`,
  );
  expect(s.text).toContain("before");
  expect(s.world.relational.copies[0]?.databases[0]?.tables[0]?.rows).toHaveLength(1);
});
test("PITR chooses the preceding checkpoint and rejects times outside its virtual interval", () => {
  const s = solution("pitr");
  rejected(
    s,
    "gcloud sql instances clone pitr-db too-early --point-in-time=2026-10-01T09:59:59Z",
    "outside",
  );
  rejected(
    s,
    "gcloud sql instances clone pitr-db too-late --point-in-time=2026-10-01T10:11:00Z",
    "outside",
  );
  rejected(s, "sim sql checkpoint pitr-db --timestamp=2026-10-01T10:00:00Z", "increase");
  rejected(
    s,
    "gcloud sql instances clone pitr-db recovered-db --point-in-time=2026-10-01T10:05:00Z",
    "already exists",
  );
});
test("export/import validates bucket IAM, object existence and arbitrary input rejection", () => {
  const s = solution("transfer");
  rejected(
    s,
    "gcloud sql import sql import-db gs://lesson-db-export/not-a-dump.sql --quiet",
    "simulator SQL export",
  );
  const removed = {
    ...s.world,
    buckets: s.world.buckets.map((b) =>
      b.name === "lesson-db-export" ? { ...b, objects: [] } : b,
    ),
  };
  rejected(
    session(removed),
    "gcloud sql import sql import-db gs://lesson-db-export/app.sql --quiet",
    "simulator SQL export",
  );
  let viewer = run(
    s,
    `gcloud projects add-iam-policy-binding ${p} --member=user:${F.developer} --role=roles/cloudsql.admin`,
  );
  rejected(
    viewer,
    `gcloud sql export sql export-db gs://lesson-db-export/other.sql --account=${F.developer}`,
    "storage.objects.create",
  );
  viewer = run(
    viewer,
    `gcloud storage buckets add-iam-policy-binding gs://lesson-db-export --member=user:${F.developer} --role=roles/storage.objectCreator`,
  );
  expect(
    run(
      viewer,
      `gcloud sql export sql export-db gs://lesson-db-export/other.sql --account=${F.developer}`,
    ).text,
  ).toContain("exported");
});
test("AlloyDB primary/read-pool and backup affiliation/region are enforced", () => {
  const s = solution("alloy");
  rejected(
    s,
    "sim alloydb execute --cluster=alloy-app --region=us-central1 --instance=readers --network=default --database=app --sql='DELETE FROM orders'",
    "write denied",
  );
  rejected(
    s,
    "gcloud alloydb instances create another-primary --cluster=alloy-app --region=us-central1 --instance-type=PRIMARY",
    "Exactly one",
  );
  rejected(
    s,
    "gcloud alloydb instances delete primary --cluster=alloy-app --region=us-central1 --quiet",
    "read pools",
  );
  rejected(s, "gcloud alloydb clusters describe alloy-app --region=asia-northeast1", "region");
  rejected(
    s,
    "gcloud alloydb clusters restore bad-restore --region=us-central1 --network=default --backup=missing",
    "backup",
  );
  expect(
    relationalSatisfied(
      {
        ...s.world,
        relational: {
          ...s.world.relational,
          queries: s.world.relational.queries.map((q) => ({ ...q, endpoint: "primary" })),
        },
      },
      "alloy",
    ),
  ).toBe(false);
});
test("AlloyDB backup survives removal of the source cluster and restores actual data", () => {
  let s = solution("alloyRestore");
  s = run(
    s,
    "gcloud alloydb instances delete primary --cluster=alloy-source --region=us-central1 --quiet",
    "gcloud alloydb clusters delete alloy-source --region=us-central1 --quiet",
    "gcloud alloydb clusters restore after-deletion --region=us-central1 --network=default --backup=alloy-copy",
  );
  expect(s.text).not.toContain("ERROR:");
  const restored = Snapshot.fromUnknown(Snapshot.create(s.world, Now));
  expect(restored).toMatchObject({ ok: true });
  const server = findServer(s.world, { projectId: p, kind: "alloy", name: "after-deletion" });
  if (!server) {
    throw new Error("Missing restored cluster");
  }
  expect(databasesOf(s.world, server)[0]?.tables[0]?.rows[0]?.note).toBe("before");
});
test("DMS rejects skipped verification, destination writes, stale CDC and unsafe promotion", () => {
  let s = run(session(), ...RelationalPrelude);
  const lines = RelationalSolutions.migration;
  const job = "move-app --region=us-central1";
  for (const line of lines.slice(0, 7)) {
    s = run(s, line);
    expect(s.text, line).not.toContain("ERROR:");
  }
  rejected(s, `gcloud database-migration migration-jobs start ${job}`, "verified");
  s = run(s, lines[7] ?? "", lines[8] ?? "");
  rejected(s, "gcloud sql databases create blocked --instance=migration-target", "writable");
  rejected(s, `gcloud database-migration migration-jobs promote ${job}`, "Promotion requires");
  s = run(s, lines[9] ?? "", lines[10] ?? "", lines[11] ?? "");
  rejected(s, `gcloud database-migration migration-jobs promote ${job}`, "caught-up");
  s = run(s, lines[12] ?? "", lines[13] ?? "");
  expect(s.text).toContain("COMPLETED");
  rejected(s, "sim sql writes resume migration-source", "fenced");
  rejected(s, "gcloud sql instances delete migration-source --quiet", "profiles");
  rejected(s, "gcloud sql users delete postgres --instance=migration-source --quiet", "profiles");
});
test("DMS stop/resume and runtime permission rechecking keep destination unchanged on failure", () => {
  let s = run(session(), ...RelationalPrelude, ...RelationalSolutions.migration.slice(0, 9));
  s = run(s, "gcloud database-migration migration-jobs stop move-app --region=us-central1");
  expect(s.text).toContain("STOPPED");
  rejected(s, "sim dms advance move-app --region=us-central1", "RUNNING");
  s = run(s, "gcloud database-migration migration-jobs resume move-app --region=us-central1");
  const noSql = {
    ...s.world,
    projects: s.world.projects.map((project) =>
      project.projectId === p
        ? {
            ...project,
            enabledApis: project.enabledApis.filter((a) => a !== "sqladmin.googleapis.com"),
          }
        : project,
    ),
  };
  rejected(session(noSql), "sim dms advance move-app --region=us-central1", "Cloud SQL API");
});
test("vector results use cosine distance with tenant filtering and reject invalid dimensions/zero norm", () => {
  const s = solution("vector");
  const bad =
    "sim sql execute vector-db --database=app --sql=\"INSERT INTO items VALUES (4, 'bad', 'a', '[0,0,0]')\"";
  rejected(s, bad, "nonzero");
  rejected(s, bad.replace("[0,0,0]", "[1,0]"), "three");
  rejected(
    s,
    "sim sql execute vector-db --database=app --sql=\"SELECT id FROM items ORDER BY embedding <=> '[0,0,0]'::vector LIMIT 2\"",
    "cosine",
  );
  const actual = s.world.relational.queries.at(-1)?.rows;
  expect(actual?.map((r) => r.id)).toEqual([1, 2]);
  expect(actual?.[1]?.distance).toBeCloseTo(1 - 4 / Math.sqrt(17), 8);
});
test("row cap and invalid duplicate schema cannot produce an invalid persisted world", () => {
  const s = fresh();
  const server = findServer(s.world, { projectId: p, kind: "sql", name: "source-db" });
  if (!server) {
    throw new Error("Missing server");
  }
  const database = databasesOf(s.world, server)[0];
  if (!database) {
    throw new Error("Missing database");
  }
  const full = {
    ...database,
    tables: database.tables.map((t) => ({
      ...t,
      rows: Array.from({ length: 200 }, (_, i) => ({ id: i, note: "full" })),
    })),
  };
  expect(evaluateSql(full, "INSERT INTO orders VALUES (201, 'overflow')", true)).toMatchObject({
    ok: false,
  });
  rejected(s, query("CREATE TABLE dup (id integer, id text)"), "duplicate");
});
test("legacy v32 SQL instances/backups migrate without dropping existing resources", () => {
  const s = run(fresh(), "gcloud sql backups create --instance=source-db");
  const raw = JSON.parse(JSON.stringify(Snapshot.create(s.world, Now)));
  raw.schemaVersion = 32;
  delete raw.world.relational;
  const next = Snapshot.fromUnknown(raw);
  expect(next).toMatchObject({ ok: true });
  if (!next.ok) {
    throw new Error(JSON.stringify(next.error));
  }
  expect(next.value.sqlInstances).toEqual(s.world.sqlInstances);
  expect(next.value.sqlBackups).toEqual(s.world.sqlBackups);
  expect(next.value.relational.servers[0]).toMatchObject({
    publicIp: true,
    availability: "ZONAL",
    pitr: false,
  });
  expect(next.value.relational.copies[0]?.databases).toEqual([]);
});
test("current Snapshot rejects malformed parents, duplicate keys, rows, references and invalid DMS state", () => {
  const s = solution("migration");
  const raw = () => JSON.parse(JSON.stringify(Snapshot.create(s.world, Now)));
  const variants = [
    (v: ReturnType<typeof raw>) => {
      v.world.relational.servers[0].network = "missing";
    },
    (v: ReturnType<typeof raw>) => {
      v.world.relational.users.push(v.world.relational.users[0]);
    },
    (v: ReturnType<typeof raw>) => {
      v.world.relational.databases[0].tables[0].rows[0].id = "wrong-type";
    },
    (v: ReturnType<typeof raw>) => {
      v.world.relational.migrations[0].source = "missing";
    },
    (v: ReturnType<typeof raw>) => {
      v.world.relational.migrations[0].phase = "INITIAL_COPY";
    },
    (v: ReturnType<typeof raw>) => {
      v.world.relational.servers[0].failovers = -1;
    },
  ];
  for (const change of variants) {
    const v = raw();
    change(v);
    expect(Snapshot.fromUnknown(v)).toMatchObject({ ok: false });
  }
});
test("restore mission requires an actual restore and unknown scenarios cannot be marked successful", () => {
  let s = run(session(), ...RelationalPrelude, ...RelationalSolutions.restore.slice(0, 4));
  s = run(s, "sim sql execute restore-db --database=app --sql='SELECT * FROM orders'");
  expect(relationalSatisfied(s.world, "restore")).toBe(false);
  rejected(s, "sim databases choose arbitrary --service=cloud-sql", "Unknown workload");
  const wrong = run(s, "sim databases choose warehouse --service=cloud-sql");
  expect(relationalSatisfied(wrong.world, "selection")).toBe(false);
});

test("Storage overwrite invalidates an export, and database VPC references block deletion", () => {
  const s = solution("transfer");
  const overwritten = run(s, "gcloud storage cp hello.txt gs://lesson-db-export/app.sql");
  rejected(
    overwritten,
    "gcloud sql import sql import-db gs://lesson-db-export/app.sql --quiet",
    "simulator SQL export",
  );
  const network = fresh();
  rejected(network, "gcloud compute networks delete default --quiet", "database");
});
test("unsupported vector ORDER BY and malformed vectors never return success", () => {
  const s = solution("vector");
  rejected(
    s,
    "sim sql execute vector-db --database=app --sql=\"SELECT id, embedding <=> '[1,0,0]'::vector AS distance FROM items ORDER BY random()\"",
    "ORDER BY",
  );
  rejected(
    s,
    "sim sql execute vector-db --database=app --sql=\"INSERT INTO items VALUES (4, 'bad', 'a', '[1,,0]')\"",
    "numeric literal",
  );
});
test("new command help and resource/flag completion expose configured database resources", () => {
  const s = fresh();
  expect(run(s, "sim sql execute --help").text).toContain("--database");
  expect(Engine.completionCandidates(s.world, "gcloud sql instances describe ")).toContain(
    "source-db",
  );
  expect(Engine.completionCandidates(s.world, "gcloud sql backups list -i ")).toContain(
    "source-db",
  );
  expect(
    Engine.completionCandidates(s.world, "gcloud alloydb instances create reader --instance-type="),
  ).toContain("--instance-type=READ_POOL");
});
