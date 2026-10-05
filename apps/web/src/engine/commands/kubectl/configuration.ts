import { CommandFailure } from "@/engine/cli/command-failure";
import {
  CommandOutput,
  type CommandResult,
  OutputMessage,
  ParsedArgs,
  type ProjectContext,
} from "@/engine/cli/command-spec";
import { EffectivePermissions } from "@/engine/domains/effective-permissions";
import { KubeConfig, KubeEnv } from "@/engine/domains/kube-config";
import { KubeLabels } from "@/engine/domains/kube-labels";
import { KubeDeployment } from "@/engine/domains/kubernetes";
import type { GkeCluster } from "@/engine/domains/managed-services";
import { Principal } from "@/engine/domains/principal";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";
import type { KubectlContext } from "./context";

export const kubePermission = (ctx: ProjectContext, permission: string) =>
  Result.mapErr(
    EffectivePermissions.require(
      EffectivePermissions.resolve(ctx.world, Principal.toMember(ctx.principal), {
        type: "project",
        id: ctx.project.projectId,
      }),
      [permission],
    ),
    CommandFailure.permissionDenied,
  );
const invalid = (message: string) => Result.err(CommandFailure.invalidArgumentWith(message));
export const createConfig = (
  ctx: KubectlContext,
  args: ParsedArgs,
  cluster: GkeCluster,
  kind: KubeConfig["kind"],
): CommandResult => {
  const name = ParsedArgs.requiredPositional(args, 0);
  if (
    ctx.world.kubeConfigs.some(
      (c) =>
        c.projectId === cluster.projectId &&
        c.cluster === cluster.name &&
        c.namespace === ctx.namespace &&
        c.kind === kind &&
        c.name === name,
    )
  )
    return Result.err(CommandFailure.alreadyExistsWith(`${kind} "${name}" already exists`));
  const data: { key: string; value: string }[] = [];
  for (const literal of ParsedArgs.list(args, "from-literal")) {
    const eq = literal.indexOf("=");
    if (eq < 1) return invalid("--from-literal must be KEY=VALUE.");
    data.push({ key: literal.slice(0, eq), value: literal.slice(eq + 1) });
  }
  const config = KubeConfig.validate({
    projectId: cluster.projectId,
    cluster: cluster.name,
    namespace: ctx.namespace,
    kind,
    name,
    immutable: false,
    labels: {},
    lastAppliedLabelKeys: [],
    data,
    lastAppliedKeys: [],
    createdAt: ctx.now,
  });
  if (!Result.isOk(config)) return invalid(config.error);
  return Result.ok({
    world: World.withKubeConfigs(ctx.world, [...ctx.world.kubeConfigs, config.value]),
    output: CommandOutput.messages(OutputMessage.plain(`${kind}/${name} created`)),
  });
};

/** Metadata edits preserve data, apply ownership and running Pod environments. */
export const labelConfig = (
  ctx: KubectlContext,
  args: ParsedArgs,
  cluster: GkeCluster,
  kind: KubeConfig["kind"],
  name: string,
  changes: readonly string[],
): CommandResult => {
  const permission = `container.${kind === "secret" ? "secrets" : "configMaps"}`;
  for (const verb of ["get", "update"]) {
    const allowed = kubePermission(ctx, `${permission}.${verb}`);
    if (!Result.isOk(allowed)) return allowed;
  }
  const config = ctx.world.kubeConfigs.find(
    (c) =>
      c.projectId === cluster.projectId &&
      c.cluster === cluster.name &&
      c.namespace === ctx.namespace &&
      c.kind === kind &&
      c.name === name,
  );
  if (!config) return Result.err(CommandFailure.notFoundWith(`${kind} "${name}" not found`));
  if (!changes.length) return invalid("Specify one or more KEY=VALUE or KEY- labels.");

  const labels = { ...config.labels };
  const keys = new Set<string>();
  for (const change of changes) {
    const eq = change.indexOf("=");
    const remove = eq === -1 && change.endsWith("-");
    const key = remove ? change.slice(0, -1) : change.slice(0, eq);
    const value = remove ? "" : change.slice(eq + 1);
    if ((!remove && eq < 1) || !Result.isOk(KubeLabels.parse({ [key]: value })))
      return invalid(`Invalid label assignment: ${change}`);
    if (keys.has(key)) return invalid(`Duplicate label key: ${key}`);
    keys.add(key);

    if (remove) {
      delete labels[key];
      continue;
    }
    if (
      Object.hasOwn(labels, key) &&
      labels[key] !== value &&
      !ParsedArgs.boolean(args, "overwrite")
    )
      return invalid(`Label ${key} already has a different value; use --overwrite.`);
    labels[key] = value;
  }

  const parsed = KubeLabels.parse(labels);
  if (!Result.isOk(parsed)) return invalid(parsed.error);

  const unchanged = KubeLabels.equal(config.labels, parsed.value);
  const next = { ...config, labels: parsed.value };
  return Result.ok({
    world: unchanged
      ? ctx.world
      : World.withKubeConfigs(
          ctx.world,
          ctx.world.kubeConfigs.map((c) => (c === config ? next : c)),
        ),
    output: CommandOutput.messages(
      OutputMessage.plain(`${kind}/${name} ${unchanged ? "unchanged" : "labeled"}`),
    ),
  });
};

