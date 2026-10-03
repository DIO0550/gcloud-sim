import { CommandFailure } from "@/engine/cli/command-failure";
import {
  Column,
  CommandOutput,
  type CommandResult,
  type CommandSpec,
  Flag,
  OutputMessage,
  ParsedArgs,
  Positional,
  type ProjectContext,
} from "@/engine/cli/command-spec";
import { Filter } from "@/engine/cli/formatter";
import { LogFilter } from "@/engine/commands/observability/filter";
import { alreadyExists, Candidates, projectCommand } from "@/engine/commands/shared";
import { AlertPolicy, Dashboard, LogMetric, UptimeCheck } from "@/engine/domains/monitoring";
import { SampleFile } from "@/engine/domains/sample-files";
import { type NamedItem, World } from "@/engine/domains/world";
import type { JsonRecord } from "@/types/Json";
import { Decoder as D, type Decoder } from "@/utils/Decoder";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const invalid = (message: string) => CommandFailure.invalidValue("configuration", message);
const text = (args: ParsedArgs, name: string, fallback: string) =>
  Option.unwrapOr(ParsedArgs.string(args, name), fallback);
const success = (world: World, message: string): CommandResult =>
  Result.ok({ world, output: CommandOutput.messages(OutputMessage.plain(message)) });

type Collection = "logMetrics" | "uptimeChecks" | "alertPolicies" | "dashboards";

/** The same project-scoped lifecycle rules apply to the four observability resources. */
const lifecycle = <K extends Collection>(
  seed: Readonly<{
    collection: K;
    path: readonly string[];
    permission: string;
    resource: string;
    api: "logging.googleapis.com" | "monitoring.googleapis.com";
    record: (item: NamedItem<K>) => JsonRecord;
  }>,
): readonly CommandSpec[] => [
  projectCommand({
    path: [...seed.path, "list"],
    summary: `List ${seed.resource}.`,
    permission: `${seed.permission}.list`,
    requiredApis: [seed.api],
    run: (ctx) =>
      Result.ok({
        world: ctx.world,
        output: CommandOutput.table(
          World.namedOf(ctx.world, seed.collection, ctx.project.projectId).map(seed.record),
          [Column.create("NAME", "name"), Column.create("DISPLAY_NAME", "displayName")],
        ),
      }),
  }),
  ...(["describe", "delete"] as const).map((action) =>
    projectCommand({
      path: [...seed.path, action],
      summary: `${action} ${seed.resource}.`,
      positionals: [
        Positional.required(
          "NAME",
          "Resource ID or full resource name.",
          Candidates.named(seed.collection),
        ),
      ],
      permission: `${seed.permission}.${action === "describe" ? "get" : "delete"}`,
      requiredApis: [seed.api],
      destructive: action === "delete",
      run: (ctx, args) => {
        const raw = ParsedArgs.requiredPositional(args, 0);
        const prefix = `projects/${ctx.project.projectId}/${seed.resource}/`;
        if (raw.includes("/") && !raw.startsWith(prefix))
          return Result.err(invalid("Resource belongs to another project or resource type."));
        const name = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
        const item = World.findNamed(ctx.world, seed.collection, {
          projectId: ctx.project.projectId,
          name,
        });
        if (!Option.isSome(item)) return Result.err(CommandFailure.notFound(`${prefix}${name}`));
        if (action === "delete")
          return success(
            World.withoutNamed(ctx.world, seed.collection, item.value),
            `Deleted [${prefix}${name}].`,
          );
        return Result.ok({ world: ctx.world, output: CommandOutput.yaml(seed.record(item.value)) });
      },
    }),
  ),
];

const save = <K extends Collection>(
  ctx: ProjectContext,
  collection: K,
  item: NamedItem<K>,
  record: (item: NamedItem<K>) => JsonRecord,
): CommandResult =>
  Result.map(
    Result.mapErr(World.withNamed(ctx.world, collection, item, item.name), alreadyExists),
    (world) => ({
      world,
      output: CommandOutput.yaml(record(item)),
    }),
  );

