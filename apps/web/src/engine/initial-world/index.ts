import { Region } from "@/engine/domains/catalog";
import {
  Directions,
  type FirewallRule,
  type Network,
  type ProtocolRule,
  Subnet,
  SubnetModes,
} from "@/engine/domains/compute";
import { ContainerLab } from "@/engine/domains/container-lab";
import { GcloudConfig } from "@/engine/domains/gcloud-config";
import { IamPolicy } from "@/engine/domains/iam-policy";
import { MissionProgress } from "@/engine/domains/mission-progress";
import type { Principal } from "@/engine/domains/principal";
import { type Folder, type Project, ProjectStates } from "@/engine/domains/resource-hierarchy";
import { SampleKeyAccount } from "@/engine/domains/sample-files";
import type { ServiceAccount } from "@/engine/domains/service-account";
import type { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";

/** 初期 World の固定値。ミッション・テスト・VRT がこれに依存する。 */
export const InitialWorldFixture = {
  organizationId: "123456789012",
  organizationName: "example.com",
  devFolderId: "284100000001",
  prodFolderId: "284100000002",
  devProjectId: "ace-dev-01",
  prodProjectId: "ace-prod-01",
  billingAccountId: "01AB2C-DEF345-6789AB",
  owner: "owner@example.com" satisfies Principal,
  developer: "dev@example.com" satisfies Principal,
  opsGroup: "group:ops@example.com",
  /** `key.json`（sample-files）が指す SA と同じ */
  webServiceAccount: SampleKeyAccount,
} as const;

/** 本物の `default` ネットワークに付いてくる 4 つのルールの材料。 */
type DefaultRuleSeed = Readonly<{
  name: string;
  allowed: readonly ProtocolRule[];
  sourceRanges: readonly string[];
}>;

const DefaultRuleSeeds: readonly DefaultRuleSeed[] = [
  {
    name: "default-allow-internal",
    allowed: [
      { protocol: "tcp", ports: ["0-65535"] },
      { protocol: "udp", ports: ["0-65535"] },
      { protocol: "icmp", ports: [] },
    ],
    sourceRanges: ["10.128.0.0/9"],
  },
  {
    name: "default-allow-ssh",
    allowed: [{ protocol: "tcp", ports: ["22"] }],
    sourceRanges: ["0.0.0.0/0"],
  },
  {
    name: "default-allow-rdp",
    allowed: [{ protocol: "tcp", ports: ["3389"] }],
    sourceRanges: ["0.0.0.0/0"],
  },
  {
    name: "default-allow-icmp",
    allowed: [{ protocol: "icmp", ports: [] }],
    sourceRanges: ["0.0.0.0/0"],
  },
];

const defaultNetwork = (
  projectId: string,
): Readonly<{ network: Network; subnets: readonly Subnet[]; rules: readonly FirewallRule[] }> => ({
  network: { projectId, name: "default", subnetMode: SubnetModes.Auto },
  subnets: Subnet.autoRange(projectId, "default", Region.all()),
  rules: DefaultRuleSeeds.map(
    (seed): FirewallRule => ({
      projectId,
      name: seed.name,
      network: "default",
      direction: Directions.Ingress,
      priority: 65534,
      sourceRanges: seed.sourceRanges,
      destinationRanges: [],
      targetTags: [],
      allowed: seed.allowed,
      denied: [],
      disabled: false,
    }),
  ),
});

/**
 * 初期 World では空で始める集合（Phase 1 の後に足したもの）。Snapshot の v1 → v2 マイグレーションも
 * 同じ値で埋める（`engine/snapshot`）。
 */
export const EmptyCollections = {
  disks: [],
  projectMetadata: [],
  addresses: [],
  routers: [],
  peerings: [],
  healthChecks: [],
  backendServices: [],
  forwardingRules: [],
  instanceTemplates: [],
  instanceGroups: [],
  nodePools: [],
  kubeNamespaces: [],
  kubeContextNamespaces: {},
  kubeDeployments: [],
  kubeServices: [],
  kubeHpas: [],
  kubeConfigs: [],
  kubeStorageClasses: [],
  kubePvcs: [],
  kubePvs: [],
  kubeIngresses: [],
  kubeNetworkPolicies: [],
  kubeFiles: {},
  functions: [],
  appEngineApps: [],
  appVersions: [],
  sqlInstances: [],
  sqlBackups: [],
  pubsubTopics: [],
  pubsubSubscriptions: [],
  logSinks: [],
  logMetrics: [],
  uptimeChecks: [],
  alertPolicies: [],
  dashboards: [],
  serviceAccountKeys: [],
  osLoginKeys: [],
  kmsKeyRings: [],
  dnsZones: [],
  dmDeployments: [],
  budgets: [],
  customRoles: [],
} as const satisfies Partial<World>;

export const InitialWorld = {
  /**
   * サンプル組織・フォルダ 2・プロジェクト 2・請求アカウント 1・default ネットワークを持つ World（UC-005 Reset）。
   * `ace-dev-01` は請求がリンクされ主要 API が有効、`ace-prod-01` は請求もAPI も無い（E-007 / E-016 を体験する用）。
   *
   * @param now 作成時刻。プロジェクトの `createTime` に入る
   * @param missionIds ミッション定義の id。すべて `available` で始める
   * @returns 初期 World
   */
  create(now: string, missionIds: readonly string[]): World {
    const f = InitialWorldFixture;
    const dev = defaultNetwork(f.devProjectId);
    const prod = defaultNetwork(f.prodProjectId);
    const folders: readonly Folder[] = [
      {
        id: f.devFolderId,
        displayName: "dev",
        parent: { type: "organization", id: f.organizationId },
        iamPolicy: IamPolicy.Empty,
      },
      {
        id: f.prodFolderId,
        displayName: "prod",
        parent: { type: "organization", id: f.organizationId },
        iamPolicy: IamPolicy.Empty,
      },
    ];
    const projects: readonly Project[] = [
      {
        projectId: f.devProjectId,
        name: "ACE Dev",
        projectNumber: "481200000001",
        parent: { type: "folder", id: f.devFolderId },
        lifecycleState: ProjectStates.Active,
        billingAccountId: Option.some(f.billingAccountId),
        enabledApis: [
          "compute.googleapis.com",
          "storage.googleapis.com",
          "iam.googleapis.com",
          "cloudresourcemanager.googleapis.com",
          "logging.googleapis.com",
          "monitoring.googleapis.com",
        ],
        iamPolicy: IamPolicy.create([
          { role: "roles/viewer", members: [`user:${f.developer}`] },
          {
            role: "roles/storage.objectViewer",
            members: [`serviceAccount:${f.webServiceAccount}`],
          },
        ]),
        labels: { env: "dev" },
        createTime: now,
      },
      {
        projectId: f.prodProjectId,
        name: "ACE Prod",
        projectNumber: "481200000002",
        parent: { type: "folder", id: f.prodFolderId },
        lifecycleState: ProjectStates.Active,
        billingAccountId: Option.none,
        enabledApis: [],
        iamPolicy: IamPolicy.Empty,
        labels: { env: "prod" },
        createTime: now,
      },
    ];
    const serviceAccounts: readonly ServiceAccount[] = [
      {
        email: f.webServiceAccount,
        displayName: "web-sa",
        description: "",
        projectId: f.devProjectId,
        uniqueId: "100000000000000000001",
        iamPolicy: IamPolicy.Empty,
      },
    ];
    return {
      organization: {
        id: f.organizationId,
        displayName: f.organizationName,
        iamPolicy: IamPolicy.create([
          { role: "roles/owner", members: [`user:${f.owner}`] },
          { role: "roles/logging.viewer", members: [f.opsGroup] },
        ]),
      },
      folders,
      projects,
      billingAccounts: [{ id: f.billingAccountId, displayName: "My Billing Account", open: true }],
      serviceAccounts,
      instances: [],
      terraform: TerraformState.empty(),
      containerLab: ContainerLab.empty(),
      networks: [dev.network, prod.network],
      subnets: [...dev.subnets, ...prod.subnets],
      firewallRules: [...dev.rules, ...prod.rules],
      diskSnapshots: [],
      buckets: [],
      clusters: [],
      runServices: [],
      ...EmptyCollections,
      config: GcloudConfig.create({ "core/account": f.owner, "core/project": f.devProjectId }),
      session: { accounts: [f.owner], adc: Option.none, components: [] },
      operations: [],
      missions: missionIds.map(MissionProgress.create),
      // フォルダ id は 284100000000 + 通し番号で採番する。固定のフォルダ（…001 / …002）と
      // 衝突しないよう、通し番号は固定値が使う範囲の後ろから始める。
      sequence: 10,
    };
  },
} as const;

import { TerraformState } from "@/engine/domains/terraform";
