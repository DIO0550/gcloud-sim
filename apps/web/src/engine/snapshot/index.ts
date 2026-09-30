import {
  ApiService,
  BucketLocation,
  MachineType,
  Region,
  StorageClass,
  Zone,
} from "@/engine/domains/catalog";
import {
  type AttachedDisk,
  BootDiskType,
  Direction,
  type DiskSnapshot,
  type ExternalIp,
  type FirewallRule,
  type Instance,
  InstanceStatuses,
  type Network,
  type NetworkInterface,
  type ProtocolRule,
  ProvisioningModel,
  type Subnet,
  SubnetModes,
} from "@/engine/domains/compute";
import {
  ConfigProperty,
  type ConfigValues,
  type GcloudConfig,
} from "@/engine/domains/gcloud-config";
import { type IamBinding, IamMember, type IamPolicy, RoleName } from "@/engine/domains/iam-policy";
import type { CloudRunService, GkeCluster } from "@/engine/domains/managed-services";
import { type MissionProgress, MissionStatuses } from "@/engine/domains/mission-progress";
import { type Operation, OperationTypes } from "@/engine/domains/operation";
import { Principal } from "@/engine/domains/principal";
import type {
  BillingAccount,
  Folder,
  Organization,
  ParentRef,
  Project,
} from "@/engine/domains/resource-hierarchy";
import { ProjectStates } from "@/engine/domains/resource-hierarchy";
import type { ServiceAccount } from "@/engine/domains/service-account";
import type { Bucket, StorageObject } from "@/engine/domains/storage";
import { type Session, World } from "@/engine/domains/world";
import { Mission } from "@/engine/missions";
import { Decoder } from "@/utils/Decoder";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

/** Snapshot の互換性のためのバージョン。World の形を変えたら上げてマイグレーションを足す（DJ-007）。 */
export const SchemaVersion = 1;

/** export / import で扱う JSON の形（UC-005）。 */
export type Snapshot = Readonly<{
  schemaVersion: typeof SchemaVersion;
  exportedAt: string;
  world: World;
}>;

/** import の失敗（E-011）。既存の状態は変えない。 */
export type ImportFailure =
  | Readonly<{ kind: "malformed"; reason: string }>
  | Readonly<{ kind: "unsupportedVersion"; version: string }>
  | Readonly<{ kind: "invariant"; reason: string }>;

const D = Decoder;

const string = D.string;
const strings = D.array(D.string);
const stringMap = D.record(D.string);

const zone = D.parsed(Zone.parse, "zone");
const region = D.parsed(Region.parse, "region");
const location = D.map(D.string, (text) =>
  Option.toResult(
    Option.or(Zone.parse(text), Region.parse(text)),
    () => `unknown location: ${text}`,
  ),
);
const machineType = D.map(D.parsed(MachineType.parse, "machine type"), (t) => Result.ok(t.name));
const apiName = D.map(D.parsed(ApiService.parse, "API"), (api) => Result.ok(api.name));
const principal = D.validated(Principal.parse);

const iamPolicy: Decoder<IamPolicy> = D.object<IamPolicy>({
  bindings: D.array(
    D.object<IamBinding>({
      role: D.parsed(RoleName.parse, "role name"),
      members: D.array(D.validated(IamMember.parse)),
    }),
  ),
});

const parentRef: Decoder<ParentRef> = (value, path) =>
  Result.flatMap(
    D.object<{ type: "organization" | "folder"; id: string }>({
      type: D.literal(["organization", "folder"]),
      id: string,
    })(value, path),
    (ref): Result<ParentRef, string> =>
      Result.ok(
        ref.type === "organization"
          ? { type: "organization", id: ref.id }
          : { type: "folder", id: ref.id },
      ),
  );

const organization = D.object<Organization>({ id: string, displayName: string, iamPolicy });

const folder = D.object<Folder>({ id: string, displayName: string, parent: parentRef, iamPolicy });

