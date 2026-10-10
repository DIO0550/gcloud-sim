import { LogFilter } from "@/engine/commands/observability/filter";
import { Region } from "@/engine/domains/catalog";
import { IamMember } from "@/engine/domains/iam-policy";
import { KubeLabels } from "@/engine/domains/kube-labels";
import { World } from "@/engine/domains/world";
import { Decoder as D } from "@/utils/Decoder";
import { Result } from "@/utils/Result";
import { parseViewFilter } from "./view-filter";

export type ObserveRef = Readonly<{ projectId: string; name: string }>;
export type NotificationChannel = ObserveRef &
  Readonly<{
    email: string;
    enabled: boolean;
    verified: boolean;
  }>;
export type MetricDescriptor = ObserveRef &
  Readonly<{
    type: string;
    resourceType: "generic_task" | "gce_instance";
    unit: "1" | "%";
  }>;
export type MetricPoint = ObserveRef &
  Readonly<{
    metric: string;
    resource: string;
    resourceType: string;
    value: number;
    time: number;
  }>;
export type MetricScope = ObserveRef;
export type Collector = ObserveRef &
  Readonly<{
    kind: "ops-agent" | "managed-prometheus";
    resource: string;
    location: string;
    serviceAccount: string;
    enabled: boolean;
    namespace: string;
    selector: Readonly<Record<string, string>>;
    port: number;
  }>;
export type AlertCondition = Readonly<{
  name: string;
  evaluationInterval: number;
  displayName: string;
  kind: "threshold" | "absence" | "promql";
  metric: string;
  resourceType: string;
  comparison: "COMPARISON_GT" | "COMPARISON_LT";
  threshold: number;
  duration: number;
  missing: "INACTIVE" | "ACTIVE" | "NO_OP";
}>;
export type AlertConfiguration = ObserveRef &
  Readonly<{
    combiner: "OR" | "AND" | "AND_WITH_MATCHING_RESOURCE";
    channels: readonly string[];
    conditions: readonly AlertCondition[];
  }>;
export type ConditionResult = Readonly<{
  condition: number;
  resource: string;
  active: boolean;
  evaluated: boolean;
}>;
export type AlertEvaluation = ObserveRef &
  Readonly<{
    time: number;
    active: boolean;
    results: readonly ConditionResult[];
    notifications: readonly string[];
  }>;
export type ServiceObjective = ObserveRef &
  Readonly<{
    goal: number;
    model: "request" | "windows";
    rollingSeconds: number;
    requests: readonly Readonly<{ time: number; good: number; total: number }>[];
  }>;
export type ObserveBucket = ObserveRef &
  Readonly<{
    location: string;
    retentionDays: number;
    locked: boolean;
    analyticsEnabled: boolean;
    deleteRequestedAt: number;
  }>;
export type LogView = ObserveRef &
  Readonly<{
    bucket: string;
    location: string;
    filter: string;
    readers: readonly IamMember[];
  }>;
export type LogExclusion = ObserveRef &
  Readonly<{ sink: string; filter: string; disabled: boolean }>;
export type AuditConfiguration = ObserveRef &
  Readonly<{
    scope: "project" | "folder" | "organization";
    service: string;
    adminRead: boolean;
    dataRead: boolean;
    dataWrite: boolean;
  }>;
export type ObserveLog = ObserveRef &
  Readonly<{
    kind: "ADMIN_ACTIVITY" | "DATA_ACCESS" | "SYSTEM_EVENT" | "POLICY_DENIED" | "FLOW" | "FIREWALL";
    service: string;
    method: string;
    resource: string;
    principal: string;
    severity: "NOTICE" | "ERROR";
    time: number;
    timestamp: string;
    text: string;
  }>;
export type LogDelivery = ObserveRef &
  Readonly<{
    log: string;
    destination: string;
    state: "STORED" | "EXCLUDED" | "DENIED";
  }>;
export type AnalyticsLink = ObserveRef &
  Readonly<{
    bucket: string;
    location: string;
    dataset: string;
  }>;
