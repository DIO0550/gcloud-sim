import { Workloads } from "@/engine/commands/data-processing/kafka";
import { GcsTemplate, PubsubTemplate, SparkJar } from "@/engine/domains/data-processing/model";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";

export const DataPrelude = [
  "gcloud services enable bigquery.googleapis.com pubsub.googleapis.com dataflow.googleapis.com dataproc.googleapis.com managedkafka.googleapis.com storage.googleapis.com compute.googleapis.com logging.googleapis.com",
];
const p = F.devProjectId;
const sa = `data-worker@${p}.iam.gserviceaccount.com`;
const ds = (n: string, l = "US") => `bq mk ${n} --dataset --location=${l}`;
const table = (n: string, l = "US") =>
  `bq mk ${n}.orders --table --location=${l} --schema=customer:STRING,amount:INT64`;
const write = (bucket: string, data: string) =>
  `sim storage objects write gs://${bucket}/input --data='${data}'`;
const bucket = (n: string) => `gcloud storage buckets create gs://${n} --location=us-central1`;
const query = (sql: string, l = "US") => `bq query "${sql}" --location=${l} --use_legacy_sql=false`;
const topic = (n: string) => `gcloud pubsub topics create ${n}`;
const sub = (n: string, flags = "") =>
  `gcloud pubsub subscriptions create ${n} --topic=${n} ${flags}`;
const publish = (n: string) =>
  `gcloud pubsub topics publish ${n} --message='{"customer":"alice","amount":10}'`;
const pull = (n: string, flags = "") => `gcloud pubsub subscriptions pull ${n} ${flags}`;
const tick = "sim time advance --seconds=10";
const worker = (kind: string) => [
  "gcloud iam service-accounts create data-worker",
  `gcloud iam service-accounts add-iam-policy-binding ${sa} --member=user:${F.owner} --role=roles/iam.serviceAccountUser`,
  ...["bigquery.dataEditor", "storage.objectViewer", `${kind}.worker`].map(
    (r) =>
      `gcloud projects add-iam-policy-binding ${p} --member=serviceAccount:${sa} --role=roles/${r}`,
  ),
];
const seed = (n: string, kind = "dataflow") => [
  ...worker(kind),
  ds(n, "us-central1"),
  table(n, "us-central1"),
  bucket(`ace-${n}-input`),
  write(`ace-${n}-input`, '{"customer":"alice","amount":10}'),
];
const df = (n: string, input = `gs://ace-${n}-input/input`, template = GcsTemplate) =>
  `gcloud dataflow jobs run ${n}-job --region=us-central1 --gcs-location=${template} --service-account-email=${sa} --parameters=input=${input},output=${n}.orders,transform=uppercase`;
const advance = (n: string, kind = "dataflow") =>
  `sim ${kind} jobs advance ${n}-job --region=us-central1`;
