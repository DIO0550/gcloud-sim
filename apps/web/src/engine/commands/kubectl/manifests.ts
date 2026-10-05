import { CommandFailure } from "@/engine/cli/command-failure";
import { CommandOutput, type CommandResult, OutputMessage } from "@/engine/cli/command-spec";
import { KubeConfig } from "@/engine/domains/kube-config";
import { KubeLabels } from "@/engine/domains/kube-labels";
import { KubeManifest } from "@/engine/domains/kube-manifest";
import type { GkeCluster } from "@/engine/domains/managed-services";
import { World } from "@/engine/domains/world";
import { Result } from "@/utils/Result";
import { kubePermission } from "./configuration";
import { type KubectlContext, requireNamespace } from "./context";
import { applyHpa } from "./hpa-manifests";
import { applyNamespace } from "./namespaces";
import { applyNetworkPolicy } from "./network-policy";
import { applyStorage } from "./storage";
import { applyWorkload } from "./workload-manifests";

/** Validate the entire file and permissions before committing any simulated resource. */
export const applyManifest = (
  ctx: KubectlContext,
  cluster: GkeCluster,
  source: string,
  action: "apply" | "create" | "delete",
): CommandResult => {
  const parsed = KubeManifest.parse(source);
  if (!Result.isOk(parsed)) return Result.err(CommandFailure.invalidArgumentWith(parsed.error));
  let world = ctx.world;
  const messages: OutputMessage[] = [];
  const ids = parsed.value.map(
    (m) =>
      `${m.kind}/${["namespace", "storageclass"].includes(m.kind) ? "" : (m.namespace ?? ctx.namespace)}/${m.name}`,
  );
  if (new Set(ids).size !== ids.length)
    return Result.err(
      CommandFailure.invalidArgumentWith("Duplicate resource in resolved manifest namespace."),
    );
  for (const manifest of parsed.value) {
    if (manifest.kind === "storageclass") {
      const applied = applyStorage({ ...ctx, world }, cluster, manifest, action);
      if (!Result.isOk(applied)) return applied;
      world = applied.value.world;
      messages.push(...applied.value.output.messages);
      continue;
    }
    if (manifest.kind === "namespace") {
      const applied = applyNamespace({ ...ctx, world }, cluster, manifest.name, action);
      if (!Result.isOk(applied)) return applied;
      world = applied.value.world;
      messages.push(...applied.value.output.messages);
      continue;
    }
    if (
      ctx.explicitNamespace &&
      manifest.namespace !== undefined &&
      manifest.namespace !== ctx.namespace
    )
      return Result.err(
        CommandFailure.invalidArgumentWith("Manifest namespace does not match --namespace."),
      );
    const scoped = { ...ctx, world, namespace: manifest.namespace ?? ctx.namespace };
    const checked = requireNamespace(scoped, cluster);
    if (!Result.isOk(checked)) return checked;
    if (manifest.kind === "networkpolicy") {
      const applied = applyNetworkPolicy(scoped, cluster, manifest, action);
      if (!Result.isOk(applied)) return applied;
      world = applied.value.world;
      messages.push(...applied.value.output.messages);
      continue;
    }
    if (manifest.kind === "pvc") {
      const applied = applyStorage(scoped, cluster, manifest, action);
      if (!Result.isOk(applied)) return applied;
      world = applied.value.world;
      messages.push(...applied.value.output.messages);
      continue;
    }
    if (manifest.kind === "hpa") {
      const applied = applyHpa(scoped, cluster, manifest, action);
      if (!Result.isOk(applied)) return applied;
      world = applied.value.world;
      messages.push(...applied.value.output.messages);
      continue;
    }
    if (manifest.kind === "deployment" || manifest.kind === "service") {
      const applied = applyWorkload(scoped, cluster, manifest, action);
      if (!Result.isOk(applied)) return applied;
      world = applied.value.world;
      messages.push(...applied.value.output.messages);
      continue;
    }
    let configs = [...world.kubeConfigs];
    const existing = configs.find(
      (c) =>
        c.projectId === cluster.projectId &&
        c.cluster === cluster.name &&
        c.namespace === scoped.namespace &&
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
      world = World.withKubeConfigs(world, configs);
      messages.push(OutputMessage.plain(`${manifest.kind}/${manifest.name} deleted`));
      continue;
    }
    // Removing a formerly applied key deletes it; unrelated live keys stay intact.
    const incoming = new Set(manifest.data.map((e) => e.key));
    const retained = (existing?.data ?? []).filter(
      (e) => !incoming.has(e.key) && !existing?.lastAppliedKeys.includes(e.key),
    );
    const incomingBinary = new Set(manifest.binaryData.map((e) => e.key));
    const retainedBinary = (existing?.binaryData ?? []).filter(
      (e) => !incomingBinary.has(e.key) && !existing?.lastAppliedBinaryKeys.includes(e.key),
    );
    const incomingLabels = Object.keys(manifest.labels);
    const retainedLabels = Object.entries(existing?.labels ?? {}).filter(
      ([key]) =>
        !Object.hasOwn(manifest.labels, key) && !existing?.lastAppliedLabelKeys.includes(key),
    );
    const labels = Object.fromEntries([...retainedLabels, ...Object.entries(manifest.labels)]);
    const next: KubeConfig = {
      ...manifest,
      projectId: cluster.projectId,
      cluster: cluster.name,
      namespace: scoped.namespace,
      immutable: manifest.immutable ?? existing?.immutable ?? false,
      data: [...retained, ...manifest.data].toSorted((a, b) => a.key.localeCompare(b.key)),
      lastAppliedKeys: action === "apply" ? [...incoming].sort() : [],
      binaryData: [...retainedBinary, ...manifest.binaryData].toSorted((a, b) =>
        a.key.localeCompare(b.key),
      ),
      lastAppliedBinaryKeys: action === "apply" ? [...incomingBinary].sort() : [],
      labels: Object.fromEntries(Object.entries(labels).sort(([a], [b]) => a.localeCompare(b))),
      lastAppliedLabelKeys: action === "apply" ? incomingLabels.sort() : [],
      createdAt: existing?.createdAt ?? ctx.now,
    };
    const valid = KubeConfig.validate(next);
    if (!Result.isOk(valid)) return Result.err(CommandFailure.invalidArgumentWith(valid.error));
    if (existing) {
      const updated = KubeConfig.update(existing, next);
      if (!Result.isOk(updated)) return Result.err(CommandFailure.invalidState(updated.error));
    }

    const unchanged =
      existing &&
      existing.immutable === next.immutable &&
      JSON.stringify(existing.data) === JSON.stringify(next.data) &&
      JSON.stringify(existing.lastAppliedKeys) === JSON.stringify(next.lastAppliedKeys) &&
      JSON.stringify(existing.binaryData) === JSON.stringify(next.binaryData) &&
      JSON.stringify(existing.lastAppliedBinaryKeys) ===
        JSON.stringify(next.lastAppliedBinaryKeys) &&
      KubeLabels.equal(existing.labels, next.labels) &&
      JSON.stringify(existing.lastAppliedLabelKeys) === JSON.stringify(next.lastAppliedLabelKeys);
    configs = existing
      ? configs.map((c) => (c === existing ? (unchanged ? existing : next) : c))
      : [...configs, next];
    if (!unchanged) world = World.withKubeConfigs(world, configs);
    messages.push(
      OutputMessage.plain(
        `${manifest.kind}/${manifest.name} ${!existing ? "created" : unchanged ? "unchanged" : "configured"}`,
      ),
    );
  }
  return Result.ok({ world, output: CommandOutput.messages(...messages) });
};
