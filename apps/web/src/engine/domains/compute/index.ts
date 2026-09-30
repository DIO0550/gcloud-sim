import {
  type MachineTypeName,
  type PublicImage,
  type Region,
  Zone,
} from "@/engine/domains/catalog";
import type { JsonRecord } from "@/types/Json";
import type { ValueOf } from "@/types/ValueOf";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const ComputeBase = "https://www.googleapis.com/compute/v1";

/** `projects/<id>` までの API パス。各リソースの selfLink はここから組む。 */
const projectBase = (projectId: string): string => `${ComputeBase}/projects/${projectId}`;

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

export const ProvisioningModel = {
  /**
   * `--provisioning-model` の綴りを閉じた型にする。
   *
   * @param value ユーザーが打った綴り
   * @returns `STANDARD` / `SPOT` ならそれ。無ければ `none`
   */
  parse(value: string): Option<ProvisioningModel> {
    return Option.fromNullable(Object.values(ProvisioningModels).find((m) => m === value));
  },
} as const;

/**
 * 外部 IP の持ち方。`--no-address` なら `none`、そうでなければエフェメラルで、
 * 停止中はアドレスを解放している（`address` が `none`）。
 */
export type ExternalIp =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "ephemeral"; address: Option<string> }>;

const NoExternalIp: ExternalIp = Object.freeze({ kind: "none" as const });

