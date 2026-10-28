import { Workloads } from "@/engine/commands/data-processing/kafka";
import { GcsTemplate, PubsubTemplate, SparkJar } from "@/engine/domains/data-processing/model";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { MissionStep } from "@/engine/missions/mission-step";

const DataPreludeSteps = [
  MissionStep.run(
    "データ処理で使うAPIをまとめて有効にする",
    "gcloud services enable bigquery.googleapis.com pubsub.googleapis.com dataflow.googleapis.com dataproc.googleapis.com managedkafka.googleapis.com storage.googleapis.com compute.googleapis.com logging.googleapis.com",
  ),
];
export const DataPrelude = MissionStep.lines(DataPreludeSteps);
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
/** 実行SAに付けるロールと、その手順で何をするか。 */
const workerRoles = (kind: string): readonly (readonly [string, string])[] => [
  ["bigquery.dataEditor", "実行SAにBigQueryへ書き込む権限を与える"],
  ["storage.objectViewer", "実行SAに入力バケットを読む権限を与える"],
  [
    `${kind}.worker`,
    `実行SAに${kind === "dataproc" ? "Dataproc" : "Dataflow"}のworker権限を与える`,
  ],
];
const worker = (kind: string) => [
  MissionStep.run(
    "処理ジョブを動かすサービスアカウントを作る",
    "gcloud iam service-accounts create data-worker",
  ),
  MissionStep.run(
    "自分にそのSAをジョブへ付ける権限を与える",
    `gcloud iam service-accounts add-iam-policy-binding ${sa} --member=user:${F.owner} --role=roles/iam.serviceAccountUser`,
    "ジョブに実行SAを指定する人には、そのSAに対するiam.serviceAccountUserが要ります。",
  ),
  ...workerRoles(kind).map(([r, what]) =>
    MissionStep.run(
      what,
      `gcloud projects add-iam-policy-binding ${p} --member=serviceAccount:${sa} --role=roles/${r}`,
    ),
  ),
];
const seed = (n: string, kind = "dataflow") => [
  ...worker(kind),
  MissionStep.run("出力先のデータセットを作る", ds(n, "us-central1")),
  MissionStep.run(
    "出力先のordersテーブルを作る",
    table(n, "us-central1"),
    "列はcustomer（STRING）とamount（INT64）です。",
  ),
  MissionStep.run("入力ファイルを置くバケットを作る", bucket(`ace-${n}-input`)),
  MissionStep.run(
    "aliceの注文1件を入力ファイルとして置く",
    write(`ace-${n}-input`, '{"customer":"alice","amount":10}'),
  ),
];
const df = (n: string, input = `gs://ace-${n}-input/input`, template = GcsTemplate) =>
  `gcloud dataflow jobs run ${n}-job --region=us-central1 --gcs-location=${template} --service-account-email=${sa} --parameters=input=${input},output=${n}.orders,transform=uppercase`;
const advance = (n: string, kind = "dataflow") =>
  `sim ${kind} jobs advance ${n}-job --region=us-central1`;
