import { CommandFailure } from "@/engine/cli/command-failure";
import { CommandOutput, type CommandResult, OutputMessage } from "@/engine/cli/command-spec";
import { KubeNamespace } from "@/engine/domains/kube-namespace";
import type { GkeCluster } from "@/engine/domains/managed-services";
import { World } from "@/engine/domains/world";
import { Result } from "@/utils/Result";
import { kubePermission } from "./configuration";
import type { KubectlContext } from "./context";

export const applyNamespace = (
  ctx: KubectlContext,
  cluster: GkeCluster,
  name: string,
  action: "create" | "apply" | "delete",
): CommandResult => {
  if (!KubeNamespace.valid(name))
    return Result.err(
      CommandFailure.invalidArgumentWith(
        "Namespace must be a lowercase DNS label of at most 63 characters.",
      ),
    );
  const exists = KubeNamespace.exists(ctx.world, cluster, name);
  const verbs = action === "apply" ? ["get", exists ? "update" : "create"] : [action];
  for (const verb of verbs) {
    const allowed = kubePermission(ctx, `container.namespaces.${verb}`);
    if (!Result.isOk(allowed)) return allowed;
  }
  if (action === "create" && exists)
    return Result.err(CommandFailure.alreadyExistsWith(`namespaces "${name}" already exists`));
  if (action === "delete" && !exists)
    return Result.err(CommandFailure.notFoundWith(`namespaces "${name}" not found`));
  if (action === "delete" && KubeNamespace.builtin(name))
    return Result.err(
      CommandFailure.invalidArgumentWith(
        "Deleting built-in namespaces is not supported on gcloud-sim.",
      ),
    );
  const finish = (world: KubectlContext["world"], status: string): CommandResult =>
    Result.ok({
      world,
      output: CommandOutput.messages(OutputMessage.plain(`namespace/${name} ${status}`)),
    });
  if (action === "apply" && exists) return finish(ctx.world, "unchanged");
  const sameCluster = (r: { projectId: string; cluster: string }) =>
    r.projectId === cluster.projectId && r.cluster === cluster.name;
  if (action === "delete") {
    const keep = (r: { projectId: string; cluster: string; namespace: string }) =>
      !sameCluster(r) || r.namespace !== name;
    return finish(
      World.reconcileKubeStorage({
        ...ctx.world,
        kubeNamespaces: ctx.world.kubeNamespaces.filter((n) => !sameCluster(n) || n.name !== name),
        kubeDeployments: ctx.world.kubeDeployments.filter(keep),
        kubeStatefulSets: ctx.world.kubeStatefulSets.filter(keep),
        kubeServices: ctx.world.kubeServices.filter(keep),
        kubeIngresses: ctx.world.kubeIngresses.filter(keep),
        kubeNetworkPolicies: ctx.world.kubeNetworkPolicies.filter(keep),
        kubeConfigs: ctx.world.kubeConfigs.filter(keep),
        kubeHpas: ctx.world.kubeHpas.filter(keep),
        kubeVpas: ctx.world.kubeVpas.filter(keep),
        kubeServiceAccounts: ctx.world.kubeServiceAccounts.filter(keep),
        kubePvcs: ctx.world.kubePvcs.map((c) => (keep(c) ? c : { ...c, deleting: ctx.now })),
      }),
      "deleted",
    );
  }
  return finish(
    {
      ...ctx.world,
      kubeNamespaces: [
        ...ctx.world.kubeNamespaces,
        { projectId: cluster.projectId, cluster: cluster.name, name, createdAt: ctx.now },
      ],
    },
    "created",
  );
};
