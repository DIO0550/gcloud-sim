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
export const MasterVersion = "1.31.5-gke.1068000";
export const NextMasterVersion = "1.32.2-gke.1182000";

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
    if (seed.nodes.kind === "standard" && !NodePool.validCount(seed.nodes.count))
      return Result.err("Node count must be an integer from 0 to 1000 on gcloud-sim.");
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
  autoRepair: boolean;
  autoUpgrade: boolean;
  autoscaling: Option<NodePoolAutoscaling>;
  lastScale: Option<NodePoolScale>;
}>;

export type NodePoolAutoscaling = Readonly<{ minNodes: number; maxNodes: number }>;
export type NodePoolScale = Readonly<{
  requiredNodes: number;
  beforeNodes: number;
  afterNodes: number;
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
      autoRepair?: boolean;
      autoUpgrade?: boolean;
      autoscaling?: Option<NodePoolAutoscaling>;
    }>,
  ): Result<NodePool, string> {
    const nodeCount = Option.unwrapOr(seed.nodeCount, 3);
    const diskSizeGb = Option.unwrapOr(seed.diskSizeGb, 100);
    const autoscaling = seed.autoscaling ?? Option.none;
    if (!NodePool.validCount(nodeCount))
      return Result.err("Node count must be an integer from 0 to 1000 on gcloud-sim.");
    if (!Number.isSafeInteger(diskSizeGb) || diskSizeGb < 10 || diskSizeGb > 65536)
      return Result.err("Disk size must be an integer from 10 to 65536 GB on gcloud-sim.");
    if (Option.isSome(autoscaling) && !NodePool.validLimits(autoscaling.value))
      return Result.err(
        "Autoscaling requires 0 <= min-nodes <= max-nodes <= 1000 and max-nodes > 0.",
      );
    return Result.map(ResourceName.parse(seed.name), (name) => ({
      projectId: seed.projectId,
      cluster: seed.cluster,
      name,
      machineType: seed.machineType,
      nodeCount,
      diskSizeGb,
      version: seed.version,
      autoRepair: seed.autoRepair ?? true,
      autoUpgrade: seed.autoUpgrade ?? true,
      autoscaling,
      lastScale: Option.none,
    }));
  },

  /** 作成時にクラスタが持つ既定のプール。`node-pools list` に出す（Worldへ保存する）。 */
  defaultPool(cluster: GkeCluster): NodePool {
    return {
      projectId: cluster.projectId,
      cluster: cluster.name,
      name: "default-pool",
      machineType: cluster.machineType,
      nodeCount: cluster.nodeCount,
      diskSizeGb: 100,
      version: cluster.currentMasterVersion,
      autoRepair: true,
      autoUpgrade: true,
      autoscaling: Option.none,
      lastScale: Option.none,
    };
  },

  validCount(n: number): boolean {
    return Number.isSafeInteger(n) && n >= 0 && n <= 1000;
  },

  validLimits(a: NodePoolAutoscaling): boolean {
    return (
      NodePool.validCount(a.minNodes) &&
      NodePool.validCount(a.maxNodes) &&
      a.minNodes <= a.maxNodes &&
      a.maxNodes > 0
    );
  },

  valid(pool: NodePool): boolean {
    if (
      !NodePool.validCount(pool.nodeCount) ||
      !Number.isSafeInteger(pool.diskSizeGb) ||
      pool.diskSizeGb < 10 ||
      pool.diskSizeGb > 65536 ||
      ![MasterVersion, NextMasterVersion].includes(pool.version)
    )
      return false;
    if (Option.isSome(pool.autoscaling) && !NodePool.validLimits(pool.autoscaling.value))
      return false;
    if (!Option.isSome(pool.lastScale)) return true;
    const e = pool.lastScale.value;
    return (
      Number.isSafeInteger(e.requiredNodes) &&
      e.requiredNodes >= 0 &&
      e.requiredNodes <= 1000000 &&
      NodePool.validCount(e.beforeNodes) &&
      e.afterNodes === pool.nodeCount &&
      Option.isSome(pool.autoscaling) &&
      e.afterNodes ===
        Math.max(
          pool.autoscaling.value.minNodes,
          Math.min(pool.autoscaling.value.maxNodes, e.requiredNodes),
        )
    );
  },

  resize(pool: NodePool, nodeCount: number): Result<NodePool, string> {
    if (!NodePool.validCount(nodeCount))
      return Result.err("Node count must be an integer from 0 to 1000 on gcloud-sim.");
    if (Option.isSome(pool.autoscaling))
      return Result.err(
        "Disable autoscaling with node-pools update --no-enable-autoscaling before manual resize on gcloud-sim.",
      );
    return Result.ok({ ...pool, nodeCount, lastScale: Option.none });
  },

  upgrade(pool: NodePool, masterVersion: string, target: string): Result<NodePool, string> {
    const versions = [MasterVersion, NextMasterVersion];
    if (!versions.includes(target)) return Result.err("Unsupported cluster-version on gcloud-sim.");
    if (versions.indexOf(target) > versions.indexOf(masterVersion))
      return Result.err(
        "Node version cannot be newer than the control plane. Upgrade --master first.",
      );
    if (versions.indexOf(target) < versions.indexOf(pool.version))
      return Result.err("Node downgrades are not supported on gcloud-sim.");
    if (pool.version === target)
      return Result.err(`Node pool ${pool.name} is already on version ${target}.`);
    return Result.ok({ ...pool, version: target });
  },

  scale(pool: NodePool, requiredNodes: number): Result<NodePool, string> {
    if (!Number.isSafeInteger(requiredNodes) || requiredNodes < 0 || requiredNodes > 1000000)
      return Result.err("required-nodes must be an integer from 0 to 1000000 on gcloud-sim.");
    if (!Option.isSome(pool.autoscaling))
      return Result.err("Autoscaling is disabled for this node pool.");
    const { minNodes, maxNodes } = pool.autoscaling.value;
    const nodeCount = Math.max(minNodes, Math.min(maxNodes, requiredNodes));
    return Result.ok({
      ...pool,
      nodeCount,
      lastScale: Option.some({ requiredNodes, beforeNodes: pool.nodeCount, afterNodes: nodeCount }),
    });
  },

  toRecord(pool: NodePool): JsonRecord {
    return {
      name: pool.name,
      initialNodeCount: pool.nodeCount,
      management: { autoRepair: pool.autoRepair, autoUpgrade: pool.autoUpgrade },
      autoscaling: Option.isSome(pool.autoscaling)
        ? { enabled: true, ...pool.autoscaling.value }
        : { enabled: false },
      config: { machineType: pool.machineType, diskSizeGb: pool.diskSizeGb },
      version: pool.version,
      status: "RUNNING",
    };
  },
} as const;
