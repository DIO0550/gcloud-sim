import { KubeRuntime } from "@/engine/domains/kube-config";
import { KubeServiceRouting } from "@/engine/domains/kube-service-routing";
import { KubePod } from "@/engine/domains/kubernetes";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { MissionStep } from "@/engine/missions/mission-step";
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
    steps: [
      MissionStep.run("GKEのAPIを有効にする", "gcloud services enable container.googleapis.com"),
      MissionStep.run(
        "Standardクラスタnamespace-gkeを作る",
        "gcloud container clusters create namespace-gke --zone=us-central1-a",
      ),
      MissionStep.run(
        "namespace教材のマニフェストを用意する",
        "sim files load kubernetes-namespace",
      ),
      MissionStep.run("stagingとproductionのnamespaceを作る", "kubectl apply -f namespaces.yaml"),
      MissionStep.run("namespaceができたか確かめる", "kubectl get namespaces"),
      MissionStep.run(
        "検証環境のweb一式を作る",
        "kubectl apply -f staging.yaml",
        "metadata.namespaceの指定に従って別々の環境へ作ります。",
      ),
      MissionStep.run("本番環境のweb一式を作る", "kubectl apply -f production.yaml"),
      MissionStep.run(
        "namespaceを省略するとdefaultが対象になることを確かめる",
        "kubectl get deployments",
        "defaultを対象にするので空です。",
      ),
      MissionStep.run(
        "全namespaceのDeploymentを一覧する",
        "kubectl get deployments -A",
        "NAMESPACE列を確認します。",
      ),
      MissionStep.run("検証環境のwebだけを選ぶ", "kubectl get deployment web -n staging"),
      MissionStep.run(
        "検証環境のwebをnginx:2へ更新する",
        "kubectl set image deployment/web web=nginx:2 -n staging",
      ),
      MissionStep.run(
        "検証環境のwebを3レプリカに増やす",
        "kubectl scale deployment/web --replicas=3 -n staging",
        "本番の同名Deploymentは変わりません。",
      ),
      MissionStep.run(
        "検証環境のPodのMODEを確かめる",
        "kubectl exec deployment/web -n staging -- printenv MODE",
      ),
      MissionStep.run(
        "本番環境のPodのMODEを確かめる",
        "kubectl exec deployment/web -n production -- printenv MODE",
        "値はそれぞれstaging/productionで、同名ConfigMapを取り違えません。",
      ),
      MissionStep.run(
        "検証環境のServiceの接続先を確かめる",
        "kubectl describe service web-service -n staging",
      ),
      MissionStep.run(
        "本番環境のServiceの接続先を確かめる",
        "kubectl describe service web-service -n production",
        "接続先はそれぞれ3つ/1つです。",
      ),
      MissionStep.run(
        "両環境のイメージとレプリカ数を比べる",
        "kubectl get deployments -A -o json",
        "イメージ・レプリカ・namespaceを比べれば達成です。namespace削除は中のリソースも即時削除するため、片付けはクリア後に行います。",
      ),
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
