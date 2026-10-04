import { KubeLabels } from "@/engine/domains/kube-labels";
import { KubeManifest } from "@/engine/domains/kube-manifest";
import { KubeResources } from "@/engine/domains/kube-resources";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
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
    hints: [
      "gcloud services enable container.googleapis.com → gcloud container clusters create-auto resources-gke --region=us-central1 → sim files load kubernetes-resources",
      "sim files read resource-web.yaml → kubectl apply -f resource-web.yaml。CPU request 500mがlimit 250mを超えているため、エラーになります。失敗時はDeploymentを作成しません。",
      "sim files replace resource-web.yaml --search=500m --replacement=100m → sim files replace resource-web.yaml --search=250m --replacement=500m → sim files replace resource-web.yaml --search=100m --replacement=250m → kubectl apply -f resource-web.yaml",
      "kubectl describe deployment resource-web → kubectl get pods。250mは0.25 CPU、128Miは128×1024×1024 bytesです。値は1 Podあたりで、requestsは使用量の測定値ではありません。",
      "kubectl set resources deployment/resource-web --requests=cpu=300m → kubectl rollout history deployment/resource-web → kubectl rollout undo deployment/resource-web → kubectl rollout status deployment/resource-web。リソース設定も履歴から戻せます。ファイルと実際の設定を一致させて終了します。",
    ],
    assertions: [{ kind: "kubeResourcesConfigured" }],
  },
];

export const kubeResourcesSatisfied = (world: World): boolean => {
  const d = world.kubeDeployments.find(
    (d) =>
      d.projectId === F.devProjectId && d.cluster === "resources-gke" && d.name === "resource-web",
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