const project = D.object<Project>({
  projectId: string,
  name: string,
  projectNumber: string,
  parent: parentRef,
  lifecycleState: D.literal(Object.values(ProjectStates)),
  billingAccountId: D.option(string),
  enabledApis: D.array(apiName),
  iamPolicy,
  labels: stringMap,
  createTime: string,
});

const billingAccount = D.object<BillingAccount>({
  id: string,
  displayName: string,
  open: D.boolean,
});

const serviceAccount = D.object<ServiceAccount>({
  email: string,
  displayName: string,
  description: string,
  projectId: string,
  uniqueId: string,
});

const externalIp: Decoder<ExternalIp> = (value, path) =>
  Result.flatMap(
    D.object<{ kind: "none" | "ephemeral" }>({ kind: D.literal(["none", "ephemeral"]) })(
      value,
      path,
    ),
    (head): Result<ExternalIp, string> =>
      head.kind === "none"
        ? Result.ok({ kind: "none" })
        : Result.map(
            D.object<{ address: Option<string> }>({ address: D.option(string) })(value, path),
            (body) => ({ kind: "ephemeral", address: body.address }),
          ),
  );

const networkInterface = D.object<NetworkInterface>({
  network: string,
  subnetwork: string,
  networkIP: string,
  externalIP: externalIp,
});

const attachedDisk = D.object<AttachedDisk>({
  deviceName: string,
  boot: D.boolean,
  sizeGb: D.number,
  type: D.parsed(BootDiskType.parse, "disk type"),
  sourceImage: string,
});

const instance = D.object<Instance>({
  projectId: string,
  name: string,
  zone,
  machineType,
  status: D.literal(Object.values(InstanceStatuses)),
  networkInterfaces: D.array(networkInterface),
  disks: D.array(attachedDisk),
  tags: strings,
  serviceAccount: string,
  scopes: strings,
  preemptible: D.boolean,
  provisioningModel: D.parsed(ProvisioningModel.parse, "provisioning model"),
  metadata: stringMap,
  creationTimestamp: string,
  id: string,
});

const network = D.object<Network>({
  projectId: string,
  name: string,
  subnetMode: D.literal(Object.values(SubnetModes)),
});

const subnet = D.object<Subnet>({
  projectId: string,
  name: string,
  region,
  network: string,
  ipCidrRange: string,
  privateIpGoogleAccess: D.boolean,
});

const protocolRule = D.object<ProtocolRule>({ protocol: string, ports: strings });

const firewallRule = D.object<FirewallRule>({
  projectId: string,
  name: string,
  network: string,
  direction: D.parsed(Direction.parse, "direction"),
  priority: D.number,
  sourceRanges: strings,
  destinationRanges: strings,
  targetTags: strings,
  allowed: D.array(protocolRule),
  denied: D.array(protocolRule),
  disabled: D.boolean,
});

const diskSnapshot = D.object<DiskSnapshot>({
  projectId: string,
  name: string,
  sourceDisk: string,
  sourceZone: zone,
  diskSizeGb: D.number,
  creationTimestamp: string,
});

const storageObject = D.object<StorageObject>({
  name: string,
  size: D.number,
  contentType: string,
  updated: string,
});

const bucket = D.object<Bucket>({
  projectId: string,
  name: string,
  location: D.parsed(BucketLocation.parse, "bucket location"),
  storageClass: D.parsed(StorageClass.parse, "storage class"),
  uniformBucketLevelAccess: D.boolean,
  publicAccessPrevention: D.boolean,
  iamPolicy,
  objects: D.array(storageObject),
  timeCreated: string,
});

const cluster = D.object<GkeCluster>({
  projectId: string,
  name: string,
  location,
  nodeCount: D.number,
  autopilot: D.boolean,
  status: D.literal(["RUNNING"]),
  machineType,
  currentMasterVersion: string,
});

