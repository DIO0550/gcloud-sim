import { Zone } from "@/engine/domains/catalog";
import type { GkeCluster } from "@/engine/domains/managed-services";
import type { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

export type ControlPlaneEndpoint = "public" | "private";
export type GkePrivateNetwork = Readonly<{
  network: string;
  subnetwork: string;
  masterIpv4Cidr: string;
}>;
export type ControlPlaneSource = Readonly<{
  endpoint: ControlPlaneEndpoint;
  sourceIp: string;
  sourceNetwork: string;
}>;
export type ControlPlaneCheck = ControlPlaneSource & Readonly<{ allowed: boolean; reason: string }>;
export type GkeControlPlane = Readonly<{
  privateNetwork: Option<GkePrivateNetwork>;
  privateEndpoint: boolean;
  authorizedNetworks: Option<readonly string[]>;
  enforcePrivateEndpoint: boolean;
  lastCheck: Option<ControlPlaneCheck>;
}>;

/** IPv4の範囲計算。符号付きbit演算を避け、/0と上位octetも同じ規則で扱う。 */
export const Ipv4 = {
  address(value: string): Option<number> {
    if (!/^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(value)) return Option.none;
    const octets = value.split(".").map(Number);
    if (octets.some((n) => n > 255)) return Option.none;
    return Option.some(octets.reduce((ip, n) => ip * 256 + n, 0));
  },
  range(value: string): Option<Readonly<{ start: number; size: number; prefix: number }>> {
    const parts = value.split("/");
    if (parts.length !== 2 || !/^(0|[1-9]\d?)$/.test(parts[1] ?? "")) return Option.none;
    const prefix = Number(parts[1]);
    const ip = Ipv4.address(parts[0] ?? "");
    if (prefix > 32 || !Option.isSome(ip)) return Option.none;
    const size = 2 ** (32 - prefix);
    if (ip.value % size !== 0) return Option.none;
    return Option.some({ start: ip.value, size, prefix });
  },
  contains(cidr: string, ip: string): boolean {
    const range = Ipv4.range(cidr);
    const address = Ipv4.address(ip);
    return (
      Option.isSome(range) &&
      Option.isSome(address) &&
      address.value >= range.value.start &&
      address.value < range.value.start + range.value.size
    );
  },
  overlaps(a: string, b: string): boolean {
    const x = Ipv4.range(a);
    const y = Ipv4.range(b);
    return (
      Option.isSome(x) &&
      Option.isSome(y) &&
      x.value.start < y.value.start + y.value.size &&
      y.value.start < x.value.start + x.value.size
    );
  },
  format(ip: number): string {
    return [24, 16, 8, 0].map((shift) => Math.floor(ip / 2 ** shift) % 256).join(".");
  },
} as const;

const regionOf = (cluster: GkeCluster): string => {
  const zone = Zone.parse(cluster.location);
  return Option.isSome(zone) ? Zone.region(zone.value) : cluster.location;
};

export const GkeControlPlane = {
  public(): GkeControlPlane {
    return {
      privateNetwork: Option.none,
      privateEndpoint: false,
      authorizedNetworks: Option.none,
      enforcePrivateEndpoint: false,
      lastCheck: Option.none,
    };
  },
  valid(config: GkeControlPlane): boolean {
    const privateNetwork = config.privateNetwork;
    if (config.privateEndpoint && !Option.isSome(privateNetwork)) return false;
    if (
      config.enforcePrivateEndpoint &&
      (!Option.isSome(privateNetwork) || !Option.isSome(config.authorizedNetworks))
    )
      return false;
    if (Option.isSome(privateNetwork)) {
      const range = Ipv4.range(privateNetwork.value.masterIpv4Cidr);
      if (!Option.isSome(range) || range.value.prefix !== 28) return false;
    }
    if (!Option.isSome(config.authorizedNetworks)) return true;
    const ranges = config.authorizedNetworks.value;
    return (
      ranges.length <= (Option.isSome(privateNetwork) ? 100 : 50) &&
      new Set(ranges).size === ranges.length &&
      ranges.every((range) => Option.isSome(Ipv4.range(range)))
    );
  },
  privateIp(config: GkeControlPlane): Option<string> {
    return Option.flatMap(config.privateNetwork, (n) =>
      Option.map(Ipv4.range(n.masterIpv4Cidr), (r) => Ipv4.format(r.start + 2)),
    );
  },
  endpoint(config: GkeControlPlane, endpoint: ControlPlaneEndpoint): Option<string> {
    return endpoint === "private"
      ? GkeControlPlane.privateIp(config)
      : config.privateEndpoint
        ? Option.none
        : Option.some("34.85.0.1");
  },
  /** 明示した送信元に対する教材上の到達条件。認証・RBAC・実通信の成功を意味しない。 */
  evaluate(world: World, cluster: GkeCluster, source: ControlPlaneSource): ControlPlaneCheck {
    const config = cluster.controlPlane;
    const denied = (reason: string): ControlPlaneCheck => ({ ...source, allowed: false, reason });
    if (!Option.isSome(GkeControlPlane.endpoint(config, source.endpoint)))
      return denied("endpoint-disabled");
    const privateNetwork = config.privateNetwork;
    const sameVpc =
      Option.isSome(privateNetwork) &&
      source.sourceNetwork === privateNetwork.value.network &&
      world.subnets.some(
        (s) =>
          s.projectId === cluster.projectId &&
          s.network === source.sourceNetwork &&
          s.region === regionOf(cluster) &&
          Ipv4.contains(s.ipCidrRange, source.sourceIp),
      );
    if (source.endpoint === "private" && !sameVpc) return denied("no-same-region-vpc-route");
    const restricted =
      Option.isSome(config.authorizedNetworks) &&
      (source.endpoint === "public" || config.enforcePrivateEndpoint);
    // 内部endpointへ強制する場合は自動のVPC許可より明示CIDRを優先する。
    const implicitVpc = sameVpc && (source.endpoint === "public" || !config.enforcePrivateEndpoint);
    if (
      restricted &&
      !implicitVpc &&
      !Option.unwrapOr(config.authorizedNetworks, []).some((cidr) =>
        Ipv4.contains(cidr, source.sourceIp),
      )
    )
      return denied("source-not-authorized");
    return {
      ...source,
      allowed: true,
      reason:
        restricted && !implicitVpc
          ? "authorized-cidr"
          : sameVpc
            ? "same-region-vpc"
            : "public-endpoint",
    };
  },
  validate(world: World, cluster: GkeCluster): Result<GkeCluster, string> {
    const config = cluster.controlPlane;
    if (!GkeControlPlane.valid(config))
      return Result.err("Invalid GKE control plane configuration.");
    if (Option.isSome(config.privateNetwork)) {
      const n = config.privateNetwork.value;
      const subnet = world.subnets.find(
        (s) =>
          s.projectId === cluster.projectId &&
          s.name === n.subnetwork &&
          s.network === n.network &&
          s.region === regionOf(cluster),
      );
      if (
        !world.networks.some((v) => v.projectId === cluster.projectId && v.name === n.network) ||
        !subnet
      )
        return Result.err(
          "Private cluster requires an existing network and subnetwork in the cluster region/project.",
        );
      if (!Option.isSome(Ipv4.range(subnet.ipCidrRange)))
        return Result.err("Private cluster subnet must have a canonical IPv4 CIDR.");
      if (
        world.subnets.some(
          (s) =>
            s.projectId === cluster.projectId &&
            s.network === n.network &&
            Ipv4.overlaps(s.ipCidrRange, n.masterIpv4Cidr),
        )
      )
        return Result.err("master-ipv4-cidr overlaps a subnet in the cluster VPC.");
      if (
        world.clusters.some(
          (c) =>
            c.projectId === cluster.projectId &&
            c.name !== cluster.name &&
            Option.isSome(c.controlPlane.privateNetwork) &&
            c.controlPlane.privateNetwork.value.network === n.network &&
            Ipv4.overlaps(c.controlPlane.privateNetwork.value.masterIpv4Cidr, n.masterIpv4Cidr),
        )
      )
        return Result.err("master-ipv4-cidr overlaps another cluster in the VPC.");
    }
    if (Option.isSome(config.lastCheck)) {
      const check = config.lastCheck.value;
      if (
        !Option.isSome(Ipv4.address(check.sourceIp)) ||
        (check.sourceNetwork !== "" &&
          !world.networks.some(
            (n) => n.projectId === cluster.projectId && n.name === check.sourceNetwork,
          ))
      )
        return Result.err("Invalid GKE control plane source.");
      const current = GkeControlPlane.evaluate(world, cluster, check);
      if (check.allowed !== current.allowed || check.reason !== current.reason)
        return Result.err("Stale GKE control plane check.");
    }
    return Result.ok(cluster);
  },
} as const;
