import { CommandFailure } from "@/engine/cli/command-failure";
import {
  CommandOutput,
  type CommandResult,
  OutputMessage,
  ParsedArgs,
} from "@/engine/cli/command-spec";
import { KubeIngress } from "@/engine/domains/kube-ingress";
import type { IngressManifest } from "@/engine/domains/kube-manifest/ingress";
import type { GkeCluster } from "@/engine/domains/managed-services";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";
import { kubePermission } from "./configuration";
import type { KubectlContext } from "./context";

export const removeIngress = (
  ctx: KubectlContext,
  cluster: GkeCluster,
  name: string,
): CommandResult => {
  const current = KubeIngress.of(ctx.world, cluster, ctx.namespace).find((i) => i.name === name);
  if (!current)
    return Result.err(
      CommandFailure.notFoundWith(`ingresses.networking.k8s.io "${name}" not found`),
    );
  return Result.ok({
    world: { ...ctx.world, kubeIngresses: ctx.world.kubeIngresses.filter((i) => i !== current) },
    output: CommandOutput.messages(
      OutputMessage.plain(`ingress.networking.k8s.io/${name} deleted`),
    ),
  });
};

export const applyIngress = (
  ctx: KubectlContext,
  cluster: GkeCluster,
  m: IngressManifest,
  action: "create" | "apply" | "delete",
): CommandResult => {
  const current = KubeIngress.of(ctx.world, cluster, ctx.namespace).find((i) => i.name === m.name);
  const verbs = action === "apply" ? ["get", current ? "update" : "create"] : [action];
  for (const verb of verbs) {
    const allowed = kubePermission(ctx, `container.ingresses.${verb}`);
    if (!Result.isOk(allowed)) return allowed;
  }
  if (action === "delete") return removeIngress(ctx, cluster, m.name);
  if (action === "create" && current)
    return Result.err(CommandFailure.alreadyExistsWith(`ingress "${m.name}" already exists`));
  const ingress: KubeIngress = {
    projectId: cluster.projectId,
    cluster: cluster.name,
    namespace: ctx.namespace,
    name: m.name,
    labels: m.labels,
    annotations: m.annotations,
    paths: m.paths,
    defaultBackend: m.defaultBackend,
    createdAt: current?.createdAt ?? ctx.now,
  };
  const unchanged = current && JSON.stringify(current) === JSON.stringify(ingress);
  return Result.ok({
    world: unchanged
      ? ctx.world
      : {
          ...ctx.world,
          kubeIngresses: current
            ? ctx.world.kubeIngresses.map((i) => (i === current ? ingress : i))
            : [...ctx.world.kubeIngresses, ingress],
        },
    output: CommandOutput.messages(
      OutputMessage.plain(
        `ingress.networking.k8s.io/${m.name} ${unchanged ? "unchanged" : current ? "configured" : "created"}`,
      ),
    ),
  });
};

export const requestIngress = (
  ctx: KubectlContext,
  cluster: GkeCluster,
  args: ParsedArgs,
): CommandResult => {
  const host = ParsedArgs.string(args, "host");
  const path = Option.unwrapOr(ParsedArgs.string(args, "path"), "/");
  if (
    !Option.isSome(host) ||
    !host.value ||
    !KubeIngress.validHost(host.value.toLowerCase()) ||
    !KubeIngress.validPath(path)
  )
    return Result.err(
      CommandFailure.invalidArgumentWith(
        "Use sim kubernetes request INGRESS --host=example.test --path=/path (HTTP routing only).",
      ),
    );
  const name = ParsedArgs.requiredPositional(args, 0);
  const ingress = KubeIngress.of(ctx.world, cluster, ctx.namespace).find((i) => i.name === name);
  if (!ingress) return Result.err(CommandFailure.notFoundWith(`Ingress "${name}" not found.`));
  const route = KubeIngress.request(ctx.world, ingress, host.value, path);
  if (!Result.isOk(route)) return Result.err(CommandFailure.invalidState(route.error));
  return Result.ok({
    world: ctx.world,
    output: CommandOutput.messages(
      OutputMessage.plain(
        `ROUTED (simulated HTTP): ${host.value}${path}\nRule: ${route.value.matched}\nService: ${ctx.namespace}/${route.value.backend.name}:${route.value.backend.port}\nReady endpoints: ${route.value.endpoints.join(", ")}\nNo real LB, DNS, TLS, HTTP health check or external-client NetworkPolicy evaluation.`,
      ),
    ),
  });
};
