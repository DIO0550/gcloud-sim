import { KubeRuntime } from "@/engine/domains/kube-config";
import { KubeManifest } from "@/engine/domains/kube-manifest";
import { KubePod } from "@/engine/domains/kubernetes";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { Result } from "@/utils/Result";

export type KubeImmutableAssertion = Readonly<{ kind: "kubeImmutableRefreshed" }>;
export const KubeImmutableMissions: readonly Mission[] = [
  {
    id: "m-gke-018",
    domain: "運用の維持",
    title: "変更できない設定を作り直してPodへ反映する",
    setup: [
      { kind: "setPrincipal", principal: F.owner },
      { kind: "setProject", projectId: F.devProjectId },
    ],
    description:
      "immutable-gkeに変更不可のConfigMap・Secretと、両方を参照するfrozen-webを配置します。設定ファイルのMODEをproduction、TOKENをdemo-token-v2へ編集し、immutable: trueを保ったまま設定を削除・再作成してください。nginx:1・2レプリカのPodをrollout restartで作り直し、両方の新しい値を反映します。再作成だけでは起動済みPodの環境変数は変わりません。Secretは架空の教材値です。",
    hints: [
      "gcloud services enable container.googleapis.com → gcloud container clusters create-auto immutable-gke --region=us-central1 → sim files load kubernetes-immutable",
      "kubectl apply -f frozen-settings.yaml → kubectl apply -f frozen-credentials.yaml → kubectl apply -f frozen-web.yaml。kubectl get cm frozen-settings -o yamlとkubectl describe secret frozen-credentialsでimmutable: trueを確認します。",
      "sim files replace frozen-settings.yaml --search=staging --replacement=production → sim files replace frozen-credentials.yaml --search=demo-token-v1 --replacement=demo-token-v2。kubectl apply -f frozen-settings.yamlとkubectl apply -f frozen-credentials.yamlはdata is immutableで失敗します。値を変えるには削除・再作成が必要です。",
      "kubectl delete -f frozen-settings.yaml → kubectl apply -f frozen-settings.yaml → kubectl delete -f frozen-credentials.yaml → kubectl apply -f frozen-credentials.yaml。immutableをfalseへ戻す更新も拒否します。ラベル変更は許可されます。",
      "kubectl exec deployment/frozen-web -- printenv MODE → kubectl exec deployment/frozen-web -- printenv TOKEN。設定は新しくても、起動済みPodの値はstagingとdemo-token-v1のままです。",
      "kubectl rollout restart deployment/frozen-web → kubectl rollout status deployment/frozen-web → kubectl exec deployment/frozen-web -- printenv MODE → kubectl exec deployment/frozen-web -- printenv TOKEN。2つのPodがproductionとdemo-token-v2で動き、ファイルとimmutable設定が一致すると達成します。",
    ],
    assertions: [{ kind: "kubeImmutableRefreshed" }],
  },
];

export const kubeImmutableSatisfied = (world: World): boolean => {
  const expected = [
    {
      kind: "configmap",
      name: "frozen-settings",
      file: "frozen-settings.yaml",
      key: "MODE",
      value: "production",
    },
    {
      kind: "secret",
      name: "frozen-credentials",
      file: "frozen-credentials.yaml",
      key: "TOKEN",
      value: "demo-token-v2",
    },
  ] as const;
  if (
    !expected.every((e) => {
      const c = world.kubeConfigs.find(
        (c) =>
          c.projectId === F.devProjectId &&
          c.cluster === "immutable-gke" &&
          c.namespace === "default" &&
          c.kind === e.kind &&
          c.name === e.name,
      );
      if (
        !c?.immutable ||
        c.data.length !== 1 ||
        c.data[0]?.key !== e.key ||
        c.data[0]?.value !== e.value
      )
        return false;

      const file = KubeManifest.parse(world.kubeFiles[e.file] ?? "");
      if (!Result.isOk(file) || file.value.length !== 1) return false;
      const manifest = file.value[0];
      return (
        manifest?.kind === e.kind &&
        manifest.name === e.name &&
        (manifest.namespace === undefined || manifest.namespace === "default") &&
        manifest.immutable === true &&
        manifest.data.length === 1 &&
        manifest.data[0]?.key === e.key &&
        manifest.data[0]?.value === e.value
      );
    })
  )
    return false;

  const d = world.kubeDeployments.find(
    (d) =>
      d.projectId === F.devProjectId &&
      d.cluster === "immutable-gke" &&
      d.namespace === "default" &&
      d.name === "frozen-web",
  );
  if (d?.image !== "nginx:1" || d.replicas !== 2 || d.revisions.at(-1)?.reason !== "restart")
    return false;
  if (
    !expected.every((e) =>
      d.env.some(
        (env) =>
          env.name === e.key &&
          env.source === e.kind &&
          env.resource === e.name &&
          env.key === e.key,
      ),
    )
  )
    return false;

  return KubePod.fromDeployment(d).every((p) => {
    const env = KubeRuntime.environment(world.kubeConfigs, d, p.name);
    return (
      p.ready &&
      Result.isOk(env) &&
      expected.every((e) =>
        env.value.values.some((value) => value.name === e.key && value.value === e.value),
      )
    );
  });
};
