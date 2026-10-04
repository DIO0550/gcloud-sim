import { ImagePull } from "@/engine/domains/image-pull";
import { KubeRuntime } from "@/engine/domains/kube-config";
import { KubePod, type KubeService } from "@/engine/domains/kubernetes";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";

/** Derived ready backends for the supported app label; no network request or port probing. */
export const KubeServiceRouting = {
  endpoints(world: World, service: KubeService): readonly string[] {
    const cluster = World.findCluster(world, service.projectId, service.cluster);
    if (!Option.isSome(cluster)) return [];
    const d = World.findKubeDeployment(world, cluster.value, service.targetDeployment);
    if (!Option.isSome(d) || ImagePull.error(world, cluster.value, d.value.image)) return [];
    return KubePod.fromDeployment(d.value)
      .filter((p) => !KubeRuntime.error(world.kubeConfigs, d.value, p.name))
      .map((p) => `${p.ip}:${service.targetPort}`);
  },
} as const;
