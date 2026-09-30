import { type MachineTypeName, type Region, Zone } from "@/engine/domains/catalog";
import type { JsonRecord } from "@/types/Json";
import type { ValueOf } from "@/types/ValueOf";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

/** Compute Engine のリソース名（RFC1035: 1〜63 文字、小文字英字始まり、`[a-z0-9-]`、末尾ハイフン不可）。 */
export const ResourceName = {
  parse(value: string): Result<string, string> {
    const valid = /^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/.test(value);
    return valid
      ? Result.ok(value)
      : Result.err(
          `Invalid value for field 'resource.name': '${value}'. Must be a match of regex '(?:[a-z](?:[-a-z0-9]{0,61}[a-z0-9])?)'`,
        );
  },
} as const;

export const InstanceStatuses = {
  Running: "RUNNING",
  Terminated: "TERMINATED",
  Suspended: "SUSPENDED",
} as const;
export type InstanceStatus = ValueOf<typeof InstanceStatuses>;

export const ProvisioningModels = {
  Standard: "STANDARD",
  Spot: "SPOT",
} as const;
export type ProvisioningModel = ValueOf<typeof ProvisioningModels>;

/**
 * 外部 IP の持ち方。`--no-address` なら `none`、そうでなければエフェメラルで、
 * 停止中はアドレスを解放している（`address` が `none`）。
 */
export type ExternalIp =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "ephemeral"; address: Option<string> }>;

export const ExternalIp = {
  None: Object.freeze({ kind: "none" }) as ExternalIp,

  ephemeral(address: string): ExternalIp {
    return { kind: "ephemeral", address: Option.some(address) };
  },

  /** 今付いているアドレス。`none` 種別でも解放中でも `none`。 */
  address(ip: ExternalIp): Option<string> {
    return ip.kind === "ephemeral" ? ip.address : Option.none;
  },
} as const;

export type NetworkInterface = Readonly<{
  network: string;
  subnetwork: string;
  networkIP: string;
  externalIP: ExternalIp;
}>;

export type AttachedDisk = Readonly<{
  deviceName: string;
  boot: boolean;
  sizeGb: number;
  type: string;
  sourceImage: string;
}>;

export type Instance = Readonly<{
  projectId: string;
  name: string;
  zone: Zone;
  machineType: MachineTypeName;
  status: InstanceStatus;
  networkInterfaces: readonly NetworkInterface[];
  disks: readonly AttachedDisk[];
  tags: readonly string[];
  serviceAccount: string;
  scopes: readonly string[];
  preemptible: boolean;
  provisioningModel: ProvisioningModel;
  metadata: Readonly<Record<string, string>>;
  creationTimestamp: string;
  id: string;
}>;

/** `--scopes` を省いたときに付く既定のスコープ（本物と同じ 6 件）。 */
export const DefaultScopes: readonly string[] = [
  "https://www.googleapis.com/auth/devstorage.read_only",
  "https://www.googleapis.com/auth/logging.write",
  "https://www.googleapis.com/auth/monitoring.write",
  "https://www.googleapis.com/auth/servicecontrol",
  "https://www.googleapis.com/auth/service.management.readonly",
  "https://www.googleapis.com/auth/trace.append",
];

const ScopeAliases: Readonly<Record<string, string>> = {
  "cloud-platform": "https://www.googleapis.com/auth/cloud-platform",
  "storage-ro": "https://www.googleapis.com/auth/devstorage.read_only",
  "storage-rw": "https://www.googleapis.com/auth/devstorage.read_write",
  "storage-full": "https://www.googleapis.com/auth/devstorage.full_control",
  "logging-write": "https://www.googleapis.com/auth/logging.write",
  "monitoring-write": "https://www.googleapis.com/auth/monitoring.write",
  monitoring: "https://www.googleapis.com/auth/monitoring",
  "compute-ro": "https://www.googleapis.com/auth/compute.readonly",
  "compute-rw": "https://www.googleapis.com/auth/compute",
  bigquery: "https://www.googleapis.com/auth/bigquery",
  pubsub: "https://www.googleapis.com/auth/pubsub",
  "sql-admin": "https://www.googleapis.com/auth/sqlservice.admin",
  "userinfo-email": "https://www.googleapis.com/auth/userinfo.email",
  trace: "https://www.googleapis.com/auth/trace.append",
  "service-control": "https://www.googleapis.com/auth/servicecontrol",
  "service-management": "https://www.googleapis.com/auth/service.management.readonly",
};

