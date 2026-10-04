import { CommandFailure } from "@/engine/cli/command-failure";
import {
  CommandOutput,
  type CommandResult,
  OutputMessage,
  ParsedArgs,
} from "@/engine/cli/command-spec";
import { ImagePull } from "@/engine/domains/image-pull";
import { KubeRuntime } from "@/engine/domains/kube-config";
import { KubeContainer } from "@/engine/domains/kube-container";
import { KubeLiveness } from "@/engine/domains/kube-liveness";
import { KubeReadiness } from "@/engine/domains/kube-readiness";
import { KubeStartup } from "@/engine/domains/kube-startup";
import { KubePod } from "@/engine/domains/kubernetes";
import type { GkeCluster } from "@/engine/domains/managed-services";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";
import type { KubectlContext } from "./context";

export const probeContainers = (
  ctx: KubectlContext,
  cluster: GkeCluster,
  args: ParsedArgs,
): CommandResult => {
  const invalid = (reason: string) => Result.err(CommandFailure.invalidArgumentWith(reason));
  const kind = Option.unwrapOr(ParsedArgs.string(args, "kind"), "readiness");
  if (kind !== "readiness" && kind !== "liveness" && kind !== "startup")
    return invalid("--kind must be readiness, liveness or startup.");
  const name = ParsedArgs.requiredPositional(args, 0);
  const found = World.findKubeDeployment(ctx.world, cluster, name, ctx.namespace);
  if (!Option.isSome(found))
    return Result.err(CommandFailure.notFoundWith(`deployment "${name}" not found`));
  const d = found.value;
  const configured = {
    readiness: d.readinessProbe,
    liveness: d.livenessProbe,
    startup: d.startupProbe,
  }[kind];
  if (!Option.isSome(configured))
    return invalid(`Deployment has no ${kind}Probe; configure it with a manifest first.`);
  const probe = configured.value;
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
    if (kind !== "startup" && !KubeContainer.started(d, pod.name))
      return Result.err(
        CommandFailure.invalidState(
          `StartupProbePending: ${pod.name} must pass startup before readiness/liveness evaluation.`,
        ),
      );
    if (kind === "startup" && KubeContainer.started(d, pod.name))
      return Result.err(
        CommandFailure.invalidState(
          `StartupProbeCompleted: ${pod.name} has already passed startup; it is disabled until container restart.`,
        ),
      );
  }
  if (kind === "startup") {
    const samples = pods.map((p) =>
      KubeStartup.evaluate(
        probe,
        p.name,
        d.podStartup.find((s) => s.podName === p.name),
        code.value,
        KubeContainer.restarts(d, p.name),
      ),
    );
    if (samples.some((s) => !Number.isSafeInteger(s.restarts)))
      return invalid("Container restart count limit reached.");
    return Result.ok({
      world: World.replaceKubeDeployment(ctx.world, KubeStartup.withSamples(d, samples)),
      output: CommandOutput.messages(
        ...samples.map((s) =>
          OutputMessage.plain(
            `${s.podName}: ${s.started ? "Startup succeeded" : "Startup pending"} (HTTP ${s.statusCode}, failure=${s.failures}, RESTARTS=${s.restarts}, restarted=${s.restarted})`,
          ),
        ),
        OutputMessage.hint(
          "gcloud-sim: startup応答を1回評価しました。成功するまでreadiness/livenessは評価できません。失敗閾値で同じPod内のコンテナを即時再起動し、再びstartupから確認します。実通信・定期実行・待機・backoffはありません。",
        ),
      ),
    });
  }
  if (kind === "liveness") {
    const samples = pods.map((p) =>
      KubeLiveness.evaluate(
        probe,
        p.name,
        d.podLiveness.find((s) => s.podName === p.name),
        code.value,
        KubeContainer.restarts(d, p.name),
      ),
    );
    if (samples.some((s) => !Number.isSafeInteger(s.restarts)))
      return invalid("Container restart count limit reached.");
    const world = World.replaceKubeDeployment(ctx.world, KubeLiveness.withSamples(d, samples));
    return Result.ok({
      world,
      output: CommandOutput.messages(
        ...samples.map((s) =>
          OutputMessage.plain(
            `${s.podName}: ${s.restarted ? "Container restarted" : "No restart"} (HTTP ${s.statusCode}, failure=${s.failures}, RESTARTS=${s.restarts})`,
          ),
        ),
        OutputMessage.hint(
          "gcloud-sim: liveness応答を1回評価しました。閾値に達すると同じPod内のコンテナを即時再起動し、環境変数を読み直し、startup/readinessを未評価に戻します。実通信・定期実行・待機・backoffは再現しません。",
        ),
      ),
    });
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
