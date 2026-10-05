import type { MachineTypeName, Region, Zone } from "@/engine/domains/catalog";
import { ResourceName } from "@/engine/domains/compute";
import type { JsonRecord } from "@/types/Json";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

/** GKE クラスタ。ゾーン クラスタかリージョン クラスタか（`--zone` / `--region`）。 */
export type GkeCluster = Readonly<{
  projectId: string;
  name: string;
  location: Zone | Region;
  nodeCount: number;
  autopilot: boolean;
  networkPolicyEnabled: boolean;
  status: "RUNNING";
  machineType: MachineTypeName;
  currentMasterVersion: string;
  nodeServiceAccount: string;
}>;

/** 作成時のマスターバージョンと、`upgrade` で上がる先。`--cluster-version` は受けない（DJ-005）。 */
const MasterVersion = "1.31.5-gke.1068000";
const NextMasterVersion = "1.32.2-gke.1182000";

/** `GkeCluster.create` に渡す材料。Autopilot はノード数を持たない。 */
export type GkeClusterSeed = Readonly<{
  projectId: string;
  name: string;
  location: Zone | Region;
  machineType: MachineTypeName;
  nodeServiceAccount?: string;
  networkPolicyEnabled?: boolean;
  nodes: Readonly<{ kind: "autopilot" }> | Readonly<{ kind: "standard"; count: number }>;
}>;

export const GkeCluster = {
  /**
   * クラスタを `RUNNING` で作る。名前の形式はここで検証する。
   *
   * @param seed 材料
   * @returns 作ったクラスタ。名前の形式が悪ければ理由
   */
  create(seed: GkeClusterSeed): Result<GkeCluster, string> {
    return Result.map(ResourceName.parse(seed.name), (name) => ({
      projectId: seed.projectId,
      name,
      location: seed.location,
      nodeCount: seed.nodes.kind === "standard" ? seed.nodes.count : 0,
      autopilot: seed.nodes.kind === "autopilot",
      networkPolicyEnabled: seed.nodes.kind === "autopilot" || seed.networkPolicyEnabled === true,
      status: "RUNNING",
      machineType: seed.machineType,
      currentMasterVersion: MasterVersion,
      nodeServiceAccount: seed.nodeServiceAccount ?? "",
    }));
  },

  /**
   * ノード数を替える（`clusters resize`）。Autopilot はノード数を持たないので拒む。
   *
   * @param cluster 元
   * @param nodeCount 新しいノード数（0 以上）
   * @returns 替えたクラスタ。Autopilot か負なら理由
   */
  withNodeCount(cluster: GkeCluster, nodeCount: number): Result<GkeCluster, string> {
    if (cluster.autopilot) {
      return Result.err(
        `Cluster ${cluster.name} is an Autopilot cluster; node count is managed by GKE and cannot be resized.`,
      );
    }
    if (nodeCount < 0) return Result.err(`Invalid value for [--num-nodes]: ${nodeCount}.`);
    return Result.ok({ ...cluster, nodeCount });
  },

  /**
   * マスターを次の版へ上げる（`clusters upgrade --master`）。収録している版は 1 つ先まで。
   *
   * @param cluster 元
   * @returns 上げたクラスタ。既に最新なら理由
   */
  upgraded(cluster: GkeCluster): Result<GkeCluster, string> {
    return cluster.currentMasterVersion === MasterVersion
      ? Result.ok({ ...cluster, currentMasterVersion: NextMasterVersion })
      : Result.err(
          `Cluster ${cluster.name} is already on the latest available version (${cluster.currentMasterVersion}).`,
        );
  },

  selfLink(cluster: GkeCluster): string {
    return `https://container.googleapis.com/v1/projects/${cluster.projectId}/locations/${cluster.location}/clusters/${cluster.name}`;
  },

  toRecord(cluster: GkeCluster): JsonRecord {
    return {
      name: cluster.name,
      location: cluster.location,
      status: cluster.status,
      currentMasterVersion: cluster.currentMasterVersion,
      currentNodeCount: cluster.nodeCount,
      autopilot: { enabled: cluster.autopilot },
      networkPolicy: { enabled: cluster.networkPolicyEnabled },
      nodeConfig: {
        machineType: cluster.machineType,
        serviceAccount: cluster.nodeServiceAccount || "default",
      },
      endpoint: "34.85.0.1",
    };
  },
} as const;

export type CloudRunService = Readonly<{
  projectId: string;
  name: string;
  region: Region;
  image: string;
  allowUnauthenticated: boolean;
  lastDeployedAt: string;
}>;

export const CloudRunService = {
  /**
   * サービスを作る。名前の形式はここで検証する。
   *
   * @param seed 材料
   * @returns 作ったサービス。名前の形式が悪ければ理由
   */
  create(seed: CloudRunService): Result<CloudRunService, string> {
    return Result.map(ResourceName.parse(seed.name), (name) => ({ ...seed, name }));
  },

  url(service: CloudRunService): string {
    return `https://${service.name}-abc123-an.a.run.app`;
  },

  /** 最新リビジョンの名前。deploy の完了メッセージと describe の両方が出す。 */
  revisionName(service: CloudRunService): string {
    return `${service.name}-00001-abc`;
  },

  toRecord(service: CloudRunService): JsonRecord {
    return {
      metadata: { name: service.name, namespace: service.projectId },
      spec: { template: { spec: { containers: [{ image: service.image }] } } },
      status: {
        url: CloudRunService.url(service),
        latestReadyRevisionName: CloudRunService.revisionName(service),
      },
      region: service.region,
      allowUnauthenticated: service.allowUnauthenticated,
      lastDeployedAt: service.lastDeployedAt,
    };
  },
} as const;

/** GKE Standard クラスタのノードプール（`gcloud container node-pools`）。 */
export type NodePool = Readonly<{
  projectId: string;
  cluster: string;
  name: string;
  machineType: MachineTypeName;
  nodeCount: number;
  diskSizeGb: number;
  version: string;
}>;

export const NodePool = {
  /**
   * ノードプールを作る。名前の形式はここで検証し、ノード数の既定は 3、ディスクは 100 GB（本物と同じ）。
   *
   * @param seed 材料。`version` はクラスタのマスターバージョン
   * @returns 作ったノードプール。名前の形式が悪ければ理由
   */
  create(
    seed: Readonly<{
      projectId: string;
      cluster: string;
      name: string;
      machineType: MachineTypeName;
      nodeCount: Option<number>;
      diskSizeGb: Option<number>;
      version: string;
    }>,
  ): Result<NodePool, string> {
    return Result.map(ResourceName.parse(seed.name), (name) => ({
      projectId: seed.projectId,
      cluster: seed.cluster,
      name,
      machineType: seed.machineType,
      nodeCount: Option.unwrapOr(seed.nodeCount, 3),
      diskSizeGb: Option.unwrapOr(seed.diskSizeGb, 100),
      version: seed.version,
    }));
  },

  /** 作成時にクラスタが持つ既定のプール。`node-pools list` に出す（保存しない）。 */
  defaultPool(cluster: GkeCluster): NodePool {
    return {
      projectId: cluster.projectId,
      cluster: cluster.name,
      name: "default-pool",
      machineType: cluster.machineType,
      nodeCount: cluster.nodeCount,
      diskSizeGb: 100,
      version: cluster.currentMasterVersion,
    };
  },

  toRecord(pool: NodePool): JsonRecord {
    return {
      name: pool.name,
      config: { machineType: pool.machineType, diskSizeGb: pool.diskSizeGb },
      initialNodeCount: pool.nodeCount,
      version: pool.version,
      status: "RUNNING",
    };
  },
} as const;
