import { CommandFailure } from "@/engine/cli/command-failure";
import {
  type CandidateSource,
  CommandContext,
  CommandOutput,
  type CommandResult,
  Flag,
  ParsedArgs,
  type ProjectContext,
} from "@/engine/cli/command-spec";
import { Candidates } from "@/engine/commands/shared";
import {
  type Deployment,
  defaultConfig,
  findDeployment,
  type Invocation,
  latestRevision,
  type ResourceId,
  type RuntimeConfig,
  type ServerlessLab,
  type TargetKind,
  validConfig,
} from "@/engine/domains/serverless-lab/model";
import { allows, attachAccount } from "@/engine/domains/serverless-lab/runtime";
import { ServiceAccount } from "@/engine/domains/service-account";
import type { World } from "@/engine/domains/world";
import type { JsonRecord } from "@/types/Json";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

export const invalid = (message: string) => Result.err(CommandFailure.invalidArgumentWith(message));
export const finish = (world: World, record: JsonRecord): CommandResult =>
  Result.ok({ world, output: CommandOutput.yaml(record) });
export const requirePermission = (ctx: ProjectContext, permission: string) => {
  if (!allows(ctx.world, ctx.project.projectId, ctx.principal, permission)) {
    return invalid(`Permission ${permission} is required.`);
  }
  return Result.ok(true);
};
export const labCandidates =
  (key: keyof ServerlessLab): CandidateSource =>
  (world, project) => {
    if (!project.some) {
      return [];
    }
    return world.serverlessLab[key].flatMap((r) =>
      "projectId" in r && "name" in r && r.projectId === project.value ? [r.name] : [],
    );
  };
export const regionFlag = Flag.string("region", "Resource region.", {
  candidates: Candidates.regions,
});
export const identity = (
  ctx: ProjectContext,
  args: ParsedArgs,
  kind: TargetKind = "run",
): Result<ResourceId, CommandFailure> =>
  Result.map(
    CommandContext.resolveRegion(
      ctx,
      ParsedArgs.string(args, "region"),
      kind === "function" ? "functions/region" : "run/region",
    ),
    (region) => ({
      projectId: ctx.project.projectId,
      region,
      name: ParsedArgs.requiredPositional(args, 0),
    }),
  );
export const deploymentArg = (
  ctx: ProjectContext,
  args: ParsedArgs,
  kind: TargetKind = "run",
): Result<Deployment, CommandFailure> =>
  Result.flatMap(identity(ctx, args, kind), (id) => {
    const d = findDeployment(ctx.world, id, kind);
    if (!d) {
      return Result.err(
        CommandFailure.notFoundWith(`${kind} ${id.name} does not exist in ${id.region}.`),
      );
    }
    return Result.ok(d);
  });
