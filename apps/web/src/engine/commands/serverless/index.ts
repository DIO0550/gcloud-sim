import { CommandFailure } from "@/engine/cli/command-failure";
import {
  Column,
  CommandContext,
  CommandOutput,
  type CommandResult,
  type CommandSpec,
  Flag,
  type JsonRecord,
  OutputMessage,
  ParsedArgs,
  Positional,
  type ProjectContext,
} from "@/engine/cli/command-spec";
import { Candidates, projectCommand } from "@/engine/commands/shared";
import { FunctionRuntime, FunctionRuntimes } from "@/engine/domains/catalog";
import { SampleFile } from "@/engine/domains/sample-files";
import { AppEngineApp, AppVersion, CloudFunction, TrafficSplit } from "@/engine/domains/serverless";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const FunctionsApi = "cloudfunctions.googleapis.com" as const;
const AppEngineApi = "appengine.googleapis.com" as const;

const FunctionColumns = [
  Column.create("NAME", "name", "basename"),
  Column.create("STATE", "state"),
  Column.create("TRIGGER", "trigger"),
  Column.create("REGION", "region"),
  Column.create("ENVIRONMENT", "environment"),
];

const functionRecord = (fn: CloudFunction): JsonRecord => ({
  ...CloudFunction.toRecord(fn),
  trigger: fn.trigger.kind === "http" ? "HTTP Trigger" : `topic: ${fn.trigger.topic}`,
  region: fn.region,
});

const functionArg = (
  ctx: ProjectContext,
  args: ParsedArgs,
): Result<CloudFunction, CommandFailure> => {
  const region = CommandContext.resolveRegion(
    ctx,
    ParsedArgs.string(args, "region"),
    "functions/region",
  );
  if (!Result.isOk(region)) return region;
  const name = ParsedArgs.requiredPositional(args, 0);
  const fn = Option.filter(
    World.findNamed(ctx.world, "functions", { projectId: ctx.project.projectId, name }),
    (f) => f.region === region.value,
  );
  return Option.toResult(fn, () =>
    CommandFailure.notFoundWith(
      `ResponseError: status=[404], code=[Ok], message=[Function ${name} in region ${region.value} in project ${ctx.project.projectId} does not exist]`,
    ),
  );
};

