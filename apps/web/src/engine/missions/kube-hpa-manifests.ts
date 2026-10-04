import { KubeHpa } from "@/engine/domains/kube-hpa";
import { KubeManifest } from "@/engine/domains/kube-manifest";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

export type KubeHpaManifestAssertion = Readonly<{ kind: "kubeHpaManifestConfigured" }>;
export const KubeHpaManifestMissions: readonly Mission[] = [
  {
    id: "m-gke-010",
    domain: "運用の維持",
    title: "HPAの設定ファイルを変更して再評価する",
    setup: [
      { kind: "setPrincipal", principal: F.owner },
      { kind: "setProject", projectId: F.devProjectId },
    ],
    description:
      "hpa-manifest-gkeでautoscale-webのHPAをファイルから作成します。教材の上限は3レプリカです。CPU目標を50%、最大数を6へ変更してapplyし、1 Podあたり250mの使用量で3→6レプリカへ増やしてください。ファイル・HPA設定・評価結果をそろえて完了です。",
    hints: [
      "gcloud services enable container.googleapis.com → gcloud container clusters create-auto hpa-manifest-gke --region=us-central1 → sim files load kubernetes-hpa",
      "sim files read autoscale-hpa.yaml → kubectl apply -f autoscale-web.yaml → kubectl apply -f autoscale-hpa.yaml → sim kubernetes reconcile autoscale-web --cpu=1。上限3で止まり、TooManyReplicasと表示されます。",
      "sim files replace autoscale-hpa.yaml --search='maxReplicas: 3' --replacement='maxReplicas: 6' → sim files replace autoscale-hpa.yaml --search='averageUtilization: 80' --replacement='averageUtilization: 50'",
      "kubectl apply -f autoscale-hpa.yaml → kubectl get hpa。設定変更で前回の教材評価を消しますが、Deploymentはまだ3レプリカです。applyだけでは再評価しません。",
      "sim kubernetes reconcile autoscale-web --cpu=250m → kubectl describe hpa autoscale-web → kubectl get deployment autoscale-web。request 250mに対する使用率100%、目標50%でceil(3×100/50)=6です。",
      "kubectl apply -f autoscale-web.yaml → kubectl apply -f autoscale-hpa.yaml。同じHPA設定なら評価結果を保ちます。Deploymentファイルはreplicasを省略しているので、再applyしてもスケール後の6を維持します。",
    ],
    assertions: [{ kind: "kubeHpaManifestConfigured" }],
  },
];
export const kubeHpaManifestSatisfied = (world: World): boolean => {
  const h = world.kubeHpas.find(
    (h) =>
      h.projectId === F.devProjectId &&
      h.cluster === "hpa-manifest-gke" &&
      h.namespace === "default" &&
      h.name === "autoscale-web",
  );
  if (
    h?.target !== "autoscale-web" ||
    h.minReplicas !== 1 ||
    h.maxReplicas !== 6 ||
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
  if (d?.image !== "nginx:1" || d.replicas !== 6 || d.resources.requests.cpu !== "250m")
    return false;
  const e = h.lastEvaluation.value;
  if (
    e.reason !== "Scaled" ||
    e.cpuMilli !== 250 ||
    e.requestMilli !== 250 ||
    e.currentReplicas !== 3 ||
    e.desiredReplicas !== 6
  )
    return false;
  const file = KubeManifest.parse(world.kubeFiles["autoscale-hpa.yaml"] ?? "");
  return (
    Result.isOk(file) &&
    file.value.some((m) => m.kind === "hpa" && m.name === h.name && KubeHpa.sameSpec(h, m))
  );
};
