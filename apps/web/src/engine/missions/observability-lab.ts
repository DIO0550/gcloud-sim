import { evaluateConnection } from "@/engine/domains/network-lab/model";
import { collectorStatus } from "@/engine/domains/observability-lab/collectors";
import { evaluateAlert, objectiveResult } from "@/engine/domains/observability-lab/evaluation";
import { auditEnabled, storedLogs } from "@/engine/domains/observability-lab/logging";
import { ObserveCpuMetric } from "@/engine/domains/observability-lab/model";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";

const p = F.devProjectId;
const z = "us-central1-a";
const metric = "custom.googleapis.com/ace/latency";
const filter = (type = ObserveCpuMetric, resource = "gce_instance") =>
  `metric.type="${type}" AND resource.type="${resource}"`;
export const ObserveThreshold = (
  type = ObserveCpuMetric,
  resource = "gce_instance",
  missing = "INACTIVE",
  thresholdValue = 0.8,
) => ({
  displayName: "high",
  conditionThreshold: {
    filter: filter(type, resource),
    comparison: "COMPARISON_GT",
    thresholdValue,
    duration: "60s",
    evaluationMissingData: `EVALUATION_MISSING_DATA_${missing}`,
  },
});
export const ObservePolicyFile = (
  label: string,
  conditions: readonly unknown[],
  combiner = "OR",
  channels: readonly string[] = [],
) => [
  `sim files write ${label}.json --content='${JSON.stringify({ displayName: label, combiner, conditions, notificationChannels: channels.map((c) => `projects/${p}/notificationChannels/${c}`) })}'`,
  `gcloud monitoring policies create --policy-from-file=${label}.json`,
];
const tick = (seconds = 60) => `sim monitoring clock advance --seconds=${seconds}`;
const vm = `gcloud compute instances create observe-vm --zone=${z}`;
const point = (
  value = 0.9,
  type = ObserveCpuMetric,
  resource = "observe-vm",
  resourceType = "gce_instance",
  project: string = p,
) =>
  `sim monitoring time-series write --metric=${type} --resource=${resource} --resource-type=${resourceType} --value=${value} --project=${project}`;
