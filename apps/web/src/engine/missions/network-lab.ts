import { evaluateConnection } from "@/engine/domains/network-lab/model";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { MissionStep } from "@/engine/missions/mission-step";

const p = F.devProjectId;
const prod = F.prodProjectId;
const z = "us-central1-a";
const r = "us-central1";
const net = (n: string, cidr: string) => [
  MissionStep.run(
    `${n}ネットワークをカスタムモードで作る`,
    `gcloud compute networks create ${n} --subnet-mode=custom`,
    "カスタムモードではサブネットが自動で作られないので、次の手順で切ります。",
  ),
  MissionStep.run(
    `${n}-subnet（${cidr}）を作る`,
    `gcloud compute networks subnets create ${n}-subnet --network=${n} --region=${r} --range=${cidr}`,
  ),
];
const vm = (n: string, network: string, flags = "", what = `外部IPなしの${n}を作る`) =>
  MissionStep.run(
    what,
    `gcloud compute instances create ${n} --zone=${z} --network=${network} --subnet=${network}-subnet --no-address ${flags}`,
  );
const route = (network: string) =>
  MissionStep.run(
    `${network}の既定ルートをインターネットゲートウェイへ向ける`,
    `gcloud compute routes create ${network}-internet --network=${network} --destination-range=0.0.0.0/0 --next-hop-gateway=default-internet-gateway`,
    "Private Google AccessもCloud NATも、この経路があることを前提にします。",
  );
const check = (what: string, source: string, destination: string, flags = "", note?: string) =>
  MissionStep.run(
    what,
    `sim network connectivity ${source} --zone=${z} --destination=${destination} ${flags}`,
    note,
  );
const peer = (a: string, b: string, what: string, note?: string) =>
  MissionStep.run(
    what,
    `gcloud compute networks peerings create ${a}-to-${b} --network=${a} --peer-network=${b}`,
    note,
  );
const allow = (network: string, flags = "") =>
  MissionStep.run(
    `${network}のVMへ10.0.0.0/8からのTCP:80を許可する`,
    `gcloud compute firewall-rules create ${network}-web --network=${network} --allow=tcp:80 --source-ranges=10.0.0.0/8 ${flags}`,
  );
const worker = `net-worker@${p}.iam.gserviceaccount.com`;
const linesOf = <K extends string>(
  steps: Readonly<Record<K, readonly MissionStep[]>>,
): Readonly<Record<K, readonly string[]>> =>
  Object.fromEntries(
    Object.entries<readonly MissionStep[]>(steps).map(([k, v]) => [k, MissionStep.lines(v)]),
  ) as Record<K, readonly string[]>;
