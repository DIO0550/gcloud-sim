import { Region } from "@/engine/domains/catalog";
import {
  Directions,
  type FirewallRule,
  type Network,
  Subnet,
  SubnetModes,
} from "@/engine/domains/compute";
import { GcloudConfig } from "@/engine/domains/gcloud-config";
import { IamPolicy } from "@/engine/domains/iam-policy";
import { MissionProgress } from "@/engine/domains/mission-progress";
import { type Folder, type Project, ProjectStates } from "@/engine/domains/resource-hierarchy";
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
  owner: "owner@example.com",
  developer: "dev@example.com",
  opsGroup: "group:ops@example.com",
  webServiceAccount: "web-sa@ace-dev-01.iam.gserviceaccount.com",
} as const;

const defaultNetwork = (
  projectId: string,
): Readonly<{ network: Network; subnets: readonly Subnet[]; rules: readonly FirewallRule[] }> => {
  const network: Network = { projectId, name: "default", subnetMode: SubnetModes.Auto };
  const rule = (
    name: string,
    allowed: readonly Readonly<{ protocol: string; ports: readonly string[] }>[],
    sourceRanges: readonly string[],
    priority: number,
  ): FirewallRule => ({
    projectId,
    name,
    network: "default",
    direction: Directions.Ingress,
    priority,
    sourceRanges,
    targetTags: [],
    allowed,
    denied: [],
    disabled: false,
  });
  return {
    network,
    subnets: Subnet.autoRange(projectId, "default", Region.all()),
    rules: [
      rule(
        "default-allow-internal",
        [
          { protocol: "tcp", ports: ["0-65535"] },
          { protocol: "udp", ports: ["0-65535"] },
          { protocol: "icmp", ports: [] },
        ],
        ["10.128.0.0/9"],
        65534,
      ),
      rule("default-allow-ssh", [{ protocol: "tcp", ports: ["22"] }], ["0.0.0.0/0"], 65534),
      rule("default-allow-rdp", [{ protocol: "tcp", ports: ["3389"] }], ["0.0.0.0/0"], 65534),
      rule("default-allow-icmp", [{ protocol: "icmp", ports: [] }], ["0.0.0.0/0"], 65534),
    ],
  };
};

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
        projectId: f.devProjectId,
        uniqueId: "100000000000000000001",
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
      networks: [dev.network, prod.network],
      subnets: [...dev.subnets, ...prod.subnets],
      firewallRules: [...dev.rules, ...prod.rules],
      snapshots: [],
      buckets: [],
      clusters: [],
      runServices: [],
      config: GcloudConfig.create({ "core/account": f.owner, "core/project": f.devProjectId }),
      session: { principal: f.owner, accounts: [f.owner] },
      operations: [],
      missions: missionIds.map(MissionProgress.create),
      sequence: 1,
    };
  },
} as const;