const deployFunction = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const region = CommandContext.resolveRegion(
    ctx,
    ParsedArgs.string(args, "region"),
    "functions/region",
  );
  if (!Result.isOk(region)) return region;
  const rawRuntime = ParsedArgs.requiredString(args, "runtime");
  const runtime = Option.toResult(FunctionRuntime.parse(rawRuntime), () =>
    CommandFailure.invalidChoice("--runtime", rawRuntime, Object.values(FunctionRuntimes)),
  );
  if (!Result.isOk(runtime)) return runtime;
  const http = ParsedArgs.boolean(args, "trigger-http");
  const topic = ParsedArgs.string(args, "trigger-topic");
  if (http === Option.isSome(topic)) {
    return Result.err(CommandFailure.mustBeSpecified("(--trigger-http | --trigger-topic)"));
  }
  if (
    Option.isSome(topic) &&
    !Option.isSome(
      World.findNamed(ctx.world, "pubsubTopics", {
        projectId: ctx.project.projectId,
        name: topic.value,
      }),
    )
  ) {
    return Result.err(
      CommandFailure.notFoundWith(
        `ResponseError: status=[404], code=[Ok], message=[Pub/Sub topic projects/${ctx.project.projectId}/topics/${topic.value} does not exist]`,
      ),
    );
  }
  const name = ParsedArgs.requiredPositional(args, 0);
  const previous = Option.filter(
    World.findNamed(ctx.world, "functions", { projectId: ctx.project.projectId, name }),
    (f) => f.region === region.value,
  );
  const memory = ParsedArgs.string(args, "memory");
  const memoryMb = Option.map(memory, (m) => {
    const match = /^(\d+)(MB|GB|Mi|Gi)?$/i.exec(m);
    const amount = Number(match?.[1] ?? Number.NaN);
    const unit = (match?.[2] ?? "MB").toUpperCase();
    return unit.startsWith("G") ? amount * 1024 : amount;
  });
  if (Option.isSome(memoryMb) && !Number.isFinite(memoryMb.value)) {
    return Result.err(
      CommandFailure.invalidValue(
        "--memory",
        `Invalid value: ${Option.unwrapOr(memory, "")}. Expected e.g. 256MB or 1GB.`,
      ),
    );
  }
  const fn = Result.mapErr(
    CloudFunction.create({
      projectId: ctx.project.projectId,
      name,
      region: region.value,
      runtime: runtime.value,
      entryPoint: ParsedArgs.string(args, "entry-point"),
      trigger: http ? { kind: "http" } : { kind: "topic", topic: Option.unwrapOr(topic, "") },
      allowUnauthenticated: ParsedArgs.boolean(args, "allow-unauthenticated"),
      memoryMb,
      updateTime: ctx.now,
      previous,
    }),
    (m) => CommandFailure.invalidValue("NAME", m),
  );
  if (!Result.isOk(fn)) return fn;
  const world = Option.isSome(previous)
    ? World.replaceNamed(ctx.world, "functions", fn.value)
    : Result.unwrapOr(
        World.withNamed(ctx.world, "functions", fn.value, CloudFunction.fullName(fn.value)),
        ctx.world,
      );
  const url = CloudFunction.url(fn.value);
  return Result.ok({
    world,
    output: CommandOutput.messages(
      OutputMessage.plain(`Preparing function...done.`),
      OutputMessage.plain(
        Option.isSome(previous)
          ? "Updating function (may take a while)...done."
          : "Deploying function (may take a while)...done.",
      ),
      OutputMessage.plain(""),
      OutputMessage.plain(`buildConfig:`),
      OutputMessage.plain(`  entryPoint: ${fn.value.entryPoint}`),
      OutputMessage.plain(`  runtime: ${fn.value.runtime}`),
      OutputMessage.plain(`name: ${CloudFunction.fullName(fn.value)}`),
      OutputMessage.plain(`state: ACTIVE`),
      ...(Option.isSome(url) ? [OutputMessage.plain(`url: ${url.value}`)] : []),
    ),
  });
};

const callFunction = (ctx: ProjectContext, args: ParsedArgs): CommandResult =>
  Result.map(functionArg(ctx, args), (fn) => ({
    world: ctx.world,
    output: CommandOutput.messages(
      OutputMessage.plain(`executionId: ${(0x4f2a1c + ctx.world.sequence).toString(16)}`),
      OutputMessage.plain(
        fn.trigger.kind === "http"
          ? `result: Hello from ${fn.name} (${fn.runtime}), data=${Option.unwrapOr(ParsedArgs.string(args, "data"), "{}")}`
          : `result: OK (published test message to topic ${fn.trigger.topic})`,
      ),
    ),
  }));

const VersionColumns = [
  Column.create("SERVICE", "service"),
  Column.create("VERSION.ID", "id"),
  Column.create("TRAFFIC_SPLIT", "traffic_split"),
  Column.create("LAST_DEPLOYED", "createTime"),
  Column.create("SERVING_STATUS", "servingStatus"),
];

const requireApp = (ctx: ProjectContext): Result<AppEngineApp, CommandFailure> =>
  Option.toResult(World.findAppEngineApp(ctx.world, ctx.project.projectId), () =>
    CommandFailure.notFoundWith(
      `The current Google Cloud project [${ctx.project.projectId}] does not contain an App Engine application. Use \`gcloud app create\` to initialize an App Engine application within the project (gcloud-sim: gcloud app deploy --region=REGION でも作れます).`,
    ),
  );

