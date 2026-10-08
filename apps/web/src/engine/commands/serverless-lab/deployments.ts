import { CommandFailure } from "@/engine/cli/command-failure";
import {
  Column,
  CommandOutput,
  type CommandResult,
  type CommandSpec,
  Flag,
  ParsedArgs,
  Positional,
  type ProjectContext,
} from "@/engine/cli/command-spec";
import { Candidates, parseBinding, projectCommand } from "@/engine/commands/shared";
import { FunctionRuntime, FunctionRuntimes } from "@/engine/domains/catalog";
import { ResourceName } from "@/engine/domains/compute";
import { IamPolicy } from "@/engine/domains/iam-policy";
import { CloudRunService } from "@/engine/domains/managed-services";
import { CloudFunction } from "@/engine/domains/serverless";
import {
  type Deployment,
  type EventFilter,
  findDeployment,
  latestRevision,
  putDeployment,
  sameId,
  type TargetKind,
  targetId,
} from "@/engine/domains/serverless-lab/model";
import { dependencies, invoke } from "@/engine/domains/serverless-lab/runtime";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";
import {
  configArgs,
  deploymentArg,
  deploymentRecord,
  finish,
  finishInvocation,
  identity,
  invalid,
  labCandidates,
  RuntimeFlags,
  regionFlag,
  requirePermission,
} from "./shared";

const permissionGroup = (kind: TargetKind): string =>
  ({ run: "run.services", function: "cloudfunctions.functions", job: "run.jobs" })[kind];

const commandGroup = (kind: TargetKind): string[] =>
  ({
    run: ["gcloud", "run", "services"],
    function: ["gcloud", "functions"],
    job: ["gcloud", "run", "jobs"],
  })[kind];

