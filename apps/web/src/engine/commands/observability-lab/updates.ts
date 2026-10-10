import { CommandFailure } from "@/engine/cli/command-failure";
import { Flag, ParsedArgs } from "@/engine/cli/command-spec";
import { dashboardConfig } from "@/engine/commands/monitoring";
import { Dashboard, dashboardEtag, UptimeCheck } from "@/engine/domains/monitoring";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";
import {
  command,
  exactKeys,
  finish,
  invalid,
  isRecord,
  missing,
  name,
  readJson,
  sf,
  text,
} from "./shared";

export const ObserveUpdateCommands = [
  command({
    path: ["gcloud", "monitoring", "dashboards", "update"],
    permissions: ["monitoring.dashboards.update"],
    named: true,
    flags: [sf("config"), sf("config-from-file")],
    run: (ctx, args) => {
      const prefix = `projects/${ctx.project.projectId}/dashboards/`;
      const id = name(args).startsWith(prefix) ? name(args).slice(prefix.length) : name(args);
      const dashboard = ctx.world.dashboards.find(
        (d) => d.projectId === ctx.project.projectId && d.name === id,
      );
      if (!dashboard) {
        return missing("Dashboard not found in this project.");
      }
      const inline = ParsedArgs.string(args, "config");
      const file = ParsedArgs.string(args, "config-from-file");
      if (inline.some === file.some) {
        return invalid("Specify exactly one of --config or --config-from-file.");
      }
      let input: unknown;
      if (inline.some) {
        try {
          input = JSON.parse(inline.value);
        } catch {
          return invalid("Expected supported JSON.");
        }
      }
      if (file.some) {
        const parsed = readJson(ctx, file.value);
        if (!Result.isOk(parsed)) {
          return parsed;
        }
        input = parsed.value;
      }
      if (
        !isRecord(input) ||
        !exactKeys(input, ["name", "etag", "displayName", "gridLayout"]) ||
        input.etag !== dashboardEtag(dashboard) ||
        (input.name !== undefined && input.name !== `${prefix}${id}`)
      ) {
        return invalid(
          "Use the latest describe etag and the dashboard's own name; only a supported grid chart is accepted.",
        );
      }
      const config = Result.mapErr(
        dashboardConfig({ displayName: input.displayName, gridLayout: input.gridLayout }, "config"),
        CommandFailure.invalidArgumentWith,
      );
      if (!Result.isOk(config)) {
        return config;
      }
      const widget = config.value.gridLayout.widgets[0];
      const decoded = Result.mapErr(
        Dashboard.decode(
          {
            ...dashboard,
            displayName: config.value.displayName,
            title: widget?.title,
            filter: widget?.xyChart.dataSets[0]?.timeSeriesQuery.timeSeriesFilter.filter,
          },
          "dashboard",
        ),
        CommandFailure.invalidArgumentWith,
      );
      if (!Result.isOk(decoded)) {
        return decoded;
      }
      const world = {
        ...ctx.world,
        dashboards: ctx.world.dashboards.map((d) => (d === dashboard ? decoded.value : d)),
      };
      return finish(world, Dashboard.toRecord(decoded.value));
    },
  }),
  command({
    path: ["gcloud", "monitoring", "uptime", "update"],
    permissions: ["monitoring.uptimeCheckConfigs.update"],
    named: true,
    flags: [
      sf("display-name"),
      Flag.enum("period", "Minutes.", ["1", "5", "10", "15"]),
      Flag.integer("timeout", "Seconds, 1 to 60."),
      sf("path"),
      Flag.integer("port", "HTTP port."),
    ],
    run: (ctx, args) => {
      const prefix = `projects/${ctx.project.projectId}/uptimeCheckConfigs/`;
      const id = name(args).startsWith(prefix) ? name(args).slice(prefix.length) : name(args);
      const previous = ctx.world.uptimeChecks.find(
        (c) => c.projectId === ctx.project.projectId && c.name === id,
      );
      if (!previous) {
        return missing("Uptime check not found in this project.");
      }
      if (
        !["display-name", "period", "timeout", "path", "port"].some((flag) =>
          ParsedArgs.has(args, flag),
        )
      ) {
        return invalid("Specify an uptime update field.");
      }
      const period = ParsedArgs.string(args, "period");
      const timeout = ParsedArgs.integer(args, "timeout");
      const decoded = Result.mapErr(
        UptimeCheck.decode(
          {
            ...previous,
            displayName: text(args, "display-name", previous.displayName),
            path: text(args, "path", previous.path),
            port: Option.unwrapOr(ParsedArgs.integer(args, "port"), previous.port),
            period: period.some ? `${Number(period.value) * 60}s` : previous.period,
            timeout: timeout.some ? `${timeout.value}s` : previous.timeout,
          },
          "uptime",
        ),
        CommandFailure.invalidArgumentWith,
      );
      if (!Result.isOk(decoded)) {
        return decoded;
      }
      return finish(
        {
          ...ctx.world,
          uptimeChecks: ctx.world.uptimeChecks.map((c) => (c === previous ? decoded.value : c)),
        },
        UptimeCheck.toRecord(decoded.value),
      );
    },
  }),
];
