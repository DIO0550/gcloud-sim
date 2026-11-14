import { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { MissionStep } from "@/engine/missions/mission-step";
import { Option } from "@/utils/Option";

export type ObservabilityAssertion =
  | Readonly<{ kind: "logMetricConfigured"; projectId: string; name: string; filter: string }>
  | Readonly<{
      kind: "uptimeConfigured";
      projectId: string;
      displayName: string;
      host: string;
      path: string;
      protocol: "https";
      period: string;
    }>
  | Readonly<{
      kind: "dashboardConfigured";
      projectId: string;
      displayName: string;
      filter: string;
    }>
  | Readonly<{
      kind: "alertConfigured";
      projectId: string;
      displayName: string;
      filter: string;
      threshold: number;
      duration: string;
    }>
  | Readonly<{
      kind: "logExportConfigured";
      projectId: string;
      name: string;
      bucket: string;
      filter: string;
    }>;

const cpuFilter =
  'metric.type="compute.googleapis.com/instance/cpu/utilization" AND resource.type="gce_instance"';
const setup = [
  { kind: "setPrincipal", principal: F.owner },
  { kind: "setProject", projectId: F.devProjectId },
] as const;

export const ObservabilityMissions: readonly Mission[] = [
  {
    id: "m-observe-001",
    domain: "運用の維持",
    title: "エラーログをカウンタ指標にする",
    description:
      "ace-dev-01 に user_errors というログベースのカウンタ指標を作成してください。フィルタは severity>=ERROR とします。ログの件数を監視できる設定を学ぶ演習です（実際のメトリクス取り込みは再現しません）。",
    setup,
    steps: [
      MissionStep.run(
        "ERROR以上のログを数えるカウンタ指標を作る",
        "gcloud logging metrics create user_errors --log-filter='severity>=ERROR'",
        "logging.googleapis.com が必要です。",
      ),
      MissionStep.run(
        "指標のフィルタと種類を確かめる",
        "gcloud logging metrics describe user_errors",
        "フィルタとmetricDescriptorを確認します。",
      ),
    ],
    assertions: [
      {
        kind: "logMetricConfigured",
        projectId: F.devProjectId,
        name: "user_errors",
        filter: "severity>=ERROR",
      },
    ],
  },
  {
    id: "m-observe-002",
    domain: "運用の維持",
    title: "HTTPSの稼働時間チェックを構成する",
    description:
      "ace-dev-01 で表示名 public-web、対象 example.com/healthz、HTTPS 443番、5分間隔の稼働時間チェックを設定してください。設定のみを再現し、実際のURLには接続しません。",
    setup,
    steps: [
      MissionStep.run(
        "example.com/healthzを5分ごとにHTTPSで確かめるチェックを作る",
        "gcloud monitoring uptime create public-web --resource-type=uptime-url --resource-labels=host=example.com,project_id=ace-dev-01 --protocol=https --path=/healthz --period=5",
        "書式は gcloud monitoring uptime create DISPLAY_NAME --resource-type=uptime-url --resource-labels=host=HOST,project_id=PROJECT です。",
      ),
      MissionStep.run("作成したチェックのIDを調べる", "gcloud monitoring uptime list"),
      MissionStep.run(
        "チェックの設定を確かめる",
        "gcloud monitoring uptime describe ID",
        "IDには前の手順の一覧で調べたチェックのIDを入れます。",
      ),
    ],
    assertions: [
      {
        kind: "uptimeConfigured",
        projectId: F.devProjectId,
        displayName: "public-web",
        host: "example.com",
        path: "/healthz",
        protocol: "https",
        period: "300s",
      },
    ],
  },
  {
    id: "m-observe-003",
    domain: "運用の維持",
    title: "VMのCPUダッシュボードを作る",
    description:
      "ace-dev-01 に表示名 VM CPU のダッシュボードを作成してください。組み込みの cpu-dashboard.json は Compute Engine のCPU使用率を対象にした1チャートの設定です。validate-onlyと作成を区別します。",
    setup,
    steps: [
      MissionStep.run(
        "保存せずに設定ファイルを検証する",
        "gcloud monitoring dashboards create --config-from-file=cpu-dashboard.json --validate-only",
        "--validate-only は検証だけで、ダッシュボードは保存しません。",
      ),
      MissionStep.run(
        "設定ファイルからダッシュボードを作る",
        "gcloud monitoring dashboards create --config-from-file=cpu-dashboard.json",
      ),
      MissionStep.run("作成されたことを一覧で確かめる", "gcloud monitoring dashboards list"),
    ],
    assertions: [
      {
        kind: "dashboardConfigured",
        projectId: F.devProjectId,
        displayName: "VM CPU",
        filter: cpuFilter,
      },
    ],
  },
  {
    id: "m-observe-004",
    domain: "運用の維持",
    title: "CPU使用率が高い状態のアラートを設定する",
    description:
      "ace-dev-01 に CPU high という有効なアラートポリシーを作成してください。gce_instance の compute.googleapis.com/instance/cpu/utilization が0.8を超える状態が300秒続く条件とします。実際の評価・インシデント・通知は再現しません。",
    setup,
    steps: [
      MissionStep.run(
        "CPU使用率0.8超えが300秒続くと発火するポリシーを作る",
        `gcloud monitoring policies create --display-name='CPU high' --condition-display-name='CPU > 80%' --condition-filter='${cpuFilter}' --if='> 0.8' --duration=300s`,
        "--if='> 0.8' と --duration=300s でしきい値と継続時間を指定します。--no-enabled を付けた無効なポリシーでは完了しません。",
      ),
    ],
    assertions: [
      {
        kind: "alertConfigured",
        projectId: F.devProjectId,
        displayName: "CPU high",
        filter: cpuFilter,
        threshold: 0.8,
        duration: "300s",
      },
    ],
  },
  {
    id: "m-observe-005",
    domain: "アクセスとセキュリティ",
    title: "ログ転送先と書き込み権限をそろえる",
    description:
      "ace-dev-01 に ace-audit-logs バケットと audit-export シンクを作り、severity>=ERROR の転送先をそのバケットに設定してください。シンクのwriterIdentityに、そのバケットのStorage Object Creatorを付与します。転送設定のみの演習で、実際のログ配送は再現しません。",
    setup,
    steps: [
      MissionStep.run(
        "ログの転送先にするバケットを作る",
        "gcloud storage buckets create gs://ace-audit-logs --location=asia-northeast1",
      ),
      MissionStep.run(
        "ERROR以上のログをバケットへ送るシンクを作る",
        "gcloud logging sinks create audit-export storage.googleapis.com/ace-audit-logs --log-filter='severity>=ERROR'",
      ),
      MissionStep.run(
        "シンクの書き込み主体を調べる",
        "gcloud logging sinks describe audit-export --format='value(writerIdentity)'",
      ),
      MissionStep.run(
        "書き込み主体にバケットへの書き込みを許可する",
        "gcloud storage buckets add-iam-policy-binding gs://ace-audit-logs --member=取得したwriterIdentity --role=roles/storage.objectCreator",
        "「取得したwriterIdentity」には、前の手順で表示された serviceAccount:… の値をそのまま入れます。",
      ),
    ],
    assertions: [
      {
        kind: "logExportConfigured",
        projectId: F.devProjectId,
        name: "audit-export",
        bucket: "ace-audit-logs",
        filter: "severity>=ERROR",
      },
    ],
  },
];

export const observabilitySatisfied = (
  world: World,
  assertion: ObservabilityAssertion,
): boolean => {
  const projectId = assertion.projectId;
  switch (assertion.kind) {
    case "logMetricConfigured":
      return world.logMetrics.some(
        (m) =>
          m.projectId === projectId && m.name === assertion.name && m.filter === assertion.filter,
      );
    case "uptimeConfigured":
      return world.uptimeChecks.some(
        (c) =>
          c.projectId === projectId &&
          c.displayName === assertion.displayName &&
          c.host === assertion.host &&
          c.path === assertion.path &&
          c.protocol === assertion.protocol &&
          c.port === 443 &&
          c.period === assertion.period,
      );
    case "dashboardConfigured":
      return world.dashboards.some(
        (d) =>
          d.projectId === projectId &&
          d.displayName === assertion.displayName &&
          d.filter === assertion.filter,
      );
    case "alertConfigured":
      return world.alertPolicies.some(
        (p) =>
          p.projectId === projectId &&
          p.displayName === assertion.displayName &&
          p.enabled &&
          p.filter === assertion.filter &&
          p.comparison === "COMPARISON_GT" &&
          p.threshold === assertion.threshold &&
          p.duration === assertion.duration,
      );
    case "logExportConfigured": {
      const sink = World.findNamed(world, "logSinks", { projectId, name: assertion.name });
      const bucket = World.findBucket(world, assertion.bucket);
      if (!Option.isSome(sink) || !Option.isSome(bucket)) return false;
      return (
        bucket.value.projectId === projectId &&
        sink.value.filter === assertion.filter &&
        sink.value.destination === `storage.googleapis.com/${assertion.bucket}` &&
        bucket.value.iamPolicy.bindings.some(
          (b) =>
            b.role === "roles/storage.objectCreator" &&
            b.members.some((member) => member === sink.value.writerIdentity),
        )
      );
    }
  }
};