const triggerArgs = (
  ctx: ProjectContext,
  args: ParsedArgs,
  previous?: EventFilter,
): Result<EventFilter, CommandFailure> => {
  const http = ParsedArgs.boolean(args, "trigger-http");
  const topic = ParsedArgs.string(args, "trigger-topic");
  const bucket = ParsedArgs.string(args, "trigger-bucket");
  const filters = ParsedArgs.keyvalue(args, "trigger-event-filters");
  const count =
    Number(http) +
    Number(topic.some) +
    Number(bucket.some) +
    Number(Object.keys(filters).length > 0);
  if (count > 1) {
    return Result.err(
      CommandFailure.mustBeSpecified(
        "(--trigger-http | --trigger-topic), or one supported Storage/Firestore trigger",
      ),
    );
  }
  if (!count && previous) {
    return Result.ok(previous);
  }
  if (!count) {
    return Result.err(
      CommandFailure.mustBeSpecified(
        "(--trigger-http | --trigger-topic), or a supported Storage/Firestore trigger",
      ),
    );
  }
  if (http) {
    return Result.ok({ kind: "http", source: "", eventType: "", document: "" });
  }
  if (topic.some) {
    if (
      !ctx.world.pubsubTopics.some(
        (t) => t.projectId === ctx.project.projectId && t.name === topic.value,
      )
    ) {
      return Result.err(
        CommandFailure.notFoundWith(
          `projects/${ctx.project.projectId}/topics/${topic.value} does not exist`,
        ),
      );
    }
    return Result.ok({
      kind: "topic",
      source: topic.value,
      eventType: "google.cloud.pubsub.topic.v1.messagePublished",
      document: "",
    });
  }
  if (bucket.some) {
    if (
      !ctx.world.buckets.some(
        (b) => b.projectId === ctx.project.projectId && b.name === bucket.value,
      )
    ) {
      return invalid("Storage trigger bucket does not exist in this project.");
    }
    return Result.ok({
      kind: "storage",
      source: bucket.value,
      eventType: "google.cloud.storage.object.v1.finalized",
      document: "",
    });
  }
  const allowedTypes = [
    "google.cloud.firestore.document.v1.created",
    "google.cloud.firestore.document.v1.updated",
    "google.cloud.firestore.document.v1.deleted",
    "google.cloud.firestore.document.v1.written",
  ];
  if (
    !allowedTypes.includes(filters.type ?? "") ||
    !filters.database ||
    !filters.document ||
    Object.keys(filters).some((key) => !["type", "database", "document"].includes(key))
  ) {
    return invalid(
      "Supported Firestore filters: type, database, document. Use a created/updated/deleted/written event type.",
    );
  }
  if (
    !ctx.world.serverlessLab.databases.some(
      (d) =>
        d.projectId === ctx.project.projectId &&
        d.name === filters.database &&
        d.mode === "firestore-native",
    )
  ) {
    return invalid("Firestore Native trigger database does not exist.");
  }
  return Result.ok({
    kind: "firestore",
    source: filters.database,
    eventType: filters.type ?? "",
    document: filters.document,
  });
};
const deploy =
  (kind: TargetKind, update = false) =>
  (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
    const id = identity(ctx, args, kind);
    if (!Result.isOk(id)) {
      return id;
    }
    const validName = ResourceName.parse(id.value.name);
    if (!Result.isOk(validName)) {
      return invalid(validName.error);
    }
    const old = findDeployment(ctx.world, id.value, kind);
    if (update && !old) {
      return invalid("Resource does not exist in the requested region.");
    }
    const group = permissionGroup(kind);
    const permission = requirePermission(ctx, `${group}.${old ? "update" : "create"}`);
    if (!Result.isOk(permission)) {
      return permission;
    }
    const config = configArgs(ctx, args, old ? latestRevision(old).config : undefined);
    if (!Result.isOk(config)) {
      return config;
    }
    let image = Option.unwrapOr(
      ParsedArgs.string(args, "image"),
      old ? latestRevision(old).image : "",
    );
    const runtime = FunctionRuntime.parse(
      Option.unwrapOr(ParsedArgs.string(args, "runtime"), image),
    );
    const source = ParsedArgs.string(args, "source");
    if (source.some && ![".", "hello"].includes(source.value)) {
      return invalid(
        "Only the built-in hello lesson source is supported; source files are never executed.",
      );
    }
    if (kind === "function") {
      if (!runtime.some) {
        return Result.err(
          CommandFailure.invalidChoice(
            "--runtime",
            Option.unwrapOr(ParsedArgs.string(args, "runtime"), ""),
            Object.values(FunctionRuntimes),
          ),
        );
      }
      image = runtime.value;
    }
    if (!image || /\s/.test(image)) {
      return invalid("Specify a valid --image.");
    }
    const trigger =
      kind === "function"
        ? triggerArgs(ctx, args, old?.trigger)
        : Result.ok<EventFilter>({ kind: "http", source: "", eventType: "", document: "" });
    if (!Result.isOk(trigger)) {
      return trigger;
    }
    const policyFlag = ParsedArgs.booleanChoice(args, "allow-unauthenticated");
    if (policyFlag.some) {
      const checked = requirePermission(
        ctx,
        kind === "function" ? "cloudfunctions.functions.setIamPolicy" : `${group}.setIamPolicy`,
      );
      if (!Result.isOk(checked)) {
        return checked;
      }
    }
    let policy = old?.policy ?? IamPolicy.Empty;
    if (policyFlag.some && policyFlag.value) {
      policy = IamPolicy.addBinding(policy, "roles/run.invoker", "allUsers");
    }
    if (policyFlag.some && !policyFlag.value) {
      policy = Option.unwrapOr(
        IamPolicy.removeBinding(policy, "roles/run.invoker", "allUsers"),
        policy,
      );
    }
    const index = (old?.revisions.length ?? 0) + 1;
    if (index > 100) {
      return invalid("The lesson supports at most 100 revisions per resource.");
    }
    const revision = {
      name: `${id.value.name}-${String(index).padStart(5, "0")}-abc`,
      image,
      config: config.value,
    };
    const noTraffic = ParsedArgs.boolean(args, "no-traffic");
    if (noTraffic && !old) {
      return invalid("Deploy the initial revision before using --no-traffic.");
    }
    let traffic: Deployment["traffic"] = { [revision.name]: 100 };
    if (noTraffic && old) {
      traffic = old.traffic;
    }
    if (kind === "job") {
      traffic = {};
    }
    const d: Deployment = {
      ...id.value,
      kind,
      revisions: [...(old?.revisions ?? []), revision],
      traffic,
      policy,
      trigger: trigger.value,
      retry: Option.unwrapOr(ParsedArgs.booleanChoice(args, "retry"), old?.retry ?? false),
      tasks: Option.unwrapOr(ParsedArgs.integer(args, "tasks"), old?.tasks ?? 1),
      invocations: old?.invocations ?? [],
    };
    if (!Number.isSafeInteger(d.tasks) || d.tasks < 1 || d.tasks > 100) {
      return invalid("tasks must be 1–100.");
    }
    const dependency = dependencies(ctx.world, d, config.value);
    if (
      dependency &&
      (config.value.connector || config.value.cmek || Object.keys(config.value.secrets).length)
    ) {
      return invalid(dependency);
    }
    if (kind === "function" && args.flags.gen2 && !ParsedArgs.boolean(args, "gen2")) {
      return invalid("Only Gen2 functions are supported.");
    }
    let world = ctx.world;
    const publicHttp = IamPolicy.hasBinding(policy, "roles/run.invoker", "allUsers");
    if (kind === "run") {
      const core = CloudRunService.create({
        projectId: d.projectId,
        name: d.name,
        region: id.value.region as CloudRunService["region"],
        image,
        allowUnauthenticated: publicHttp,
        lastDeployedAt: ctx.now,
      });
      if (!Result.isOk(core)) {
        return invalid(core.error);
      }
      world = {
        ...world,
        runServices: [...world.runServices.filter((s) => !sameId(s, d)), core.value],
      };
    }
    if (kind === "function" && runtime.some) {
      const oldCore = world.functions.find((f) => sameId(f, d));
      const core = CloudFunction.create({
        projectId: d.projectId,
        name: d.name,
        region: id.value.region as CloudFunction["region"],
        runtime: runtime.value,
        entryPoint: ParsedArgs.string(args, "entry-point"),
        trigger:
          trigger.value.kind === "topic"
            ? { kind: "topic", topic: trigger.value.source }
            : { kind: "http" },
        allowUnauthenticated: publicHttp,
        memoryMb: Option.some(config.value.memoryMb),
        updateTime: ctx.now,
        previous: Option.fromNullable(oldCore),
      });
      if (!Result.isOk(core)) {
        return invalid(core.error);
      }
      world = {
        ...world,
        functions: [...world.functions.filter((f) => !sameId(f, d)), core.value],
      };
    }
    const savedFunction = world.functions.find((f) => sameId(f, d));
    const base =
      kind === "function" && savedFunction
        ? {
            ...CloudFunction.toRecord(savedFunction),
            name: CloudFunction.fullName(savedFunction),
            url: Option.unwrapOr(CloudFunction.url(savedFunction), undefined),
          }
        : {};
    return finish(putDeployment(world, d), {
      ...deploymentRecord(d),
      ...base,
      simulation: "Fixed lesson handler; no source execution or cloud traffic.",
    });
  };
