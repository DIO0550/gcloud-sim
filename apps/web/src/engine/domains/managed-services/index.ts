import type { MachineTypeName, Region, Zone } from "@/engine/domains/catalog";
import { ResourceName } from "@/engine/domains/compute";
import type { JsonRecord } from "@/types/Json";
import { Result } from "@/utils/Result";

/** GKE クラスタ。ゾーン クラスタかリージョン クラスタか（`--zone` / `--region`）。 */
export type GkeCluster = Readonly<{
  projectId: string;
  name: string;
  location: Zone | Region;
  nodeCount: number;
  autopilot: boolean;
  status: "RUNNING";
  machineType: MachineTypeName;
  currentMasterVersion: string;
}>;

/** 収録している唯一のマスターバージョン。`--cluster-version` は受けない（DJ-005）。 */
const MasterVersion = "1.31.5-gke.1068000";

/** `GkeCluster.create` に渡す材料。Autopilot はノード数を持たない。 */
export type GkeClusterSeed = Readonly<{
  projectId: string;
  name: string;
  location: Zone | Region;
  machineType: MachineTypeName;
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
      status: "RUNNING",
      machineType: seed.machineType,
      currentMasterVersion: MasterVersion,
    }));
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
      nodeConfig: { machineType: cluster.machineType },
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
