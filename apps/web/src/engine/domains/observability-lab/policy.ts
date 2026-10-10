import type { AlertPolicy } from "@/engine/domains/monitoring";
import { Result } from "@/utils/Result";
import { type AlertCondition, type AlertConfiguration, ObserveCpuMetric } from "./model";

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
const duration = (value: unknown): number | undefined => {
  if (typeof value !== "string" || !/^\d+s$/.test(value)) {
    return undefined;
  }
  return Number(value.slice(0, -1));
};
export const metricFilter = (
  value: unknown,
): Readonly<{ metric: string; resourceType: string }> | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const match =
    /^metric\.type="([^"]+)"\s+AND\s+resource\.type="(gce_instance|generic_task)"$/.exec(value);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }
  return { metric: match[1], resourceType: match[2] };
};
const parseCondition = (value: unknown, name: string): Result<AlertCondition, string> => {
  if (
    !record(value) ||
    !exact(value, [
      "name",
      "displayName",
      "conditionThreshold",
      "conditionAbsent",
      "conditionPrometheusQueryLanguage",
    ]) ||
    typeof value.displayName !== "string" ||
    !value.displayName.trim()
  ) {
    return Result.err("Each condition needs a displayName and one supported condition object.");
  }
  const kinds = [
    "conditionThreshold",
    "conditionAbsent",
    "conditionPrometheusQueryLanguage",
  ].filter((key) => Object.hasOwn(value, key));
  const kind = kinds[0];
  if (kinds.length !== 1 || !kind || !record(value[kind])) {
    return Result.err("Use exactly one condition type.");
  }
  const body = value[kind];
  const seconds = duration(body.duration);
  let filter = metricFilter(body.filter);
  let comparison: AlertCondition["comparison"] = "COMPARISON_GT";
  let threshold = 0;
  let missing: AlertCondition["missing"] = "INACTIVE";
  let evaluationInterval = 60;
  if (kind === "conditionThreshold") {
    if (
      !exact(body, [
        "filter",
        "comparison",
        "thresholdValue",
        "duration",
        "evaluationMissingData",
      ]) ||
      !["COMPARISON_GT", "COMPARISON_LT"].includes(String(body.comparison)) ||
      typeof body.thresholdValue !== "number" ||
      !Number.isFinite(body.thresholdValue)
    ) {
      return Result.err(
        "Threshold supports filter, GT/LT comparison, finite thresholdValue, duration and evaluationMissingData only.",
      );
    }
    comparison = body.comparison as AlertCondition["comparison"];
    threshold = body.thresholdValue;
    const mode = String(body.evaluationMissingData ?? "EVALUATION_MISSING_DATA_INACTIVE");
    if (
      ![
        "EVALUATION_MISSING_DATA_INACTIVE",
        "EVALUATION_MISSING_DATA_ACTIVE",
        "EVALUATION_MISSING_DATA_NO_OP",
      ].includes(mode)
    ) {
      return Result.err("Unsupported missing-data mode.");
    }
    missing = mode.replace("EVALUATION_MISSING_DATA_", "") as AlertCondition["missing"];
  }
  if (kind === "conditionAbsent" && !exact(body, ["filter", "duration"])) {
    return Result.err("Absence supports filter and duration only.");
  }
  if (kind === "conditionPrometheusQueryLanguage") {
    if (
      !exact(body, ["query", "duration", "evaluationInterval"]) ||
      typeof body.query !== "string"
    ) {
      return Result.err("PromQL supports query, duration and evaluationInterval only.");
    }
    const match =
      /^(compute_googleapis_com:instance_cpu_utilization|custom_googleapis_com:ace_[a-z][a-z0-9_]*)\{monitored_resource="(gce_instance|generic_task)"\}\s*([<>])\s*(-?\d+(?:\.\d+)?)$/.exec(
        body.query,
      );
    if (!match?.[1] || !match[2]) {
      return Result.err(
        "Lesson PromQL accepts a single CPU/custom metric selector and > or < number; functions, grouping and arbitrary expressions are unsupported.",
      );
    }
    const metric =
      match[1] === "compute_googleapis_com:instance_cpu_utilization"
        ? ObserveCpuMetric
        : `custom.googleapis.com/ace/${match[1].slice("custom_googleapis_com:ace_".length)}`;
    filter = { metric, resourceType: match[2] };
    comparison = match[3] === ">" ? "COMPARISON_GT" : "COMPARISON_LT";
    threshold = Number(match[4]);
    evaluationInterval = duration(body.evaluationInterval ?? "30s") ?? 0;
  }
  if (!filter || seconds === undefined) {
    return Result.err(
      'Use metric.type="TYPE" AND resource.type="TYPE", and a duration in seconds.',
    );
  }
  let conditionKind: AlertCondition["kind"] = "threshold";
  if (kind === "conditionAbsent") {
    conditionKind = "absence";
  }
  if (kind === "conditionPrometheusQueryLanguage") {
    conditionKind = "promql";
  }
  return Result.ok({
    name,
    displayName: value.displayName,
    kind: conditionKind,
    ...filter,
    comparison,
    threshold,
    duration: seconds,
    missing,
    evaluationInterval,
  });
};

