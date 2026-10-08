import { IamPolicy } from "@/engine/domains/iam-policy";
import { findDeployment, latestRevision } from "@/engine/domains/serverless-lab/model";
import { dependencies } from "@/engine/domains/serverless-lab/runtime";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";

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
export const ServerlessPrelude: readonly string[] = [
  "gcloud services enable run.googleapis.com cloudfunctions.googleapis.com eventarc.googleapis.com pubsub.googleapis.com vpcaccess.googleapis.com redis.googleapis.com firestore.googleapis.com secretmanager.googleapis.com cloudkms.googleapis.com workflows.googleapis.com",
  "gcloud iam service-accounts create lesson-worker",
  `gcloud iam service-accounts add-iam-policy-binding ${sa} --member=user:${F.owner} --role=roles/iam.serviceAccountUser`,
];
const fn = (name: string, flags: string) =>
  `gcloud functions deploy ${name} --region=${r} --runtime=nodejs22 --service-account=${sa} ${flags}`;
const invoker = (name: string) =>
  `gcloud functions add-iam-policy-binding ${name} --region=${r} --member=serviceAccount:${sa} --role=roles/run.invoker`;
export const ServerlessSolutions: Readonly<Record<ServerlessLesson, readonly string[]>> = {
  public: [
    "gcloud run deploy public-api --region=us-central1 --image=gcr.io/cloudrun/hello --allow-unauthenticated --set-env-vars=STAGE=production --min-instances=1 --max-instances=10 --concurrency=20 --cpu=1 --memory=512Mi --timeout=60s",
    "sim run invoke public-api --region=us-central1 --anonymous",
  ],
  private: [
    fn("private-api", "--trigger-http --ingress=internal"),
    `gcloud functions add-iam-policy-binding private-api --region=${r} --member=user:${F.developer} --role=roles/run.invoker`,
    "gcloud functions call private-api --region=us-central1 --anonymous",
    `gcloud functions call private-api --region=us-central1 --source=internal --account=${F.developer}`,
  ],
  canary: [
    "gcloud run deploy release-api --region=us-central1 --image=gcr.io/cloudrun/hello --set-env-vars=STAGE=stable",
    "gcloud run deploy release-api --region=us-central1 --image=gcr.io/cloudrun/hello:v2 --set-env-vars=STAGE=canary --no-traffic",
    "gcloud run services update-traffic release-api --region=us-central1 --to-revisions=release-api-00001-abc=80,release-api-00002-abc=20",
    "sim run invoke release-api --region=us-central1 --revision=release-api-00001-abc",
    "sim run invoke release-api --region=us-central1 --revision=release-api-00002-abc",
  ],
  job: [
    `gcloud run jobs create batch --region=${r} --image=gcr.io/cloudrun/hello --service-account=${sa} --tasks=3 --set-env-vars=MODE=batch`,
    "gcloud run jobs execute batch --region=us-central1 --wait",
  ],
  retry: [
    "gcloud pubsub topics create lesson-events",
    fn("event-worker", "--trigger-topic=lesson-events --retry --set-env-vars=SIM_FAIL=true"),
    invoker("event-worker"),
    "sim serverless handler event-worker --region=us-central1 --kind=function --idempotent",
    "gcloud pubsub topics publish lesson-events --message=hello",
    fn("event-worker", "--update-env-vars=SIM_FAIL=false"),
    "sim events retry EVENT_ID",
    "sim events replay EVENT_ID",
  ],
  storage: [
    "gcloud storage buckets create gs://lesson-upload-data --location=us-central1",
    `gcloud run deploy upload-api --region=${r} --image=gcr.io/cloudrun/hello --service-account=${sa}`,
    `gcloud run services add-iam-policy-binding upload-api --region=${r} --member=serviceAccount:${sa} --role=roles/run.invoker`,
    `gcloud projects add-iam-policy-binding ${p} --member=serviceAccount:${sa} --role=roles/eventarc.eventReceiver`,
    `gcloud eventarc triggers create uploads --location=${r} --destination-run-service=upload-api --service-account=${sa} --event-filters=type=google.cloud.storage.object.v1.finalized,bucket=lesson-upload-data`,
    "gcloud storage cp hello.txt gs://lesson-upload-data/hello.txt",
  ],
  firestore: [
    "gcloud firestore databases create '(default)' --location=us-central1 --type=firestore-native",
    `gcloud projects add-iam-policy-binding ${p} --member=serviceAccount:${sa} --role=roles/datastore.user`,
    fn(
      "document-worker",
      "--trigger-event-filters='type=google.cloud.firestore.document.v1.created,database=(default),document=orders/{orderId}' --set-env-vars='FIRESTORE_DATABASE=(default)'",
    ),
    invoker("document-worker"),
    "sim firestore documents write orders/one --database='(default)' --data='{" +
      '"status":"new"' +
      "}'",
  ],
  redis: [
    "gcloud compute networks vpc-access connectors create lesson-connector --region=us-central1 --network=default --range=10.8.0.0/28",
    "gcloud redis instances create lesson-cache --region=us-central1 --network=default --size=1",
    fn(
      "cache-api",
      "--trigger-http --vpc-connector=lesson-connector --egress-settings=private-ranges-only --set-env-vars=REDIS_INSTANCE=lesson-cache",
    ),
    "gcloud functions call cache-api --region=us-central1",
  ],
  secret: [
    "gcloud secrets create lesson-password --replication-policy=automatic",
    "sim secrets versions add lesson-password --data=lesson-only-password",
    `gcloud secrets add-iam-policy-binding lesson-password --member=serviceAccount:${sa} --role=roles/secretmanager.secretAccessor`,
    "gcloud kms keyrings create lesson-ring --location=us-central1",
    "gcloud kms keys create lesson-key --location=us-central1 --keyring=lesson-ring --purpose=encryption",
    "gcloud kms keys add-iam-policy-binding lesson-key --location=us-central1 --keyring=lesson-ring --member=serviceAccount:SERVICE_AGENT --role=roles/cloudkms.cryptoKeyEncrypterDecrypter",
    fn(
      "secret-api",
      `--trigger-http --set-secrets=PASSWORD=lesson-password:1 --key=projects/${p}/locations/${r}/keyRings/lesson-ring/cryptoKeys/lesson-key`,
    ),
    "gcloud kms keys versions update 1 --location=us-central1 --keyring=lesson-ring --key=lesson-key --state=disabled",
    "gcloud functions call secret-api --region=us-central1",
    "gcloud kms keys versions update 1 --location=us-central1 --keyring=lesson-ring --key=lesson-key --state=enabled",
    "gcloud functions call secret-api --region=us-central1",
  ],
  workflow: [
    `gcloud run deploy workflow-api --region=${r} --image=gcr.io/cloudrun/hello`,
    fn("workflow-function", "--trigger-http"),
    `gcloud run services add-iam-policy-binding workflow-api --region=${r} --member=serviceAccount:${sa} --role=roles/run.invoker`,
    invoker("workflow-function"),
    `gcloud workflows deploy lesson-workflow --location=${r} --source=workflow.yaml --service-account=${sa}`,
    "gcloud workflows run lesson-workflow --location=us-central1",
  ],
};
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
    hints: [
      ...ServerlessPrelude,
      ...ServerlessSolutions[lesson],
      "EVENT_IDはsim events listのID。SERVICE_AGENTはservice-PROJECT_NUMBER@serverless-robot-prod.iam.gserviceaccount.com。",
    ],
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
