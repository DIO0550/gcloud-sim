import { KubeLabels } from "@/engine/domains/kube-labels";
import { KubeManifest } from "@/engine/domains/kube-manifest";
import { KubeResources } from "@/engine/domains/kube-resources";
import { KubeServiceRouting } from "@/engine/domains/kube-service-routing";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { Result } from "@/utils/Result";

export type KubeLabelAssertion = Readonly<{ kind: "kubeLabelsSwitched" }>;
export const KubeLabelMissions: readonly Mission[] = [
  {
    id: "m-gke-007",
    domain: "運用の維持",
    title: "ラベルでServiceの公開先を切り替える",
    setup: [
      { kind: "setPrincipal", principal: F.owner },
      { kind: "setProject", projectId: F.devProjectId },
    ],
    description:
      "labels-gkeにshop-blueとshop-greenを2レプリカずつ作成します。appとtrackの2つのラベルを使い、Service shopの接続先をgreenのPodだけに切り替えてください。両Deploymentを残し、編集したファイルとクラスタの状態をそろえます。",
    hints: [
      "gcloud services enable container.googleapis.com → gcloud container clusters create-auto labels-gke --region=us-central1 → sim files load kubernetes-labels",
      "sim files read shop-blue.yaml → sim files read shop-green.yaml → kubectl apply -f shop-blue.yaml → kubectl apply -f shop-green.yaml → kubectl apply -f shop-service.yaml",
      "kubectl get pods -l app=shop → kubectl get pods -l app=shop,track=blue → kubectl describe service shop。selectorの全条件に一致するPodが接続先です。Deployment自身のmetadata.labelsとPodのラベルは別です。",
      "sim files replace shop-service.yaml --search=blue --replacement=green → kubectl apply -f shop-service.yaml → kubectl describe service shop。ServiceのIPを保ち、接続先がshop-greenの2つのPodへ切り替わります。",
      "kubectl get pods -l app=shop,track=green → kubectl get deployments -l team=storefront。Deploymentのselectorは変更できません。blue/greenのPodを両方選びたい場合はServiceのtrack条件だけを外しますが、このミッションのゴールはgreenだけへの公開です。",
    ],
    assertions: [{ kind: "kubeLabelsSwitched" }],
  },
];

export const kubeLabelsSatisfied = (world: World): boolean => {
  const matches = (r: { projectId: string; cluster: string; namespace: string }) =>
    r.projectId === F.devProjectId && r.cluster === "labels-gke" && r.namespace === "default";
  for (const [track, image] of [
    ["blue", "nginx:1"],
    ["green", "nginx:2"],
  ] as const) {
    const d = world.kubeDeployments.find((d) => matches(d) && d.name === `shop-${track}`);
    if (
      !d ||
      d.image !== image ||
      d.replicas !== 2 ||
      d.env.length !== 0 ||
      !KubeLabels.equal(d.selector, { app: "shop", track }) ||
      !KubeLabels.equal(d.podLabels, d.selector)
    )
      return false;
    const file = KubeManifest.parse(world.kubeFiles[`shop-${track}.yaml`] ?? "");
    if (
      !Result.isOk(file) ||
      !file.value.some(
        (m) =>
          m.kind === "deployment" &&
          m.name === d.name &&
          m.image === d.image &&
          m.replicas === d.replicas &&
          KubeResources.equal(m.resources, d.resources) &&
          m.env.length === 0 &&
          KubeLabels.equal(m.labels, d.labels) &&
          KubeLabels.equal(m.selector, d.selector) &&
          KubeLabels.equal(m.podLabels, d.podLabels),
      )
    )
      return false;
  }
  const s = world.kubeServices.find((s) => matches(s) && s.name === "shop");
  if (
    s?.type !== "LoadBalancer" ||
    s.port !== 80 ||
    s.targetPort !== 80 ||
    !KubeLabels.equal(s.selector, { app: "shop", track: "green" })
  )
    return false;
  const backends = KubeServiceRouting.backends(world, s);
  if (backends.length !== 2 || backends.some((b) => b.deployment !== "shop-green")) return false;
  const file = KubeManifest.parse(world.kubeFiles["shop-service.yaml"] ?? "");
  return (
    Result.isOk(file) &&
    file.value.some(
      (m) =>
        m.kind === "service" &&
        m.name === s.name &&
        m.type === s.type &&
        m.port === s.port &&
        m.targetPort === s.targetPort &&
        KubeLabels.equal(m.labels, s.labels) &&
        KubeLabels.equal(m.selector, s.selector),
    )
  );
};
