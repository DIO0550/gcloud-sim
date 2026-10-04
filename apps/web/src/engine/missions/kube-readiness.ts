import { KubeReadiness } from "@/engine/domains/kube-readiness";
import { KubeServiceRouting } from "@/engine/domains/kube-service-routing";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
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
    hints: [
      "gcloud services enable container.googleapis.com → gcloud container clusters create readiness-gke --zone=us-central1-a → sim files load kubernetes-readiness",
      "sim files read ready-web.yaml → kubectl apply -f ready-web.yaml → kubectl apply -f ready-service.yaml → kubectl get pods → kubectl describe service ready-service。PodはRunningでも、まだREADY 0/1で接続先はありません。",
      "sim kubernetes probe ready-web --status-code=200 を2回実行します。1回目は成功閾値2に届かず未準備、2回目で全PodがReadyです。kubectl rollout status deployment/ready-web → kubectl describe service ready-service。接続先が2つになります。",
      "kubectl get podsで1つのPod名をコピーします。sim kubernetes probe ready-web --pod=コピーしたPod名 --status-code=503 を2回実行します。1回目ではReadyを維持し、2回目でそのPodだけNotReadyになります。",
      "kubectl get deployments → kubectl get pods → kubectl describe service ready-service。2つのPodが残り、Deployment READY 1/2、Service接続先1つなら達成です。readiness失敗だけでは再起動しません。",
      "クリア後、失敗したPodに--status-code=200を2回指定すれば接続先へ復帰します。rollout restartすると新Podは未評価からやり直します。応答の指定は1回の評価で、待ち時間や自動実行はありません。",
    ],
    assertions: [{ kind: "kubeReadinessRouted" }],
  },
];
export const kubeReadinessSatisfied = (world: World): boolean => {
  const d = world.kubeDeployments.find(
    (d) =>
      d.projectId === F.devProjectId && d.cluster === "readiness-gke" && d.name === "ready-web",
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
    (s) => s.projectId === d.projectId && s.cluster === d.cluster && s.name === "ready-service",
  );
  if (service?.port !== 80 || service.targetPort !== 8080) return false;
  const backends = KubeServiceRouting.backends(world, service);
  return backends.length === 1 && backends[0]?.deployment === d.name;
};
