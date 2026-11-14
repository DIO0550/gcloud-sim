import { IamPolicy } from "@/engine/domains/iam-policy";
import { findDeployment, latestRevision } from "@/engine/domains/serverless-lab/model";
import { dependencies } from "@/engine/domains/serverless-lab/runtime";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { MissionStep } from "@/engine/missions/mission-step";

export type ServerlessLesson =
  | "public"
  | "private"
  | "canary"
  | "job"
  | "retry"
  | "storage"
  | "firestore"
  | "redis"
  | "secret"
  | "workflow";
export type ServerlessAssertion = Readonly<{ kind: "serverlessLesson"; lesson: ServerlessLesson }>;
const p = F.devProjectId;
const r = "us-central1";
const sa = `lesson-worker@${p}.iam.gserviceaccount.com`;
export const ServerlessPreludeSteps: readonly MissionStep[] = [
  MissionStep.run(
    "サーバーレス教材で使うAPIをまとめて有効にする",
    "gcloud services enable run.googleapis.com cloudfunctions.googleapis.com eventarc.googleapis.com pubsub.googleapis.com vpcaccess.googleapis.com redis.googleapis.com firestore.googleapis.com secretmanager.googleapis.com cloudkms.googleapis.com workflows.googleapis.com",
  ),
  MissionStep.run(
    "関数とサービスを動かす実行SAを作る",
    "gcloud iam service-accounts create lesson-worker",
  ),
  MissionStep.run(
    "自分に実行SAを使う権限を付ける",
    `gcloud iam service-accounts add-iam-policy-binding ${sa} --member=user:${F.owner} --role=roles/iam.serviceAccountUser`,
    "デプロイ時に--service-accountでこのSAを指定するには、Service Account Userが要ります。",
  ),
];
export const ServerlessPrelude: readonly string[] = MissionStep.lines(ServerlessPreludeSteps);
const fn = (what: string, name: string, flags: string, note?: string) =>
  MissionStep.run(
    what,
    `gcloud functions deploy ${name} --region=${r} --runtime=nodejs22 --service-account=${sa} ${flags}`,
    note,
  );
const invoker = (name: string) =>
  MissionStep.run(
    `実行SAに${name}を呼び出す権限を付ける`,
    `gcloud functions add-iam-policy-binding ${name} --region=${r} --member=serviceAccount:${sa} --role=roles/run.invoker`,
    "トリガーやワークフローは、このSAとして関数を呼び出します。",
  );
