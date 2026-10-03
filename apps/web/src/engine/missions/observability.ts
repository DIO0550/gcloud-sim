import { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
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
    hints: [
      "logging.googleapis.com が必要です。",
      "gcloud logging metrics create user_errors --log-filter='severity>=ERROR'",
      "gcloud logging metrics describe user_errors でフィルタとmetricDescriptorを確認します。",
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
    hints: [
      "gcloud monitoring uptime create DISPLAY_NAME --resource-type=uptime-url --resource-labels=host=HOST,project_id=PROJECT を使います。",
      "gcloud monitoring uptime create public-web --resource-type=uptime-url --resource-labels=host=example.com,project_id=ace-dev-01 --protocol=https --path=/healthz --period=5",
      "gcloud monitoring uptime list でIDを調べ、describe IDで設定を確認します。",
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
    hints: [
      "gcloud monitoring dashboards create --config-from-file=cpu-dashboard.json --validate-only は保存しません。",
      "gcloud monitoring dashboards create --config-from-file=cpu-dashboard.json",
      "gcloud monitoring dashboards list で作成を確認します。",
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
    hints: [
      "--if='> 0.8' と --duration=300s でしきい値と継続時間を指定します。",
      `gcloud monitoring policies create --display-name='CPU high' --condition-display-name='CPU > 80%' --condition-filter='${cpuFilter}' --if='> 0.8' --duration=300s`,
      "--no-enabled を付けた無効なポリシーでは完了しません。",
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
    hints: [
      "gcloud storage buckets create gs://ace-audit-logs --location=asia-northeast1",
      "gcloud logging sinks create audit-export storage.googleapis.com/ace-audit-logs --log-filter='severity>=ERROR'",
      "gcloud logging sinks describe audit-export --format='value(writerIdentity)' で主体を確認します。",
      "gcloud storage buckets add-iam-policy-binding gs://ace-audit-logs --member=取得したwriterIdentity --role=roles/storage.objectCreator",
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
