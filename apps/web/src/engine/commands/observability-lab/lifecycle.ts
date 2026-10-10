import { CommandOutput, Flag, ParsedArgs } from "@/engine/cli/command-spec";
import { objectiveResult } from "@/engine/domains/observability-lab/evaluation";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";
import { command, finish, invalid, missing, name, same, save, sf, text } from "./shared";

export const ObserveLifecycleCommands = [
  ...(["list", "describe", "delete"] as const).map((action) =>
    command({
      path: ["sim", "monitoring", "metric-descriptors", action],
      permissions: [`monitoring.metricDescriptors.${action === "describe" ? "get" : action}`],
      named: action !== "list",
      destructive: action === "delete",
      run: (ctx, args) => {
        const values = ctx.world.observabilityLab.descriptors.filter(
          (d) => d.projectId === ctx.project.projectId,
        );
        if (action === "list") {
          return Result.ok({
            world: ctx.world,
            output: CommandOutput.yamlList(values.map((d) => ({ ...d }))),
          });
        }
        const item = values.find((d) => d.name === name(args));
        if (!item) {
          return missing("Metric descriptor not found in this project.");
        }
        if (action === "describe") {
          return finish(ctx.world, { ...item, metricKind: "GAUGE", valueType: "DOUBLE" });
        }
        if (
          ctx.world.observabilityLab.policies.some(
            (p) =>
              (p.projectId === item.projectId ||
                ctx.world.observabilityLab.scopes.some(
                  (scope) => scope.projectId === p.projectId && scope.name === item.projectId,
                )) &&
              p.conditions.some((c) => c.metric === item.type),
          )
        ) {
          return invalid(
            "Remove alert policies referencing this metric before deleting its descriptor.",
          );
        }
        return save(
          ctx.world,
          {
            descriptors: ctx.world.observabilityLab.descriptors.filter((d) => d !== item),
            points: ctx.world.observabilityLab.points.filter(
              (p) => p.projectId !== item.projectId || p.metric !== item.type,
            ),
          },
          { deleted: item.name, samplesDeleted: true },
        );
      },
    }),
  ),
  command({
    path: ["gcloud", "monitoring", "metrics-scopes", "delete"],
    permissions: ["monitoring.metricsScopes.link"],
    named: true,
    destructive: true,
    run: (ctx, args) => {
      const item = ctx.world.observabilityLab.scopes.find(
        (s) => s.projectId === ctx.project.projectId && `projects/${s.name}` === name(args),
      );
      if (!item) {
        return missing("Monitored project not found in this scope.");
      }
      return save(
        ctx.world,
        {
          scopes: ctx.world.observabilityLab.scopes.filter((s) => s !== item),
          evaluations: ctx.world.observabilityLab.evaluations.filter(
            (e) => e.projectId !== ctx.project.projectId,
          ),
        },
        { unlinked: item.name, sourceDataDeleted: false },
      );
    },
  }),
  ...(["list", "update", "delete"] as const).map((action) =>
    command({
      path: ["sim", "monitoring", "slos", action],
      permissions: [`monitoring.slos.${action}`],
      named: action !== "list",
      destructive: action === "delete",
      flags:
        action === "update"
          ? [sf("goal"), Flag.integer("rolling-days", "Window from one to 30 days.")]
          : [],
      run: (ctx, args) => {
        const objectives = ctx.world.observabilityLab.objectives.filter(
          (s) => s.projectId === ctx.project.projectId,
        );
        if (action === "list") {
          return Result.ok({
            world: ctx.world,
            output: CommandOutput.yamlList(
              objectives.map((s) => ({
                name: s.name,
                goal: s.goal,
                model: s.model,
                ...objectiveResult(s, ctx.world.observabilityLab.clock),
              })),
            ),
          });
        }
        const previous = objectives.find((s) => s.name === name(args));
        if (!previous) {
          return missing("SLO not found in this project.");
        }
        if (action === "delete") {
          return save(
            ctx.world,
            { objectives: ctx.world.observabilityLab.objectives.filter((s) => s !== previous) },
            { deleted: previous.name },
          );
        }
        if (!ParsedArgs.has(args, "goal") && !ParsedArgs.has(args, "rolling-days")) {
          return invalid("Specify --goal or --rolling-days.");
        }
        const raw = text(args, "goal", String(previous.goal));
        if (!/^\d+(?:\.\d+)?$/.test(raw)) {
          return invalid("Use a finite fractional SLO goal.");
        }
        const item = {
          ...previous,
          goal: Number(raw),
          rollingSeconds:
            Option.unwrapOr(
              ParsedArgs.integer(args, "rolling-days"),
              previous.rollingSeconds / 86400,
            ) * 86400,
        };
        return save(
          ctx.world,
          {
            objectives: ctx.world.observabilityLab.objectives.map((s) =>
              same(s, item) ? item : s,
            ),
          },
          {
            name: item.name,
            goal: item.goal,
            model: item.model,
            ...objectiveResult(item, ctx.world.observabilityLab.clock),
          },
        );
      },
    }),
  ),
];
