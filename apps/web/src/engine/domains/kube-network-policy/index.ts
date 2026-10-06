import { KubeLabels } from "@/engine/domains/kube-labels";
import { KubeNamespace } from "@/engine/domains/kube-namespace";
import { KubePod } from "@/engine/domains/kubernetes";
import type { GkeCluster } from "@/engine/domains/managed-services";
import type { World } from "@/engine/domains/world";
import type { JsonRecord } from "@/types/Json";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

export type PolicyDirection = "Ingress" | "Egress";
export type KubePolicyPeer = Readonly<{
  podSelector: Option<KubeLabels>;
  namespaceSelector: Option<KubeLabels>;
}>;
export type KubePolicyRule = Readonly<{
  peers: readonly KubePolicyPeer[];
  ports: readonly number[];
}>;
export type KubeNetworkPolicy = Readonly<{
  projectId: string;
  cluster: string;
  namespace: string;
  name: string;
  labels: KubeLabels;
  podSelector: KubeLabels;
  policyTypes: readonly PolicyDirection[];
  ingress: readonly KubePolicyRule[];
  egress: readonly KubePolicyRule[];
  createdAt: string;
}>;
export type PolicyDecision = Readonly<{
  allowed: boolean;
  isolated: boolean;
  selecting: readonly string[];
  allowing: readonly string[];
}>;

// NetworkPolicy empty selectors match all; Deployment/Service selectors require labels.
const matches = (selector: KubeLabels, labels: KubeLabels): boolean =>
  Object.keys(selector).length === 0 || KubeLabels.matches(selector, labels);

const validLabels = (labels: KubeLabels): boolean => Result.isOk(KubeLabels.parse(labels));
const validSelector = (selector: Option<KubeLabels>, namespace = false): boolean => {
  if (!Option.isSome(selector)) return selector.some === false;
  if (!validLabels(selector.value)) return false;
  return (
    !namespace || Object.keys(selector.value).every((k) => k === "kubernetes.io/metadata.name")
  );
};
const validRules = (rules: readonly KubePolicyRule[]): boolean =>
  rules.length <= 32 &&
  rules.every(
    (r) =>
      r.peers.length <= 32 &&
      r.ports.length <= 32 &&
      new Set(r.ports).size === r.ports.length &&
      r.ports.every((n) => Number.isInteger(n) && n >= 1 && n <= 65535) &&
      r.peers.every(
        (p) => validSelector(p.podSelector) && validSelector(p.namespaceSelector, true),
      ),
  );
const peerMatches = (peer: KubePolicyPeer, namespace: string, remote: KubePod): boolean => {
  if (Option.isSome(peer.namespaceSelector)) {
    if (
      !matches(peer.namespaceSelector.value, {
        "kubernetes.io/metadata.name": remote.namespace,
      })
    )
      return false;
  }
  if (
    !Option.isSome(peer.namespaceSelector) &&
    Option.isSome(peer.podSelector) &&
    namespace !== remote.namespace
  )
    return false;
  return !Option.isSome(peer.podSelector) || matches(peer.podSelector.value, remote.labels);
};
const ruleMatches = (
  rule: KubePolicyRule,
  namespace: string,
  remote: KubePod,
  port: number,
): boolean =>
  (!rule.ports.length || rule.ports.includes(port)) &&
  (!rule.peers.length || rule.peers.some((p) => peerMatches(p, namespace, remote)));
const selectorRecord = (peer: KubePolicyPeer): JsonRecord => ({
  ...(Option.isSome(peer.podSelector)
    ? { podSelector: { matchLabels: peer.podSelector.value } }
    : {}),
  ...(Option.isSome(peer.namespaceSelector)
    ? { namespaceSelector: { matchLabels: peer.namespaceSelector.value } }
    : {}),
});
const ruleRecord = (rule: KubePolicyRule, direction: PolicyDirection): JsonRecord => ({
  ...(rule.peers.length
    ? { [direction === "Ingress" ? "from" : "to"]: rule.peers.map(selectorRecord) }
    : {}),
  ...(rule.ports.length ? { ports: rule.ports.map((port) => ({ protocol: "TCP", port })) } : {}),
});

