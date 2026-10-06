import { CommandFailure } from "@/engine/cli/command-failure";
import { ParsedArgs as Args, type ParsedArgs } from "@/engine/cli/command-spec";
import { NodePool, type NodePoolAutoscaling } from "@/engine/domains/managed-services";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

/** Reject ignored autoscaler flags instead of reporting success for an unapplied setting. */
export const autoscalingArgs = (
  args: ParsedArgs,
  current: Option<NodePoolAutoscaling>,
): Result<Option<NodePoolAutoscaling>, CommandFailure> => {
  const enabled = Args.booleanChoice(args, "enable-autoscaling");
  const min = Args.integer(args, "min-nodes");
  const max = Args.integer(args, "max-nodes");
  const limits = Option.isSome(min) || Option.isSome(max);
  if (limits && (!Option.isSome(enabled) || !enabled.value))
    return Result.err(
      CommandFailure.invalidState(
        "min-nodes/max-nodes require --enable-autoscaling on gcloud-sim.",
      ),
    );
  if (!Option.isSome(enabled)) return Result.ok(current);
  if (!enabled.value) return Result.ok(Option.none);
  const previous = Option.isSome(current) ? current.value : { minNodes: 0, maxNodes: 0 };
  const next = {
    minNodes: Option.unwrapOr(min, previous.minNodes),
    maxNodes: Option.unwrapOr(max, previous.maxNodes),
  };
  if (!NodePool.validLimits(next))
    return Result.err(
      CommandFailure.invalidState(
        "Autoscaling requires 0 <= min-nodes <= max-nodes <= 1000 and max-nodes > 0.",
      ),
    );
  return Result.ok(Option.some(next));
};

export const updatePool = (pool: NodePool, args: ParsedArgs): Result<NodePool, CommandFailure> => {
  const scaleKeys = ["enable-autoscaling", "min-nodes", "max-nodes"];
  const managementKeys = ["enable-autorepair", "enable-autoupgrade", "workload-metadata"];
  const scaling = scaleKeys.some((k) => args.flags[k] !== undefined);
  const management = managementKeys.some((k) => args.flags[k] !== undefined);
  if (scaling && management)
    return Result.err(
      CommandFailure.invalidState("Update autoscaling and node management in separate commands."),
    );
  if (!scaling && !management)
    return Result.err(
      CommandFailure.invalidState("Specify autoscaling or node management settings to update."),
    );
  return Result.map(autoscalingArgs(args, pool.autoscaling), (autoscaling) => ({
    ...pool,
    workloadMetadata: Option.unwrapOr(
      Args.string(args, "workload-metadata"),
      pool.workloadMetadata ?? "GCE_METADATA",
    ) as "GCE_METADATA" | "GKE_METADATA",
    autoRepair: Option.unwrapOr(Args.booleanChoice(args, "enable-autorepair"), pool.autoRepair),
    autoUpgrade: Option.unwrapOr(Args.booleanChoice(args, "enable-autoupgrade"), pool.autoUpgrade),
    autoscaling,
    lastScale: scaling ? Option.none : pool.lastScale,
  }));
};
