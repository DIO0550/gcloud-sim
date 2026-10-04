import { ImagePull } from "@/engine/domains/image-pull";
import { KubeRuntime } from "@/engine/domains/kube-config";
import { KubeLabels } from "@/engine/domains/kube-labels";
import { KubePod, type KubeService } from "@/engine/domains/kubernetes";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";

/** Ready Pods matching every equality label in this cluster; no network or port probing. */
export const KubeServiceRouting = {
  backends(
    world: World,
    service: KubeService,
  ): readonly Readonly<{ deployment: string; pod: string; endpoint: string }>[] {
    const cluster = World.findCluster(world, service.projectId, service.cluster);
    if (!Option.isSome(cluster)) return [];
    return World.kubeDeploymentsOf(world, cluster.value).flatMap((d) => {
      if (
        !KubeLabels.matches(service.selector, d.podLabels) ||
        ImagePull.error(world, cluster.value, d.image)
      )
        return [];
      return KubePod.fromDeployment(d)
        .filter((p) => !KubeRuntime.error(world.kubeConfigs, d, p.name))
        .map((p) => ({
          deployment: d.name,
          pod: p.name,
          endpoint: `${p.ip}:${service.targetPort}`,
        }));
    });
  },
  endpoints(world: World, service: KubeService): readonly string[] {
    return KubeServiceRouting.backends(world, service).map((b) => b.endpoint);
  },
} as const;
