import { GkePlacement, KubeIdentity } from "@/engine/domains/gke-completion";
import { KubeContainer } from "@/engine/domains/kube-container";
import { KubeManifest } from "@/engine/domains/kube-manifest";
import { KubeMulti } from "@/engine/domains/kube-multi";
import { KubeServiceRouting } from "@/engine/domains/kube-service-routing";
import { KubePod } from "@/engine/domains/kubernetes";
import { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { MissionStep } from "@/engine/missions/mission-step";
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
const enable = MissionStep.run(
  "Kubernetes Engine APIを有効にする",
  "gcloud services enable container.googleapis.com",
);
const load = MissionStep.run("教材のマニフェストを読み込む", "sim files load kubernetes-gke-final");
const multiSteps = (cluster: string) => [
  enable,
  MissionStep.run(
    `教材用のクラスタ${cluster}を作る`,
    `gcloud container clusters create ${cluster} --zone=us-central1-a`,
  ),
  load,
  MissionStep.run(
    "app・agentの2コンテナを持つDeploymentを配置する",
    "kubectl apply -f multi-app.json",
  ),
  MissionStep.run("multi-appの接続先になるServiceを作る", "kubectl apply -f multi-service.json"),
  MissionStep.run(
    "Podのコンテナがまだ準備中であることを確かめる",
    "kubectl get pods",
    "2つのコンテナにreadinessがあり、最初は0/2です。",
  ),
  MissionStep.run(
    "appコンテナのreadinessを成功させる",
    "sim kubernetes probe multi-app --container=app --status-code=200",
  ),
  MissionStep.run(
    "agentコンテナのreadinessを成功させる",
    "sim kubernetes probe multi-app --container=agent --status-code=200",
  ),
  MissionStep.run("Serviceの接続先が2つそろったか確かめる", "kubectl get endpoints multi-app"),
  MissionStep.run(
    "appコンテナの環境変数ROLEを確かめる",
    "kubectl exec deployment/multi-app -c app -- printenv ROLE",
  ),
  MissionStep.run(
    "agentコンテナの環境変数ROLEを確かめる",
    "kubectl exec deployment/multi-app -c agent -- printenv ROLE",
    "コンテナごとにfrontend / metricsを確認できます。",
  ),
];
const identitySteps = (standard: boolean) => [
  MissionStep.run(
    "GKEとIAM Service Account Credentials APIを有効にする",
    "gcloud services enable container.googleapis.com iamcredentials.googleapis.com",
  ),
  MissionStep.run(
    "Podが借りるIAMサービスアカウントを作る",
    "gcloud iam service-accounts create lesson-reader",
  ),
  MissionStep.run(
    "閲覧させるバケットを作る",
    "gcloud storage buckets create gs://ace-workload-data --location=us-central1",
  ),
  ...(standard
    ? [
        MissionStep.run(
          "Standardクラスタを作る",
          "gcloud container clusters create identity-standard --zone=us-central1-a",
        ),
        MissionStep.run(
          "クラスタにWorkload Identity poolを設定する",
          `gcloud container clusters update identity-standard --zone=us-central1-a --workload-pool=${F.devProjectId}.svc.id.goog`,
        ),
        MissionStep.run(
          "default-poolのノードでGKEメタデータサーバを使う",
          "gcloud container node-pools update default-pool --cluster=identity-standard --zone=us-central1-a --workload-metadata=GKE_METADATA",
          "クラスタのpool設定だけでは、既存のノードプールはGKEメタデータサーバを使いません。",
        ),
      ]
    : [
        MissionStep.run(
          "Autopilotクラスタを作る",
          "gcloud container clusters create-auto identity-gke --region=us-central1",
          "AutopilotはWorkload Identityが有効です。",
        ),
      ]),
  load,
  MissionStep.run(
    "Kubernetesサービスアカウントbucket-readerを作る",
    "kubectl apply -f identity-account.json",
  ),
  MissionStep.run(
    "bucket-readerで動くidentity-appを配置する",
    "kubectl apply -f identity-app.json",
  ),
  MissionStep.run(
    "bucket-readerがlesson-readerを借りられるようにする",
    `gcloud iam service-accounts add-iam-policy-binding lesson-reader@${F.devProjectId}.iam.gserviceaccount.com --role=roles/iam.workloadIdentityUser --member='serviceAccount:${F.devProjectId}.svc.id.goog[default/bucket-reader]'`,
    "memberは「プロジェクトID.svc.id.goog[namespace/Kubernetesサービスアカウント名]」の形です。",
  ),
  MissionStep.run(
    "bucket-readerに借りるIAMサービスアカウントを書き込む",
    `kubectl annotate serviceaccount bucket-reader iam.gke.io/gcp-service-account=lesson-reader@${F.devProjectId}.iam.gserviceaccount.com`,
  ),
  MissionStep.run(
    "lesson-readerにバケットの閲覧権限だけを付ける",
    `gcloud storage buckets add-iam-policy-binding gs://ace-workload-data --member=serviceAccount:lesson-reader@${F.devProjectId}.iam.gserviceaccount.com --role=roles/storage.objectViewer`,
  ),
  MissionStep.run(
    "Podからオブジェクト一覧を取れるか確かめる",
    "sim kubernetes check-access identity-app --bucket=ace-workload-data --permission=storage.objects.list",
  ),
  MissionStep.run(
    "Podからオブジェクトを削除できないか確かめる",
    "sim kubernetes check-access identity-app --bucket=ace-workload-data --permission=storage.objects.delete",
    "閲覧はALLOW、削除はDENYが目標です。鍵を作る必要はありません。",
  ),
];

export const GkeCompletionMissions: readonly Mission[] = [
  {
    id: "m-gke-034",
    domain: "運用の維持",
    title: "複数コンテナのReadyと接続先を確認する",
    setup,
    description:
      "multi-gkeでmulti-appのapp/agentを個別に確認し、2 Podの両コンテナをReadyにしてください。環境変数はapp=frontend、agent=metricsを維持し、Serviceの2接続先をそろえます。",
    steps: multiSteps("multi-gke"),
    assertions: [{ kind: "gkeCompletion", lesson: "multiReady" }],
  },
  {
    id: "m-gke-035",
    domain: "運用の維持",
    title: "補助コンテナだけを再起動して復旧する",
    setup,
    description:
      "multi-repairでmulti-appを構築します。先頭Podのagentだけをlivenessで1回再起動し、appともう1つのPodの再起動回数を0に保ったまま、全コンテナをReadyへ戻してください。",
    steps: [
      ...multiSteps("multi-repair"),
      MissionStep.run("先頭Podの名前を調べる", "kubectl get pods"),
      MissionStep.run(
        "先頭Podのagentだけlivenessで再起動させる",
        "sim kubernetes probe multi-app --container=agent --kind=liveness --pod=POD_NAME --status-code=500",
        "POD_NAMEには前の手順で調べた先頭Podの名前を入れます。",
      ),
      MissionStep.run(
        "再起動したagentのreadinessを成功させる",
        "sim kubernetes probe multi-app --container=agent --status-code=200",
        "appは再起動せず、agentのreadinessだけ再確認します。",
      ),
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
    steps: identitySteps(false),
    assertions: [{ kind: "gkeCompletion", lesson: "identity" }],
  },
  {
    id: "m-gke-037",
    domain: "アクセスとセキュリティ",
    title: "Standardのメタデータ設定を復旧してID連携する",
    setup,
    description:
      "identity-standardでWorkload Identity poolとdefault-poolのGKE_METADATAを有効にします。Kubernetes SAとIAM SAを連携し、identity-appへace-workload-dataの閲覧だけを許可してください。クラスタ設定だけ、annotationだけでは完了しません。",
    steps: identitySteps(true),
    assertions: [{ kind: "gkeCompletion", lesson: "metadata" }],
  },
  {
    id: "m-gke-038",
    domain: "運用の維持",
    title: "VPAの推奨値を確認してrequestsを調整する",
    setup,
    description:
      "vpa-gkeのrightsize-appを2レプリカで構築します。VPA OffモードでCPU 250m・メモリ100Miの教材使用量を評価し、推奨された300m・120Miをtunerのrequestsへ手動反映してください。VPAの評価だけではPodもレプリカも変わりません。",
    steps: [
      enable,
      MissionStep.run(
        "VPAを有効にしたクラスタを作る",
        "gcloud container clusters create vpa-gke --zone=us-central1-a --enable-vertical-pod-autoscaling",
      ),
      load,
      MissionStep.run("2レプリカのrightsize-appを配置する", "kubectl apply -f rightsize-app.json"),
      MissionStep.run("OffモードのVPAを作る", "kubectl apply -f rightsize-vpa.json"),
      MissionStep.run(
        "教材用の使用量でVPAの推奨値を出す",
        "sim kubernetes recommend-vpa rightsize --cpu=250m --memory=100Mi",
      ),
      MissionStep.run("VPAの推奨値を確かめる", "kubectl describe vpa rightsize"),
      MissionStep.run(
        "Deploymentがまだ変わっていないことを確かめる",
        "kubectl get deployment rightsize-app",
        "Offモードは推奨を出すだけで、Podもrequestsも変えません。",
      ),
      MissionStep.run(
        "推奨値をtunerのrequestsへ手で反映する",
        "kubectl set resources deployment/rightsize-app --containers=tuner --requests=cpu=300m,memory=120Mi",
      ),
      MissionStep.run("VPAの推奨を見直す", "kubectl get vpa"),
      MissionStep.run(
        "Podのrequestsとレプリカ数を確かめる",
        "kubectl get pods",
        "2レプリカを保ち、Offモードの推奨とlive requestsを照合します。",
      ),
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
    steps: [
      enable,
      MissionStep.run(
        "Autopilotクラスタを作る",
        "gcloud container clusters create-auto admission-gke --region=us-central1",
      ),
      load,
      MissionStep.run(
        "リソース未指定のdefault-appを配置する",
        "kubectl apply -f autopilot-default.json",
      ),
      MissionStep.run(
        "30m/32Miを指定したsmall-appを配置する",
        "kubectl apply -f autopilot-small.json",
      ),
      MissionStep.run(
        "default-appにAutopilotの既定値を当てる",
        "sim kubernetes admit-autopilot default-app",
        "未指定のrequestsは500m/2Giになります。",
      ),
      MissionStep.run(
        "small-appを最小リソースへ補正する",
        "sim kubernetes admit-autopilot small-app",
        "30m/32Miは50m/52Miへ補正され、limitsもrequests以上へそろいます。",
      ),
      MissionStep.run("補正後のrequestsとlimitsを確かめる", "kubectl get deployment -o json"),
      MissionStep.say(
        "教材評価で再現する範囲を押さえる",
        "General-purposeのbursting対応プロファイルです。CPU/メモリの比率から不足側も増やします。実際のGKEの自動admission、他ComputeClassや複数コンテナ配分は再現しません。",
      ),
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
    steps: [
      enable,
      MissionStep.run(
        "3 zoneに1ノードずつ置くregionalクラスタを作る",
        "gcloud container clusters create regional-gke --region=us-central1 --num-nodes=1 --node-locations=us-central1-a,us-central1-b,us-central1-c",
        "--num-nodesはzoneごとの数です。",
      ),
      load,
      MissionStep.run("3レプリカのregional-appを配置する", "kubectl apply -f regional-app.json"),
      MissionStep.run("regional-appのServiceを作る", "kubectl apply -f regional-service.json"),
      MissionStep.run(
        "制御プレーンの場所とノード配置を確かめる",
        "gcloud container clusters describe regional-gke --region=us-central1",
      ),
      MissionStep.run("ノードが3 zoneに分かれたか確かめる", "kubectl get nodes -o json"),
      MissionStep.run("アプリのレプリカ数を確かめる", "kubectl get deployments"),
      MissionStep.run(
        "Serviceの接続先が3つそろったか確かめる",
        "kubectl get endpoints regional-app",
      ),
      MissionStep.say(
        "教材で確かめる範囲を押さえる",
        "総ノード数は1×3=3です。実際のzone障害、Pod配置・再配置・可用性保証は再現せず、教材上の構成とReadyな接続先を確認します。",
      ),
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
    steps: [
      enable,
      MissionStep.run(
        "VPAを有効にしたクラスタを作る",
        "gcloud container clusters create vpa-initial --zone=us-central1-a --enable-vertical-pod-autoscaling",
      ),
      load,
      MissionStep.run("2レプリカのrightsize-appを配置する", "kubectl apply -f rightsize-app.json"),
      MissionStep.run("InitialモードのVPAを作る", "kubectl apply -f rightsize-initial.json"),
      MissionStep.run(
        "教材用の使用量でVPAの推奨値を出す",
        "sim kubernetes recommend-vpa rightsize --cpu=250m --memory=100Mi",
      ),
      MissionStep.run(
        "既存Podのrequestsが変わらないことを確かめる",
        "kubectl get pods -o json",
        "既存Podのrequestsは変わりません。",
      ),
      MissionStep.run(
        "3レプリカへ増やして新しいPodを作る",
        "kubectl scale deployment/rightsize-app --replicas=3",
      ),
      MissionStep.run("新しいPodだけに推奨値が入ったか確かめる", "kubectl get pods -o json"),
      MissionStep.run(
        "Deploymentのテンプレートが元のままか確かめる",
        "kubectl get deployment rightsize-app -o json",
        "新規Podへのadmissionとテンプレートを照合します。",
      ),
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
    steps: [
      enable,
      MissionStep.run(
        "VPAを有効にしたクラスタを作る",
        "gcloud container clusters create vpa-recreate --zone=us-central1-a --enable-vertical-pod-autoscaling",
      ),
      load,
      MissionStep.run("2レプリカのrightsize-appを配置する", "kubectl apply -f rightsize-app.json"),
      MissionStep.run("RecreateモードのVPAを作る", "kubectl apply -f rightsize-recreate.json"),
      MissionStep.run("作り直す前のPod名を控える", "kubectl get pods"),
      MissionStep.run(
        "推奨値を出してPodを作り直させる",
        "sim kubernetes recommend-vpa rightsize --cpu=250m --memory=100Mi",
      ),
      MissionStep.run("Pod名とrequestsが変わったか確かめる", "kubectl get pods -o json"),
      MissionStep.run(
        "Deploymentのテンプレートが元のままか確かめる",
        "kubectl get deployment rightsize-app -o json",
      ),
      MissionStep.say(
        "Recreateで起きることを押さえる",
        "明示評価でPod名が変わり、全Podのrequestsは300m/120Miになります。水平スケールやテンプレートのrolloutではありません。",
      ),
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
