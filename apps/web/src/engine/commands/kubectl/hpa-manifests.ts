import { CommandFailure } from "@/engine/cli/command-failure";
import { CommandOutput, type CommandResult, OutputMessage } from "@/engine/cli/command-spec";
import { KubeHpa } from "@/engine/domains/kube-hpa";
import type { HpaManifest } from "@/engine/domains/kube-manifest/hpa";
import type { GkeCluster } from "@/engine/domains/managed-services";
import type { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";
import { kubePermission } from "./configuration";
import type { KubectlContext } from "./context";
import { hpasOf } from "./hpa";

export const applyHpa = (
  ctx: KubectlContext,
  cluster: GkeCluster,
  manifest: HpaManifest,
  action: "apply" | "create" | "delete",
): CommandResult => {
  const existing = hpasOf(ctx.world, cluster, ctx.namespace).find((h) => h.name === manifest.name);
  const verbs = action === "apply" ? ["get", existing ? "update" : "create"] : [action];
  for (const verb of verbs) {
    const allowed = kubePermission(ctx, `container.horizontalPodAutoscalers.${verb}`);
    if (!Result.isOk(allowed)) return allowed;
  }
  const finish = (world: World, status: string): CommandResult =>
    Result.ok({
      world,
      output: CommandOutput.messages(
        OutputMessage.plain(`horizontalpodautoscaler.autoscaling/${manifest.name} ${status}`),
      ),
    });
  if (action === "create" && existing)
    return Result.err(
      CommandFailure.alreadyExistsWith(
        `horizontalpodautoscalers.autoscaling "${manifest.name}" already exists`,
      ),
    );
  if (action === "delete") {
    if (!existing)
      return Result.err(
        CommandFailure.notFoundWith(
          `horizontalpodautoscalers.autoscaling "${manifest.name}" not found`,
        ),
      );
    return finish(
      { ...ctx.world, kubeHpas: ctx.world.kubeHpas.filter((h) => h !== existing) },
      "deleted",
    );
  }
  if (
    hpasOf(ctx.world, cluster, ctx.namespace).some(
      (h) => h !== existing && h.target === manifest.target,
    )
  )
    return Result.err(
      CommandFailure.invalidArgumentWith("Only one HPA per Deployment is supported on gcloud-sim."),
    );
  if (
    ctx.world.kubeVpas.some(
      (v) =>
        v.projectId === cluster.projectId &&
        v.cluster === cluster.name &&
        v.namespace === ctx.namespace &&
        v.target === manifest.target &&
        v.mode !== "Off",
    )
  ) {
    return Result.err(
      CommandFailure.invalidArgumentWith("CPU HPA conflicts with automatic CPU VPA."),
    );
  }
  if (existing && KubeHpa.sameSpec(existing, manifest)) return finish(ctx.world, "unchanged");
  // A new spec invalidates the teaching sample; only an explicit reconcile evaluates it again.
  const next: KubeHpa = {
    projectId: cluster.projectId,
    cluster: cluster.name,
    namespace: ctx.namespace,
    name: manifest.name,
    target: manifest.target,
    minReplicas: manifest.minReplicas,
    maxReplicas: manifest.maxReplicas,
    targetCpu: manifest.targetCpu,
    createdAt: existing?.createdAt ?? ctx.now,
    lastEvaluation: Option.none,
  };
  if (!existing)
    return finish({ ...ctx.world, kubeHpas: [...ctx.world.kubeHpas, next] }, "created");
  return finish(
    { ...ctx.world, kubeHpas: ctx.world.kubeHpas.map((h) => (h === existing ? next : h)) },
    "configured",
  );
};