const deployApp = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const path = Option.unwrapOr(ParsedArgs.positional(args, 0), "app.yaml");
  const sample = SampleFile.find(path);
  if (!Option.isSome(sample) || sample.value.kind !== "app-yaml") {
    return Result.err(
      CommandFailure.notFoundWith(
        `[${path}] could not be found. No such file or directory.\ngcloud-sim: 使えるサンプルは app.yaml です（中身は docs/COMMANDS.md）。`,
      ),
    );
  }
  const existing = World.findAppEngineApp(ctx.world, ctx.project.projectId);
  const app: Result<AppEngineApp, CommandFailure> = Option.isSome(existing)
    ? Result.ok(existing.value)
    : Result.map(CommandContext.resolveRegion(ctx, ParsedArgs.string(args, "region")), (region) =>
        AppEngineApp.create({ projectId: ctx.project.projectId, region, createTime: ctx.now }),
      );
  if (!Result.isOk(app)) return app;
  const withApp = Option.isSome(existing)
    ? ctx.world
    : World.withAppEngineApp(ctx.world, app.value);
  const id = Option.unwrapOr(ParsedArgs.string(args, "version"), AppVersion.idFromTime(ctx.now));
  if (
    World.appVersionsOf(withApp, ctx.project.projectId, sample.value.service).some(
      (v) => v.id === id,
    )
  ) {
    return Result.err(
      CommandFailure.alreadyExists(
        `apps/${ctx.project.projectId}/services/${sample.value.service}/versions/${id}`,
      ),
    );
  }
  const version: AppVersion = {
    projectId: ctx.project.projectId,
    service: sample.value.service,
    id,
    runtime: sample.value.runtime,
    trafficSplit: 1,
    createTime: ctx.now,
  };
  const promote = Option.unwrapOr(ParsedArgs.booleanChoice(args, "promote"), true);
  const world = promote
    ? World.withAppVersionPromoted(withApp, version)
    : { ...withApp, appVersions: [...withApp.appVersions, { ...version, trafficSplit: 0 }] };
  const hostname = AppEngineApp.defaultHostname(app.value);
  return Result.ok({
    world,
    output: CommandOutput.messages(
      ...(Option.isSome(existing)
        ? []
        : [
            OutputMessage.plain(
              `Creating App Engine application in project [${ctx.project.projectId}] and region [${app.value.region}]....done.`,
            ),
          ]),
      OutputMessage.plain("Services to deploy:"),
      OutputMessage.plain(""),
      OutputMessage.plain(`descriptor:                  [${path}]`),
      OutputMessage.plain(`source:                      [.]`),
      OutputMessage.plain(`target project:              [${ctx.project.projectId}]`),
      OutputMessage.plain(`target service:              [${sample.value.service}]`),
      OutputMessage.plain(`target version:              [${id}]`),
      OutputMessage.plain(`target url:                  [https://${hostname}]`),
      OutputMessage.plain(""),
      OutputMessage.plain("Beginning deployment of service [default]...done."),
      OutputMessage.plain("Updating service [default]...done."),
      OutputMessage.plain(
        promote
          ? "Setting traffic split for service [default]...done."
          : "Version deployed without promoting (traffic unchanged).",
      ),
      OutputMessage.plain(`Deployed service [${sample.value.service}] to [https://${hostname}]`),
      OutputMessage.plain(""),
      OutputMessage.plain("To view your application in the web browser run:"),
      OutputMessage.plain("  $ gcloud app browse"),
    ),
  });
};

const setTraffic = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const app = requireApp(ctx);
  if (!Result.isOk(app)) return app;
  const service = ParsedArgs.requiredPositional(args, 0);
  const versions = World.appVersionsOf(ctx.world, ctx.project.projectId, service);
  if (versions.length === 0) {
    return Result.err(CommandFailure.notFoundWith(`Service [${service}] not found.`));
  }
  const splits = Result.mapErr(TrafficSplit.parse(ParsedArgs.keyvalue(args, "splits")), (m) =>
    CommandFailure.invalidValue("--splits", m),
  );
  if (!Result.isOk(splits)) return splits;
  const unknown = Object.keys(splits.value).find((id) => !versions.some((v) => v.id === id));
  if (unknown !== undefined) {
    return Result.err(
      CommandFailure.notFoundWith(`Version [${unknown}] of service [${service}] not found.`),
    );
  }
  return Result.ok({
    world: World.withTrafficSplits(
      ctx.world,
      { projectId: ctx.project.projectId, service },
      splits.value,
    ),
    output: CommandOutput.messages(
      OutputMessage.plain(`Setting the following traffic allocation:`),
      ...Object.entries(splits.value).map(([id, share]) =>
        OutputMessage.plain(`  ${service}: ${id} -> ${share}`),
      ),
      OutputMessage.plain("Setting traffic split for service [default]...done."),
    ),
  });
};

