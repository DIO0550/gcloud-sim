import { GkeControlPlane } from "@/engine/domains/gke-control-plane";
import { KubeContext } from "@/engine/domains/kube-context";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { Option } from "@/utils/Option";

export type GkePrivateAssertion = Readonly<{
  kind: "gkePrivateAccessSecured" | "gkeAuthorizedSourceRecovered";
}>;
const setup = [
  { kind: "setPrincipal", principal: F.owner },
  { kind: "setProject", projectId: F.devProjectId },
] as const;
export const GkePrivateMissions: readonly Mission[] = [
  {
    id: "m-gke-030",
    domain: "アクセスとセキュリティ",
    title: "private制御プレーンへの接続条件を確認する",
    setup,
    description:
      "private-gkeをus-central1のdefault VPC/subnet・master CIDR 172.16.0.0/28のprivateノードで作成し、公開endpointを無効にします。許可CIDRを10.128.0.5/32だけにして内部endpointにも強制し、内部IPの認証情報を取得してください。default VPCの10.128.0.5からprivate endpointへの明示評価がALLOWになれば完了します。実通信・ノード配置は再現しません。",
    hints: [
      "gcloud services enable container.googleapis.com → gcloud container clusters create private-gke --region=us-central1 --enable-private-nodes --enable-ip-alias --master-ipv4-cidr=172.16.0.0/28",
      "sim gke check-control-plane private-gke --region=us-central1 --endpoint=public --source-ip=203.0.113.20。privateノードだけでは公開endpointは無効になりません。",
      "gcloud container clusters update private-gke --region=us-central1 --enable-private-endpoint --enable-master-authorized-networks --master-authorized-networks=10.128.0.5/32 --enable-authorized-networks-on-private-endpoint",
      "gcloud container clusters get-credentials private-gke --region=us-central1 --internal-ip → kubectl config view。認証情報を取れたことと疎通条件は別です。",
      "sim gke check-control-plane private-gke --region=us-central1 --endpoint=private --source-ip=10.128.0.5 --source-network=default。10.128.0.6やpublic endpointではDENYになります。最後に指定送信元を評価してください。",
    ],
    assertions: [{ kind: "gkePrivateAccessSecured" }],
  },
  {
    id: "m-gke-031",
    domain: "アクセスとセキュリティ",
    title: "公開endpointの許可CIDRを直して接続を確認する",
    setup,
    description:
      "authorized-gkeをus-central1のprivateノード・master CIDR 172.16.1.0/28で作成し、公開endpointは有効にします。誤った許可範囲203.0.113.0/28を203.0.113.16/28だけへ直し、203.0.113.20からpublic endpointへの明示評価でALLOWを確認してください。CIDR編集だけ、0.0.0.0/0への開放、内部endpointの評価では完了しません。",
    hints: [
      "gcloud services enable container.googleapis.com → gcloud container clusters create authorized-gke --region=us-central1 --enable-private-nodes --enable-ip-alias --master-ipv4-cidr=172.16.1.0/28 --enable-master-authorized-networks --master-authorized-networks=203.0.113.0/28",
      "sim gke check-control-plane authorized-gke --region=us-central1 --endpoint=public --source-ip=203.0.113.20。source-not-authorizedのDENYを確認します。",
      "gcloud container clusters update authorized-gke --region=us-central1 --enable-master-authorized-networks --master-authorized-networks=203.0.113.16/28",
      "gcloud container clusters describe authorized-gke --region=us-central1 → gcloud container clusters get-credentials authorized-gke --region=us-central1。公開endpointのCIDRだけを直します。",
      "sim gke check-control-plane authorized-gke --region=us-central1 --endpoint=public --source-ip=203.0.113.20。ALLOW/authorized-cidrを確認してください。",
    ],
    assertions: [{ kind: "gkeAuthorizedSourceRecovered" }],
  },
];

export const gkePrivateSatisfied = (world: World, secure: boolean): boolean => {
  const cluster = world.clusters.find(
    (c) => c.projectId === F.devProjectId && c.name === (secure ? "private-gke" : "authorized-gke"),
  );
  if (!cluster || cluster.autopilot || cluster.location !== "us-central1") return false;
  const config = cluster.controlPlane;
  if (
    !Option.isSome(config.privateNetwork) ||
    !Option.isSome(config.authorizedNetworks) ||
    !Option.isSome(config.lastCheck)
  )
    return false;
  const network = config.privateNetwork.value;
  const ranges = config.authorizedNetworks.value;
  const check = config.lastCheck.value;
  if (
    network.network !== "default" ||
    network.subnetwork !== "default" ||
    network.masterIpv4Cidr !== (secure ? "172.16.0.0/28" : "172.16.1.0/28") ||
    ranges.length !== 1 ||
    ranges[0] !== (secure ? "10.128.0.5/32" : "203.0.113.16/28") ||
    !check.allowed ||
    !GkeControlPlane.evaluate(world, cluster, check).allowed ||
    check.reason !== "authorized-cidr"
  )
    return false;
  if (secure)
    return (
      config.privateEndpoint &&
      config.enforcePrivateEndpoint &&
      KubeContext.endpoint(world, cluster) === "private" &&
      world.kubeContextEndpoints[KubeContext.name(cluster)] === "private" &&
      check.endpoint === "private" &&
      check.sourceNetwork === "default" &&
      check.sourceIp === "10.128.0.5"
    );
  return (
    !config.privateEndpoint &&
    !config.enforcePrivateEndpoint &&
    check.endpoint === "public" &&
    check.sourceNetwork === "" &&
    check.sourceIp === "203.0.113.20"
  );
};