const bindingCommands = (kind: TargetKind): readonly CommandSpec[] =>
  ["get-iam-policy", "add-iam-policy-binding", "remove-iam-policy-binding"].map((action) => {
    const group = commandGroup(kind);
    const permissions = permissionGroup(kind);
    return projectCommand({
      path: [...group, action],
      summary: "Read or change resource IAM bindings.",
      positionals: [Positional.required("NAME", "Resource name.", labCandidates("deployments"))],
      flags: [
        regionFlag,
        Flag.string("member", "IAM member.", { candidates: Candidates.members }),
        Flag.string("role", "IAM role.", { candidates: Candidates.roles }),
      ],
      permission: `${permissions}.${action === "get-iam-policy" ? "getIamPolicy" : "setIamPolicy"}`,
      requiredApis: [kind === "function" ? "cloudfunctions.googleapis.com" : "run.googleapis.com"],
      run: (ctx, args) => {
        const found = deploymentArg(ctx, args, kind);
        if (!Result.isOk(found)) {
          return found;
        }
        if (action === "get-iam-policy") {
          return finish(ctx.world, IamPolicy.toRecord(found.value.policy));
        }
        const binding = parseBinding(ctx.world, args);
        if (!Result.isOk(binding)) {
          return binding;
        }
        const { role, member } = binding.value;
        const current = found.value;
        const next =
          action === "add-iam-policy-binding"
            ? Option.some(IamPolicy.addBinding(current.policy, role, member))
            : IamPolicy.removeBinding(current.policy, role, member);
        if (!next.some) {
          return invalid("Binding does not exist.");
        }
        let world = putDeployment(ctx.world, { ...current, policy: next.value });
        const allowUnauthenticated = IamPolicy.hasBinding(
          next.value,
          "roles/run.invoker",
          "allUsers",
        );
        world = {
          ...world,
          runServices: world.runServices.map((s) =>
            kind === "run" && sameId(s, current) ? { ...s, allowUnauthenticated } : s,
          ),
          functions: world.functions.map((f) =>
            kind === "function" && sameId(f, current) ? { ...f, allowUnauthenticated } : f,
          ),
        };
        return finish(world, IamPolicy.toRecord(next.value));
      },
    });
  });

