import { KubeContainer } from "@/engine/domains/kube-container";
import { KubeLiveness } from "@/engine/domains/kube-liveness";
import { KubeReadiness } from "@/engine/domains/kube-readiness";
import { KubeServiceRouting } from "@/engine/domains/kube-service-routing";
import { KubeStartup } from "@/engine/domains/kube-startup";
import { KubePod } from "@/engine/domains/kubernetes";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { Option } from "@/utils/Option";

export type KubeStartupAssertion = Readonly<{ kind: "kubeStartupGated" }>;
export const KubeStartupMissions: readonly Mission[] = [
  {
    id: "m-gke-014",
    domain: "運用の維持",
    title: "起動確認が済んだPodだけをServiceへ接続する",
    setup: [
      { kind: "setPrincipal", principal: F.owner },
      { kind: "setProject", projectId: F.devProjectId },
    ],
    description:
      "startup-gkeに教材のslow-webを2レプリカとslow-serviceを作ります。startupの失敗閾値は3、livenessは1です。全Podへstartupの503を2回指定しても再起動しないことを確認し、1つのPodだけstartupとreadinessを200で成功させてください。もう1つは起動待ち、RESTARTSはどちらも0、Service接続先は1つにします。HTTP応答は手動指定で、実通信や起動時間は再現しません。",
    hints: [
      "gcloud services enable container.googleapis.com → gcloud container clusters create startup-gke --zone=us-central1-a → sim files load kubernetes-startup",
      "sim files read slow-web.yaml → kubectl apply -f slow-web.yaml → kubectl apply -f slow-service.yaml。startupの成功前はreadiness/livenessを指定してもStartupProbePendingとなり、評価は進みません。",
      "sim kubernetes probe slow-web --kind=startup --status-code=503 を2回実行します。startupの失敗閾値3に届かず、RESTARTSは0です。livenessの失敗閾値1はまだ使われません。",
      "kubectl get podsで1つのPod名をコピーします。sim kubernetes probe slow-web --kind=startup --pod=コピーしたPod名 --status-code=200。起動確認は済みますが、readinessはまだ未評価です。",
      "同じPodに sim kubernetes probe slow-web --pod=コピーしたPod名 --status-code=200 → kubectl describe service slow-service。接続先が1つとなり、もう1つのPodはstartup連続失敗2で起動待ちなら達成です。",
      "クリア後は起動待ちPodにstartupの200→readinessの200を指定すれば接続先へ加わります。503をもう1回指定するとコンテナ再起動です。startup成功後は再起動までstartupを再評価できず、livenessで再起動した場合もstartupからやり直します。",
    ],
    assertions: [{ kind: "kubeStartupGated" }],
  },
];
export const kubeStartupSatisfied = (world: World): boolean => {
  const d = world.kubeDeployments.find(
    (d) =>
      d.projectId === F.devProjectId &&
      d.cluster === "startup-gke" &&
      d.namespace === "default" &&
      d.name === "slow-web",
  );
  if (d?.image !== "nginx:1" || d.replicas !== 2 || d.env.length !== 0) return false;
  if (
    !KubeStartup.equal(
      d.startupProbe,
      Option.some({
        httpGet: { path: "/healthz", port: 8080 },
        successThreshold: 1,
        failureThreshold: 3,
      }),
    ) ||
    !KubeLiveness.equal(
      d.livenessProbe,
      Option.some({
        httpGet: { path: "/healthz", port: 8080 },
        successThreshold: 1,
        failureThreshold: 1,
      }),
    ) ||
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
  if (pods.some((p) => p.restarts !== 0) || pods.filter((p) => p.ready).length !== 1) return false;
  if (
    d.podStartup.filter((s) => !s.started && s.statusCode === 503 && s.failures === 2).length !==
      1 ||
    d.podStartup.filter((s) => s.started && s.statusCode === 200).length !== 1
  )
    return false;
  const service = world.kubeServices.find(
    (s) =>
      s.projectId === d.projectId &&
      s.cluster === d.cluster &&
      s.namespace === "default" &&
      s.name === "slow-service",
  );
  if (service?.port !== 80 || service.targetPort !== 8080) return false;
  const backends = KubeServiceRouting.backends(world, service);
  return (
    backends.length === 1 &&
    backends[0]?.deployment === d.name &&
    KubeContainer.started(d, backends[0].pod)
  );
};