const agent = "service-481200000001@gcp-sa-pubsub.iam.gserviceaccount.com";
export const DataSolutions = {
  load: [
    ds("warehouse"),
    table("warehouse"),
    bucket("ace-csv-input"),
    write("ace-csv-input", "customer,amount\\nalice,10\\nalice,20"),
    "bq load warehouse.orders --source=gs://ace-csv-input/input --location=US --source_format=CSV --skip_leading_rows=1",
    query("SELECT customer, SUM(amount) AS total FROM warehouse.orders GROUP BY customer"),
  ],
  query: [
    ds("filtered"),
    table("filtered"),
    bucket("ace-filtered-input"),
    write("ace-filtered-input", "alice,10\\nbob,99\\nalice,20"),
    "bq load filtered.orders --source=gs://ace-filtered-input/input --location=US --source_format=CSV",
    query(
      "SELECT amount FROM filtered.orders WHERE customer = 'alice' ORDER BY amount DESC LIMIT 2",
    ),
  ],
  ack: [
    topic("ack-events"),
    sub("ack-events"),
    publish("ack-events"),
    pull("ack-events", "--auto-ack"),
  ],
  redelivery: [
    topic("retry-events"),
    sub("retry-events"),
    publish("retry-events"),
    pull("retry-events"),
    tick,
    pull("retry-events", "--auto-ack"),
  ],
  retention: [
    topic("retained-events"),
    sub("retained-events"),
    "gcloud pubsub subscriptions update retained-events --message-retention-duration=10",
    publish("retained-events"),
    tick,
  ],
  deadLetter: [
    topic("source-events"),
    sub("source-events"),
    topic("dead-events"),
    sub("dead-events"),
    "gcloud pubsub subscriptions update source-events --dead-letter-topic=dead-events --max-delivery-attempts=5",
    ...["publisher", "subscriber"].map(
      (r) =>
        `gcloud projects add-iam-policy-binding ${p} --member=serviceAccount:${agent} --role=roles/pubsub.${r}`,
    ),
    publish("source-events"),
    ...Array.from({ length: 5 }).flatMap(() => [pull("source-events"), tick]),
    pull("source-events"),
    pull("dead-events", "--auto-ack"),
  ],
  push: [
    topic("push-events"),
    sub("push-events", "--push-endpoint=https://collector.example/ingest"),
    publish("push-events"),
    "sim pubsub push push-events --response-code=503",
    tick,
    "sim pubsub push push-events --response-code=200",
  ],
  dataflow: [
    ...seed("batch"),
    df("batch"),
    advance("batch"),
    advance("batch"),
    query("SELECT * FROM batch.orders", "us-central1"),
  ],
  stream: [
    ...worker("dataflow"),
    `gcloud projects add-iam-policy-binding ${p} --member=serviceAccount:${sa} --role=roles/pubsub.subscriber`,
    ds("stream", "us-central1"),
    table("stream", "us-central1"),
    topic("stream-events"),
    sub("stream-events"),
    publish("stream-events"),
    df("stream", "subscription:stream-events", PubsubTemplate),
    advance("stream"),
    advance("stream"),
    query("SELECT * FROM stream.orders", "us-central1"),
  ],
  recovery: [
    ...seed("recover"),
    write("ace-recover-input", '{"customer":"bad","amount":"invalid"}'),
    df("recover"),
    advance("recover"),
    advance("recover"),
    write("ace-recover-input", '{"customer":"fixed","amount":30}'),
    "sim dataflow jobs retry recover-job --region=us-central1",
    advance("recover"),
    advance("recover"),
    query("SELECT * FROM recover.orders", "us-central1"),
  ],
  dataproc: [
    ...seed("spark", "dataproc"),
    `gcloud dataproc clusters create spark-cluster --region=us-central1 --network=default --service-account=${sa} --num-workers=2`,
    "gcloud dataproc clusters update spark-cluster --region=us-central1 --num-workers=3",
    `gcloud dataproc jobs submit spark --id=spark-job --cluster=spark-cluster --region=us-central1 --jars=${SparkJar} --class=sim.Uppercase --input=gs://ace-spark-input/input --output=spark.orders`,
    advance("spark", "dataproc"),
    advance("spark", "dataproc"),
    query("SELECT * FROM spark.orders", "us-central1"),
    "gcloud dataproc clusters delete spark-cluster --region=us-central1 --quiet",
  ],
  kafka: [
    "gcloud compute networks subnets create kafka-subnet --network=default --region=us-central1 --range=10.88.0.0/24",
    "gcloud managed-kafka clusters create event-kafka --region=us-central1 --subnet=kafka-subnet --cpu=3 --memory=3221225472",
    "gcloud managed-kafka topics create orders --region=us-central1 --cluster=event-kafka --partitions=3 --replication-factor=3",
    "sim kafka connect event-kafka --region=us-central1 --network=default --auth=SASL_IAM",
  ],
  billing: [
    ds("finance"),
    "sim billing exports configure finance --location=US",
    "sim billing exports run",
    query("SELECT SUM(cost) AS total FROM finance.gcp_billing_export"),
  ],
  logs: [
    ds("audit"),
    `gcloud logging sinks create audit-export bigquery.googleapis.com/projects/${p}/datasets/audit --log-filter='severity=NOTICE'`,
    "sim logging sinks grant-writer audit-export --location=US",
    "gcloud compute instances create audit-vm --zone=us-central1-a --machine-type=e2-micro",
    "sim logging sinks export audit-export --table=audit.activity --location=US",
    query("SELECT COUNT(*) AS count FROM audit.activity"),
  ],
  selection: Object.entries(Workloads).map(
    ([w, s]) => `sim data-services choose ${w} --service=${s}`,
  ),
} as const;
export type DataLesson = keyof typeof DataSolutions;
export type DataAssertion = Readonly<{ kind: "dataProcessingLesson"; lesson: DataLesson }>;
const titles: Readonly<Record<DataLesson, readonly [string, string]>> = {
  load: [
    "CSVをBigQueryへ読み込んで集計",
    "USのdataset/tableを作り、Cloud StorageのCSVを読み込み、aliceの合計30を確認します。",
  ],
  query: [
    "SQLの条件・並び順で実データを分析",
    "aliceだけを抽出し、amountを降順で20、10と返してください。",
  ],
  ack: ["Pub/SubメッセージをACK", "publishしたメッセージをpullし、受信済みにします。"],
  redelivery: [
    "未ACKメッセージの再配送",
    "ACKせず受信し、仮想時計を10秒進め、2回目の配送をACKします。",
  ],
  retention: [
    "保持期限後のメッセージを確認",
    "保持を10秒に設定し、publish後に時計を10秒進めて失効させます。",
  ],
  deadLetter: [
    "再試行を尽くしたメッセージを隔離",
    "service agentの権限を設定し、5回の失敗後にdead-letter topicへ移し、隔離先をACKします。",
  ],
  push: [
    "push失敗から再配送して回復",
    "HTTPS endpointへの503応答後、期限を進めて200応答でACKします。",
  ],
  dataflow: [
    "Dataflowで取り込み・変換・分析",
    "教材GCSテンプレートを明示的に2段階進め、ALICEの出力をBigQueryで読みます。",
  ],
  stream: [
    "Pub/SubからDataflowで処理",
    "実行SAにsubscriberを与え、受信メッセージを変換し、出力とACKを確認します。",
  ],
  recovery: [
    "Dataflowの不正入力を修復",
    "型違いの入力でFAILEDを確認し、正しいデータに直してretryし、FIXEDと30を読みます。",
  ],
  dataproc: [
    "DataprocのSpark教材を実行し後片付け",
    "workerを3へ増やし、固定Sparkサンプルを進め、ALICEを分析した後クラスタを削除します。",
  ],
  kafka: [
    "Kafkaのprivate接続を構成",
    "3 vCPUのクラスタと3 partitionのtopicを作り、同じVPCからSASL_IAM/TLS接続を確認します。",
  ],
  billing: [
    "課金exportをSQLで分析",
    "固定教材のUSD費用をexportし、合計15を求めます。実課金はありません。",
  ],
  logs: [
    "監査ログをBigQueryへ転送",
    "sink writerに権限を与え、VM作成の操作ログをexportし、件数を分析します。",
  ],
  selection: [
    "データ処理サービスを用途から選ぶ",
    "SQL倉庫、ストリーム変換、Spark、非同期イベント、Kafka互換の5用途を比較します。",
  ],
};
export const DataMissions: readonly Mission[] = (Object.keys(DataSolutions) as DataLesson[]).map(
  (lesson, i) => ({
    id: `m-data-${String(i + 1).padStart(3, "0")}`,
    domain: lesson === "selection" ? "計画と構成" : "運用の維持",
    title: titles[lesson][0],
    description: titles[lesson][1],
    hints: [...DataPrelude, ...DataSolutions[lesson]],
    assertions: [{ kind: "dataProcessingLesson", lesson }],
    setup: [
      { kind: "setPrincipal", principal: F.owner },
      { kind: "setProject", projectId: p },
    ],
  }),
);
export const dataSatisfied = (world: World, lesson: DataLesson): boolean => {
  const d = world.dataProcessing;
  const observation = (resource: string, operation: string) =>
    d.observations
      .filter((o) => o.projectId === p && o.resource === resource && o.operation === operation)
      .at(-1);
  const result = (resource: string, expected: readonly object[]) => {
    const o = observation(resource, "query");
    if (!o) {
      return false;
    }
    const rows: unknown = JSON.parse(o.result).rows;
    return JSON.stringify(rows) === JSON.stringify(expected);
  };
  const ack = (sub: string, attempts: number, state = "ACKED") =>
    d.receipts.some(
      (r) =>
        r.projectId === p && r.subscription === sub && r.state === state && r.attempts === attempts,
    );
  if (lesson === "load") {
    return result("warehouse.orders", [{ customer: "alice", total: 30 }]);
  }
  if (lesson === "query") {
    return result("filtered.orders", [{ amount: 20 }, { amount: 10 }]);
  }
  if (lesson === "ack") {
    return ack("ack-events", 1);
  }
  if (lesson === "redelivery") {
    return ack("retry-events", 2);
  }
  if (lesson === "retention") {
    return ack("retained-events", 0, "EXPIRED");
  }
  if (lesson === "deadLetter") {
    return ack("source-events", 5, "DEAD_LETTER") && ack("dead-events", 1);
  }
  if (lesson === "push") {
    return ack("push-events", 2) && !!observation("push-events", "push");
  }
  if (lesson === "selection") {
    return Object.entries(Workloads).every(([w, s]) => {
      const o = observation(w, "data-choice");
      return !!o && JSON.parse(o.result).service === s;
    });
  }
  if (lesson === "kafka") {
    return (
      d.kafkaClusters.some(
        (c) =>
          c.projectId === p &&
          c.name === "event-kafka" &&
          c.region === "us-central1" &&
          c.vcpu === 3 &&
          c.memory === 3221225472,
      ) &&
      d.kafkaTopics.some(
        (t) =>
          t.projectId === p &&
          t.cluster === "event-kafka" &&
          t.name === "orders" &&
          t.partitions === 3 &&
          t.region === "us-central1",
      ) &&
      !!observation("event-kafka", "kafka-connect")
    );
  }
  if (lesson === "billing") {
    return (
      result("finance.gcp_billing_export", [{ total: 15 }]) &&
      !!observation("finance.gcp_billing_export", "billing-export")
    );
  }
  if (lesson === "logs") {
    const table = d.tables.find(
      (t) => t.projectId === p && t.dataset === "audit" && t.name === "activity",
    );
    return (
      !!table &&
      table.rows.some((r) => r.method === "v1.compute.instances.insert") &&
      result("audit.activity", [{ count: table.rows.length }]) &&
      !!observation("audit.activity", "log-export")
    );
  }
  const resource = { dataflow: "batch", stream: "stream", recovery: "recover", dataproc: "spark" }[
    lesson
  ];
  const kind = lesson === "dataproc" ? "dataproc" : "dataflow";
  const job = d.processingJobs.find(
    (j) =>
      j.projectId === p &&
      j.kind === kind &&
      j.name === `${resource}-job` &&
      j.region === "us-central1",
  );
  if (job?.state !== "DONE" || job.processed !== 1) {
    return false;
  }
  if (lesson === "recovery" && !observation("recover-job", "dataflow-failed")) {
    return false;
  }
  if (lesson === "stream" && !ack("stream-events", 1)) {
    return false;
  }
  if (
    lesson === "dataproc" &&
    d.clusters.some((c) => c.projectId === p && c.name === "spark-cluster")
  ) {
    return false;
  }
  const expected =
    lesson === "recovery" ? { customer: "FIXED", amount: 30 } : { customer: "ALICE", amount: 10 };
  return result(`${resource}.orders`, [expected]);
};