export const Scope = {
  /**
   * `--scopes` の 1 項目を URL に正規化する。`default` は既定の 6 件に展開する。
   *
   * @param value 別名（`cloud-platform`）か URL
   * @returns 展開後の URL の並び
   */
  expand(value: string): readonly string[] {
    if (value === "default") return DefaultScopes;
    const alias = ScopeAliases[value];
    if (alias !== undefined) return [alias];
    return [value];
  },
} as const;

const selfLink = (instance: Instance): string =>
  `https://www.googleapis.com/compute/v1/projects/${instance.projectId}/zones/${instance.zone}/instances/${instance.name}`;

export const Instance = {
  isRunning(instance: Instance): boolean {
    return instance.status === InstanceStatuses.Running;
  },

  /**
   * 状態を変える。外部 IP は停止で解放し、起動で採番し直す（設計書 8「Instance の状態」）。
   *
   * @param instance 元
   * @param status 次の状態
   * @param externalIP 起動時に付ける外部 IP。元が外部 IP を持っていなかった（`--no-address`）なら使わない
   * @returns 状態と外部 IP を更新したインスタンス
   */
  withStatus(instance: Instance, status: InstanceStatus, externalIP: string): Instance {
    const networkInterfaces = instance.networkInterfaces.map((nic): NetworkInterface => {
      if (nic.externalIP.kind === "none") return nic;
      if (status === InstanceStatuses.Terminated)
        return { ...nic, externalIP: { kind: "ephemeral", address: Option.none } };
      const restores =
        status === InstanceStatuses.Running && !Option.isSome(nic.externalIP.address);
      return restores ? { ...nic, externalIP: ExternalIp.ephemeral(externalIP) } : nic;
    });
    return { ...instance, status, networkInterfaces };
  },

  region(instance: Instance): Region {
    return Zone.regionOf(instance.zone);
  },

  selfLink,

  /** `--format=json` / `describe` に出す API 表現。 */
  toRecord(instance: Instance): JsonRecord {
    const base = `https://www.googleapis.com/compute/v1/projects/${instance.projectId}`;
    return {
      id: instance.id,
      name: instance.name,
      zone: `${base}/zones/${instance.zone}`,
      machineType: `${base}/zones/${instance.zone}/machineTypes/${instance.machineType}`,
      status: instance.status,
      creationTimestamp: instance.creationTimestamp,
      networkInterfaces: instance.networkInterfaces.map((nic) => ({
        network: `${base}/global/networks/${nic.network}`,
        subnetwork: `${base}/regions/${Zone.regionOf(instance.zone)}/subnetworks/${nic.subnetwork}`,
        networkIP: nic.networkIP,
        accessConfigs: Option.isSome(ExternalIp.address(nic.externalIP))
          ? [
              {
                type: "ONE_TO_ONE_NAT",
                name: "external-nat",
                natIP: Option.unwrapOr(ExternalIp.address(nic.externalIP), ""),
              },
            ]
          : [],
      })),
      disks: instance.disks.map((disk) => ({
        deviceName: disk.deviceName,
        boot: disk.boot,
        diskSizeGb: String(disk.sizeGb),
        type: "PERSISTENT",
        source: `${base}/zones/${instance.zone}/disks/${disk.deviceName}`,
      })),
      tags: { items: instance.tags },
      serviceAccounts: [{ email: instance.serviceAccount, scopes: instance.scopes }],
      scheduling: {
        preemptible: instance.preemptible,
        provisioningModel: instance.provisioningModel,
        automaticRestart: !instance.preemptible && instance.provisioningModel === "STANDARD",
      },
      metadata: {
        items: Object.entries(instance.metadata).map(([key, value]) => ({ key, value })),
      },
      selfLink: selfLink(instance),
    };
  },
} as const;

