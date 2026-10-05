import { GcloudConfig } from "@/engine/domains/gcloud-config";
import { type ControlPlaneEndpoint, GkeControlPlane } from "@/engine/domains/gke-control-plane";
import type { GkeCluster } from "@/engine/domains/managed-services";
import type { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";

/** クラスタから導出するコンテキストと、ローカルの既定namespace設定。 */
export const KubeContext = {
  name(cluster: GkeCluster): string {
    return `gke_${cluster.projectId}_${cluster.location}_${cluster.name}`;
  },
  current(world: World, projectId: string): Option<GkeCluster> {
    return Option.flatMap(GcloudConfig.get(world.config, "container/cluster"), (name) =>
      Option.fromNullable(world.clusters.find((c) => c.projectId === projectId && c.name === name)),
    );
  },
  endpoint(world: World, cluster: GkeCluster): ControlPlaneEndpoint {
    return world.kubeContextEndpoints[KubeContext.name(cluster)] ?? "public";
  },
  server(world: World, cluster: GkeCluster): string {
    return `https://${Option.unwrapOr(GkeControlPlane.endpoint(cluster.controlPlane, KubeContext.endpoint(world, cluster)), "unavailable")}`;
  },
  setEndpoint(world: World, cluster: GkeCluster, endpoint: ControlPlaneEndpoint): World {
    const key = KubeContext.name(cluster);
    const { [key]: _previous, ...rest } = world.kubeContextEndpoints;
    return {
      ...world,
      kubeContextEndpoints: endpoint === "public" ? rest : { ...rest, [key]: endpoint },
    };
  },
  configuredNamespace(world: World, cluster: GkeCluster): string | undefined {
    return world.kubeContextNamespaces[KubeContext.name(cluster)];
  },
  namespace(world: World, cluster: GkeCluster): string {
    return KubeContext.configuredNamespace(world, cluster) ?? "default";
  },
  setNamespace(world: World, cluster: GkeCluster, namespace: string): World {
    const key = KubeContext.name(cluster);
    const { [key]: _previous, ...rest } = world.kubeContextNamespaces;
    return {
      ...world,
      kubeContextNamespaces: namespace === "" ? rest : { ...rest, [key]: namespace },
    };
  },
} as const;