export const RuntimeFlags = [
  Flag.keyvalue("set-env-vars", "Replace environment variables (KEY=VALUE)."),
  Flag.keyvalue("update-env-vars", "Merge environment variables."),
  Flag.list("remove-env-vars", "Remove environment variable keys."),
  Flag.integer("min-instances", "Minimum instances (0–1000)."),
  Flag.integer("max-instances", "Maximum instances (1–1000)."),
  Flag.integer("concurrency", "Maximum concurrent requests per instance (1–1000)."),
  Flag.string("cpu", "CPU count: 1, 2, 4, 6, 8."),
  Flag.string("memory", "Memory size, e.g. 256Mi or 1Gi."),
  Flag.string("timeout", "Request timeout in seconds (1–3600; accepts s suffix)."),
  Flag.string("service-account", "Runtime SA email.", { candidates: Candidates.serviceAccounts }),
  Flag.enum("ingress", "Allowed request source.", [
    "all",
    "internal",
    "internal-and-cloud-load-balancing",
  ]),
  Flag.enum("egress-settings", "VPC egress routing.", ["private-ranges-only", "all-traffic"]),
  Flag.enum("vpc-egress", "Cloud Run VPC egress routing.", ["private-ranges-only", "all-traffic"]),
  Flag.string("vpc-connector", "Connector in the deployment region.", {
    candidates: labCandidates("connectors"),
  }),
  Flag.keyvalue(
    "set-secrets",
    "Secret environment references KEY=SECRET:VERSION (data is never displayed).",
  ),
  Flag.string("key", "CMEK crypto key full resource name."),
];
export const configArgs = (
  ctx: ProjectContext,
  args: ParsedArgs,
  previous?: RuntimeConfig,
): Result<RuntimeConfig, CommandFailure> => {
  const c =
    previous ?? defaultConfig(ServiceAccount.defaultComputeEmail(ctx.project.projectNumber));
  if (args.flags["set-env-vars"] && args.flags["update-env-vars"]) {
    return invalid("set-env-vars and update-env-vars cannot be combined.");
  }
  let env = args.flags["set-env-vars"]
    ? ParsedArgs.keyvalue(args, "set-env-vars")
    : { ...c.env, ...ParsedArgs.keyvalue(args, "update-env-vars") };
  const removed = ParsedArgs.list(args, "remove-env-vars");
  env = Object.fromEntries(Object.entries(env).filter(([key]) => !removed.includes(key)));
  const memory = Option.unwrapOr(ParsedArgs.string(args, "memory"), `${c.memoryMb}Mi`);
  const match = /^(\d+)(Mi|Gi|MB|GB|M|G)?$/i.exec(memory);
  const amount = Number(match?.[1]);
  const memoryMb = /g/i.test(match?.[2] ?? "") ? amount * 1024 : amount;
  const serviceAccount = Option.unwrapOr(
    ParsedArgs.string(args, "service-account"),
    c.serviceAccount,
  );
  if (args.flags["service-account"]) {
    const attached = attachAccount(ctx.world, ctx.project.projectId, ctx.principal, serviceAccount);
    if (!Result.isOk(attached)) {
      return invalid(attached.error);
    }
  }
  const ingress = Option.unwrapOr(
    ParsedArgs.string(args, "ingress"),
    c.ingress,
  ) as RuntimeConfig["ingress"];
  if (args.flags["vpc-egress"] && args.flags["egress-settings"]) {
    return invalid("Use only one egress flag.");
  }
  const egress = Option.unwrapOr(
    ParsedArgs.string(args, "vpc-egress"),
    Option.unwrapOr(ParsedArgs.string(args, "egress-settings"), c.egress),
  ) as RuntimeConfig["egress"];
  const next: RuntimeConfig = {
    ...c,
    env,
    memoryMb,
    serviceAccount,
    ingress,
    egress,
    minInstances: Option.unwrapOr(ParsedArgs.integer(args, "min-instances"), c.minInstances),
    maxInstances: Option.unwrapOr(ParsedArgs.integer(args, "max-instances"), c.maxInstances),
    concurrency: Option.unwrapOr(ParsedArgs.integer(args, "concurrency"), c.concurrency),
    cpu: Number(Option.unwrapOr(ParsedArgs.string(args, "cpu"), String(c.cpu))),
    timeoutSeconds: Number(
      Option.unwrapOr(ParsedArgs.string(args, "timeout"), String(c.timeoutSeconds)).replace(
        /s$/,
        "",
      ),
    ),
    connector: Option.unwrapOr(ParsedArgs.string(args, "vpc-connector"), c.connector),
    cmek: Option.unwrapOr(ParsedArgs.string(args, "key"), c.cmek),
    secrets: args.flags["set-secrets"] ? ParsedArgs.keyvalue(args, "set-secrets") : c.secrets,
  };
  if (!validConfig(next)) {
    return invalid(
      "Invalid runtime configuration: check env keys, min/max, CPU/memory, concurrency and timeout limits (see help).",
    );
  }
  if (
    !Object.values(next.secrets).every((ref) => /^[a-z][a-z0-9-]*:(latest|[1-9]\d*)$/.test(ref))
  ) {
    return invalid("Secret references must use SECRET:VERSION or SECRET:latest.");
  }
  return Result.ok(next);
};
export const deploymentRecord = (d: Deployment): JsonRecord => ({
  name: d.name,
  projectId: d.projectId,
  region: d.region,
  kind: d.kind,
  latestRevision: latestRevision(d).name,
  revisions: d.revisions.map((r) => ({ name: r.name, image: r.image, config: r.config })),
  traffic: d.traffic,
  policy: d.policy,
  trigger: d.trigger,
  retry: d.retry,
  tasks: d.tasks,
  invocations: d.invocations,
});

export const finishInvocation = (
  world: World,
  invocation: Invocation,
  record: JsonRecord = invocation,
): CommandResult => {
  const failure =
    invocation.status === "FAILED" ? CommandFailure.invalidState(invocation.reason) : undefined;
  return Result.ok({ world, output: CommandOutput.yaml(record), failure });
};