/** ジョブを待機中→実行中→完了と進める 2 手順。 */
const advanceTwice = (n: string, kind = "dataflow") => [
  MissionStep.run("ジョブを待機中から実行中へ進める", advance(n, kind)),
  MissionStep.run("ジョブに入力を処理させて完了させる", advance(n, kind)),
];
const agent = "service-481200000001@gcp-sa-pubsub.iam.gserviceaccount.com";
const workloadWhat: Readonly<Record<keyof typeof Workloads, string>> = {
  "warehouse-sql": "SQLで分析するデータ倉庫にBigQueryを選ぶ",
  "stream-transform": "ストリームの変換処理にDataflowを選ぶ",
  "spark-batch": "Sparkのバッチ処理にDataprocを選ぶ",
  "async-events": "非同期のイベント配信にPub/Subを選ぶ",
  "kafka-protocol": "Kafka互換が要る処理にManaged Kafkaを選ぶ",
};
const DataSteps = {
  load: [
    MissionStep.run("USにwarehouseデータセットを作る", ds("warehouse")),
    MissionStep.run(
      "ordersテーブルをスキーマ付きで作る",
      table("warehouse"),
      "列はcustomer（STRING）とamount（INT64）です。",
    ),
    MissionStep.run("CSVを置くバケットを作る", bucket("ace-csv-input")),
    MissionStep.run(
      "見出し行付きのCSVをバケットに置く",
      write("ace-csv-input", "customer,amount\\nalice,10\\nalice,20"),
    ),
    MissionStep.run(
      "CSVをordersテーブルへ読み込む",
      "bq load warehouse.orders --source=gs://ace-csv-input/input --location=US --source_format=CSV --skip_leading_rows=1",
      "--skip_leading_rows=1で1行目の見出しを飛ばします。",
    ),
    MissionStep.run(
      "customerごとの合計金額を集計する",
      query("SELECT customer, SUM(amount) AS total FROM warehouse.orders GROUP BY customer"),
      "aliceの合計30が返れば完了です。",
    ),
  ],
  query: [
    MissionStep.run("USにfilteredデータセットを作る", ds("filtered")),
    MissionStep.run("ordersテーブルをスキーマ付きで作る", table("filtered")),
    MissionStep.run("CSVを置くバケットを作る", bucket("ace-filtered-input")),
    MissionStep.run(
      "見出し行の無いCSVをバケットに置く",
      write("ace-filtered-input", "alice,10\\nbob,99\\nalice,20"),
    ),
    MissionStep.run(
      "CSVをordersテーブルへ読み込む",
      "bq load filtered.orders --source=gs://ace-filtered-input/input --location=US --source_format=CSV",
    ),
    MissionStep.run(
      "aliceの注文を金額の大きい順に2件取り出す",
      query(
        "SELECT amount FROM filtered.orders WHERE customer = 'alice' ORDER BY amount DESC LIMIT 2",
      ),
      "20、10の順に返れば完了です。",
    ),
  ],
  ack: [
    MissionStep.run("ack-eventsトピックを作る", topic("ack-events")),
    MissionStep.run("トピックを受け取るサブスクリプションを作る", sub("ack-events")),
    MissionStep.run("注文メッセージを1件publishする", publish("ack-events")),
    MissionStep.run(
      "メッセージを受け取ってACKする",
      pull("ack-events", "--auto-ack"),
      "--auto-ackを付けると受信と同時にACKします。",
    ),
  ],
  redelivery: [
    MissionStep.run("retry-eventsトピックを作る", topic("retry-events")),
    MissionStep.run("トピックを受け取るサブスクリプションを作る", sub("retry-events")),
    MissionStep.run("注文メッセージを1件publishする", publish("retry-events")),
    MissionStep.run(
      "ACKせずにメッセージを受け取る",
      pull("retry-events"),
      "ACKしないメッセージは確認期限が過ぎると再配送されます。",
    ),
    MissionStep.run("仮想時計を10秒進めて確認期限を過ぎさせる", tick),
    MissionStep.run(
      "再配送されたメッセージを受け取ってACKする",
      pull("retry-events", "--auto-ack"),
      "これが2回目の配送です。",
    ),
  ],
  retention: [
    MissionStep.run("retained-eventsトピックを作る", topic("retained-events")),
    MissionStep.run("トピックを受け取るサブスクリプションを作る", sub("retained-events")),
    MissionStep.run(
      "未ACKメッセージの保持期間を10秒にする",
      "gcloud pubsub subscriptions update retained-events --message-retention-duration=10",
    ),
    MissionStep.run("注文メッセージを1件publishする", publish("retained-events")),
    MissionStep.run(
      "仮想時計を10秒進めて保持期間を過ぎさせる",
      tick,
      "一度も受信されないままメッセージが期限切れになります。",
    ),
  ],
  deadLetter: [
    MissionStep.run("元のsource-eventsトピックを作る", topic("source-events")),
    MissionStep.run("source-eventsのサブスクリプションを作る", sub("source-events")),
    MissionStep.run("隔離先のdead-eventsトピックを作る", topic("dead-events")),
    MissionStep.run("隔離先を読むサブスクリプションを作る", sub("dead-events")),
    MissionStep.run(
      "5回配送に失敗したらdead-eventsへ移すよう設定する",
      "gcloud pubsub subscriptions update source-events --dead-letter-topic=dead-events --max-delivery-attempts=5",
    ),
    MissionStep.run(
      "Pub/Subのサービスエージェントに隔離先へのpublish権限を与える",
      `gcloud projects add-iam-policy-binding ${p} --member=serviceAccount:${agent} --role=roles/pubsub.publisher`,
      "dead-letter topicへの転送はPub/Subのサービスエージェントが行います。",
    ),
    MissionStep.run(
      "サービスエージェントに元のサブスクリプションの受信権限を与える",
      `gcloud projects add-iam-policy-binding ${p} --member=serviceAccount:${agent} --role=roles/pubsub.subscriber`,
      "転送したメッセージを元のサブスクリプションでACKするのに要ります。",
    ),
    MissionStep.run("注文メッセージを1件publishする", publish("source-events")),
    ...Array.from({ length: 5 }).flatMap((_, i) => [
      MissionStep.run(`${i + 1}回目の配送をACKせずに受け取る`, pull("source-events")),
      MissionStep.run("仮想時計を10秒進めて再配送を待つ", tick),
    ]),
    MissionStep.run(
      "元のサブスクリプションをもう一度pullする",
      pull("source-events"),
      "最大配送回数を使い切ったメッセージは、元のサブスクリプションには届かずdead-eventsへ移ります。",
    ),
    MissionStep.run("隔離先のメッセージを受け取ってACKする", pull("dead-events", "--auto-ack")),
  ],
  push: [
    MissionStep.run("push-eventsトピックを作る", topic("push-events")),
    MissionStep.run(
      "HTTPS endpointへ届けるpushサブスクリプションを作る",
      sub("push-events", "--push-endpoint=https://collector.example/ingest"),
    ),
    MissionStep.run("注文メッセージを1件publishする", publish("push-events")),
    MissionStep.run(
      "endpointが503を返して配送に失敗するところを再現する",
      "sim pubsub push push-events --response-code=503",
      "2xx以外の応答は失敗として扱われ、メッセージは再配送されます。",
    ),
    MissionStep.run("仮想時計を10秒進めて再配送を待つ", tick),
    MissionStep.run(
      "2回目の配送でendpointが200を返すようにする",
      "sim pubsub push push-events --response-code=200",
      "成功の応答がACKの代わりになります。",
    ),
  ],
  dataflow: [
    ...seed("batch"),
    MissionStep.run(
      "教材のGCSテンプレートでDataflowジョブを起動する",
      df("batch"),
      "入力のcustomerを大文字にしてbatch.ordersへ書き込むジョブです。実行SAは--service-account-emailで指定します。",
    ),
    ...advanceTwice("batch"),
    MissionStep.run(
      "変換結果をBigQueryで読む",
      query("SELECT * FROM batch.orders", "us-central1"),
      "customerがALICEになっていれば完了です。",
    ),
  ],
  stream: [
    ...worker("dataflow"),
    MissionStep.run(
      "実行SAにPub/Subから受信する権限を与える",
      `gcloud projects add-iam-policy-binding ${p} --member=serviceAccount:${sa} --role=roles/pubsub.subscriber`,
    ),
    MissionStep.run("出力先のデータセットを作る", ds("stream", "us-central1")),
    MissionStep.run("出力先のordersテーブルを作る", table("stream", "us-central1")),
    MissionStep.run("入力のstream-eventsトピックを作る", topic("stream-events")),
    MissionStep.run("ジョブが読むサブスクリプションを作る", sub("stream-events")),
    MissionStep.run("注文メッセージを1件publishする", publish("stream-events")),
    MissionStep.run(
      "サブスクリプションを入力にDataflowジョブを起動する",
      df("stream", "subscription:stream-events", PubsubTemplate),
      "処理できたメッセージはジョブがACKします。",
    ),
    ...advanceTwice("stream"),
    MissionStep.run(
      "変換結果をBigQueryで読む",
      query("SELECT * FROM stream.orders", "us-central1"),
    ),
  ],
  recovery: [
    ...seed("recover"),
    MissionStep.run(
      "amountが文字列の不正な入力で上書きする",
      write("ace-recover-input", '{"customer":"bad","amount":"invalid"}'),
    ),
    MissionStep.run("教材のGCSテンプレートでDataflowジョブを起動する", df("recover")),
    MissionStep.run("ジョブを待機中から実行中へ進める", advance("recover")),
    MissionStep.run(
      "ジョブに入力を処理させてFAILEDになるのを確かめる",
      advance("recover"),
      "型が合わない入力は書き込まれず、ジョブが失敗します。",
    ),
    MissionStep.run(
      "入力を正しいデータに直す",
      write("ace-recover-input", '{"customer":"fixed","amount":30}'),
    ),
    MissionStep.run(
      "失敗したジョブを再実行する",
      "sim dataflow jobs retry recover-job --region=us-central1",
      "失敗したジョブは待機中（QUEUED）に戻ります。",
    ),
    ...advanceTwice("recover"),
    MissionStep.run(
      "変換結果をBigQueryで読む",
      query("SELECT * FROM recover.orders", "us-central1"),
      "FIXEDと30が返れば完了です。",
    ),
  ],
  dataproc: [
    ...seed("spark", "dataproc"),
    MissionStep.run(
      "実行SAを付けたworker 2台のDataprocクラスタを作る",
      `gcloud dataproc clusters create spark-cluster --region=us-central1 --network=default --service-account=${sa} --num-workers=2`,
    ),
    MissionStep.run(
      "workerを3台に増やす",
      "gcloud dataproc clusters update spark-cluster --region=us-central1 --num-workers=3",
    ),
    MissionStep.run(
      "固定のSparkサンプルをジョブとして投入する",
      `gcloud dataproc jobs submit spark --id=spark-job --cluster=spark-cluster --region=us-central1 --jars=${SparkJar} --class=sim.Uppercase --input=gs://ace-spark-input/input --output=spark.orders`,
      "入力のcustomerを大文字にしてspark.ordersへ書き込むサンプルです。任意のコードは動かせません。",
    ),
    ...advanceTwice("spark", "dataproc"),
    MissionStep.run("処理結果をBigQueryで読む", query("SELECT * FROM spark.orders", "us-central1")),
    MissionStep.run(
      "使い終わったクラスタを削除する",
      "gcloud dataproc clusters delete spark-cluster --region=us-central1 --quiet",
      "クラスタは残っている間ずっとVMの費用がかかります。",
    ),
  ],
  kafka: [
    MissionStep.run(
      "Kafkaクラスタを置くサブネットを作る",
      "gcloud compute networks subnets create kafka-subnet --network=default --region=us-central1 --range=10.88.0.0/24",
    ),
    MissionStep.run(
      "3 vCPU・3 GiBのKafkaクラスタを作る",
      "gcloud managed-kafka clusters create event-kafka --region=us-central1 --subnet=kafka-subnet --cpu=3 --memory=3221225472",
      "--memoryはバイト数で指定します（3221225472 = 3 GiB）。",
    ),
    MissionStep.run(
      "3パーティションのordersトピックを作る",
      "gcloud managed-kafka topics create orders --region=us-central1 --cluster=event-kafka --partitions=3 --replication-factor=3",
    ),
    MissionStep.run(
      "同じVPCからSASL_IAMで接続できることを確かめる",
      "sim kafka connect event-kafka --region=us-central1 --network=default --auth=SASL_IAM",
    ),
  ],
  billing: [
    MissionStep.run("課金データの出力先データセットを作る", ds("finance")),
    MissionStep.run(
      "課金データのexport先をfinanceに設定する",
      "sim billing exports configure finance --location=US",
    ),
    MissionStep.run(
      "課金データをexportする",
      "sim billing exports run",
      "固定の教材データで、実際の課金は発生しません。",
    ),
    MissionStep.run(
      "費用の合計を集計する",
      query("SELECT SUM(cost) AS total FROM finance.gcp_billing_export"),
      "合計15が返れば完了です。",
    ),
  ],
  logs: [
    MissionStep.run("ログの出力先データセットを作る", ds("audit")),
    MissionStep.run(
      "severityがNOTICEのログをauditへ送るシンクを作る",
      `gcloud logging sinks create audit-export bigquery.googleapis.com/projects/${p}/datasets/audit --log-filter='severity=NOTICE'`,
    ),
    MissionStep.run(
      "シンクの書き込み主体にデータセットへの書き込み権限を与える",
      "sim logging sinks grant-writer audit-export --location=US",
      "権限が無いとシンクはログを書き込めません。",
    ),
    MissionStep.run(
      "監査ログを出すためにVMを作る",
      "gcloud compute instances create audit-vm --zone=us-central1-a --machine-type=e2-micro",
      "VMの作成は管理アクティビティの監査ログ（NOTICE）に記録されます。",
    ),
    MissionStep.run(
      "シンクのログをaudit.activityテーブルへ書き出す",
      "sim logging sinks export audit-export --table=audit.activity --location=US",
    ),
    MissionStep.run(
      "書き出したログの件数を数える",
      query("SELECT COUNT(*) AS count FROM audit.activity"),
    ),
  ],
  selection: Object.entries(Workloads).map(([w, s]) =>
    MissionStep.run(
      workloadWhat[w as keyof typeof Workloads],
      `sim data-services choose ${w} --service=${s}`,
    ),
  ),
} as const satisfies Readonly<Record<string, readonly MissionStep[]>>;
export type DataLesson = keyof typeof DataSteps;
/** 各レッスンの解答を端末の行だけで並べたもの（テストがそのまま流す）。 */
export const DataSolutions = Object.fromEntries(
  Object.entries(DataSteps).map(([lesson, steps]) => [lesson, MissionStep.lines(steps)]),
) as Readonly<Record<DataLesson, readonly string[]>>;
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
export const DataMissions: readonly Mission[] = (Object.keys(DataSteps) as DataLesson[]).map(
  (lesson, i) => ({
    id: `m-data-${String(i + 1).padStart(3, "0")}`,
    domain: lesson === "selection" ? "計画と構成" : "運用の維持",
    title: titles[lesson][0],
    description: titles[lesson][1],
    steps: [...DataPreludeSteps, ...DataSteps[lesson]],
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
