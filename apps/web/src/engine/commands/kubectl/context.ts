import { CommandFailure } from "@/engine/cli/command-failure";
import { ParsedArgs, type ProjectContext } from "@/engine/cli/command-spec";
import { KubeNamespace } from "@/engine/domains/kube-namespace";
import type { GkeCluster } from "@/engine/domains/managed-services";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

export type KubectlContext = ProjectContext &
  Readonly<{ namespace: string; explicitNamespace: boolean }>;
export const namespaceContext = (
  ctx: ProjectContext,
  args: ParsedArgs,
): Result<KubectlContext, CommandFailure> => {
  const namespace = Option.unwrapOr(ParsedArgs.string(args, "namespace"), "default");
  if (!KubeNamespace.valid(namespace))
    return Result.err(
      CommandFailure.invalidArgumentWith(
        "Namespace must be a lowercase DNS label of at most 63 characters.",
      ),
    );
  return Result.ok({ ...ctx, namespace, explicitNamespace: ParsedArgs.has(args, "namespace") });
};
export const requireNamespace = (
  ctx: KubectlContext,
  cluster: GkeCluster,
): Result<KubectlContext, CommandFailure> =>
  KubeNamespace.exists(ctx.world, cluster, ctx.namespace)
    ? Result.ok(ctx)
    : Result.err(
        CommandFailure.notFoundWith(
          `Error from server (NotFound): namespaces "${ctx.namespace}" not found`,
        ),
      );