export const ExternalIp = {
  None: NoExternalIp,

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

export const BootDiskTypes = {
  Standard: "pd-standard",
  Balanced: "pd-balanced",
  Ssd: "pd-ssd",
} as const;
export type BootDiskType = ValueOf<typeof BootDiskTypes>;

export const BootDiskType = {
  /**
   * `--boot-disk-type` の綴りを閉じた型にする。
   *
   * @param value ユーザーが打った綴り
   * @returns 知っている種類ならそれ。無ければ `none`
   */
  parse(value: string): Option<BootDiskType> {
    return Option.fromNullable(Object.values(BootDiskTypes).find((type) => type === value));
  },
} as const;

/** ディスクの大きさ（GB）。`--boot-disk-size` の `10GB` / `1TB` / 単位なしを解釈する。 */
export const DiskSizeGb = {
  parse(value: string): Result<number, string> {
    const match = /^(\d+)(GB|TB)?$/i.exec(value.trim());
    if (match === null) {
      return Result.err(
        `Invalid value for [--boot-disk-size]: ${value}. Expected a size such as 10GB or 1TB.`,
      );
    }
    const amount = Number(match[1]);
    const unit = (match[2] ?? "GB").toUpperCase();
    return Result.ok(unit === "TB" ? amount * 1024 : amount);
  },
} as const;

export type AttachedDisk = Readonly<{
  deviceName: string;
  boot: boolean;
  sizeGb: number;
  type: BootDiskType;
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

/** `Instance.create` に渡す材料。既定値（ブートディスク・スコープ・id）はここでは決めない。 */
export type InstanceSeed = Readonly<{
  projectId: string;
  name: string;
  zone: Zone;
  machineType: MachineTypeName;
  networkInterface: NetworkInterface;
  image: PublicImage;
  bootDisk: Readonly<{ sizeGb: number; type: BootDiskType }>;
  tags: readonly string[];
  serviceAccount: string;
  scopes: readonly string[];
  preemptible: boolean;
  provisioningModel: ProvisioningModel;
  metadata: Readonly<Record<string, string>>;
  creationTimestamp: string;
  /** World の通し番号。id の採番に使う */
  sequence: number;
}>;

/** 状態遷移の種類（設計書 8「Instance の状態」）。 */
export const InstanceTransitions = {
  Start: "start",
  Stop: "stop",
  Suspend: "suspend",
  Resume: "resume",
} as const;
export type InstanceTransition = ValueOf<typeof InstanceTransitions>;

type TransitionRule = Readonly<{
  from: InstanceStatus;
  to: InstanceStatus;
  /** この状態への遷移は冪等に成功扱いにする（本物と同じ） */
  idempotentFrom: InstanceStatus;
}>;

const TransitionRules: Readonly<Record<InstanceTransition, TransitionRule>> = {
  start: { from: "TERMINATED", to: "RUNNING", idempotentFrom: "RUNNING" },
  stop: { from: "RUNNING", to: "TERMINATED", idempotentFrom: "TERMINATED" },
  suspend: { from: "RUNNING", to: "SUSPENDED", idempotentFrom: "SUSPENDED" },
  resume: { from: "SUSPENDED", to: "RUNNING", idempotentFrom: "RUNNING" },
};

/** 遷移の結果。冪等のときは状態を変えない。 */
export type Transitioned =
  | Readonly<{ kind: "changed"; instance: Instance }>
  | Readonly<{ kind: "unchanged"; instance: Instance }>;

const selfLink = (instance: Instance): string =>
  `${projectBase(instance.projectId)}/zones/${instance.zone}/instances/${instance.name}`;

export const Instance = {
  /**
   * 新しいインスタンスを `RUNNING` で作る（UC-003。中間状態は即時通過する）。
   * ブートディスクは 1 つで名前はインスタンス名、id は通し番号から採番する。
   *
   * @param seed 材料
   * @returns 作ったインスタンス。名前の形式が悪ければ理由
   */
  create(seed: InstanceSeed): Result<Instance, string> {
    return Result.map(ResourceName.parse(seed.name), (name) => ({
      projectId: seed.projectId,
      name,
      zone: seed.zone,
      machineType: seed.machineType,
      status: InstanceStatuses.Running,
      networkInterfaces: [seed.networkInterface],
      disks: [
        {
          deviceName: name,
          boot: true,
          sizeGb: seed.bootDisk.sizeGb,
          type: seed.bootDisk.type,
          sourceImage: `projects/${seed.image.project}/global/images/${seed.image.name}`,
        },
      ],
      tags: seed.tags,
      serviceAccount: seed.serviceAccount,
      scopes: seed.scopes,
      preemptible: seed.preemptible,
      provisioningModel: seed.provisioningModel,
      metadata: seed.metadata,
      creationTimestamp: seed.creationTimestamp,
      id: String(4812000000000000000n + BigInt(seed.sequence)),
    }));
  },

  isRunning(instance: Instance): boolean {
    return instance.status === InstanceStatuses.Running;
  },

  /**
   * 状態を遷移させる（設計書 8「Instance の状態」）。外部 IP は停止で解放し、起動で採番し直す。
   *
   * @param instance 元
   * @param transition 遷移の種類
   * @param externalIP 起動時に付ける外部 IP。`--no-address` で作ったものには使わない
   * @returns 遷移後（`changed`）か、既にその状態で冪等に成功したもの（`unchanged`）。
   *   許されない遷移（`SUSPENDED` への stop 等）は今の状態を理由に `err`
   */
  transition(
    instance: Instance,
    transition: InstanceTransition,
    externalIP: string,
  ): Result<Transitioned, InstanceStatus> {
    const rule = TransitionRules[transition];
    if (instance.status === rule.idempotentFrom) return Result.ok({ kind: "unchanged", instance });
    if (instance.status !== rule.from) return Result.err(instance.status);
    const networkInterfaces = instance.networkInterfaces.map((nic): NetworkInterface => {
      if (nic.externalIP.kind === "none") return nic;
      if (rule.to === InstanceStatuses.Terminated) {
        return { ...nic, externalIP: { kind: "ephemeral", address: Option.none } };
      }
      const restores =
        rule.to === InstanceStatuses.Running && !Option.isSome(nic.externalIP.address);
      return restores ? { ...nic, externalIP: ExternalIp.ephemeral(externalIP) } : nic;
    });
    return Result.ok({
      kind: "changed",
      instance: { ...instance, status: rule.to, networkInterfaces },
    });
  },

  region(instance: Instance): Region {
    return Zone.region(instance.zone);
  },

  selfLink,

  /** `--format=json` / `describe` に出す API 表現。 */
  toRecord(instance: Instance): JsonRecord {
    const base = projectBase(instance.projectId);
    return {
      id: instance.id,
      name: instance.name,
      zone: `${base}/zones/${instance.zone}`,
      machineType: `${base}/zones/${instance.zone}/machineTypes/${instance.machineType}`,
      status: instance.status,
      creationTimestamp: instance.creationTimestamp,
      networkInterfaces: instance.networkInterfaces.map((nic) => ({
        network: `${base}/global/networks/${nic.network}`,
        subnetwork: `${base}/regions/${Zone.region(instance.zone)}/subnetworks/${nic.subnetwork}`,
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
  /**
   * ネットワークを作る。名前の形式はここで検証する。
   *
   * @param seed 所有プロジェクト・名前・サブネットモード
   * @returns 作ったネットワーク。名前の形式が悪ければ理由
   */
  create(
    seed: Readonly<{ projectId: string; name: string; subnetMode: SubnetMode }>,
  ): Result<Network, string> {
    return Result.map(ResourceName.parse(seed.name), (name) => ({ ...seed, name }));
  },

  selfLink(network: Network): string {
    return `${projectBase(network.projectId)}/global/networks/${network.name}`;
  },

  toRecord(network: Network): JsonRecord {
    return {
      name: network.name,
      autoCreateSubnetworks: network.subnetMode === SubnetModes.Auto,
      routingConfig: { routingMode: "REGIONAL" },
      selfLink: Network.selfLink(network),
    };
  },
} as const;

export const Subnet = {
  /**
   * サブネットを作る。名前と CIDR の形式はここで検証する。
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
    const validRange = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(seed.ipCidrRange);
    if (!validRange) {
      return Result.err(
        `Invalid value for field 'resource.ipCidrRange': '${seed.ipCidrRange}'. Invalid IPv4 CIDR range.`,
      );
    }
    return Result.map(ResourceName.parse(seed.name), (name) => ({ ...seed, name }));
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
   * @param subnet サブネット。CIDR は `create` が形式を検証済み
   * @param index 0 始まりの通し番号。`.2` から順に振る（`.0` `.1` はネットワーク・ゲートウェイ）
   * @returns `10.146.0.2` のようなアドレス
   */
  hostAddress(subnet: Subnet, index: number): string {
    const octets = subnet.ipCidrRange.split("/")[0]?.split(".").map(Number) ?? [];
    const host = 2 + index;
    const third = (octets[2] ?? 0) + Math.floor(host / 256);
    return `${octets[0] ?? 0}.${octets[1] ?? 0}.${third}.${host % 256}`;
  },

  selfLink(subnet: Subnet): string {
    return `${projectBase(subnet.projectId)}/regions/${subnet.region}/subnetworks/${subnet.name}`;
  },

  toRecord(subnet: Subnet): JsonRecord {
    const base = projectBase(subnet.projectId);
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

export const Direction = {
  /**
   * `--direction` の綴りを閉じた型にする。
   *
   * @param value ユーザーが打った綴り
   * @returns `INGRESS` / `EGRESS` ならそれ。無ければ `none`
   */
  parse(value: string): Option<Direction> {
    return Option.fromNullable(Object.values(Directions).find((d) => d === value));
  },
} as const;

export const FirewallActions = {
  Allow: "ALLOW",
  Deny: "DENY",
} as const;
export type FirewallAction = ValueOf<typeof FirewallActions>;

export const FirewallAction = {
  /**
   * `--action` の綴りを閉じた型にする。
   *
   * @param value ユーザーが打った綴り
   * @returns `ALLOW` / `DENY` ならそれ。無ければ `none`
   */
  parse(value: string): Option<FirewallAction> {
    return Option.fromNullable(Object.values(FirewallActions).find((a) => a === value));
  },
} as const;

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
  destinationRanges: readonly string[];
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

/** `FirewallRule.create` に渡す材料。省いた値（既定値）は `Option` / 空で受ける。 */
export type FirewallRuleSeed = Readonly<{
  projectId: string;
  name: string;
  network: string;
  direction: Direction;
  priority: Option<number>;
  sourceRanges: readonly string[];
  destinationRanges: readonly string[];
  targetTags: readonly string[];
  rules: readonly ProtocolRule[];
  action: FirewallAction;
  disabled: boolean;
}>;

export const FirewallRule = {
  /**
   * ルールを作る。優先度の既定は 1000、INGRESS で送信元の指定が無ければ `0.0.0.0/0`（本物と同じ）。
   *
   * @param seed 材料
   * @returns 作ったルール。名前の形式が悪ければ理由
   */
  create(seed: FirewallRuleSeed): Result<FirewallRule, string> {
    const isIngress = seed.direction === Directions.Ingress;
    const sourceRanges =
      isIngress && seed.sourceRanges.length === 0
        ? ["0.0.0.0/0"]
        : isIngress
          ? seed.sourceRanges
          : [];
    return Result.map(ResourceName.parse(seed.name), (name) => ({
      projectId: seed.projectId,
      name,
      network: seed.network,
      direction: seed.direction,
      priority: Option.unwrapOr(seed.priority, 1000),
      sourceRanges,
      destinationRanges: isIngress ? [] : seed.destinationRanges,
      targetTags: seed.targetTags,
      allowed: seed.action === FirewallActions.Allow ? seed.rules : [],
      denied: seed.action === FirewallActions.Deny ? seed.rules : [],
      disabled: seed.disabled,
    }));
  },

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

  selfLink(rule: FirewallRule): string {
    return `${projectBase(rule.projectId)}/global/firewalls/${rule.name}`;
  },

  toRecord(rule: FirewallRule): JsonRecord {
    return {
      name: rule.name,
      network: `${projectBase(rule.projectId)}/global/networks/${rule.network}`,
      direction: rule.direction,
      priority: rule.priority,
      sourceRanges: rule.sourceRanges,
      destinationRanges: rule.destinationRanges,
      targetTags: rule.targetTags,
      allowed: rule.allowed.map((r) => ({ IPProtocol: r.protocol, ports: r.ports })),
      denied: rule.denied.map((r) => ({ IPProtocol: r.protocol, ports: r.ports })),
      disabled: rule.disabled,
      selfLink: FirewallRule.selfLink(rule),
    };
  },
} as const;

/** ディスクのスナップショット（`gcloud compute snapshots`）。export 用の Snapshot とは別物。 */
export type DiskSnapshot = Readonly<{
  projectId: string;
  name: string;
  sourceDisk: string;
  sourceZone: Zone;
  diskSizeGb: number;
  creationTimestamp: string;
}>;

export const DiskSnapshot = {
  create(
    seed: Readonly<{
      projectId: string;
      name: string;
      sourceDisk: string;
      sourceZone: Zone;
      diskSizeGb: number;
      creationTimestamp: string;
    }>,
  ): Result<DiskSnapshot, string> {
    return Result.map(ResourceName.parse(seed.name), (name) => ({ ...seed, name }));
  },

  selfLink(snapshot: DiskSnapshot): string {
    return `${projectBase(snapshot.projectId)}/global/snapshots/${snapshot.name}`;
  },

  /** 元ディスクの selfLink。オペレーションの対象に使う。 */
  sourceDiskLink(snapshot: DiskSnapshot): string {
    return `${projectBase(snapshot.projectId)}/zones/${snapshot.sourceZone}/disks/${snapshot.sourceDisk}`;
  },

  toRecord(snapshot: DiskSnapshot): JsonRecord {
    return {
      name: snapshot.name,
      sourceDisk: DiskSnapshot.sourceDiskLink(snapshot),
      diskSizeGb: String(snapshot.diskSizeGb),
      status: "READY",
      creationTimestamp: snapshot.creationTimestamp,
    };
  },
} as const;