/** Only counter metrics are modeled; unsupported filters fail rather than being silently ignored. */
export const LogMetricCommands: readonly CommandSpec[] = [
  ...lifecycle({
    collection: "logMetrics",
    path: ["gcloud", "logging", "metrics"],
    permission: "logging.logMetrics",
    resource: "metrics",
    api: "logging.googleapis.com",
    record: LogMetric.toRecord,
  }),
  ...(["create", "update"] as const).map((action) =>
    projectCommand({
      path: ["gcloud", "logging", "metrics", action],
      summary: `${action} a user-defined counter metric (no real ingestion).`,
      positionals: [
        Positional.required("METRIC_NAME", "Counter metric name.", Candidates.named("logMetrics")),
      ],
      flags: [
        Flag.string("log-filter", "Supported Logging filter expression.", {
          required: action === "create",
        }),
        Flag.string("description", "Description."),
      ],
      permission: `logging.logMetrics.${action}`,
      requiredApis: ["logging.googleapis.com"],
      run: (ctx, args) => {
        const name = ParsedArgs.requiredPositional(args, 0);
        if (!/^[A-Za-z][A-Za-z0-9_.-]{0,99}$/.test(name))
          return Result.err(invalid("Invalid metric name."));
        const previous = World.findNamed(ctx.world, "logMetrics", {
          projectId: ctx.project.projectId,
          name,
        });
        if (action === "update" && !Option.isSome(previous))
          return Result.err(CommandFailure.notFound(name));
        const metric: LogMetric = {
          projectId: ctx.project.projectId,
          name,
          description: text(
            args,
            "description",
            Option.isSome(previous) ? previous.value.description : "",
          ),
          filter: text(args, "log-filter", Option.isSome(previous) ? previous.value.filter : ""),
        };
        const filter = LogFilter.parse(metric.filter);
        if (!Result.isOk(filter)) return filter;
        if (action === "update")
          return Result.ok({
            world: World.replaceNamed(ctx.world, "logMetrics", metric),
            output: CommandOutput.yaml(LogMetric.toRecord(metric)),
          });
        return save(ctx, "logMetrics", metric, LogMetric.toRecord);
      },
    }),
  ),
];

const one = <T>(decoder: Decoder<T>): Decoder<readonly T[]> =>
  D.map(D.array(decoder), (values) =>
    values.length === 1
      ? Result.ok(values)
      : Result.err("Only one chart and one time series are supported."),
  );
/** Reject unmodeled JSON fields, so a submitted chart never loses configuration silently. */
const exact =
  <T extends object>(fields: Readonly<{ [K in keyof T]-?: Decoder<T[K]> }>): Decoder<T> =>
  (value, path) => {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const extra = Object.keys(value).find((key) => !Object.hasOwn(fields, key));
      if (extra !== undefined)
        return Result.err(`${path}.${extra} is not supported by gcloud-sim.`);
    }
    return D.object<T>(fields)(value, path);
  };
const dashboardConfig = exact({
  displayName: D.string,
  gridLayout: exact({
    columns: D.literal([1]),
    widgets: one(
      exact({
        title: D.string,
        xyChart: exact({
          dataSets: one(
            exact({
              timeSeriesQuery: exact({ timeSeriesFilter: exact({ filter: D.string }) }),
            }),
          ),
        }),
      }),
    ),
  }),
});

const createDashboard = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const inline = ParsedArgs.string(args, "config");
  const filename = ParsedArgs.string(args, "config-from-file");
  if (Option.isSome(inline) === Option.isSome(filename))
    return Result.err(invalid("Specify exactly one of --config or --config-from-file."));
  let input: unknown;
  if (Option.isSome(inline)) {
    try {
      input = JSON.parse(inline.value);
    } catch {
      return Result.err(invalid("Expected a JSON dashboard configuration."));
    }
  }
  if (Option.isSome(filename)) {
    const sample = SampleFile.find(filename.value);
    if (!Option.isSome(sample) || sample.value.kind !== "monitoring-dashboard")
      return Result.err(
        invalid(`No supported dashboard file: ${filename.value}. Use cpu-dashboard.json.`),
      );
    input = sample.value.config;
  }
  const config = Result.mapErr(dashboardConfig(input, "config"), invalid);
  if (!Result.isOk(config)) return config;
  const widget = config.value.gridLayout.widgets[0];
  const filter = widget?.xyChart.dataSets[0]?.timeSeriesQuery.timeSeriesFilter.filter;
  const numbered = World.nextNumber(ctx.world);
  const dashboard = Result.mapErr(
    Dashboard.decode(
      {
        projectId: ctx.project.projectId,
        name: String(numbered.number),
        displayName: config.value.displayName,
        title: widget?.title,
        filter,
      },
      "dashboard",
    ),
    invalid,
  );
  if (!Result.isOk(dashboard)) return dashboard;
  if (ParsedArgs.boolean(args, "validate-only"))
    return success(ctx.world, "Dashboard configuration is valid (not saved).");
  return save({ ...ctx, world: numbered.world }, "dashboards", dashboard.value, Dashboard.toRecord);
};

