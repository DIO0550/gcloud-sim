import { GcloudConfig } from "@/engine/domains/gcloud-config";
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
