import type { Budget } from "@/engine/domains/billing-budget";
import {
  ApiService,
  BucketLocation,
  FunctionRuntime,
  MachineType,
  PublicImage,
  Region,
  SqlDatabaseVersion,
  SqlTier,
  StorageClass,
  Zone,
} from "@/engine/domains/catalog";
import {
  type AttachedDisk,
  BootDiskType,
  Direction,
  type Disk,
  type DiskSnapshot,
  type ExternalIp,
  type FirewallRule,
  type Instance,
  InstanceStatuses,
  type Network,
  type NetworkInterface,
  type ProjectMetadata,
  type ProtocolRule,
  ProvisioningModel,
  type Subnet,
  SubnetModes,
} from "@/engine/domains/compute";
import {
  type Address,
  AddressType,
  type NetworkPeering,
  type Router,
} from "@/engine/domains/compute-networking";
import { ContainerLab } from "@/engine/domains/container-lab";
import type { OsLoginSshKey, ServiceAccountKey } from "@/engine/domains/credentials";
import type {
  PubsubSubscription,
  PubsubTopic,
  SqlBackup,
  SqlInstance,
} from "@/engine/domains/data";
import type { DmDeployment } from "@/engine/domains/deployment-manager";
import type { DnsManagedZone } from "@/engine/domains/dns";
import {
  ConfigProperty,
  type ConfigValues,
  type GcloudConfig,
} from "@/engine/domains/gcloud-config";
import { type IamBinding, IamMember, type IamPolicy, RoleName } from "@/engine/domains/iam-policy";
import type {
  Autoscaling,
  InstanceTemplate,
  ManagedInstanceGroup,
} from "@/engine/domains/instance-groups";
import type { KmsKeyRing } from "@/engine/domains/kms";
import type { KubeConfig, KubeEnv } from "@/engine/domains/kube-config";
import { type HpaEvaluation, HpaReasons, type KubeHpa } from "@/engine/domains/kube-hpa";
import { KubeLiveness, type LivenessProbe } from "@/engine/domains/kube-liveness";
import type { KubeNamespace } from "@/engine/domains/kube-namespace";
import { KubeReadiness, type ReadinessProbe } from "@/engine/domains/kube-readiness";
import { KubeResources } from "@/engine/domains/kube-resources";
import { KubeStartup, type StartupProbe } from "@/engine/domains/kube-startup";
import {
  type KubeDeployment,
  type KubeService,
  KubeServiceType,
} from "@/engine/domains/kubernetes";
import {
  BackendProtocols,
  type BackendService,
  type ForwardingRule,
  type HealthCheck,
  HealthCheckProtocols,
  type LbScope,
  LoadBalancingSchemes,
} from "@/engine/domains/load-balancing";
import type { CloudRunService, GkeCluster, NodePool } from "@/engine/domains/managed-services";
import { type MissionProgress, MissionStatuses } from "@/engine/domains/mission-progress";
import { AlertPolicy, Dashboard, LogMetric, UptimeCheck } from "@/engine/domains/monitoring";
import type { LogSink } from "@/engine/domains/observability";
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
import type { CustomRole } from "@/engine/domains/role-catalog";
import type {
  AppEngineApp,
  AppVersion,
  CloudFunction,
  FunctionTrigger,
} from "@/engine/domains/serverless";
import type { ServiceAccount } from "@/engine/domains/service-account";
import type { AclEntry, Bucket, LifecycleRule, StorageObject } from "@/engine/domains/storage";
import { type Session, World } from "@/engine/domains/world";
import { EmptyCollections } from "@/engine/initial-world";
import { Mission } from "@/engine/missions";
import { Decoder } from "@/utils/Decoder";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

