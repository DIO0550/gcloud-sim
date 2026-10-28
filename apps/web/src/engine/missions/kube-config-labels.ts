import { KubeRuntime } from "@/engine/domains/kube-config";
import { KubeContext } from "@/engine/domains/kube-context";
import { KubeLabels } from "@/engine/domains/kube-labels";
import { KubePod } from "@/engine/domains/kubernetes";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { MissionStep } from "@/engine/missions/mission-step";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

export type KubeConfigLabelsAssertion = Readonly<{ kind: "kubeConfigLabelsClassified" }>;
export const KubeConfigLabelsMissions: readonly Mission[] = [
  {
    id: "m-gke-017",
    domain: "運用の維持",
    title: "ラベルでConfigMap・Secretを分類する",
    setup: [
      { kind: "setPrincipal", principal: F.owner },
      { kind: "setProject", projectId: F.devProjectId },
    ],
    description:
      "labels-gkeへ設定サンプルをapplyし、settings-devをenvironment=staging、settings-prodとcredentialsをenvironment=productionに分類します。3つともapp=webを付け、settings-prodのtemporaryラベルを削除してください。設定データと、参照で動くwebのnginx:1・1レプリカ・revision 1を保ちます。ラベルは設定の分類に使い、Podへ渡す値は変更しません。",
    steps: [
      MissionStep.run(
        "Kubernetes Engine APIを有効にする",
        "gcloud services enable container.googleapis.com",
      ),
      MissionStep.run(
        "Autopilotクラスタを作る",
        "gcloud container clusters create-auto labels-gke --region=us-central1",
      ),
      MissionStep.run("教材のマニフェストを読み込む", "sim files load kubernetes-config-labels"),
      MissionStep.run(
        "ConfigMap・Secretとそれを参照するwebを配置する",
        "kubectl apply -f labeled-configs.yaml",
      ),
      MissionStep.run(
        "ConfigMapの今のラベルを確かめる",
        "kubectl get cm -o yaml",
        "settings-prodのenvironmentは誤ってstagingになっています。",
      ),
      MissionStep.run(
        "Secretの今のラベルを確かめる",
        "kubectl describe secret credentials",
        "Secretのdescribeでは値の代わりにバイト数を表示します。",
      ),
      MissionStep.run(
        "settings-devを検証環境として分類する",
        "kubectl label cm settings-dev app=web environment=staging",
      ),
      MissionStep.run(
        "settings-prodのenvironmentを本番へ書き換える",
        "kubectl label cm settings-prod app=web environment=production --overwrite",
        "既存ラベルの別の値への変更には--overwriteが必要です。",
      ),
      MissionStep.run(
        "settings-prodからtemporaryラベルを外す",
        "kubectl label cm/settings-prod temporary-",
        "ラベル削除はKEY-で指定します。",
      ),
      MissionStep.run(
        "credentialsを本番として分類する",
        "kubectl label secret/credentials app=web environment=production",
      ),
      MissionStep.run(
        "webの本番用ConfigMapだけを絞り込む",
        "kubectl get cm -l app=web,environment=production",
        "複数条件はANDです。",
      ),
      MissionStep.run("本番用のSecretを絞り込む", "kubectl get secrets -l environment=production"),
      MissionStep.run(
        "Podへ渡る設定値が変わっていないか確かめる",
        "kubectl exec deployment/web -- printenv MODE",
      ),
      MissionStep.run("webのrevisionが1のままか確かめる", "kubectl get deployment web -o json"),
    ],
    assertions: [{ kind: "kubeConfigLabelsClassified" }],
  },
];

export const kubeConfigLabelsSatisfied = (world: World): boolean => {
  const cluster = KubeContext.current(world, F.devProjectId);
  if (!Option.isSome(cluster) || cluster.value.name !== "labels-gke") return false;
  const configs = world.kubeConfigs.filter(
    (c) =>
      c.projectId === F.devProjectId && c.cluster === "labels-gke" && c.namespace === "default",
  );
  const expected = [
    {
      kind: "configmap",
      name: "settings-dev",
      environment: "staging",
      key: "MODE",
      value: "staging",
    },
    {
      kind: "configmap",
      name: "settings-prod",
      environment: "production",
      key: "MODE",
      value: "production",
    },
    {
      kind: "secret",
      name: "credentials",
      environment: "production",
      key: "TOKEN",
      value: "demo-token",
    },
  ];
  if (
    !expected.every((e) => {
      const c = configs.find((c) => c.kind === e.kind && c.name === e.name);
      return (
        !!c &&
        KubeLabels.matches({ app: "web", environment: e.environment }, c.labels) &&
        !Object.hasOwn(c.labels, "temporary") &&
        c.data.length === 1 &&
        c.data[0]?.key === e.key &&
        c.data[0]?.value === e.value
      );
    })
  )
    return false;

  const d = world.kubeDeployments.find(
    (d) =>
      d.projectId === F.devProjectId &&
      d.cluster === "labels-gke" &&
      d.namespace === "default" &&
      d.name === "web",
  );
  if (d?.image !== "nginx:1" || d.replicas !== 1 || d.revision !== 1) return false;
  if (
    !d.env.some(
      (e) =>
        e.name === "MODE" &&
        e.source === "configmap" &&
        e.resource === "settings-prod" &&
        e.key === "MODE",
    )
  )
    return false;
  if (
    !d.env.some(
      (e) =>
        e.name === "TOKEN" &&
        e.source === "secret" &&
        e.resource === "credentials" &&
        e.key === "TOKEN",
    )
  )
    return false;
  return KubePod.fromDeployment(d).every((p) => {
    const env = KubeRuntime.environment(configs, d, p.name);
    return (
      p.ready &&
      Result.isOk(env) &&
      env.value.values.some((e) => e.name === "MODE" && e.value === "production") &&
      env.value.values.some((e) => e.name === "TOKEN" && e.value === "demo-token")
    );
  });
};
