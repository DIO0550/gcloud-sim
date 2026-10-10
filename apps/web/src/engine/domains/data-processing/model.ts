import { Region } from "@/engine/domains/catalog";
import { ResourceName } from "@/engine/domains/compute";
import { PubsubName } from "@/engine/domains/data";
import { validIdentifier } from "@/engine/domains/relational/model";
import type { World } from "@/engine/domains/world";
import { Decoder as D } from "@/utils/Decoder";
import { Result } from "@/utils/Result";

export const GcsTemplate = "gs://dataflow-templates/sim/GCS_to_BigQuery";
export const PubsubTemplate = "gs://dataflow-templates/sim/PubSub_to_BigQuery";
export const SparkJar = "sim://samples/transform.jar";
export type Ref = Readonly<{ projectId: string; name: string }>;
export type Field = Readonly<{ name: string; type: "STRING" | "INT64" | "FLOAT64" | "BOOL" }>;
export type Scalar = string | number | boolean | null;
export type Row = Readonly<Record<string, Scalar>>;
export type Dataset = Ref & Readonly<{ location: string }>;
export type DataTable = Ref &
  Readonly<{ dataset: string; schema: readonly Field[]; rows: readonly Row[] }>;
export type BqJob = Ref &
  Readonly<{
    location: string;
    type: "LOAD" | "QUERY" | "EXPORT";
    state: "DONE" | "FAILED";
    source: string;
    target: string;
    error: string;
    rows: readonly Row[];
  }>;
export type InputFile = Readonly<{ uri: string; data: string; token: string }>;
export type Message = Ref & Readonly<{ topic: string; data: string; publishedAt: number }>;
export type Receipt = Readonly<{
  projectId: string;
  subscription: string;
  message: string;
  attempts: number;
  deadline: number;
  ackId: string;
  state: "AVAILABLE" | "IN_FLIGHT" | "ACKED" | "DEAD_LETTER" | "EXPIRED";
}>;
export type SubscriptionSettings = Ref &
  Readonly<{ retention: number; deadLetterTopic: string; maxAttempts: number }>;
export type Cluster = Ref &
  Readonly<{ region: string; network: string; workers: number; serviceAccount: string }>;
export type ProcessingJob = Ref &
  Readonly<{
    kind: "dataflow" | "dataproc";
    region: string;
    serviceAccount: string;
    cluster: string;
    template: string;
    input: string;
    output: string;
    transform: "identity" | "uppercase";
    state: "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "CANCELLED";
    error: string;
    processed: number;
  }>;
export type KafkaCluster = Ref &
  Readonly<{ region: string; subnet: string; vcpu: number; memory: number }>;
export type KafkaTopic = Ref &
  Readonly<{ region: string; cluster: string; partitions: number; replication: number }>;
export type BillingExport = Readonly<{
  projectId: string;
  account: string;
  dataset: string;
  location: string;
}>;
export type Observation = Readonly<{
  projectId: string;
  resource: string;
  operation: string;
  result: string;
}>;
export type DataProcessing = Readonly<{
  datasets: readonly Dataset[];
  tables: readonly DataTable[];
  jobs: readonly BqJob[];
  files: readonly InputFile[];
  messages: readonly Message[];
  receipts: readonly Receipt[];
  subscriptions: readonly SubscriptionSettings[];
  clusters: readonly Cluster[];
  processingJobs: readonly ProcessingJob[];
  kafkaClusters: readonly KafkaCluster[];
  kafkaTopics: readonly KafkaTopic[];
  billingExports: readonly BillingExport[];
  clock: number;
  observations: readonly Observation[];
}>;

export const emptyDataProcessing = (): DataProcessing => ({
  datasets: [],
  tables: [],
  jobs: [],
  files: [],
  messages: [],
  receipts: [],
  subscriptions: [],
  clusters: [],
  processingJobs: [],
  kafkaClusters: [],
  kafkaTopics: [],
  billingExports: [],
  clock: 0,
  observations: [],
});
export const locations = (): readonly string[] => ["US", "EU", ...Region.all()];
export const compatibleLocation = (bucket: string, target: string): boolean => {
  const source = bucket.toLowerCase();
  if (target === "US") {
    return ["us", "us-central1", "us-east1"].includes(source);
  }
  if (target === "EU") {
    return ["eu", "europe-west1"].includes(source);
  }
  return source === target.toLowerCase();
};
export const validScalar = (v: unknown): v is Scalar =>
  v === null ||
  typeof v === "string" ||
  typeof v === "boolean" ||
  (typeof v === "number" && Number.isFinite(v));
