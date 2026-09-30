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
import {
  alreadyExists,
  Candidates,
  describeNamedCommand,
  projectCommand,
} from "@/engine/commands/shared";
import { Freshness, LogEntry, LogNames, LogSink } from "@/engine/domains/observability";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const LoggingApi = "logging.googleapis.com" as const;
const MonitoringApi = "monitoring.googleapis.com" as const;

const SinkColumns = [
  Column.create("NAME", "name"),
  Column.create("DESTINATION", "destination"),
  Column.create("FILTER", "filter"),
];

/**
 * 監査ログを新しい順に読む。`--freshness` より古いものと `--limit` を超える分は落とす。
 * `--filter` はグローバルフラグの簡易フィルタが後段でかかる。
 */
const readLogs = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const rawFreshness = Option.unwrapOr(ParsedArgs.string(args, "freshness"), "1d");
  const freshness = Option.toResult(Freshness.parse(rawFreshness), () =>
    CommandFailure.invalidValue(
      "--freshness",
      `Invalid value: ${rawFreshness}. Expected a duration such as 1d, 12h or 30m.`,
    ),
  );
  if (!Result.isOk(freshness)) return freshness;
  const since = Date.parse(ctx.now) - freshness.value * 1000;
  const entries = World.operationsOf(ctx.world, ctx.project.projectId)
    .map(LogEntry.fromOperation)
    .filter((e) => Date.parse(e.timestamp) >= since)
    .toReversed();
  return Result.ok({
    world: ctx.world,
    output: CommandOutput.yamlList(entries.map(LogEntry.toRecord)),
  });
};

const createSink = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const numbered = World.nextNumber(ctx.world);
  const sink = Result.mapErr(
    LogSink.create(
      {
        projectId: ctx.project.projectId,
        name: ParsedArgs.requiredPositional(args, 0),
        destination: ParsedArgs.requiredPositional(args, 1),
        filter: Option.unwrapOr(ParsedArgs.string(args, "log-filter"), ""),
        createTime: ctx.now,
      },
      numbered.number,
    ),
    (m) => CommandFailure.invalidValue("SINK", m),
  );
  if (!Result.isOk(sink)) return sink;
  return Result.map(
    Result.mapErr(
      World.withNamed(
        numbered.world,
        "logSinks",
        sink.value,
        `projects/${ctx.project.projectId}/sinks/${sink.value.name}`,
      ),
      alreadyExists,
    ),
    (world) => ({
      world,
      output: CommandOutput.messages(
        OutputMessage.plain(
          `Created [https://logging.googleapis.com/v2/projects/${ctx.project.projectId}/sinks/${sink.value.name}].`,
        ),
        OutputMessage.plain(
          `Please remember to grant \`${sink.value.writerIdentity}\` the Storage Object Creator role on the bucket (or the equivalent role on the destination).`,
        ),
        OutputMessage.plain(
          "More information about sinks can be found at https://cloud.google.com/logging/docs/export/configure_export",
        ),
      ),
    }),
  );
};

export const LoggingCommands: readonly CommandSpec[] = [
  projectCommand({
    path: ["gcloud", "logging", "read"],
    summary: "Read log entries (audit logs derived from the operation history).",
    positionals: [
      Positional.optional(
        "LOG_FILTER",
        "Filter expression (accepted; use --filter for gcloud-sim's simple filter).",
      ),
    ],
    flags: [
      Flag.string(
        "freshness",
        "Return entries that are not older than this value, e.g. 1d, 12h (default 1d).",
      ),
      Flag.enum("order", "Ordering of returned log entries (only desc is simulated).", [
        "asc",
        "desc",
      ]),
    ],
    permission: "logging.logEntries.list",
    requiredApis: [LoggingApi],
    run: readLogs,
  }),
  projectCommand({
    path: ["gcloud", "logging", "logs", "list"],
    summary: "List logs in a project.",
    permission: "logging.logs.list",
    requiredApis: [LoggingApi],
    run: (ctx) =>
      Result.ok({
        world: ctx.world,
        output: CommandOutput.messages(
          ...Object.values(LogNames).map((name) =>
            OutputMessage.plain(
              `projects/${ctx.project.projectId}/logs/${encodeURIComponent(name)}`,
            ),
          ),
        ),
      }),
  }),
  projectCommand({
    path: ["gcloud", "logging", "sinks", "create"],
    summary: "Create a log sink.",
    positionals: [
      Positional.required("SINK_NAME", "The name of the sink to create."),
      Positional.required(
        "DESTINATION",
        "The destination, e.g. storage.googleapis.com/BUCKET or bigquery.googleapis.com/projects/P/datasets/D.",
      ),
    ],
    flags: [
      Flag.string(
        "log-filter",
        "A filter expression that restricts the entries exported by the sink.",
      ),
    ],
    permission: "logging.sinks.create",
    requiredApis: [LoggingApi],
    run: createSink,
  }),
  projectCommand({
    path: ["gcloud", "logging", "sinks", "list"],
    summary: "List the defined sinks.",
    permission: "logging.sinks.list",
    requiredApis: [LoggingApi],
    run: (ctx) =>
      Result.ok({
        world: ctx.world,
        output: CommandOutput.table(
          World.namedOf(ctx.world, "logSinks", ctx.project.projectId).map(LogSink.toRecord),
          SinkColumns,
        ),
      }),
  }),
  describeNamedCommand({
    path: ["gcloud", "logging", "sinks", "describe"],
    summary: "Display information about a sink.",
    positional: Positional.required("SINK_NAME", "The name of the sink.", Candidates.logSinks),
    collection: "logSinks",
    permission: "logging.sinks.get",
    requiredApis: [LoggingApi],
    resourcePath: (projectId, name) => `projects/${projectId}/sinks/${name}`,
    record: LogSink.toRecord,
  }),
];

export const MonitoringCommands: readonly CommandSpec[] = [
  projectCommand({
    path: ["gcloud", "monitoring", "dashboards", "list"],
    summary: "List Monitoring dashboards (gcloud-sim has no dashboards, so the list is empty).",
    permission: "monitoring.dashboards.list",
    requiredApis: [MonitoringApi],
    run: (ctx) =>
      Result.ok({
        world: ctx.world,
        output: CommandOutput.messages(OutputMessage.plain("Listed 0 items.")),
      }),
  }),
  projectCommand({
    path: ["gcloud", "monitoring", "policies", "list"],
    summary: "List alert policies (gcloud-sim has no alert policies, so the list is empty).",
    permission: "monitoring.alertPolicies.list",
    requiredApis: [MonitoringApi],
    run: (ctx) =>
      Result.ok({
        world: ctx.world,
        output: CommandOutput.messages(OutputMessage.plain("Listed 0 items.")),
      }),
  }),
];
