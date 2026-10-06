import { CommandFailure } from "@/engine/cli/command-failure";
import { CommandOutput, type CommandResult, OutputMessage } from "@/engine/cli/command-spec";
import { KubeIdentity } from "@/engine/domains/gke-completion";
import { KubeLabels } from "@/engine/domains/kube-labels";
import type { WorkloadManifest } from "@/engine/domains/kube-manifest/workloads";
import { KubeMulti } from "@/engine/domains/kube-multi";
import { KubeDeployment, KubeService } from "@/engine/domains/kubernetes";
import type { GkeCluster } from "@/engine/domains/managed-services";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";
import { kubePermission } from "./configuration";
import type { KubectlContext } from "./context";

export const applyWorkload = (
  ctx: KubectlContext,
  cluster: GkeCluster,
  manifest: WorkloadManifest,
  action: "apply" | "create" | "delete",
): CommandResult => {
  const exists =
    manifest.kind === "deployment"
      ? Option.isSome(World.findKubeDeployment(ctx.world, cluster, manifest.name, ctx.namespace))
      : Option.isSome(World.findKubeService(ctx.world, cluster, manifest.name, ctx.namespace));
  const permission = `container.${manifest.kind === "deployment" ? "deployments" : "services"}`;
  const verbs = action === "apply" ? ["get", exists ? "update" : "create"] : [action];
  for (const verb of verbs) {
    const allowed = kubePermission(ctx, `${permission}.${verb}`);
    if (!Result.isOk(allowed)) return allowed;
  }
  if (action === "create" && exists)
    return Result.err(
      CommandFailure.alreadyExistsWith(`${manifest.kind} "${manifest.name}" already exists`),
    );
  if (action === "delete" && !exists)
    return Result.err(CommandFailure.notFoundWith(`${manifest.kind} "${manifest.name}" not found`));
  const finish = (world: World, status: string): CommandResult =>
    Result.ok({
      world,
      output: CommandOutput.messages(
        OutputMessage.plain(
          `${manifest.kind === "deployment" ? "deployment.apps" : "service"}/${manifest.name} ${status}`,
        ),
      ),
    });
  if (manifest.kind === "deployment") {
    if (
      action !== "delete" &&
      !KubeIdentity.accounts(ctx.world, cluster, ctx.namespace).some(
        (s) => s.name === manifest.serviceAccountName,
      )
    ) {
      return Result.err(
        CommandFailure.invalidArgumentWith(
          "Pod serviceAccountName refers to a missing ServiceAccount in this namespace.",
        ),
      );
    }
    const current = World.findKubeDeployment(ctx.world, cluster, manifest.name, ctx.namespace);
    if (Option.isSome(current)) {
      if (action === "delete")
        return finish(World.withoutKubeDeployment(ctx.world, current.value), "deleted");
      if (!KubeLabels.equal(current.value.selector, manifest.selector))
        return Result.err(
          CommandFailure.invalidArgumentWith(
            "Deployment spec.selector is immutable; recreate the Deployment to change it.",
          ),
        );
      const next = KubeDeployment.withManifest(
        current.value,
        manifest.image,
        manifest.replicas ?? current.value.replicas,
        manifest.env,
        manifest.podLabels,
        manifest.labels,
        manifest.resources,
        manifest.readinessProbe,
        manifest.livenessProbe,
        manifest.startupProbe,
        manifest.volumes,
        manifest.volumeMounts,
        manifest.extraContainers,
        manifest.containerName,
        manifest.serviceAccountName,
      );
      if (next === current.value) return finish(ctx.world, "unchanged");
      return finish(World.replaceKubeDeployment(ctx.world, next), "configured");
    }
    const created = KubeDeployment.create({
      projectId: cluster.projectId,
      cluster: cluster.name,
      namespace: ctx.namespace,
      name: manifest.name,
      image: manifest.image,
      labels: manifest.labels,
      selector: manifest.selector,
      podLabels: manifest.podLabels,
      replicas: Option.fromNullable(manifest.replicas),
      createdAt: ctx.now,
    });
    if (!Result.isOk(created)) return Result.err(CommandFailure.invalidArgumentWith(created.error));
    const deployment = {
      ...created.value,
      extraContainers: manifest.extraContainers.map(KubeMulti.fresh),
      containerName: manifest.containerName,
      serviceAccountName: manifest.serviceAccountName,
      env: manifest.env,
      volumes: manifest.volumes,
      volumeMounts: manifest.volumeMounts,
      resources: manifest.resources,
      readinessProbe: manifest.readinessProbe,
      livenessProbe: manifest.livenessProbe,
      startupProbe: manifest.startupProbe,
      revisions: created.value.revisions.map((r) => ({
        ...r,
        extraContainers: manifest.extraContainers,
        containerName: manifest.containerName,
        serviceAccountName: manifest.serviceAccountName,
        env: manifest.env,
        volumes: manifest.volumes,
        volumeMounts: manifest.volumeMounts,
        resources: manifest.resources,
        readinessProbe: manifest.readinessProbe,
        livenessProbe: manifest.livenessProbe,
        startupProbe: manifest.startupProbe,
      })),
    };
    const added = World.withKubeDeployment(ctx.world, deployment);
    if (!Result.isOk(added)) return Result.err(CommandFailure.alreadyExists(added.error.resource));
    return finish(added.value, "created");
  }
  const current = World.findKubeService(ctx.world, cluster, manifest.name, ctx.namespace);
  if (Option.isSome(current)) {
    const service = current.value;
    if (action === "delete") return finish(World.withoutKubeService(ctx.world, service), "deleted");
    if (service.type !== manifest.type || (service.clusterIp === "None") !== manifest.headless)
      return Result.err(
        CommandFailure.invalidArgumentWith(
          "Changing Service type or headless clusterIP via apply is not supported on gcloud-sim; recreate it explicitly.",
        ),
      );
    const next = {
      ...service,
      port: manifest.port,
      targetPort: manifest.targetPort,
      selector: manifest.selector,
      labels: manifest.labels,
    };
    if (
      next.port === service.port &&
      next.targetPort === service.targetPort &&
      KubeLabels.equal(next.labels, service.labels) &&
      KubeLabels.equal(next.selector, service.selector)
    )
      return finish(ctx.world, "unchanged");
    return finish(
      { ...ctx.world, kubeServices: ctx.world.kubeServices.map((s) => (s === service ? next : s)) },
      "configured",
    );
  }
  const numbered = World.nextNumber(ctx.world);
  const created = KubeService.create({
    ...manifest,
    projectId: cluster.projectId,
    cluster: cluster.name,
    namespace: ctx.namespace,
    targetPort: Option.some(manifest.targetPort),
    clusterIp: manifest.headless
      ? "None"
      : `10.20.${(numbered.number >> 8) % 256}.${numbered.number % 256}`,
    externalIp: `34.85.${(numbered.number >> 8) % 256}.${numbered.number % 256}`,
    createdAt: ctx.now,
  });
  if (!Result.isOk(created)) return Result.err(CommandFailure.invalidArgumentWith(created.error));
  const added = World.withKubeService(numbered.world, created.value);
  if (!Result.isOk(added)) return Result.err(CommandFailure.alreadyExists(added.error.resource));
  return finish(added.value, "created");
};