const FunctionRegionFlag = Flag.string(
  "region",
  "The Cloud region for the function. Overrides the default functions/region property.",
  { candidates: Candidates.regions },
);

export const FunctionsCommands: readonly CommandSpec[] = [
  projectCommand({
    path: ["gcloud", "functions", "deploy"],
    summary: "Create or update a Google Cloud Function.",
    positionals: [Positional.required("NAME", "ID of the function.", Candidates.functions)],
    flags: [
      FunctionRegionFlag,
      Flag.enum(
        "runtime",
        "Runtime in which to run the function.",
        Object.values(FunctionRuntimes),
        { required: true },
      ),
      Flag.boolean(
        "trigger-http",
        "Function will be assigned an endpoint, which you can view by using the describe command.",
      ),
      Flag.string(
        "trigger-topic",
        "Name of Pub/Sub topic. Every message published in this topic will trigger function execution.",
        { candidates: Candidates.pubsubTopics },
      ),
      Flag.string(
        "entry-point",
        "Name of a Google Cloud Function (as defined in source code) that will be executed.",
      ),
      Flag.string("memory", "Limit on the amount of memory the function can use, e.g. 256MB, 1GB."),
      Flag.boolean("allow-unauthenticated", "If set, makes this a public function."),
      Flag.boolean("gen2", "Deploy as a 2nd gen function (gcloud-sim always deploys 2nd gen)."),
      Flag.string("source", "Location of source code to deploy (accepted, not read)."),
    ],
    permission: "cloudfunctions.functions.create",
    requiredApis: [FunctionsApi],
    run: deployFunction,
  }),
  projectCommand({
    path: ["gcloud", "functions", "list"],
    summary: "List Google Cloud Functions.",
    flags: [Flag.list("regions", "Regions containing functions to list.")],
    permission: "cloudfunctions.functions.list",
    requiredApis: [FunctionsApi],
    run: (ctx, args) => {
      const regions = ParsedArgs.list(args, "regions");
      const rows = World.namedOf(ctx.world, "functions", ctx.project.projectId)
        .filter((f) => regions.length === 0 || regions.includes(f.region))
        .map(functionRecord);
      return Result.ok({ world: ctx.world, output: CommandOutput.table(rows, FunctionColumns) });
    },
  }),
  projectCommand({
    path: ["gcloud", "functions", "describe"],
    summary: "Display details of a Google Cloud Function.",
    positionals: [Positional.required("NAME", "ID of the function.", Candidates.functions)],
    flags: [FunctionRegionFlag],
    permission: "cloudfunctions.functions.get",
    requiredApis: [FunctionsApi],
    run: (ctx, args) =>
      Result.map(functionArg(ctx, args), (fn) => ({
        world: ctx.world,
        output: CommandOutput.yaml(CloudFunction.toRecord(fn)),
      })),
  }),
  projectCommand({
    path: ["gcloud", "functions", "delete"],
    summary: "Delete a Google Cloud Function.",
    positionals: [Positional.required("NAME", "ID of the function.", Candidates.functions)],
    flags: [FunctionRegionFlag],
    destructive: true,
    permission: "cloudfunctions.functions.delete",
    requiredApis: [FunctionsApi],
    run: (ctx, args) =>
      Result.map(functionArg(ctx, args), (fn) => ({
        world: World.withoutNamed(ctx.world, "functions", fn),
        output: CommandOutput.messages(
          OutputMessage.plain(`Deleted [${CloudFunction.fullName(fn)}].`),
        ),
      })),
  }),
  projectCommand({
    path: ["gcloud", "functions", "call"],
    summary: "Trigger execution of a Google Cloud Function.",
    positionals: [Positional.required("NAME", "ID of the function.", Candidates.functions)],
    flags: [
      FunctionRegionFlag,
      Flag.string("data", "JSON string with data that will be passed to the function."),
    ],
    permission: "cloudfunctions.functions.call",
    requiredApis: [FunctionsApi],
    run: callFunction,
  }),
];