export const policyFromJson = (
  input: unknown,
  projectId: string,
  id: string,
  sequence: number,
  previous?: AlertConfiguration,
): Result<Readonly<{ policy: AlertPolicy; configuration: AlertConfiguration }>, string> => {
  if (
    !record(input) ||
    !exact(input, [
      "name",
      "displayName",
      "enabled",
      "combiner",
      "conditions",
      "notificationChannels",
    ]) ||
    typeof input.displayName !== "string" ||
    !input.displayName.trim() ||
    !Array.isArray(input.conditions) ||
    !["OR", "AND", "AND_WITH_MATCHING_RESOURCE"].includes(String(input.combiner))
  ) {
    return Result.err(
      "Policy JSON requires displayName, combiner, conditions; unsupported fields are rejected.",
    );
  }
  const prefix = `projects/${projectId}/alertPolicies/${id}`;
  if (input.name !== undefined && input.name !== prefix) {
    return Result.err("Policy name does not match the selected project/ID.");
  }
  if (input.enabled !== undefined && typeof input.enabled !== "boolean") {
    return Result.err("enabled must be boolean.");
  }
  const channels = input.notificationChannels ?? [];
  if (
    !Array.isArray(channels) ||
    channels.some(
      (c) =>
        typeof c !== "string" ||
        !c.startsWith(`projects/${projectId}/notificationChannels/`) ||
        c.slice(`projects/${projectId}/notificationChannels/`.length).includes("/"),
    )
  ) {
    return Result.err(
      "notificationChannels must contain full channel names in the policy project.",
    );
  }
  const conditions = Result.all(
    input.conditions.map((value, index) => {
      let name = `condition-${sequence}-${index + 1}`;
      if (record(value) && value.name !== undefined) {
        const found = previous?.conditions.find(
          (c) => `${prefix}/conditions/${c.name}` === value.name,
        );
        if (!found) {
          return Result.err("Condition names must refer to an existing condition in this policy.");
        }
        name = found.name;
      }
      return parseCondition(value, name);
    }),
  );
  return Result.flatMap(conditions, (values) => {
    const first = values[0];
    if (!first) {
      return Result.err("At least one condition is required.");
    }
    return Result.ok({
      policy: {
        projectId,
        name: id,
        displayName: input.displayName as string,
        enabled: input.enabled !== false,
        conditionName: first.displayName,
        filter: `metric.type="${first.metric}" AND resource.type="${first.resourceType}"`,
        comparison: first.comparison,
        threshold: first.threshold,
        duration: `${first.duration}s`,
      },
      configuration: {
        projectId,
        name: id,
        combiner: input.combiner as AlertConfiguration["combiner"],
        conditions: values,
        channels: channels.map((c: string) =>
          c.slice(`projects/${projectId}/notificationChannels/`.length),
        ),
      },
    });
  });
};

export const conditionRecord = (condition: AlertCondition, prefix: string) => {
  const common = {
    name: `${prefix}/conditions/${condition.name}`,
    displayName: condition.displayName,
  };
  const filter = `metric.type="${condition.metric}" AND resource.type="${condition.resourceType}"`;
  if (condition.kind === "absence") {
    return { ...common, conditionAbsent: { filter, duration: `${condition.duration}s` } };
  }
  if (condition.kind === "promql") {
    const metric =
      condition.metric === ObserveCpuMetric
        ? "compute_googleapis_com:instance_cpu_utilization"
        : `custom_googleapis_com:ace_${condition.metric.slice("custom.googleapis.com/ace/".length)}`;
    return {
      ...common,
      conditionPrometheusQueryLanguage: {
        query: `${metric}{monitored_resource="${condition.resourceType}"} ${condition.comparison === "COMPARISON_GT" ? ">" : "<"} ${condition.threshold}`,
        duration: `${condition.duration}s`,
        evaluationInterval: `${condition.evaluationInterval}s`,
      },
    };
  }
  return {
    ...common,
    conditionThreshold: {
      filter,
      comparison: condition.comparison,
      thresholdValue: condition.threshold,
      duration: `${condition.duration}s`,
      evaluationMissingData: `EVALUATION_MISSING_DATA_${condition.missing}`,
    },
  };
};