export const NetworkPreludeSteps: readonly MissionStep[] = [
  MissionStep.run(
    "Compute EngineとCloud DNSのAPIを有効にする",
    "gcloud services enable compute.googleapis.com dns.googleapis.com",
  ),
];
export const NetworkPrelude: readonly string[] = MissionStep.lines(NetworkPreludeSteps);
export const NetworkSteps = {
  subnet: [
    ...net("private", "10.20.0.0/24"),
    vm("private-worker", "private"),
    route("private"),
    MissionStep.run(
      "private-subnetを/23へ広げる",
      "gcloud compute networks subnets expand-ip-range private-subnet --region=us-central1 --prefix=10.20.0.0/23",
      "広げることはできても、縮めることはできません。",
    ),
    MissionStep.run(
      "Private Google Accessとフローログを有効にする",
      "gcloud compute networks subnets update private-subnet --region=us-central1 --enable-private-ip-google-access --enable-flow-logs",
      "外部IPの無いVMからGoogle APIへ届くようになり、通信がフローログに残ります。",
    ),
    check("private-workerからGoogle APIへ届くか確かめる", "private-worker", "google-apis"),
  ],
  nat: [
    ...net("egress", "10.21.0.0/24"),
    vm("egress-worker", "egress"),
    route("egress"),
    check(
      "NATなしではインターネットへ出られないことを確かめる",
      "egress-worker",
      "internet",
      "",
      "経路があっても、外部IPもNATも無いVMは外へ出られません。",
    ),
    MissionStep.run(
      "egress VPCにCloud Routerを作る",
      "gcloud compute routers create egress-router --region=us-central1 --network=egress",
      "Cloud NATはCloud Routerに載せるため、同じVPC・リージョンに作ります。",
    ),
    MissionStep.run(
      "egress-subnetだけを対象にCloud NATを作る",
      "gcloud compute routers nats create egress-nat --region=us-central1 --router=egress-router --auto-allocate-nat-external-ips --nat-custom-subnet-ip-ranges=egress-subnet",
      "NAT用の外部IPは自動で割り当てます。",
    ),
    check("NAT経由でインターネットへ出られるか確かめる", "egress-worker", "internet"),
  ],
  peering: [
    ...net("left", "10.30.0.0/24"),
    ...net("right", "10.31.0.0/24"),
    vm("left-worker", "left"),
    vm("right-worker", "right"),
    allow("right"),
    peer(
      "left",
      "right",
      "leftからrightへのpeeringを作る",
      "相手側の設定がまだ無いので、この時点ではACTIVEになりません。",
    ),
    check(
      "片側だけのpeeringでは届かないことを確かめる",
      "left-worker",
      "right-worker",
      "--port=80",
      "no-direct-routeで拒否されます。",
    ),
    peer(
      "right",
      "left",
      "rightからleftへのpeeringを作って両側をそろえる",
      "両側がそろうとACTIVEになり、経路が交換されます。",
    ),
    check(
      "両側のpeering後にright-workerへ届くか確かめる",
      "left-worker",
      "right-worker",
      "--port=80",
    ),
  ],
  nontransitive: [
    ...net("a", "10.32.0.0/24"),
    ...net("b", "10.33.0.0/24"),
    ...net("c", "10.34.0.0/24"),
    vm("a-worker", "a"),
    vm("c-worker", "c"),
    allow("c"),
    peer("a", "b", "aからbへのpeeringを作る"),
    peer("b", "a", "bからaへのpeeringを作ってA-Bをつなぐ"),
    peer("b", "c", "bからcへのpeeringを作る"),
    peer("c", "b", "cからbへのpeeringを作ってB-Cをつなぐ"),
    check(
      "AからCへ届かないことを確かめる",
      "a-worker",
      "c-worker",
      "--port=80",
      "peeringは推移しないため、Bを経由する経路はできずno-direct-routeになります。",
    ),
  ],
  shared: [
    ...net("host", "10.40.0.0/24"),
    MissionStep.run(
      "開発プロジェクトをShared VPCのホストにする",
      `gcloud compute shared-vpc enable ${p}`,
    ),
    MissionStep.run(
      "本番プロジェクトをサービスプロジェクトとして関連付ける",
      `gcloud compute shared-vpc associated-projects add ${prod} --host-project=${p}`,
    ),
    MissionStep.run(
      "自分にホスト側のnetworkUserを付ける",
      `gcloud projects add-iam-policy-binding ${p} --member=user:${F.owner} --role=roles/compute.networkUser`,
      "サービスプロジェクトにVMを作る人が、ホストのサブネットを使うために必要です。",
    ),
    MissionStep.run(
      "本番プロジェクトに請求アカウントをつなぐ",
      `gcloud billing projects link ${prod} --billing-account=${F.billingAccountId}`,
      "課金が無いとAPIを有効にできません。",
    ),
    MissionStep.run(
      "本番プロジェクトでCompute Engine APIを有効にする",
      `gcloud services enable compute.googleapis.com --project=${prod}`,
    ),
    MissionStep.run(
      "本番プロジェクトのホストが開発プロジェクトか確かめる",
      `gcloud compute shared-vpc get-host-project ${prod} --project=${prod}`,
    ),
    MissionStep.run(
      "ホストのサブネットに本番プロジェクトのVMを作る",
      `gcloud compute instances create service-worker --project=${prod} --zone=${z} --network=projects/${p}/global/networks/host --subnet=projects/${p}/regions/${r}/subnetworks/host-subnet --no-address`,
      "--networkと--subnetには、ホストプロジェクトのリソースパスを指定します。",
    ),
  ],
  vpn: [
    ...net("hybrid", "10.50.0.0/24"),
    vm("hybrid-worker", "hybrid"),
    MissionStep.run(
      "BGP用にASN 64512のCloud Routerを作る",
      "gcloud compute routers create hybrid-router --network=hybrid --region=us-central1 --asn=64512",
    ),
    MissionStep.run(
      "HA VPNゲートウェイを作る",
      "gcloud compute vpn-gateways create ha-gateway --network=hybrid --region=us-central1",
      "インターフェース0と1の2つが用意されます。",
    ),
    MissionStep.run(
      "オンプレ側の2つのIPを外部VPNゲートウェイとして登録する",
      "gcloud compute external-vpn-gateways create on-prem --interfaces=0=203.0.113.10,1=203.0.113.11 --redundancy-type=two-ips-redundancy",
    ),
    ...[0, 1].flatMap((i) => [
      MissionStep.run(
        `インターフェース${i}にtunnel-${i}を張る`,
        `gcloud compute vpn-tunnels create tunnel-${i} --region=${r} --vpn-gateway=ha-gateway --interface=${i} --peer-external-gateway=on-prem --peer-external-gateway-interface=${i} --router=hybrid-router --shared-secret=lesson-secret`,
        i === 0 ? "HA VPNは2つのインターフェースそれぞれにトンネルを張ります。" : undefined,
      ),
      MissionStep.run(
        `tunnel-${i}にlink-localの/30を割り当てる`,
        `gcloud compute routers add-interface hybrid-router --region=${r} --interface-name=interface-${i} --vpn-tunnel=tunnel-${i} --ip-address=169.254.${i}.1 --mask-length=30`,
        i === 0 ? "169.254.0.0/16から/30を切り、Cloud Router側に.1を使います。" : undefined,
      ),
      MissionStep.run(
        `peer-${i}としてASN 64513のBGPピアを足す`,
        `gcloud compute routers add-bgp-peer hybrid-router --region=${r} --peer-name=peer-${i} --interface=interface-${i} --peer-ip-address=169.254.${i}.2 --peer-asn=64513`,
        i === 0 ? "相手側のASNはCloud Router（64512）と別の値にします。" : undefined,
      ),
      MissionStep.run(
        `peer-${i}のBGPセッションを確立させる`,
        `sim network bgp establish peer-${i} --region=${r} --router=hybrid-router --remote-prefix=10.70.0.0/24`,
        i === 0 ? "教材上で相手側を立ち上げ、10.70.0.0/24の経路を受け取ります。" : undefined,
      ),
    ]),
    check("オンプレの10.70.0.10へ届くか確かめる", "hybrid-worker", "10.70.0.10"),
  ],
  interconnect: [
    ...net("partner", "10.51.0.0/24"),
    vm("partner-worker", "partner"),
    MissionStep.run(
      "ASN 16550のCloud Routerを作る",
      "gcloud compute routers create partner-router --network=partner --region=us-central1 --asn=16550",
      "Partner Interconnectで使うCloud RouterのASNは16550です。",
    ),
    MissionStep.run(
      "VLAN attachmentを作る",
      "gcloud compute interconnects attachments partner create partner-vlan --region=us-central1 --router=partner-router --edge-availability-domain=availability-domain-1 --admin-enabled",
      "パートナー側のプロビジョニングが済むまでは待ち状態のままです。",
    ),
    check("プロビジョニング前は届かないことを確かめる", "partner-worker", "10.71.0.10"),
    MissionStep.run(
      "パートナー側のプロビジョニングを済ませる",
      "sim network interconnect activate partner-vlan --region=us-central1 --peer-asn=64514 --remote-prefix=10.71.0.0/24",
      "教材上でattachmentを有効にし、10.71.0.0/24の経路を受け取ります。",
    ),
    check("プロビジョニング後に届くか確かめる", "partner-worker", "10.71.0.10"),
  ],
  dns: [
    ...net("dns", "10.60.0.0/24"),
    vm("dns-client", "dns"),
    vm("dns-server", "dns"),
    allow("dns"),
    MissionStep.run(
      "dns VPCだけから引けるprivate zoneを作る",
      "gcloud dns managed-zones create internal --dns-name=internal.example. --description=Private-lesson --visibility=private --networks=dns",
    ),
    MissionStep.run(
      "app.internal.example.のAレコードを作る",
      "gcloud dns record-sets create app.internal.example. --zone=internal --type=A --ttl=300 --rrdatas=10.60.0.99",
      "ここではわざと誤ったIP（10.60.0.99）を登録します。",
    ),
    MissionStep.run(
      "名前で引いて接続できないことを確かめる",
      `sim network connectivity dns-client --zone=${z} --dns-name=app.internal.example. --port=80`,
      "名前は引けても、そのIPにはサーバーがいないため失敗します。",
    ),
    MissionStep.run(
      "Aレコードをdns-serverの内部IPへ直す",
      "gcloud dns record-sets update app.internal.example. --zone=internal --type=A --ttl=60 --rrdatas=10.60.0.3",
      "TTLも60秒に下げます。",
    ),
    MissionStep.run(
      "直した後に名前で接続できるか確かめる",
      `sim network connectivity dns-client --zone=${z} --dns-name=app.internal.example. --port=80`,
    ),
  ],
  firewall: [
    ...net("secure", "10.61.0.0/24"),
    MissionStep.run(
      "サーバー用のサービスアカウントを作る",
      "gcloud iam service-accounts create net-worker",
    ),
    MissionStep.run(
      "自分にnet-workerを使う権限を付ける",
      `gcloud iam service-accounts add-iam-policy-binding ${worker} --member=user:${F.owner} --role=roles/iam.serviceAccountUser`,
      "VMにサービスアカウントを付けるには、そのSAのService Account Userが要ります。",
    ),
    vm("secure-client", "secure"),
    vm(
      "secure-server",
      "secure",
      `--service-account=${worker}`,
      "net-workerを付けてsecure-serverを作る",
    ),
    MissionStep.run(
      "net-workerのVMだけへTCP:80を許可する",
      `gcloud compute firewall-rules create secure-allow --network=secure --allow=tcp:80 --target-service-accounts=${worker} --source-ranges=10.61.0.0/24 --priority=1000 --enable-logging`,
      "優先度は1000です。ログを有効にして判定を残します。",
    ),
    MissionStep.run(
      "優先度500で同じ通信を拒否するルールを作る",
      "gcloud compute firewall-rules create secure-deny --network=secure --action=DENY --rules=tcp:80 --priority=500 --source-ranges=10.61.0.0/24 --enable-logging",
      "数値が小さいほど先に評価されるので、allowより先に効きます。",
    ),
    check(
      "denyが先に効いて拒否されることを確かめる",
      "secure-client",
      "secure-server",
      "--port=80",
    ),
    MissionStep.run(
      "denyの優先度を2000に下げる",
      "gcloud compute firewall-rules update secure-deny --priority=2000",
      "allow（1000）のほうが先に評価されるようになります。",
    ),
    check("allowが効いて接続できるか確かめる", "secure-client", "secure-server", "--port=80"),
  ],
  ngfw: [
    ...net("policy", "10.62.0.0/24"),
    vm("policy-client", "policy"),
    vm("policy-server", "policy"),
    MissionStep.run(
      "グローバルのネットワークファイアウォールポリシーを作る",
      "gcloud compute network-firewall-policies create organization-web --global",
    ),
    MissionStep.run(
      "ポリシーをpolicy VPCに関連付ける",
      "gcloud compute network-firewall-policies associations create policy-vpc --firewall-policy=organization-web --network=policy --global-firewall-policy",
    ),
    MissionStep.run(
      "secure tagの付いたVMだけへTCP:80を許可する",
      "gcloud compute network-firewall-policies rules create 1000 --firewall-policy=organization-web --global-firewall-policy --action=allow --direction=INGRESS --layer4-configs=tcp:80 --src-ip-ranges=10.62.0.0/24 --target-secure-tags=tagValues/100 --enable-logging",
      "tagValues/100の付いたVMだけが対象になります。",
    ),
    MissionStep.run(
      "残りの受信をすべて拒否するルールを作る",
      "gcloud compute network-firewall-policies rules create 2000 --firewall-policy=organization-web --global-firewall-policy --action=deny --direction=INGRESS --layer4-configs=all --enable-logging",
      "優先度2000なので、1000のallowに当たらなかった通信だけが拒否されます。",
    ),
    check(
      "タグが無いうちは拒否されることを確かめる",
      "policy-client",
      "policy-server",
      "--port=80",
    ),
    MissionStep.run(
      "policy-serverにsecure tagを付ける",
      "sim network secure-tags bind policy-server --zone=us-central1-a --tags=tagValues/100",
    ),
    check("タグを付けた後に接続できるか確かめる", "policy-client", "policy-server", "--port=80"),
  ],
};
export const NetworkSolutions = linesOf(NetworkSteps);
export type NetworkLesson = keyof typeof NetworkSteps;
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
export const NetworkMissions: readonly Mission[] = Object.keys(NetworkSteps).map((key) => {
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
    steps: [
      MissionStep.say(
        "設定のたびに経路と拒否理由を確かめる",
        "各コマンドの対応フラグはhelpで確認できます。sim network connectivityが経路と拒否理由を返します。",
      ),
      ...NetworkSteps[lesson],
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
