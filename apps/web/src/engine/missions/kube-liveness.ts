import { KubeLiveness } from "@/engine/domains/kube-liveness";
import { KubeReadiness } from "@/engine/domains/kube-readiness";
import { KubeServiceRouting } from "@/engine/domains/kube-service-routing";
import { KubePod } from "@/engine/domains/kubernetes";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { MissionStep } from "@/engine/missions/mission-step";
import { Option } from "@/utils/Option";

export type KubeLivenessAssertion = Readonly<{ kind: "kubeLivenessRecovered" }>;
export const KubeLivenessMissions: readonly Mission[] = [
  {
    id: "m-gke-013",
    domain: "運用の維持",
    title: "liveness失敗でコンテナを再起動して復旧する",
    setup: [
      { kind: "setPrincipal", principal: F.owner },
      { kind: "setProject", projectId: F.devProjectId },
    ],
    description:
      "liveness-gkeに教材のlive-webを2レプリカとlive-serviceを作ります。全Podをreadiness成功にした後、1つのPodだけlivenessに503を2回指定してコンテナを1回再起動してください。そのPodのlivenessとreadinessを200で回復させ、RESTARTSが1と0、Service接続先が2つの状態にします。Podの再作成との違いを確認します。HTTP応答は手動指定で、実通信・定期実行・backoffは再現しません。",
    steps: [
      MissionStep.run("GKEのAPIを有効にする", "gcloud services enable container.googleapis.com"),
      MissionStep.run(
        "Standardクラスタliveness-gkeを作る",
        "gcloud container clusters create liveness-gke --zone=us-central1-a",
      ),
      MissionStep.run("liveness教材のマニフェストを用意する", "sim files load kubernetes-liveness"),
      MissionStep.run("livenessとreadinessの設定を確かめる", "sim files read live-web.yaml"),
      MissionStep.run("live-webを2レプリカで作る", "kubectl apply -f live-web.yaml"),
      MissionStep.run("Service live-serviceを作る", "kubectl apply -f live-service.yaml"),
      MissionStep.run(
        "全Podのreadinessを成功させる",
        "sim kubernetes probe live-web --status-code=200",
        "readinessが成功して接続先が2つになります。",
      ),
      MissionStep.run(
        "再起動させるPodの名前を1つ控える",
        "kubectl get pods",
        "表示されたPod名を1つコピーします。",
      ),
      MissionStep.run(
        "控えたPodのlivenessを失敗させて再起動する",
        "sim kubernetes probe live-web --kind=liveness --pod=コピーしたPod名 --status-code=503",
        "「コピーしたPod名」は控えたPod名に置き換え、2回実行します。1回目は再起動せず、2回目で対象コンテナだけ再起動します。",
      ),
      MissionStep.run("RESTARTSが1になったか確かめる", "kubectl get pods"),
      MissionStep.run(
        "再起動したPodが接続先から外れたか確かめる",
        "kubectl describe service live-service",
        "Pod名・IPは同じままRESTARTSが1となり、そのPodのreadinessが未評価に戻って接続先は1つになります。Deploymentのrevisionも変わりません。",
      ),
      MissionStep.run(
        "同じPodのlivenessを成功させる",
        "sim kubernetes probe live-web --kind=liveness --pod=コピーしたPod名 --status-code=200",
        "「コピーしたPod名」は再起動させたPod名に置き換えます。",
      ),
      MissionStep.run(
        "同じPodのreadinessを成功させる",
        "sim kubernetes probe live-web --pod=コピーしたPod名 --status-code=200",
        "livenessの成功だけではreadinessは回復しません。両方を評価してください。",
      ),
      MissionStep.run("RESTARTSとREADYを確かめる", "kubectl get pods"),
      MissionStep.run(
        "接続先が2つに戻ったか確かめる",
        "kubectl describe service live-service",
        "RESTARTSは1と0のまま、全PodがReadyで接続先2つなら達成です。rollout restartやPod削除ではPodが作り直され、RESTARTSが0に戻るため別の操作です。",
      ),
    ],
    assertions: [{ kind: "kubeLivenessRecovered" }],
  },
];
export const kubeLivenessSatisfied = (world: World): boolean => {
  const d = world.kubeDeployments.find(
    (d) =>
      d.projectId === F.devProjectId &&
      d.cluster === "liveness-gke" &&
      d.namespace === "default" &&
      d.name === "live-web",
  );
  if (d?.image !== "nginx:1" || d.replicas !== 2 || d.env.length !== 0) return false;
  if (
    !KubeLiveness.equal(
      d.livenessProbe,
      Option.some({
        httpGet: { path: "/healthz", port: 8080 },
        successThreshold: 1,
        failureThreshold: 2,
      }),
    )
  )
    return false;
  if (
    !KubeReadiness.equal(
      d.readinessProbe,
      Option.some({
        httpGet: { path: "/ready", port: 8080 },
        successThreshold: 1,
        failureThreshold: 1,
      }),
    )
  )
    return false;
  const pods = KubePod.fromDeployment(d);
  if (
    pods.filter((p) => p.restarts === 1).length !== 1 ||
    pods.filter((p) => p.restarts === 0).length !== 1 ||
    pods.some((p) => !p.ready)
  )
    return false;
  if (!d.podLiveness.some((p) => p.restarts === 1 && p.statusCode === 200 && !p.restarted))
    return false;
  const service = world.kubeServices.find(
    (s) =>
      s.projectId === d.projectId &&
      s.cluster === d.cluster &&
      s.namespace === "default" &&
      s.name === "live-service",
  );
  if (service?.port !== 80 || service.targetPort !== 8080) return false;
  const backends = KubeServiceRouting.backends(world, service);
  return backends.length === 2 && backends.every((p) => p.deployment === d.name);
};