/** Equality selectors and TCP Pod-to-Pod decisions. No sockets, timers or CNI operations. */
export const KubeNetworkPolicy = {
  valid(p: KubeNetworkPolicy): boolean {
    return (
      KubeNamespace.valid(p.name) &&
      KubeNamespace.valid(p.namespace) &&
      validLabels(p.labels) &&
      validLabels(p.podSelector) &&
      Number.isFinite(Date.parse(p.createdAt)) &&
      p.policyTypes.length >= 1 &&
      p.policyTypes.length <= 2 &&
      new Set(p.policyTypes).size === p.policyTypes.length &&
      p.policyTypes.every((t) => t === "Ingress" || t === "Egress") &&
      (p.policyTypes.includes("Ingress") || !p.ingress.length) &&
      (p.policyTypes.includes("Egress") || !p.egress.length) &&
      validRules(p.ingress) &&
      validRules(p.egress)
    );
  },

  of(world: World, cluster: GkeCluster, namespace?: string): readonly KubeNetworkPolicy[] {
    return world.kubeNetworkPolicies
      .filter(
        (p) =>
          p.projectId === cluster.projectId &&
          p.cluster === cluster.name &&
          (namespace === undefined || p.namespace === namespace),
      )
      .toSorted((a, b) => a.name.localeCompare(b.name));
  },

  selectedPods(world: World, p: KubeNetworkPolicy): readonly KubePod[] {
    return [...world.kubeDeployments, ...world.kubeStatefulSets]
      .filter(
        (d) =>
          d.projectId === p.projectId && d.cluster === p.cluster && d.namespace === p.namespace,
      )
      .flatMap(KubePod.fromDeployment)
      .filter((pod) => matches(p.podSelector, pod.labels));
  },

  direction(
    world: World,
    cluster: GkeCluster,
    local: KubePod,
    remote: KubePod,
    port: number,
    direction: PolicyDirection,
  ): PolicyDecision {
    const selecting = KubeNetworkPolicy.of(world, cluster, local.namespace).filter(
      (p) => p.policyTypes.includes(direction) && matches(p.podSelector, local.labels),
    );
    const allowing = selecting.filter((p) =>
      (direction === "Ingress" ? p.ingress : p.egress).some((r) =>
        ruleMatches(r, p.namespace, remote, port),
      ),
    );
    return {
      allowed: !selecting.length || allowing.length > 0,
      isolated: selecting.length > 0,
      selecting: selecting.map((p) => p.name),
      allowing: allowing.map((p) => p.name),
    };
  },

  check(world: World, cluster: GkeCluster, source: KubePod, target: KubePod, port: number) {
    const egress = KubeNetworkPolicy.direction(world, cluster, source, target, port, "Egress");
    const ingress = KubeNetworkPolicy.direction(world, cluster, target, source, port, "Ingress");
    const self = source.namespace === target.namespace && source.name === target.name;
    return {
      enforced: cluster.networkPolicyEnabled,
      self,
      egress,
      ingress,
      allowed: !cluster.networkPolicyEnabled || self || (egress.allowed && ingress.allowed),
    };
  },

  selectorText(labels: KubeLabels): string {
    return (
      Object.entries(labels)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ") || "<all Pods>"
    );
  },

  peerText(peer: KubePolicyPeer): string {
    if (!Option.isSome(peer.podSelector) && !Option.isSome(peer.namespaceSelector))
      return "全namespaceの全Pod";
    const ns = Option.isSome(peer.namespaceSelector)
      ? KubeNetworkPolicy.selectorText(peer.namespaceSelector.value).replace(
          "<all Pods>",
          "全namespace",
        )
      : "同じnamespace";
    return `${ns} / ${Option.isSome(peer.podSelector) ? KubeNetworkPolicy.selectorText(peer.podSelector.value) : "全Pod"}`;
  },

  toRecord(p: KubeNetworkPolicy): JsonRecord {
    return {
      apiVersion: "networking.k8s.io/v1",
      kind: "NetworkPolicy",
      metadata: {
        name: p.name,
        namespace: p.namespace,
        labels: p.labels,
        creationTimestamp: p.createdAt,
      },
      spec: {
        podSelector: { matchLabels: p.podSelector },
        policyTypes: p.policyTypes,
        ...(p.policyTypes.includes("Ingress")
          ? { ingress: p.ingress.map((r) => ruleRecord(r, "Ingress")) }
          : {}),
        ...(p.policyTypes.includes("Egress")
          ? { egress: p.egress.map((r) => ruleRecord(r, "Egress")) }
          : {}),
      },
    };
  },
} as const;
