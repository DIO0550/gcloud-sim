import { CommandFailure } from "@/engine/cli/command-failure";
import {
  CommandOutput,
  type CommandResult,
  OutputMessage,
  ParsedArgs,
} from "@/engine/cli/command-spec";
import { ImagePull } from "@/engine/domains/image-pull";
import { KubeRuntime } from "@/engine/domains/kube-config";
import type { NetworkPolicyManifest } from "@/engine/domains/kube-manifest/network-policy";
import { KubeNamespace } from "@/engine/domains/kube-namespace";
import { KubeNetworkPolicy, type PolicyDecision } from "@/engine/domains/kube-network-policy";
import { KubePod } from "@/engine/domains/kubernetes";
import type { GkeCluster } from "@/engine/domains/managed-services";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";
import { kubePermission } from "./configuration";
import type { KubectlContext } from "./context";

export const removeNetworkPolicy = (
  ctx: KubectlContext,
  cluster: GkeCluster,
  name: string,
): CommandResult => {
  const current = KubeNetworkPolicy.of(ctx.world, cluster, ctx.namespace).find(
    (p) => p.name === name,
  );
  if (!current)
    return Result.err(
      CommandFailure.notFoundWith(`networkpolicies.networking.k8s.io "${name}" not found`),
    );
  return Result.ok({
    world: {
      ...ctx.world,
      kubeNetworkPolicies: ctx.world.kubeNetworkPolicies.filter((p) => p !== current),
    },
    output: CommandOutput.messages(
      OutputMessage.plain(`networkpolicy.networking.k8s.io/${name} deleted`),
    ),
  });
};

export const applyNetworkPolicy = (
  ctx: KubectlContext,
  cluster: GkeCluster,
  m: NetworkPolicyManifest,
  action: "create" | "apply" | "delete",
): CommandResult => {
  const current = KubeNetworkPolicy.of(ctx.world, cluster, ctx.namespace).find(
    (p) => p.name === m.name,
  );
  const verbs = action === "apply" ? ["get", current ? "update" : "create"] : [action];
  for (const verb of verbs) {
    const allowed = kubePermission(ctx, `container.networkPolicies.${verb}`);
    if (!Result.isOk(allowed)) return allowed;
  }
  if (action === "delete") return removeNetworkPolicy(ctx, cluster, m.name);
  if (action === "create" && current)
    return Result.err(CommandFailure.alreadyExistsWith(`networkpolicy "${m.name}" already exists`));
  const policy: KubeNetworkPolicy = {
    projectId: cluster.projectId,
    cluster: cluster.name,
    namespace: ctx.namespace,
    name: m.name,
    labels: m.labels,
    podSelector: m.podSelector,
    policyTypes: m.policyTypes,
    ingress: m.ingress,
    egress: m.egress,
    createdAt: current?.createdAt ?? ctx.now,
  };
  if (!KubeNetworkPolicy.valid(policy))
    return Result.err(CommandFailure.invalidArgumentWith("Invalid NetworkPolicy."));
  const unchanged = current && JSON.stringify(current) === JSON.stringify(policy);
  const policies = current
    ? ctx.world.kubeNetworkPolicies.map((p) => (p === current ? policy : p))
    : [...ctx.world.kubeNetworkPolicies, policy];
  const note = cluster.networkPolicyEnabled
    ? ""
    : "\ngcloud-sim: NetworkPolicy enforcement is disabled on this Standard cluster; this resource alone does not block traffic.";
  return Result.ok({
    world: unchanged ? ctx.world : { ...ctx.world, kubeNetworkPolicies: policies },
    output: CommandOutput.messages(
      OutputMessage.plain(
        `networkpolicy.networking.k8s.io/${m.name} ${unchanged ? "unchanged" : current ? "configured" : "created"}${note}`,
      ),
    ),
  });
};

