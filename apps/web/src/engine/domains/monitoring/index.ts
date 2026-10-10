import { conditionRecord } from "@/engine/domains/observability-lab/policy";
import type { World } from "@/engine/domains/world";
import type { JsonRecord } from "@/types/Json";
import { Decoder as D } from "@/utils/Decoder";
import { Result } from "@/utils/Result";

export type LogMetric = Readonly<{
  projectId: string;
  name: string;
  description: string;
  filter: string;
}>;

export type UptimeCheck = Readonly<{
  projectId: string;
  name: string;
  displayName: string;
  host: string;
  path: string;
  protocol: "http" | "https";
  port: number;
  period: string;
  timeout: string;
}>;

export type AlertPolicy = Readonly<{
  projectId: string;
  name: string;
  displayName: string;
  enabled: boolean;
  conditionName: string;
  filter: string;
  comparison: "COMPARISON_GT" | "COMPARISON_LT";
  threshold: number;
  duration: string;
}>;

export type Dashboard = Readonly<{
  projectId: string;
  name: string;
  displayName: string;
  title: string;
  filter: string;
}>;

/** These decoders are shared by import and command validation. */
const nonempty = D.map(D.string, (value) =>
  value.trim().length > 0 ? Result.ok(value) : Result.err("must not be empty"),
);
const seconds = D.map(D.string, (value) =>
  /^\d+s$/.test(value) ? Result.ok(value) : Result.err("expected a duration in seconds, e.g. 60s"),
);
const port = D.map(D.number, (value) =>
  Number.isInteger(value) && value >= 1 && value <= 65535
    ? Result.ok(value)
    : Result.err("port must be between 1 and 65535"),
);

export const LogMetric = {
  decode: D.object<LogMetric>({
    projectId: nonempty,
    name: nonempty,
    description: D.string,
    filter: nonempty,
  }),
  toRecord(metric: LogMetric): JsonRecord {
    return {
      name: metric.name,
      description: metric.description,
      filter: metric.filter,
      metricDescriptor: {
        type: `logging.googleapis.com/user/${metric.name}`,
        metricKind: "DELTA",
        valueType: "INT64",
        unit: "1",
      },
    };
  },
} as const;

export const UptimeCheck = {
  decode: D.object<UptimeCheck>({
    projectId: nonempty,
    name: nonempty,
    displayName: nonempty,
    host: nonempty,
    path: D.map(D.string, (value) =>
      value.startsWith("/") ? Result.ok(value) : Result.err("path must start with /"),
    ),
    protocol: D.literal(["http", "https"]),
    port,
    period: D.literal(["60s", "300s", "600s", "900s"]),
    timeout: D.map(seconds, (value) =>
      Number.parseInt(value, 10) >= 1 && Number.parseInt(value, 10) <= 60
        ? Result.ok(value)
        : Result.err("timeout must be 1s to 60s"),
    ),
  }),
  toRecord(check: UptimeCheck): JsonRecord {
    return {
      name: `projects/${check.projectId}/uptimeCheckConfigs/${check.name}`,
      displayName: check.displayName,
      monitoredResource: {
        type: "uptime_url",
        labels: { project_id: check.projectId, host: check.host },
      },
      httpCheck: { path: check.path, port: check.port, useSsl: check.protocol === "https" },
      period: check.period,
      timeout: check.timeout,
    };
  },
} as const;

export const AlertPolicy = {
  decode: D.object<AlertPolicy>({
    projectId: nonempty,
    name: nonempty,
    displayName: nonempty,
    enabled: D.boolean,
    conditionName: nonempty,
    filter: nonempty,
    comparison: D.literal(["COMPARISON_GT", "COMPARISON_LT"]),
    threshold: D.number,
    duration: D.map(seconds, (value) =>
      Number.parseInt(value, 10) % 60 === 0
        ? Result.ok(value)
        : Result.err("duration must be a multiple of 60s"),
    ),
  }),
  toRecord(policy: AlertPolicy, world?: World): JsonRecord {
    const configuration = world?.observabilityLab.policies.find(
      (p) => p.projectId === policy.projectId && p.name === policy.name,
    );
    const prefix = `projects/${policy.projectId}/alertPolicies/${policy.name}`;
    if (configuration) {
      return {
        name: prefix,
        displayName: policy.displayName,
        enabled: policy.enabled,
        combiner: configuration.combiner,
        notificationChannels: configuration.channels.map(
          (c) => `projects/${policy.projectId}/notificationChannels/${c}`,
        ),
        conditions: configuration.conditions.map((c) => conditionRecord(c, prefix)),
      };
    }
    return {
      name: `projects/${policy.projectId}/alertPolicies/${policy.name}`,
      displayName: policy.displayName,
      enabled: policy.enabled,
      combiner: "OR",
      conditions: [
        {
          displayName: policy.conditionName,
          conditionThreshold: {
            filter: policy.filter,
            comparison: policy.comparison,
            thresholdValue: policy.threshold,
            duration: policy.duration,
          },
        },
      ],
    };
  },
} as const;

export const dashboardEtag = (dashboard: Dashboard): string => {
  const value = JSON.stringify(dashboard);
  let hash = 2166136261;
  for (const letter of value) {
    hash = Math.imul(hash ^ letter.charCodeAt(0), 16777619);
  }
  return `sim-${(hash >>> 0).toString(16)}`;
};
export const Dashboard = {
  decode: D.object<Dashboard>({
    projectId: nonempty,
    name: nonempty,
    displayName: nonempty,
    title: nonempty,
    filter: nonempty,
  }),
  toRecord(dashboard: Dashboard): JsonRecord {
    return {
      name: `projects/${dashboard.projectId}/dashboards/${dashboard.name}`,
      etag: dashboardEtag(dashboard),
      displayName: dashboard.displayName,
      gridLayout: {
        columns: 1,
        widgets: [
          {
            title: dashboard.title,
            xyChart: {
              dataSets: [{ timeSeriesQuery: { timeSeriesFilter: { filter: dashboard.filter } } }],
            },
          },
        ],
      },
    };
  },
} as const;
