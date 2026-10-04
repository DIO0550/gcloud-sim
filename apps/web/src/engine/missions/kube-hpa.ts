import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { Option } from "@/utils/Option";

export type KubeHpaAssertion = Readonly<{ kind: "kubeHpaScaled" }>;
export const KubeHpaMissions: readonly Mission[] = [
  {
    id: "m-gke-009",
    domain: "運用の維持",
    title: "CPU使用率に合わせてPodを増やす",
    setup: [
      { kind: "setPrincipal", principal: F.owner },
      { kind: "setProject", projectId: F.devProjectId },
    ],
    description:
      "hpa-gkeにhpa-webを2レプリカで作り、CPU requestを250mに設定します。HPAの範囲を1〜5、目標をrequestの50%とし、1 Podあたり250mの教材用使用量で評価して4レプリカへ増やしてください。CPU使用率の分母はlimitではなくrequestです。",
    hints: [
      "gcloud services enable container.googleapis.com → gcloud container clusters create-auto hpa-gke --region=us-central1 → kubectl create deployment hpa-web --image=nginx:1 --replicas=2",
      "kubectl autoscale deployment/hpa-web --min=1 --max=5 --cpu-percent=50 → sim kubernetes reconcile hpa-web --cpu=250m。requestがないのでMissingCpuRequestになり、レプリカ数は変わりません。",
      "kubectl set resources deployment/hpa-web --requests=cpu=250m → kubectl get hpa。設定変更だけでは教材評価を再実行しません。",
      "sim kubernetes reconcile hpa-web --cpu=250m → kubectl get deployment hpa-web → kubectl describe hpa hpa-web。CPU使用率は250m/250m=100%、必要数はceil(2×100/50)=4です。",
      "クリア後はsim kubernetes reconcile hpa-web --cpu=10mで最小数への縮小も試せます。毎回、評価前の全Podに同じ使用量を与えます。実測・定期実行・スケール速度制限・縮小の安定化待機は再現しません。",
    ],
    assertions: [{ kind: "kubeHpaScaled" }],
  },
];
export const kubeHpaSatisfied = (world: World): boolean => {
  const h = world.kubeHpas.find(
    (h) =>
      h.projectId === F.devProjectId &&
      h.cluster === "hpa-gke" &&
      h.namespace === "default" &&
      h.name === "hpa-web",
  );
  if (
    h?.target !== "hpa-web" ||
    h.minReplicas !== 1 ||
    h.maxReplicas !== 5 ||
    h.targetCpu !== 50 ||
    !Option.isSome(h.lastEvaluation)
  )
    return false;
  const d = world.kubeDeployments.find(
    (d) =>
      d.projectId === h.projectId &&
      d.cluster === h.cluster &&
      d.namespace === "default" &&
      d.name === h.target,
  );
  if (d?.image !== "nginx:1" || d.replicas !== 4 || d.resources.requests.cpu !== "250m")
    return false;
  const e = h.lastEvaluation.value;
  return (
    e.reason === "Scaled" &&
    e.cpuMilli === 250 &&
    e.requestMilli === 250 &&
    e.currentReplicas === 2 &&
    e.desiredReplicas === 4
  );
};
