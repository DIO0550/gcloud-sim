import { KubeLabels } from "@/engine/domains/kube-labels";
import { KubeManifest } from "@/engine/domains/kube-manifest";
import { KubeResources } from "@/engine/domains/kube-resources";
import { KubeServiceRouting } from "@/engine/domains/kube-service-routing";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { MissionStep } from "@/engine/missions/mission-step";
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
    steps: [
      MissionStep.run("GKEのAPIを有効にする", "gcloud services enable container.googleapis.com"),
      MissionStep.run(
        "Autopilotクラスタlabels-gkeを作る",
        "gcloud container clusters create-auto labels-gke --region=us-central1",
      ),
      MissionStep.run("ラベル教材のマニフェストを用意する", "sim files load kubernetes-labels"),
      MissionStep.run("blue版のPodラベルを確かめる", "sim files read shop-blue.yaml"),
      MissionStep.run("green版のPodラベルを確かめる", "sim files read shop-green.yaml"),
      MissionStep.run("blue版のDeploymentを作る", "kubectl apply -f shop-blue.yaml"),
      MissionStep.run("green版のDeploymentを作る", "kubectl apply -f shop-green.yaml"),
      MissionStep.run("Service shopを作る", "kubectl apply -f shop-service.yaml"),
      MissionStep.run("app=shopのPodをすべて表示する", "kubectl get pods -l app=shop"),
      MissionStep.run("blue側のPodだけに絞り込む", "kubectl get pods -l app=shop,track=blue"),
      MissionStep.run(
        "Serviceの今の接続先を確かめる",
        "kubectl describe service shop",
        "selectorの全条件に一致するPodが接続先です。Deployment自身のmetadata.labelsとPodのラベルは別です。",
      ),
      MissionStep.run(
        "Serviceのselectorをgreenに書き換える",
        "sim files replace shop-service.yaml --search=blue --replacement=green",
      ),
      MissionStep.run("書き換えたServiceを適用する", "kubectl apply -f shop-service.yaml"),
      MissionStep.run(
        "接続先がgreenに切り替わったか確かめる",
        "kubectl describe service shop",
        "ServiceのIPを保ち、接続先がshop-greenの2つのPodへ切り替わります。",
      ),
      MissionStep.run("green側のPodを確かめる", "kubectl get pods -l app=shop,track=green"),
      MissionStep.run(
        "チームのラベルで両Deploymentが残っているか確かめる",
        "kubectl get deployments -l team=storefront",
        "Deploymentのselectorは変更できません。blue/greenのPodを両方選びたい場合はServiceのtrack条件だけを外しますが、このミッションのゴールはgreenだけへの公開です。",
      ),
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