export const ServerlessSteps: Readonly<Record<ServerlessLesson, readonly MissionStep[]>> = {
  public: [
    MissionStep.run(
      "未認証で呼べるpublic-apiを性能設定付きでデプロイする",
      "gcloud run deploy public-api --region=us-central1 --image=gcr.io/cloudrun/hello --allow-unauthenticated --set-env-vars=STAGE=production --min-instances=1 --max-instances=10 --concurrency=20 --cpu=1 --memory=512Mi --timeout=60s",
      "最小1台・最大10台、1インスタンスあたり同時20リクエスト、1 vCPU・512Mi、タイムアウト60秒です。",
    ),
    MissionStep.run(
      "認証なしで呼び出せるか確かめる",
      "sim run invoke public-api --region=us-central1 --anonymous",
    ),
  ],
  private: [
    fn(
      "内部からだけ受け付けるHTTP関数をデプロイする",
      "private-api",
      "--trigger-http --ingress=internal",
      "--ingress=internalにすると、VPCなど内部からの呼び出しだけを受け付けます。",
    ),
    MissionStep.run(
      "開発者に関数を呼び出す権限を付ける",
      `gcloud functions add-iam-policy-binding private-api --region=${r} --member=user:${F.developer} --role=roles/run.invoker`,
      "実行SAと呼び出す人の権限は別々に設定します。",
    ),
    MissionStep.run(
      "未認証の呼び出しが失敗することを確かめる",
      "gcloud functions call private-api --region=us-central1 --anonymous",
    ),
    MissionStep.run(
      "開発者として内部から呼べるか確かめる",
      `gcloud functions call private-api --region=us-central1 --source=internal --account=${F.developer}`,
    ),
  ],
  canary: [
    MissionStep.run(
      "安定版のrevisionをデプロイする",
      "gcloud run deploy release-api --region=us-central1 --image=gcr.io/cloudrun/hello --set-env-vars=STAGE=stable",
    ),
    MissionStep.run(
      "トラフィックを流さずに新しいrevisionを作る",
      "gcloud run deploy release-api --region=us-central1 --image=gcr.io/cloudrun/hello:v2 --set-env-vars=STAGE=canary --no-traffic",
      "--no-trafficを付けると、デプロイ後も安定版が100%のままです。",
    ),
    MissionStep.run(
      "安定版80%・新版20%に配分する",
      "gcloud run services update-traffic release-api --region=us-central1 --to-revisions=release-api-00001-abc=80,release-api-00002-abc=20",
    ),
    MissionStep.run(
      "安定版のrevisionが応答するか確かめる",
      "sim run invoke release-api --region=us-central1 --revision=release-api-00001-abc",
    ),
    MissionStep.run(
      "新版のrevisionが応答するか確かめる",
      "sim run invoke release-api --region=us-central1 --revision=release-api-00002-abc",
    ),
  ],
  job: [
    MissionStep.run(
      "3タスクのジョブを実行SA付きで作る",
      `gcloud run jobs create batch --region=${r} --image=gcr.io/cloudrun/hello --service-account=${sa} --tasks=3 --set-env-vars=MODE=batch`,
      "ジョブはHTTPを受け付けず、全タスクが終わると完了します。",
    ),
    MissionStep.run(
      "ジョブを実行して完了を待つ",
      "gcloud run jobs execute batch --region=us-central1 --wait",
    ),
  ],
  retry: [
    MissionStep.run("イベント用のトピックを作る", "gcloud pubsub topics create lesson-events"),
    fn(
      "失敗する設定でリトライ付きのイベント関数をデプロイする",
      "event-worker",
      "--trigger-topic=lesson-events --retry --set-env-vars=SIM_FAIL=true",
      "SIM_FAIL=trueで教材のハンドラがわざと失敗します。--retryで失敗したイベントが再配送されます。",
    ),
    invoker("event-worker"),
    MissionStep.run(
      "ハンドラを冪等にする",
      "sim serverless handler event-worker --region=us-central1 --kind=function --idempotent",
      "同じイベントIDを何度受けても、副作用は1回だけ記録されます。",
    ),
    MissionStep.run(
      "メッセージを発行して処理を失敗させる",
      "gcloud pubsub topics publish lesson-events --message=hello",
    ),
    fn("SIM_FAILをfalseにして関数を直す", "event-worker", "--update-env-vars=SIM_FAIL=false"),
    MissionStep.run(
      "失敗したイベントを再試行する",
      "sim events retry EVENT_ID",
      "EVENT_IDにはsim events listで表示されるIDを入れます。",
    ),
    MissionStep.run(
      "同じイベントを再配送して重複を確かめる",
      "sim events replay EVENT_ID",
      "EVENT_IDは再試行と同じIDです。冪等なハンドラなので副作用は増えません。",
    ),
  ],
  storage: [
    MissionStep.run(
      "アップロード先のバケットを作る",
      "gcloud storage buckets create gs://lesson-upload-data --location=us-central1",
    ),
    MissionStep.run(
      "イベントを受けるupload-apiをデプロイする",
      `gcloud run deploy upload-api --region=${r} --image=gcr.io/cloudrun/hello --service-account=${sa}`,
    ),
    MissionStep.run(
      "実行SAにupload-apiを呼び出す権限を付ける",
      `gcloud run services add-iam-policy-binding upload-api --region=${r} --member=serviceAccount:${sa} --role=roles/run.invoker`,
      "Eventarcのトリガーは、このSAとしてサービスを呼び出します。",
    ),
    MissionStep.run(
      "実行SAにEventarcのイベント受信者ロールを付ける",
      `gcloud projects add-iam-policy-binding ${p} --member=serviceAccount:${sa} --role=roles/eventarc.eventReceiver`,
    ),
    MissionStep.run(
      "バケットのオブジェクト作成をupload-apiへ送るトリガーを作る",
      `gcloud eventarc triggers create uploads --location=${r} --destination-run-service=upload-api --service-account=${sa} --event-filters=type=google.cloud.storage.object.v1.finalized,bucket=lesson-upload-data`,
      "bucketのフィルタで、このバケットのイベントだけを受けます。",
    ),
    MissionStep.run(
      "ファイルをアップロードしてイベントを起こす",
      "gcloud storage cp hello.txt gs://lesson-upload-data/hello.txt",
    ),
  ],
  firestore: [
    MissionStep.run(
      "Nativeモードの(default)データベースを作る",
      "gcloud firestore databases create '(default)' --location=us-central1 --type=firestore-native",
    ),
    MissionStep.run(
      "実行SAにFirestoreを読み書きする権限を付ける",
      `gcloud projects add-iam-policy-binding ${p} --member=serviceAccount:${sa} --role=roles/datastore.user`,
    ),
    fn(
      "ordersへのドキュメント作成で動く関数をデプロイする",
      "document-worker",
      "--trigger-event-filters='type=google.cloud.firestore.document.v1.created,database=(default),document=orders/{orderId}' --set-env-vars='FIRESTORE_DATABASE=(default)'",
      "document=orders/{orderId}に合うドキュメントの作成だけを受けます。",
    ),
    invoker("document-worker"),
    MissionStep.run(
      "orders/oneを作ってイベントを起こす",
      "sim firestore documents write orders/one --database='(default)' --data='{" +
        '"status":"new"' +
        "}'",
    ),
  ],
  redis: [
    MissionStep.run(
      "Serverless VPC Accessのコネクタを作る",
      "gcloud compute networks vpc-access connectors create lesson-connector --region=us-central1 --network=default --range=10.8.0.0/28",
      "コネクタには/28の範囲を使います。Redisと同じリージョン・VPCに作ります。",
    ),
    MissionStep.run(
      "defaultネットワークにRedisインスタンスを作る",
      "gcloud redis instances create lesson-cache --region=us-central1 --network=default --size=1",
    ),
    fn(
      "コネクタ経由でRedisへつなぐ関数をデプロイする",
      "cache-api",
      "--trigger-http --vpc-connector=lesson-connector --egress-settings=private-ranges-only --set-env-vars=REDIS_INSTANCE=lesson-cache",
      "private-ranges-onlyでは、内部IP宛ての通信だけがコネクタを通ります。",
    ),
    MissionStep.run(
      "関数を呼んで接続設定を確かめる",
      "gcloud functions call cache-api --region=us-central1",
    ),
  ],
  secret: [
    MissionStep.run(
      "パスワード用のシークレットを作る",
      "gcloud secrets create lesson-password --replication-policy=automatic",
    ),
    MissionStep.run(
      "シークレットに最初のバージョンを入れる",
      "sim secrets versions add lesson-password --data=lesson-only-password",
    ),
    MissionStep.run(
      "実行SAにこのシークレットだけを読む権限を付ける",
      `gcloud secrets add-iam-policy-binding lesson-password --member=serviceAccount:${sa} --role=roles/secretmanager.secretAccessor`,
      "プロジェクト全体ではなく、シークレット単位で付けます。",
    ),
    MissionStep.run(
      "us-central1にキーリングを作る",
      "gcloud kms keyrings create lesson-ring --location=us-central1",
    ),
    MissionStep.run(
      "暗号化用の鍵を作る",
      "gcloud kms keys create lesson-key --location=us-central1 --keyring=lesson-ring --purpose=encryption",
    ),
    MissionStep.run(
      "Runのサービスエージェントに鍵を使う権限を付ける",
      "gcloud kms keys add-iam-policy-binding lesson-key --location=us-central1 --keyring=lesson-ring --member=serviceAccount:SERVICE_AGENT --role=roles/cloudkms.cryptoKeyEncrypterDecrypter",
      "SERVICE_AGENTにはservice-PROJECT_NUMBER@serverless-robot-prod.iam.gserviceaccount.comを入れます。",
    ),
    fn(
      "シークレットとCMEKを使う関数をデプロイする",
      "secret-api",
      `--trigger-http --set-secrets=PASSWORD=lesson-password:1 --key=projects/${p}/locations/${r}/keyRings/lesson-ring/cryptoKeys/lesson-key`,
      "環境変数PASSWORDにシークレットのバージョン1が入ります。",
    ),
    MissionStep.run(
      "鍵のバージョン1を無効にする",
      "gcloud kms keys versions update 1 --location=us-central1 --keyring=lesson-ring --key=lesson-key --state=disabled",
    ),
    MissionStep.run(
      "鍵が無効だと呼び出しが失敗することを確かめる",
      "gcloud functions call secret-api --region=us-central1",
    ),
    MissionStep.run(
      "鍵のバージョン1を有効に戻す",
      "gcloud kms keys versions update 1 --location=us-central1 --keyring=lesson-ring --key=lesson-key --state=enabled",
    ),
    MissionStep.run(
      "呼び出しが復旧したか確かめる",
      "gcloud functions call secret-api --region=us-central1",
    ),
  ],
  workflow: [
    MissionStep.run(
      "ワークフローから呼ぶworkflow-apiをデプロイする",
      `gcloud run deploy workflow-api --region=${r} --image=gcr.io/cloudrun/hello`,
    ),
    fn("ワークフローから呼ぶHTTP関数をデプロイする", "workflow-function", "--trigger-http"),
    MissionStep.run(
      "実行SAにworkflow-apiを呼び出す権限を付ける",
      `gcloud run services add-iam-policy-binding workflow-api --region=${r} --member=serviceAccount:${sa} --role=roles/run.invoker`,
      "権限が足りないと、そのステップでワークフローが失敗します。",
    ),
    invoker("workflow-function"),
    MissionStep.run(
      "実行SAでworkflow.yamlのワークフローをデプロイする",
      `gcloud workflows deploy lesson-workflow --location=${r} --source=workflow.yaml --service-account=${sa}`,
      "workflow.yamlは、2つのHTTPを順に呼ぶ固定の定義です。",
    ),
    MissionStep.run(
      "ワークフローを実行して2つの呼び出しを確かめる",
      "gcloud workflows run lesson-workflow --location=us-central1",
    ),
  ],
};
export const ServerlessSolutions: Readonly<Record<ServerlessLesson, readonly string[]>> =
  Object.fromEntries(
    Object.entries<readonly MissionStep[]>(ServerlessSteps).map(([k, v]) => [
      k,
      MissionStep.lines(v),
    ]),
  ) as Record<ServerlessLesson, readonly string[]>;
