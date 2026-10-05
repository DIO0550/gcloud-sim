import { KubeRuntime } from "@/engine/domains/kube-config";
import { KubeServiceRouting } from "@/engine/domains/kube-service-routing";
import { KubePod } from "@/engine/domains/kubernetes";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { Result } from "@/utils/Result";

export type KubeNamespaceAssertion = Readonly<{ kind: "kubeNamespaceIsolated" }>;
export const KubeNamespaceMissions: readonly Mission[] = [
  {
    id: "m-gke-015",
    domain: "運用の維持",
    title: "namespaceで検証環境と本番環境を分ける",
    setup: [
      { kind: "setPrincipal", principal: F.owner },
      { kind: "setProject", projectId: F.devProjectId },
    ],
    description:
      "namespace-gkeでstagingとproductionに同名のweb・settings・web-serviceを作ります。stagingだけnginx:2・3レプリカへ更新し、本番はnginx:1・1レプリカ・revision 1を保ってください。各PodのMODEとService接続先が同じnamespace内で解決されることを確認します。namespaceを省略するとdefaultが対象です。",
    hints: [
      "gcloud services enable container.googleapis.com → gcloud container clusters create namespace-gke --zone=us-central1-a → sim files load kubernetes-namespace",
      "kubectl apply -f namespaces.yaml → kubectl get namespaces。続いてkubectl apply -f staging.yaml → kubectl apply -f production.yaml。metadata.namespaceの指定に従って別々の環境へ作ります。",
      "kubectl get deploymentsはdefaultを対象にするので空です。kubectl get deployments -AでNAMESPACE列を確認し、kubectl get deployment web -n stagingで検証環境だけを選びます。",
      "kubectl set image deployment/web web=nginx:2 -n staging → kubectl scale deployment/web --replicas=3 -n staging。本番の同名Deploymentは変わりません。",
      "kubectl exec deployment/web -n staging -- printenv MODE → kubectl exec deployment/web -n production -- printenv MODE。値はそれぞれstaging/productionで、同名ConfigMapを取り違えません。",
      "kubectl describe service web-service -n staging → kubectl describe service web-service -n production。接続先はそれぞれ3つ/1つです。kubectl get deployments -A -o jsonでイメージ・レプリカ・namespaceを比べれば達成。namespace削除は中のリソースも即時削除するため、片付けはクリア後に行います。",
    ],
    assertions: [{ kind: "kubeNamespaceIsolated" }],
  },
];

export const kubeNamespaceSatisfied = (world: World): boolean => {
  for (const namespace of ["staging", "production"]) {
    const same = (r: { projectId: string; cluster: string; namespace: string }) =>
      r.projectId === F.devProjectId && r.cluster === "namespace-gke" && r.namespace === namespace;
    const d = world.kubeDeployments.find((d) => same(d) && d.name === "web");
    const s = world.kubeServices.find((s) => same(s) && s.name === "web-service");
    const c = world.kubeConfigs.find(
      (c) => same(c) && c.kind === "configmap" && c.name === "settings",
    );
    const staging = namespace === "staging";
    if (
      !d ||
      !s ||
      !c ||
      d.image !== (staging ? "nginx:2" : "nginx:1") ||
      d.replicas !== (staging ? 3 : 1) ||
      (!staging && d.revision !== 1)
    )
      return false;
    if (
      c.data.find((e) => e.key === "MODE")?.value !== namespace ||
      s.port !== 80 ||
      s.targetPort !== 80 ||
      s.type !== "ClusterIP"
    )
      return false;
    if (
      !d.env.some(
        (e) =>
          e.name === "MODE" &&
          e.source === "configmap" &&
          e.resource === "settings" &&
          e.key === "MODE",
      )
    )
      return false;
    if (
      !KubePod.fromDeployment(d).every((p) => {
        const env = KubeRuntime.environment(world, d, p.name);
        return (
          Result.isOk(env) && env.value.values.find((e) => e.name === "MODE")?.value === namespace
        );
      })
    )
      return false;
    const backends = KubeServiceRouting.backends(world, s);
    if (backends.length !== d.replicas || backends.some((b) => b.deployment !== "web"))
      return false;
  }
  return true;
};
