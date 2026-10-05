import { KubeRuntime } from "@/engine/domains/kube-config";
import { KubeManifest } from "@/engine/domains/kube-manifest";
import { KubeVolumes } from "@/engine/domains/kube-volume";
import { KubePod } from "@/engine/domains/kubernetes";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { Result } from "@/utils/Result";

export type KubeVolumesAssertion = Readonly<{
  kind: "kubeVolumesReady" | "kubeVolumeRefreshReady";
}>;
const setup = [
  { kind: "setPrincipal", principal: F.owner },
  { kind: "setProject", projectId: F.devProjectId },
] as const;
export const KubeVolumesMissions: readonly Mission[] = [
  {
    id: "m-gke-020",
    domain: "運用の維持",
    title: "設定ファイルのマウント障害を直す",
    setup,
    description:
      "volume-gkeへConfigMap・Secret・volume-webを配置します。誤ったitemsのキーでPodはFailedMountとなります。volume-web.yamlのmissing.confをapp.confへ直してapplyし、nginx:1・2レプリカをReadyにしてください。/etc/app/app.confはproduction、/etc/app/assets/asset.binは4 bytes、/etc/credentials/TOKENはdemo-volume-tokenです。SecretやbinaryDataをファイルとして使い、参照先を修復します。",
    hints: [
      "gcloud services enable container.googleapis.com → gcloud container clusters create-auto volume-gke --region=us-central1 → sim files load kubernetes-volumes",
      "kubectl apply -f volume-settings.yaml → kubectl apply -f volume-credentials.yaml → kubectl apply -f volume-web.yaml → kubectl get pods。ContainerCreatingのFailedMountで不足キーを確認します。",
      "kubectl describe deployment volume-web → kubectl get deployment volume-web -o yaml。volumesの参照元・itemsとvolumeMountsのパスを確認します。",
      "sim files replace volume-web.yaml --search='key: missing.conf' --replacement='key: app.conf' → kubectl apply -f volume-web.yaml → kubectl rollout status deployment/volume-web",
      "kubectl exec deployment/volume-web -- cat /etc/app/app.conf → kubectl exec deployment/volume-web -- base64 /etc/app/assets/asset.bin → kubectl exec deployment/volume-web -- cat /etc/credentials/TOKEN。AP+AAQ==は非UTF-8の4 bytesです。",
    ],
    assertions: [{ kind: "kubeVolumesReady" }],
  },
  {
    id: "m-gke-021",
    domain: "運用の維持",
    title: "マウントと環境変数の更新差を確認する",
    setup,
    description:
      "reload-gkeへreload-settingsとreload-webを配置します。MODEをstagingからproductionにしてConfigMapをapplyすると、/etc/config/MODEは更新されます。subPathの/etc/mode.confと環境変数MODEはstagingを保持するため、rollout restartでPodを作り直します。マウント方法と環境変数による更新差を観察し、nginx:1・2レプリカで3つの値をproductionにそろえてください。",
    hints: [
      "gcloud services enable container.googleapis.com → gcloud container clusters create-auto reload-gke --region=us-central1 → sim files load kubernetes-volume-refresh",
      "kubectl apply -f reload-settings.yaml → kubectl apply -f reload-web.yaml → kubectl exec deployment/reload-web -- cat /etc/config/MODE",
      "sim files replace reload-settings.yaml --search='MODE: staging' --replacement='MODE: production' → kubectl apply -f reload-settings.yaml",
      "kubectl exec deployment/reload-web -- cat /etc/config/MODE → kubectl exec deployment/reload-web -- cat /etc/mode.conf → kubectl exec deployment/reload-web -- printenv MODE。通常マウントだけproductionとなります。",
      "kubectl rollout restart deployment/reload-web → kubectl rollout status deployment/reload-web。3つの値を確認します。通常マウントの更新は教材ではapply時に即反映し、実環境の遅延は再現しません。",
    ],
    assertions: [{ kind: "kubeVolumeRefreshReady" }],
  },
];
export const kubeVolumesSatisfied = (world: World, refresh: boolean): boolean => {
  const name = refresh ? "reload-web" : "volume-web";
  const cluster = refresh ? "reload-gke" : "volume-gke";
  const d = world.kubeDeployments.find(
    (d) =>
      d.projectId === F.devProjectId &&
      d.cluster === cluster &&
      d.namespace === "default" &&
      d.name === name,
  );
  if (d?.image !== "nginx:1" || d.replicas !== 2) return false;
  const parsed = KubeManifest.parse(world.kubeFiles[`${name}.yaml`] ?? "");
  if (!Result.isOk(parsed) || parsed.value.length !== 1) return false;
  const file = parsed.value[0];
  if (
    file?.kind !== "deployment" ||
    file.name !== name ||
    (file.namespace !== undefined && file.namespace !== "default") ||
    file.image !== d.image ||
    file.replicas !== d.replicas ||
    !KubeVolumes.equal(file, d)
  )
    return false;
  const source = (name: string, kind: "configmap" | "secret") =>
    world.kubeConfigs.find(
      (c) =>
        c.projectId === F.devProjectId &&
        c.cluster === cluster &&
        c.namespace === "default" &&
        c.kind === kind &&
        c.name === name,
    );
  const matchesFile = (name: string, kind: "configmap" | "secret") => {
    const config = source(name, kind);
    const parsed = KubeManifest.parse(world.kubeFiles[`${name}.yaml`] ?? "");
    if (!config || !Result.isOk(parsed) || parsed.value.length !== 1) return false;
    const file = parsed.value[0];
    return (
      file?.kind === kind &&
      file.name === name &&
      (file.namespace === undefined || file.namespace === "default") &&
      JSON.stringify(file.data) === JSON.stringify(config.data) &&
      JSON.stringify(file.binaryData) === JSON.stringify(config.binaryData)
    );
  };
  if (
    refresh
      ? !matchesFile("reload-settings", "configmap")
      : !matchesFile("volume-settings", "configmap") || !matchesFile("volume-credentials", "secret")
  )
    return false;
  if (refresh) {
    if (
      !d.revisions.some((r) => r.reason === "restart") ||
      source("reload-settings", "configmap")?.data.find((e) => e.key === "MODE")?.value !==
        "production"
    )
      return false;
    const configFile = KubeManifest.parse(world.kubeFiles["reload-settings.yaml"] ?? "");
    if (
      !Result.isOk(configFile) ||
      configFile.value.length !== 1 ||
      configFile.value[0]?.kind !== "configmap" ||
      configFile.value[0].name !== "reload-settings" ||
      configFile.value[0].data.find((e) => e.key === "MODE")?.value !== "production"
    )
      return false;
    if (
      d.volumes.length !== 1 ||
      d.volumes[0]?.source !== "configmap" ||
      d.volumes[0].resource !== "reload-settings" ||
      d.volumeMounts.length !== 2 ||
      !d.volumeMounts.some((m) => m.mountPath === "/etc/mode.conf" && m.subPath === "MODE") ||
      !d.volumeMounts.some((m) => m.mountPath === "/etc/config" && !m.subPath)
    )
      return false;
    if (
      d.env.length !== 1 ||
      d.env[0]?.source !== "configmap" ||
      d.env[0]?.resource !== "reload-settings" ||
      d.env[0]?.key !== "MODE" ||
      d.env[0]?.name !== "MODE" ||
      JSON.stringify(file.env) !== JSON.stringify(d.env)
    )
      return false;
  } else {
    if (
      d.volumes.length !== 2 ||
      d.volumeMounts.length !== 2 ||
      !d.volumes.some((v) => v.source === "configmap" && v.resource === "volume-settings") ||
      !d.volumes.some((v) => v.source === "secret" && v.resource === "volume-credentials")
    )
      return false;
    if (
      source("volume-settings", "configmap")?.binaryData.find((e) => e.key === "asset.bin")
        ?.value !== "AP+AAQ=="
    )
      return false;
  }
  return KubePod.fromDeployment(d).every((pod) => {
    if (!pod.ready || KubeRuntime.error(world, d, pod.name)) return false;
    const files = d.podFiles.find((p) => p.podName === pod.name)?.files ?? [];
    const text = (path: string, value: string) => {
      const f = files.find((f) => f.path === path);
      return f && Result.unwrapOr(KubeVolumes.content(f), "") === value;
    };
    if (refresh)
      return (
        text("/etc/config/MODE", "production") &&
        text("/etc/mode.conf", "production") &&
        d.podEnvironments
          .find((e) => e.podName === pod.name)
          ?.values.some((e) => e.name === "MODE" && e.value === "production") === true
      );
    return (
      text("/etc/app/app.conf", "production") &&
      text("/etc/credentials/TOKEN", "demo-volume-token") &&
      files.some((f) => f.path === "/etc/app/assets/asset.bin" && f.value === "AP+AAQ==")
    );
  });
};
