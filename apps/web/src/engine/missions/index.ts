import {
  type ApiName,
  type BucketLocation,
  DefaultImage,
  DefaultMachineType,
  type MachineTypeName,
  type Region,
  type SqlDatabaseVersion,
  SqlDatabaseVersions,
  type StorageClass,
  Zone,
} from "@/engine/domains/catalog";
import {
  BootDiskTypes,
  DefaultScopes,
  ExternalIp,
  Instance,
  type InstanceStatus,
  ProvisioningModels,
  Subnet,
  type SubnetMode,
  SubnetModes,
} from "@/engine/domains/compute";
import { EffectivePermissions } from "@/engine/domains/effective-permissions";
import { type ConfigProperty, GcloudConfig } from "@/engine/domains/gcloud-config";
import { type IamMember, IamPolicy, type RoleName } from "@/engine/domains/iam-policy";
import { ImagePull } from "@/engine/domains/image-pull";
import { type KubeServiceType, KubeServiceTypes } from "@/engine/domains/kubernetes";
import { MissionProgress, MissionStatuses } from "@/engine/domains/mission-progress";
import type { Principal } from "@/engine/domains/principal";
import type { PolicyTarget } from "@/engine/domains/resource-hierarchy";
import type { FunctionTrigger } from "@/engine/domains/serverless";
import { ServiceAccount } from "@/engine/domains/service-account";
import { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import {
  type ArtifactLifecycleAssertion,
  ArtifactLifecycleMissions,
  artifactLifecycleSatisfied,
  ensureContainerCleanupLab,
} from "@/engine/missions/artifact-lifecycle";
import { type BuildAssertion, BuildMissions, buildSatisfied } from "@/engine/missions/builds";
import {
  type ContainerReleaseAssertion,
  ContainerReleaseMissions,
  containerReleaseSatisfied,
} from "@/engine/missions/container-release";
import {
  type ContainerAssertion,
  ContainerMissions,
  containerSatisfied,
} from "@/engine/missions/containers";
import {
  type KubeBinaryDataAssertion,
  KubeBinaryDataMissions,
  kubeBinaryDataSatisfied,
} from "@/engine/missions/kube-binary-data";
import {
  type KubeConfigLabelsAssertion,
  KubeConfigLabelsMissions,
  kubeConfigLabelsSatisfied,
} from "@/engine/missions/kube-config-labels";
import {
  type KubeContextAssertion,
  KubeContextMissions,
  kubeContextSatisfied,
} from "@/engine/missions/kube-context";
import {
  type KubeHpaAssertion,
  KubeHpaMissions,
  kubeHpaSatisfied,
} from "@/engine/missions/kube-hpa";
import {
  type KubeHpaManifestAssertion,
  KubeHpaManifestMissions,
  kubeHpaManifestSatisfied,
} from "@/engine/missions/kube-hpa-manifests";
import {
  type KubeImmutableAssertion,
  KubeImmutableMissions,
  kubeImmutableSatisfied,
} from "@/engine/missions/kube-immutable";
import {
  type KubeNamespaceAssertion,
  KubeNamespaceMissions,
  kubeNamespaceSatisfied,
} from "@/engine/missions/kube-namespace";
import {
  type KubeVolumesAssertion,
  KubeVolumesMissions,
  kubeVolumesSatisfied,
} from "@/engine/missions/kube-volumes";
import {
  type KubernetesAssertion,
  KubernetesMissions,
  kubernetesSatisfied,
} from "@/engine/missions/kubernetes";
import {
  type ObservabilityAssertion,
  ObservabilityMissions,
  observabilitySatisfied,
} from "@/engine/missions/observability";
import {
  type TerraformAssertion,
  TerraformMissions,
  terraformSatisfied,
} from "@/engine/missions/terraform";
import type { ValueOf } from "@/types/ValueOf";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";
import { type AdminAssertion, AdminMissions, adminSatisfied } from "./admin-lab";
import { type ComputeAssertion, ComputeMissions, computeSatisfied } from "./compute-lab";
import {
  type GkeCompletionAssertion,
  GkeCompletionMissions,
  gkeCompletionSatisfied,
} from "./gke-completion";
import {
  type GkeNodePoolAssertion,
  GkeNodePoolMissions,
  gkeNodePoolSatisfied,
} from "./gke-nodepools";
import { type GkePrivateAssertion, GkePrivateMissions, gkePrivateSatisfied } from "./gke-private";
import {
  type KubeConfigurationAssertion,
  KubeConfigurationMissions,
  kubeConfigurationSatisfied,
} from "./kube-configuration";
import {
  type KubeIngressAssertion,
  KubeIngressMissions,
  kubeIngressSatisfied,
} from "./kube-ingress";
import { type KubeLabelAssertion, KubeLabelMissions, kubeLabelsSatisfied } from "./kube-labels";
import {
  type KubeLivenessAssertion,
  KubeLivenessMissions,
  kubeLivenessSatisfied,
} from "./kube-liveness";
import {
  type KubeNetworkAssertion,
  KubeNetworkMissions,
  kubeNetworkSatisfied,
} from "./kube-network-policy";
import { type KubeQosAssertion, KubeQosMissions, kubeQosSatisfied } from "./kube-qos";
import {
  type KubeReadinessAssertion,
  KubeReadinessMissions,
  kubeReadinessSatisfied,
} from "./kube-readiness";
import {
  type KubeResourceAssertion,
  KubeResourceMissions,
  kubeResourcesSatisfied,
} from "./kube-resources";
import {
  type KubeStartupAssertion,
  KubeStartupMissions,
  kubeStartupSatisfied,
} from "./kube-startup";
import { type StatefulAssertion, StatefulMissions, statefulSatisfied } from "./kube-statefulsets";
import {
  type KubeStorageAssertion,
  KubeStorageMissions,
  kubeStorageSatisfied,
} from "./kube-storage";
import {
  type KubeWorkloadAssertion,
  KubeWorkloadMissions,
  kubeWorkloadSatisfied,
} from "./kube-workloads";
import { type LbAssertion, LoadBalancingMissions, lbSatisfied } from "./load-balancing";
import {
  type ManagedDatabaseAssertion,
  ManagedDatabaseMissions,
  managedDatabaseSatisfied,
} from "./managed-databases";
import { type NetworkAssertion, NetworkMissions, networkSatisfied } from "./network-lab";
import { type ObserveAssertion, ObserveMissions, observeSatisfied } from "./observability-lab";
import { type RelationalAssertion, RelationalMissions, relationalSatisfied } from "./relational";
import { type ServerlessAssertion, ServerlessMissions, serverlessSatisfied } from "./serverless";
import { type StorageAssertion, StorageMissions, storageSatisfied } from "./storage-lab";

/** ACE の 5 ドメイン（設計書 6.2 Mission.domain）。 */
export const MissionDomains = {
  Setup: "環境セットアップ",
  Planning: "計画と構成",
  Deploy: "デプロイと実装",
  Operations: "運用の維持",
  Security: "アクセスとセキュリティ",
} as const;
export type MissionDomain = ValueOf<typeof MissionDomains>;

/** World に対する述語（DJ-010: コマンド文字列ではなく状態で判定する）。値の語彙はドメインの型で閉じる。 */
export type MissionAssertion =
  | ObserveAssertion
  | AdminAssertion
  | StorageAssertion
  | NetworkAssertion
  | ComputeAssertion
  | DataAssertion
  | ManagedDatabaseAssertion
  | RelationalAssertion
  | ServerlessAssertion
  | LbAssertion
  | GkeCompletionAssertion
  | StatefulAssertion
  | GkeNodePoolAssertion
  | GkePrivateAssertion
  | BuildAssertion
  | KubeWorkloadAssertion
  | KubeLabelAssertion
  | KubeHpaManifestAssertion
  | KubeHpaAssertion
  | KubeReadinessAssertion
  | KubeLivenessAssertion
  | KubeNamespaceAssertion
  | KubeImmutableAssertion
  | KubeIngressAssertion
  | KubeNetworkAssertion
  | KubeStorageAssertion
  | KubeVolumesAssertion
  | KubeBinaryDataAssertion
  | KubeConfigLabelsAssertion
  | KubeContextAssertion
  | KubeStartupAssertion
  | KubeQosAssertion
  | KubeResourceAssertion
  | KubeConfigurationAssertion
  | KubernetesAssertion
  | ContainerReleaseAssertion
  | ArtifactLifecycleAssertion
  | ContainerAssertion
  | TerraformAssertion
  | ObservabilityAssertion
  | Readonly<{ kind: "billingLinked"; projectId: string }>
  | Readonly<{ kind: "apiEnabled"; projectId: string; api: ApiName }>
  | Readonly<{
      kind: "configurationProperty";
      configuration: string;
      property: ConfigProperty;
      value: string;
    }>
  | Readonly<{ kind: "networkExists"; projectId: string; name: string; subnetMode: SubnetMode }>
  | Readonly<{
      kind: "subnetExists";
      projectId: string;
      name: string;
      region: Region;
      ipCidrRange: string;
    }>
  | Readonly<{ kind: "serviceAccountExists"; projectId: string; accountId: string }>
  | Readonly<{ kind: "bindingExists"; target: PolicyTarget; role: RoleName; member: IamMember }>
  | Readonly<{ kind: "bindingAbsent"; target: PolicyTarget; role: RoleName; member: IamMember }>
  | Readonly<{
      kind: "instanceExists";
      projectId: string;
      name: string;
      zone: Zone;
      machineType: Option<MachineTypeName>;
      tags: readonly string[];
      status: Option<InstanceStatus>;
    }>
  | Readonly<{
      kind: "firewallRuleExists";
      projectId: string;
      name: string;
      allow: string;
      targetTag: string;
    }>
  | Readonly<{
      kind: "bucketExists";
      name: string;
      location: BucketLocation;
      storageClass: StorageClass;
    }>
  | Readonly<{
      kind: "clusterExists";
      projectId: string;
      name: string;
      autopilot: boolean;
      location: Zone | Region;
    }>
  | Readonly<{ kind: "snapshotExists"; projectId: string; name: string }>
  | Readonly<{
      kind: "runServiceExists";
      projectId: string;
      name: string;
      region: Region;
      allowUnauthenticated: boolean;
    }>
  | Readonly<{
      kind: "effectivePermission";
      projectId: string;
      member: IamMember;
      permission: string;
    }>
  | Readonly<{
      kind: "kubeDeploymentExists";
      projectId: string;
      cluster: string;
      name: string;
      replicas: number;
    }>
  | Readonly<{
      kind: "kubeServiceExists";
      projectId: string;
      cluster: string;
      name: string;
      type: KubeServiceType;
    }>
  | Readonly<{
      kind: "functionExists";
      projectId: string;
      name: string;
      region: Region;
      trigger: FunctionTrigger["kind"];
      allowUnauthenticated: boolean;
    }>
  | Readonly<{
      kind: "sqlInstanceExists";
      projectId: string;
      name: string;
      databaseVersion: SqlDatabaseVersion;
    }>
  | Readonly<{ kind: "topicExists"; projectId: string; name: string }>
  | Readonly<{ kind: "subscriptionExists"; projectId: string; name: string; topic: string }>
  | Readonly<{ kind: "budgetExists"; billingAccountId: string; amount: number }>
  | Readonly<{
      kind: "instanceGroupExists";
      projectId: string;
      name: string;
      targetSize: number;
      autoscaled: boolean;
    }>
  | Readonly<{
      kind: "customRoleExists";
      projectId: string;
      roleId: string;
      permissions: readonly string[];
    }>;

/** ミッション開始時に World へ当てる変更（設計書 6.2 Mission.setup）。 */
export type WorldPatch =
  | Readonly<{ kind: "ensureContainerCleanupLab" }>
  | Readonly<{ kind: "resetContainerReleaseEvidence" }>
  | Readonly<{ kind: "setPrincipal"; principal: Principal }>
  | Readonly<{ kind: "setProject"; projectId: string }>
  | Readonly<{ kind: "removeBinding"; target: PolicyTarget; role: RoleName; member: IamMember }>
  | Readonly<{ kind: "ensureInstance"; projectId: string; name: string; zone: Zone }>;

export type Mission = Readonly<{
  id: string;
  domain: MissionDomain;
  title: string;
  description: string;
  hints: readonly string[];
  setup: readonly WorldPatch[];
  assertions: readonly MissionAssertion[];
}>;

/** setup が不変条件を壊した（E-015）。開発者向けの理由を持つ。 */
export type MissionSetupFailure = Readonly<{ missionId: string; reason: string }>;

const devProject: PolicyTarget = { type: "project", id: F.devProjectId };
const devFolder: PolicyTarget = { type: "folder", id: F.devFolderId };
const organization: PolicyTarget = { type: "organization", id: F.organizationId };

const Missions: readonly Mission[] = [
  ...ObserveMissions,
  ...ObservabilityMissions,
  ...TerraformMissions,
  ...ContainerMissions,
  ...BuildMissions,
  ...ContainerReleaseMissions,
  ...KubernetesMissions,
  ...KubeWorkloadMissions,
  ...KubeLabelMissions,
  ...KubeResourceMissions,
  ...KubeQosMissions,
  ...KubeReadinessMissions,
  ...KubeLivenessMissions,
  ...KubeStartupMissions,
  ...KubeNamespaceMissions,
  ...KubeImmutableMissions,
  ...KubeVolumesMissions,
  ...KubeStorageMissions,
  ...StatefulMissions,
  ...GkeCompletionMissions,
  ...LoadBalancingMissions,
  ...ServerlessMissions,
  ...RelationalMissions,
  ...ManagedDatabaseMissions,
  ...ComputeMissions,
  ...StorageMissions,
  ...AdminMissions,
  ...NetworkMissions,
  ...DataMissions,
  ...KubeNetworkMissions,
  ...KubeIngressMissions,
  ...GkeNodePoolMissions,
  ...GkePrivateMissions,
  ...KubeBinaryDataMissions,
  ...KubeConfigLabelsMissions,
  ...KubeContextMissions,
  ...KubeHpaMissions,
  ...KubeHpaManifestMissions,
  ...KubeConfigurationMissions,
  ...ArtifactLifecycleMissions,
  {
    id: "m-setup-001",
    domain: MissionDomains.Setup,
    title: "ace-prod-01 で Compute Engine を使えるようにする",
    description:
      "プロジェクト ace-prod-01 に請求アカウントをリンクし、Compute Engine API を有効化してください。",
    hints: [
      "請求アカウントの ID は gcloud billing accounts list で確認できます。",
      "gcloud billing projects link ace-prod-01 --billing-account=ACCOUNT_ID でリンクします。",
      "API の有効化は gcloud services enable compute.googleapis.com --project=ace-prod-01 です。",
    ],
    setup: [],
    assertions: [
      { kind: "billingLinked", projectId: F.prodProjectId },
      { kind: "apiEnabled", projectId: F.prodProjectId, api: "compute.googleapis.com" },
    ],
  },
  {
    id: "m-setup-002",
    domain: MissionDomains.Setup,
    title: "本番用の configuration を用意する",
    description:
      "configuration `prod` を作り、その中で core/project を ace-prod-01、compute/zone を asia-northeast1-a に設定してください。",
    hints: [
      "gcloud config configurations create prod で作成と同時にアクティブになります。",
      "gcloud config set project ace-prod-01 / gcloud config set compute/zone asia-northeast1-a",
    ],
    setup: [],
    assertions: [
      {
        kind: "configurationProperty",
        configuration: "prod",
        property: "core/project",
        value: F.prodProjectId,
      },
      {
        kind: "configurationProperty",
        configuration: "prod",
        property: "compute/zone",
        value: "asia-northeast1-a",
      },
    ],
  },
  {
    id: "m-plan-001",
    domain: MissionDomains.Planning,
    title: "カスタムモードの VPC を設計する",
    description:
      "ace-dev-01 にカスタム サブネット モードの VPC `vpc-app` を作り、asia-northeast1 にサブネット `app-subnet`（10.10.0.0/24）を作ってください。",
    hints: [
      "gcloud compute networks create vpc-app --subnet-mode=custom",
      "gcloud compute networks subnets create app-subnet --network=vpc-app --region=asia-northeast1 --range=10.10.0.0/24",
    ],
    setup: [{ kind: "setProject", projectId: F.devProjectId }],
    assertions: [
      {
        kind: "networkExists",
        projectId: F.devProjectId,
        name: "vpc-app",
        subnetMode: SubnetModes.Custom,
      },
      {
        kind: "subnetExists",
        projectId: F.devProjectId,
        name: "app-subnet",
        region: "asia-northeast1",
        ipCidrRange: "10.10.0.0/24",
      },
    ],
  },
  {
    id: "m-plan-002",
    domain: MissionDomains.Planning,
    title: "バッチ用のサービスアカウントを用意する",
    description:
      "ace-dev-01 にサービスアカウント `batch-sa` を作り、プロジェクトに roles/storage.objectAdmin を付与してください。",
    hints: [
      'gcloud iam service-accounts create batch-sa --display-name="Batch SA"',
      "メンバーは serviceAccount:batch-sa@ace-dev-01.iam.gserviceaccount.com の形で指定します。",
      "gcloud projects add-iam-policy-binding ace-dev-01 --member=serviceAccount:... --role=roles/storage.objectAdmin",
    ],
    setup: [{ kind: "setProject", projectId: F.devProjectId }],
    assertions: [
      { kind: "serviceAccountExists", projectId: F.devProjectId, accountId: "batch-sa" },
      {
        kind: "bindingExists",
        target: devProject,
        role: "roles/storage.objectAdmin",
        member: `serviceAccount:${ServiceAccount.email("batch-sa", F.devProjectId)}`,
      },
    ],
  },
  {
    id: "m-deploy-001",
    domain: MissionDomains.Deploy,
    title: "Web サーバーを公開する",
    description:
      "ace-dev-01 の asia-northeast1-a に e2-small の VM `web-1` をネットワークタグ http-server 付きで作り、そのタグ向けに tcp:80 を許可するファイアウォールルール `allow-http` を作ってください。",
    hints: [
      "gcloud compute instances create web-1 --zone=asia-northeast1-a --machine-type=e2-small --tags=http-server",
      "gcloud compute firewall-rules create allow-http --network=default --allow=tcp:80 --target-tags=http-server",
    ],
    setup: [{ kind: "setProject", projectId: F.devProjectId }],
    assertions: [
      {
        kind: "instanceExists",
        projectId: F.devProjectId,
        name: "web-1",
        zone: "asia-northeast1-a",
        machineType: Option.some("e2-small"),
        tags: ["http-server"],
        status: Option.none,
      },
      {
        kind: "firewallRuleExists",
        projectId: F.devProjectId,
        name: "allow-http",
        allow: "tcp:80",
        targetTag: "http-server",
      },
    ],
  },
  {
    id: "m-deploy-002",
    domain: MissionDomains.Deploy,
    title: "ログ保管用のバケットを作る",
    description:
      "東京リージョン（ASIA-NORTHEAST1）に、既定のストレージクラスが NEARLINE のバケット `ace-dev-01-logs` を作ってください。",
    hints: [
      "gcloud storage buckets create gs://ace-dev-01-logs --location=asia-northeast1 --default-storage-class=NEARLINE",
    ],
    setup: [{ kind: "setProject", projectId: F.devProjectId }],
    assertions: [
      {
        kind: "bucketExists",
        name: "ace-dev-01-logs",
        location: "ASIA-NORTHEAST1",
        storageClass: "NEARLINE",
      },
    ],
  },
  {
    id: "m-deploy-003",
    domain: MissionDomains.Deploy,
    title: "GKE Autopilot クラスタを作る",
    description:
      "ace-dev-01 に、asia-northeast1 リージョンの Autopilot クラスタ `app-cluster` を作ってください（Kubernetes Engine API の有効化から）。",
    hints: [
      "gcloud services enable container.googleapis.com",
      "Autopilot は create ではなく create-auto です: gcloud container clusters create-auto app-cluster --region=asia-northeast1",
    ],
    setup: [{ kind: "setProject", projectId: F.devProjectId }],
    assertions: [
      {
        kind: "clusterExists",
        projectId: F.devProjectId,
        name: "app-cluster",
        autopilot: true,
        location: "asia-northeast1",
      },
    ],
  },
  {
    id: "m-ops-001",
    domain: MissionDomains.Operations,
    title: "停止してからスナップショットを取る",
    description:
      "asia-northeast1-b で動いている VM `batch-1` を停止し、そのブートディスク（batch-1）のスナップショット `batch-1-snap` を作ってください。",
    hints: [
      "gcloud compute instances stop batch-1 --zone=asia-northeast1-b",
      "gcloud compute snapshots create batch-1-snap --source-disk=batch-1 --source-disk-zone=asia-northeast1-b",
    ],
    setup: [
      { kind: "setProject", projectId: F.devProjectId },
      {
        kind: "ensureInstance",
        projectId: F.devProjectId,
        name: "batch-1",
        zone: "asia-northeast1-b",
      },
    ],
    assertions: [
      {
        kind: "instanceExists",
        projectId: F.devProjectId,
        name: "batch-1",
        zone: "asia-northeast1-b",
        machineType: Option.none,
        tags: [],
        status: Option.some("TERMINATED"),
      },
      { kind: "snapshotExists", projectId: F.devProjectId, name: "batch-1-snap" },
    ],
  },
  {
    id: "m-ops-002",
    domain: MissionDomains.Operations,
    title: "Cloud Run にサービスを公開する",
    description:
      "ace-dev-01 の asia-northeast1 に、イメージ gcr.io/cloudrun/hello のサービス `hello` を未認証アクセス許可でデプロイしてください。",
    hints: [
      "gcloud services enable run.googleapis.com",
      "gcloud run deploy hello --image=gcr.io/cloudrun/hello --region=asia-northeast1 --allow-unauthenticated",
    ],
    setup: [{ kind: "setProject", projectId: F.devProjectId }],
    assertions: [
      {
        kind: "runServiceExists",
        projectId: F.devProjectId,
        name: "hello",
        region: "asia-northeast1",
        allowUnauthenticated: true,
      },
    ],
  },
  {
    id: "m-iam-001",
    domain: MissionDomains.Security,
    title: "dev に最小権限で VM を作らせる",
    description:
      "dev@example.com は ace-dev-01 で VM を作れません。フォルダ dev に roles/compute.instanceAdmin.v1 だけを付与して、dev@example.com として asia-northeast1-a に VM `web-2` を作ってください（プロジェクトに editor / owner を付けるのは不正解）。",
    hints: [
      "gcloud config set account dev@example.com で切り替えて gcloud compute instances create web-2 --zone=asia-northeast1-a を試すと PERMISSION_DENIED になります。",
      "owner@example.com に戻り、gcloud resource-manager folders add-iam-policy-binding 284100000001 --member=user:dev@example.com --role=roles/compute.instanceAdmin.v1",
      "もう一度 dev@example.com で create を実行します。",
    ],
    setup: [
      { kind: "setProject", projectId: F.devProjectId },
      { kind: "setPrincipal", principal: F.developer },
    ],
    assertions: [
      {
        kind: "bindingExists",
        target: devFolder,
        role: "roles/compute.instanceAdmin.v1",
        member: `user:${F.developer}`,
      },
      {
        kind: "bindingAbsent",
        target: devProject,
        role: "roles/editor",
        member: `user:${F.developer}`,
      },
      {
        kind: "bindingAbsent",
        target: devProject,
        role: "roles/owner",
        member: `user:${F.developer}`,
      },
      {
        kind: "effectivePermission",
        projectId: F.devProjectId,
        member: `user:${F.developer}`,
        permission: "compute.instances.create",
      },
      {
        kind: "instanceExists",
        projectId: F.devProjectId,
        name: "web-2",
        zone: "asia-northeast1-a",
        machineType: Option.none,
        tags: [],
        status: Option.none,
      },
    ],
  },
  {
    id: "m-iam-002",
    domain: MissionDomains.Security,
    title: "運用チームに組織全体の閲覧権限を付ける",
    description:
      "グループ ops@example.com が組織配下のすべてのプロジェクトを閲覧できるように、組織レベルで roles/viewer を付与してください。",
    hints: [
      "組織 ID は gcloud organizations list で確認できます。",
      "gcloud organizations add-iam-policy-binding 123456789012 --member=group:ops@example.com --role=roles/viewer",
    ],
    setup: [],
    assertions: [
      { kind: "bindingExists", target: organization, role: "roles/viewer", member: F.opsGroup },
    ],
  },
  {
    id: "m-setup-003",
    domain: MissionDomains.Setup,
    title: "請求アカウントに予算を設定する",
    description:
      "請求アカウント 01AB2C-DEF345-6789AB に、月額 100000 JPY の予算（表示名は任意）を作ってください。しきい値は既定のままで構いません。",
    hints: [
      "予算は gcloud billing budgets create で作ります。--billing-account と --display-name と --budget-amount が必須です。",
      "gcloud billing budgets create --billing-account=01AB2C-DEF345-6789AB --display-name=monthly --budget-amount=100000JPY",
    ],
    setup: [],
    assertions: [{ kind: "budgetExists", billingAccountId: F.billingAccountId, amount: 100000 }],
  },
  {
    id: "m-plan-003",
    domain: MissionDomains.Planning,
    title: "非同期処理用の Pub/Sub を用意する",
    description:
      "ace-dev-01 に Pub/Sub トピック `orders` と、それを購読する pull サブスクリプション `orders-worker` を作ってください（Pub/Sub API の有効化から）。",
    hints: [
      "gcloud services enable pubsub.googleapis.com",
      "gcloud pubsub topics create orders",
      "gcloud pubsub subscriptions create orders-worker --topic=orders",
    ],
    setup: [{ kind: "setProject", projectId: F.devProjectId }],
    assertions: [
      { kind: "apiEnabled", projectId: F.devProjectId, api: "pubsub.googleapis.com" },
      { kind: "topicExists", projectId: F.devProjectId, name: "orders" },
      {
        kind: "subscriptionExists",
        projectId: F.devProjectId,
        name: "orders-worker",
        topic: "orders",
      },
    ],
  },
  {
    id: "m-deploy-004",
    domain: MissionDomains.Deploy,
    title: "GKE に Deployment を出して公開する",
    description:
      "ace-dev-01 の asia-northeast1-a に Standard クラスタ `app` を作り、kubectl で deployment.yaml（Deployment `web`）を適用して 3 レプリカにスケールし、LoadBalancer 型の Service `web` で公開してください。",
    hints: [
      "gcloud services enable container.googleapis.com のあと gcloud container clusters create app --zone=asia-northeast1-a",
      "kubectl を使う前に gcloud container clusters get-credentials app --zone=asia-northeast1-a で認証情報を取ります。",
      "kubectl apply -f deployment.yaml / kubectl scale deployment web --replicas=3 / kubectl expose deployment web --type=LoadBalancer --port=80",
    ],
    setup: [{ kind: "setProject", projectId: F.devProjectId }],
    assertions: [
      {
        kind: "clusterExists",
        projectId: F.devProjectId,
        name: "app",
        autopilot: false,
        location: "asia-northeast1-a",
      },
      {
        kind: "kubeDeploymentExists",
        projectId: F.devProjectId,
        cluster: "app",
        name: "web",
        replicas: 3,
      },
      {
        kind: "kubeServiceExists",
        projectId: F.devProjectId,
        cluster: "app",
        name: "web",
        type: KubeServiceTypes.LoadBalancer,
      },
    ],
  },
  {
    id: "m-deploy-005",
    domain: MissionDomains.Deploy,
    title: "HTTP で呼べる Cloud Functions をデプロイする",
    description:
      "ace-dev-01 の asia-northeast1 に、ランタイム python312 の HTTP トリガー関数 `hello` を未認証呼び出し許可でデプロイしてください。",
    hints: [
      "gcloud services enable cloudfunctions.googleapis.com",
      "gcloud functions deploy hello --runtime=python312 --trigger-http --allow-unauthenticated --region=asia-northeast1",
    ],
    setup: [{ kind: "setProject", projectId: F.devProjectId }],
    assertions: [
      {
        kind: "functionExists",
        projectId: F.devProjectId,
        name: "hello",
        region: "asia-northeast1",
        trigger: "http",
        allowUnauthenticated: true,
      },
    ],
  },
  {
    id: "m-deploy-006",
    domain: MissionDomains.Deploy,
    title: "Cloud SQL のインスタンスを立てる",
    description:
      "ace-dev-01 の asia-northeast1 に、MySQL 8.0 の Cloud SQL インスタンス `app-db` を作ってください（Cloud SQL Admin API の有効化から）。",
    hints: [
      "gcloud services enable sqladmin.googleapis.com",
      "gcloud sql instances create app-db --database-version=MYSQL_8_0 --region=asia-northeast1",
    ],
    setup: [{ kind: "setProject", projectId: F.devProjectId }],
    assertions: [
      {
        kind: "sqlInstanceExists",
        projectId: F.devProjectId,
        name: "app-db",
        databaseVersion: SqlDatabaseVersions.Mysql80,
      },
    ],
  },
  {
    id: "m-ops-003",
    domain: MissionDomains.Operations,
    title: "テンプレートから自動スケールする MIG を作る",
    description:
      "ace-dev-01 にインスタンステンプレート `web-tpl` を作り、それを使う 2 台のマネージドインスタンスグループ `web-mig` を asia-northeast1-a に作って、最大 5 台まで自動スケールするよう設定してください。",
    hints: [
      "gcloud compute instance-templates create web-tpl --machine-type=e2-small",
      "gcloud compute instance-groups managed create web-mig --template=web-tpl --size=2 --zone=asia-northeast1-a",
      "gcloud compute instance-groups managed set-autoscaling web-mig --max-num-replicas=5 --zone=asia-northeast1-a",
    ],
    setup: [{ kind: "setProject", projectId: F.devProjectId }],
    assertions: [
      {
        kind: "instanceGroupExists",
        projectId: F.devProjectId,
        name: "web-mig",
        targetSize: 2,
        autoscaled: true,
      },
    ],
  },
  {
    id: "m-iam-003",
    domain: MissionDomains.Security,
    title: "VM の起動と停止だけできるカスタムロールを作る",
    description:
      "ace-dev-01 に、compute.instances.start / compute.instances.stop / compute.instances.get / compute.instances.list だけを持つカスタムロール `vmOperator` を作り、dev@example.com にプロジェクトレベルで付与してください。",
    hints: [
      "gcloud iam roles create vmOperator --project=ace-dev-01 --title=VMOperator --permissions=compute.instances.start,compute.instances.stop,compute.instances.get,compute.instances.list",
      "カスタムロールの名前は projects/ace-dev-01/roles/vmOperator です。",
      "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:dev@example.com --role=projects/ace-dev-01/roles/vmOperator",
    ],
    setup: [{ kind: "setProject", projectId: F.devProjectId }],
    assertions: [
      {
        kind: "customRoleExists",
        projectId: F.devProjectId,
        roleId: "vmOperator",
        permissions: ["compute.instances.start", "compute.instances.stop"],
      },
      {
        kind: "bindingExists",
        target: devProject,
        role: `projects/${F.devProjectId}/roles/vmOperator`,
        member: `user:${F.developer}`,
      },
    ],
  },
];

const hasBinding = (world: World, target: PolicyTarget, role: RoleName, member: IamMember) => {
  const policy = World.findPolicy(world, target);
  return Option.isSome(policy) && IamPolicy.hasBinding(policy.value, role, member);
};

const isSatisfied = (world: World, assertion: MissionAssertion): boolean => {
  switch (assertion.kind) {
    case "observationLesson":
      return observeSatisfied(world, assertion.lesson);
    case "adminLesson":
      return adminSatisfied(world, assertion.lesson);
    case "storageLesson":
      return storageSatisfied(world, assertion.lesson);
    case "networkLesson":
      return networkSatisfied(world, assertion.lesson);
    case "computeLesson":
      return computeSatisfied(world, assertion.lesson);
    case "dataProcessingLesson":
      return dataSatisfied(world, assertion.lesson);
    case "managedDatabaseLesson":
      return managedDatabaseSatisfied(world, assertion.lesson);
    case "relationalLesson":
      return relationalSatisfied(world, assertion.lesson);
    case "serverlessLesson":
      return serverlessSatisfied(world, assertion.lesson);
    case "lbLesson":
      return lbSatisfied(world, assertion.lesson);
    case "gkeCompletion":
      return gkeCompletionSatisfied(world, assertion.lesson);
    case "kubeStatefulPodRecovered":
      return statefulSatisfied(world, false);
    case "kubeStatefulScaleRecovered":
      return statefulSatisfied(world, true);
    case "gkePrivateAccessSecured":
      return gkePrivateSatisfied(world, true);
    case "gkeAuthorizedSourceRecovered":
      return gkePrivateSatisfied(world, false);
    case "gkeNodePoolUpgraded":
      return gkeNodePoolSatisfied(world, false);
    case "gkeNodePoolScaled":
      return gkeNodePoolSatisfied(world, true);
    case "kubeHpaManifestConfigured":
      return kubeHpaManifestSatisfied(world);
    case "kubeHpaScaled":
      return kubeHpaSatisfied(world);
    case "kubeImmutableRefreshed":
      return kubeImmutableSatisfied(world);
    case "kubeIngressRouted":
      return kubeIngressSatisfied(world, false);
    case "kubeIngressRecovered":
      return kubeIngressSatisfied(world, true);
    case "kubeNetworkRestricted":
      return kubeNetworkSatisfied(world, false);
    case "kubeNamespaceNetworkRestricted":
      return kubeNetworkSatisfied(world, true);
    case "kubePersistentDataReady":
      return kubeStorageSatisfied(world, false);
    case "kubeRetainedDataReady":
      return kubeStorageSatisfied(world, true);
    case "kubeVolumesReady":
      return kubeVolumesSatisfied(world, false);
    case "kubeVolumeRefreshReady":
      return kubeVolumesSatisfied(world, true);
    case "kubeBinaryDataSeparated":
      return kubeBinaryDataSatisfied(world);
    case "kubeConfigLabelsClassified":
      return kubeConfigLabelsSatisfied(world);
    case "kubeContextSwitched":
      return kubeContextSatisfied(world);
    case "kubeNamespaceIsolated":
      return kubeNamespaceSatisfied(world);
    case "kubeStartupGated":
      return kubeStartupSatisfied(world);
    case "kubeLivenessRecovered":
      return kubeLivenessSatisfied(world);
    case "kubeReadinessRouted":
      return kubeReadinessSatisfied(world);
    case "kubeQosConfigured":
      return kubeQosSatisfied(world);
    case "kubeResourcesConfigured":
      return kubeResourcesSatisfied(world);
    case "kubeLabelsSwitched":
      return kubeLabelsSatisfied(world);
    case "kubeWorkloadApplied":
      return kubeWorkloadSatisfied(world);
    case "kubeConfigInjected":
    case "kubeConfigRefreshed":
    case "kubeConfigApplied":
      return kubeConfigurationSatisfied(world, assertion);
    case "kubeImageUpdated":
    case "kubeRollbackRecovered":
      return kubernetesSatisfied(world, assertion);
    case "containerReleaseCleaned":
      return containerReleaseSatisfied(world);
    case "artifactReleasePromoted":
    case "containerCleanupComplete":
      return artifactLifecycleSatisfied(world, assertion);
    case "cloudBuildPublished":
    case "registryDeploymentReady":
      return buildSatisfied(world, assertion);
    case "localContainerReady":
    case "artifactPublished":
      return containerSatisfied(world, assertion);
    case "terraformManaged":
    case "terraformMoved":
    case "terraformDestroyed":
    case "terraformBackendMigrated":
      return terraformSatisfied(world, assertion);
    case "logMetricConfigured":
    case "uptimeConfigured":
    case "dashboardConfigured":
    case "alertConfigured":
    case "logExportConfigured":
      return observabilitySatisfied(world, assertion);
    case "billingLinked": {
      const project = World.findProject(world, assertion.projectId);
      return Option.isSome(project) && Option.isSome(project.value.billingAccountId);
    }
    case "apiEnabled":
      return World.hasApi(world, assertion.projectId, assertion.api);
    case "configurationProperty": {
      const values = GcloudConfig.valuesOf(world.config, assertion.configuration);
      return Option.isSome(values) && values.value[assertion.property] === assertion.value;
    }
    case "networkExists": {
      const network = World.findNetwork(world, assertion.projectId, assertion.name);
      return Option.isSome(network) && network.value.subnetMode === assertion.subnetMode;
    }
    case "subnetExists": {
      const subnet = World.findSubnet(world, assertion.projectId, assertion.region, assertion.name);
      return Option.isSome(subnet) && subnet.value.ipCidrRange === assertion.ipCidrRange;
    }
    case "serviceAccountExists":
      return Option.isSome(
        World.findServiceAccount(
          world,
          ServiceAccount.email(assertion.accountId, assertion.projectId),
        ),
      );
    case "bindingExists":
      return hasBinding(world, assertion.target, assertion.role, assertion.member);
    case "bindingAbsent":
      return (
        Option.isSome(World.findPolicy(world, assertion.target)) &&
        !hasBinding(world, assertion.target, assertion.role, assertion.member)
      );
    case "instanceExists": {
      const instance = World.findInstance(
        world,
        assertion.projectId,
        assertion.zone,
        assertion.name,
      );
      if (!Option.isSome(instance)) return false;
      const machineTypeOk =
        !Option.isSome(assertion.machineType) ||
        instance.value.machineType === assertion.machineType.value;
      const tagsOk = assertion.tags.every((tag) => instance.value.tags.includes(tag));
      const statusOk =
        !Option.isSome(assertion.status) || instance.value.status === assertion.status.value;
      return machineTypeOk && tagsOk && statusOk;
    }
    case "firewallRuleExists": {
      const rule = World.findFirewallRule(world, assertion.projectId, assertion.name);
      if (!Option.isSome(rule)) return false;
      const [protocol, port] = assertion.allow.split(":");
      const allowOk = rule.value.allowed.some(
        (a) => a.protocol === protocol && (port === undefined || a.ports.includes(port)),
      );
      return allowOk && rule.value.targetTags.includes(assertion.targetTag);
    }
    case "bucketExists": {
      const bucket = World.findBucket(world, assertion.name);
      return (
        Option.isSome(bucket) &&
        bucket.value.location === assertion.location &&
        bucket.value.storageClass === assertion.storageClass
      );
    }
    case "clusterExists": {
      const cluster = World.findCluster(world, assertion.projectId, assertion.name);
      return (
        Option.isSome(cluster) &&
        cluster.value.autopilot === assertion.autopilot &&
        cluster.value.location === assertion.location
      );
    }
    case "snapshotExists":
      return World.diskSnapshotsOf(world, assertion.projectId).some(
        (s) => s.name === assertion.name,
      );
    case "runServiceExists": {
      const service = World.findRunService(world, assertion.projectId, assertion.name);
      return (
        Option.isSome(service) &&
        service.value.region === assertion.region &&
        service.value.allowUnauthenticated === assertion.allowUnauthenticated
      );
    }
    case "effectivePermission": {
      const effective = EffectivePermissions.resolve(world, assertion.member, {
        type: "project",
        id: assertion.projectId,
      });
      return EffectivePermissions.allows(effective, assertion.permission);
    }
    case "kubeDeploymentExists": {
      const deployment = Option.flatMap(
        World.findCluster(world, assertion.projectId, assertion.cluster),
        (cluster) => World.findKubeDeployment(world, cluster, assertion.name),
      );
      if (!Option.isSome(deployment) || deployment.value.replicas !== assertion.replicas)
        return false;
      const cluster = World.findCluster(world, assertion.projectId, assertion.cluster);
      return (
        Option.isSome(cluster) && !ImagePull.error(world, cluster.value, deployment.value.image)
      );
    }
    case "kubeServiceExists": {
      const service = Option.flatMap(
        World.findCluster(world, assertion.projectId, assertion.cluster),
        (cluster) => World.findKubeService(world, cluster, assertion.name),
      );
      return Option.isSome(service) && service.value.type === assertion.type;
    }
    case "functionExists": {
      const fn = World.findNamed(world, "functions", assertion);
      return (
        Option.isSome(fn) &&
        fn.value.region === assertion.region &&
        fn.value.trigger.kind === assertion.trigger &&
        fn.value.allowUnauthenticated === assertion.allowUnauthenticated
      );
    }
    case "sqlInstanceExists": {
      const instance = World.findNamed(world, "sqlInstances", assertion);
      return (
        Option.isSome(instance) && instance.value.databaseVersion === assertion.databaseVersion
      );
    }
    case "topicExists":
      return Option.isSome(World.findNamed(world, "pubsubTopics", assertion));
    case "subscriptionExists": {
      const subscription = World.findNamed(world, "pubsubSubscriptions", assertion);
      return Option.isSome(subscription) && subscription.value.topic === assertion.topic;
    }
    case "budgetExists":
      return World.budgetsOf(world, assertion.billingAccountId).some(
        (b) => b.amount === assertion.amount,
      );
    case "instanceGroupExists": {
      const group = World.findNamed(world, "instanceGroups", assertion);
      return (
        Option.isSome(group) &&
        group.value.targetSize === assertion.targetSize &&
        Option.isSome(group.value.autoscaling) === assertion.autoscaled
      );
    }
    case "customRoleExists": {
      const role = World.findCustomRoleById(world, assertion.projectId, assertion.roleId);
      return (
        Option.isSome(role) &&
        assertion.permissions.every((p) => role.value.includedPermissions.includes(p))
      );
    }
  }
};

/**
 * `ensureInstance` が作る VM。マシンタイプ・イメージ・ディスク・スコープはコマンドの既定値と同じ。
 * 外部 IP は付けない（ミッションには要らず、採番はコマンド層の関心事）。
 */
const ensureInstance = (
  world: World,
  patch: Extract<WorldPatch, { kind: "ensureInstance" }>,
): Result<World, string> => {
  if (Option.isSome(World.findInstance(world, patch.projectId, patch.zone, patch.name)))
    return Result.ok(world);
  const project = World.findProject(world, patch.projectId);
  if (!Option.isSome(project)) return Result.err(`project ${patch.projectId} does not exist`);
  const subnet = World.findSubnet(world, patch.projectId, Zone.region(patch.zone), "default");
  if (!Option.isSome(subnet)) return Result.err(`no default subnet for ${patch.zone}`);
  const numbered = World.nextNumber(world);
  const instance = Instance.create({
    projectId: patch.projectId,
    name: patch.name,
    zone: patch.zone,
    machineType: DefaultMachineType,
    networkInterface: {
      network: "default",
      subnetwork: "default",
      networkIP: Subnet.hostAddress(subnet.value, numbered.number),
      externalIP: ExternalIp.None,
    },
    image: DefaultImage,
    bootDisk: { sizeGb: 10, type: BootDiskTypes.Balanced },
    tags: [],
    serviceAccount: ServiceAccount.defaultComputeEmail(project.value.projectNumber),
    scopes: DefaultScopes,
    preemptible: false,
    provisioningModel: ProvisioningModels.Standard,
    metadata: {},
    creationTimestamp: "2026-01-01T00:00:00.000Z",
    sequence: numbered.number,
  });
  if (!Result.isOk(instance)) return instance;
  return Result.mapErr(
    World.withInstance(numbered.world, instance.value),
    (e) => `instance ${e.resource} already exists`,
  );
};

const applyPatch = (world: World, patch: WorldPatch): Result<World, string> => {
  switch (patch.kind) {
    case "ensureContainerCleanupLab":
      return ensureContainerCleanupLab(world);
    case "resetContainerReleaseEvidence":
      return Result.ok({ ...world, containerLab: { ...world.containerLab, releases: [] } });
    case "setPrincipal":
      return Result.ok(World.withPrincipal(world, patch.principal));
    case "setProject":
      return Result.ok(
        World.withConfig(world, GcloudConfig.set(world.config, "core/project", patch.projectId)),
      );
    case "removeBinding": {
      const policy = World.findPolicy(world, patch.target);
      if (!Option.isSome(policy))
        return Result.err(`target ${patch.target.type}/${patch.target.id} does not exist`);
      const removed = IamPolicy.removeBinding(policy.value, patch.role, patch.member);
      if (!Option.isSome(removed)) return Result.ok(world);
      return Result.mapErr(World.withPolicy(world, patch.target, removed.value), (rejected) =>
        rejected.kind === "last-owner"
          ? "removing the binding would leave the organization without an owner"
          : rejected.kind === "invalid"
            ? rejected.reason
            : `target ${rejected.target.type}/${rejected.target.id} does not exist`,
      );
    }
    case "ensureInstance":
      return ensureInstance(world, patch);
  }
};

export type MissionEvaluation = Readonly<{ world: World; completed: readonly Mission[] }>;

export const Mission = {
  all(): readonly Mission[] {
    return Missions;
  },

  find(id: string): Option<Mission> {
    return Option.fromNullable(Missions.find((m) => m.id === id));
  },

  /**
   * ミッションを始める（UC-006）。`setup` を当てて不変条件を確かめ、進捗を `in_progress` にする。
   *
   * @param world 元
   * @param mission 始めるミッション
   * @returns 始めた後の World。setup が不変条件を壊すなら E-015（World は変えない）
   */
  start(world: World, mission: Mission): Result<World, MissionSetupFailure> {
    const patched = mission.setup.reduce<Result<World, string>>(
      (acc, patch) => Result.flatMap(acc, (w) => applyPatch(w, patch)),
      Result.ok(world),
    );
    const validated = Result.flatMap(patched, World.validate);
    return Result.map(
      Result.mapErr(validated, (reason) => ({ missionId: mission.id, reason })),
      (w) => {
        const progress = Option.unwrapOr(
          World.findMissionProgress(w, mission.id),
          MissionProgress.create(mission.id),
        );
        return World.replaceMissionProgress(w, MissionProgress.start(progress));
      },
    );
  },

  /**
   * ミッションを中断する。World の変更は残す（自由操作優先）。
   *
   * @param world 元
   * @param id ミッション id
   * @returns `available` に戻した World。進行中でなければ変えない
   */
  abandon(world: World, id: string): World {
    const progress = World.findMissionProgress(world, id);
    return Option.isSome(progress)
      ? World.replaceMissionProgress(world, MissionProgress.abandon(progress.value))
      : world;
  },

  revealHint(world: World, mission: Mission): World {
    const progress = World.findMissionProgress(world, mission.id);
    return Option.isSome(progress)
      ? World.replaceMissionProgress(
          world,
          MissionProgress.revealHint(progress.value, mission.hints.length),
        )
      : world;
  },

  /**
   * 進行中のミッションをすべて評価し、全アサーションが真のものを `completed` にする（UC-006 ステップ 3）。
   *
   * @param world コマンド実行後の World
   * @returns 進捗を更新した World と、今回クリアしたミッション
   */
  evaluate(world: World): MissionEvaluation {
    return World.missionsInProgress(world).reduce<MissionEvaluation>(
      (acc, progress) => {
        const mission = Mission.find(progress.id);
        const cleared =
          Option.isSome(mission) &&
          mission.value.assertions.every((a) => isSatisfied(acc.world, a));
        if (!cleared || !Option.isSome(mission)) return acc;
        return {
          world: World.replaceMissionProgress(acc.world, MissionProgress.complete(progress)),
          completed: [...acc.completed, mission.value],
        };
      },
      { world, completed: [] },
    );
  },

  /**
   * 各アサーションの成否。ミッションパネルの進捗表示に使う。
   *
   * @param world 今の World
   * @param mission 見るミッション
   * @returns アサーションごとの真偽（定義と同じ並び）
   */
  assertionResults(world: World, mission: Mission): readonly boolean[] {
    return mission.assertions.map((a) => isSatisfied(world, a));
  },

  /** 進捗が無い id を `available` で足し、定義に無い id を落とす（import と定義の追加で揃える）。 */
  syncProgress(world: World): World {
    const known = new Set(Missions.map((m) => m.id));
    const kept = world.missions.filter((m) => known.has(m.id));
    const missing = Missions.filter((m) => !kept.some((k) => k.id === m.id)).map((m) =>
      MissionProgress.create(m.id),
    );
    return { ...world, missions: [...kept, ...missing] };
  },

  /** 完了した件数と定義の総数。ヘッダーの「ミッション 2/18」表示に使う。 */
  counts(world: World): Readonly<{ completed: number; total: number }> {
    return {
      completed: world.missions.filter((m) => m.status === MissionStatuses.Completed).length,
      total: Missions.length,
    };
  },
} as const;

import { type DataAssertion, DataMissions, dataSatisfied } from "./data-processing";
