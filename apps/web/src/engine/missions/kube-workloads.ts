import { KubeManifest } from "@/engine/domains/kube-manifest";
import { KubeServiceRouting } from "@/engine/domains/kube-service-routing";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { Result } from "@/utils/Result";

export type KubeWorkloadAssertion = Readonly<{ kind: "kubeWorkloadApplied" }>;
export const KubeWorkloadMissions: readonly Mission[] = [
  {
    id: "m-gke-006",
    domain: "運用の維持",
    title: "マニフェストでアプリを更新しServiceの接続先を直す",
    setup: [
      { kind: "setPrincipal", principal: F.owner },
      { kind: "setProject", projectId: F.devProjectId },
    ],
    description:
      "manifest-gkeに教材のDeploymentとServiceをapplyします。nginx:1からnginx:2へ更新し、Serviceの間違ったselectorを直してください。2つのPodが接続先に表示され、編集したファイルとクラスタの状態が一致すれば達成です。",
    hints: [
      "gcloud services enable container.googleapis.com → gcloud container clusters create-auto manifest-gke --region=us-central1 → sim files load kubernetes-workload。既存ファイルの上書きは --force を明示します。",
      "sim files read web-deployment.yaml → sim files read web-service.yaml → kubectl apply -f web-deployment.yaml → kubectl apply -f web-service.yaml",
      "kubectl get pods → kubectl describe service manifest-svc。Podは起動していてもselectorがwrong-appのためendpointsは<none>です。",
      "sim files replace web-deployment.yaml --search=nginx:1 --replacement=nginx:2 → kubectl apply -f web-deployment.yaml → kubectl rollout history deployment/manifest-web",
      "sim files replace web-service.yaml --search=wrong-app --replacement=manifest-web → kubectl apply -f web-service.yaml → kubectl describe service manifest-svc → kubectl rollout status deployment/manifest-web。ServiceのIPを保ったまま接続先が2つになります。",
    ],
    assertions: [{ kind: "kubeWorkloadApplied" }],
  },
];

export const kubeWorkloadSatisfied = (world: World): boolean => {
  const matches = (r: { projectId: string; cluster: string }) =>
    r.projectId === F.devProjectId && r.cluster === "manifest-gke";
  const d = world.kubeDeployments.find((d) => matches(d) && d.name === "manifest-web");
  const s = world.kubeServices.find((s) => matches(s) && s.name === "manifest-svc");
  if (
    !d ||
    !s ||
    d.image !== "nginx:2" ||
    d.replicas !== 2 ||
    d.env.length !== 0 ||
    !d.revisions.some((r) => r.image === "nginx:1") ||
    s.targetDeployment !== d.name ||
    s.type !== "LoadBalancer" ||
    s.port !== 80 ||
    s.targetPort !== 80 ||
    KubeServiceRouting.endpoints(world, s).length !== 2
  )
    return false;
  const deployment = KubeManifest.parse(world.kubeFiles["web-deployment.yaml"] ?? "");
  const service = KubeManifest.parse(world.kubeFiles["web-service.yaml"] ?? "");
  if (!Result.isOk(deployment) || !Result.isOk(service)) return false;
  return (
    deployment.value.some(
      (m) =>
        m.kind === "deployment" &&
        m.name === d.name &&
        m.image === d.image &&
        m.replicas === d.replicas &&
        m.env.length === 0,
    ) &&
    service.value.some(
      (m) =>
        m.kind === "service" &&
        m.name === s.name &&
        m.type === s.type &&
        m.targetDeployment === s.targetDeployment &&
        m.port === s.port &&
        m.targetPort === s.targetPort,
    )
  );
};