const runService = D.object<CloudRunService>({
  projectId: string,
  name: string,
  region,
  image: string,
  allowUnauthenticated: D.boolean,
  lastDeployedAt: string,
});

/** configuration の中身。知らないプロパティは捨てる（プロパティ名が閉じているため）。 */
const configValues: Decoder<ConfigValues> = (value, path) =>
  Result.map(stringMap(value, path), (entries) =>
    Object.fromEntries(
      Object.entries(entries).flatMap(([key, v]) => {
        const property = ConfigProperty.parse(key);
        return Option.isSome(property) && property.value === key ? [[key, v] as const] : [];
      }),
    ),
  );

const config = D.object<GcloudConfig>({
  configurations: D.record(configValues),
  activeConfiguration: string,
});

const session = D.object<Session>({ accounts: D.array(principal) });

const operation = D.object<Operation>({
  id: string,
  name: string,
  projectId: string,
  operationType: D.literal(Object.values(OperationTypes)),
  targetLink: string,
  targetName: string,
  zone: D.option(zone),
  status: D.literal(["DONE"]),
  progress: D.literal([100]),
  insertTime: string,
  endTime: string,
  user: string,
});

const missionProgress = D.object<MissionProgress>({
  id: string,
  status: D.literal(Object.values(MissionStatuses)),
  revealedHints: D.number,
});

/** World の全フィールドを型ごとに確かめる。ここを通った値だけが `World` になる。 */
const world = D.object<World>({
  organization,
  folders: D.array(folder),
  projects: D.array(project),
  billingAccounts: D.array(billingAccount),
  serviceAccounts: D.array(serviceAccount),
  instances: D.array(instance),
  networks: D.array(network),
  subnets: D.array(subnet),
  firewallRules: D.array(firewallRule),
  diskSnapshots: D.array(diskSnapshot),
  buckets: D.array(bucket),
  clusters: D.array(cluster),
  runServices: D.array(runService),
  config,
  session,
  operations: D.array(operation),
  missions: D.array(missionProgress),
  sequence: D.number,
});

const snapshotHead = D.object<{ schemaVersion: number; world: unknown }>({
  schemaVersion: D.number,
  world: (value) => Result.ok(value),
});

export const Snapshot = {
  /**
   * 今の World から Snapshot を作る。
   *
   * @param world 書き出す World
   * @param now 書き出し時刻
   * @returns 現行 schemaVersion の Snapshot
   */
  create(world: World, now: string): Snapshot {
    return { schemaVersion: SchemaVersion, exportedAt: now, world };
  },

  /**
   * ファイル名 `gcloud-sim-snapshot-{YYYYMMDD-HHmm}.json`（UC-005）。
   *
   * @param now 書き出し時刻（ISO）
   * @returns ファイル名
   */
  fileName(now: string): string {
    const d = new Date(now);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `gcloud-sim-snapshot-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
  },

  /**
   * JSON を解釈した値から World を取り出す（UC-005 Import）。
   * schemaVersion を見てからフィールドごとに形を確かめ、不変条件に通す。旧バージョンはまだ無い。
   *
   * @param value `JSON.parse` の結果
   * @returns 取り込める World。不正なら理由（E-011）
   */
  fromUnknown(value: unknown): Result<World, ImportFailure> {
    const head = snapshotHead(value, "snapshot");
    if (!Result.isOk(head)) return Result.err({ kind: "malformed", reason: head.error });
    if (head.value.schemaVersion !== SchemaVersion) {
      return Result.err({ kind: "unsupportedVersion", version: String(head.value.schemaVersion) });
    }
    const decoded = Result.mapErr(
      world(head.value.world, "world"),
      (reason): ImportFailure => ({ kind: "malformed", reason }),
    );
    const validated = Result.flatMap(decoded, (w) =>
      Result.mapErr(World.validate(w), (reason): ImportFailure => ({ kind: "invariant", reason })),
    );
    return Result.map(validated, Mission.syncProgress);
  },
} as const;