export const MonitoringResourceCommands: readonly CommandSpec[] = [
  ...lifecycle({
    collection: "dashboards",
    path: ["gcloud", "monitoring", "dashboards"],
    permission: "monitoring.dashboards",
    resource: "dashboards",
    api: "monitoring.googleapis.com",
    record: Dashboard.toRecord,
  }),
  ...lifecycle({
    collection: "alertPolicies",
    path: ["gcloud", "monitoring", "policies"],
    permission: "monitoring.alertPolicies",
    resource: "alertPolicies",
    api: "monitoring.googleapis.com",
    record: AlertPolicy.toRecord,
  }),
  ...lifecycle({
    collection: "uptimeChecks",
    path: ["gcloud", "monitoring", "uptime"],
    permission: "monitoring.uptimeCheckConfigs",
    resource: "uptimeCheckConfigs",
    api: "monitoring.googleapis.com",
    record: UptimeCheck.toRecord,
  }),
  projectCommand({
    path: ["gcloud", "monitoring", "dashboards", "create"],
    summary:
      "Create one single-series grid chart. JSON or cpu-dashboard.json; no real metric collection.",
    flags: [
      Flag.string("config", "Inline JSON (one gridLayout chart)."),
      Flag.string("config-from-file", "Built-in cpu-dashboard.json."),
      Flag.boolean("validate-only", "Validate without saving."),
    ],
    permission: "monitoring.dashboards.create",
    requiredApis: ["monitoring.googleapis.com"],
    run: createDashboard,
  }),
  projectCommand({
    path: ["gcloud", "monitoring", "policies", "create"],
    summary: "Create one metric threshold condition. Incidents and notifications are not executed.",
    flags: [
      Flag.string("display-name", "Policy display name.", { required: true }),
      Flag.string("condition-display-name", "Condition display name.", { required: true }),
      Flag.string("condition-filter", "Metric/resource filter.", { required: true }),
      Flag.string("if", "Comparison, e.g. '> 0.8' or '< 1'.", { required: true }),
      Flag.string("duration", "Retest interval, a multiple of 60s.", { required: true }),
      Flag.enum("combiner", "Single condition combiner.", ["OR"]),
      Flag.boolean("enabled", "Whether the policy is enabled (default true)."),
    ],
    permission: "monitoring.alertPolicies.create",
    requiredApis: ["monitoring.googleapis.com"],
    run: (ctx, args) => {
      const comparison = /^([<>])\s*(-?\d+(?:\.\d+)?)$/.exec(text(args, "if", ""));
      if (comparison === null) return Result.err(invalid("--if must be '> NUMBER' or '< NUMBER'."));
      const numbered = World.nextNumber(ctx.world);
      const policy = Result.mapErr(
        AlertPolicy.decode(
          {
            projectId: ctx.project.projectId,
            name: String(numbered.number),
            displayName: text(args, "display-name", ""),
            conditionName: text(args, "condition-display-name", ""),
            filter: text(args, "condition-filter", ""),
            comparison: comparison[1] === ">" ? "COMPARISON_GT" : "COMPARISON_LT",
            threshold: Number(comparison[2]),
            duration: text(args, "duration", ""),
            enabled: Option.unwrapOr(ParsedArgs.booleanChoice(args, "enabled"), true),
          },
          "policy",
        ),
        invalid,
      );
      if (!Result.isOk(policy)) return policy;
      const filter = Filter.parse(policy.value.filter);
      if (!Result.isOk(filter)) return filter;
      return save(
        { ...ctx, world: numbered.world },
        "alertPolicies",
        policy.value,
        AlertPolicy.toRecord,
      );
    },
  }),
  projectCommand({
    path: ["gcloud", "monitoring", "uptime", "create"],
    summary: "Configure a public URL uptime check (no network request or real probe).",
    positionals: [Positional.required("DISPLAY_NAME", "Check display name.")],
    flags: [
      Flag.enum("resource-type", "Only public URL resources are simulated.", ["uptime-url"], {
        required: true,
      }),
      Flag.keyvalue("resource-labels", "host=HOST,project_id=PROJECT", { required: true }),
      Flag.enum("protocol", "HTTP protocol (default http).", ["http", "https"]),
      Flag.string("path", "Request path (default /)."),
      Flag.integer("port", "Port (default 80 or 443)."),
      Flag.enum("period", "Check interval.", ["1", "5", "10", "15"]),
      Flag.integer("timeout", "Timeout in seconds (default 60)."),
    ],
    permission: "monitoring.uptimeCheckConfigs.create",
    requiredApis: ["monitoring.googleapis.com"],
    run: (ctx, args) => {
      const labels = ParsedArgs.keyvalue(args, "resource-labels");
      if (Object.keys(labels).some((key) => !["host", "project_id"].includes(key)))
        return Result.err(invalid("Only host and project_id resource labels are supported."));
      if (labels.project_id !== ctx.project.projectId)
        return Result.err(invalid("resource-labels project_id must match the selected project."));
      if (!labels.host || !/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(labels.host))
        return Result.err(invalid("host must be a hostname or IPv4 address, without scheme/path."));
      const protocol = text(args, "protocol", "http");
      const numbered = World.nextNumber(ctx.world);
      const check = Result.mapErr(
        UptimeCheck.decode(
          {
            projectId: ctx.project.projectId,
            name: `uptime-${numbered.number}`,
            displayName: ParsedArgs.requiredPositional(args, 0),
            host: labels.host,
            path: text(args, "path", "/"),
            protocol,
            port: Option.unwrapOr(
              ParsedArgs.integer(args, "port"),
              protocol === "https" ? 443 : 80,
            ),
            period: `${Number(text(args, "period", "1")) * 60}s`,
            timeout: `${Option.unwrapOr(ParsedArgs.integer(args, "timeout"), 60)}s`,
          },
          "uptime",
        ),
        invalid,
      );
      if (!Result.isOk(check)) return check;
      return save(
        { ...ctx, world: numbered.world },
        "uptimeChecks",
        check.value,
        UptimeCheck.toRecord,
      );
    },
  }),
];
