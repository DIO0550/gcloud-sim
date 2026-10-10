import { EffectivePermissions } from "@/engine/domains/effective-permissions";
import { KubeLabels } from "@/engine/domains/kube-labels";
import { KubePod } from "@/engine/domains/kubernetes";
import type { Collector } from "@/engine/domains/observability-lab/model";
import type { World } from "@/engine/domains/world";

export const collectorStatus = (world: World, collector: Collector): string => {
  if (!collector.enabled) {
    return "DISABLED";
  }
  if (
    !world.projects.some(
      (p) => p.projectId === collector.projectId && p.lifecycleState === "ACTIVE",
    ) ||
    !world.serviceAccounts.some(
      (s) => s.email === collector.serviceAccount && s.projectId === collector.projectId,
    )
  ) {
    return "RESOURCE_OR_IDENTITY_UNAVAILABLE";
  }
  const project = world.projects.find((p) => p.projectId === collector.projectId);
  if (!project?.enabledApis.includes("monitoring.googleapis.com")) {
    return "MONITORING_API_DISABLED";
  }
  const permissions = EffectivePermissions.resolve(
    world,
    `serviceAccount:${collector.serviceAccount}`,
    { type: "project", id: collector.projectId },
  ).permissions;
  if (!permissions.has("monitoring.timeSeries.create")) {
    return "METRIC_WRITER_MISSING";
  }
  if (collector.kind === "ops-agent") {
    const vm = world.instances.find(
      (i) =>
        i.projectId === collector.projectId &&
        i.name === collector.resource &&
        i.zone === collector.location,
    );
    if (vm?.status !== "RUNNING" || vm.serviceAccount !== collector.serviceAccount) {
      return "ATTACHED_VM_IDENTITY_UNAVAILABLE";
    }
    const scopes = vm.scopes;
    const cloud = scopes.includes("https://www.googleapis.com/auth/cloud-platform");
    if (
      !cloud &&
      (!scopes.includes("https://www.googleapis.com/auth/logging.write") ||
        !scopes.includes("https://www.googleapis.com/auth/monitoring.write"))
    ) {
      return "WRITE_SCOPES_MISSING";
    }
    if (
      !project.enabledApis.includes("logging.googleapis.com") ||
      !permissions.has("logging.logEntries.create")
    ) {
      return "LOG_WRITER_OR_API_MISSING";
    }
    return "READY";
  }
  const cluster = world.clusters.find(
    (c) =>
      c.projectId === collector.projectId &&
      c.name === collector.resource &&
      c.location === collector.location,
  );
  if (
    !cluster ||
    cluster.nodeServiceAccount !== collector.serviceAccount ||
    !project.enabledApis.includes("container.googleapis.com")
  ) {
    return "CLUSTER_OR_NODE_IDENTITY_UNAVAILABLE";
  }
  if (collector.port !== 8080) {
    return "UNSUPPORTED_METRICS_ENDPOINT";
  }
  const targets = world.kubeDeployments.filter(
    (d) =>
      d.projectId === collector.projectId &&
      d.cluster === collector.resource &&
      d.namespace === collector.namespace &&
      KubeLabels.matches(collector.selector, d.podLabels),
  );
  if (
    !targets.some(
      (d) =>
        d.image === "gcr.io/google-samples/hello-app:1.0" &&
        KubePod.fromDeployment(d).some((pod) => pod.ready),
    )
  ) {
    return "PODMONITORING_TARGET_NOT_READY";
  }
  return "READY";
};