export const SubnetModes = {
  Auto: "AUTO",
  Custom: "CUSTOM",
} as const;
export type SubnetMode = ValueOf<typeof SubnetModes>;

export type Network = Readonly<{
  projectId: string;
  name: string;
  subnetMode: SubnetMode;
}>;

export type Subnet = Readonly<{
  projectId: string;
  name: string;
  region: Region;
  network: string;
  ipCidrRange: string;
  privateIpGoogleAccess: boolean;
}>;

/** auto モードのネットワークがリージョンごとに持つ範囲（本物の `default` ネットワークと同じ）。 */
const AutoSubnetRanges: Readonly<Record<Region, string>> = {
  "asia-northeast1": "10.146.0.0/20",
  "asia-northeast2": "10.174.0.0/20",
  "us-central1": "10.128.0.0/20",
  "us-east1": "10.142.0.0/20",
  "europe-west1": "10.132.0.0/20",
};

export const Network = {
  toRecord(network: Network): JsonRecord {
    return {
      name: network.name,
      autoCreateSubnetworks: network.subnetMode === SubnetModes.Auto,
      routingConfig: { routingMode: "REGIONAL" },
      selfLink: `https://www.googleapis.com/compute/v1/projects/${network.projectId}/global/networks/${network.name}`,
    };
  },
} as const;

export const Subnet = {
  /**
   * サブネットを作る。CIDR の形式はここで検証する。
   *
   * @param seed 名前・リージョン・ネットワーク・CIDR
   * @returns CIDR が `a.b.c.d/n` なら作ったサブネット。それ以外は理由
   */
  create(
    seed: Readonly<{
      projectId: string;
      name: string;
      region: Region;
      network: string;
      ipCidrRange: string;
      privateIpGoogleAccess: boolean;
    }>,
  ): Result<Subnet, string> {
    const valid = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(seed.ipCidrRange);
    return valid
      ? Result.ok({ ...seed })
      : Result.err(
          `Invalid value for field 'resource.ipCidrRange': '${seed.ipCidrRange}'. Invalid IPv4 CIDR range.`,
        );
  },

  /**
   * auto モードのネットワークが各リージョンに自動で持つサブネット（本物の `default` と同じ範囲）。
   *
   * @param projectId 所有プロジェクト
   * @param network ネットワーク名
   * @param regions 作るリージョン
   * @returns リージョンごとに 1 つずつ
   */
  autoRange(projectId: string, network: string, regions: readonly Region[]): readonly Subnet[] {
    return regions.map((region) => ({
      projectId,
      name: network,
      region,
      network,
      ipCidrRange: AutoSubnetRanges[region],
      privateIpGoogleAccess: false,
    }));
  },

  /**
   * サブネットの CIDR から n 番目のホストアドレスを取る（内部 IP の採番）。
   *
   * @param subnet サブネット
   * @param index 0 始まりの通し番号。`.2` から順に振る（`.0` `.1` はネットワーク・ゲートウェイ）
   * @returns `10.146.0.2` のようなアドレス
   */
  hostAddress(subnet: Subnet, index: number): string {
    const [base] = subnet.ipCidrRange.split("/");
    const octets = (base ?? "0.0.0.0").split(".").map((o) => Number(o));
    const host = 2 + index;
    const third = (octets[2] ?? 0) + Math.floor(host / 256);
    return `${octets[0]}.${octets[1]}.${third}.${host % 256}`;
  },

  toRecord(subnet: Subnet): JsonRecord {
    const base = `https://www.googleapis.com/compute/v1/projects/${subnet.projectId}`;
    return {
      name: subnet.name,
      region: `${base}/regions/${subnet.region}`,
      network: `${base}/global/networks/${subnet.network}`,
      ipCidrRange: subnet.ipCidrRange,
      privateIpGoogleAccess: subnet.privateIpGoogleAccess,
      gatewayAddress: Subnet.hostAddress(subnet, -1),
    };
  },
} as const;

