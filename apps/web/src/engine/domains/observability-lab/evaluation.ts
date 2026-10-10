import type {
  AlertCondition,
  AlertConfiguration,
  AlertEvaluation,
  ConditionResult,
  MetricPoint,
  ServiceObjective,
} from "@/engine/domains/observability-lab/model";
import { observedProjects } from "@/engine/domains/observability-lab/model";
import type { World } from "@/engine/domains/world";

const period = 60;
const breached = (condition: AlertCondition, point: MetricPoint): boolean => {
  if (condition.comparison === "COMPARISON_GT") {
    return point.value > condition.threshold;
  }
  return point.value < condition.threshold;
};

/** The lesson uses explicit 60-second GAUGE points; no interpolation or real scheduling. */
const evaluateSeries = (
  condition: AlertCondition,
  points: readonly MetricPoint[],
  now: number,
  previous?: ConditionResult,
): Readonly<{ active: boolean; evaluated: boolean }> => {
  const latest = points.at(-1);
  if (!latest) {
    return { active: false, evaluated: false };
  }
  if (condition.kind === "absence") {
    return { active: now - latest.time >= condition.duration, evaluated: true };
  }
  if (now - latest.time > period) {
    if (condition.missing === "NO_OP") {
      return { active: previous?.active ?? false, evaluated: false };
    }
    const missingFor = now - latest.time - period;
    return {
      active: condition.missing === "ACTIVE" && missingFor >= condition.duration,
      evaluated: true,
    };
  }
  if (!breached(condition, latest)) {
    return { active: false, evaluated: true };
  }

  let since = latest.time;
  for (let index = points.length - 2; index >= 0; index -= 1) {
    const point = points[index];
    if (!point || since - point.time > period || !breached(condition, point)) {
      break;
    }
    since = point.time;
  }
  return { active: latest.time - since >= condition.duration, evaluated: true };
};

export const evaluateAlert = (world: World, configuration: AlertConfiguration): AlertEvaluation => {
  const lab = world.observabilityLab;
  const policy = world.alertPolicies.find(
    (p) => p.projectId === configuration.projectId && p.name === configuration.name,
  );
  const previous = lab.evaluations.find(
    (e) => e.projectId === configuration.projectId && e.name === configuration.name,
  );
  const projects = observedProjects(world, configuration.projectId);
  const results = configuration.conditions.flatMap((condition, index) => {
    const matching = lab.points.filter(
      (p) =>
        projects.includes(p.projectId) &&
        p.metric === condition.metric &&
        p.resourceType === condition.resourceType,
    );
    const key = (p: MetricPoint): string => `${p.projectId}/${p.resourceType}/${p.resource}`;
    return [...new Set(matching.map(key))].map((resource): ConditionResult => {
      const points = matching
        .filter((p) => key(p) === resource)
        .toSorted((a, b) => a.time - b.time);
      const last = previous?.results.find((r) => r.condition === index && r.resource === resource);
      return { condition: index, resource, ...evaluateSeries(condition, points, lab.clock, last) };
    });
  });
  const activeFor = (index: number, resource?: string): boolean =>
    results.some(
      (r) =>
        r.condition === index && r.active && (resource === undefined || r.resource === resource),
    );
  const indices = configuration.conditions.map((_, index) => index);
  let active = indices.some((index) => activeFor(index));
  if (configuration.combiner === "AND") {
    active = indices.every((index) => activeFor(index));
  }
  if (configuration.combiner === "AND_WITH_MATCHING_RESOURCE") {
    active = [...new Set(results.map((r) => r.resource))].some((resource) =>
      indices.every((index) => activeFor(index, resource)),
    );
  }
  active = active && policy?.enabled === true;
  const notifications = active
    ? configuration.channels.filter((name) =>
        lab.channels.some(
          (c) =>
            c.projectId === configuration.projectId && c.name === name && c.enabled && c.verified,
        ),
      )
    : [];
  return {
    projectId: configuration.projectId,
    name: configuration.name,
    time: lab.clock,
    active,
    results,
    notifications,
  };
};

export const objectiveResult = (objective: ServiceObjective, now: number) => {
  const intervals = objective.requests.filter(
    (r) => r.time > now - objective.rollingSeconds && r.time <= now,
  );
  let measured = intervals;
  if (objective.model === "windows") {
    measured = intervals
      .filter((r) => r.total > 0)
      .map((r) => ({ ...r, good: Number(r.good === r.total), total: 1 }));
  }
  const total = measured.reduce((sum, r) => sum + r.total, 0);
  const good = measured.reduce((sum, r) => sum + r.good, 0);
  if (total === 0) {
    return {
      status: "UNKNOWN",
      sli: null,
      total: 0,
      good: 0,
      bad: 0,
      remainingBudget: null,
      burnRate: null,
    };
  }

  const bad = total - good;
  const allowed = (1 - objective.goal) * total;
  return {
    status: good / total >= objective.goal ? "IN_SLO" : "OUT_OF_SLO",
    sli: good / total,
    total,
    good,
    bad,
    remainingBudget: allowed - bad,
    burnRate: bad / total / (1 - objective.goal),
  };
};
