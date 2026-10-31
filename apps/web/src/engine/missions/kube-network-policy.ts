import { ImagePull } from "@/engine/domains/image-pull";
import { KubeRuntime } from "@/engine/domains/kube-config";
import { KubeManifest } from "@/engine/domains/kube-manifest";
import { KubeNetworkPolicy } from "@/engine/domains/kube-network-policy";
import { KubePod } from "@/engine/domains/kubernetes";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { MissionStep } from "@/engine/missions/mission-step";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

export type KubeNetworkAssertion = Readonly<{
  kind: "kubeNetworkRestricted" | "kubeNamespaceNetworkRestricted";
}>;
const setup = [
  { kind: "setPrincipal", principal: F.owner },
  { kind: "setProject", projectId: F.devProjectId },
] as const;
export const KubeNetworkMissions: readonly Mission[] = [
  {
    id: "m-gke-024",
    domain: "アクセスとセキュリティ",
    title: "NetworkPolicyで必要なPod通信だけを許可する",
    setup,
    description:
      "policy-gkeでclient・backend・intruderを起動します。backendへのIngressとclientからのEgressを既定で遮断したまま、許可ファイルのラベルを修正してapplyし、client→backendのTCP 8080だけを許可してください。intruder→backend、client→intruder、8081は遮断を保ちます。実通信は教材用connectで模擬判定します。",
    steps: [
      MissionStep.run("GKEのAPIを有効にする", "gcloud services enable container.googleapis.com"),
      MissionStep.run(
        "Autopilotクラスタpolicy-gkeを作る",
        "gcloud container clusters create-auto policy-gke --region=us-central1",
      ),
      MissionStep.run(
        "NetworkPolicy教材のマニフェストを用意する",
        "sim files load kubernetes-network-policy",
      ),
      MissionStep.run(
        "client・backend・intruderを起動する",
        "kubectl apply -f network-workloads.yaml",
      ),
      MissionStep.run("backendへの受信を既定で遮断する", "kubectl apply -f deny-ingress.json"),
      MissionStep.run("clientからの送信を既定で遮断する", "kubectl apply -f deny-egress.json"),
      MissionStep.run(
        "client→backendが遮断されることを確かめる",
        "sim kubernetes connect client --to=backend --port=8080",
        "両方向の既定遮断を確認します。",
      ),
      MissionStep.run(
        "受信許可ポリシーの送信元ラベルを直す",
        "sim files replace allow-ingress.json --search=wrong-client --replacement=client",
      ),
      MissionStep.run(
        "clientからの受信を許可する",
        "kubectl apply -f allow-ingress.json",
        "受信側だけを許可しても送信側Egressで遮断されます。",
      ),
      MissionStep.run(
        "送信許可ポリシーの宛先ラベルを直す",
        "sim files replace allow-egress.json --search=wrong-backend --replacement=backend",
      ),
      MissionStep.run("backendへの送信を許可する", "kubectl apply -f allow-egress.json"),
      MissionStep.run(
        "client→backendの8080が通ることを確かめる",
        "sim kubernetes connect client --to=backend --port=8080",
      ),
      MissionStep.run(
        "intruder→backendが遮断されたままか確かめる",
        "sim kubernetes connect intruder --to=backend --port=8080",
      ),
      MissionStep.run(
        "client→intruderが遮断されたままか確かめる",
        "sim kubernetes connect client --to=intruder --port=8080",
      ),
      MissionStep.run(
        "8081番ポートが遮断されたままか確かめる",
        "sim kubernetes connect client --to=backend --port=8081",
      ),
      MissionStep.run("適用したNetworkPolicyを一覧する", "kubectl get netpol"),
      MissionStep.run(
        "受信許可ポリシーの中身を確かめる",
        "kubectl describe netpol allow-client",
        "遮断ポリシーを消さず、許可を合算します。",
      ),
    ],
    assertions: [{ kind: "kubeNetworkRestricted" }],
  },
  {
    id: "m-gke-025",
    domain: "アクセスとセキュリティ",
    title: "namespaceとPodラベルで通信先を絞る",
    setup,
    description:
      "policy-ns-gkeでclient-nsのclientからdata-nsのbackendへTCP 8080だけを許可します。cross-ingress.jsonとcross-egress.jsonのPodラベルを修正し、namespaceSelectorとpodSelectorを同じpeerのAND条件に保ってapplyしてください。別namespaceの同じapp=client、同じdata-nsのintruder、8081への通信は遮断します。",
    steps: [
      MissionStep.run("GKEのAPIを有効にする", "gcloud services enable container.googleapis.com"),
      MissionStep.run(
        "Autopilotクラスタpolicy-ns-gkeを作る",
        "gcloud container clusters create-auto policy-ns-gke --region=us-central1",
      ),
      MissionStep.run(
        "NetworkPolicy教材のマニフェストを用意する",
        "sim files load kubernetes-network-policy",
      ),
      MissionStep.run(
        "client-ns・data-ns・other-nsを作る",
        "kubectl apply -f network-namespaces.yaml",
      ),
      MissionStep.run("各namespaceにPodを起動する", "kubectl apply -f cross-workloads.yaml"),
      MissionStep.run("受信と送信を既定で遮断する", "kubectl apply -f cross-deny.yaml"),
      MissionStep.run(
        "受信許可ポリシーの送信元ラベルを直す",
        "sim files replace cross-ingress.json --search=wrong-client --replacement=client",
      ),
      MissionStep.run(
        "client-nsのclientからの受信を許可する",
        "kubectl apply -f cross-ingress.json",
        "data-nsのbackendはclient-nsかつapp=clientのPodを受け入れます。",
      ),
      MissionStep.run(
        "送信許可ポリシーの宛先ラベルを直す",
        "sim files replace cross-egress.json --search=wrong-backend --replacement=backend",
      ),
      MissionStep.run(
        "data-nsのbackendへの送信を許可する",
        "kubectl apply -f cross-egress.json",
        "client-nsのclientはdata-nsかつapp=backendだけを宛先にします。",
      ),
      MissionStep.run(
        "client-ns→data-nsの8080が通ることを確かめる",
        "sim kubernetes connect client -n client-ns --to=backend --to-namespace=data-ns --port=8080",
      ),
      MissionStep.run(
        "別namespaceの同名clientが遮断されるか確かめる",
        "sim kubernetes connect client -n other-ns --to=backend --to-namespace=data-ns --port=8080",
      ),
      MissionStep.run(
        "data-nsのintruder宛てが遮断されるか確かめる",
        "sim kubernetes connect client -n client-ns --to=intruder --to-namespace=data-ns --port=8080",
      ),
      MissionStep.run(
        "8081番ポートが遮断されるか確かめる",
        "sim kubernetes connect client -n client-ns --to=backend --to-namespace=data-ns --port=8081",
      ),
      MissionStep.run(
        "全namespaceのNetworkPolicyを一覧する",
        "kubectl get netpol -A",
        "別々のpeerに分けるとOR条件に広がる点に注意します。",
      ),
    ],
    assertions: [{ kind: "kubeNamespaceNetworkRestricted" }],
  },
];

