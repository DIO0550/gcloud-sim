import { CommandFailure } from "@/engine/cli/command-failure";
import {
  CommandOutput,
  type CommandResult,
  OutputMessage,
  ParsedArgs,
  type ProjectContext,
} from "@/engine/cli/command-spec";
import { ImagePull } from "@/engine/domains/image-pull";
import { KubeRuntime } from "@/engine/domains/kube-config";
import { KubeHpa } from "@/engine/domains/kube-hpa";
import { KubeResources } from "@/engine/domains/kube-resources";
import { KubeDeployment, KubePod } from "@/engine/domains/kubernetes";
import type { GkeCluster } from "@/engine/domains/managed-services";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const invalid = (message: string) => Result.err(CommandFailure.invalidArgumentWith(message));
export const hpasOf = (world: World, cluster: GkeCluster) =>
  world.kubeHpas.filter((h) => h.projectId === cluster.projectId && h.cluster === cluster.name);
export const createHpa = (
  ctx: ProjectContext,
  cluster: GkeCluster,
  d: KubeDeployment,
  args: ParsedArgs,
): CommandResult => {
  const max = ParsedArgs.integer(args, "max");
  if (!Option.isSome(max)) return invalid("--max is required.");
  const h = KubeHpa.validate({
    projectId: cluster.projectId,
    cluster: cluster.name,
    name: Option.unwrapOr(ParsedArgs.string(args, "name"), d.name),
    target: d.name,
    minReplicas: Option.unwrapOr(ParsedArgs.integer(args, "min"), 1),
    maxReplicas: max.value,
    targetCpu: Option.unwrapOr(ParsedArgs.integer(args, "cpu-percent"), 80),
    createdAt: ctx.now,
    lastEvaluation: Option.none,
  });
  if (!Result.isOk(h)) return invalid(h.error);
  if (hpasOf(ctx.world, cluster).some((existing) => existing.name === h.value.name))
    return Result.err(
      CommandFailure.alreadyExistsWith(
        `horizontalpodautoscalers.autoscaling "${h.value.name}" already exists`,
      ),
    );
  if (hpasOf(ctx.world, cluster).some((existing) => existing.target === d.name))
    return invalid("Only one HPA per Deployment is supported on gcloud-sim.");
  return Result.ok({
    world: { ...ctx.world, kubeHpas: [...ctx.world.kubeHpas, h.value] },
    output: CommandOutput.messages(
      OutputMessage.plain(`horizontalpodautoscaler.autoscaling/${h.value.name} autoscaled`),
      OutputMessage.hint(
        "gcloud-sim: sim kubernetes reconcile NAME --cpu=250m で1 Podあたりの教材用CPU使用量を与え、1回評価します。",
      ),
    ),
  });
};
export const reconcileHpa = (
  ctx: ProjectContext,
  cluster: GkeCluster,
  args: ParsedArgs,
): CommandResult => {
  const name = ParsedArgs.requiredPositional(args, 0);
  const h = hpasOf(ctx.world, cluster).find((h) => h.name === name);
  if (!h)
    return Result.err(
      CommandFailure.notFoundWith(`horizontalpodautoscalers.autoscaling "${name}" not found`),
    );
  const cpu = ParsedArgs.string(args, "cpu");
  if (!Option.isSome(cpu)) return invalid("--cpu is required (CPU usage per Pod, e.g. 250m).");
  const resources = KubeResources.parse({ requests: { cpu: cpu.value } });
  if (!Result.isOk(resources)) return invalid(resources.error);
  const cpuMilli = KubeResources.cpuMilli(resources.value.requests.cpu);
  if (cpuMilli > 1_000_000_000)
    return invalid("Simulated CPU usage must not exceed 1000000000m per Pod.");
  const d = World.kubeDeploymentsOf(ctx.world, cluster).find((d) => d.name === h.target);
  const ready =
    d !== undefined &&
    !ImagePull.error(ctx.world, cluster, d.image) &&
    KubePod.fromDeployment(d).every((p) => !KubeRuntime.error(ctx.world.kubeConfigs, d, p.name));
  const evaluation = KubeHpa.evaluate(h, d, ready, cpuMilli, ctx.now);
  let world = ctx.world;
  if (d && d.replicas !== evaluation.desiredReplicas) {
    const scaled = KubeDeployment.withReplicas(d, evaluation.desiredReplicas);
    if (!Result.isOk(scaled)) return invalid(scaled.error);
    world = World.replaceKubeDeployment(world, scaled.value);
  }
  return Result.ok({
    world: {
      ...world,
      kubeHpas: world.kubeHpas.map((item) =>
        item === h ? { ...h, lastEvaluation: Option.some(evaluation) } : item,
      ),
    },
    output: CommandOutput.messages(
      OutputMessage.plain(
        `HPA ${h.name}: ${evaluation.currentReplicas} -> ${evaluation.desiredReplicas} replicas (${evaluation.reason})`,
      ),
      OutputMessage.hint(
        `gcloud-sim: 1 Podあたり${cpuMilli}mの教材用サンプルを1回評価しました。実測・定期実行・安定化待機は再現しません。`,
      ),
    ),
  });
};
