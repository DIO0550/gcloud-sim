import { CommandFailure } from "@/engine/cli/command-failure";
import { CommandOutput, type CommandResult, OutputMessage } from "@/engine/cli/command-spec";
import { KubeRuntime } from "@/engine/domains/kube-config";
import { KubeLabels } from "@/engine/domains/kube-labels";
import type { StatefulManifest } from "@/engine/domains/kube-manifest/statefulsets";
import { KubeStatefulSet } from "@/engine/domains/kube-statefulset";
import { KubeDeployment } from "@/engine/domains/kubernetes";
import type { GkeCluster } from "@/engine/domains/managed-services";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";
import { kubePermission } from "./configuration";
import type { KubectlContext } from "./context";

const invalid = (message: string) => Result.err(CommandFailure.invalidArgumentWith(message));
const finish = (world: World, name: string, status: string): CommandResult =>
  Result.ok({
    world,
    output: CommandOutput.messages(OutputMessage.plain(`statefulset.apps/${name} ${status}`)),
  });

export const applyStatefulSet = (
  ctx: KubectlContext,
  cluster: GkeCluster,
  m: StatefulManifest,
  action: "apply" | "create" | "delete",
): CommandResult => {
  const current = World.kubeStatefulSetsOf(ctx.world, cluster, ctx.namespace).find(
    (s) => s.name === m.name,
  );
  for (const verb of action === "apply" ? ["get", current ? "update" : "create"] : [action]) {
    const allowed = kubePermission(ctx, `container.statefulSets.${verb}`);
    if (!Result.isOk(allowed)) return allowed;
  }

  if (action === "create" && current)
    return Result.err(CommandFailure.alreadyExistsWith(`statefulset "${m.name}" already exists`));
  if (action === "delete") {
    if (!current)
      return Result.err(CommandFailure.notFoundWith(`statefulset "${m.name}" not found`));
    return finish(
      World.withoutKubeStatefulSet(ctx.world, current),
      m.name,
      "deleted (PVCs retained)",
    );
  }
  if (
    current &&
    (!KubeLabels.equal(current.selector, m.selector) ||
      current.statefulSet.serviceName !== m.statefulSet.serviceName ||
      JSON.stringify(current.statefulSet.volumeClaimTemplates) !==
        JSON.stringify(m.statefulSet.volumeClaimTemplates))
  )
    return invalid(
      "StatefulSet selector, serviceName and volumeClaimTemplates are immutable; recreate the StatefulSet (PVCs are retained).",
    );

  const created = current
    ? Result.ok(current)
    : KubeDeployment.create({
        projectId: cluster.projectId,
        cluster: cluster.name,
        namespace: ctx.namespace,
        name: m.name,
        image: m.image,
        replicas: Option.fromNullable(m.replicas),
        labels: m.labels,
        selector: m.selector,
        podLabels: m.podLabels,
        createdAt: ctx.now,
      });
  if (!Result.isOk(created)) return invalid(created.error);

  const base = current
    ? KubeDeployment.withManifest(
        created.value,
        m.image,
        m.replicas ?? created.value.replicas,
        m.env,
        m.podLabels,
        m.labels,
        m.resources,
        m.readinessProbe,
        m.livenessProbe,
        m.startupProbe,
        m.volumes,
        m.volumeMounts,
      )
    : {
        ...created.value,
        volumes: m.volumes,
        volumeMounts: m.volumeMounts,
        revisions: created.value.revisions.map((r) => ({
          ...r,
          volumes: m.volumes,
          volumeMounts: m.volumeMounts,
        })),
      };
  const next: KubeStatefulSet = KubeStatefulSet.recordScale(ctx.world, current, {
    ...base,
    statefulSet: {
      ...m.statefulSet,
      ...(current?.statefulSet.lastScale ? { lastScale: current.statefulSet.lastScale } : {}),
    },
    podEnvironments: base.revision !== current?.revision ? [] : base.podEnvironments,
    podFiles: base.revision !== current?.revision ? [] : base.podFiles,
  });
  const checked = KubeStatefulSet.validate(KubeRuntime.reconcile(ctx.world, next));
  if (!Result.isOk(checked)) return invalid(checked.error);

  const conflict = KubeStatefulSet.claimConflict(ctx.world, next);
  if (conflict) return invalid(conflict);
  if (current) {
    if (base === current) return finish(ctx.world, m.name, "unchanged");
    return finish(World.replaceKubeWorkload(ctx.world, checked.value), m.name, "configured");
  }
  const added = World.withKubeStatefulSet(ctx.world, checked.value);
  if (!Result.isOk(added)) return Result.err(CommandFailure.alreadyExists(added.error.resource));
  return finish(added.value, m.name, "created");
};
