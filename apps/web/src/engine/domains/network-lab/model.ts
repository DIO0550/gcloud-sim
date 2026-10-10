import { Region, Zone } from "@/engine/domains/catalog";
import { type Instance, ProtocolRule, ResourceName } from "@/engine/domains/compute";
import { Ipv4 } from "@/engine/domains/gke-control-plane";
import type { World } from "@/engine/domains/world";
import { Decoder as D } from "@/utils/Decoder";
import { Result } from "@/utils/Result";

export type Ref = Readonly<{ projectId: string; name: string; region: string }>;
export type Route = Ref &
  Readonly<{
    network: string;
    destination: string;
    priority: number;
    nextHop: string;
    tags: readonly string[];
  }>;
export type Nat = Ref &
  Readonly<{ router: string; subnets: readonly string[]; allSubnets: boolean; logging: boolean }>;
export type SharedVpc = Readonly<{ host: string; services: readonly string[] }>;
export type Gateway = Ref & Readonly<{ network: string }>;
export type PeerGateway = Ref & Readonly<{ interfaces: readonly string[] }>;
export type Tunnel = Ref &
  Readonly<{
    gateway: string;
    peerGateway: string;
    interface: number;
    peerInterface: number;
    router: string;
    state: "DOWN" | "ESTABLISHED";
  }>;
export type RouterInterface = Ref &
  Readonly<{ router: string; tunnel: string; ip: string; mask: number }>;
export type BgpPeer = Ref &
  Readonly<{
    router: string;
    interface: string;
    peerIp: string;
    peerAsn: number;
    remotePrefix: string;
    state: "DOWN" | "UP";
  }>;
export type Attachment = Ref &
  Readonly<{
    router: string;
    edge: "availability-domain-1" | "availability-domain-2";
    enabled: boolean;
    state: "PENDING_PARTNER" | "ACTIVE";
    remotePrefix: string;
    peerAsn: number;
  }>;
export type DnsRecord = Ref &
  Readonly<{ zone: string; type: "A" | "CNAME" | "TXT"; ttl: number; data: readonly string[] }>;
export type SecureTag = Ref & Readonly<{ instance: string; zone: string; tags: readonly string[] }>;
export type PolicyRule = Readonly<{
  priority: number;
  direction: "INGRESS" | "EGRESS";
  action: "allow" | "deny";
  protocols: readonly { protocol: string; ports: readonly string[] }[];
  sourceRanges: readonly string[];
  destinationRanges: readonly string[];
  secureTags: readonly string[];
  logging: boolean;
}>;
export type Policy = Ref &
  Readonly<{ network: string; association: string; rules: readonly PolicyRule[] }>;
export type Check = Ref &
  Readonly<{
    zone: string;
    destination: string;
    destinationProject: string;
    destinationZone: string;
    protocol: string;
    port: number;
    allowed: boolean;
    reason: string;
    dns: string;
  }>;
export type NetworkLog = Ref &
  Readonly<{
    kind: "FLOW" | "FIREWALL" | "NAT";
    source: string;
    destination: string;
    allowed: boolean;
    rule: string;
  }>;
export type NetworkLab = Readonly<{
  routes: readonly Route[];
  nats: readonly Nat[];
  shared: readonly SharedVpc[];
  gateways: readonly Gateway[];
  peerGateways: readonly PeerGateway[];
  tunnels: readonly Tunnel[];
  interfaces: readonly RouterInterface[];
  bgpPeers: readonly BgpPeer[];
  attachments: readonly Attachment[];
  records: readonly DnsRecord[];
  secureTags: readonly SecureTag[];
  policies: readonly Policy[];
  checks: readonly Check[];
  logs: readonly NetworkLog[];
}>;
export const emptyNetworkLab = (): NetworkLab => ({
  routes: [],
  nats: [],
  shared: [],
  gateways: [],
  peerGateways: [],
  tunnels: [],
  interfaces: [],
  bgpPeers: [],
  attachments: [],
  records: [],
  secureTags: [],
  policies: [],
  checks: [],
  logs: [],
});
export const patchNetwork = (w: World, change: Partial<NetworkLab>): World => ({
  ...w,
  networkLab: { ...w.networkLab, ...change },
});
export const same = (a: Ref, b: Ref) =>
  a.projectId === b.projectId && a.name === b.name && a.region === b.region;
