import type { ReactElement } from "react";
import { ImagePull } from "@/engine/domains/image-pull";
import { KubeRuntime } from "@/engine/domains/kube-config";
import { KubeBinary } from "@/engine/domains/kube-config/binary";
import { KubeStatefulSet } from "@/engine/domains/kube-statefulset";
import { KubeStorage } from "@/engine/domains/kube-storage";
import { KubePod } from "@/engine/domains/kubernetes";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { NotFound, Section, type SelectionProps } from "./PropertyParts";

export const StatefulSetProperties = ({
  world,
  selection,
}: SelectionProps<"kube-statefulset">): ReactElement => {
  const s = world.kubeStatefulSets.find(
    (s) =>
      s.projectId === selection.projectId &&
      s.cluster === selection.cluster &&
      s.namespace === (selection.namespace ?? "default") &&
      s.name === selection.name,
  );

  if (!s) return <NotFound what="StatefulSet" />;

  const cluster = World.findCluster(world, s.projectId, s.cluster);
  const imageError = Option.isSome(cluster)
    ? ImagePull.error(world, cluster.value, s.image)
    : "Cluster missing";
  const pods = KubePod.fromDeployment(s);
  const ready = pods.filter((p) => !imageError && !KubeRuntime.error(world, s, p.name)).length;
  return (
    <>
      <Section
        title="固定のPod名と永続データ"
        rows={[
          { label: "namespace", value: s.namespace },
          { label: "image", value: s.image },
          { label: "Ready / replicas", value: `${ready} / ${s.replicas}` },
          { label: "Service", value: s.statefulSet.serviceName },
          { label: "Serviceの状態", value: KubeStatefulSet.networkReason(world, s) },
          { label: "Pod管理", value: "Parallel（即時作成）" },
          { label: "PVC保持", value: "スケールダウン・StatefulSet削除後もRetain" },
          {
            label: "前回のスケール",
            value: s.statefulSet.lastScale
              ? `${s.statefulSet.lastScale.from} → ${s.statefulSet.lastScale.to}`
              : "未実施",
          },
          {
            label: "再利用したPVC",
            value:
              s.statefulSet.lastScale?.reusedClaims
                .map((c) => `${c.name} (${c.volumeName})`)
                .join(", ") || "なし",
          },
        ]}
      />
      {s.statefulSet.volumeClaimTemplates.map((t) => (
        <Section
          key={t.name}
          title={`PVCテンプレート: ${t.name}`}
          rows={[
            { label: "StorageClass", value: t.storageClassName || "未指定" },
            { label: "要求容量", value: `${t.storageGi}Gi` },
            { label: "PVC名", value: `${t.name}-${s.name}-連番` },
          ]}
        />
      ))}
      {pods.map((p, i) => (
        <Section
          key={p.name}
          title={`Pod: ${p.name}`}
          rows={[
            { label: "状態", value: imageError || KubeRuntime.error(world, s, p.name) || "Ready" },
            { label: "教材上のPod世代", value: String(s.podIncarnations[i] ?? 0) },
            ...s.statefulSet.volumeClaimTemplates.flatMap((t) => {
              const claimName = KubeStatefulSet.claimName(t.name, s.name, i);
              const pv = KubeStorage.volume(world, s, claimName);
              return [
                { label: "PVC", value: claimName },
                { label: "PV", value: pv?.name ?? "Pending" },
                {
                  label: "保存ファイル",
                  value:
                    pv?.files
                      .map((f) => `${f.path} (${KubeBinary.size(f.value)} bytes)`)
                      .join(", ") || "なし",
                },
              ];
            }),
          ]}
        />
      ))}
      <p className="mb-3 text-sm text-muted">
        Podを削除しても同じ連番とPVCで再作成します。連番ごとのデータは独立しています。
      </p>
      <p className="mb-3 text-sm text-muted">
        テンプレート更新は全Podを即時置換する教材モデルです。作成・更新の順序待ち、実DNS・ディスク・アプリのレプリケーションは再現しません。
      </p>
    </>
  );
};