export const AppCommands: readonly CommandSpec[] = [
  projectCommand({
    path: ["gcloud", "app", "deploy"],
    summary:
      "Deploy the local code and/or configuration of your app to App Engine (sample app.yaml only).",
    positionals: [
      Positional.optional(
        "DEPLOYABLES",
        "The yaml files for the services to deploy (default: app.yaml).",
      ),
    ],
    flags: [
      Flag.string(
        "region",
        "The region to create the App Engine application in (first deploy only). Overrides app/region.",
      ),
      Flag.string(
        "version",
        "The version ID to name this deployment (default: generated from the time).",
      ),
      Flag.boolean(
        "promote",
        "Promote the deployed version to receive all traffic (default: true).",
      ),
    ],
    permissions: ["appengine.applications.create", "appengine.versions.create"],
    requiredApis: [AppEngineApi],
    run: deployApp,
  }),
  projectCommand({
    path: ["gcloud", "app", "browse"],
    summary: "Open the current app in a web browser (prints the URL; gcloud-sim has no browser).",
    flags: [Flag.string("service", "The service to browse (default: default).")],
    permission: "appengine.applications.get",
    requiredApis: [AppEngineApi],
    run: (ctx) =>
      Result.map(requireApp(ctx), (app) => ({
        world: ctx.world,
        output: CommandOutput.messages(
          OutputMessage.plain("Did not detect your browser. Go to this link to view your app:"),
          OutputMessage.plain(`https://${AppEngineApp.defaultHostname(app)}`),
        ),
      })),
  }),
  projectCommand({
    path: ["gcloud", "app", "describe"],
    summary: "Display all data about an existing App Engine application.",
    permission: "appengine.applications.get",
    requiredApis: [AppEngineApi],
    run: (ctx) =>
      Result.map(requireApp(ctx), (app) => ({
        world: ctx.world,
        output: CommandOutput.yaml(AppEngineApp.toRecord(app)),
      })),
  }),
  projectCommand({
    path: ["gcloud", "app", "versions", "list"],
    summary: "List the versions of all services in the App Engine server.",
    flags: [Flag.string("service", "Only show versions from this service.")],
    permission: "appengine.versions.list",
    requiredApis: [AppEngineApi],
    run: (ctx, args) => {
      const app = requireApp(ctx);
      if (!Result.isOk(app)) return app;
      const service = ParsedArgs.string(args, "service");
      const rows = ctx.world.appVersions
        .filter((v) => v.projectId === ctx.project.projectId)
        .filter((v) => !Option.isSome(service) || v.service === service.value)
        .map(AppVersion.toRecord);
      return Result.ok({ world: ctx.world, output: CommandOutput.table(rows, VersionColumns) });
    },
  }),
  projectCommand({
    path: ["gcloud", "app", "services", "set-traffic"],
    summary: "Set traffic splitting settings.",
    positionals: [Positional.required("SERVICE", "The service to modify.")],
    flags: [
      Flag.keyvalue("splits", "Key-value pairs of version to traffic split, e.g. v1=0.5,v2=0.5.", {
        required: true,
      }),
      Flag.enum("split-by", "Criteria by which to split traffic (accepted, not simulated).", [
        "cookie",
        "ip",
        "random",
      ]),
    ],
    permission: "appengine.services.update",
    requiredApis: [AppEngineApi],
    run: setTraffic,
  }),
];
