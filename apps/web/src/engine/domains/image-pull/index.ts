import { ContainerLab } from "@/engine/domains/container-lab";
import { EffectivePermissions } from "@/engine/domains/effective-permissions";
import type { GkeCluster } from "@/engine/domains/managed-services";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";

/** Lesson readiness is recalculated from current registry/IAM state; no node cache or retry timer. */
export const ImagePull = {
  error(world: World, cluster: GkeCluster, image: string): string {
    // Existing public/sample image behavior is retained; only Artifact Registry is resolved.
    if (!image.includes(".pkg.dev")) return "";
    try {
      const ref = ContainerLab.registryReference(image);
      const repo = world.containerLab.repositories.find((r) => r.id === ref.repositoryId);
      if (!repo) return "ImagePullBackOff: repository not found";
      if (
        !Option.isSome(World.findActiveProject(world, ref.projectId)) ||
        !World.hasApi(world, ref.projectId, "artifactregistry.googleapis.com")
      )
        return "ImagePullBackOff: registry project inactive or API disabled";
      if (
        !cluster.nodeServiceAccount ||
        !world.serviceAccounts.some((s) => s.email === cluster.nodeServiceAccount)
      )
        return "ImagePullBackOff: configure an existing node service account using --service-account";
      const permissions = EffectivePermissions.resolve(
        world,
        `serviceAccount:${cluster.nodeServiceAccount}`,
        { type: "artifact-repository", id: repo.id },
      );
      if (!permissions.permissions.has("artifactregistry.repositories.downloadArtifacts"))
        return "ImagePullBackOff: node service account lacks artifactregistry.repositories.downloadArtifacts";
      const found = world.containerLab.registryImages.some(
        (i) =>
          i.repositoryId === repo.id &&
          i.name === ref.image &&
          (ref.digest ? i.digest === ref.digest : i.tags.includes(ref.tag)),
      );
      return found ? "" : "ImagePullBackOff: image tag or digest not found";
    } catch {
      return "ImagePullBackOff: invalid Artifact Registry image reference";
    }
  },
} as const;