export type ObservabilityLab = Readonly<{
  clock: number;
  channels: readonly NotificationChannel[];
  descriptors: readonly MetricDescriptor[];
  points: readonly MetricPoint[];
  scopes: readonly MetricScope[];
  collectors: readonly Collector[];
  policies: readonly AlertConfiguration[];
  evaluations: readonly AlertEvaluation[];
  objectives: readonly ServiceObjective[];
  buckets: readonly ObserveBucket[];
  views: readonly LogView[];
  exclusions: readonly LogExclusion[];
  audit: readonly AuditConfiguration[];
  logs: readonly ObserveLog[];
  deliveries: readonly LogDelivery[];
  links: readonly AnalyticsLink[];
}>;
export const emptyObservabilityLab = (): ObservabilityLab => ({
  clock: 0,
  channels: [],
  descriptors: [],
  points: [],
  scopes: [],
  collectors: [],
  policies: [],
  evaluations: [],
  objectives: [],
  buckets: [],
  views: [],
  exclusions: [],
  audit: [],
  logs: [],
  deliveries: [],
  links: [],
});

const ref = { projectId: D.string, name: D.string };
export const alertConditionDecoder = D.object<AlertCondition>({
  name: D.string,
  evaluationInterval: D.number,
  displayName: D.string,
  kind: D.literal(["threshold", "absence", "promql"]),
  metric: D.string,
  resourceType: D.string,
  comparison: D.literal(["COMPARISON_GT", "COMPARISON_LT"]),
  threshold: D.number,
  duration: D.number,
  missing: D.literal(["INACTIVE", "ACTIVE", "NO_OP"]),
});
export const observabilityLabDecoder = D.object<ObservabilityLab>({
  clock: D.number,
  channels: D.array(
    D.object<NotificationChannel>({
      ...ref,
      email: D.string,
      enabled: D.boolean,
      verified: D.boolean,
    }),
  ),
  descriptors: D.array(
    D.object<MetricDescriptor>({
      ...ref,
      type: D.string,
      resourceType: D.literal(["generic_task", "gce_instance"]),
      unit: D.literal(["1", "%"]),
    }),
  ),
  points: D.array(
    D.object<MetricPoint>({
      ...ref,
      metric: D.string,
      resource: D.string,
      resourceType: D.string,
      value: D.number,
      time: D.number,
    }),
  ),
  scopes: D.array(D.object<MetricScope>(ref)),
  collectors: D.array(
    D.object<Collector>({
      ...ref,
      namespace: D.string,
      selector: D.record(D.string),
      port: D.number,
      kind: D.literal(["ops-agent", "managed-prometheus"]),
      resource: D.string,
      location: D.string,
      serviceAccount: D.string,
      enabled: D.boolean,
    }),
  ),
  policies: D.array(
    D.object<AlertConfiguration>({
      ...ref,
      combiner: D.literal(["OR", "AND", "AND_WITH_MATCHING_RESOURCE"]),
      channels: D.array(D.string),
      conditions: D.array(alertConditionDecoder),
    }),
  ),
  evaluations: D.array(
    D.object<AlertEvaluation>({
      ...ref,
      time: D.number,
      active: D.boolean,
      results: D.array(
        D.object<ConditionResult>({
          condition: D.number,
          resource: D.string,
          active: D.boolean,
          evaluated: D.boolean,
        }),
      ),
      notifications: D.array(D.string),
    }),
  ),
  objectives: D.array(
    D.object<ServiceObjective>({
      ...ref,
      goal: D.number,
      model: D.literal(["request", "windows"]),
      rollingSeconds: D.number,
      requests: D.array(D.object({ time: D.number, good: D.number, total: D.number })),
    }),
  ),
  buckets: D.array(
    D.object<ObserveBucket>({
      ...ref,
      location: D.string,
      retentionDays: D.number,
      locked: D.boolean,
      analyticsEnabled: D.boolean,
      deleteRequestedAt: D.number,
    }),
  ),
  views: D.array(
    D.object<LogView>({
      ...ref,
      bucket: D.string,
      location: D.string,
      filter: D.string,
      readers: D.array(D.validated(IamMember.parse)),
    }),
  ),
  exclusions: D.array(
    D.object<LogExclusion>({ ...ref, sink: D.string, filter: D.string, disabled: D.boolean }),
  ),
  audit: D.array(
    D.object<AuditConfiguration>({
      ...ref,
      scope: D.literal(["project", "folder", "organization"]),
      service: D.string,
      adminRead: D.boolean,
      dataRead: D.boolean,
      dataWrite: D.boolean,
    }),
  ),
  logs: D.array(
    D.object<ObserveLog>({
      ...ref,
      kind: D.literal([
        "ADMIN_ACTIVITY",
        "DATA_ACCESS",
        "SYSTEM_EVENT",
        "POLICY_DENIED",
        "FLOW",
        "FIREWALL",
      ]),
      service: D.string,
      method: D.string,
      resource: D.string,
      principal: D.string,
      severity: D.literal(["NOTICE", "ERROR"]),
      time: D.number,
      timestamp: D.string,
      text: D.string,
    }),
  ),
  deliveries: D.array(
    D.object<LogDelivery>({
      ...ref,
      log: D.string,
      destination: D.string,
      state: D.literal(["STORED", "EXCLUDED", "DENIED"]),
    }),
  ),
  links: D.array(
    D.object<AnalyticsLink>({ ...ref, bucket: D.string, location: D.string, dataset: D.string }),
  ),
});