const evaluate = (policy: string) => `sim monitoring policies evaluate ${policy}`;
const account = `observe-agent@${p}.iam.gserviceaccount.com`;
const writer = [
  "gcloud iam service-accounts create observe-agent",
  `gcloud iam service-accounts add-iam-policy-binding ${account} --member=user:${F.owner} --role=roles/iam.serviceAccountUser`,
  `gcloud projects add-iam-policy-binding ${p} --member=serviceAccount:${account} --role=roles/monitoring.metricWriter`,
  `gcloud projects add-iam-policy-binding ${p} --member=serviceAccount:${account} --role=roles/logging.logWriter`,
];
export const ObservePrelude = [
  "gcloud services enable monitoring.googleapis.com logging.googleapis.com compute.googleapis.com bigquery.googleapis.com container.googleapis.com",
];
export const ObserveSolutions = {
  notification: [
    vm,
    "gcloud monitoring channels create --display-name=oncall --type=email --channel-labels=email_address=oncall@example.com",
    ...ObservePolicyFile("cpu-high", [ObserveThreshold()], "OR", ["oncall"]),
    point(),
    tick(),
    point(),
    evaluate("cpu-high"),
    "sim monitoring channels verify oncall",
    evaluate("cpu-high"),
  ],
  missing: [
    vm,
    ...ObservePolicyFile("missing-data", [
      ObserveThreshold(ObserveCpuMetric, "gce_instance", "ACTIVE"),
    ]),
    point(0.2),
    tick(120),
    evaluate("missing-data"),
  ],
  absence: [
    vm,
    ...ObservePolicyFile("no-samples", [
      { displayName: "absent", conditionAbsent: { filter: filter(), duration: "120s" } },
    ]),
    point(0.2),
    tick(120),
    evaluate("no-samples"),
  ],
  combiner: [
    vm,
    "gcloud compute instances create observe-other --zone=us-central1-a",
    ...ObservePolicyFile(
      "cpu-combined",
      [
        ObserveThreshold(),
        {
          displayName: "low",
          conditionThreshold: {
            filter: filter(),
            comparison: "COMPARISON_LT",
            thresholdValue: 0.3,
            duration: "60s",
          },
        },
      ],
      "AND",
    ),
    point(),
    point(0.2, ObserveCpuMetric, "observe-other"),
    tick(),
    point(),
    point(0.2, ObserveCpuMetric, "observe-other"),
    evaluate("cpu-combined"),
  ],
  scope: [
    `gcloud services enable monitoring.googleapis.com --project=${F.prodProjectId}`,
    `sim monitoring metric-descriptors create latency --type=${metric} --resource-type=generic_task --project=${F.prodProjectId}`,
    ...ObservePolicyFile("latency-high", [ObserveThreshold(metric, "generic_task", "INACTIVE", 5)]),
    point(10, metric, "api", "generic_task", F.prodProjectId),
    tick(),
    point(10, metric, "api", "generic_task", F.prodProjectId),
    `gcloud beta monitoring metrics-scopes create projects/${F.prodProjectId}`,
    evaluate("latency-high"),
  ],
  promql: [
    vm,
    ...ObservePolicyFile("promql-high", [
      {
        displayName: "promql",
        conditionPrometheusQueryLanguage: {
          query:
            'compute_googleapis_com:instance_cpu_utilization{monitored_resource="gce_instance"} > 0.8',
          duration: "60s",
          evaluationInterval: "30s",
        },
      },
    ]),
    point(),
    tick(),
    point(),
    evaluate("promql-high"),
  ],
  slo: [
    "sim monitoring slos create availability --goal=0.99 --rolling-days=1 --model=request",
    "sim monitoring slos create windows --goal=0.9 --rolling-days=1 --model=windows",
    "sim monitoring slos record availability --good=98 --total=100",
    "sim monitoring slos record windows --good=98 --total=100",
  ],
  agent: [
    ...writer,
    `gcloud compute instances create observe-vm --zone=${z} --service-account=${account} --scopes=cloud-platform`,
    `sim monitoring collectors configure agent --kind=ops-agent --resource=observe-vm --location=${z} --service-account=${account}`,
    "sim monitoring collectors collect agent",
  ],
  prometheus: [
    ...writer,
    `gcloud container clusters create-auto observe-gke --region=us-central1 --service-account=${account}`,
    "kubectl create deployment observe-app --image=gcr.io/google-samples/hello-app:1.0 --replicas=1",
    `sim monitoring collectors configure prometheus --kind=managed-prometheus --resource=observe-gke --location=us-central1 --service-account=${account} --namespace=default --selector=app=observe-app --port=8080`,
    "sim monitoring collectors collect prometheus",
  ],
  routing: [
    "gcloud logging buckets create archive --location=us-central1 --retention-days=7 --enable-analytics",
    `gcloud logging sinks create archive-sink logging.googleapis.com/projects/${p}/locations/us-central1/buckets/archive --log-filter='resource.type="gce_instance"'`,
    "sim logging exclusions configure skip-data --sink=archive-sink --log-filter='logName:cloudaudit.googleapis.com%2Fdata_access'",
    "gcloud logging views create compute --bucket=archive --location=us-central1 --log-filter='resource.type=" +
      '"gce_instance"' +
      "'",
    "bq mk observe_logs --dataset --location=us-central1",
    "sim logging analytics links create linked --bucket=archive --location=us-central1 --dataset=observe_logs",
    `gcloud logging sinks create bq-sink bigquery.googleapis.com/projects/${p}/datasets/observe_logs --log-filter='severity=NOTICE'`,
    "sim logging sinks grant-writer bq-sink --location=us-central1",
    vm,
    "sim logging sinks export bq-sink --location=us-central1 --table=observe_logs.audit",
  ],
  audit: [
    "sim logging audit configure --scope=projects/ace-dev-01 --service=compute.googleapis.com --data-read",
    ...["ADMIN_ACTIVITY", "DATA_ACCESS", "SYSTEM_EVENT", "POLICY_DENIED"].map(
      (category) =>
        `sim logging audit emit --category=${category} --service=compute.googleapis.com`,
    ),
  ],
  diagnosis: [
    "gcloud compute networks create observe-net --subnet-mode=custom",
    "gcloud compute networks subnets create observe-subnet --network=observe-net --region=us-central1 --range=10.61.0.0/24 --enable-flow-logs",
    ...["client", "server"].map(
      (name) =>
        `gcloud compute instances create observe-${name} --zone=${z} --network=observe-net --subnet=observe-subnet --no-address`,
    ),
    "gcloud compute firewall-rules create observe-deny --network=observe-net --action=DENY --rules=tcp:80 --priority=500 --source-ranges=10.61.0.0/24 --enable-logging",
    `sim network connectivity observe-client --zone=${z} --destination=observe-server --port=80`,
    "gcloud compute firewall-rules create observe-allow --network=observe-net --allow=tcp:80 --priority=100 --source-ranges=10.61.0.0/24 --enable-logging",
    `sim network connectivity observe-client --zone=${z} --destination=observe-server --port=80`,
  ],
} as const;
export type ObserveLesson = keyof typeof ObserveSolutions;
export type ObserveAssertion = Readonly<{ kind: "observationLesson"; lesson: ObserveLesson }>;
const descriptions: Record<ObserveLesson, readonly [string, string]> = {
  notification: [
    "継続するCPU高負荷を検証済み通知先に届ける",
    "oncallチャネルとcpu-highを結び、60秒継続するCPU > 0.8を評価。未検証で通知されないことを確認してから検証し再評価する。",
  ],
  missing: [
    "欠測を異常として扱う",
    "missing-dataをACTIVE欠測モードにし、正常サンプルが途絶えて120秒経過後に評価する。",
  ],
  absence: [
    "サンプル消失を検知する",
    "no-samplesで120秒のabsenceを設定。一度届いたサンプルが途絶えた後に評価する。未観測の系列は発火しない。",
  ],
  combiner: [
    "別リソースの条件をANDで結合する",
    "cpu-combinedをANDで作り、observe-vmの高負荷とobserve-otherの低負荷を各60秒継続させる。matching-resourceとの違いを学ぶ。",
  ],
  scope: [
    "別プロジェクトのcustom metricを監視する",
    "本番側のlatencyを開発側のmetrics scopeへ接続し、latency-highで60秒継続する値10を評価する。データはコピーしない。",
  ],
  promql: [
    "限定PromQLでCPUを評価する",
    "promql-highでCPUセレクタの > 0.8を60秒継続して評価する。式・関数は教材では実行しない。",
  ],
  slo: [
    "SLIと残りエラーバジェットを比較する",
    "availabilityはrequest目標0.99、windowsは時間区間目標0.9。各98/100の区間を記録し、requestと等重み区間のOUT_OF_SLOを比較する。",
  ],
  agent: [
    "Ops AgentのVM認証条件を揃える",
    "observe-agentをobserve-vmへ接続し、metricWriter/logWriterとcloud-platformスコープを揃えてagentから固定サンプルを収集する。",
  ],
  prometheus: [
    "Managed Prometheusの収集対象を揃える",
    "observe-gkeのノードIDにmetricWriterを付け、observe-appのPodMonitoring相当のラベル/namespace/8080を設定して固定サンプルを収集する。",
  ],
  routing: [
    "ログをビュー・Analytics・BigQueryへ届ける",
    "archiveバケットを保持7日/Analyticsで構成し、computeビュー、skip-data除外、linkedリンクを作る。bq-sinkのwriterへ権限を付けて新しいVM操作をexportする。",
  ],
  audit: [
    "4種類の監査ログを区別する",
    "ComputeのData Access dataReadを有効にして4種類の固定監査ログを取り込む。Admin/Systemは_Required、Data/Deniedは_Defaultへ保存する。",
  ],
  diagnosis: [
    "flow/firewallログで通信障害を診断する",
    "observe-netでflow logsとfirewall loggingを有効にし、observe-client→observe-serverの80番通信を拒否ログで確認。優先度100の許可ルールで復旧し再確認する。",
  ],
};
export const ObserveMissions: readonly Mission[] = (
  Object.keys(ObserveSolutions) as ObserveLesson[]
).map((lesson, index) => ({
  id: `m-observe-lab-${String(index + 1).padStart(3, "0")}`,
  domain: "運用の維持",
  title: descriptions[lesson][0],
  description: `${descriptions[lesson][1]} すべて教材内の仮想データ。`,
  hints: [...ObservePrelude, ...ObserveSolutions[lesson]],
  setup: [
    { kind: "setPrincipal", principal: F.owner },
    { kind: "setProject", projectId: p },
  ],
  assertions: [{ kind: "observationLesson", lesson }],
}));
const policies: Partial<Record<ObserveLesson, string>> = {
  notification: "cpu-high",
  missing: "missing-data",
  absence: "no-samples",
  combiner: "cpu-combined",
  scope: "latency-high",
  promql: "promql-high",
};
export const observeSatisfied = (world: World, lesson: ObserveLesson): boolean => {
  const lab = world.observabilityLab;
  const label = policies[lesson];
  if (label) {
    const policy = world.alertPolicies.find(
      (q) => q.projectId === p && q.displayName === label && q.enabled,
    );
    const configuration = lab.policies.find((q) => q.projectId === p && q.name === policy?.name);
    const evidence = lab.evaluations.find(
      (q) => q.projectId === p && q.name === policy?.name && q.time === lab.clock,
    );
    if (!configuration || !evidence?.active || !evaluateAlert(world, configuration).active) {
      return false;
    }
    if (lesson !== "combiner" && configuration.conditions.length !== 1) {
      return false;
    }
    const first = configuration.conditions[0];
    if (
      !first ||
      first.resourceType !== (lesson === "scope" ? "generic_task" : "gce_instance") ||
      first.metric !== (lesson === "scope" ? metric : ObserveCpuMetric)
    ) {
      return false;
    }
    if (
      lesson !== "absence" &&
      (first.comparison !== "COMPARISON_GT" ||
        first.duration !== 60 ||
        first.threshold !== (lesson === "scope" ? 5 : 0.8))
    ) {
      return false;
    }
    if (lesson === "notification") {
      return (
        configuration.conditions[0]?.kind === "threshold" &&
        configuration.conditions[0]?.missing === "INACTIVE" &&
        configuration.conditions[0]?.duration === 60 &&
        configuration.channels.includes("oncall") &&
        evidence.notifications.includes("oncall") &&
        lab.channels.some(
          (c) => c.projectId === p && c.name === "oncall" && c.verified && c.enabled,
        )
      );
    }
    if (lesson === "absence") {
      return (
        configuration.conditions[0]?.kind === "absence" &&
        configuration.conditions[0].duration === 120
      );
    }
    if (lesson === "missing") {
      return (
        configuration.conditions[0]?.missing === "ACTIVE" && evidence.results.some((r) => r.active)
      );
    }
    if (lesson === "combiner") {
      return (
        configuration.combiner === "AND" &&
        configuration.conditions.length === 2 &&
        !evaluateAlert(world, { ...configuration, combiner: "AND_WITH_MATCHING_RESOURCE" }).active
      );
    }
    if (lesson === "scope") {
      return (
        lab.scopes.some((s) => s.projectId === p && s.name === F.prodProjectId) &&
        configuration.conditions[0]?.metric === metric &&
        !lab.points.some((q) => q.projectId === p && q.metric === metric)
      );
    }
    return (
      configuration.conditions[0]?.kind === "promql" &&
      configuration.conditions[0].evaluationInterval === 30
    );
  }
  if (lesson === "slo") {
    const request = lab.objectives.find(
      (s) =>
        s.projectId === p && s.name === "availability" && s.model === "request" && s.goal === 0.99,
    );
    const windows = lab.objectives.find(
      (s) => s.projectId === p && s.name === "windows" && s.model === "windows" && s.goal === 0.9,
    );
    return (
      !!request &&
      !!windows &&
      request.rollingSeconds === 86400 &&
      windows.rollingSeconds === 86400 &&
      objectiveResult(request, lab.clock).sli === 0.98 &&
      objectiveResult(request, lab.clock).status === "OUT_OF_SLO" &&
      objectiveResult(windows, lab.clock).status === "OUT_OF_SLO"
    );
  }
  if (lesson === "agent" || lesson === "prometheus") {
    const collector = lab.collectors.find(
      (c) =>
        c.projectId === p &&
        c.name === lesson &&
        c.kind === (lesson === "agent" ? "ops-agent" : "managed-prometheus"),
    );
    return (
      !!collector &&
      collectorStatus(world, collector) === "READY" &&
      lab.points.some(
        (q) => q.projectId === p && q.name === `collector-${collector.name}-${lab.clock}`,
      )
    );
  }
  if (lesson === "routing") {
    return (
      lab.buckets.some(
        (b) =>
          b.projectId === p &&
          b.name === "archive" &&
          b.retentionDays === 7 &&
          b.analyticsEnabled &&
          b.deleteRequestedAt === -1,
      ) &&
      lab.views.some((v) => v.projectId === p && v.bucket === "archive" && v.name === "compute") &&
      lab.exclusions.some(
        (e) =>
          e.projectId === p && e.sink === "archive-sink" && e.name === "skip-data" && !e.disabled,
      ) &&
      lab.links.some(
        (l) => l.projectId === p && l.bucket === "archive" && l.dataset === "observe_logs",
      ) &&
      storedLogs(world, p, "us-central1", "archive").some((l) => l.method.includes("insert")) &&
      world.dataProcessing.tables.some(
        (t) =>
          t.projectId === p &&
          t.dataset === "observe_logs" &&
          t.name === "audit" &&
          t.rows.length > 0,
      )
    );
  }
  if (lesson === "audit") {
    return (
      auditEnabled(world, p, "compute.googleapis.com", "dataRead") &&
      ["ADMIN_ACTIVITY", "DATA_ACCESS", "SYSTEM_EVENT", "POLICY_DENIED"].every((kind) =>
        lab.logs.some(
          (l) =>
            l.projectId === p &&
            l.kind === kind &&
            l.method.startsWith("sim.fixture.") &&
            lab.deliveries.some(
              (d) => d.projectId === p && d.log === l.name && d.state === "STORED",
            ),
        ),
      )
    );
  }
  const connection = world.networkLab.checks.findLast(
    (c) => c.projectId === p && c.name === "observe-client" && c.destination === "observe-server",
  );
  return (
    !!connection &&
    evaluateConnection(world, connection).allowed &&
    ["FLOW", "FIREWALL"].every((kind) =>
      lab.logs.some((l) => l.projectId === p && l.kind === kind && l.resource === "observe-client"),
    ) &&
    lab.logs.some(
      (l) =>
        l.projectId === p &&
        l.kind === "FIREWALL" &&
        l.resource === "observe-client" &&
        l.severity === "ERROR",
    ) &&
    lab.logs.some(
      (l) =>
        l.projectId === p &&
        l.kind === "FIREWALL" &&
        l.resource === "observe-client" &&
        l.severity === "NOTICE",
    ) &&
    world.networkLab.logs.at(-1)?.allowed === true
  );
};
