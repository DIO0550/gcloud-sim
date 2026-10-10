import { evaluateConnection } from "@/engine/domains/network-lab/model";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";

const p = F.devProjectId;
const prod = F.prodProjectId;
const z = "us-central1-a";
const r = "us-central1";
const net = (n: string, cidr: string) => [
  `gcloud compute networks create ${n} --subnet-mode=custom`,
  `gcloud compute networks subnets create ${n}-subnet --network=${n} --region=${r} --range=${cidr}`,
];
const vm = (n: string, network: string, flags = "") =>
  `gcloud compute instances create ${n} --zone=${z} --network=${network} --subnet=${network}-subnet --no-address ${flags}`;
const route = (network: string) =>
  `gcloud compute routes create ${network}-internet --network=${network} --destination-range=0.0.0.0/0 --next-hop-gateway=default-internet-gateway`;
const check = (source: string, destination: string, flags = "") =>
  `sim network connectivity ${source} --zone=${z} --destination=${destination} ${flags}`;
const peer = (a: string, b: string) =>
  `gcloud compute networks peerings create ${a}-to-${b} --network=${a} --peer-network=${b}`;
const allow = (network: string, flags = "") =>
  `gcloud compute firewall-rules create ${network}-web --network=${network} --allow=tcp:80 --source-ranges=10.0.0.0/8 ${flags}`;
