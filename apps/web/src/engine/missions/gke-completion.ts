import { GkePlacement, KubeIdentity } from "@/engine/domains/gke-completion";
import { KubeContainer } from "@/engine/domains/kube-container";
import { KubeManifest } from "@/engine/domains/kube-manifest";
import { KubeMulti } from "@/engine/domains/kube-multi";
import { KubeServiceRouting } from "@/engine/domains/kube-service-routing";
import { KubePod } from "@/engine/domains/kubernetes";
import { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

export type GkeCompletionLesson =
  | "multiReady"
  | "multiRestart"
  | "identity"
  | "metadata"
  | "vpa"
  | "autopilot"
  | "regional"
  | "vpaInitial"
  | "vpaRecreate";
export type GkeCompletionAssertion = Readonly<{
  kind: "gkeCompletion";
  lesson: GkeCompletionLesson;
}>;
const setup = [
  { kind: "setPrincipal", principal: F.owner },
  { kind: "setProject", projectId: F.devProjectId },
] as const;
const load = "sim files load kubernetes-gke-final";
const multiHints = (cluster: string) => [
  `gcloud services enable container.googleapis.com → gcloud container clusters create ${cluster} --zone=us-central1-a → ${load}`,
  "kubectl apply -f multi-app.json → kubectl apply -f multi-service.json → kubectl get pods。2つのコンテナにreadinessがあり、最初は0/2です。",
  "sim kubernetes probe multi-app --container=app --status-code=200 → sim kubernetes probe multi-app --container=agent --status-code=200 → kubectl get endpoints multi-app",
  "kubectl exec deployment/multi-app -c app -- printenv ROLE → kubectl exec deployment/multi-app -c agent -- printenv ROLE。コンテナごとにfrontend / metricsを確認できます。",
];
const identityHints = (standard: boolean) => [
  "gcloud services enable container.googleapis.com iamcredentials.googleapis.com → gcloud iam service-accounts create lesson-reader → gcloud storage buckets create gs://ace-workload-data --location=us-central1",
  standard
    ? `gcloud container clusters create identity-standard --zone=us-central1-a → gcloud container clusters update identity-standard --zone=us-central1-a --workload-pool=${F.devProjectId}.svc.id.goog → gcloud container node-pools update default-pool --cluster=identity-standard --zone=us-central1-a --workload-metadata=GKE_METADATA`
    : "gcloud container clusters create-auto identity-gke --region=us-central1。AutopilotはWorkload Identityが有効です。",
  `${load} → kubectl apply -f identity-account.json → kubectl apply -f identity-app.json`,
  `gcloud iam service-accounts add-iam-policy-binding lesson-reader@${F.devProjectId}.iam.gserviceaccount.com --role=roles/iam.workloadIdentityUser --member='serviceAccount:${F.devProjectId}.svc.id.goog[default/bucket-reader]'`,
  `kubectl annotate serviceaccount bucket-reader iam.gke.io/gcp-service-account=lesson-reader@${F.devProjectId}.iam.gserviceaccount.com → gcloud storage buckets add-iam-policy-binding gs://ace-workload-data --member=serviceAccount:lesson-reader@${F.devProjectId}.iam.gserviceaccount.com --role=roles/storage.objectViewer`,
  "sim kubernetes check-access identity-app --bucket=ace-workload-data --permission=storage.objects.list → sim kubernetes check-access identity-app --bucket=ace-workload-data --permission=storage.objects.delete。閲覧はALLOW、削除はDENYが目標です。鍵を作る必要はありません。",
];

export const GkeCompletionMissions: readonly Mission[] = [
  {
    id: "m-gke-034",
    domain: "運用の維持",
    title: "複数コンテナのReadyと接続先を確認する",
    setup,
    description:
      "multi-gkeでmulti-appのapp/agentを個別に確認し、2 Podの両コンテナをReadyにしてください。環境変数はapp=frontend、agent=metricsを維持し、Serviceの2接続先をそろえます。",
    hints: multiHints("multi-gke"),
    assertions: [{ kind: "gkeCompletion", lesson: "multiReady" }],
  },
  {
    id: "m-gke-035",
    domain: "運用の維持",
    title: "補助コンテナだけを再起動して復旧する",
    setup,
    description:
      "multi-repairでmulti-appを構築します。先頭Podのagentだけをlivenessで1回再起動し、appともう1つのPodの再起動回数を0に保ったまま、全コンテナをReadyへ戻してください。",
    hints: [
      ...multiHints("multi-repair"),
      "kubectl get podsで先頭Pod名を確認 → sim kubernetes probe multi-app --container=agent --kind=liveness --pod=POD_NAME --status-code=500 → sim kubernetes probe multi-app --container=agent --status-code=200。appは再起動せず、agentのreadinessだけ再確認します。",
    ],
    assertions: [{ kind: "gkeCompletion", lesson: "multiRestart" }],
  },
  {
    id: "m-gke-036",
    domain: "アクセスとセキュリティ",
    title: "Workload Identityで鍵なしの閲覧権限を設定する",
    setup,
    description:
      "identity-gkeのidentity-appをbucket-readerで実行し、lesson-readerのIAM連携を設定します。ace-workload-dataの閲覧だけを許可し、作成・削除を拒否してください。サービスアカウントキーを作らずに完了させます。",
    hints: identityHints(false),
    assertions: [{ kind: "gkeCompletion", lesson: "identity" }],
  },
  {
    id: "m-gke-037",
    domain: "アクセスとセキュリティ",
    title: "Standardのメタデータ設定を復旧してID連携する",
    setup,
    description:
      "identity-standardでWorkload Identity poolとdefault-poolのGKE_METADATAを有効にします。Kubernetes SAとIAM SAを連携し、identity-appへace-workload-dataの閲覧だけを許可してください。クラスタ設定だけ、annotationだけでは完了しません。",
    hints: identityHints(true),
    assertions: [{ kind: "gkeCompletion", lesson: "metadata" }],
  },
  {
    id: "m-gke-038",
    domain: "運用の維持",
    title: "VPAの推奨値を確認してrequestsを調整する",
    setup,
    description:
      "vpa-gkeのrightsize-appを2レプリカで構築します。VPA OffモードでCPU 250m・メモリ100Miの教材使用量を評価し、推奨された300m・120Miをtunerのrequestsへ手動反映してください。VPAの評価だけではPodもレプリカも変わりません。",
    hints: [
      "gcloud services enable container.googleapis.com → gcloud container clusters create vpa-gke --zone=us-central1-a --enable-vertical-pod-autoscaling",
      `${load} → kubectl apply -f rightsize-app.json → kubectl apply -f rightsize-vpa.json`,
      "sim kubernetes recommend-vpa rightsize --cpu=250m --memory=100Mi → kubectl describe vpa rightsize → kubectl get deployment rightsize-app",
      "kubectl set resources deployment/rightsize-app --containers=tuner --requests=cpu=300m,memory=120Mi → kubectl get vpa → kubectl get pods。2レプリカを保ち、Offモードの推奨とlive requestsを照合します。",
    ],
    assertions: [{ kind: "gkeCompletion", lesson: "vpa" }],
  },
  {
    id: "m-gke-039",
    domain: "運用の維持",
    title: "Autopilotの既定値と最小リソース補正を確認する",
    setup,
    description:
      "admission-gkeでdefault-appとsmall-appを構築します。明示的なAutopilot教材評価を実行し、未指定のdefault-appは500m/2Gi、small-appの30m/32Miは50m/52Miへ補正してください。small-appのlimitsもrequests以上へそろえます。",
    hints: [
      "gcloud services enable container.googleapis.com → gcloud container clusters create-auto admission-gke --region=us-central1",
      `${load} → kubectl apply -f autopilot-default.json → kubectl apply -f autopilot-small.json`,
      "sim kubernetes admit-autopilot default-app → sim kubernetes admit-autopilot small-app → kubectl get deployment -o json",
      "General-purposeのbursting対応プロファイルです。CPU/メモリの比率から不足側も増やします。実際のGKEの自動admission、他ComputeClassや複数コンテナ配分は再現しません。",
    ],
    assertions: [{ kind: "gkeCompletion", lesson: "autopilot" }],
  },
  {
    id: "m-gke-040",
    domain: "運用の維持",
    title: "regionalクラスタの配置とレプリカ数を確認する",
    setup,
    description:
      "regional-gkeをus-central1の3 zone、zoneごとに1ノードで構築します。regional-appを3レプリカで実行し、3つのService接続先を確認してください。制御プレーンのregional設定、worker配置、アプリのレプリカ数は別々の条件です。",
    hints: [
      "gcloud services enable container.googleapis.com → gcloud container clusters create regional-gke --region=us-central1 --num-nodes=1 --node-locations=us-central1-a,us-central1-b,us-central1-c",
      `${load} → kubectl apply -f regional-app.json → kubectl apply -f regional-service.json`,
      "gcloud container clusters describe regional-gke --region=us-central1 → kubectl get nodes -o json → kubectl get deployments → kubectl get endpoints regional-app",
      "総ノード数は1×3=3です。実際のzone障害、Pod配置・再配置・可用性保証は再現せず、教材上の構成とReadyな接続先を確認します。",
    ],
    assertions: [{ kind: "gkeCompletion", lesson: "regional" }],
  },
  {
    id: "m-gke-041",
    domain: "運用の維持",
    title: "VPA Initialを新しいPodだけに適用する",
    setup,
    description:
      "vpa-initialでrightsize-appを2レプリカで構築し、VPA Initialの推奨値300m/120Miを評価します。3レプリカへ増やし、元の2 Podは1 CPU/512Mi、新しいPodだけ300m/120Miになったことを確認してください。Deploymentのテンプレートは維持します。",
    hints: [
      "gcloud services enable container.googleapis.com → gcloud container clusters create vpa-initial --zone=us-central1-a --enable-vertical-pod-autoscaling",
      `${load} → kubectl apply -f rightsize-app.json → kubectl apply -f rightsize-initial.json`,
      "sim kubernetes recommend-vpa rightsize --cpu=250m --memory=100Mi → kubectl get pods -o json。既存Podのrequestsは変わりません。",
      "kubectl scale deployment/rightsize-app --replicas=3 → kubectl get pods -o json → kubectl get deployment rightsize-app -o json。新規Podへのadmissionとテンプレートを照合します。",
    ],
    assertions: [{ kind: "gkeCompletion", lesson: "vpaInitial" }],
  },
  {
    id: "m-gke-042",
    domain: "運用の維持",
    title: "VPA Recreateで垂直スケールする",
    setup,
    description:
      "vpa-recreateでrightsize-appを2レプリカで構築し、VPA Recreateの推奨値300m/120Miを評価します。2 Podを再作成して推奨値を適用し、レプリカ数とDeploymentの1 CPU/512Miのテンプレートを維持してください。",
    hints: [
      "gcloud services enable container.googleapis.com → gcloud container clusters create vpa-recreate --zone=us-central1-a --enable-vertical-pod-autoscaling",
      `${load} → kubectl apply -f rightsize-app.json → kubectl apply -f rightsize-recreate.json → kubectl get pods`,
      "sim kubernetes recommend-vpa rightsize --cpu=250m --memory=100Mi → kubectl get pods -o json → kubectl get deployment rightsize-app -o json",
      "明示評価でPod名が変わり、全Podのrequestsは300m/120Miになります。水平スケールやテンプレートのrolloutではありません。",
    ],
    assertions: [{ kind: "gkeCompletion", lesson: "vpaRecreate" }],
  },
];

const clusterNames: Record<GkeCompletionLesson, string> = {
  multiReady: "multi-gke",
  multiRestart: "multi-repair",
  identity: "identity-gke",
  metadata: "identity-standard",
  vpa: "vpa-gke",
  autopilot: "admission-gke",
  regional: "regional-gke",
  vpaInitial: "vpa-initial",
  vpaRecreate: "vpa-recreate",
};
export const gkeCompletionSatisfied = (world: World, lesson: GkeCompletionLesson): boolean => {
  const c = World.findCluster(world, F.devProjectId, clusterNames[lesson]);
  if (!Option.isSome(c)) {
    return false;
  }
  const cluster = c.value;
  const find = (name: string) =>
    world.kubeDeployments.find(
      (d) =>
        d.projectId === F.devProjectId &&
        d.cluster === cluster.name &&
        d.namespace === "default" &&
        d.name === name,
    );
  const ready = (d: NonNullable<ReturnType<typeof find>>) =>
    d.replicas > 0 &&
    KubePod.fromDeployment(d).every(
      (p) => !KubeMulti.error(world, cluster, d, p.name) && KubeMulti.ready(d, p.name),
    );
  if (lesson === "multiReady" || lesson === "multiRestart") {
    const d = find("multi-app");
    const service = world.kubeServices.find(
      (s) =>
        s.projectId === F.devProjectId &&
        s.cluster === cluster.name &&
        s.namespace === "default" &&
        s.name === "multi-app",
    );
    if (
      d?.replicas !== 2 ||
      !ready(d) ||
      !service ||
      KubeServiceRouting.backends(world, service).length !== 2
    ) {
      return false;
    }
    const specs = KubeMulti.spec(d);
    if (
      specs.length !== 2 ||
      specs[0]?.name !== "app" ||
      specs[0].image !== "nginx:1" ||
      specs[1]?.name !== "agent" ||
      specs[1].image !== "busybox:1" ||
      specs[0].env.find((e) => e.name === "ROLE")?.value !== "frontend" ||
      specs[1].env.find((e) => e.name === "ROLE")?.value !== "metrics" ||
      !Option.isSome(specs[0].readinessProbe) ||
      !Option.isSome(specs[1].readinessProbe) ||
      !Option.isSome(specs[1].livenessProbe)
    ) {
      return false;
    }
    if (lesson === "multiReady") {
      return true;
    }
    const pods = KubePod.fromDeployment(d);
    const agent = Result.unwrap(KubeMulti.select(d, "agent"));
    return pods.every(
      (p, i) =>
        KubeContainer.restarts(agent, p.name) === (i === 0 ? 1 : 0) &&
        KubeContainer.restarts(d, p.name) === 0,
    );
  }
  if (lesson === "identity" || lesson === "metadata") {
    const d = find("identity-app");
    if (d?.serviceAccountName !== "bucket-reader" || d.replicas !== 1 || !ready(d)) {
      return false;
    }
    if (lesson === "identity" && !cluster.autopilot) {
      return false;
    }
    if (lesson === "metadata" && cluster.autopilot) {
      return false;
    }
    const list = KubeIdentity.check(world, cluster, d, "ace-workload-data", "storage.objects.list");
    const get = KubeIdentity.check(world, cluster, d, "ace-workload-data", "storage.objects.get");
    const create = KubeIdentity.check(
      world,
      cluster,
      d,
      "ace-workload-data",
      "storage.objects.create",
    );
    const remove = KubeIdentity.check(
      world,
      cluster,
      d,
      "ace-workload-data",
      "storage.objects.delete",
    );
    const sa = `lesson-reader@${F.devProjectId}.iam.gserviceaccount.com`;
    return (
      list.allowed &&
      get.allowed &&
      list.principal === `serviceAccount:${sa}` &&
      create.reason === "ResourcePermissionDenied" &&
      remove.reason === "ResourcePermissionDenied" &&
      !world.serviceAccountKeys.some((key) => key.serviceAccountEmail === sa)
    );
  }
  if (["vpa", "vpaInitial", "vpaRecreate"].includes(lesson)) {
    const d = find("rightsize-app");
    const v = world.kubeVpas.find(
      (v) =>
        v.projectId === F.devProjectId &&
        v.cluster === cluster.name &&
        v.namespace === "default" &&
        v.name === "rightsize",
    );
    if (
      !d ||
      !v ||
      v.target !== d.name ||
      v.container !== "tuner" ||
      !ready(d) ||
      !Option.isSome(v.recommendation)
    ) {
      return false;
    }
    const r = v.recommendation.value;
    if (r.cpuMilli !== 300 || r.memoryBytes !== 125_829_120 || !cluster.verticalPodAutoscaling) {
      return false;
    }
    if (lesson === "vpa") {
      return (
        v.mode === "Off" &&
        d.replicas === 2 &&
        d.resources.requests.cpu === "300m" &&
        d.resources.requests.memory === "120Mi"
      );
    }
    if (
      d.revision !== 1 ||
      d.resources.requests.cpu !== "1" ||
      d.resources.requests.memory !== "512Mi"
    ) {
      return false;
    }
    const pods = KubePod.fromDeployment(d);
    if (lesson === "vpaInitial") {
      return (
        v.mode === "Initial" &&
        d.replicas === 3 &&
        pods.every(
          (p, i) =>
            p.resources.requests.cpu === (i < 2 ? "1" : "300m") &&
            p.resources.requests.memory === (i < 2 ? "512Mi" : "120Mi"),
        ) &&
        d.podIncarnations.every((n, i) => n === (i < 2 ? 0 : 1))
      );
    }

    return (
      v.mode === "Recreate" &&
      d.replicas === 2 &&
      pods.every(
        (p) => p.resources.requests.cpu === "300m" && p.resources.requests.memory === "120Mi",
      ) &&
      d.podIncarnations.every((n, i) => n === i + 1)
    );
  }
  if (lesson === "autopilot") {
    const normal = find("default-app");
    const small = find("small-app");
    if (
      !cluster.autopilot ||
      !normal ||
      !small ||
      normal.replicas !== 1 ||
      small.replicas !== 1 ||
      !ready(normal) ||
      !ready(small)
    ) {
      return false;
    }
    const file = KubeManifest.parse(world.kubeFiles["autopilot-small.json"] ?? "");
    return (
      normal.resources.requests.cpu === "500m" &&
      normal.resources.requests.memory === "2Gi" &&
      small.resources.requests.cpu === "50m" &&
      small.resources.requests.memory === "52Mi" &&
      small.resources.limits.cpu === "50m" &&
      small.resources.limits.memory === "52Mi" &&
      Result.isOk(file) &&
      file.value.some(
        (m) =>
          m.kind === "deployment" &&
          m.name === "small-app" &&
          m.resources.requests.cpu === "30m" &&
          m.resources.requests.memory === "32Mi",
      )
    );
  }
  const d = find("regional-app");
  const service = world.kubeServices.find(
    (s) =>
      s.projectId === F.devProjectId &&
      s.cluster === cluster.name &&
      s.namespace === "default" &&
      s.name === "regional-app",
  );
  return (
    cluster.location === "us-central1" &&
    !cluster.autopilot &&
    GkePlacement.zones(cluster).length === 3 &&
    cluster.nodeCount === 1 &&
    d !== undefined &&
    d.replicas === 3 &&
    ready(d) &&
    service !== undefined &&
    KubeServiceRouting.backends(world, service).length === 3
  );
};