const resourceCommands = (kind: TargetKind): readonly CommandSpec[] => {
  const group = commandGroup(kind);
  const permission = permissionGroup(kind);
  return [
    projectCommand({
      path: [...group, "list"],
      summary: "List regional lesson resources.",
      flags: [regionFlag, Flag.list("regions", "Function regions.")],
      permission: `${permission}.list`,
      requiredApis: [kind === "function" ? "cloudfunctions.googleapis.com" : "run.googleapis.com"],
      run: (ctx, args) => {
        const region = ParsedArgs.string(args, "region");
        const regions = ParsedArgs.list(args, "regions");
        const rows = ctx.world.serverlessLab.deployments
          .filter(
            (d) =>
              d.kind === kind &&
              d.projectId === ctx.project.projectId &&
              (!region.some || d.region === region.value) &&
              (regions.length === 0 || regions.includes(d.region)),
          )
          .map((d) => ({
            ...deploymentRecord(d),
            state: "ACTIVE",
            triggerText:
              d.trigger.kind === "http" ? "HTTP Trigger" : `${d.trigger.kind}: ${d.trigger.source}`,
          }));
        return Result.ok({
          world: ctx.world,
          output: CommandOutput.table(rows, [
            Column.create("NAME", "name"),
            ...(kind === "function"
              ? [Column.create("STATE", "state"), Column.create("TRIGGER", "triggerText")]
              : []),
            Column.create("REGION", "region"),
            Column.create("REVISION", "latestRevision"),
          ]),
        });
      },
    }),
    ...["describe", "delete"].map((action) =>
      projectCommand({
        path: [...group, action],
        summary: `${action} a lesson resource.`,
        positionals: [Positional.required("NAME", "Resource name.", labCandidates("deployments"))],
        flags: [regionFlag],
        destructive: action === "delete",
        permission: `${permission}.${action === "describe" ? "get" : "delete"}`,
        requiredApis: [
          kind === "function" ? "cloudfunctions.googleapis.com" : "run.googleapis.com",
        ],
        run: (ctx, args) => {
          const found = deploymentArg(ctx, args, kind);
          if (!Result.isOk(found)) {
            return found;
          }
          if (action === "describe") {
            const d = found.value;
            const core = ctx.world.functions.find((f) => sameId(f, d));
            const base = kind === "function" && core ? CloudFunction.toRecord(core) : {};
            return finish(ctx.world, { ...deploymentRecord(d), ...base });
          }
          if (
            ctx.world.serverlessLab.triggers.some(
              (t) =>
                t.projectId === found.value.projectId &&
                t.region === found.value.region &&
                t.targetKind === kind &&
                t.target === found.value.name,
            )
          ) {
            return invalid("Delete referencing Eventarc triggers first.");
          }
          const d = found.value;
          const world = {
            ...ctx.world,
            runServices: ctx.world.runServices.filter((s) => !(kind === "run" && sameId(s, d))),
            functions: ctx.world.functions.filter((f) => !(kind === "function" && sameId(f, d))),
            serverlessLab: {
              ...ctx.world.serverlessLab,
              deployments: ctx.world.serverlessLab.deployments.filter(
                (r) => targetId(r) !== targetId(d),
              ),
            },
          };
          return finish(world, { deleted: d.name });
        },
      }),
    ),
    ...bindingCommands(kind),
  ];
};
const invocationCommand = (kind: "run" | "function"): CommandSpec =>
  projectCommand({
    path: kind === "function" ? ["gcloud", "functions", "call"] : ["sim", "run", "invoke"],
    summary:
      "Evaluate authentication, ingress and runtime dependencies using the fixed lesson handler.",
    positionals: [Positional.required("NAME", "Resource name.", labCandidates("deployments"))],
    flags: [
      regionFlag,
      Flag.boolean("anonymous", "Call without authentication."),
      Flag.enum("source", "Simulated request source.", ["external", "internal", "load-balancer"]),
      Flag.string("revision", "Serving revision to evaluate."),
      Flag.string("data", "JSON lesson payload (not executed)."),
    ],
    permissions: [],
    requiredApis: [kind === "function" ? "cloudfunctions.googleapis.com" : "run.googleapis.com"],
    run: (ctx, args) => {
      const found = deploymentArg(ctx, args, kind);
      if (!Result.isOk(found)) {
        return found;
      }
      if (found.value.trigger.kind !== "http") {
        return invalid(
          "Event functions require a source event; they cannot be called over HTTP in this lesson.",
        );
      }
      const data = ParsedArgs.string(args, "data");
      if (data.some) {
        try {
          JSON.parse(data.value);
        } catch {
          return invalid("--data must be JSON.");
        }
      }
      const result = invoke(
        ctx.world,
        found.value,
        ParsedArgs.boolean(args, "anonymous") ? "anonymous" : ctx.principal,
        Option.unwrapOr(ParsedArgs.string(args, "source"), "external"),
        Option.unwrapOr(ParsedArgs.string(args, "revision"), ""),
      );
      const output = {
        ...result.invocation,
        result:
          result.invocation.status === "SUCCEEDED"
            ? `Hello from ${found.value.name} (${latestRevision(found.value).image})`
            : undefined,
      };
      return finishInvocation(result.world, result.invocation, output);
    },
  });
