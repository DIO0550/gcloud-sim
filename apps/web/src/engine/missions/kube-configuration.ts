import { KubeRuntime } from "@/engine/domains/kube-config";
import { KubePod } from "@/engine/domains/kubernetes";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { MissionStep } from "@/engine/missions/mission-step";
import { Result } from "@/utils/Result";

export type KubeConfigurationAssertion = Readonly<{
  kind: "kubeConfigInjected" | "kubeConfigRefreshed" | "kubeConfigApplied";
}>;
const setup = [
  { kind: "setPrincipal", principal: F.owner },
  { kind: "setProject", projectId: F.devProjectId },
] as const;
const prepare = [
  MissionStep.run(
    "Kubernetes Engine APIを有効にする",
    "gcloud services enable container.googleapis.com",
  ),
  MissionStep.run(
    "Autopilotクラスタを作る",
    "gcloud container clusters create-auto config-gke --region=us-central1",
  ),
  MissionStep.run(
    "2レプリカのconfig-webを作る",
    "kubectl create deployment config-web --image=nginx:1 --replicas=2",
    "既存クラスタはget-credentialsで選びます。",
  ),
];
const fromConfig = MissionStep.run(
  "app-configのキーを環境変数として参照させる",
  "kubectl set env deployment/config-web --from=configmap/app-config",
);
const fromSecret = MissionStep.run(
  "app-secretのキーを環境変数として参照させる",
  "kubectl set env deployment/config-web --from=secret/app-secret",
);
const inject = [
  fromConfig,
  fromSecret,
  MissionStep.run(
    "LOG_LEVELを値で直接設定する",
    "kubectl set env deployment/config-web LOG_LEVEL=info",
  ),
];
export const KubeConfigurationMissions: readonly Mission[] = [
  {
    id: "m-gke-005",
    domain: "運用の維持",
    title: "設定ファイルをapplyしてPodへ反映する",
    setup,
    description:
      "ConfigMapとSecretのYAMLを読み込み、app-configのAPP_MODEをstagingからproductionへ編集してapplyします。config-webの2つのPodへ参照で渡し、再起動後にproductionとdemo-tokenを確認してください。ファイルの編集だけではクラスタ設定は変わりません。",
    steps: [
      ...prepare,
      MissionStep.run(
        "ConfigMap・SecretのYAMLを読み込む",
        "sim files load kubernetes-config",
        "既存の同名ファイルを置き換える場合は内容を確認して --force を使います。",
      ),
      MissionStep.run("ConfigMapのYAMLを開いて中身を確かめる", "sim files read app-config.yaml"),
      MissionStep.run("SecretのYAMLを開いて中身を確かめる", "sim files read app-secret.yaml"),
      MissionStep.run("ConfigMapをクラスタに作る", "kubectl apply -f app-config.yaml"),
      MissionStep.run("Secretをクラスタに作る", "kubectl apply -f app-secret.yaml"),
      fromConfig,
      fromSecret,
      MissionStep.run(
        "ファイルのAPP_MODEをstagingからproductionへ書き換える",
        "sim files replace app-config.yaml --search=staging --replacement=production",
      ),
      MissionStep.run(
        "書き換えたConfigMapをクラスタへ反映する",
        "kubectl apply -f app-config.yaml",
        "get configmapで設定を、exec deployment/config-web -- printenv APP_MODEで起動済みの値を比較します。",
      ),
      MissionStep.run(
        "Podを作り直して新しい値を読ませる",
        "kubectl rollout restart deployment/config-web",
        "applyを繰り返すとunchangedになります。",
      ),
      MissionStep.run("作り直しの完了を待つ", "kubectl rollout status deployment/config-web"),
      MissionStep.run(
        "APP_MODEがproductionになったか確かめる",
        "kubectl exec deployment/config-web -- printenv APP_MODE",
      ),
      MissionStep.run(
        "API_TOKENがSecretの値か確かめる",
        "kubectl exec deployment/config-web -- printenv API_TOKEN",
      ),
    ],
    assertions: [{ kind: "kubeConfigApplied" }],
  },
  {
    id: "m-gke-003",
    domain: "デプロイと実装",
    title: "ConfigMapとSecretから環境変数を渡す",
    setup,
    description:
      "config-gkeのconfig-web（2レプリカ）へ、app-configのAPP_MODE=productionとapp-secretのAPI_TOKEN=demo-tokenをキー参照で渡し、LOG_LEVEL=infoを設定してください。値を直接書くだけでは達成しません。Secretは学習用の架空の値を使います。",
    steps: [
      ...prepare,
      MissionStep.run(
        "APP_MODE=productionのConfigMapを作る",
        "kubectl create configmap app-config --from-literal=APP_MODE=production",
      ),
      MissionStep.run(
        "API_TOKEN=demo-tokenのSecretを作る",
        "kubectl create secret generic app-secret --from-literal=API_TOKEN=demo-token",
      ),
      ...inject,
      MissionStep.run("環境変数の参照元を一覧する", "kubectl set env deployment/config-web --list"),
      MissionStep.run(
        "Secretのキーを値を出さずに確かめる",
        "kubectl describe secret app-secret",
        "describeはSecretの値を表示せず、参照と起動時の値を区別できます。",
      ),
      MissionStep.run(
        "起動したPodのAPP_MODEを確かめる",
        "kubectl exec deployment/config-web -- printenv APP_MODE",
      ),
    ],
    assertions: [{ kind: "kubeConfigInjected" }],
  },
  {
    id: "m-gke-004",
    domain: "運用の維持",
    title: "ConfigMapの変更をPodの再起動で反映する",
    setup,
    description:
      "config-webへapp-configのAPP_MODEを参照で渡し、productionへ変更して再起動します。2レプリカともproductionで動き、現在の履歴がrestartなら達成です。作り直す前の値は既存Podに残るので、printenvで比較してください。",
    steps: [
      ...prepare,
      MissionStep.run(
        "APP_MODE=stagingのConfigMapを作る",
        "kubectl create configmap app-config --from-literal=APP_MODE=staging",
      ),
      fromConfig,
      MissionStep.run(
        "Podが読んだAPP_MODEを確かめる",
        "kubectl exec deployment/config-web -- printenv APP_MODE",
      ),
      MissionStep.run(
        "古いConfigMapを削除する",
        "kubectl delete configmap app-config",
        "今回は削除・再作成で設定を変更します。",
      ),
      MissionStep.run(
        "APP_MODE=productionでConfigMapを作り直す",
        "kubectl create configmap app-config --from-literal=APP_MODE=production",
      ),
      MissionStep.run(
        "ConfigMapがproductionになったか確かめる",
        "kubectl get configmap app-config -o yaml",
      ),
      MissionStep.run(
        "起動済みPodの値がまだ古いことを確かめる",
        "kubectl exec deployment/config-web -- printenv APP_MODE",
        "設定はproductionでも、起動済みPodはstagingのままです。",
      ),
      MissionStep.run(
        "Podを作り直して新しい値を読ませる",
        "kubectl rollout restart deployment/config-web",
      ),
      MissionStep.run("作り直しの完了を待つ", "kubectl rollout status deployment/config-web"),
      MissionStep.run(
        "APP_MODEがproductionになったか確かめる",
        "kubectl exec deployment/config-web -- printenv APP_MODE",
        "全Podを作り直すと新しい値が反映されます。",
      ),
    ],
    assertions: [{ kind: "kubeConfigRefreshed" }],
  },
];
export const kubeConfigurationSatisfied = (
  world: World,
  assertion: KubeConfigurationAssertion,
): boolean => {
  const d = world.kubeDeployments.find(
    (d) =>
      d.projectId === F.devProjectId &&
      d.cluster === "config-gke" &&
      d.namespace === "default" &&
      d.name === "config-web",
  );
  if (d?.replicas !== 2 || d.image !== "nginx:1") return false;
  const config = world.kubeConfigs.find(
    (c) =>
      c.projectId === d.projectId &&
      c.cluster === d.cluster &&
      c.namespace === "default" &&
      c.kind === "configmap" &&
      c.name === "app-config",
  );
  if (!config?.data.some((e) => e.key === "APP_MODE" && e.value === "production")) return false;
  if (
    !d.env.some(
      (e) =>
        e.name === "APP_MODE" &&
        e.source === "configmap" &&
        e.resource === "app-config" &&
        e.key === "APP_MODE",
    )
  )
    return false;
  const pods = KubePod.fromDeployment(d);
  if (
    !pods.every((p) => {
      const env = KubeRuntime.environment(world, d, p.name);
      return (
        Result.isOk(env) &&
        env.value.values.some((e) => e.name === "APP_MODE" && e.value === "production")
      );
    })
  )
    return false;
  if (assertion.kind === "kubeConfigRefreshed") return d.revisions.at(-1)?.reason === "restart";
  const secret = world.kubeConfigs.find(
    (c) =>
      c.projectId === d.projectId &&
      c.cluster === d.cluster &&
      c.namespace === "default" &&
      c.kind === "secret" &&
      c.name === "app-secret",
  );
  if (assertion.kind === "kubeConfigApplied")
    return (
      d.revisions.at(-1)?.reason === "restart" &&
      config.lastAppliedKeys.includes("APP_MODE") &&
      !!secret?.lastAppliedKeys.includes("API_TOKEN") &&
      secret.data.some((e) => e.key === "API_TOKEN" && e.value === "demo-token") &&
      d.env.some(
        (e) =>
          e.name === "API_TOKEN" &&
          e.source === "secret" &&
          e.resource === "app-secret" &&
          e.key === "API_TOKEN",
      ) &&
      pods.every((p) => {
        const env = KubeRuntime.environment(world, d, p.name);
        return (
          Result.isOk(env) &&
          env.value.values.some((e) => e.name === "API_TOKEN" && e.value === "demo-token")
        );
      })
    );
  return (
    !!secret?.data.some((e) => e.key === "API_TOKEN" && e.value === "demo-token") &&
    d.env.some(
      (e) =>
        e.name === "API_TOKEN" &&
        e.source === "secret" &&
        e.resource === "app-secret" &&
        e.key === "API_TOKEN",
    ) &&
    d.env.some((e) => e.name === "LOG_LEVEL" && e.source === "literal" && e.value === "info") &&
    pods.every((p) => {
      const env = KubeRuntime.environment(world, d, p.name);
      return (
        Result.isOk(env) &&
        env.value.values.some((e) => e.name === "API_TOKEN" && e.value === "demo-token")
      );
    })
  );
};
