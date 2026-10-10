import { ContainerLab } from "@/engine/domains/container-lab";
import { EffectivePermissions } from "@/engine/domains/effective-permissions";
import { KubeLabels } from "@/engine/domains/kube-labels";
import { KubeMulti } from "@/engine/domains/kube-multi";
import { KubePod } from "@/engine/domains/kubernetes";
import type { World } from "@/engine/domains/world";

/** Fixed lesson identifiers keep cleanup from removing unrelated workloads. */
export const ContainerRelease = {
  id: "ace-release",
  projectId: "ace-dev-01",
  region: "us-central1",
  repository: "release-images",
  cluster: "release-gke",
  deployment: "release-web",
  container: "release-local",
  localTag: "release-local:v1",
  nodeAccount: "release-nodes@ace-dev-01.iam.gserviceaccount.com",
  image: "us-central1-docker.pkg.dev/ace-dev-01/release-images/hello:v1",
} as const;

export const localReleaseReady = (world: World): boolean => {
  const lesson = ContainerRelease;
  const container = world.containerLab.containers.find((c) => c.name === lesson.container);
  if (!container) {
    return false;
  }

  return (
    container.status === "RUNNING" &&
    container.hostPort === 8080 &&
    container.containerPort === 8080 &&
    container.imageId === ContainerLab.digest("hello-web") &&
    world.containerLab.images.some(
      (i) => i.id === container.imageId && i.tags.includes(lesson.localTag),
    )
  );
};

export const deployedReleaseReady = (world: World): boolean => {
  const lesson = ContainerRelease;
  const target = ContainerLab.registryReference(lesson.image);
  const published = world.containerLab.registryImages.some(
    (i) =>
      i.repositoryId === target.repositoryId &&
      i.name === target.image &&
      i.tags.includes(target.tag) &&
      i.digest === ContainerLab.digest("hello-web"),
  );
  if (!published) {
    return false;
  }

  const permissions = EffectivePermissions.resolve(world, `serviceAccount:${lesson.nodeAccount}`, {
    type: "artifact-repository",
    id: target.repositoryId,
  }).permissions;
  if (permissions.has("artifactregistry.repositories.uploadArtifacts")) {
    return false;
  }

  const cluster = world.clusters.find(
    (c) =>
      c.projectId === lesson.projectId &&
      c.location === lesson.region &&
      c.name === lesson.cluster &&
      c.nodeServiceAccount === lesson.nodeAccount,
  );
  if (!cluster) {
    return false;
  }

  const deployment = world.kubeDeployments.find(
    (d) =>
      d.projectId === lesson.projectId &&
      d.cluster === lesson.cluster &&
      d.namespace === "default" &&
      d.name === lesson.deployment &&
      d.image === lesson.image &&
      d.replicas === 2,
  );
  if (!deployment) {
    return false;
  }

  const pods = KubePod.fromDeployment(deployment);
  const ready = pods.every(
    (p) =>
      KubeMulti.readyCount(world, cluster, deployment, p.name) ===
      KubeMulti.spec(deployment).length,
  );
  if (!ready) {
    return false;
  }

  return world.kubeServices.some(
    (s) =>
      s.projectId === lesson.projectId &&
      s.cluster === lesson.cluster &&
      s.namespace === "default" &&
      s.name === lesson.deployment &&
      s.type === "LoadBalancer" &&
      s.port === 80 &&
      s.targetPort === 8080 &&
      KubeLabels.matches(s.selector, deployment.labels),
  );
};

export const releaseCleanupComplete = (world: World): boolean => {
  const lesson = ContainerRelease;
  const evidence = world.containerLab.releases.find((r) => r.id === lesson.id);
  if (evidence?.stage !== "DEPLOYMENT_VALIDATED") {
    return false;
  }

  const repositoryId = ContainerLab.registryReference(lesson.image).repositoryId;
  const targetCluster = (r: { projectId: string; cluster: string }): boolean =>
    r.projectId === lesson.projectId && r.cluster === lesson.cluster;

  return (
    !world.clusters.some((c) => c.projectId === lesson.projectId && c.name === lesson.cluster) &&
    !world.kubeDeployments.some(targetCluster) &&
    !world.kubeServices.some(targetCluster) &&
    !world.containerLab.repositories.some((r) => r.id === repositoryId) &&
    !world.containerLab.registryImages.some((i) => i.repositoryId === repositoryId) &&
    !world.containerLab.containers.some((c) => c.name === lesson.container) &&
    !world.containerLab.images.some((i) =>
      i.tags.some((t) => [lesson.localTag, lesson.image].some((tag) => tag === t)),
    ) &&
    !world.serviceAccounts.some((s) => s.email === lesson.nodeAccount)
  );
};