/**
 * Snapshot の互換性のためのバージョン。World の形を変えたら上げてマイグレーションを足す（DJ-007）。
 * v1 は Phase 1 の集合だけ、v2 は残りのサービスの集合と `session.adc` / `components`・SA のポリシー・
 * バケットのバージョニング / ライフサイクル / ACL・オブジェクトのストレージクラスを持つ。
 * v3 はログ指標・ダッシュボード・アラートポリシー・稼働時間チェックを持つ。
 * v4 はTerraformの仮想ファイル・state・保存planを持つ。
 * v5 はmoduleアドレス・サブディレクトリ・保存planのmoved情報を持つ。
 * v6 はGCS backend・state世代/ロック・移行履歴とplanのbackend revisionを持つ。
 * v7 はDockerのローカル状態とArtifact Registryを持つ。
 * v8 はCloud Build履歴とGKEノードSAを持つ。
 * v9 はDeploymentのrevision/template履歴と個別Podの採番状態を持つ。
 * v10 はConfigMap/Secret、template環境変数と起動済みPodの環境を持つ。
 * v11 はKubernetes仮想ファイルとapply管理キーを持つ。
 * v12 はラベル・selectorとDeploymentごとの仮想Podネットワークを持つ。
 * v13 はコンテナのCPU/メモリrequests・limitsをtemplateと履歴に持つ。
 * v14 はHPAの設定と前回の教材評価を持つ。
 * v15 はreadinessProbeとPodごとの明示した応答の判定を持つ。
 * v16 はlivenessProbeとPod内コンテナの再起動回数・判定を持つ。
 * v17 はstartupProbeと起動判定、probe間で共通の再起動回数を持つ。
 * v18 はカスタムnamespaceと各Kubernetesリソースのnamespaceを持つ。
 * v19 はコンテキストごとの既定namespaceを持つ。
 * v20 はConfigMap/Secretのラベルとapply管理キーを持つ。
 */
export const SchemaVersion = 20;

/** 読める旧バージョン。`migrate` が現行の形に写す（設計書 11.3: 1 つ前から復元できる）。 */
const MigratableVersions = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
] as const;

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
  iamPolicy,
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
  storageClass: D.option(D.parsed(StorageClass.parse, "storage class")),
});

const lifecycleAction: Decoder<LifecycleRule["action"]> = (value, path) =>
  Result.flatMap(
    D.object<{ type: "Delete" | "SetStorageClass" }>({
      type: D.literal(["Delete", "SetStorageClass"]),
    })(value, path),
    (head): Result<LifecycleRule["action"], string> =>
      head.type === "Delete"
        ? Result.ok({ type: "Delete" })
        : Result.map(
            D.object<{ storageClass: string }>({ storageClass: string })(value, path),
            (body) => ({ type: "SetStorageClass", storageClass: body.storageClass }),
          ),
  );

const lifecycleRule = D.object<LifecycleRule>({
  action: lifecycleAction,
  condition: D.object<{ age: number }>({ age: D.number }),
});

const aclEntry = D.object<AclEntry>({
  entity: string,
  role: D.literal(["READER", "WRITER", "OWNER"]),
});

