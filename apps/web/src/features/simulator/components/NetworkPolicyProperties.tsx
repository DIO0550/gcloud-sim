import type { ReactElement } from "react";
import {
  KubeNetworkPolicy,
  type KubePolicyRule,
  type PolicyDirection,
} from "@/engine/domains/kube-network-policy";
import { World } from "@/engine/domains/world";
import {
  NotFound,
  Section,
  type SelectionProps,
} from "@/features/simulator/components/PropertyParts";
import { Option } from "@/utils/Option";

const Rules = ({
  direction,
  rules,
  active,
}: Readonly<{
  direction: PolicyDirection;
  rules: readonly KubePolicyRule[];
  active: boolean;
}>): ReactElement => {
  const title = direction === "Ingress" ? "Ingress（受信）" : "Egress（送信）";
  if (!active)
    return <p className="mb-3 text-sm text-muted">{title}はこのポリシーの対象外です。</p>;
  if (!rules.length)
    return (
      <p className="mb-3 text-sm text-muted">
        {title}: 許可ルールなし。他のポリシーによる許可がなければ遮断します。
      </p>
    );
  const occurrences = new Map<string, number>();
  const identified = rules.map((rule) => {
    const content = JSON.stringify(rule);
    const occurrence = (occurrences.get(content) ?? 0) + 1;
    occurrences.set(content, occurrence);
    return { rule, key: `${direction}-${content}-${occurrence}` };
  });
  return (
    <>
      {identified.map(({ rule: r, key }, i) => (
        <Section
          key={key}
          title={`${title} 許可ルール ${i + 1}`}
          rows={[
            {
              label: direction === "Ingress" ? "許可元" : "許可先",
              value: r.peers.length
                ? r.peers.map(KubeNetworkPolicy.peerText).join(" または ")
                : "全namespaceの全Pod",
            },
            {
              label: "宛先ポート",
              value: r.ports.length
                ? r.ports.map((p) => `${p}/TCP`).join(", ")
                : "全TCPポート（教材の範囲）",
            },
          ]}
        />
      ))}
    </>
  );
};

export const NetworkPolicyProperties = ({
  world,
  selection,
}: SelectionProps<"kube-network-policy">): ReactElement => {
  const p = world.kubeNetworkPolicies.find(
    (p) =>
      p.projectId === selection.projectId &&
      p.cluster === selection.cluster &&
      p.namespace === (selection.namespace ?? "default") &&
      p.name === selection.name,
  );
  if (!p) return <NotFound what="NetworkPolicy" />;
  const cluster = World.findCluster(world, p.projectId, p.cluster);
  const enabled = Option.isSome(cluster) && cluster.value.networkPolicyEnabled;
  const pods = KubeNetworkPolicy.selectedPods(world, p);
  return (
    <>
      <Section
        title="通信の許可と分離"
        rows={[
          { label: "namespace", value: p.namespace },
          { label: "Pod selector", value: KubeNetworkPolicy.selectorText(p.podSelector) },
          { label: "適用方向", value: p.policyTypes.join(", ") },
          { label: "強制機能", value: enabled ? "有効" : "無効（保存したルールは強制されません）" },
          { label: "選択されたPod", value: `${pods.length} Pod` },
        ]}
      />
      <Rules direction="Ingress" rules={p.ingress} active={p.policyTypes.includes("Ingress")} />
      <Rules direction="Egress" rules={p.egress} active={p.policyTypes.includes("Egress")} />
      <Section
        title="対象Pod"
        rows={pods.map((p, i) => ({ label: `Pod ${i + 1}`, value: p.name }))}
      />
      <p className="mb-3 text-sm text-muted">
        許可はポリシー間で合算します。通信には送信側Egressと受信側Ingressの両方の許可が必要です。PodのReadyやServiceの接続先は変えません。
      </p>
      <p className="mb-3 text-sm text-muted">
        sim kubernetes
        connectでTCPの新規通信を判定します。実通信・プロセスの待受確認は行いません。namespace
        selectorとPod selectorを同じ許可元・許可先に書くとAND条件になります。
      </p>
    </>
  );
};
