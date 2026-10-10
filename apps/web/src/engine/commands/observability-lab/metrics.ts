import { CommandOutput, Flag, ParsedArgs } from "@/engine/cli/command-spec";
import { EffectivePermissions } from "@/engine/domains/effective-permissions";
import { evaluateAlert, objectiveResult } from "@/engine/domains/observability-lab/evaluation";
import {
  type MetricDescriptor,
  type MetricPoint,
  metricExists,
  observedProjects,
  type ServiceObjective,
} from "@/engine/domains/observability-lab/model";
import { Principal } from "@/engine/domains/principal";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";
import { command, finish, invalid, missing, name, same, save, sf, text } from "./shared";

const number = (value: string): number | undefined => {
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};
export const ObserveMetricCommands = [
  command({
    path: ["sim", "monitoring", "clock", "advance"],
    permissions: ["monitoring.alertPolicies.update"],
    flags: [
      Flag.integer("seconds", "Advance explicit virtual time; no real wait.", { required: true }),
    ],
    run: (ctx, args) => {
      const seconds = Option.unwrapOr(ParsedArgs.integer(args, "seconds"), 0);
      if (seconds <= 0) {
        return invalid("Advance by a positive number of seconds.");
      }
      const clock = ctx.world.observabilityLab.clock + seconds;
      return save(ctx.world, { clock }, { clock, simulated: true });
    },
  }),
  command({
    path: ["sim", "monitoring", "metric-descriptors", "create"],
    permissions: ["monitoring.metricDescriptors.create"],
    named: true,
    flags: [
      sf("type", true),
      Flag.enum("resource-type", "Bounded monitored resource.", ["generic_task", "gce_instance"], {
        required: true,
      }),
      Flag.enum("unit", "Bounded unit.", ["1", "%"]),
    ],
    run: (ctx, args) => {
      const item: MetricDescriptor = {
        projectId: ctx.project.projectId,
        name: name(args),
        type: text(args, "type"),
        resourceType: text(args, "resource-type") as MetricDescriptor["resourceType"],
        unit: text(args, "unit", "1") as MetricDescriptor["unit"],
      };
      if (
        ctx.world.observabilityLab.descriptors.some(
          (d) => same(d, item) || (d.projectId === item.projectId && d.type === item.type),
        )
      ) {
        return invalid("Metric descriptor already exists.");
      }
      return save(
        ctx.world,
        { descriptors: [...ctx.world.observabilityLab.descriptors, item] },
        { ...item, metricKind: "GAUGE", valueType: "DOUBLE" },
      );
    },
  }),
  command({
    path: ["sim", "monitoring", "time-series", "write"],
    permissions: ["monitoring.timeSeries.create"],
    flags: [
      sf("metric", true),
      sf("resource", true),
      Flag.enum("resource-type", "Bounded resource.", ["generic_task", "gce_instance"], {
        required: true,
      }),
      sf("value", true),
    ],
    run: (ctx, args) => {
      const value = number(text(args, "value"));
      const projectId = ctx.project.projectId;
      const metric = text(args, "metric");
      const resource = text(args, "resource");
      const resourceType = text(args, "resource-type");
      const descriptor = ctx.world.observabilityLab.descriptors.find(
        (d) => d.projectId === projectId && d.type === metric,
      );
      if (value === undefined || !metricExists(ctx.world, projectId, metric)) {
        return invalid("Use a known metric and finite numeric value.");
      }
      if (descriptor && descriptor.resourceType !== resourceType) {
        return invalid("Metric descriptor resource type does not match this point.");
      }
      if (
        resourceType === "gce_instance" &&
        !ctx.world.instances.some((i) => i.projectId === projectId && i.name === resource)
      ) {
        return missing("The point references a missing VM in this project.");
      }
      if (!/^[a-z][a-z0-9-]{0,62}$/.test(resource)) {
        return invalid("Use a bounded resource name.");
      }
      const time = ctx.world.observabilityLab.clock;
      if (
        ctx.world.observabilityLab.points.some(
          (p) =>
            p.projectId === projectId &&
            p.metric === metric &&
            p.resource === resource &&
            p.resourceType === resourceType &&
            p.time === time,
        )
      ) {
        return invalid(
          "A series accepts one point per virtual timestamp. Advance time before the next point.",
        );
      }
      const numbered = World.nextNumber(ctx.world);
      const point: MetricPoint = {
        projectId,
        name: `point-${numbered.number}`,
        metric,
        resource,
        resourceType,
        value,
        time,
      };
      return save(
        numbered.world,
        { points: [...ctx.world.observabilityLab.points, point] },
        { ...point, simulated: true },
      );
    },
  }),
  command({
    path: ["sim", "monitoring", "time-series", "list"],
    permissions: ["monitoring.timeSeries.list"],
    flags: [sf("metric")],
    run: (ctx, args) => {
      const projects = observedProjects(ctx.world, ctx.project.projectId);
      const values = ctx.world.observabilityLab.points.filter(
        (p) =>
          projects.includes(p.projectId) &&
          (text(args, "metric") === "" || p.metric === text(args, "metric")),
      );
      return Result.ok({
        world: ctx.world,
        output: CommandOutput.yamlList(values.map((p) => ({ ...p }))),
      });
    },
  }),
  command({
    path: ["gcloud", "monitoring", "metrics-scopes", "create"],
    permissions: ["monitoring.metricsScopes.link"],
    named: true,
    run: (ctx, args) => {
      const raw = name(args);
      if (!/^projects\/[a-z][a-z0-9-]+$/.test(raw)) {
        return invalid("Use projects/MONITORED_PROJECT and --project=SCOPING_PROJECT (beta CLI).");
      }
      const monitored = raw.slice("projects/".length);
      if (
        !World.findActiveProject(ctx.world, monitored).some ||
        !World.hasApi(ctx.world, monitored, "monitoring.googleapis.com")
      ) {
        return missing("Monitored project must be active and have the Monitoring API enabled.");
      }
      const allowed = EffectivePermissions.resolve(ctx.world, Principal.toMember(ctx.principal), {
        type: "project",
        id: monitored,
      }).permissions;
      if (!allowed.has("monitoring.metricsScopes.link")) {
        return invalid("Monitoring Admin access is required on both projects.");
      }
      const item = { projectId: ctx.project.projectId, name: monitored };
      if (ctx.world.observabilityLab.scopes.some((s) => same(s, item))) {
        return invalid("Project is already monitored by this scope.");
      }
      return save(
        ctx.world,
        { scopes: [...ctx.world.observabilityLab.scopes, item] },
        {
          name: `locations/global/metricsScopes/${item.projectId}/projects/${monitored}`,
          dataCopied: false,
        },
      );
    },
  }),
  command({
    path: ["gcloud", "monitoring", "metrics-scopes", "describe"],
    permissions: ["resourcemanager.projects.get"],
    named: true,
    run: (ctx, args) => {
      const full = `locations/global/metricsScopes/${ctx.project.projectId}`;
      if (name(args) !== full) {
        return invalid("Metrics scopes use locations/global and the selected scoping project.");
      }
      return finish(ctx.world, {
        name: full,
        monitoredProjects: observedProjects(ctx.world, ctx.project.projectId),
        dataCopied: false,
      });
    },
  }),
  command({
    path: ["gcloud", "monitoring", "metrics-scopes", "list"],
    permissions: ["resourcemanager.projects.get"],
    named: true,
    run: (ctx, args) => {
      const projectId = name(args).replace(/^projects\//, "");
      if (
        name(args) !== `projects/${projectId}` ||
        !World.findActiveProject(ctx.world, projectId).some
      ) {
        return missing("Use an existing projects/MONITORED_PROJECT.");
      }
      const scopes = [
        projectId,
        ...ctx.world.observabilityLab.scopes
          .filter((s) => s.name === projectId)
          .map((s) => s.projectId),
      ];
      return finish(ctx.world, {
        metricsScopes: scopes.map((s) => `locations/global/metricsScopes/${s}`),
      });
    },
  }),
  command({
    path: ["sim", "monitoring", "policies", "evaluate"],
    permissions: ["monitoring.alertPolicies.get", "monitoring.timeSeries.list"],
    named: true,
    run: (ctx, args) => {
      const matching = ctx.world.alertPolicies.filter(
        (p) =>
          p.projectId === ctx.project.projectId &&
          (p.name === name(args) || p.displayName === name(args)),
      );
      const selected = matching.length === 1 ? matching[0] : undefined;
      const configuration = ctx.world.observabilityLab.policies.find(
        (p) => p.projectId === ctx.project.projectId && p.name === selected?.name,
      );
      if (!configuration) {
        return missing("Configure a bounded multi-condition policy first.");
      }
      const evaluation = evaluateAlert(ctx.world, configuration);
      return save(
        ctx.world,
        {
          evaluations: [
            ...ctx.world.observabilityLab.evaluations.filter((e) => !same(e, evaluation)),
            evaluation,
          ],
        },
        {
          ...evaluation,
          results: evaluation.results.map((r) => ({ ...r })),
          simulatedNotifications: [...evaluation.notifications],
          notifications: [],
        },
      );
    },
  }),
  command({
    path: ["sim", "monitoring", "slos", "create"],
    permissions: ["monitoring.slos.create"],
    named: true,
    flags: [
      sf("goal", true),
      Flag.integer("rolling-days", "Whole days from one to 30.", { required: true }),
      Flag.enum("model", "Requests or equally weighted windows.", ["request", "windows"]),
    ],
    run: (ctx, args) => {
      const goal = number(text(args, "goal"));
      if (goal === undefined) {
        return invalid("SLO goal must be numeric.");
      }
      const objective: ServiceObjective = {
        projectId: ctx.project.projectId,
        name: name(args),
        goal,
        model: text(args, "model", "request") as ServiceObjective["model"],
        rollingSeconds: Option.unwrapOr(ParsedArgs.integer(args, "rolling-days"), 0) * 86400,
        requests: [],
      };
      if (ctx.world.observabilityLab.objectives.some((s) => same(s, objective))) {
        return invalid("SLO already exists.");
      }
      return save(
        ctx.world,
        { objectives: [...ctx.world.observabilityLab.objectives, objective] },
        { ...objective, requests: [], status: "UNKNOWN", model: objective.model },
      );
    },
  }),
  command({
    path: ["sim", "monitoring", "slos", "record"],
    permissions: ["monitoring.slos.update"],
    named: true,
    flags: [
      Flag.integer("good", "Good requests in this explicit interval.", { required: true }),
      Flag.integer("total", "Total requests in this explicit interval.", { required: true }),
    ],
    run: (ctx, args) => {
      const previous = ctx.world.observabilityLab.objectives.find(
        (s) => s.projectId === ctx.project.projectId && s.name === name(args),
      );
      if (!previous) {
        return missing("SLO not found.");
      }
      const request = {
        time: ctx.world.observabilityLab.clock,
        good: Option.unwrapOr(ParsedArgs.integer(args, "good"), -1),
        total: Option.unwrapOr(ParsedArgs.integer(args, "total"), -1),
      };
      if (previous.requests.some((r) => r.time === request.time)) {
        return invalid("Advance time before recording another request interval.");
      }
      const objective = { ...previous, requests: [...previous.requests, request] };
      return save(
        ctx.world,
        {
          objectives: ctx.world.observabilityLab.objectives.map((s) =>
            s === previous ? objective : s,
          ),
        },
        { ...objectiveResult(objective, request.time), simulated: true },
      );
    },
  }),
  command({
    path: ["sim", "monitoring", "slos", "describe"],
    permissions: ["monitoring.slos.get"],
    named: true,
    run: (ctx, args) => {
      const objective = ctx.world.observabilityLab.objectives.find(
        (s) => s.projectId === ctx.project.projectId && s.name === name(args),
      );
      return objective
        ? finish(ctx.world, {
            name: objective.name,
            goal: objective.goal,
            model: objective.model,
            rollingSeconds: objective.rollingSeconds,
            ...objectiveResult(objective, ctx.world.observabilityLab.clock),
          })
        : missing("SLO not found.");
    },
  }),
];