const bucket = D.object<Bucket>({
  projectId: string,
  name: string,
  location: D.parsed(BucketLocation.parse, "bucket location"),
  storageClass: D.parsed(StorageClass.parse, "storage class"),
  uniformBucketLevelAccess: D.boolean,
  publicAccessPrevention: D.boolean,
  versioning: D.boolean,
  lifecycleRules: D.array(lifecycleRule),
  acl: D.array(aclEntry),
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
  nodeServiceAccount: string,
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

const session = D.object<Session>({
  accounts: D.array(principal),
  adc: D.option(principal),
  components: strings,
});

const publicImage = D.object<{ name: string; project: string; family: string }>({
  name: string,
  project: string,
  family: string,
});
const image = D.map(publicImage, (i) =>
  Option.toResult(PublicImage.parseFamily(i.family, i.project), () => `unknown image: ${i.name}`),
);
const bootDisk = D.object<{ sizeGb: number; type: Instance["disks"][number]["type"] }>({
  sizeGb: D.number,
  type: D.parsed(BootDiskType.parse, "disk type"),
});

const disk = D.object<Disk>({
  projectId: string,
  name: string,
  zone,
  sizeGb: D.number,
  type: D.parsed(BootDiskType.parse, "disk type"),
  sourceImage: D.option(string),
  users: strings,
  creationTimestamp: string,
  id: string,
});

const projectMetadata = D.object<ProjectMetadata>({ projectId: string, items: stringMap });

const address = D.object<Address>({
  projectId: string,
  name: string,
  region: D.option(region),
  address: string,
  addressType: D.parsed(AddressType.parse, "address type"),
  status: D.literal(["RESERVED", "IN_USE"]),
  creationTimestamp: string,
});

const router = D.object<Router>({
  projectId: string,
  name: string,
  region,
  network: string,
  asn: D.number,
});

const peering = D.object<NetworkPeering>({
  projectId: string,
  name: string,
  network: string,
  peerProjectId: string,
  peerNetwork: string,
  state: D.literal(["ACTIVE", "INACTIVE"]),
  exportCustomRoutes: D.boolean,
  importCustomRoutes: D.boolean,
});

const lbScope: Decoder<LbScope> = (value, path) =>
  Result.flatMap(
    D.object<{ kind: "global" | "region" }>({ kind: D.literal(["global", "region"]) })(value, path),
    (head): Result<LbScope, string> =>
      head.kind === "global"
        ? Result.ok({ kind: "global" })
        : Result.map(D.object<{ region: Region }>({ region })(value, path), (body) => ({
            kind: "region",
            region: body.region,
          })),
  );

const healthCheck = D.object<HealthCheck>({
  projectId: string,
  name: string,
  protocol: D.literal(Object.values(HealthCheckProtocols)),
  port: D.number,
  checkIntervalSec: D.number,
  timeoutSec: D.number,
});

const backendService = D.object<BackendService>({
  projectId: string,
  name: string,
  scope: lbScope,
  protocol: D.literal(Object.values(BackendProtocols)),
  loadBalancingScheme: D.literal(Object.values(LoadBalancingSchemes)),
  healthChecks: strings,
  backends: strings,
  timeoutSec: D.number,
});

const forwardingRule = D.object<ForwardingRule>({
  projectId: string,
  name: string,
  scope: lbScope,
  ipAddress: string,
  ipProtocol: D.literal(["TCP", "UDP"]),
  portRange: string,
  loadBalancingScheme: D.literal(Object.values(LoadBalancingSchemes)),
  backendService: string,
  creationTimestamp: string,
});

const instanceTemplate = D.object<InstanceTemplate>({
  projectId: string,
  name: string,
  machineType,
  image,
  bootDisk,
  tags: strings,
  network: string,
  subnet: D.option(string),
  externalIp: D.boolean,
  serviceAccount: D.option(string),
  scopes: strings,
  preemptible: D.boolean,
  provisioningModel: D.parsed(ProvisioningModel.parse, "provisioning model"),
  metadata: stringMap,
  creationTimestamp: string,
});

const autoscaling = D.object<Autoscaling>({
  minReplicas: D.number,
  maxReplicas: D.number,
  targetCpuUtilization: D.number,
  coolDownPeriodSec: D.number,
});

const instanceGroup = D.object<ManagedInstanceGroup>({
  projectId: string,
  name: string,
  location,
  template: string,
  targetSize: D.number,
  baseInstanceName: string,
  instanceNames: strings,
  autoscaling: D.option(autoscaling),
  creationTimestamp: string,
});

const nodePool = D.object<NodePool>({
  projectId: string,
  cluster: string,
  name: string,
  machineType,
  nodeCount: D.number,
  diskSizeGb: D.number,
  version: string,
});

const kubeEnv = D.object<KubeEnv>({
  name: string,
  source: D.literal(["literal", "configmap", "secret"]),
  value: string,
  resource: string,
  key: string,
});
const kubeConfig = D.object<KubeConfig>({
  labels: stringMap,
  lastAppliedLabelKeys: D.array(string),
  lastAppliedKeys: D.array(string),
  projectId: string,
  cluster: string,
  namespace: string,
  kind: D.literal(["configmap", "secret"]),
  name: string,
  data: D.array(D.object({ key: string, value: string })),
  createdAt: string,
});
const kubeResources: Decoder<KubeResources> = (value, path) =>
  Result.mapErr(KubeResources.parse(value), (reason) => `${path}: ${reason}`);
const readinessProbe: Decoder<ReadinessProbe> = (value, path) =>
  Result.mapErr(KubeReadiness.parse(value), (reason) => `${path}: ${reason}`);
const livenessProbe: Decoder<LivenessProbe> = (value, path) =>
  Result.mapErr(KubeLiveness.parse(value), (reason) => `${path}: ${reason}`);
const startupProbe: Decoder<StartupProbe> = (value, path) =>
  Result.mapErr(KubeStartup.parse(value), (reason) => `${path}: ${reason}`);
const kubeDeployment = D.object<KubeDeployment>({
  labels: stringMap,
  selector: stringMap,
  podLabels: stringMap,
  podNetwork: D.number,
  resources: kubeResources,
  readinessProbe: D.option(readinessProbe),
  livenessProbe: D.option(livenessProbe),
  startupProbe: D.option(startupProbe),
  projectId: string,
  cluster: string,
  namespace: string,
  name: string,
  image: string,
  replicas: D.number,
  generation: D.number,
  revision: D.number,
  revisions: D.array(
    D.object({
      revision: D.number,
      templateId: D.number,
      image: string,
      reason: D.literal([
        "create",
        "image",
        "env",
        "resources",
        "readiness",
        "liveness",
        "startup",
        "labels",
        "restart",
        "undo",
        "migrated",
      ]),
      podLabels: stringMap,
      resources: kubeResources,
      readinessProbe: D.option(readinessProbe),
      livenessProbe: D.option(livenessProbe),
      startupProbe: D.option(startupProbe),
      env: D.array(kubeEnv),
    }),
  ),
  env: D.array(kubeEnv),
  podRestarts: D.array(D.object({ podName: string, restarts: D.number })),
  podStartup: D.array(
    D.object({
      podName: string,
      statusCode: D.number,
      failures: D.number,
      restarts: D.number,
      restarted: D.boolean,
      started: D.boolean,
    }),
  ),
  podLiveness: D.array(
    D.object({
      podName: string,
      statusCode: D.number,
      failures: D.number,
      restarts: D.number,
      restarted: D.boolean,
    }),
  ),
  podReadiness: D.array(
    D.object({
      podName: string,
      ready: D.boolean,
      successes: D.number,
      failures: D.number,
      statusCode: D.number,
    }),
  ),
  podEnvironments: D.array(
    D.object({ podName: string, values: D.array(D.object({ name: string, value: string })) }),
  ),
  podIncarnations: D.array(D.number),
  podSequence: D.number,
  createdAt: string,
});

const hpaEvaluation = D.object<HpaEvaluation>({
  evaluatedAt: string,
  cpuMilli: D.number,
  requestMilli: D.number,
  currentReplicas: D.number,
  desiredReplicas: D.number,
  reason: D.literal(HpaReasons),
});
const kubeHpa = D.object<KubeHpa>({
  projectId: string,
  cluster: string,
  namespace: string,
  name: string,
  target: string,
  minReplicas: D.number,
  maxReplicas: D.number,
  targetCpu: D.number,
  createdAt: string,
  lastEvaluation: D.option(hpaEvaluation),
});
const kubeService = D.object<KubeService>({
  projectId: string,
  cluster: string,
  namespace: string,
  name: string,
  type: D.parsed(KubeServiceType.parse, "service type"),
  selector: stringMap,
  labels: stringMap,
  port: D.number,
  targetPort: D.number,
  clusterIp: string,
  externalIp: D.option(string),
  createdAt: string,
});

const functionTrigger: Decoder<FunctionTrigger> = (value, path) =>
  Result.flatMap(
    D.object<{ kind: "http" | "topic" }>({ kind: D.literal(["http", "topic"]) })(value, path),
    (head): Result<FunctionTrigger, string> =>
      head.kind === "http"
        ? Result.ok({ kind: "http" })
        : Result.map(D.object<{ topic: string }>({ topic: string })(value, path), (body) => ({
            kind: "topic",
            topic: body.topic,
          })),
  );

const cloudFunction = D.object<CloudFunction>({
  projectId: string,
  name: string,
  region,
  runtime: D.parsed(FunctionRuntime.parse, "runtime"),
  entryPoint: string,
  trigger: functionTrigger,
  allowUnauthenticated: D.boolean,
  memoryMb: D.number,
  updateTime: string,
  versionId: D.number,
});

const appEngineApp = D.object<AppEngineApp>({ projectId: string, region, createTime: string });

const appVersion = D.object<AppVersion>({
  projectId: string,
  service: string,
  id: string,
  runtime: string,
  trafficSplit: D.number,
  createTime: string,
});

const sqlInstance = D.object<SqlInstance>({
  projectId: string,
  name: string,
  region,
  databaseVersion: D.parsed(SqlDatabaseVersion.parse, "database version"),
  tier: D.parsed(SqlTier.parse, "tier"),
  gceZone: string,
  ipAddress: string,
  state: D.literal(["RUNNABLE"]),
  createTime: string,
});

const sqlBackup = D.object<SqlBackup>({
  projectId: string,
  instance: string,
  id: string,
  description: string,
  status: D.literal(["SUCCESSFUL"]),
  windowStartTime: string,
});

const pubsubTopic = D.object<PubsubTopic>({ projectId: string, name: string, createTime: string });

const pubsubSubscription = D.object<PubsubSubscription>({
  projectId: string,
  name: string,
  topic: string,
  ackDeadlineSeconds: D.number,
  pushEndpoint: D.option(string),
  createTime: string,
});

const logSink = D.object<LogSink>({
  projectId: string,
  name: string,
  destination: string,
  filter: string,
  writerIdentity: string,
  createTime: string,
});

const serviceAccountKey = D.object<ServiceAccountKey>({
  serviceAccountEmail: string,
  keyId: string,
  file: string,
  keyType: D.literal(["USER_MANAGED"]),
  validAfterTime: string,
});

const osLoginKey = D.object<OsLoginSshKey>({
  account: string,
  key: string,
  fingerprint: string,
  expireTime: D.option(string),
});

const kmsLocation = D.map(D.string, (text) =>
  text === "global"
    ? Result.ok<KmsKeyRing["location"]>("global")
    : Option.toResult(Region.parse(text), () => `unknown location: ${text}`),
);

const kmsKeyRing = D.object<KmsKeyRing>({
  projectId: string,
  name: string,
  location: kmsLocation,
  createTime: string,
});

const dnsZone = D.object<DnsManagedZone>({
  projectId: string,
  name: string,
  dnsName: string,
  description: string,
  visibility: D.literal(["public", "private"]),
  nameServers: strings,
  createTime: string,
});

const dmDeployment = D.object<DmDeployment>({
  projectId: string,
  name: string,
  config: string,
  resources: D.array(D.object<{ name: string; type: string }>({ name: string, type: string })),
  insertTime: string,
});

const budget = D.object<Budget>({
  billingAccountId: string,
  name: string,
  displayName: string,
  amount: D.number,
  thresholds: D.array(D.number),
  projectIds: strings,
  createTime: string,
});

const customRole = D.object<CustomRole>({
  projectId: string,
  roleId: string,
  title: string,
  description: string,
  includedPermissions: strings,
  stage: D.literal(["GA", "BETA", "ALPHA", "DISABLED"]),
  etag: string,
});

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
  containerLab: D.map(ContainerLab.decoder, ContainerLab.validate),
  terraform: D.map(TerraformState.decoder, TerraformState.validate),
  networks: D.array(network),
  subnets: D.array(subnet),
  firewallRules: D.array(firewallRule),
  diskSnapshots: D.array(diskSnapshot),
  buckets: D.array(bucket),
  clusters: D.array(cluster),
  runServices: D.array(runService),
  disks: D.array(disk),
  projectMetadata: D.array(projectMetadata),
  addresses: D.array(address),
  routers: D.array(router),
  peerings: D.array(peering),
  healthChecks: D.array(healthCheck),
  backendServices: D.array(backendService),
  forwardingRules: D.array(forwardingRule),
  instanceTemplates: D.array(instanceTemplate),
  instanceGroups: D.array(instanceGroup),
  nodePools: D.array(nodePool),
  kubeNamespaces: D.array(
    D.object<KubeNamespace>({
      projectId: string,
      cluster: string,
      name: string,
      createdAt: string,
    }),
  ),
  kubeDeployments: D.array(kubeDeployment),
  kubeServices: D.array(kubeService),
  kubeHpas: D.array(kubeHpa),
  kubeConfigs: D.array(kubeConfig),
  kubeFiles: D.record(string),
  kubeContextNamespaces: D.record(string),
  functions: D.array(cloudFunction),
  appEngineApps: D.array(appEngineApp),
  appVersions: D.array(appVersion),
  sqlInstances: D.array(sqlInstance),
  sqlBackups: D.array(sqlBackup),
  pubsubTopics: D.array(pubsubTopic),
  pubsubSubscriptions: D.array(pubsubSubscription),
  logSinks: D.array(logSink),
  logMetrics: D.array(LogMetric.decode),
  uptimeChecks: D.array(UptimeCheck.decode),
  alertPolicies: D.array(AlertPolicy.decode),
  dashboards: D.array(Dashboard.decode),
  serviceAccountKeys: D.array(serviceAccountKey),
  osLoginKeys: D.array(osLoginKey),
  kmsKeyRings: D.array(kmsKeyRing),
  dnsZones: D.array(dnsZone),
  dmDeployments: D.array(dmDeployment),
  budgets: D.array(budget),
  customRoles: D.array(customRole),
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

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** v1 に無かったサービスアカウントのポリシーの埋め草（JSON の形のまま）。 */
const EmptyPolicyJson = { bindings: [] };

/**
 * v1 の World の JSON を v2 の形にする。足した集合は空、`session.adc` は無し、
 * サービスアカウントのポリシーは空で埋める。decode はこの後に通すので、ここでは形だけを整える。
 *
 * @param value v1 の `world`
 * @returns v2 の形の値。オブジェクトでなければそのまま（decode が理由を出す）
 */
const migrateV1 = (value: unknown): unknown => {
  if (!isRecord(value)) return value;
  const session = isRecord(value.session)
    ? { adc: { some: false }, components: [], ...value.session }
    : value.session;
  const serviceAccounts = Array.isArray(value.serviceAccounts)
    ? value.serviceAccounts.map((account: unknown) =>
        isRecord(account) ? { iamPolicy: EmptyPolicyJson, ...account } : account,
      )
    : value.serviceAccounts;
  const buckets = Array.isArray(value.buckets)
    ? value.buckets.map((bucket: unknown) =>
        isRecord(bucket)
          ? {
              versioning: false,
              lifecycleRules: [],
              acl: [],
              ...bucket,
              objects: Array.isArray(bucket.objects)
                ? bucket.objects.map((object: unknown) =>
                    isRecord(object) ? { storageClass: { some: false }, ...object } : object,
                  )
                : bucket.objects,
            }
          : bucket,
      )
    : value.buckets;
  return { ...EmptyCollections, ...value, session, serviceAccounts, buckets };
};

const migrateLegacyKubeDeployment = (version: number, value: unknown): unknown => {
  if (!isRecord(value)) return value;
  if (version >= 10) return value;
  if (version >= 9)
    return {
      ...value,
      env: [],
      podEnvironments: [],
      revisions: Array.isArray(value.revisions)
        ? value.revisions.map((r) => (isRecord(r) ? { ...r, env: [] } : r))
        : value.revisions,
    };
  const replicas =
    typeof value.replicas === "number" &&
    Number.isSafeInteger(value.replicas) &&
    value.replicas >= 0 &&
    value.replicas <= 1000
      ? value.replicas
      : 0;
  return {
    ...value,
    env: [],
    podEnvironments: [],
    revision: value.generation,
    podSequence: 0,
    revisions: [
      {
        revision: value.generation,
        templateId: value.generation,
        image: value.image,
        reason: "migrated",
        env: [],
      },
    ],
    podIncarnations: Array.from({ length: replicas }, () => 0),
  };
};

const migrateResourceDeployment = (
  version: number,
  value: unknown,
  podNetwork: number,
): unknown => {
  if (version >= 13) return value;
  const d = migrateLegacyKubeDeployment(version, value);
  if (!isRecord(d)) return d;
  const labels = { app: d.name };
  return {
    ...d,
    ...(version < 12 ? { labels, selector: labels, podLabels: labels, podNetwork } : {}),
    resources: KubeResources.empty(),
    revisions: Array.isArray(d.revisions)
      ? d.revisions.map((r) =>
          isRecord(r)
            ? {
                ...r,
                ...(version < 12 ? { podLabels: labels } : {}),
                resources: KubeResources.empty(),
              }
            : r,
        )
      : d.revisions,
  };
};

const migrateReadinessDeployment = (
  version: number,
  value: unknown,
  podNetwork: number,
): unknown => {
  const d = migrateResourceDeployment(version, value, podNetwork);
  if (version >= 15) return d;
  if (!isRecord(d)) return d;
  return {
    ...d,
    readinessProbe: Option.none,
    podReadiness: [],
    revisions: Array.isArray(d.revisions)
      ? d.revisions.map((r) => (isRecord(r) ? { ...r, readinessProbe: Option.none } : r))
      : d.revisions,
  };
};

const migrateLivenessDeployment = (
  version: number,
  value: unknown,
  podNetwork: number,
): unknown => {
  const d = migrateReadinessDeployment(version, value, podNetwork);
  if (version >= 16) return d;
  if (!isRecord(d)) return d;
  return {
    ...d,
    livenessProbe: Option.none,
    podLiveness: [],
    revisions: Array.isArray(d.revisions)
      ? d.revisions.map((r) => (isRecord(r) ? { ...r, livenessProbe: Option.none } : r))
      : d.revisions,
  };
};

const migrateKubeDeployment = (version: number, value: unknown, podNetwork: number): unknown => {
  const d = migrateLivenessDeployment(version, value, podNetwork);
  if (!isRecord(d) || version >= 17) return d;
  return {
    ...d,
    startupProbe: Option.none,
    podStartup: [],
    podRestarts: Array.isArray(d.podLiveness)
      ? d.podLiveness
          .filter((p) => isRecord(p) && p.restarts !== 0)
          .map((p) => ({ podName: p.podName, restarts: p.restarts }))
      : d.podLiveness,
    revisions: Array.isArray(d.revisions)
      ? d.revisions.map((r) => (isRecord(r) ? { ...r, startupProbe: Option.none } : r))
      : d.revisions,
  };
};

const withDefaultNamespace = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map((r) => (isRecord(r) ? { ...r, namespace: "default" } : r))
    : value;

const withConfigLabels = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map((c) => (isRecord(c) ? { ...c, labels: {}, lastAppliedLabelKeys: [] } : c))
    : value;

const migrate = (version: number, value: unknown): unknown => {
  if (version === SchemaVersion) return value;
  if (version >= 18 && isRecord(value))
    return {
      ...value,
      kubeContextNamespaces: version === 18 ? {} : value.kubeContextNamespaces,
      kubeConfigs: withConfigLabels(value.kubeConfigs),
    };
  const old = version === 1 ? migrateV1(value) : value;
  const networks = new Map<string, number>();
  const previous = isRecord(old)
    ? {
        ...old,
        kubeContextNamespaces: {},
        kubeNamespaces: [],
        kubeFiles: version >= 11 ? old.kubeFiles : {},
        kubeHpas: version >= 14 ? withDefaultNamespace(old.kubeHpas) : [],
        kubeConfigs:
          version >= 11
            ? withConfigLabels(withDefaultNamespace(old.kubeConfigs))
            : version >= 10 && Array.isArray(old.kubeConfigs)
              ? old.kubeConfigs.map((c) =>
                  isRecord(c)
                    ? {
                        ...c,
                        namespace: "default",
                        lastAppliedKeys: [],
                        labels: {},
                        lastAppliedLabelKeys: [],
                      }
                    : c,
                )
              : [],
        kubeDeployments: Array.isArray(old.kubeDeployments)
          ? old.kubeDeployments.map((d) => {
              const key = isRecord(d) ? `${d.projectId}/${d.cluster}` : "";
              const slot = networks.get(key) ?? 0;
              networks.set(key, slot + 1);
              const migrated = migrateKubeDeployment(version, d, slot);
              return isRecord(migrated) ? { ...migrated, namespace: "default" } : migrated;
            })
          : old.kubeDeployments,
        kubeServices: Array.isArray(old.kubeServices)
          ? old.kubeServices.map((s) => {
              if (!isRecord(s)) return s;
              if (version >= 12) return { ...s, namespace: "default" };
              const { targetDeployment, ...rest } = s;
              return {
                ...rest,
                namespace: "default",
                labels: {},
                selector: { app: targetDeployment },
              };
            })
          : old.kubeServices,
        containerLab:
          version >= 8
            ? old.containerLab
            : version === 7
              ? isRecord(old.containerLab)
                ? { ...old.containerLab, builds: [] }
                : old.containerLab
              : ContainerLab.empty(),
        clusters: Array.isArray(old.clusters)
          ? old.clusters.map((c) =>
              isRecord(c) && version < 8 ? { ...c, nodeServiceAccount: "" } : c,
            )
          : old.clusters,
      }
    : old;
  if (!isRecord(previous)) return previous;
  const observed =
    version < 3
      ? { logMetrics: [], uptimeChecks: [], alertPolicies: [], dashboards: [], ...previous }
      : previous;
  if (version >= 6) return observed;
  if (version < 4) return { ...observed, terraform: TerraformState.empty() };
  if (!isRecord(observed.terraform) || !isRecord(observed.terraform.plans)) return observed;
  const plans = Object.fromEntries(
    Object.entries(observed.terraform.plans).map(([name, plan]) => [
      name,
      isRecord(plan)
        ? { ...plan, ...(version === 4 ? { moves: [] } : {}), backendRevision: 0 }
        : plan,
    ]),
  );
  return {
    ...observed,
    terraform: { ...observed.terraform, backend: TerraformState.empty().backend, plans },
  };
};

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
   * schemaVersion を見て、旧バージョン（v1）なら現行の形に写してから、フィールドごとに形を確かめ、不変条件に通す。
   *
   * @param value `JSON.parse` の結果
   * @returns 取り込める World。不正なら理由（E-011）
   */
  fromUnknown(value: unknown): Result<World, ImportFailure> {
    const head = snapshotHead(value, "snapshot");
    if (!Result.isOk(head)) return Result.err({ kind: "malformed", reason: head.error });
    const version = head.value.schemaVersion;
    const readable = version === SchemaVersion || MigratableVersions.some((v) => v === version);
    if (!readable) {
      return Result.err({ kind: "unsupportedVersion", version: String(version) });
    }
    const decoded = Result.mapErr(
      world(migrate(version, head.value.world), "world"),
      (reason): ImportFailure => ({ kind: "malformed", reason }),
    );
    const validated = Result.flatMap(decoded, (w) =>
      Result.mapErr(World.validate(w), (reason): ImportFailure => ({ kind: "invariant", reason })),
    );
    return Result.map(validated, Mission.syncProgress);
  },
} as const;

import { TerraformState } from "@/engine/domains/terraform";
