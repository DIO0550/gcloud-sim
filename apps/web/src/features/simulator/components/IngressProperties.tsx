import type { ReactElement } from "react";
import { KubeIngress } from "@/engine/domains/kube-ingress";
import {
  NotFound,
  Section,
  type SelectionProps,
} from "@/features/simulator/components/PropertyParts";
import { Option } from "@/utils/Option";

export const IngressProperties = ({
  world,
  selection,
}: SelectionProps<"kube-ingress">): ReactElement => {
  const ingress = world.kubeIngresses.find(
    (i) =>
      i.projectId === selection.projectId &&
      i.cluster === selection.cluster &&
      i.namespace === (selection.namespace ?? "default") &&
      i.name === selection.name,
  );
  if (!ingress) return <NotFound what="Ingress" />;
  const diagnostics = KubeIngress.diagnostics(world, ingress);
  return (
    <>
      <Section
        title="HTTPの振り分け"
        rows={[
          { label: "namespace", value: ingress.namespace },
          { label: "controller", value: "gce（外部Ingressの教材）" },
          {
            label: "バックエンド",
            value: diagnostics.length ? "確認が必要" : "全ServiceにReadyな接続先あり",
          },
          { label: "ADDRESS", value: "未割り当て（実LBは作成しません）" },
          {
            label: "defaultBackend",
            value: Option.isSome(ingress.defaultBackend)
              ? `${ingress.defaultBackend.value.name}:${ingress.defaultBackend.value.port}`
              : "なし（未一致はNO_ROUTE）",
          },
        ]}
      />
      {ingress.paths.map((p) => (
        <Section
          key={`${p.host}/${p.pathType}/${p.path}`}
          title={`${p.host || "全ホスト"} ${p.path}`}
          rows={[
            { label: "pathType", value: p.pathType },
            { label: "Service port", value: `${p.backend.name}:${p.backend.port}` },
          ]}
        />
      ))}
      {diagnostics.length > 0 && (
        <Section
          title="接続先の診断"
          rows={diagnostics.map((value, i) => ({ label: `診断 ${i + 1}`, value }))}
        />
      )}
      <p className="mb-3 text-sm text-muted">
        ホストとパスが一致した中で最長パスを選び、同じ長さならExactを優先します。Prefixはパス要素単位です。未一致はdefaultBackendへ振り分けます。
      </p>
      <p className="mb-3 text-sm text-muted">
        sim kubernetes requestで判定できます。NodePort
        Serviceのportを参照し、targetPortへ送るReadyなPodを確認します。実LB・DNS・TLS・HTTPヘルスチェック・外部クライアントのNetworkPolicy判定は行いません。
      </p>
    </>
  );
};