export const networkOwner = (_w: World, i: Instance): string => {
  return i.networkInterfaces[0]?.networkProject ?? i.projectId;
};
export const natFor = (w: World, source: Instance): Nat | undefined => {
  const owner = networkOwner(w, source);
  const nic = source.networkInterfaces[0];
  if (!nic) {
    return undefined;
  }
  return w.networkLab.nats.find(
    (n) =>
      n.projectId === owner &&
      n.region === Zone.region(source.zone) &&
      (n.allSubnets || n.subnets.includes(nic.subnetwork)) &&
      w.routers.some(
        (r) =>
          r.projectId === owner &&
          r.region === n.region &&
          r.name === n.router &&
          r.network === nic.network,
      ),
  );
};
export const sameNetwork = (w: World, a: Instance, b: Instance) =>
  networkOwner(w, a) === networkOwner(w, b) &&
  a.networkInterfaces[0]?.network === b.networkInterfaces[0]?.network;
export const peered = (w: World, ap: string, an: string, bp: string, bn: string) =>
  w.peerings.some(
    (p) =>
      p.projectId === ap &&
      p.network === an &&
      p.peerProjectId === bp &&
      p.peerNetwork === bn &&
      p.state === "ACTIVE",
  ) &&
  w.peerings.some(
    (p) =>
      p.projectId === bp &&
      p.network === bn &&
      p.peerProjectId === ap &&
      p.peerNetwork === an &&
      p.state === "ACTIVE",
  );
export const subnetOverlap = (
  w: World,
  projectId: string,
  network: string,
  cidr: string,
  except = "",
) =>
  w.subnets.some(
    (s) =>
      !(s.projectId === projectId && s.network === network && s.name === except) &&
      ((s.projectId === projectId && s.network === network) ||
        peered(w, projectId, network, s.projectId, s.network)) &&
      Ipv4.overlaps(cidr, s.ipCidrRange),
  );
const matchesRanges = (ranges: readonly string[], ip: string) =>
  ranges.length === 0 || ranges.some((r) => Ipv4.contains(r, ip));
const secure = (w: World, i: Instance) =>
  w.networkLab.secureTags.find(
    (s) => s.projectId === i.projectId && s.zone === i.zone && s.instance === i.name,
  )?.tags ?? [];