export const ObserveCpuMetric = "compute.googleapis.com/instance/cpu/utilization";
export const observedProjects = (world: World, projectId: string): readonly string[] =>
  [
    projectId,
    ...world.observabilityLab.scopes.filter((s) => s.projectId === projectId).map((s) => s.name),
  ].filter((id) =>
    world.projects.some(
      (p) =>
        p.projectId === id &&
        p.lifecycleState === "ACTIVE" &&
        p.enabledApis.includes("monitoring.googleapis.com"),
    ),
  );
export const metricExists = (world: World, projectId: string, type: string): boolean =>
  type === ObserveCpuMetric ||
  world.observabilityLab.descriptors.some((d) => d.projectId === projectId && d.type === type);

export const validateObservabilityLab = (world: World): Result<World, string> => {
  const lab = world.observabilityLab;
  const invalid = (message: string): Result<World, string> => Result.err(message);
  if (!Number.isInteger(lab.clock) || lab.clock < 0 || lab.clock > 31536000) {
    return invalid("Observation clock must be an integer within one virtual year.");
  }
  for (const [key, collection] of Object.entries(lab)) {
    if (!Array.isArray(collection)) {
      continue;
    }
    const limit = ["points", "logs", "deliveries"].includes(key) ? 1000 : 100;
    if (collection.length > limit) {
      return invalid(`Observation ${key} limit exceeded.`);
    }
    const ids = collection.map(
      (r: ObserveRef & { location?: string; bucket?: string; sink?: string; service?: string }) =>
        `${r.projectId}/${r.location ?? ""}/${r.bucket ?? ""}/${r.sink ?? ""}/${r.service ?? ""}/${r.name}`,
    );
    if (collection.some((r: ObserveRef) => !r.name.trim())) {
      return invalid(`Observation ${key} needs a nonempty identity.`);
    }
    if (new Set(ids).size !== ids.length) {
      return invalid(`Duplicate observation ${key} identity.`);
    }
    if (
      collection.some((r: ObserveRef) => !world.projects.some((p) => p.projectId === r.projectId))
    ) {
      return invalid(`Observation ${key} references a missing project.`);
    }
  }
  for (const channel of lab.channels) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(channel.email)) {
      return invalid("Invalid notification email.");
    }
  }
  for (const descriptor of lab.descriptors) {
    if (!/^custom\.googleapis\.com\/ace\/[a-z][a-z0-9_]{0,62}$/.test(descriptor.type)) {
      return invalid("Only custom.googleapis.com/ace/NAME GAUGE metrics are supported.");
    }
  }
  const descriptorTypes = lab.descriptors.map((d) => `${d.projectId}/${d.type}`);
  if (new Set(descriptorTypes).size !== descriptorTypes.length) {
    return invalid("Duplicate metric descriptor type.");
  }
  for (const point of lab.points) {
    const descriptor = lab.descriptors.find(
      (d) => d.projectId === point.projectId && d.type === point.metric,
    );
    if (descriptor && descriptor.resourceType !== point.resourceType) {
      return invalid("Metric point does not match its descriptor's resource type.");
    }
    if (
      !metricExists(world, point.projectId, point.metric) ||
      !Number.isFinite(point.value) ||
      !["gce_instance", "generic_task"].includes(point.resourceType)
    ) {
      return invalid("Metric point needs a known metric and finite value.");
    }
    if (
      point.metric === ObserveCpuMetric &&
      (point.resourceType !== "gce_instance" || point.value < 0 || point.value > 1)
    ) {
      return invalid("CPU utilization is a gce_instance fraction from zero to one.");
    }
    if (!Number.isInteger(point.time) || point.time < 0 || point.time > lab.clock) {
      return invalid("Invalid metric point time.");
    }
  }
  const pointKeys = lab.points.map(
    (p) => `${p.projectId}/${p.metric}/${p.resourceType}/${p.resource}/${p.time}`,
  );
  if (new Set(pointKeys).size !== pointKeys.length) {
    return invalid("Duplicate series timestamp.");
  }
  for (const collector of lab.collectors) {
    if (
      !collector.resource.trim() ||
      !collector.location.trim() ||
      collector.port !== 8080 ||
      !KubeLabels.parse(collector.selector).ok ||
      !/^[a-z][a-z0-9-]*$/.test(collector.namespace)
    ) {
      return invalid("Invalid bounded collector endpoint or selector.");
    }
  }
  for (const audit of lab.audit) {
    if (
      ![
        "allServices",
        "compute.googleapis.com",
        "storage.googleapis.com",
        "bigquery.googleapis.com",
      ].includes(audit.service) ||
      !World.ancestry(world, { type: "project", id: audit.projectId }).some(
        (t) => t.type === audit.scope && t.id === audit.name,
      )
    ) {
      return invalid("Audit configuration needs an existing ancestor and bounded service.");
    }
  }
  for (const scope of lab.scopes) {
    if (scope.name === scope.projectId || !world.projects.some((p) => p.projectId === scope.name)) {
      return invalid("Metric scope needs a different existing project.");
    }
  }
  for (const configuration of lab.policies) {
    if (
      !world.alertPolicies.some(
        (p) => p.projectId === configuration.projectId && p.name === configuration.name,
      )
    ) {
      return invalid("Advanced policy configuration needs an existing alert policy.");
    }
    if (configuration.conditions.length < 1 || configuration.conditions.length > 6) {
      return invalid("Use one to six metric conditions.");
    }
    if (
      configuration.conditions.some((c) => c.kind === "promql") &&
      configuration.conditions.length !== 1
    ) {
      return invalid("PromQL policies support exactly one condition.");
    }
    if (
      new Set(configuration.conditions.map((c) => c.name)).size !==
        configuration.conditions.length ||
      new Set(configuration.channels).size !== configuration.channels.length
    ) {
      return invalid("Duplicate condition or channel identity.");
    }
    for (const condition of configuration.conditions) {
      if (condition.metric === ObserveCpuMetric && condition.resourceType !== "gce_instance") {
        return invalid("CPU metric uses gce_instance resources.");
      }
      if (
        condition.metric !== ObserveCpuMetric &&
        !/^custom\.googleapis\.com\/ace\/[a-z][a-z0-9_]{0,62}$/.test(condition.metric)
      ) {
        return invalid("Only CPU and ACE custom metrics are evaluated in this lesson.");
      }
      if (
        !condition.name.trim() ||
        !["generic_task", "gce_instance"].includes(condition.resourceType) ||
        !Number.isInteger(condition.evaluationInterval) ||
        condition.evaluationInterval < 30 ||
        condition.evaluationInterval % 30 !== 0 ||
        condition.evaluationInterval > 300
      ) {
        return invalid(
          "Unsupported resource type or evaluation interval (30s multiples, at most 300s). ",
        );
      }
      if (
        !Number.isInteger(condition.duration) ||
        condition.duration % 60 !== 0 ||
        condition.duration < 60 ||
        condition.duration > 3600
      ) {
        return invalid("Lesson durations are 60s multiples from 60s to 3600s.");
      }
      if (condition.kind === "absence" && condition.duration < 120) {
        return invalid("Absence needs at least 120s.");
      }
      if (!Number.isFinite(condition.threshold)) {
        return invalid("Threshold must be finite.");
      }
    }
    if (
      configuration.channels.some(
        (name) =>
          !lab.channels.some((c) => c.projectId === configuration.projectId && c.name === name),
      )
    ) {
      return invalid("Policy notification channels must belong to the same project.");
    }
  }
  for (const objective of lab.objectives) {
    if (!Number.isFinite(objective.goal) || objective.goal <= 0 || objective.goal > 0.9999) {
      return invalid("SLO goal must be greater than zero and at most 0.9999.");
    }
    if (
      !Number.isInteger(objective.rollingSeconds) ||
      objective.rollingSeconds % 86400 !== 0 ||
      objective.rollingSeconds < 86400 ||
      objective.rollingSeconds > 2592000
    ) {
      return invalid("SLO rolling interval must be one to 30 whole days.");
    }
    if (new Set(objective.requests.map((r) => r.time)).size !== objective.requests.length) {
      return invalid("Duplicate SLO interval timestamp.");
    }
    if (
      objective.requests.length > 1000 ||
      objective.requests.some(
        (r) =>
          !Number.isInteger(r.total) ||
          !Number.isInteger(r.good) ||
          r.total < 0 ||
          r.good < 0 ||
          r.good > r.total ||
          !Number.isInteger(r.time) ||
          r.time > lab.clock ||
          r.time < 0,
      )
    ) {
      return invalid("Invalid SLO request interval.");
    }
  }
  for (const bucket of lab.buckets) {
    if (
      !["global", ...Region.all()].includes(bucket.location) ||
      !Number.isInteger(bucket.retentionDays) ||
      bucket.retentionDays < 1 ||
      bucket.retentionDays > 3650 ||
      !Number.isInteger(bucket.deleteRequestedAt) ||
      bucket.deleteRequestedAt < -1 ||
      bucket.deleteRequestedAt > lab.clock
    ) {
      return invalid("Unsupported log bucket location or retention.");
    }
  }
  for (const bucket of lab.buckets) {
    if (
      bucket.name === "_Required" &&
      (bucket.location !== "global" ||
        bucket.retentionDays !== 400 ||
        !bucket.locked ||
        bucket.deleteRequestedAt !== -1)
    ) {
      return invalid("_Required has fixed retention and cannot be deleted.");
    }
    if (
      bucket.name === "_Default" &&
      (bucket.location !== "global" || bucket.deleteRequestedAt !== -1)
    ) {
      return invalid("_Default cannot be deleted or relocated.");
    }
  }
  for (const view of lab.views) {
    if (
      !parseViewFilter(view.filter, view.projectId).ok ||
      new Set(view.readers).size !== view.readers.length
    ) {
      return invalid("Invalid log view filter or duplicate reader.");
    }
    if (
      !lab.buckets.some(
        (b) =>
          b.projectId === view.projectId && b.name === view.bucket && b.location === view.location,
      )
    ) {
      return invalid("Log view needs an existing bucket in its project/location.");
    }
  }
  for (const evaluation of lab.evaluations) {
    const policy = lab.policies.find(
      (p) => p.projectId === evaluation.projectId && p.name === evaluation.name,
    );
    if (
      !policy ||
      !Number.isInteger(evaluation.time) ||
      evaluation.time < 0 ||
      evaluation.time > lab.clock ||
      evaluation.results.some(
        (r) =>
          !Number.isInteger(r.condition) ||
          r.condition < 0 ||
          r.condition >= policy.conditions.length,
      )
    ) {
      return invalid("Invalid alert evaluation reference or time.");
    }
  }
  for (const exclusion of lab.exclusions) {
    if (!LogFilter.parse(exclusion.filter).ok) {
      return invalid("Invalid exclusion filter.");
    }
    if (
      exclusion.sink !== "_Default" &&
      !world.logSinks.some((s) => s.projectId === exclusion.projectId && s.name === exclusion.sink)
    ) {
      return invalid("Exclusion needs its own existing sink.");
    }
  }
  for (const log of lab.logs) {
    if (
      !Number.isInteger(log.time) ||
      log.time < 0 ||
      log.time > lab.clock ||
      !Number.isFinite(Date.parse(log.timestamp))
    ) {
      return invalid("Invalid ingestion timestamp.");
    }
  }
  for (const link of lab.links) {
    if (
      !lab.buckets.some(
        (b) =>
          b.projectId === link.projectId &&
          b.name === link.bucket &&
          b.location === link.location &&
          b.analyticsEnabled &&
          b.deleteRequestedAt === -1,
      ) ||
      !world.dataProcessing.datasets.some(
        (d) =>
          d.projectId === link.projectId && d.name === link.dataset && d.location === link.location,
      )
    ) {
      return invalid("Analytics link needs its live analytics bucket and linked dataset.");
    }
  }
  for (const delivery of lab.deliveries) {
    if (!lab.logs.some((l) => l.projectId === delivery.projectId && l.name === delivery.log)) {
      return invalid("Log delivery needs its retained ingestion record.");
    }
  }
  return Result.ok(world);
};