export const validSchema = (schema: readonly Field[]): boolean =>
  schema.length > 0 &&
  schema.length <= 20 &&
  new Set(schema.map((f) => f.name)).size === schema.length &&
  schema.every(
    (f) => validIdentifier(f.name) && ["STRING", "INT64", "FLOAT64", "BOOL"].includes(f.type),
  );
export const rowMatches = (row: Row, schema: readonly Field[]): boolean =>
  Object.keys(row).length === schema.length &&
  schema.every((f) => {
    if (!Object.hasOwn(row, f.name)) {
      return false;
    }
    const v = row[f.name];
    if (v === null) {
      return true;
    }
    if (f.type === "STRING") {
      return typeof v === "string";
    }
    if (f.type === "BOOL") {
      return typeof v === "boolean";
    }
    if (f.type === "INT64") {
      return Number.isSafeInteger(v);
    }
    return typeof v === "number" && Number.isFinite(v);
  });
export const patch = (world: World, values: Partial<DataProcessing>): World => ({
  ...world,
  dataProcessing: { ...world.dataProcessing, ...values },
});
export const observe = (
  world: World,
  projectId: string,
  resource: string,
  operation: string,
  value: unknown,
): World =>
  patch(world, {
    observations: [
      ...world.dataProcessing.observations,
      { projectId, resource, operation, result: JSON.stringify(value) },
    ].slice(-100),
  });

const scalar: D<Scalar> = (v, path) =>
  validScalar(v) ? Result.ok(v) : Result.err(`${path}: expected a finite scalar`);
const row = D.record(scalar);
const ref = { projectId: D.string, name: D.string };
export const dataProcessingDecoder = D.object<DataProcessing>({
  datasets: D.array(D.object<Dataset>({ ...ref, location: D.string })),
  tables: D.array(
    D.object<DataTable>({
      ...ref,
      dataset: D.string,
      schema: D.array(
        D.object<Field>({
          name: D.string,
          type: D.literal(["STRING", "INT64", "FLOAT64", "BOOL"]),
        }),
      ),
      rows: D.array(row),
    }),
  ),
  jobs: D.array(
    D.object<BqJob>({
      ...ref,
      location: D.string,
      type: D.literal(["LOAD", "QUERY", "EXPORT"]),
      state: D.literal(["DONE", "FAILED"]),
      source: D.string,
      target: D.string,
      error: D.string,
      rows: D.array(row),
    }),
  ),
  files: D.array(D.object<InputFile>({ uri: D.string, data: D.string, token: D.string })),
  messages: D.array(
    D.object<Message>({ ...ref, topic: D.string, data: D.string, publishedAt: D.number }),
  ),
  receipts: D.array(
    D.object<Receipt>({
      projectId: D.string,
      subscription: D.string,
      message: D.string,
      attempts: D.number,
      deadline: D.number,
      ackId: D.string,
      state: D.literal(["AVAILABLE", "IN_FLIGHT", "ACKED", "DEAD_LETTER", "EXPIRED"]),
    }),
  ),
  subscriptions: D.array(
    D.object<SubscriptionSettings>({
      ...ref,
      retention: D.number,
      deadLetterTopic: D.string,
      maxAttempts: D.number,
    }),
  ),
  clusters: D.array(
    D.object<Cluster>({
      ...ref,
      region: D.string,
      network: D.string,
      workers: D.number,
      serviceAccount: D.string,
    }),
  ),
  processingJobs: D.array(
    D.object<ProcessingJob>({
      ...ref,
      kind: D.literal(["dataflow", "dataproc"]),
      region: D.string,
      serviceAccount: D.string,
      cluster: D.string,
      template: D.string,
      input: D.string,
      output: D.string,
      transform: D.literal(["identity", "uppercase"]),
      state: D.literal(["QUEUED", "RUNNING", "DONE", "FAILED", "CANCELLED"]),
      error: D.string,
      processed: D.number,
    }),
  ),
  kafkaClusters: D.array(
    D.object<KafkaCluster>({
      ...ref,
      region: D.string,
      subnet: D.string,
      vcpu: D.number,
      memory: D.number,
    }),
  ),
  kafkaTopics: D.array(
    D.object<KafkaTopic>({
      ...ref,
      region: D.string,
      cluster: D.string,
      partitions: D.number,
      replication: D.number,
    }),
  ),
  billingExports: D.array(
    D.object<BillingExport>({
      projectId: D.string,
      account: D.string,
      dataset: D.string,
      location: D.string,
    }),
  ),
  clock: D.number,
  observations: D.array(
    D.object<Observation>({
      projectId: D.string,
      resource: D.string,
      operation: D.string,
      result: D.string,
    }),
  ),
});
const whole = (n: number, min: number, max: number) =>
  Number.isSafeInteger(n) && n >= min && n <= max;
