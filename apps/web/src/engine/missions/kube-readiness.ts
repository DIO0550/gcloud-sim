import { KubeReadiness } from "@/engine/domains/kube-readiness";
import { KubeServiceRouting } from "@/engine/domains/kube-service-routing";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { MissionStep } from "@/engine/missions/mission-step";
import { Option } from "@/utils/Option";

export type KubeReadinessAssertion = Readonly<{ kind: "kubeReadinessRouted" }>;
export const KubeReadinessMissions: readonly Mission[] = [
  {
    id: "m-gke-012",
    domain: "運用の維持",
    title: "未準備のPodをServiceの接続先から外す",
    setup: [
      { kind: "setPrincipal", principal: F.owner },
      { kind: "setProject", projectId: F.devProjectId },
    ],
    description:
      "readiness-gkeに教材のready-webを2レプリカとready-serviceを作ります。HTTP /ready:8080のreadinessProbe（成功・失敗閾値とも2）を使い、200を2回指定して全Podを準備完了にしてください。次に1つのPodだけ503を2回指定し、RunningのままREADYが1/2、Serviceの接続先が1つになる状態にします。HTTP応答は教材として指定し、実際の通信や定期実行は行いません。",
    steps: [
      MissionStep.run("GKEのAPIを有効にする", "gcloud services enable container.googleapis.com"),
      MissionStep.run(
        "Standardクラスタreadiness-gkeを作る",
        "gcloud container clusters create readiness-gke --zone=us-central1-a",
      ),
      MissionStep.run(
        "readiness教材のマニフェストを用意する",
        "sim files load kubernetes-readiness",
      ),
      MissionStep.run("readinessProbeの設定を確かめる", "sim files read ready-web.yaml"),
      MissionStep.run("ready-webを2レプリカで作る", "kubectl apply -f ready-web.yaml"),
      MissionStep.run("Service ready-serviceを作る", "kubectl apply -f ready-service.yaml"),
      MissionStep.run("PodのREADY列を確かめる", "kubectl get pods"),
      MissionStep.run(
        "まだ接続先が無いことを確かめる",
        "kubectl describe service ready-service",
        "PodはRunningでも、まだREADY 0/1で接続先はありません。",
      ),
      MissionStep.run(
        "全Podのreadinessを成功させる",
        "sim kubernetes probe ready-web --status-code=200",
        "2回実行します。1回目は成功閾値2に届かず未準備、2回目で全PodがReadyです。",
      ),
      MissionStep.run(
        "全PodがReadyになるのを確かめる",
        "kubectl rollout status deployment/ready-web",
      ),
      MissionStep.run(
        "接続先が2つになったか確かめる",
        "kubectl describe service ready-service",
        "接続先が2つになります。",
      ),
      MissionStep.run(
        "失敗させるPodの名前を1つ控える",
        "kubectl get pods",
        "表示されたPod名を1つコピーします。",
      ),
      MissionStep.run(
        "控えたPodのreadinessを失敗させる",
        "sim kubernetes probe ready-web --pod=コピーしたPod名 --status-code=503",
        "「コピーしたPod名」は控えたPod名に置き換え、2回実行します。1回目ではReadyを維持し、2回目でそのPodだけNotReadyになります。",
      ),
      MissionStep.run("DeploymentのREADYが1/2か確かめる", "kubectl get deployments"),
      MissionStep.run("2つのPodが残っているか確かめる", "kubectl get pods"),
      MissionStep.run(
        "接続先が1つに減ったか確かめる",
        "kubectl describe service ready-service",
        "2つのPodが残り、Deployment READY 1/2、Service接続先1つなら達成です。readiness失敗だけでは再起動しません。",
      ),
      MissionStep.say(
        "クリア後に接続先へ戻す方法を押さえる",
        "クリア後、失敗したPodに--status-code=200を2回指定すれば接続先へ復帰します。rollout restartすると新Podは未評価からやり直します。応答の指定は1回の評価で、待ち時間や自動実行はありません。",
      ),
    ],
    assertions: [{ kind: "kubeReadinessRouted" }],
  },
];
export const kubeReadinessSatisfied = (world: World): boolean => {
  const d = world.kubeDeployments.find(
    (d) =>
      d.projectId === F.devProjectId &&
      d.cluster === "readiness-gke" &&
      d.namespace === "default" &&
      d.name === "ready-web",
  );
  if (d?.image !== "nginx:1" || d.replicas !== 2 || d.env.length !== 0) return false;
  if (
    !KubeReadiness.equal(
      d.readinessProbe,
      Option.some({
        httpGet: { path: "/ready", port: 8080 },
        successThreshold: 2,
        failureThreshold: 2,
      }),
    )
  )
    return false;
  if (
    d.podReadiness.filter((p) => p.ready && p.statusCode === 200 && p.successes === 2).length !==
      1 ||
    d.podReadiness.filter((p) => !p.ready && p.statusCode === 503 && p.failures === 2).length !== 1
  )
    return false;
  const service = world.kubeServices.find(
    (s) =>
      s.projectId === d.projectId &&
      s.cluster === d.cluster &&
      s.namespace === "default" &&
      s.name === "ready-service",
  );
  if (service?.port !== 80 || service.targetPort !== 8080) return false;
  const backends = KubeServiceRouting.backends(world, service);
  return backends.length === 1 && backends[0]?.deployment === d.name;
};