export const kubeNetworkSatisfied = (world: World, cross: boolean): boolean => {
  const cluster = world.clusters.find(
    (c) => c.projectId === F.devProjectId && c.name === (cross ? "policy-ns-gke" : "policy-gke"),
  );
  if (!cluster?.networkPolicyEnabled) return false;
  const sourceNs = cross ? "client-ns" : "default";
  const targetNs = cross ? "data-ns" : "default";
  const live = (name: string, namespace: string) => {
    const d = world.kubeDeployments.find(
      (d) =>
        d.projectId === cluster.projectId &&
        d.cluster === cluster.name &&
        d.namespace === namespace &&
        d.name === name,
    );
    if (d?.replicas !== 1 || d.image !== "nginx:1" || ImagePull.error(world, cluster, d.image))
      return undefined;
    const pod = KubePod.fromDeployment(d)[0];
    if (!pod?.ready || KubeRuntime.error(world, d, pod.name)) return undefined;
    return pod;
  };
  const source = live("client", sourceNs);
  const target = live("backend", targetNs);
  const intruder = live(cross ? "client" : "intruder", cross ? "other-ns" : "default");
  const wrongTarget = live("intruder", targetNs);
  if (!source || !target || !intruder || !wrongTarget) return false;
  const paths = cross
    ? ["cross-deny.yaml", "cross-ingress.json", "cross-egress.json"]
    : ["deny-ingress.json", "deny-egress.json", "allow-ingress.json", "allow-egress.json"];
  for (const path of paths) {
    const parsed = KubeManifest.parse(world.kubeFiles[path] ?? "");
    if (!Result.isOk(parsed) || parsed.value.length !== (path === "cross-deny.yaml" ? 2 : 1))
      return false;
    for (const m of parsed.value) {
      if (m.kind !== "networkpolicy") return false;
      const p = KubeNetworkPolicy.of(world, cluster, m.namespace ?? "default").find(
        (p) => p.name === m.name,
      );
      if (
        !p ||
        JSON.stringify([p.labels, p.podSelector, p.policyTypes, p.ingress, p.egress]) !==
          JSON.stringify([m.labels, m.podSelector, m.policyTypes, m.ingress, m.egress])
      )
        return false;
    }
  }
  const policies = KubeNetworkPolicy.of(world, cluster);
  if (cross) {
    for (const [name, namespace, direction, remoteNs, app] of [
      ["allow-client", targetNs, "ingress", sourceNs, "client"],
      ["allow-backend", sourceNs, "egress", targetNs, "backend"],
    ] as const) {
      const rules = policies.find((p) => p.name === name && p.namespace === namespace)?.[direction];
      const rule = rules?.[0];
      const peer = rule?.peers[0];
      if (!rule || rules?.length !== 1 || rule.peers.length !== 1 || !peer) return false;
      if (JSON.stringify(rule.ports) !== "[8080]") return false;
      if (!Option.isSome(peer.namespaceSelector) || !Option.isSome(peer.podSelector)) return false;
      if (
        JSON.stringify(peer.namespaceSelector.value) !==
          JSON.stringify({ "kubernetes.io/metadata.name": remoteNs }) ||
        JSON.stringify(peer.podSelector.value) !== JSON.stringify({ app })
      )
        return false;
    }
  }
  if (
    !policies.some(
      (p) =>
        p.name === "deny-backend" &&
        p.namespace === targetNs &&
        JSON.stringify(p.podSelector) === JSON.stringify({ app: "backend" }) &&
        p.policyTypes.includes("Ingress") &&
        !p.ingress.length,
    )
  )
    return false;
  if (
    !policies.some(
      (p) =>
        p.name === "deny-client" &&
        p.namespace === sourceNs &&
        JSON.stringify(p.podSelector) === JSON.stringify({ app: "client" }) &&
        p.policyTypes.includes("Egress") &&
        !p.egress.length,
    )
  )
    return false;
  const allowed = KubeNetworkPolicy.check(world, cluster, source, target, 8080);
  return (
    allowed.allowed &&
    allowed.egress.isolated &&
    allowed.ingress.isolated &&
    !KubeNetworkPolicy.check(world, cluster, intruder, target, 8080).allowed &&
    !KubeNetworkPolicy.check(world, cluster, source, wrongTarget, 8080).allowed &&
    !KubeNetworkPolicy.check(world, cluster, source, target, 8081).allowed
  );
};