const validResult = (value: string): boolean => {
  try {
    const decoded: unknown = JSON.parse(value);
    return typeof decoded === "object" && decoded !== null && !Array.isArray(decoded);
  } catch {
    return false;
  }
};
export const validateDataProcessing = (world: World): Result<World, string> => {
  const d = world.dataProcessing;
  const exists = (p: string) => world.projects.some((v) => v.projectId === p);
  for (const key of [
    "datasets",
    "tables",
    "jobs",
    "messages",
    "subscriptions",
    "clusters",
    "processingJobs",
    "kafkaClusters",
    "kafkaTopics",
  ] as const) {
    const ids = d[key].map((r) =>
      [
        r.projectId,
        "region" in r ? r.region : "",
        "dataset" in r ? r.dataset : "",
        "cluster" in r ? r.cluster : "",
        "kind" in r ? r.kind : "",
        r.name,
      ].join("/"),
    );
    if (
      d[key].length > 1000 ||
      new Set(ids).size !== ids.length ||
      d[key].some((r) => !exists(r.projectId) || !r.name)
    ) {
      return Result.err(`Invalid data processing collection: ${key}`);
    }
  }
  if (!whole(d.clock, 0, 3153600000) || d.observations.length > 100 || d.files.length > 200) {
    return Result.err("Invalid data processing clock/history/files.");
  }
  if (d.datasets.some((r) => !validIdentifier(r.name) || !locations().includes(r.location))) {
    return Result.err("Invalid BigQuery dataset location/name.");
  }
  if (
    d.tables.some(
      (t) =>
        !validIdentifier(t.name) ||
        !validSchema(t.schema) ||
        t.rows.length > 1000 ||
        !t.rows.every((r) => rowMatches(r, t.schema)) ||
        !d.datasets.some((s) => s.projectId === t.projectId && s.name === t.dataset),
    )
  ) {
    return Result.err("Invalid BigQuery table/schema/rows or dataset reference.");
  }
  if (
    d.jobs.some(
      (j) =>
        !locations().includes(j.location) ||
        j.rows.length > 1000 ||
        (j.state === "FAILED" && !j.error) ||
        (j.state === "DONE" && j.error !== ""),
    )
  ) {
    return Result.err("Invalid BigQuery job.");
  }
  if (
    new Set(d.files.map((f) => f.uri)).size !== d.files.length ||
    d.files.some((f) => !/^gs:\/\/[^/]+\/.+/.test(f.uri) || f.data.length > 100000 || !f.token)
  ) {
    return Result.err("Invalid teaching input file.");
  }
  if (
    d.messages.some(
      (m) =>
        !PubsubName.parse(m.topic).ok || !whole(m.publishedAt, 0, d.clock) || m.data.length > 4096,
    )
  ) {
    return Result.err("Invalid Pub/Sub message.");
  }
  if (
    d.subscriptions.some((s) => {
      const sub = world.pubsubSubscriptions.find(
        (r) => r.projectId === s.projectId && r.name === s.name,
      );
      if (!sub || !whole(s.retention, 10, 604800) || !whole(s.maxAttempts, 5, 100)) {
        return true;
      }
      return (
        s.deadLetterTopic !== "" &&
        (s.deadLetterTopic === sub.topic ||
          !world.pubsubTopics.some(
            (t) => t.projectId === s.projectId && t.name === s.deadLetterTopic,
          ))
      );
    })
  ) {
    return Result.err("Invalid subscription retention/dead-letter reference.");
  }
  if (
    world.pubsubSubscriptions.some(
      (s) =>
        !whole(s.ackDeadlineSeconds, 10, 600) ||
        (s.pushEndpoint.some &&
          !/^https:\/\/[a-z0-9.-]+(?:\/[^\s]*)?$/i.test(s.pushEndpoint.value)),
    )
  ) {
    return Result.err("Invalid Pub/Sub ACK deadline/push endpoint.");
  }
  const receiptIds = d.receipts.map((r) => [r.projectId, r.subscription, r.message].join("/"));
  if (
    d.receipts.length > 5000 ||
    new Set(receiptIds).size !== receiptIds.length ||
    d.receipts.some((r) => {
      const sub = world.pubsubSubscriptions.find(
        (s) => s.projectId === r.projectId && s.name === r.subscription,
      );
      const message = d.messages.find((m) => m.projectId === r.projectId && m.name === r.message);
      if (!sub || !message || sub.topic !== message.topic) {
        return true;
      }
      return (
        !whole(r.attempts, 0, 100) ||
        !whole(r.deadline, 0, 3153600600) ||
        (r.state === "IN_FLIGHT" && (!r.ackId || r.attempts === 0))
      );
    })
  ) {
    return Result.err("Invalid Pub/Sub receipt/deadline.");
  }
  if (
    d.clusters.some(
      (c) =>
        !ResourceName.parse(c.name).ok ||
        !Region.parse(c.region).some ||
        !whole(c.workers, 2, 20) ||
        !world.networks.some((n) => n.projectId === c.projectId && n.name === c.network) ||
        !world.serviceAccounts.some(
          (s) => s.projectId === c.projectId && s.email === c.serviceAccount,
        ),
    )
  ) {
    return Result.err("Invalid Dataproc cluster/network/service account.");
  }
  if (
    d.processingJobs.some((j) => {
      if (
        !ResourceName.parse(j.name).ok ||
        !Region.parse(j.region).some ||
        !whole(j.processed, 0, 1000) ||
        !world.serviceAccounts.some(
          (s) => s.projectId === j.projectId && s.email === j.serviceAccount,
        )
      ) {
        return true;
      }
      if ((j.state === "FAILED") !== (j.error !== "")) {
        return true;
      }
      if (!/^(?:[a-z][a-z0-9_-]*\.)?[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(j.output)) {
        return true;
      }
      const outputParts = j.output.split(".");
      if (outputParts.length === 3 && outputParts[0] !== j.projectId) {
        return true;
      }
      if (
        j.kind === "dataflow" &&
        (j.cluster !== "" || ![GcsTemplate, PubsubTemplate].includes(j.template))
      ) {
        return true;
      }
      if (j.kind === "dataproc" && (j.template !== SparkJar || !ResourceName.parse(j.cluster).ok)) {
        return true;
      }
      if (j.template === PubsubTemplate) {
        return !j.input.startsWith("subscription:") || !PubsubName.parse(j.input.slice(13)).ok;
      }
      if (!/^gs:\/\/[^/]+\/.+/.test(j.input)) {
        return true;
      }
      return (
        j.kind === "dataproc" &&
        ["QUEUED", "RUNNING"].includes(j.state) &&
        !d.clusters.some(
          (c) => c.projectId === j.projectId && c.name === j.cluster && c.region === j.region,
        )
      );
    })
  ) {
    return Result.err("Invalid processing job/service account.");
  }
  if (
    d.kafkaClusters.some(
      (c) =>
        !ResourceName.parse(c.name).ok ||
        !Region.parse(c.region).some ||
        !whole(c.vcpu, 3, 24) ||
        !whole(c.memory, c.vcpu * 1073741824, c.vcpu * 4294967296) ||
        !world.subnets.some(
          (s) => s.projectId === c.projectId && s.name === c.subnet && s.region === c.region,
        ),
    )
  ) {
    return Result.err("Invalid Kafka capacity/subnet.");
  }
  if (
    d.kafkaTopics.some(
      (t) =>
        !ResourceName.parse(t.name).ok ||
        !whole(t.partitions, 1, 100) ||
        t.replication !== 3 ||
        !d.kafkaClusters.some(
          (c) => c.projectId === t.projectId && c.name === t.cluster && c.region === t.region,
        ),
    )
  ) {
    return Result.err("Invalid Kafka topic/cluster.");
  }
  const exports = d.billingExports.map((e) => e.projectId);
  if (
    new Set(exports).size !== exports.length ||
    d.billingExports.some(
      (e) =>
        !exists(e.projectId) ||
        !world.billingAccounts.some((a) => a.id === e.account) ||
        !d.datasets.some(
          (s) => s.projectId === e.projectId && s.name === e.dataset && s.location === e.location,
        ),
    ) ||
    d.observations.some(
      (o) => !exists(o.projectId) || o.result.length > 100000 || !validResult(o.result),
    )
  ) {
    return Result.err("Invalid data export/history reference.");
  }
  return Result.ok(world);
};
