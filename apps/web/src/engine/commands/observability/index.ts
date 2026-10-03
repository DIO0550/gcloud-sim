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
import type { FilterExpr } from "@/engine/cli/formatter";
import { LogFilter } from "@/engine/commands/observability/filter";
import { alreadyExists, describeNamedCommand, projectCommand } from "@/engine/commands/shared";
import { Freshness, LogEntry, LogNames, LogSink } from "@/engine/domains/observability";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const LoggingApi = "logging.googleapis.com" as const;

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
  const rawFilter = Option.unwrapOr(ParsedArgs.positional(args, 0), "");
  const filter: Result<Option<FilterExpr>, CommandFailure> = rawFilter.trim() === ""
    ? Result.ok(Option.none)
    : Result.map(LogFilter.parse(rawFilter), Option.some);
  if (!Result.isOk(filter)) return filter;
  const entries = World.operationsOf(ctx.world, ctx.project.projectId)
    .map(LogEntry.fromOperation)
    .filter((e) => Date.parse(e.timestamp) >= since)
    .map(LogEntry.toRecord)
    .filter(
      (entry) => !Option.isSome(filter.value) || LogFilter.matches(filter.value.value, entry),
    );
  const ordered =
    Option.unwrapOr(ParsedArgs.string(args, "order"), "desc") === "asc"
      ? entries
      : entries.toReversed();
  return Result.ok({
    world: ctx.world,
    output: CommandOutput.yamlList(ordered),
  });
};

const createSink = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const filter = Option.unwrapOr(ParsedArgs.string(args, "log-filter"), "");
  if (filter.trim() !== "") {
    const checked = LogFilter.parse(filter);
    if (!Result.isOk(checked)) return checked;
  }
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

const sinkMutations: readonly CommandSpec[] = (["update", "delete"] as const).map((action) =>
  projectCommand({
    path: ["gcloud", "logging", "sinks", action],
    summary: `${action} a log sink.`,
    positionals: [
      Positional.required("SINK_NAME", "Sink name."),
      ...(action === "update" ? [Positional.optional("DESTINATION", "New sink destination.")] : []),
    ],
    flags: action === "update" ? [Flag.string("log-filter", "New log filter.")] : [],
    permission: `logging.sinks.${action}`,
    requiredApis: [LoggingApi],
    destructive: action === "delete",
    run: (ctx, args) => {
      const name = ParsedArgs.requiredPositional(args, 0);
      const existing = World.findNamed(ctx.world, "logSinks", {
        projectId: ctx.project.projectId,
        name,
      });
      if (!Option.isSome(existing)) return Result.err(CommandFailure.notFound(name));
      if (action === "delete")
        return Result.ok({
          world: World.withoutNamed(ctx.world, "logSinks", existing.value),
          output: CommandOutput.messages(OutputMessage.plain(`Deleted [${name}].`)),
        });
      const filter = Option.unwrapOr(ParsedArgs.string(args, "log-filter"), existing.value.filter);
      if (filter.trim() !== "") {
        const checked = LogFilter.parse(filter);
        if (!Result.isOk(checked)) return checked;
      }
      const updated = Result.mapErr(
        LogSink.create(
          {
            ...existing.value,
            destination: Option.unwrapOr(
              ParsedArgs.positional(args, 1),
              existing.value.destination,
            ),
            filter,
          },
          ctx.world.sequence,
        ),
        (message) => CommandFailure.invalidValue("SINK", message),
      );
      if (!Result.isOk(updated)) return updated;
      const sink = { ...updated.value, writerIdentity: existing.value.writerIdentity };
      return Result.ok({
        world: World.replaceNamed(ctx.world, "logSinks", sink),
        output: CommandOutput.yaml(LogSink.toRecord(sink)),
      });
    },
  }),
);

export const LoggingCommands: readonly CommandSpec[] = [
  ...sinkMutations,
  projectCommand({
    path: ["gcloud", "logging", "read"],
    summary: "Read log entries (audit logs derived from the operation history).",
    positionals: [
      Positional.optional(
        "LOG_FILTER",
        "Filter expression: comparisons, AND/OR/NOT, and parentheses. Unsupported syntax is rejected.",
      ),
    ],
    flags: [
      Flag.string(
        "freshness",
        "Return entries that are not older than this value, e.g. 1d, 12h (default 1d).",
      ),
      Flag.enum("order", "Ordering of returned log entries.", ["asc", "desc"]),
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
    positional: { name: "SINK_NAME", description: "The name of the sink." },
    collection: "logSinks",
    permission: "logging.sinks.get",
    requiredApis: [LoggingApi],
    resourcePath: (ref) => `projects/${ref.projectId}/sinks/${ref.name}`,
    record: LogSink.toRecord,
  }),
];