const definitions: readonly [ServerlessLesson, string, string][] = [
  [
    "public",
    "HTTPを公開し、性能設定を確認する",
    "環境変数・min/max・concurrency・CPU/memory・timeoutを設定して、未認証の呼び出しを確認します。",
  ],
  [
    "private",
    "認証必須の関数と内部ingressを構成する",
    "実行SAとInvokerを分け、未認証の失敗と内部からの認証付き成功を確認します。",
  ],
  [
    "canary",
    "2つのrevisionへ80/20で段階リリースする",
    "no-trafficで新しいrevisionを作り、配分して両方の設定で応答を確認します。",
  ],
  [
    "job",
    "3タスクのCloud Run jobを実行する",
    "HTTPサービスとの違いを確認し、実行SAで固定バッチの完了履歴を残します。",
  ],
  [
    "retry",
    "イベント失敗を修復し、重複配送を抑える",
    "SIM_FAILを修復して同じイベントIDを再試行・再配送します。冪等な教材ハンドラは副作用を1回だけ記録します。",
  ],
  [
    "storage",
    "StorageイベントをEventarcでRunへ送る",
    "bucket filter、trigger SAのEvent ReceiverとRun Invokerをそろえ、オブジェクト作成で配送を確認します。",
  ],
  [
    "firestore",
    "Firestore作成イベントとDB権限をつなぐ",
    "Native database、document filter、実行SAのDatastore Userを設定してドキュメント作成を処理します。",
  ],
  [
    "redis",
    "VPC connectorでRedisへ接続する",
    "同じリージョン・許可VPCのconnector/Redisを指定します。接続先の存在と設定を評価し、実際の通信は行いません。",
  ],
  [
    "secret",
    "Secret最小権限とCMEK無効化から復旧する",
    "実行SAへSecret Accessor、Runサービスエージェントへ鍵権限を付けます。無効化で失敗し、再有効化で復旧します。",
  ],
  [
    "workflow",
    "Workflowsの実行SAで2つのHTTPを呼ぶ",
    "固定workflow.yamlの2ステップにInvokerを与えます。権限不足はそのステップで失敗します。",
  ],
];
export const ServerlessMissions: readonly Mission[] = definitions.map(
  ([lesson, title, description], i) => ({
    id: `m-serverless-${String(i + 1).padStart(3, "0")}`,
    domain: i > 3 ? "運用の維持" : "計画と構成",
    title,
    description,
    setup: [
      { kind: "setPrincipal", principal: F.owner },
      { kind: "setProject", projectId: p },
    ],
    steps: [...ServerlessPreludeSteps, ...ServerlessSteps[lesson]],
    assertions: [{ kind: "serverlessLesson", lesson }],
  }),
);
export const serverlessSatisfied = (world: World, lesson: ServerlessLesson): boolean => {
  const name = {
    public: "public-api",
    private: "private-api",
    canary: "release-api",
    job: "batch",
    retry: "event-worker",
    storage: "upload-api",
    firestore: "document-worker",
    redis: "cache-api",
    secret: "secret-api",
    workflow: "workflow-api",
  }[lesson];
  const kind = {
    public: "run",
    private: "function",
    canary: "run",
    job: "job",
    retry: "function",
    storage: "run",
    firestore: "function",
    redis: "function",
    secret: "function",
    workflow: "run",
  }[lesson] as "run" | "function" | "job";
  const d = findDeployment(world, { projectId: p, region: r, name }, kind);
  if (!d || dependencies(world, d, latestRevision(d).config)) {
    return false;
  }
  const c = latestRevision(d).config;
  const succeeded = d.invocations.some((v) => v.status === "SUCCEEDED");
  if (lesson === "public") {
    return (
      d.invocations.some((v) => v.status === "SUCCEEDED" && v.principal === "anonymous") &&
      IamPolicy.hasBinding(d.policy, "roles/run.invoker", "allUsers") &&
      c.env.STAGE === "production" &&
      c.minInstances === 1 &&
      c.maxInstances === 10 &&
      c.concurrency === 20 &&
      c.cpu === 1 &&
      c.memoryMb === 512 &&
      c.timeoutSeconds === 60
    );
  }
  if (lesson === "private") {
    return (
      c.serviceAccount === sa &&
      c.ingress === "internal" &&
      d.invocations.some(
        (v) => v.status === "SUCCEEDED" && v.principal === F.developer && v.source === "internal",
      ) &&
      d.invocations.some((v) => v.status === "FAILED" && v.principal === "anonymous") &&
      !IamPolicy.hasBinding(d.policy, "roles/run.invoker", "allUsers") &&
      IamPolicy.hasBinding(d.policy, "roles/run.invoker", `user:${F.developer}`)
    );
  }
  if (lesson === "canary") {
    return (
      d.revisions.length >= 2 &&
      Object.keys(d.traffic).length === 2 &&
      Object.entries(d.traffic).every(
        ([rev, percent]) =>
          [20, 80].includes(percent) &&
          d.invocations.some((v) => v.revision === rev && v.status === "SUCCEEDED"),
      )
    );
  }
  if (lesson === "job") {
    return succeeded && d.tasks === 3 && c.env.MODE === "batch" && c.serviceAccount === sa;
  }
  if (lesson === "retry") {
    return (
      d.retry &&
      c.idempotent &&
      c.env.SIM_FAIL === "false" &&
      world.serverlessLab.deliveries.some(
        (v) =>
          v.target.endsWith(`/function/${name}`) &&
          v.status === "SUCCEEDED" &&
          v.attempts >= 3 &&
          v.effects === 1 &&
          v.duplicates >= 1,
      )
    );
  }
  if (lesson === "storage" || lesson === "firestore") {
    const source = lesson === "storage" ? "lesson-upload-data" : "(default)";
    return world.serverlessLab.events.some(
      (e) =>
        e.projectId === p &&
        e.source === source &&
        world.serverlessLab.deliveries.some(
          (v) =>
            v.eventId === e.id &&
            v.target.endsWith(`/${kind}/${name}`) &&
            v.status === "SUCCEEDED" &&
            v.effects >= 1,
        ),
    );
  }
  if (lesson === "redis") {
    return (
      succeeded && c.connector === "lesson-connector" && c.env.REDIS_INSTANCE === "lesson-cache"
    );
  }
  if (lesson === "secret") {
    return (
      succeeded &&
      c.serviceAccount === sa &&
      c.secrets.PASSWORD === "lesson-password:1" &&
      c.cmek.endsWith("/cryptoKeys/lesson-key") &&
      d.invocations.some((v) => v.status === "FAILED" && v.reason.includes("CMEK"))
    );
  }
  return world.serverlessLab.workflows.some(
    (w) =>
      w.projectId === p &&
      w.region === r &&
      w.name === "lesson-workflow" &&
      w.serviceAccount === sa &&
      w.executions.some((v) => v.status === "SUCCEEDED"),
  );
};
