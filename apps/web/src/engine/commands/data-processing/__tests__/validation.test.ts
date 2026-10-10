// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { Now, run, type Session, session } from "@/engine/__tests__/setup";
import { emptyDataProcessing, patch } from "@/engine/domains/data-processing/model";
import { parseRows, parseSchema, select } from "@/engine/domains/data-processing/tabular";
import { DataPrelude, DataSolutions, dataSatisfied } from "@/engine/missions/data-processing";
import { Snapshot } from "@/engine/snapshot";

const setup = (...lines: readonly string[]) => run(session(), ...DataPrelude, ...lines);
const denied = (s: Session, line: string) => {
  const after = run(s, line);
  expect(after.text, line).toContain("ERROR:");
  expect(after.world, line).toBe(s.world);
};
test("bq load/list accept positional URI/dataset and reject duplicate forms", () => {
  const s = setup(...DataSolutions.load.slice(0, 4));
  const loaded = run(
    s,
    "bq load warehouse.orders gs://ace-csv-input/input --location=US --skip_leading_rows=1",
  );
  expect(loaded.text).not.toContain("ERROR:");
  expect(loaded.world.dataProcessing.tables[0]?.rows).toEqual([
    { customer: "alice", amount: 10 },
    { customer: "alice", amount: 20 },
  ]);
  expect(run(loaded, "bq ls warehouse --location=US").text).toContain("orders");
  denied(
    s,
    "bq load warehouse.orders gs://ace-csv-input/input --source=gs://ace-csv-input/input --location=US",
  );
  denied(s, "bq ls warehouse --dataset=warehouse --location=US");
});
for (const sql of [
  "SELECT * FROM warehouse.orders JOIN other ON x=y",
  "SELECT COUNT(*) AS prototype FROM warehouse.orders",
  "SELECT * FROM `warehouse.orders",
  "DELETE FROM warehouse.orders",
  "SELECT AVG(amount) AS total FROM warehouse.orders",
  "SELECT nope FROM warehouse.orders",
  "SELECT SUM(customer) AS total FROM warehouse.orders",
  "SELECT * FROM warehouse.orders; SELECT * FROM warehouse.orders",
  "SELECT * FROM warehouse.orders WHERE amount = '10'",
  "SELECT * FROM warehouse.orders ORDER BY nope",
  "SELECT * FROM warehouse.orders LIMIT 0",
]) {
  test(`unsupported SQL is atomic: ${sql}`, () =>
    denied(setup(...DataSolutions.load), `bq query "${sql}" --location=US`));
}
for (const line of [
  "bq show warehouse.orders --location=EU",
  "bq query 'SELECT * FROM ace-prod-01.warehouse.orders' --location=US",
  "bq load warehouse.orders --source=gs://missing/input --location=US",
  "bq mk broken --dataset --table --location=US",
  "bq mk warehouse.bad --table --location=US --schema=x:STRING,x:INT64",
  "bq mk warehouse.bad --table --location=US --schema=x:TIMESTAMP",
  "bq rm warehouse --location=US --quiet",
]) {
  test(`BigQuery validates location/reference/schema: ${line}`, () =>
    denied(setup(...DataSolutions.load), line));
}
test("CSV quoting, nullable typed values and empty aggregates are evaluated", () => {
  const schema = parseSchema("label:STRING,n:FLOAT64,enabled:BOOL");
  expect(schema.ok).toBe(true);
  if (!schema.ok) {
    return;
  }
  expect(parseRows('"a,b",1.5,true\n"say ""hi""",,false', schema.value, "CSV")).toEqual({
    ok: true,
    value: [
      { label: "a,b", n: 1.5, enabled: true },
      { label: 'say "hi"', n: null, enabled: false },
    ],
  });
  const table = {
    projectId: "ace-dev-01",
    dataset: "x",
    name: "t",
    schema: schema.value,
    rows: [],
  };
  expect(select("SELECT COUNT(*) AS n, SUM(n) AS total FROM x.t", table)).toEqual({
    ok: true,
    value: [{ n: 0, total: null }],
  });
});
test("load type failure preserves table, jobs and snapshot", () => {
  const s = setup(
    ...DataSolutions.load.slice(0, 4),
    "sim storage objects write gs://ace-csv-input/input --data='alice,no-number'",
  );
  denied(s, "bq load warehouse.orders --source=gs://ace-csv-input/input --location=US");
  expect(s.world.dataProcessing.jobs).toEqual([]);
});
test("metadata-only storage copy cannot masquerade as input bytes", () => {
  const s = setup(...DataSolutions.load, "gcloud storage cp local.csv gs://ace-csv-input/input");
  denied(s, "bq load warehouse.orders --source=gs://ace-csv-input/input --location=US");
});
test("viewer cannot load/query and a jobUser cannot read table data", () => {
  const s = run(
    setup(...DataSolutions.load),
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:viewer@example.com --role=roles/viewer",
    "gcloud auth login viewer@example.com",
    "gcloud config set account owner@example.com",
  );
  denied(s, `bq query 'SELECT * FROM warehouse.orders' --location=US --account=viewer@example.com`);
  denied(
    s,
    `bq load warehouse.orders --source=gs://ace-csv-input/input --location=US --account=viewer@example.com`,
  );
  const granted = run(
    s,
    `gcloud projects add-iam-policy-binding ace-dev-01 --member=user:viewer@example.com --role=roles/bigquery.jobUser`,
  );
  denied(
    granted,
    `bq query 'SELECT * FROM warehouse.orders' --location=US --account=viewer@example.com`,
  );
});
test("BigQuery API disabled and bucket location mismatch reject loads", () => {
  const s = setup(...DataSolutions.load);
  const disabled = run(s, "gcloud services disable bigquery.googleapis.com");
  denied(disabled, "bq show warehouse.orders --location=US");
  const eu = run(
    s,
    "gcloud storage buckets create gs://ace-eu-input --location=EU",
    "sim storage objects write gs://ace-eu-input/input --data='alice,1'",
  );
  denied(eu, "bq load warehouse.orders --source=gs://ace-eu-input/input --location=US");
});
test("manual ACK, stale ID, independent subscriptions and no replay to late subscribers", () => {
  let s = setup(
    "gcloud pubsub topics create events",
    "gcloud pubsub subscriptions create first --topic=events",
    "gcloud pubsub subscriptions create second --topic=events",
    "gcloud pubsub topics publish events --message=hello",
    "gcloud pubsub subscriptions create late --topic=events",
    "gcloud pubsub subscriptions pull first",
  );
  const id = s.world.dataProcessing.receipts.find((r) => r.subscription === "first")?.ackId ?? "";
  expect(s.world.dataProcessing.receipts.some((r) => r.subscription === "late")).toBe(false);
  denied(s, `gcloud pubsub subscriptions ack first --ack-ids=${id},unknown`);
  const acknowledged = run(s, `gcloud pubsub subscriptions ack first --ack-ids=${id}`);
  expect(
    acknowledged.world.dataProcessing.receipts.find((r) => r.subscription === "first")?.state,
  ).toBe("ACKED");
  expect(
    acknowledged.world.dataProcessing.receipts.find((r) => r.subscription === "second")?.state,
  ).toBe("AVAILABLE");
  s = run(s, "sim time advance --seconds=10", "gcloud pubsub subscriptions pull first");
  denied(s, `gcloud pubsub subscriptions ack first --ack-ids=${id}`);
  expect(s.world.dataProcessing.receipts.find((r) => r.subscription === "first")?.attempts).toBe(2);
});
for (const line of [
  "gcloud pubsub subscriptions create bad --topic=ack-events --ack-deadline=0",
  "gcloud pubsub subscriptions create bad --topic=ack-events --push-endpoint=http://example.com",
  "gcloud pubsub subscriptions update ack-events --message-retention-duration=9",
  "gcloud pubsub subscriptions update ack-events --dead-letter-topic=ack-events",
  "gcloud pubsub subscriptions pull ack-events --limit=0",
  "sim pubsub push ack-events --response-code=200",
  "gcloud pubsub topics delete ack-events --quiet",
]) {
  test(`invalid Pub/Sub configuration is atomic: ${line}`, () =>
    denied(setup(...DataSolutions.ack.slice(0, 3)), line));
}
test("pull is denied for push subscriptions and failed push leaves mission incomplete", () => {
  const s = setup(...DataSolutions.push.slice(0, 4));
  expect(dataSatisfied(s.world, "push")).toBe(false);
  denied(s, "gcloud pubsub subscriptions pull push-events");
  denied(s, "sim pubsub push push-events --response-code=201");
});
test("dead-letter forwarding requires the service agent and does not duplicate deliveries", () => {
  const commands = DataSolutions.deadLetter.filter((s) => !s.includes("add-iam-policy-binding"));
  const s = setup(...commands.slice(0, -2));
  denied(s, "gcloud pubsub subscriptions pull source-events");
  expect(dataSatisfied(s.world, "deadLetter")).toBe(false);
  const done = setup(...DataSolutions.deadLetter);
  const again = run(done, "gcloud pubsub subscriptions pull source-events");
  expect(again.world.dataProcessing.messages).toEqual(done.world.dataProcessing.messages);
});
test("failed stream parsing commits no output or ACK and repaired retry commits once", () => {
  const initial = DataSolutions.stream.map((s) =>
    s.startsWith("gcloud pubsub topics publish")
      ? 'gcloud pubsub topics publish stream-events --message=\'{"customer":"alice","amount":"bad"}\''
      : s,
  );
  let s = setup(...initial.slice(0, -1));
  expect(s.world.dataProcessing.processingJobs[0]?.state).toBe("FAILED");
  expect(s.world.dataProcessing.tables[0]?.rows).toEqual([]);
  expect(s.world.dataProcessing.receipts[0]?.state).toBe("AVAILABLE");
  denied(s, "sim dataflow jobs advance stream-job --region=us-central1");
  s = run(
    s,
    "gcloud pubsub subscriptions pull stream-events --auto-ack",
    'gcloud pubsub topics publish stream-events --message=\'{"customer":"alice","amount":10}\'',
    "sim dataflow jobs retry stream-job --region=us-central1",
    "sim dataflow jobs advance stream-job --region=us-central1",
    "sim dataflow jobs advance stream-job --region=us-central1",
  );
  expect(s.world.dataProcessing.tables[0]?.rows).toEqual([{ customer: "ALICE", amount: 10 }]);
  denied(s, "sim dataflow jobs advance stream-job --region=us-central1");
});
test("worker IAM failure is retained for repair and cannot clear a mission", () => {
  const s = setup(
    ...DataSolutions.dataflow
      .filter((s) => !s.includes("--role=roles/storage.objectViewer"))
      .slice(0, -1),
  );
  expect(s.text).toContain("ERROR:");
  expect(s.world.dataProcessing.processingJobs[0]?.state).toBe("FAILED");
  expect(s.world.dataProcessing.processingJobs[0]?.error).toContain("storage");
  expect(dataSatisfied(s.world, "dataflow")).toBe(false);
});
test("unknown templates and arbitrary Spark code cannot run", () => {
  const s = setup(...DataSolutions.dataflow.slice(0, -4));
  const create = DataSolutions.dataflow.at(-4) ?? "";
  denied(s, create.replace("gs://dataflow-templates/sim/GCS_to_BigQuery", "gs://arbitrary/code"));
  const spark = setup(
    ...DataSolutions.dataproc.slice(
      0,
      DataSolutions.dataproc.findIndex((s) => s.includes("jobs submit")),
    ),
  );
  const submit = DataSolutions.dataproc.find((s) => s.includes("jobs submit")) ?? "";
  denied(spark, submit.replace("sim://samples/transform.jar", "gs://arbitrary.jar"));
});
test("cancelled jobs cannot advance/retry, active jobs block cluster and SA deletion", () => {
  const submitIndex = DataSolutions.dataproc.findIndex((s) => s.includes("jobs submit"));
  const s = setup(...DataSolutions.dataproc.slice(0, submitIndex + 1));
  denied(s, "gcloud dataproc clusters delete spark-cluster --region=us-central1 --quiet");
  denied(
    s,
    "gcloud iam service-accounts delete data-worker@ace-dev-01.iam.gserviceaccount.com --quiet",
  );
  const stopped = run(s, "gcloud dataproc jobs cancel spark-job --region=us-central1 --quiet");
  denied(stopped, "sim dataproc jobs advance spark-job --region=us-central1");
  denied(stopped, "sim dataproc jobs retry spark-job --region=us-central1");
  expect(
    run(stopped, "gcloud dataproc clusters delete spark-cluster --region=us-central1 --quiet").text,
  ).not.toContain("ERROR:");
});
test("Kafka wrong VPC/auth/project and dependent deletion are rejected", () => {
  const s = setup(...DataSolutions.kafka.slice(0, -1));
  expect(dataSatisfied(s.world, "kafka")).toBe(false);
  for (const line of [
    "sim kafka connect event-kafka --region=us-central1 --network=other --auth=SASL_IAM",
    "sim kafka connect event-kafka --region=us-central1 --network=default --auth=PLAINTEXT",
    "gcloud managed-kafka clusters describe event-kafka --region=europe-west1",
    "gcloud managed-kafka topics create bad --region=us-central1 --cluster=event-kafka --replication-factor=1",
    "gcloud managed-kafka clusters delete event-kafka --region=us-central1 --quiet",
  ]) {
    denied(s, line);
  }
});
test("processing VPC and Kafka subnet references prevent deletion", () => {
  const index = DataSolutions.dataproc.findIndex((s) => s.includes("jobs submit"));
  const spark = setup(...DataSolutions.dataproc.slice(0, index));
  const withoutSubnets = session({
    ...spark.world,
    subnets: spark.world.subnets.filter(
      (s) => s.projectId !== "ace-dev-01" || s.network !== "default",
    ),
  });
  denied(withoutSubnets, "gcloud compute networks delete default --quiet");
  const kafka = setup(...DataSolutions.kafka);
  denied(kafka, "gcloud compute networks subnets delete kafka-subnet --region=us-central1 --quiet");
});
test("billing and log exports are idempotent, writer omission fails", () => {
  const billing = setup(...DataSolutions.billing);
  const again = run(billing, "sim billing exports run");
  expect(again.world.dataProcessing.tables).toEqual(billing.world.dataProcessing.tables);
  denied(billing, "bq rm finance --location=US --recursive --quiet");
  const logs = setup(...DataSolutions.logs.filter((s) => !s.includes("grant-writer")).slice(0, -2));
  denied(logs, "sim logging sinks export audit-export --table=audit.activity --location=US");
  const logged = setup(...DataSolutions.logs);
  expect(
    run(logged, "sim logging sinks export audit-export --table=audit.activity --location=US").world
      .dataProcessing.tables,
  ).toEqual(logged.world.dataProcessing.tables);
});
test("a later wrong service choice makes the comparison incomplete", () => {
  const s = setup(...DataSolutions.selection);
  expect(dataSatisfied(s.world, "selection")).toBe(true);
  const changed = run(s, "sim data-services choose warehouse-sql --service=pubsub");
  expect(dataSatisfied(changed.world, "selection")).toBe(false);
});
test("v34 migrates empty data state while v35 preserves queued/failed/ACK state", () => {
  const s = setup(...DataSolutions.recovery);
  const { dataProcessing: _, ...legacy } = s.world;
  const old = Snapshot.fromUnknown({ schemaVersion: 34, exportedAt: Now, world: legacy });
  expect(old.ok).toBe(true);
  if (old.ok) {
    expect(old.value.dataProcessing).toEqual(emptyDataProcessing());
    expect(old.value.managedDatabases).toEqual(s.world.managedDatabases);
  }
  expect(Snapshot.fromUnknown(Snapshot.create(s.world, Now))).toEqual({ ok: true, value: s.world });
});
for (const corrupt of ["location", "rows", "clock", "receipt", "job"] as const) {
  test(`malformed snapshot rejects ${corrupt} without replacing current state`, () => {
    const s = setup(...DataSolutions.stream);
    const d = s.world.dataProcessing;
    let changes = {};
    if (corrupt === "location") {
      changes = { datasets: d.datasets.map((v) => ({ ...v, location: "MOON" })) };
    } else if (corrupt === "rows") {
      changes = {
        tables: d.tables.map((v) => ({ ...v, rows: [{ customer: "x", amount: "bad" }] })),
      };
    } else if (corrupt === "clock") {
      changes = { clock: -1 };
    } else if (corrupt === "receipt") {
      changes = { receipts: d.receipts.map((r) => ({ ...r, subscription: "missing" })) };
    } else {
      changes = {
        processingJobs: d.processingJobs.map((j) => ({
          ...j,
          serviceAccount: "missing@example.com",
        })),
      };
    }
    expect(Snapshot.fromUnknown(Snapshot.create(patch(s.world, changes), Now)).ok).toBe(false);
  });
}
test("help/completion and describe expose scoped tables/jobs", () => {
  const s = setup(...DataSolutions.load);
  expect(run(s, "bq query --help").text).toContain("--location");
  expect(Engine.completionCandidates(s.world, "bq show ")).toContain("warehouse.orders");
  expect(
    Engine.completionCandidates(s.world, "gcloud dataflow jobs run demo --gcs-location="),
  ).toContain("--gcs-location=gs://dataflow-templates/sim/GCS_to_BigQuery");
  expect(run(s, "bq ls --jobs --location=US").text).toContain("QUERY");
  const job = s.world.dataProcessing.jobs.at(-1);
  expect(run(s, `bq show ${job?.name} --job --location=US`).text).toContain("30");
});
