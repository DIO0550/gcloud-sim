import { KubeRuntime } from "@/engine/domains/kube-config";
import { KubeManifest } from "@/engine/domains/kube-manifest";
import { KubePod } from "@/engine/domains/kubernetes";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { Result } from "@/utils/Result";

export type KubeBinaryDataAssertion = Readonly<{ kind: "kubeBinaryDataSeparated" }>;

export const KubeBinaryDataMissions: readonly Mission[] = [
  {
    id: "m-gke-019",
    domain: "運用の維持",
    title: "バイナリ設定と環境変数の参照を分ける",
    setup: [
      { kind: "setPrincipal", principal: F.owner },
      { kind: "setProject", projectId: F.devProjectId },
    ],
    description:
      "binary-gkeにasset-settingsとasset-webを配置します。ConfigMapにはdataのMODE=productionと、binaryDataのasset.bin（AP+AAQ==、4 bytes）が入っています。asset-webは誤ってasset.binを環境変数として参照して起動できません。asset-web.yamlの参照キーをMODEへ直してapplyし、nginx:1・2レプリカをReadyにしてください。binaryDataは環境変数へ注入できません。バイナリを保存したまま、テキスト設定だけを使います。volumeマウントは今回の教材では未対応です。",
    hints: [
      "gcloud services enable container.googleapis.com → gcloud container clusters create-auto binary-gke --region=us-central1 → sim files load kubernetes-binary-data",
      "kubectl apply -f asset-settings.yaml → kubectl apply -f asset-web.yaml → kubectl get pods。binaryDataのキーはconfigMapKeyRefから読めず、CreateContainerConfigErrorになります。",
      "kubectl get cm asset-settings -o yaml → kubectl describe cm asset-settings。getはbase64のbinaryDataを返し、describeとプロパティはasset.binを4 bytesと表示します。dataのMODEと区別してください。",
      "sim files replace asset-web.yaml --search='key: asset.bin' --replacement='key: MODE' → kubectl apply -f asset-web.yaml。ConfigMapのbinaryDataは消さず、参照だけをテキストキーへ変更します。",
      "kubectl rollout status deployment/asset-web → kubectl exec deployment/asset-web -- printenv MODE。ファイル・クラスタの参照がMODEになり、2つのPodがproductionを取得してReadyになると達成します。",
    ],
    assertions: [{ kind: "kubeBinaryDataSeparated" }],
  },
];

export const kubeBinaryDataSatisfied = (world: World): boolean => {
  const config = world.kubeConfigs.find(
    (c) =>
      c.projectId === F.devProjectId &&
      c.cluster === "binary-gke" &&
      c.namespace === "default" &&
      c.kind === "configmap" &&
      c.name === "asset-settings",
  );
  if (
    config?.data.length !== 1 ||
    config.data[0]?.key !== "MODE" ||
    config.data[0]?.value !== "production" ||
    config.binaryData.length !== 1 ||
    config.binaryData[0]?.key !== "asset.bin" ||
    config.binaryData[0]?.value !== "AP+AAQ=="
  )
    return false;

  const configFile = KubeManifest.parse(world.kubeFiles["asset-settings.yaml"] ?? "");
  if (!Result.isOk(configFile) || configFile.value.length !== 1) return false;
  const cm = configFile.value[0];
  if (
    cm?.kind !== "configmap" ||
    cm.name !== config.name ||
    (cm.namespace !== undefined && cm.namespace !== "default") ||
    JSON.stringify(cm.data) !== JSON.stringify(config.data) ||
    JSON.stringify(cm.binaryData) !== JSON.stringify(config.binaryData)
  )
    return false;

  const deployment = world.kubeDeployments.find(
    (d) =>
      d.projectId === F.devProjectId &&
      d.cluster === "binary-gke" &&
      d.namespace === "default" &&
      d.name === "asset-web",
  );
  if (deployment?.image !== "nginx:1" || deployment.replicas !== 2) return false;
  const usesText = (env: typeof deployment.env) =>
    env.length === 1 &&
    env[0]?.name === "MODE" &&
    env[0]?.source === "configmap" &&
    env[0]?.resource === "asset-settings" &&
    env[0]?.key === "MODE";
  if (!usesText(deployment.env)) return false;

  const deploymentFile = KubeManifest.parse(world.kubeFiles["asset-web.yaml"] ?? "");
  if (!Result.isOk(deploymentFile) || deploymentFile.value.length !== 1) return false;
  const d = deploymentFile.value[0];
  if (
    d?.kind !== "deployment" ||
    d.name !== "asset-web" ||
    d.image !== "nginx:1" ||
    d.replicas !== 2 ||
    (d.namespace !== undefined && d.namespace !== "default") ||
    !usesText(d.env)
  )
    return false;

  return KubePod.fromDeployment(deployment).every((pod) => {
    const env = KubeRuntime.environment(world.kubeConfigs, deployment, pod.name);
    return (
      pod.ready &&
      Result.isOk(env) &&
      env.value.values.some((entry) => entry.name === "MODE" && entry.value === "production")
    );
  });
};
