import { KubeLabels } from "@/engine/domains/kube-labels";
import { KubeManifest } from "@/engine/domains/kube-manifest";
import { KubeResources } from "@/engine/domains/kube-resources";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { MissionStep } from "@/engine/missions/mission-step";
import { Result } from "@/utils/Result";

export type KubeResourceAssertion = Readonly<{ kind: "kubeResourcesConfigured" }>;
export const KubeResourceMissions: readonly Mission[] = [
  {
    id: "m-gke-008",
    domain: "運用の維持",
    title: "CPU・メモリの必要量と上限を設定する",
    setup: [
      { kind: "setPrincipal", principal: F.owner },
      { kind: "setProject", projectId: F.devProjectId },
    ],
    description:
      "resources-gkeにresource-webを2レプリカで作成します。教材はCPU requestがlimitを超えるため適用できません。requestsをCPU 250m・メモリ128Mi、limitsをCPU 500m・メモリ256Miに直し、ファイルとDeploymentをそろえてください。requestsは配置判断に使う必要量、limitsは利用上限です。この教材では実際の配置や使用量は計算しません。",
    steps: [
      MissionStep.run("GKEのAPIを有効にする", "gcloud services enable container.googleapis.com"),
      MissionStep.run(
        "Autopilotクラスタresources-gkeを作る",
        "gcloud container clusters create-auto resources-gke --region=us-central1",
      ),
      MissionStep.run(
        "リソース教材のマニフェストを用意する",
        "sim files load kubernetes-resources",
      ),
      MissionStep.run("requestsとlimitsの値を確かめる", "sim files read resource-web.yaml"),
      MissionStep.run(
        "誤った設定のまま適用して拒否されるのを確かめる",
        "kubectl apply -f resource-web.yaml",
        "CPU request 500mがlimit 250mを超えているため、エラーになります。失敗時はDeploymentを作成しません。",
      ),
      MissionStep.run(
        "CPU requestの500mを仮の値100mに退避する",
        "sim files replace resource-web.yaml --search=500m --replacement=100m",
        "500mと250mを入れ替えるため、いったん別の値に置き換えます。",
      ),
      MissionStep.run(
        "CPU limitを500mに直す",
        "sim files replace resource-web.yaml --search=250m --replacement=500m",
      ),
      MissionStep.run(
        "CPU requestを250mに直す",
        "sim files replace resource-web.yaml --search=100m --replacement=250m",
      ),
      MissionStep.run("直したマニフェストでDeploymentを作る", "kubectl apply -f resource-web.yaml"),
      MissionStep.run(
        "Deploymentのrequestsとlimitsを確かめる",
        "kubectl describe deployment resource-web",
        "250mは0.25 CPU、128Miは128×1024×1024 bytesです。値は1 Podあたりで、requestsは使用量の測定値ではありません。",
      ),
      MissionStep.run("2つのPodが動いているか確かめる", "kubectl get pods"),
      MissionStep.run(
        "CPU requestを試しに300mへ変える",
        "kubectl set resources deployment/resource-web --requests=cpu=300m",
      ),
      MissionStep.run(
        "リソース変更がrevisionに残ったか確かめる",
        "kubectl rollout history deployment/resource-web",
      ),
      MissionStep.run(
        "1つ前のリソース設定に戻す",
        "kubectl rollout undo deployment/resource-web",
        "リソース設定も履歴から戻せます。",
      ),
      MissionStep.run(
        "ロールバックの完了を確かめる",
        "kubectl rollout status deployment/resource-web",
        "ファイルと実際の設定を一致させて終了します。",
      ),
    ],
    assertions: [{ kind: "kubeResourcesConfigured" }],
  },
];

export const kubeResourcesSatisfied = (world: World): boolean => {
  const d = world.kubeDeployments.find(
    (d) =>
      d.projectId === F.devProjectId &&
      d.cluster === "resources-gke" &&
      d.namespace === "default" &&
      d.name === "resource-web",
  );
  const expected: KubeResources = {
    requests: { cpu: "250m", memory: "128Mi" },
    limits: { cpu: "500m", memory: "256Mi" },
  };
  if (
    d?.image !== "nginx:1" ||
    d.replicas !== 2 ||
    d.env.length !== 0 ||
    !KubeResources.equal(d.resources, expected)
  )
    return false;
  const file = KubeManifest.parse(world.kubeFiles["resource-web.yaml"] ?? "");
  return (
    Result.isOk(file) &&
    file.value.some(
      (m) =>
        m.kind === "deployment" &&
        m.name === d.name &&
        m.image === d.image &&
        m.replicas === d.replicas &&
        m.env.length === 0 &&
        KubeLabels.equal(m.labels, d.labels) &&
        KubeLabels.equal(m.selector, d.selector) &&
        KubeLabels.equal(m.podLabels, d.podLabels) &&
        KubeResources.equal(m.resources, expected),
    )
  );
};
