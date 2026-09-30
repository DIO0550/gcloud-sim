import type { Region, Zone } from "@/engine/domains/catalog";
import type { JsonRecord } from "@/types/Json";

/** GKE クラスタ。ゾーン クラスタかリージョン クラスタか（`--zone` / `--region`）。 */
export type GkeCluster = Readonly<{
  projectId: string;
  name: string;
  location: Zone | Region;
  nodeCount: number;
  autopilot: boolean;
  status: "RUNNING";
  machineType: string;
  currentMasterVersion: string;
}>;

export const GkeCluster = {
  toRecord(cluster: GkeCluster): JsonRecord {
    return {
      name: cluster.name,
      location: cluster.location,
      status: cluster.status,
      currentMasterVersion: cluster.currentMasterVersion,
      currentNodeCount: cluster.autopilot ? 0 : cluster.nodeCount,
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
  url(service: CloudRunService): string {
    return `https://${service.name}-abc123-an.a.run.app`;
  },

  toRecord(service: CloudRunService): JsonRecord {
    return {
      metadata: { name: service.name, namespace: service.projectId },
      spec: { template: { spec: { containers: [{ image: service.image }] } } },
      status: {
        url: CloudRunService.url(service),
        latestReadyRevisionName: `${service.name}-00001-abc`,
      },
      region: service.region,
      allowUnauthenticated: service.allowUnauthenticated,
      lastDeployedAt: service.lastDeployedAt,
    };
  },
} as const;
