import { KubeHpa } from "@/engine/domains/kube-hpa";
import { KubeManifest } from "@/engine/domains/kube-manifest";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { MissionStep } from "@/engine/missions/mission-step";
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
    steps: [
      MissionStep.run(
        "Kubernetes Engine APIを有効にする",
        "gcloud services enable container.googleapis.com",
      ),
      MissionStep.run(
        "Autopilotクラスタを作る",
        "gcloud container clusters create-auto hpa-manifest-gke --region=us-central1",
      ),
      MissionStep.run("教材のマニフェストを読み込む", "sim files load kubernetes-hpa"),
      MissionStep.run("HPAファイルの上限と目標を確かめる", "sim files read autoscale-hpa.yaml"),
      MissionStep.run("autoscale-webを配置する", "kubectl apply -f autoscale-web.yaml"),
      MissionStep.run("ファイルからHPAを作る", "kubectl apply -f autoscale-hpa.yaml"),
      MissionStep.run(
        "1 Podあたり1 CPUの使用量でHPAを評価する",
        "sim kubernetes reconcile autoscale-web --cpu=1",
        "上限3で止まり、TooManyReplicasと表示されます。",
      ),
      MissionStep.run(
        "ファイルの最大レプリカ数を6へ上げる",
        "sim files replace autoscale-hpa.yaml --search='maxReplicas: 3' --replacement='maxReplicas: 6'",
      ),
      MissionStep.run(
        "ファイルのCPU目標を50%へ下げる",
        "sim files replace autoscale-hpa.yaml --search='averageUtilization: 80' --replacement='averageUtilization: 50'",
      ),
      MissionStep.run("変更したHPAをクラスタへ反映する", "kubectl apply -f autoscale-hpa.yaml"),
      MissionStep.run(
        "HPAの設定とレプリカ数を確かめる",
        "kubectl get hpa",
        "設定変更で前回の教材評価を消しますが、Deploymentはまだ3レプリカです。applyだけでは再評価しません。",
      ),
      MissionStep.run(
        "1 Podあたり250mの使用量で再評価する",
        "sim kubernetes reconcile autoscale-web --cpu=250m",
      ),
      MissionStep.run("HPAの評価結果を確かめる", "kubectl describe hpa autoscale-web"),
      MissionStep.run(
        "6レプリカへ増えたか確かめる",
        "kubectl get deployment autoscale-web",
        "request 250mに対する使用率100%、目標50%でceil(3×100/50)=6です。",
      ),
      MissionStep.run(
        "再applyしてもレプリカ数6が保たれるか確かめる",
        "kubectl apply -f autoscale-web.yaml",
        "Deploymentファイルはreplicasを省略しているので、再applyしてもスケール後の6を維持します。",
      ),
      MissionStep.run(
        "HPAを再applyしても評価結果が残るか確かめる",
        "kubectl apply -f autoscale-hpa.yaml",
        "同じHPA設定なら評価結果を保ちます。",
      ),
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