const worker = `net-worker@${p}.iam.gserviceaccount.com`;
export const NetworkPrelude = ["gcloud services enable compute.googleapis.com dns.googleapis.com"];
export const NetworkSolutions = {
  subnet: [
    ...net("private", "10.20.0.0/24"),
    vm("private-worker", "private"),
    route("private"),
    "gcloud compute networks subnets expand-ip-range private-subnet --region=us-central1 --prefix=10.20.0.0/23",
    "gcloud compute networks subnets update private-subnet --region=us-central1 --enable-private-ip-google-access --enable-flow-logs",
    check("private-worker", "google-apis"),
  ],
  nat: [
    ...net("egress", "10.21.0.0/24"),
    vm("egress-worker", "egress"),
    route("egress"),
    check("egress-worker", "internet"),
    "gcloud compute routers create egress-router --region=us-central1 --network=egress",
    "gcloud compute routers nats create egress-nat --region=us-central1 --router=egress-router --auto-allocate-nat-external-ips --nat-custom-subnet-ip-ranges=egress-subnet",
    check("egress-worker", "internet"),
  ],
  peering: [
    ...net("left", "10.30.0.0/24"),
    ...net("right", "10.31.0.0/24"),
    vm("left-worker", "left"),
    vm("right-worker", "right"),
    allow("right"),
    peer("left", "right"),
    check("left-worker", "right-worker", "--port=80"),
    peer("right", "left"),
    check("left-worker", "right-worker", "--port=80"),
  ],
  nontransitive: [
    ...net("a", "10.32.0.0/24"),
    ...net("b", "10.33.0.0/24"),
    ...net("c", "10.34.0.0/24"),
    vm("a-worker", "a"),
    vm("c-worker", "c"),
    allow("c"),
    peer("a", "b"),
    peer("b", "a"),
    peer("b", "c"),
    peer("c", "b"),
    check("a-worker", "c-worker", "--port=80"),
  ],
  shared: [
    ...net("host", "10.40.0.0/24"),
    `gcloud compute shared-vpc enable ${p}`,
    `gcloud compute shared-vpc associated-projects add ${prod} --host-project=${p}`,
    `gcloud projects add-iam-policy-binding ${p} --member=user:${F.owner} --role=roles/compute.networkUser`,
    `gcloud billing projects link ${prod} --billing-account=${F.billingAccountId}`,
    `gcloud services enable compute.googleapis.com --project=${prod}`,
    `gcloud compute shared-vpc get-host-project ${prod} --project=${prod}`,
    `gcloud compute instances create service-worker --project=${prod} --zone=${z} --network=projects/${p}/global/networks/host --subnet=projects/${p}/regions/${r}/subnetworks/host-subnet --no-address`,
  ],
  vpn: [
    ...net("hybrid", "10.50.0.0/24"),
    vm("hybrid-worker", "hybrid"),
    "gcloud compute routers create hybrid-router --network=hybrid --region=us-central1 --asn=64512",
    "gcloud compute vpn-gateways create ha-gateway --network=hybrid --region=us-central1",
    "gcloud compute external-vpn-gateways create on-prem --interfaces=0=203.0.113.10,1=203.0.113.11 --redundancy-type=two-ips-redundancy",
    ...[0, 1].flatMap((i) => [
      `gcloud compute vpn-tunnels create tunnel-${i} --region=${r} --vpn-gateway=ha-gateway --interface=${i} --peer-external-gateway=on-prem --peer-external-gateway-interface=${i} --router=hybrid-router --shared-secret=lesson-secret`,
      `gcloud compute routers add-interface hybrid-router --region=${r} --interface-name=interface-${i} --vpn-tunnel=tunnel-${i} --ip-address=169.254.${i}.1 --mask-length=30`,
      `gcloud compute routers add-bgp-peer hybrid-router --region=${r} --peer-name=peer-${i} --interface=interface-${i} --peer-ip-address=169.254.${i}.2 --peer-asn=64513`,
      `sim network bgp establish peer-${i} --region=${r} --router=hybrid-router --remote-prefix=10.70.0.0/24`,
    ]),
    check("hybrid-worker", "10.70.0.10"),
  ],
  interconnect: [
    ...net("partner", "10.51.0.0/24"),
    vm("partner-worker", "partner"),
    "gcloud compute routers create partner-router --network=partner --region=us-central1 --asn=16550",
    "gcloud compute interconnects attachments partner create partner-vlan --region=us-central1 --router=partner-router --edge-availability-domain=availability-domain-1 --admin-enabled",
    check("partner-worker", "10.71.0.10"),
    "sim network interconnect activate partner-vlan --region=us-central1 --peer-asn=64514 --remote-prefix=10.71.0.0/24",
    check("partner-worker", "10.71.0.10"),
  ],
  dns: [
    ...net("dns", "10.60.0.0/24"),
    vm("dns-client", "dns"),
    vm("dns-server", "dns"),
    allow("dns"),
    "gcloud dns managed-zones create internal --dns-name=internal.example. --description=Private-lesson --visibility=private --networks=dns",
    "gcloud dns record-sets create app.internal.example. --zone=internal --type=A --ttl=300 --rrdatas=10.60.0.99",
    `sim network connectivity dns-client --zone=${z} --dns-name=app.internal.example. --port=80`,
    "gcloud dns record-sets update app.internal.example. --zone=internal --type=A --ttl=60 --rrdatas=10.60.0.3",
    `sim network connectivity dns-client --zone=${z} --dns-name=app.internal.example. --port=80`,
  ],
  firewall: [
    ...net("secure", "10.61.0.0/24"),
    "gcloud iam service-accounts create net-worker",
    `gcloud iam service-accounts add-iam-policy-binding ${worker} --member=user:${F.owner} --role=roles/iam.serviceAccountUser`,
    vm("secure-client", "secure"),
    vm("secure-server", "secure", `--service-account=${worker}`),
    `gcloud compute firewall-rules create secure-allow --network=secure --allow=tcp:80 --target-service-accounts=${worker} --source-ranges=10.61.0.0/24 --priority=1000 --enable-logging`,
    "gcloud compute firewall-rules create secure-deny --network=secure --action=DENY --rules=tcp:80 --priority=500 --source-ranges=10.61.0.0/24 --enable-logging",
    check("secure-client", "secure-server", "--port=80"),
    "gcloud compute firewall-rules update secure-deny --priority=2000",
    check("secure-client", "secure-server", "--port=80"),
  ],
  ngfw: [
    ...net("policy", "10.62.0.0/24"),
    vm("policy-client", "policy"),
    vm("policy-server", "policy"),
    "gcloud compute network-firewall-policies create organization-web --global",
    "gcloud compute network-firewall-policies associations create policy-vpc --firewall-policy=organization-web --network=policy --global-firewall-policy",
    "gcloud compute network-firewall-policies rules create 1000 --firewall-policy=organization-web --global-firewall-policy --action=allow --direction=INGRESS --layer4-configs=tcp:80 --src-ip-ranges=10.62.0.0/24 --target-secure-tags=tagValues/100 --enable-logging",
    "gcloud compute network-firewall-policies rules create 2000 --firewall-policy=organization-web --global-firewall-policy --action=deny --direction=INGRESS --layer4-configs=all --enable-logging",
    check("policy-client", "policy-server", "--port=80"),
    "sim network secure-tags bind policy-server --zone=us-central1-a --tags=tagValues/100",
    check("policy-client", "policy-server", "--port=80"),
  ],
};
export type NetworkLesson = keyof typeof NetworkSolutions;
export type NetworkAssertion = Readonly<{ kind: "networkLesson"; lesson: NetworkLesson }>;
const titles: Record<NetworkLesson, readonly [string, string, Mission["domain"]]> = {
  subnet: [
    "サブネットを拡張し外部IPなしでGoogle APIに接続する",
    "CIDRを/23へ拡張し、Private Google Accessとflow logsを有効化して構成上の疎通を確認する。",
    "計画と構成",
  ],
  nat: [
    "外部IPなしVMのインターネット経路をCloud NATで直す",
    "失敗を診断し、同じVPC・リージョンのNATと対象サブネットを設定する。",
    "運用の維持",
  ],
  peering: [
    "peeringの両側を設定して別VPCへ接続する",
    "片側だけでは接続できない。両側設定と宛先Firewallをそろえる。",
    "デプロイと実装",
  ],
  nontransitive: [
    "peeringが推移的な経路を作らないことを診断する",
    "A-BとB-Cを接続し、A-Cがno-direct-routeになることを確認する。",
    "計画と構成",
  ],
  shared: [
    "Shared VPCのサブネットをサービスプロジェクトから使う",
    "ホスト・サービス関係とホスト側networkUser権限をそろえ、サービスプロジェクトへVMを配置する。",
    "アクセスとセキュリティ",
  ],
  vpn: [
    "HA VPNの2インターフェースとBGP経路を設定する",
    "各トンネルとlink-local /30、異なるASNを設定して明示的に仮想接続を確立する。",
    "デプロイと実装",
  ],
  interconnect: [
    "Partner InterconnectのVLAN attachmentを有効化する",
    "ASN 16550のRouterとpending attachmentを作り、教材上のプロビジョニング後に経路を確認する。",
    "デプロイと実装",
  ],
  dns: [
    "private DNSの誤ったAレコードを直して接続する",
    "許可VPCのprivate zoneとFirewallを設定し、誤ったIPからサーバーの内部IPへ更新する。",
    "運用の維持",
  ],
  firewall: [
    "サービスアカウント対象のFirewallとdeny優先順位を直す",
    "高優先度denyの診断から優先順位を修正し、SA対象のallowとログを確認する。",
    "アクセスとセキュリティ",
  ],
  ngfw: [
    "secure tagでnetwork firewall policyの対象を限定する",
    "L3/L4のallow/denyを設定し、secure tagの付いたサーバーだけに接続する。L7検査は再現しない。",
    "アクセスとセキュリティ",
  ],
};
export const NetworkMissions: readonly Mission[] = Object.keys(NetworkSolutions).map((key) => {
  const lesson = key as NetworkLesson;
  return {
    id: `network-${lesson}`,
    domain: titles[lesson][2],
    title: titles[lesson][0],
    description: titles[lesson][1],
    setup: [
      { kind: "setProject", projectId: p },
      { kind: "setPrincipal", principal: F.owner },
    ],
    hints: [
      "helpで対応フラグを確認し、設定後にsim network connectivityで経路と拒否理由を確認する。",
      ...NetworkSolutions[lesson],
    ],
    assertions: [{ kind: "networkLesson", lesson }],
  };
});
export const networkSatisfied = (w: World, lesson: NetworkLesson): boolean => {
  const l = w.networkLab;
  const check = (source: string, destination: string, allowed = true, dns = "") => {
    const c = l.checks.findLast(
      (c) =>
        c.projectId === p &&
        c.zone === z &&
        c.name === source &&
        c.destination === destination &&
        c.dns === dns,
    );
    return !!c && c.allowed === allowed && evaluateConnection(w, c).allowed === allowed;
  };
  if (lesson === "subnet") {
    return (
      w.subnets.some(
        (s) =>
          s.projectId === p &&
          s.name === "private-subnet" &&
          s.ipCidrRange === "10.20.0.0/23" &&
          s.privateIpGoogleAccess &&
          s.flowLogs,
      ) &&
      check("private-worker", "google-apis") &&
      l.logs.some((log) => log.name === "private-worker" && log.kind === "FLOW")
    );
  }
  if (lesson === "nat") {
    return (
      check("egress-worker", "internet") &&
      l.checks.some((c) => c.name === "egress-worker" && !c.allowed) &&
      l.nats.some(
        (n) => n.projectId === p && n.name === "egress-nat" && n.subnets.includes("egress-subnet"),
      )
    );
  }
  if (lesson === "peering") {
    return (
      check("left-worker", "right-worker") &&
      l.checks.some((c) => c.name === "left-worker" && c.reason === "no-direct-route")
    );
  }
  if (lesson === "nontransitive") {
    return (
      w.peerings.filter(
        (v) =>
          v.projectId === p &&
          v.state === "ACTIVE" &&
          ["a-to-b", "b-to-a", "b-to-c", "c-to-b"].includes(v.name),
      ).length === 4 &&
      check("a-worker", "c-worker", false) &&
      l.checks.findLast((c) => c.name === "a-worker")?.reason === "no-direct-route"
    );
  }
  if (lesson === "shared") {
    return (
      l.shared.some((s) => s.host === p && s.services.includes(prod)) &&
      w.instances.some(
        (i) =>
          i.projectId === prod &&
          i.zone === z &&
          i.name === "service-worker" &&
          i.networkInterfaces[0]?.networkProject === p &&
          i.networkInterfaces[0]?.subnetwork === "host-subnet",
      )
    );
  }
  if (lesson === "vpn") {
    return (
      new Set(
        l.tunnels
          .filter(
            (t) => t.projectId === p && t.gateway === "ha-gateway" && t.state === "ESTABLISHED",
          )
          .map((t) => t.interface),
      ).size === 2 &&
      l.bgpPeers.filter(
        (b) => b.projectId === p && b.router === "hybrid-router" && b.state === "UP",
      ).length === 2 &&
      check("hybrid-worker", "10.70.0.10")
    );
  }
  if (lesson === "interconnect") {
    return (
      l.attachments.some(
        (a) => a.projectId === p && a.name === "partner-vlan" && a.state === "ACTIVE",
      ) && check("partner-worker", "10.71.0.10")
    );
  }
  if (lesson === "dns") {
    return (
      l.records.some(
        (r) =>
          r.projectId === p &&
          r.name === "app.internal.example." &&
          r.data[0] === "10.60.0.3" &&
          r.ttl === 60,
      ) && check("dns-client", "", true, "app.internal.example.")
    );
  }
  if (lesson === "firewall") {
    return (
      check("secure-client", "secure-server") &&
      w.firewallRules.some(
        (f) =>
          f.projectId === p &&
          f.name === "secure-allow" &&
          f.targetServiceAccounts?.includes(worker),
      ) &&
      l.logs.some((l) => l.name === "secure-client" && l.kind === "FIREWALL" && !l.allowed) &&
      l.logs.some((l) => l.name === "secure-client" && l.kind === "FIREWALL" && l.allowed)
    );
  }
  return (
    check("policy-client", "policy-server") &&
    l.secureTags.some((t) => t.instance === "policy-server" && t.tags.includes("tagValues/100")) &&
    l.logs.some((l) => l.name === "policy-client" && l.kind === "FIREWALL" && !l.allowed) &&
    l.logs.some((l) => l.name === "policy-client" && l.kind === "FIREWALL" && l.allowed)
  );
};
