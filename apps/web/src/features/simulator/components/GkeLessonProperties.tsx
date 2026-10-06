import type { ReactElement } from "react";
import { KubeIdentity } from "@/engine/domains/gke-completion";
import { KubeMulti } from "@/engine/domains/kube-multi";
import { KubeResources } from "@/engine/domains/kube-resources";
import { KubePod } from "@/engine/domains/kubernetes";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { NotFound, Section, type SelectionProps } from "./PropertyParts";

export const GkeLessonProperties = ({
  world,
  selection,
}: SelectionProps<"kube-lesson">): ReactElement => {
  const c = World.findCluster(world, selection.projectId, selection.cluster);
  if (!Option.isSome(c)) {
    return <NotFound what="クラスタ" />;
  }
  const namespace = selection.namespace ?? "default";
  if (selection.resourceKind === "serviceaccount") {
    const account = KubeIdentity.accounts(world, c.value, namespace).find(
      (s) => s.name === selection.name,
    );
    if (!account) {
      return <NotFound what="ServiceAccount" />;
    }

    return (
      <Section
        title="Workload Identity"
        rows={[
          { label: "namespace", value: namespace },
          { label: "Kubernetes SA", value: account.name },
          { label: "IAM SA", value: account.gcpServiceAccount || "未連携" },
          {
            label: "workload pool",
            value: c.value.autopilot
              ? `${c.value.projectId}.svc.id.goog`
              : c.value.workloadPool || "無効",
          },
          {
            label: "連携メンバー",
            value: `serviceAccount:${c.value.projectId}.svc.id.goog[${namespace}/${account.name}]`,
          },
          {
            label: "確認手順",
            value: "annotation・workloadIdentityUser・対象リソースの権限を別々に確認",
          },
          {
            label: "認証方式",
            value: "鍵ファイルなし。sim kubernetes check-accessで教材上の許可を評価",
          },
        ]}
      />
    );
  }
  const v = world.kubeVpas.find(
    (v) =>
      v.projectId === selection.projectId &&
      v.cluster === selection.cluster &&
      v.namespace === namespace &&
      v.name === selection.name,
  );
  if (!v) {
    return <NotFound what="VPA" />;
  }
  const d = World.findKubeDeployment(world, c.value, v.target, namespace);
  const container = Option.isSome(d)
    ? KubeMulti.spec(d.value).find((s) => s.name === v.container)
    : undefined;
  const recommendation = Option.isSome(v.recommendation) ? v.recommendation.value : undefined;

  return (
    <Section
      title="VPAの推奨値"
      rows={[
        { label: "namespace", value: namespace },
        { label: "対象", value: `Deployment/${v.target} · ${v.container}` },
        { label: "更新モード", value: v.mode === "Off" ? "Off（推奨のみ）" : v.mode },
        {
          label: "テンプレートrequests",
          value: container ? KubeResources.text(container.resources.requests) : "対象なし",
        },
        ...(Option.isSome(d)
          ? KubePod.fromDeployment(d.value).map((p) => {
              const saved = d.value.podResources?.find(
                (s) => s.podName === p.name && s.containerName === v.container,
              );
              return {
                label: p.name,
                value:
                  saved?.admissionError ??
                  KubeResources.text(
                    saved?.resources.requests ?? container?.resources.requests ?? {},
                  ),
              };
            })
          : []),
        { label: "推奨CPU", value: recommendation ? `${recommendation.cpuMilli}m` : "未評価" },
        {
          label: "推奨メモリ",
          value: recommendation ? `${recommendation.memoryBytes} bytes` : "未評価",
        },
        { label: "評価方法", value: "明示したコンテナ使用量に20%の余裕を加える教材モデル" },
        {
          label: "反映方法",
          value:
            v.mode === "Off"
              ? "kubectl set resourcesで手動適用"
              : "Initialは新規Podのみ、Recreateは明示評価で再作成。レプリカ数は維持",
        },
      ]}
    />
  );
};