export const Directions = {
  Ingress: "INGRESS",
  Egress: "EGRESS",
} as const;
export type Direction = ValueOf<typeof Directions>;

export type ProtocolRule = Readonly<{
  protocol: string;
  ports: readonly string[];
}>;

export type FirewallRule = Readonly<{
  projectId: string;
  name: string;
  network: string;
  direction: Direction;
  priority: number;
  sourceRanges: readonly string[];
  targetTags: readonly string[];
  allowed: readonly ProtocolRule[];
  denied: readonly ProtocolRule[];
  disabled: boolean;
}>;

export const ProtocolRule = {
  /**
   * `--allow=tcp:80,tcp:443,icmp` の 1 項目を解釈する。
   *
   * @param value `tcp:80` / `tcp:8000-8080` / `icmp` / `all`
   * @returns プロトコルとポート。ポート無しはプロトコル全体
   */
  parse(value: string): Result<ProtocolRule, string> {
    const [protocol, ports] = value.split(":");
    const isKnown =
      protocol !== undefined && /^(tcp|udp|icmp|esp|ah|sctp|ipip|all)$/.test(protocol);
    if (!isKnown) {
      return Result.err(`Invalid value for [--allow]: ${value}. Expected PROTOCOL[:PORT[-PORT]].`);
    }
    return Result.ok({ protocol, ports: ports === undefined || ports === "" ? [] : [ports] });
  },

  /** `tcp:80` の綴りに戻す。 */
  toText(rule: ProtocolRule): string {
    return rule.ports.length === 0 ? rule.protocol : `${rule.protocol}:${rule.ports.join(",")}`;
  },
} as const;

export const FirewallRule = {
  /**
   * インスタンスにこのルールが適用されるか。targetTags が空なら全インスタンス。
   *
   * @param rule ルール
   * @param instance インスタンス
   * @returns 同じネットワークで、タグが一致（または無指定）なら真
   */
  appliesTo(rule: FirewallRule, instance: Instance): boolean {
    const sameNetwork = instance.networkInterfaces.some((nic) => nic.network === rule.network);
    const tagMatches =
      rule.targetTags.length === 0 || rule.targetTags.some((tag) => instance.tags.includes(tag));
    return sameNetwork && tagMatches;
  },

  toRecord(rule: FirewallRule): JsonRecord {
    return {
      name: rule.name,
      network: `https://www.googleapis.com/compute/v1/projects/${rule.projectId}/global/networks/${rule.network}`,
      direction: rule.direction,
      priority: rule.priority,
      sourceRanges: rule.sourceRanges,
      targetTags: rule.targetTags,
      allowed: rule.allowed.map((r) => ({ IPProtocol: r.protocol, ports: r.ports })),
      denied: rule.denied.map((r) => ({ IPProtocol: r.protocol, ports: r.ports })),
      disabled: rule.disabled,
    };
  },
} as const;

export type Snapshot = Readonly<{
  projectId: string;
  name: string;
  sourceDisk: string;
  sourceZone: Zone;
  diskSizeGb: number;
  creationTimestamp: string;
}>;

export const Snapshot = {
  toRecord(snapshot: Snapshot): JsonRecord {
    return {
      name: snapshot.name,
      sourceDisk: `https://www.googleapis.com/compute/v1/projects/${snapshot.projectId}/zones/${snapshot.sourceZone}/disks/${snapshot.sourceDisk}`,
      diskSizeGb: String(snapshot.diskSizeGb),
      status: "READY",
      creationTimestamp: snapshot.creationTimestamp,
    };
  },
} as const;
