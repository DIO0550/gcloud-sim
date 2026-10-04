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
import { KubeReadiness } from "@/engine/domains/kube-readiness";
import { KubePod } from "@/engine/domains/kubernetes";
import type { GkeCluster } from "@/engine/domains/managed-services";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

export const probeReadiness = (
  ctx: ProjectContext,
  cluster: GkeCluster,
  args: ParsedArgs,
): CommandResult => {
  const invalid = (reason: string) => Result.err(CommandFailure.invalidArgumentWith(reason));
  const name = ParsedArgs.requiredPositional(args, 0);
  const found = World.findKubeDeployment(ctx.world, cluster, name);
  if (!Option.isSome(found))
    return Result.err(CommandFailure.notFoundWith(`deployment "${name}" not found`));
  const d = found.value;
  if (!Option.isSome(d.readinessProbe))
    return invalid("Deployment has no readinessProbe; configure it with a manifest first.");
  const probe = d.readinessProbe.value;
  const code = ParsedArgs.integer(args, "status-code");
  if (!Option.isSome(code) || code.value < 100 || code.value > 599)
    return invalid("--status-code must be an HTTP response code from 100 to 599.");
  const selected = ParsedArgs.string(args, "pod");
  const pods = KubePod.fromDeployment(d).filter(
    (p) => !Option.isSome(selected) || p.name === selected.value,
  );
  if (!pods.length)
    return invalid("No matching Pod; check the Deployment replicas and --pod name.");
  for (const pod of pods) {
    const error =
      ImagePull.error(ctx.world, cluster, d.image) ||
      KubeRuntime.error(ctx.world.kubeConfigs, d, pod.name);
    if (error) return Result.err(CommandFailure.invalidState(`Cannot probe ${pod.name}: ${error}`));
  }
  const samples = pods.map((p) =>
    KubeReadiness.evaluate(
      probe,
      p.name,
      d.podReadiness.find((s) => s.podName === p.name),
      code.value,
    ),
  );
  const names = new Set(samples.map((s) => s.podName));
  const next = {
    ...d,
    podReadiness: [...d.podReadiness.filter((s) => !names.has(s.podName)), ...samples],
  };
  return Result.ok({
    world: World.replaceKubeDeployment(ctx.world, next),
    output: CommandOutput.messages(
      ...samples.map((s) =>
        OutputMessage.plain(
          `${s.podName}: ${s.ready ? "Ready" : "NotReady"} (HTTP ${s.statusCode}, success=${s.successes}, failure=${s.failures})`,
        ),
      ),
      OutputMessage.hint(
        "gcloud-sim: 指定したHTTP応答を各Podに1回ずつ適用しました。実通信・定期実行・待ち時間・再起動はありません。",
      ),
    ),
  });
};