export type Decision = Readonly<{
  allowed: boolean;
  reason: string;
  rule: string;
  logging: boolean;
}>;
export const firewallDecision = (
  w: World,
  i: Instance,
  direction: "INGRESS" | "EGRESS",
  otherIp: string,
  protocol: string,
  port: number,
  source?: Instance,
): Decision => {
  const owner = networkOwner(w, i);
  const network = i.networkInterfaces[0]?.network ?? "";
  const policy = w.networkLab.policies.find((p) => p.projectId === owner && p.network === network);
  const policyRules =
    policy?.rules
      .filter(
        (r) =>
          r.direction === direction &&
          matchesRanges(direction === "INGRESS" ? r.sourceRanges : r.destinationRanges, otherIp) &&
          (r.secureTags.length === 0 || r.secureTags.some((t) => secure(w, i).includes(t))) &&
          r.protocols.some((r) => ProtocolRule.covers(r, protocol, port)),
      )
      .toSorted((a, b) => a.priority - b.priority) ?? [];
  const first = policyRules[0];
  const policyResult = first
    ? {
        allowed: first.action === "allow",
        reason: `policy:${policy?.name}/${first.priority}`,
        rule: `${policy?.name}/${first.priority}`,
        logging: first.logging,
      }
    : undefined;
  const order = w.networks.find(
    (n) => n.projectId === owner && n.name === network,
  )?.firewallPolicyOrder;
  if (first && order === "BEFORE_CLASSIC_FIREWALL") {
    return {
      allowed: first.action === "allow",
      reason: `policy:${policy?.name}/${first.priority}`,
      rule: `${policy?.name}/${first.priority}`,
      logging: first.logging,
    };
  }
  const rules = w.firewallRules
    .filter(
      (r) =>
        r.projectId === owner &&
        r.network === network &&
        !r.disabled &&
        r.direction === direction &&
        (r.targetTags.length === 0 || r.targetTags.some((t) => i.tags.includes(t))) &&
        ((r.targetServiceAccounts ?? []).length === 0 ||
          r.targetServiceAccounts?.includes(i.serviceAccount)) &&
        ((r.sourceServiceAccounts ?? []).length > 0
          ? (source !== undefined &&
              sameNetwork(w, source, i) &&
              r.sourceServiceAccounts?.includes(source.serviceAccount)) ||
            r.sourceRanges.some((range) => Ipv4.contains(range, otherIp))
          : matchesRanges(
              direction === "INGRESS" ? r.sourceRanges : r.destinationRanges,
              otherIp,
            )) &&
        [...r.allowed, ...r.denied].some((r) => ProtocolRule.covers(r, protocol, port)),
    )
    .toSorted(
      (a, b) =>
        a.priority - b.priority || Number(b.denied.length > 0) - Number(a.denied.length > 0),
    );
  const rule = rules[0];
  if (rule) {
    return {
      allowed: rule.denied.length === 0,
      reason: `firewall:${rule.name}`,
      rule: rule.name,
      logging: rule.logging ?? false,
    };
  }
  if (policyResult) {
    return policyResult;
  }
  return {
    allowed: direction === "EGRESS",
    reason: `implied-${direction === "EGRESS" ? "allow" : "deny"}`,
    rule: "implied",
    logging: false,
  };
};
export const resolveDns = (w: World, i: Instance, query: string): string => {
  const owner = networkOwner(w, i);
  const network = i.networkInterfaces[0]?.network ?? "";
  const zones = w.dnsZones
    .filter(
      (z) =>
        z.projectId === owner &&
        query.endsWith(z.dnsName) &&
        (z.visibility === "public" || z.networks?.includes(network)),
    )
    .toSorted((a, b) => b.dnsName.length - a.dnsName.length);
  const zone = zones[0];
  if (!zone) {
    return "";
  }
  let current = query;
  const visited = new Set<string>();
  for (let depth = 0; depth < 8; depth++) {
    if (visited.has(current)) {
      return "";
    }
    visited.add(current);
    const records = w.networkLab.records.filter(
      (r) => r.projectId === zone.projectId && r.zone === zone.name && r.name === current,
    );
    const a = records.find((r) => r.type === "A");
    if (a) {
      return a.data[0] ?? "";
    }
    current = records.find((r) => r.type === "CNAME")?.data[0] ?? "";
    if (!current) {
      return "";
    }
  }
  return "";
};
export const evaluateConnection = (w: World, c: Check): Decision => {
  const source = w.instances.find(
    (i) => i.projectId === c.projectId && i.zone === c.zone && i.name === c.name,
  );
  const deny = (reason: string): Decision => ({ allowed: false, reason, rule: "", logging: false });
  if (source?.status !== "RUNNING") {
    return deny("source-not-running");
  }
  const owner = networkOwner(w, source);
  const nic = source.networkInterfaces[0];
  if (!nic) {
    return deny("no-interface");
  }
  const subnet = w.subnets.find(
    (s) =>
      s.projectId === owner && s.name === nic.subnetwork && s.region === Zone.region(source.zone),
  );
  let destinationIp = "8.8.8.8";
  let target: Instance | undefined;
  if (c.dns) {
    destinationIp = resolveDns(w, source, c.dns);
    if (!destinationIp) {
      return deny("dns-unresolved");
    }
    target = w.instances.find(
      (i) =>
        i.networkInterfaces.some((n) => n.networkIP === destinationIp) &&
        (networkOwner(w, i) === owner ||
          peered(w, owner, nic.network, networkOwner(w, i), i.networkInterfaces[0]?.network ?? "")),
    );
    if (!target) {
      return deny("dns-target-not-modeled");
    }
  }
  if (
    !c.dns &&
    c.destination !== "internet" &&
    c.destination !== "google-apis" &&
    !Ipv4.address(c.destination).some
  ) {
    target = w.instances.find(
      (i) =>
        i.projectId === c.destinationProject &&
        i.zone === c.destinationZone &&
        i.name === c.destination,
    );
    if (!target) {
      return deny("destination-not-found");
    }
    destinationIp = target.networkInterfaces[0]?.networkIP ?? "";
  }
  if (c.destination === "google-apis") {
    destinationIp = "199.36.153.8";
  }
  if (Ipv4.address(c.destination).some) {
    destinationIp = c.destination;
  }
  const egress = firewallDecision(w, source, "EGRESS", destinationIp, c.protocol, c.port);
  if (!egress.allowed) {
    return egress;
  }
  if (target) {
    if (target.status !== "RUNNING") {
      return deny("destination-not-running");
    }
    if (
      !sameNetwork(w, source, target) &&
      !peered(
        w,
        owner,
        nic.network,
        networkOwner(w, target),
        target.networkInterfaces[0]?.network ?? "",
      )
    ) {
      return deny("no-direct-route");
    }
    return firewallDecision(w, target, "INGRESS", nic.networkIP, c.protocol, c.port, source);
  }
  if (c.destination === "internet" || c.destination === "google-apis") {
    const defaultRoute = w.networkLab.routes.some(
      (r) =>
        r.projectId === owner &&
        r.network === nic.network &&
        r.destination === "0.0.0.0/0" &&
        r.nextHop === "default-internet-gateway" &&
        (r.tags.length === 0 || r.tags.some((t) => source.tags.includes(t))),
    );
    if (!defaultRoute) {
      return deny("no-default-route");
    }
    const nat = natFor(w, source);
    const external = source.networkInterfaces.some((n) => n.externalIP.kind !== "none");
    if (!external && !nat && !(c.destination === "google-apis" && subnet?.privateIpGoogleAccess)) {
      return deny("no-external-ip-nat-or-pga");
    }
    return {
      ...egress,
      allowed: true,
      reason:
        c.destination === "google-apis" && subnet?.privateIpGoogleAccess
          ? "private-google-access"
          : "internet-route",
    };
  }
  const staticRoute = w.networkLab.routes
    .filter(
      (r) =>
        r.projectId === owner &&
        r.network === nic.network &&
        Ipv4.contains(r.destination, destinationIp) &&
        r.nextHop !== "default-internet-gateway" &&
        (r.tags.length === 0 || r.tags.some((t) => source.tags.includes(t))),
    )
    .toSorted(
      (a, b) =>
        (Ipv4.range(b.destination).some ? Number(b.destination.split("/")[1]) : 0) -
          (Ipv4.range(a.destination).some ? Number(a.destination.split("/")[1]) : 0) ||
        a.priority - b.priority,
    )[0];
  const staticTunnel =
    staticRoute &&
    w.networkLab.tunnels.find(
      (t) =>
        t.projectId === owner &&
        `${t.region}/${t.name}` === staticRoute.nextHop &&
        t.state === "ESTABLISHED",
    );
  const dynamic = w.networkLab.bgpPeers.some(
    (p) =>
      p.projectId === owner &&
      p.region === Zone.region(source.zone) &&
      p.state === "UP" &&
      Ipv4.contains(p.remotePrefix, destinationIp) &&
      w.routers.some(
        (r) =>
          r.projectId === owner &&
          r.name === p.router &&
          r.region === p.region &&
          r.network === nic.network,
      ),
  );
  const interconnect = w.networkLab.attachments.some(
    (a) =>
      a.projectId === owner &&
      a.region === Zone.region(source.zone) &&
      a.enabled &&
      a.state === "ACTIVE" &&
      Ipv4.contains(a.remotePrefix, destinationIp) &&
      w.routers.some(
        (r) =>
          r.projectId === owner &&
          r.name === a.router &&
          r.region === a.region &&
          r.network === nic.network,
      ),
  );
  return staticTunnel || dynamic || interconnect
    ? { ...egress, allowed: true, reason: "hybrid-route" }
    : deny("no-hybrid-route");
};
const privateAsn = (n: number) =>
  Number.isInteger(n) && ((n >= 64512 && n <= 65534) || (n >= 4200000000 && n <= 4294967294));