export const ExtendedRunCommands: readonly CommandSpec[] = [
  projectCommand({
    path: ["gcloud", "run", "deploy"],
    summary: "Deploy a fixed Cloud Run lesson with immutable revisions.",
    positionals: [Positional.required("SERVICE", "Service name.")],
    flags: [
      regionFlag,
      ...RuntimeFlags,
      Flag.string("image", "Container image."),
      Flag.enum("platform", "Only managed Cloud Run is supported.", ["managed"]),
      Flag.boolean("allow-unauthenticated", "Grant allUsers the Invoker role."),
      Flag.boolean("no-traffic", "Create a revision without moving traffic."),
    ],
    permissions: [],
    requiredApis: ["run.googleapis.com"],
    run: deploy("run"),
  }),
  projectCommand({
    path: ["gcloud", "run", "services", "update"],
    summary: "Update runtime configuration by creating a new revision.",
    positionals: [Positional.required("SERVICE", "Service name.", Candidates.runServices)],
    flags: [
      regionFlag,
      ...RuntimeFlags,
      Flag.string("image", "Container image."),
      Flag.boolean("no-traffic", "Leave traffic on existing revisions."),
    ],
    permissions: [],
    requiredApis: ["run.googleapis.com"],
    run: deploy("run", true),
  }),
  ...resourceCommands("run"),
  invocationCommand("run"),
  projectCommand({
    path: ["gcloud", "run", "services", "update-traffic"],
    summary: "Route percentages to existing revisions.",
    positionals: [Positional.required("SERVICE", "Service name.", Candidates.runServices)],
    flags: [
      regionFlag,
      Flag.keyvalue("to-revisions", "REVISION=PERCENT, totals 100."),
      Flag.boolean("to-latest", "Send 100 percent to the latest revision."),
    ],
    permission: "run.services.update",
    requiredApis: ["run.googleapis.com"],
    run: (ctx, args) => {
      const found = deploymentArg(ctx, args);
      if (!Result.isOk(found)) {
        return found;
      }
      if (Boolean(args.flags["to-revisions"]) === ParsedArgs.boolean(args, "to-latest")) {
        return invalid("Specify exactly one of --to-revisions or --to-latest.");
      }
      const d = found.value;
      const traffic = ParsedArgs.boolean(args, "to-latest")
        ? { [latestRevision(d).name]: 100 }
        : Object.fromEntries(
            Object.entries(ParsedArgs.keyvalue(args, "to-revisions")).map(([key, value]) => [
              key === "LATEST" ? latestRevision(d).name : key,
              Number(value),
            ]),
          );
      if (
        Object.values(traffic).reduce((sum, n) => sum + n, 0) !== 100 ||
        !Object.entries(traffic).every(
          ([name, n]) =>
            Number.isSafeInteger(n) &&
            n >= 0 &&
            n <= 100 &&
            d.revisions.some((r) => r.name === name),
        )
      ) {
        return invalid(
          "Traffic must reference existing revisions and contain integer percentages totaling 100.",
        );
      }
      return finish(putDeployment(ctx.world, { ...d, traffic }), { traffic });
    },
  }),
];
export const ExtendedFunctionCommands: readonly CommandSpec[] = [
  projectCommand({
    path: ["gcloud", "functions", "deploy"],
    summary: "Deploy a Gen2 fixed lesson handler with HTTP/PubSub/Storage/Firestore triggers.",
    positionals: [Positional.required("NAME", "Function name.")],
    flags: [
      regionFlag,
      ...RuntimeFlags,
      Flag.string("runtime", "Supported function runtime."),
      Flag.string("entry-point", "Fixed handler entry point."),
      Flag.string("source", "Built-in lesson source (hello or . only)."),
      Flag.boolean("gen2", "Only Gen2 is modeled."),
      Flag.boolean("trigger-http", "HTTP trigger."),
      Flag.string("trigger-topic", "Existing Pub/Sub topic.", {
        candidates: Candidates.pubsubTopics,
      }),
      Flag.string("trigger-bucket", "Existing Storage bucket."),
      Flag.keyvalue("trigger-event-filters", "Firestore type/database/document filters."),
      Flag.boolean("allow-unauthenticated", "Grant allUsers the Cloud Run Invoker role."),
      Flag.boolean("retry", "Keep failed deliveries pending for explicit retry."),
    ],
    permissions: [],
    requiredApis: ["cloudfunctions.googleapis.com"],
    run: deploy("function"),
  }),
  ...resourceCommands("function"),
  invocationCommand("function"),
];
export const JobCommands: readonly CommandSpec[] = [
  ...["create", "update"].map((action) =>
    projectCommand({
      path: ["gcloud", "run", "jobs", action],
      summary: "Configure a fixed job lesson (no arbitrary container execution).",
      positionals: [Positional.required("NAME", "Job name.")],
      flags: [
        regionFlag,
        ...RuntimeFlags,
        Flag.string("image", "Image label."),
        Flag.integer("tasks", "Tasks (1–100)."),
      ],
      permissions: [],
      requiredApis: ["run.googleapis.com"],
      run: (ctx, args) => {
        const id = identity(ctx, args, "job");
        if (!Result.isOk(id)) {
          return id;
        }
        if (action === "create" && findDeployment(ctx.world, id.value, "job")) {
          return invalid("Job already exists.");
        }
        return deploy("job", action === "update")(ctx, args);
      },
    }),
  ),
  ...resourceCommands("job"),
  projectCommand({
    path: ["gcloud", "run", "jobs", "execute"],
    summary: "Run fixed lesson tasks and save execution history.",
    positionals: [Positional.required("NAME", "Job name.", labCandidates("deployments"))],
    flags: [regionFlag, Flag.boolean("wait", "The lesson executes immediately.")],
    permission: "run.jobs.run",
    requiredApis: ["run.googleapis.com"],
    run: (ctx, args) => {
      const found = deploymentArg(ctx, args, "job");
      if (!Result.isOk(found)) {
        return found;
      }
      const d = found.value;
      const reason =
        dependencies(ctx.world, d, latestRevision(d).config) ||
        (latestRevision(d).config.env.SIM_FAIL === "true" ? "Lesson job failed." : "");
      const invocation = {
        principal: ctx.principal,
        source: "job",
        status: reason ? ("FAILED" as const) : ("SUCCEEDED" as const),
        reason: reason || `${d.tasks} lesson tasks completed.`,
        revision: latestRevision(d).name,
        eventId: `execution-${ctx.world.sequence + 1}`,
      };
      return finishInvocation(
        putDeployment(
          { ...ctx.world, sequence: ctx.world.sequence + 1 },
          { ...d, invocations: [...d.invocations.slice(-99), invocation] },
        ),
        invocation,
      );
    },
  }),
  projectCommand({
    path: ["gcloud", "run", "revisions", "list"],
    summary: "List immutable revision configurations.",
    flags: [
      regionFlag,
      Flag.string("service", "Service name.", {
        required: true,
        candidates: Candidates.runServices,
      }),
    ],
    permission: "run.services.get",
    requiredApis: ["run.googleapis.com"],
    run: (ctx, args) => {
      const found = deploymentArg(ctx, {
        ...args,
        positionals: [ParsedArgs.requiredString(args, "service")],
      });
      if (!Result.isOk(found)) {
        return found;
      }
      return finish(ctx.world, { revisions: found.value.revisions, traffic: found.value.traffic });
    },
  }),
];
