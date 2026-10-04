import { CommandFailure } from "@/engine/cli/command-failure";
import {
  CommandOutput,
  type CommandResult,
  OutputMessage,
  type ProjectContext,
} from "@/engine/cli/command-spec";
import { KubeConfig } from "@/engine/domains/kube-config";
import { KubeManifest } from "@/engine/domains/kube-manifest";
import type { GkeCluster } from "@/engine/domains/managed-services";
import { World } from "@/engine/domains/world";
import { Result } from "@/utils/Result";
import { kubePermission } from "./configuration";

/** Validate the entire file and permissions before committing any simulated resource. */
export const applyManifest = (
  ctx: ProjectContext,
  cluster: GkeCluster,
  source: string,
  action: "apply" | "create" | "delete",
): CommandResult => {
  const parsed = KubeManifest.parse(source);
  if (!Result.isOk(parsed)) return Result.err(CommandFailure.invalidArgumentWith(parsed.error));
  let configs = [...ctx.world.kubeConfigs];
  const messages: OutputMessage[] = [];
  for (const manifest of parsed.value) {
    const existing = configs.find(
      (c) =>
        c.projectId === cluster.projectId &&
        c.cluster === cluster.name &&
        c.kind === manifest.kind &&
        c.name === manifest.name,
    );
    const permission = `container.${manifest.kind === "secret" ? "secrets" : "configMaps"}`;
    const verbs = action === "apply" ? ["get", existing ? "update" : "create"] : [action];
    for (const verb of verbs) {
      const allowed = kubePermission(ctx, `${permission}.${verb}`);
      if (!Result.isOk(allowed)) return allowed;
    }
    if (action === "create" && existing)
      return Result.err(
        CommandFailure.alreadyExistsWith(`${manifest.kind} "${manifest.name}" already exists`),
      );
    if (action === "delete") {
      if (!existing)
        return Result.err(
          CommandFailure.notFoundWith(`${manifest.kind} "${manifest.name}" not found`),
        );
      configs = configs.filter((c) => c !== existing);
      messages.push(OutputMessage.plain(`${manifest.kind}/${manifest.name} deleted`));
      continue;
    }
    // Removing a formerly applied key deletes it; unrelated live keys stay intact.
    const incoming = new Set(manifest.data.map((e) => e.key));
    const retained = (existing?.data ?? []).filter(
      (e) => !incoming.has(e.key) && !existing?.lastAppliedKeys.includes(e.key),
    );
    const next: KubeConfig = {
      ...manifest,
      projectId: cluster.projectId,
      cluster: cluster.name,
      data: [...retained, ...manifest.data].toSorted((a, b) => a.key.localeCompare(b.key)),
      lastAppliedKeys: action === "apply" ? [...incoming].sort() : [],
      createdAt: existing?.createdAt ?? ctx.now,
    };
    const valid = KubeConfig.validate(next);
    if (!Result.isOk(valid)) return Result.err(CommandFailure.invalidArgumentWith(valid.error));
    const unchanged =
      existing &&
      JSON.stringify(existing.data) === JSON.stringify(next.data) &&
      JSON.stringify(existing.lastAppliedKeys) === JSON.stringify(next.lastAppliedKeys);
    configs = existing
      ? configs.map((c) => (c === existing ? (unchanged ? existing : next) : c))
      : [...configs, next];
    messages.push(
      OutputMessage.plain(
        `${manifest.kind}/${manifest.name} ${!existing ? "created" : unchanged ? "unchanged" : "configured"}`,
      ),
    );
  }
  if (JSON.stringify(configs) === JSON.stringify(ctx.world.kubeConfigs))
    return Result.ok({ world: ctx.world, output: CommandOutput.messages(...messages) });
  return Result.ok({
    world: World.withKubeConfigs(ctx.world, configs),
    output: CommandOutput.messages(...messages),
  });
};