const decisionText = (direction: string, d: PolicyDecision): string => {
  if (!d.isolated) return `${direction}: ALLOWED (not isolated)`;
  return `${direction}: ${d.allowed ? "ALLOWED" : "DENIED"}; selected by ${d.selecting.join(", ")}; allowing ${d.allowing.join(", ") || "<none>"}`;
};

/** Simulate one new TCP connection between the first live Pods of two Deployments. */
export const connectPods = (
  ctx: KubectlContext,
  cluster: GkeCluster,
  args: ParsedArgs,
): CommandResult => {
  const target = ParsedArgs.string(args, "to");
  const port = ParsedArgs.integer(args, "port");
  const sourceName = ParsedArgs.requiredPositional(args, 0);
  if (!Option.isSome(target) || !Option.isSome(port) || port.value < 1 || port.value > 65535)
    return Result.err(
      CommandFailure.invalidArgumentWith(
        "Use sim kubernetes connect SOURCE --to=DESTINATION --port=1..65535 (Deployment names).",
      ),
    );
  const targetNs = Option.unwrapOr(ParsedArgs.string(args, "to-namespace"), ctx.namespace);
  if (!KubeNamespace.valid(targetNs) || !KubeNamespace.exists(ctx.world, cluster, targetNs))
    return Result.err(
      CommandFailure.notFoundWith(`Destination namespace "${targetNs}" not found or invalid.`),
    );
  const sourceD = World.findKubeDeployment(ctx.world, cluster, sourceName, ctx.namespace);
  const targetD = World.findKubeDeployment(ctx.world, cluster, target.value, targetNs);
  if (!Option.isSome(sourceD) || !Option.isSome(targetD))
    return Result.err(
      CommandFailure.notFoundWith(
        "Source or destination Deployment not found in the selected cluster/namespace.",
      ),
    );
  const source = KubePod.fromDeployment(sourceD.value)[0];
  const destination = KubePod.fromDeployment(targetD.value)[0];
  if (!source || !destination)
    return Result.err(
      CommandFailure.invalidState(
        "Source and destination must each have a Pod; 0 replicas cannot connect.",
      ),
    );
  for (const [d, pod] of [
    [sourceD.value, source],
    [targetD.value, destination],
  ] as const) {
    const error =
      ImagePull.error(ctx.world, cluster, d.image) || KubeRuntime.error(ctx.world, d, pod.name);
    if (error)
      return Result.err(CommandFailure.invalidState(`Pod ${pod.name} is waiting: ${error}`));
  }
  const decision = KubeNetworkPolicy.check(ctx.world, cluster, source, destination, port.value);
  const route = `${source.namespace}/${source.name} -> ${destination.namespace}/${destination.name}:${port.value}`;
  if (!decision.enforced)
    return Result.ok({
      world: ctx.world,
      output: CommandOutput.messages(
        OutputMessage.plain(
          `ALLOWED (simulated TCP): ${route}\nNetworkPolicy enforcement is disabled; policies are not enforced. No real connection or process/listening-port check.`,
        ),
      ),
    });
  if (decision.self)
    return Result.ok({
      world: ctx.world,
      output: CommandOutput.messages(
        OutputMessage.plain(
          `ALLOWED (simulated TCP): ${route}\nA Pod cannot block access to itself. No real connection or process/listening-port check.`,
        ),
      ),
    });
  const detail = `${decisionText("Egress", decision.egress)}\n${decisionText("Ingress", decision.ingress)}`;
  if (!decision.allowed)
    return Result.err(
      CommandFailure.invalidState(
        `DENIED (simulated TCP): ${route}\n${detail}\nNetworkPolicy denies this new connection; Pod readiness and Service backends are unchanged.`,
      ),
    );
  return Result.ok({
    world: ctx.world,
    output: CommandOutput.messages(
      OutputMessage.plain(
        `ALLOWED (simulated TCP): ${route}\n${detail}\nNo real connection or process/listening-port check. Reply traffic is implicitly allowed for this connection.`,
      ),
    ),
  });
};