export const setEnv = (
  ctx: KubectlContext,
  args: ParsedArgs,
  cluster: GkeCluster,
  d: KubeDeployment,
): CommandResult => {
  const offset = ParsedArgs.requiredPositional(args, 0).includes("/") ? 1 : 2;
  const changes = args.positionals.slice(offset);
  const from = ParsedArgs.string(args, "from");
  const list = ParsedArgs.boolean(args, "list");
  if (list) {
    if (
      changes.length ||
      Option.isSome(from) ||
      ParsedArgs.has(args, "keys") ||
      ParsedArgs.has(args, "prefix")
    )
      return invalid("--list cannot be combined with changes.");
    return Result.ok({
      world: ctx.world,
      output: CommandOutput.messages(
        ...d.env.map((e) => OutputMessage.plain(`${e.name}=${KubeEnv.display(e)}`)),
      ),
    });
  }
  if (!changes.length && !Option.isSome(from))
    return invalid("Specify KEY=VALUE, KEY- or --from=configmap/NAME|secret/NAME.");
  if (changes.length && Option.isSome(from))
    return invalid("Use assignments or --from in separate commands on gcloud-sim.");
  if (!Option.isSome(from) && (ParsedArgs.has(args, "keys") || ParsedArgs.has(args, "prefix")))
    return invalid("--keys/--prefix require --from.");
  const updates: KubeEnv[] = [];
  const removals: string[] = [];
  if (Option.isSome(from)) {
    const match = /^(configmap|secret)\/([^/]+)$/.exec(from.value);
    if (!match) return invalid("--from must be configmap/NAME or secret/NAME.");
    const permission = kubePermission(
      ctx,
      `container.${match[1] === "secret" ? "secrets" : "configMaps"}.get`,
    );
    if (!Result.isOk(permission)) return permission;
    const config = ctx.world.kubeConfigs.find(
      (c) =>
        c.projectId === cluster.projectId &&
        c.cluster === cluster.name &&
        c.namespace === ctx.namespace &&
        c.kind === match[1] &&
        c.name === match[2],
    );
    if (!config) return Result.err(CommandFailure.notFoundWith(`${from.value} not found`));
    const keys = ParsedArgs.has(args, "keys")
      ? ParsedArgs.list(args, "keys")
      : config.data.map((e) => e.key);
    const prefix = Option.unwrapOr(ParsedArgs.string(args, "prefix"), "");
    for (const key of keys) {
      if (!config.data.some((e) => e.key === key))
        return invalid(`Key ${key} not found in ${from.value}.`);
      const name = `${prefix}${key.toUpperCase().replace(/[^A-Z0-9_]/g, "_")}`;
      updates.push({ name, source: config.kind, resource: config.name, key, value: "" });
    }
  }
  for (const change of changes) {
    const eq = change.indexOf("=");
    if (eq >= 1) {
      updates.push({
        name: change.slice(0, eq),
        source: "literal",
        value: change.slice(eq + 1),
        resource: "",
        key: "",
      });
      continue;
    }
    if (change.endsWith("-") && KubeEnv.validName(change.slice(0, -1))) {
      removals.push(change.slice(0, -1));
      continue;
    }
    return invalid(`Invalid environment assignment: ${change}`);
  }
  const names = [...updates.map((e) => e.name), ...removals];
  if (new Set(names).size !== names.length)
    return invalid("Duplicate environment name after conversion.");
  const env = [...d.env.filter((e) => !names.includes(e.name)), ...updates].toSorted((a, b) =>
    a.name.localeCompare(b.name),
  );
  if (!KubeEnv.validate(env))
    return invalid("Environment names must use [A-Za-z_][A-Za-z0-9_]* (maximum 100).");
  const next = KubeDeployment.withEnv(d, env);
  return Result.ok({
    world: World.replaceKubeDeployment(ctx.world, next),
    output: CommandOutput.messages(
      OutputMessage.plain(`deployment.apps/${d.name} ${next === d ? "unchanged" : "env updated"}`),
    ),
  });
};