export const validAsn = privateAsn;
const peerAsnValid = (n: number) => Number.isInteger(n) && n >= 1 && n <= 4294967294 && n !== 65535;
export const validProtocols = (rs: readonly { protocol: string; ports: readonly string[] }[]) =>
  rs.length > 0 &&
  rs.every(
    (r) =>
      ProtocolRule.parse(r.protocol).ok &&
      r.ports.every(
        (v) =>
          /^(?:0|[1-9]\d{0,4})(?:-(?:0|[1-9]\d{0,4}))?$/.test(v) &&
          v.split("-").every((n) => Number(n) <= 65535) &&
          Number(v.split("-")[0]) <= Number(v.split("-")[1] ?? v),
      ),
  );
export const validateNetworkLab = (w: World): Result<World, string> => {
  const l = w.networkLab;
  const router = (r: Ref, name: string) =>
    w.routers.find((v) => v.projectId === r.projectId && v.name === name && v.region === r.region);
  const network = (p: string, n: string) =>
    w.networks.some((v) => v.projectId === p && v.name === n);
  for (const resources of [
    l.routes,
    l.nats,
    l.gateways,
    l.peerGateways,
    l.tunnels,
    l.interfaces,
    l.bgpPeers,
    l.attachments,
    l.secureTags,
    l.policies,
  ]) {
    if (
      new Set(
        resources.map((r) => `${r.projectId}/${r.region}/${r.name}/${"zone" in r ? r.zone : ""}`),
      ).size !== resources.length ||
      resources.some(
        (r) =>
          !ResourceName.parse(r.name).ok ||
          !w.projects.some((p) => p.projectId === r.projectId) ||
          (r.region !== "global" && !Region.parse(r.region).some),
      )
    ) {
      return Result.err("Invalid network resource name/project/location or duplicate.");
    }
  }
  for (const s of w.subnets) {
    if (
      !Ipv4.range(s.ipCidrRange).some ||
      !network(s.projectId, s.network) ||
      subnetOverlap(w, s.projectId, s.network, s.ipCidrRange, s.name)
    ) {
      return Result.err("Invalid subnet CIDR/reference or overlapping VPC/peer subnet.");
    }
  }
  for (const r of l.routes) {
    if (
      !network(r.projectId, r.network) ||
      r.region !== "global" ||
      !Ipv4.range(r.destination).some ||
      !Number.isInteger(r.priority) ||
      r.priority < 0 ||
      r.priority > 65535 ||
      (r.nextHop !== "default-internet-gateway" &&
        !l.tunnels.some(
          (t) =>
            t.projectId === r.projectId &&
            `${t.region}/${t.name}` === r.nextHop &&
            w.routers.some(
              (v) =>
                v.projectId === t.projectId &&
                v.name === t.router &&
                v.region === t.region &&
                v.network === r.network,
            ),
        ))
    ) {
      return Result.err("Invalid static route.");
    }
  }
  for (const n of l.nats) {
    const r = router(n, n.router);
    if (
      !r ||
      (n.allSubnets && n.subnets.length > 0) ||
      (!n.allSubnets && n.subnets.length === 0) ||
      n.subnets.some(
        (s) =>
          !w.subnets.some(
            (v) =>
              v.projectId === n.projectId &&
              v.region === n.region &&
              v.network === r.network &&
              v.name === s,
          ),
      )
    ) {
      return Result.err("Invalid NAT router/subnet scope.");
    }
  }
  const attached = new Set<string>();
  for (const s of l.shared) {
    if (
      !w.projects.some((p) => p.projectId === s.host) ||
      attached.has(s.host) ||
      s.services.includes(s.host) ||
      new Set(s.services).size !== s.services.length ||
      s.services.some(
        (p) =>
          !w.projects.some((v) => v.projectId === p) ||
          attached.has(p) ||
          l.shared.some((h) => h.host === p),
      )
    ) {
      return Result.err("Invalid Shared VPC host/service relationship.");
    }
    attached.add(s.host);
    for (const p of s.services) {
      attached.add(p);
    }
  }
  for (const g of l.gateways) {
    if (!network(g.projectId, g.network) || !Region.parse(g.region).some) {
      return Result.err("Invalid HA VPN gateway.");
    }
  }
  for (const g of l.peerGateways) {
    if (
      g.region !== "global" ||
      ![1, 2].includes(g.interfaces.length) ||
      g.interfaces.some((ip) => !Ipv4.address(ip).some)
    ) {
      return Result.err("Invalid peer VPN interfaces.");
    }
  }
  for (const t of l.tunnels) {
    const g = l.gateways.find((g) => same(g, { ...t, name: t.gateway }));
    const peer = l.peerGateways.find(
      (g) => g.projectId === t.projectId && g.name === t.peerGateway,
    );
    const r = router(t, t.router);
    if (
      !g ||
      !peer ||
      !r ||
      r.network !== g.network ||
      ![0, 1].includes(t.interface) ||
      !Number.isInteger(t.peerInterface) ||
      !peer.interfaces[t.peerInterface] ||
      l.tunnels.some(
        (v) =>
          v !== t &&
          v.projectId === t.projectId &&
          v.region === t.region &&
          v.gateway === t.gateway &&
          v.interface === t.interface,
      )
    ) {
      return Result.err("Invalid VPN tunnel references/interfaces.");
    }
  }
  for (const i of l.interfaces) {
    const thisRouter = router(i, i.router);
    const address = Ipv4.address(i.ip);
    if (
      thisRouter &&
      address.some &&
      l.interfaces.some((v) => {
        const otherRouter = router(v, v.router);
        const otherAddress = Ipv4.address(v.ip);
        return (
          v !== i &&
          v.projectId === i.projectId &&
          otherRouter?.network === thisRouter.network &&
          otherAddress.some &&
          Math.floor(otherAddress.value / 4) === Math.floor(address.value / 4)
        );
      })
    ) {
      return Result.err("BGP link-local /30 must be unique across routers and regions in the VPC.");
    }
    if (
      !router(i, i.router) ||
      !l.tunnels.some((t) => same(t, { ...i, name: i.tunnel }) && t.router === i.router) ||
      i.mask !== 30 ||
      !Ipv4.contains("169.254.0.0/16", i.ip) ||
      !Ipv4.address(i.ip).some ||
      l.interfaces.some(
        (v) =>
          v !== i &&
          v.projectId === i.projectId &&
          v.region === i.region &&
          v.router === i.router &&
          (v.tunnel === i.tunnel || v.ip === i.ip),
      )
    ) {
      return Result.err("Invalid BGP interface/link-local /30.");
    }
  }
  for (const p of l.bgpPeers) {
    const i = l.interfaces.find(
      (i) => same(i, { ...p, name: p.interface }) && i.router === p.router,
    );
    const r = router(p, p.router);
    const ip = i ? Ipv4.address(i.ip) : { some: false as const };
    const peer = Ipv4.address(p.peerIp);
    if (
      !i ||
      !r ||
      !ip.some ||
      !peer.some ||
      Math.floor(ip.value / 4) !== Math.floor(peer.value / 4) ||
      ip.value === peer.value ||
      ip.value % 4 === 0 ||
      ip.value % 4 === 3 ||
      peer.value % 4 === 0 ||
      peer.value % 4 === 3 ||
      !privateAsn(p.peerAsn) ||
      p.peerAsn === r.asn ||
      (p.remotePrefix !== "" && !Ipv4.range(p.remotePrefix).some) ||
      (p.state === "UP" &&
        (!p.remotePrefix ||
          !l.tunnels.some((t) => same(t, { ...p, name: i.tunnel }) && t.state === "ESTABLISHED")))
    ) {
      return Result.err("Invalid BGP peer/ASN/state.");
    }
  }
  for (const a of l.attachments) {
    const r = router(a, a.router);
    if (
      r?.asn !== 16550 ||
      (a.state === "ACTIVE" &&
        (!a.enabled || !Ipv4.range(a.remotePrefix).some || !peerAsnValid(a.peerAsn)))
    ) {
      return Result.err(
        "Partner Interconnect needs router ASN 16550, activation and a valid learned route.",
      );
    }
  }
  for (const r of l.records) {
    const z = w.dnsZones.find((z) => z.projectId === r.projectId && z.name === r.zone);
    if (
      !z ||
      r.region !== "global" ||
      !r.name.endsWith(z.dnsName) ||
      !/^([a-z0-9-]+\.)+$/.test(r.name) ||
      !Number.isInteger(r.ttl) ||
      r.ttl < 1 ||
      r.ttl > 86400 ||
      r.data.length === 0 ||
      r.data.length > 10 ||
      (r.type === "A" && r.data.some((ip) => !Ipv4.address(ip).some)) ||
      (r.type === "CNAME" &&
        (r.name === z.dnsName ||
          r.data.length !== 1 ||
          !/^([a-z0-9-]+\.)+$/.test(r.data[0] ?? ""))) ||
      r.data.some((d) => new TextEncoder().encode(d).length > 255) ||
      l.records.some(
        (v) =>
          v !== r &&
          v.projectId === r.projectId &&
          v.zone === r.zone &&
          v.name === r.name &&
          (v.type === r.type || v.type === "CNAME" || r.type === "CNAME"),
      )
    ) {
      return Result.err("Invalid DNS record/TTL/data or conflicting CNAME.");
    }
  }
  for (const z of w.dnsZones) {
    if (
      z.networks &&
      (z.visibility !== "private" ||
        z.networks.length === 0 ||
        z.networks.some((n) => !network(z.projectId, n)))
    ) {
      return Result.err("Invalid private DNS network authorization.");
    }
  }
  for (const t of l.secureTags) {
    if (
      !w.instances.some(
        (i) => i.projectId === t.projectId && i.zone === t.zone && i.name === t.instance,
      ) ||
      t.tags.some((v) => !/^tagValues\/[1-9]\d{0,8}$/.test(v))
    ) {
      return Result.err("Invalid secure tag binding.");
    }
  }
  for (const p of l.policies) {
    if (
      p.region !== "global" ||
      (p.network && !network(p.projectId, p.network)) ||
      Boolean(p.network) !== Boolean(p.association) ||
      (p.association !== "" && !ResourceName.parse(p.association).ok) ||
      (p.network &&
        l.policies.some(
          (v) => v !== p && v.projectId === p.projectId && v.network === p.network,
        )) ||
      new Set(p.rules.map((r) => r.priority)).size !== p.rules.length ||
      p.rules.some(
        (r) =>
          !Number.isInteger(r.priority) ||
          r.priority < 0 ||
          r.priority > 65534 ||
          !validProtocols(r.protocols) ||
          [...r.sourceRanges, ...r.destinationRanges].some((c) => !Ipv4.range(c).some) ||
          r.secureTags.some((v) => !/^tagValues\/[1-9]\d{0,8}$/.test(v)),
      )
    ) {
      return Result.err("Invalid network firewall policy.");
    }
  }
  for (const i of w.instances) {
    for (const nic of i.networkInterfaces) {
      if (
        nic.networkProject &&
        (!l.shared.some((s) => s.host === nic.networkProject && s.services.includes(i.projectId)) ||
          !w.subnets.some(
            (s) =>
              s.projectId === nic.networkProject &&
              s.name === nic.subnetwork &&
              s.network === nic.network &&
              s.region === Zone.region(i.zone) &&
              Ipv4.contains(s.ipCidrRange, nic.networkIP),
          ))
      ) {
        return Result.err("Invalid Shared VPC VM interface.");
      }
    }
  }
  for (const f of w.firewallRules) {
    if (
      !Number.isInteger(f.priority) ||
      f.priority < 0 ||
      f.priority > 65535 ||
      [...f.sourceRanges, ...f.destinationRanges].some((c) => !Ipv4.range(c).some) ||
      !validProtocols([...f.allowed, ...f.denied]) ||
      (f.direction === "INGRESS" && f.destinationRanges.length > 0) ||
      (f.direction === "EGRESS" &&
        (f.sourceRanges.length > 0 || (f.sourceServiceAccounts?.length ?? 0) > 0))
    ) {
      return Result.err("Invalid firewall priority, direction, protocol/port or CIDR.");
    }
    if (
      ((f.targetServiceAccounts?.length ?? 0) > 0 || (f.sourceServiceAccounts?.length ?? 0) > 0) &&
      f.targetTags.length > 0
    ) {
      return Result.err(
        "Firewall source/target service accounts cannot combine with target network tags.",
      );
    }
    if (
      [...(f.targetServiceAccounts ?? []), ...(f.sourceServiceAccounts ?? [])].some(
        (email) => !w.serviceAccounts.some((s) => s.email === email),
      )
    ) {
      return Result.err("Unknown firewall service account.");
    }
  }
  if (
    l.checks.some(
      (c) =>
        !Number.isInteger(c.port) ||
        c.port < 1 ||
        c.port > 65535 ||
        !["tcp", "udp", "icmp"].includes(c.protocol) ||
        !w.projects.some((p) => p.projectId === c.projectId) ||
        !Zone.parse(c.zone).some,
    )
  ) {
    return Result.err("Invalid network diagnostic observation.");
  }
  if (l.checks.length > 100 || l.logs.length > 100) {
    return Result.err("Network observation limit exceeded.");
  }
  return Result.ok(w);
};
const ref = { projectId: D.string, name: D.string, region: D.string };
const strings = D.array(D.string);
const rule = D.object<PolicyRule>({
  priority: D.number,
  direction: D.literal(["INGRESS", "EGRESS"]),
  action: D.literal(["allow", "deny"]),
  protocols: D.array(D.object({ protocol: D.string, ports: strings })),
  sourceRanges: strings,
  destinationRanges: strings,
  secureTags: strings,
  logging: D.boolean,
});
export const networkLabDecoder = D.object<NetworkLab>({
  routes: D.array(
    D.object<Route>({
      ...ref,
      network: D.string,
      destination: D.string,
      priority: D.number,
      nextHop: D.string,
      tags: strings,
    }),
  ),
  nats: D.array(
    D.object<Nat>({
      ...ref,
      router: D.string,
      subnets: strings,
      allSubnets: D.boolean,
      logging: D.boolean,
    }),
  ),
  shared: D.array(D.object<SharedVpc>({ host: D.string, services: strings })),
  gateways: D.array(D.object<Gateway>({ ...ref, network: D.string })),
  peerGateways: D.array(D.object<PeerGateway>({ ...ref, interfaces: strings })),
  tunnels: D.array(
    D.object<Tunnel>({
      ...ref,
      gateway: D.string,
      peerGateway: D.string,
      interface: D.number,
      peerInterface: D.number,
      router: D.string,
      state: D.literal(["DOWN", "ESTABLISHED"]),
    }),
  ),
  interfaces: D.array(
    D.object<RouterInterface>({
      ...ref,
      router: D.string,
      tunnel: D.string,
      ip: D.string,
      mask: D.number,
    }),
  ),
  bgpPeers: D.array(
    D.object<BgpPeer>({
      ...ref,
      router: D.string,
      interface: D.string,
      peerIp: D.string,
      peerAsn: D.number,
      remotePrefix: D.string,
      state: D.literal(["DOWN", "UP"]),
    }),
  ),
  attachments: D.array(
    D.object<Attachment>({
      ...ref,
      router: D.string,
      edge: D.literal(["availability-domain-1", "availability-domain-2"]),
      enabled: D.boolean,
      state: D.literal(["PENDING_PARTNER", "ACTIVE"]),
      remotePrefix: D.string,
      peerAsn: D.number,
    }),
  ),
  records: D.array(
    D.object<DnsRecord>({
      ...ref,
      zone: D.string,
      type: D.literal(["A", "CNAME", "TXT"]),
      ttl: D.number,
      data: strings,
    }),
  ),
  secureTags: D.array(
    D.object<SecureTag>({ ...ref, instance: D.string, zone: D.string, tags: strings }),
  ),
  policies: D.array(
    D.object<Policy>({ ...ref, network: D.string, association: D.string, rules: D.array(rule) }),
  ),
  checks: D.array(
    D.object<Check>({
      ...ref,
      zone: D.string,
      destination: D.string,
      destinationProject: D.string,
      destinationZone: D.string,
      protocol: D.string,
      port: D.number,
      allowed: D.boolean,
      reason: D.string,
      dns: D.string,
    }),
  ),
  logs: D.array(
    D.object<NetworkLog>({
      ...ref,
      kind: D.literal(["FLOW", "FIREWALL", "NAT"]),
      source: D.string,
      destination: D.string,
      allowed: D.boolean,
      rule: D.string,
    }),
  ),
});
