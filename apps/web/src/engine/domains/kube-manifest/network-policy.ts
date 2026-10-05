import { KubeLabels } from "@/engine/domains/kube-labels";
import { KubeNamespace } from "@/engine/domains/kube-namespace";
import type {
  KubeNetworkPolicy,
  KubePolicyPeer,
  KubePolicyRule,
  PolicyDirection,
} from "@/engine/domains/kube-network-policy";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";
import { fail, fields, namespace, record } from "./validation";

export type NetworkPolicyManifest = Readonly<{
  kind: "networkpolicy";
  name: string;
  namespace: string | undefined;
}> &
  Pick<KubeNetworkPolicy, "labels" | "podSelector" | "policyTypes" | "ingress" | "egress">;

const labels = (value: unknown): KubeLabels => {
  const parsed = KubeLabels.parse(value === undefined ? {} : value);
  if (!Result.isOk(parsed)) return fail(parsed.error);
  return parsed.value;
};
const selector = (value: unknown): KubeLabels => {
  const s = record(value, "selector");
  fields(s, ["matchLabels"], "selector");
  return labels(s.matchLabels);
};
const array = (value: unknown, field: string): readonly unknown[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 32)
    return fail(`${field} must be an array of at most 32 entries.`);
  return value;
};
const peer = (value: unknown): KubePolicyPeer => {
  const p = record(value, "NetworkPolicy peer");
  fields(p, ["podSelector", "namespaceSelector"], "NetworkPolicy peer (ipBlock is not simulated)");
  const ns =
    p.namespaceSelector === undefined ? Option.none : Option.some(selector(p.namespaceSelector));
  if (Option.isSome(ns) && Object.keys(ns.value).some((k) => k !== "kubernetes.io/metadata.name"))
    return fail(
      "namespaceSelector supports only kubernetes.io/metadata.name equality or an empty selector.",
    );
  return {
    podSelector: p.podSelector === undefined ? Option.none : Option.some(selector(p.podSelector)),
    namespaceSelector: ns,
  };
};
const rules = (value: unknown, direction: PolicyDirection): readonly KubePolicyRule[] =>
  array(value, direction).map((value) => {
    const r = record(value, "NetworkPolicy rule");
    const peers = direction === "Ingress" ? "from" : "to";
    fields(r, [peers, "ports"], "NetworkPolicy rule");
    const ports = array(r.ports, "ports").map((value) => {
      const p = record(value, "NetworkPolicy port");
      fields(p, ["protocol", "port"], "NetworkPolicy port");
      if (p.protocol !== undefined && p.protocol !== "TCP") return fail("Only TCP is simulated.");
      if (typeof p.port !== "number" || !Number.isInteger(p.port) || p.port < 1 || p.port > 65535)
        return fail(
          "Specify a numeric TCP port from 1 to 65535; named/all-protocol ports and endPort are not simulated.",
        );
      return p.port;
    });
    if (new Set(ports).size !== ports.length) return fail("Duplicate TCP port.");
    return { peers: array(r[peers], peers).map(peer), ports };
  });

export const parseNetworkPolicy = (r: Record<string, unknown>): NetworkPolicyManifest => {
  fields(r, ["apiVersion", "kind", "metadata", "spec"], "NetworkPolicy manifest");
  if (r.apiVersion !== "networking.k8s.io/v1")
    return fail("NetworkPolicy requires networking.k8s.io/v1.");
  const m = record(r.metadata, "metadata");
  fields(m, ["name", "namespace", "labels"], "NetworkPolicy metadata");
  if (!KubeNamespace.valid(m.name)) return fail("Invalid NetworkPolicy name.");
  const s = record(r.spec, "NetworkPolicy spec");
  fields(s, ["podSelector", "policyTypes", "ingress", "egress"], "NetworkPolicy spec");
  const ingress = rules(s.ingress, "Ingress");
  const egress = rules(s.egress, "Egress");
  const types =
    s.policyTypes === undefined
      ? ["Ingress", ...(egress.length ? ["Egress"] : [])]
      : array(s.policyTypes, "policyTypes");
  if (
    !types.length ||
    types.length > 2 ||
    new Set(types).size !== types.length ||
    types.some((t) => t !== "Ingress" && t !== "Egress")
  )
    return fail("policyTypes must contain Ingress, Egress or both without duplicates.");
  const policyTypes = types as readonly PolicyDirection[];
  if (
    (!policyTypes.includes("Ingress") && ingress.length) ||
    (!policyTypes.includes("Egress") && egress.length)
  )
    return fail("Rules must agree with policyTypes.");
  return {
    kind: "networkpolicy",
    name: m.name,
    namespace: namespace(m.namespace),
    labels: labels(m.labels),
    podSelector: s.podSelector === undefined ? {} : selector(s.podSelector),
    policyTypes,
    ingress,
    egress,
  };
};
