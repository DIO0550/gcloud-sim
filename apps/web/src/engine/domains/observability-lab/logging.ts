import { LogFilter } from "@/engine/commands/observability/filter";
import { identitySubjects } from "@/engine/domains/admin-lab/model";
import { EffectivePermissions } from "@/engine/domains/effective-permissions";
import type { IamMember } from "@/engine/domains/iam-policy";
import { LogNames } from "@/engine/domains/observability";
import { World } from "@/engine/domains/world";
import type { JsonRecord } from "@/types/Json";
import { Result } from "@/utils/Result";
import type { LogDelivery, LogView, ObserveLog } from "./model";

const names = {
  ADMIN_ACTIVITY: LogNames.Activity,
  DATA_ACCESS: LogNames.DataAccess,
  SYSTEM_EVENT: LogNames.SystemEvent,
  POLICY_DENIED: "cloudaudit.googleapis.com/policy",
  FLOW: "compute.googleapis.com/vpc_flows",
  FIREWALL: "compute.googleapis.com/firewall",
} as const;
export const observeLogRecord = (log: ObserveLog): JsonRecord => ({
  insertId: log.name,
  logName: `projects/${log.projectId}/logs/${encodeURIComponent(names[log.kind])}`,
  timestamp: log.timestamp,
  severity: log.severity,
  resource: {
    type: log.kind === "FLOW" || log.kind === "FIREWALL" ? "gce_subnetwork" : "gce_instance",
    labels: { project_id: log.projectId },
  },
  protoPayload: {
    "@type": "type.googleapis.com/google.cloud.audit.AuditLog",
    serviceName: log.service,
    methodName: log.method,
    resourceName: log.resource,
    authenticationInfo: { principalEmail: log.principal },
  },
  textPayload: log.text,
});
export const logMatches = (filter: string, log: ObserveLog): boolean => {
  if (!filter.trim()) {
    return true;
  }
  const parsed = LogFilter.parse(filter);
  return Result.isOk(parsed) && LogFilter.matches(parsed.value, observeLogRecord(log));
};

export const auditEnabled = (
  world: World,
  projectId: string,
  service: string,
  kind: "adminRead" | "dataRead" | "dataWrite",
): boolean => {
  if (service === "bigquery.googleapis.com") {
    return true;
  }
  const ancestry = World.ancestry(world, { type: "project", id: projectId });
  return world.observabilityLab.audit.some(
    (a) =>
      a[kind] &&
      (a.service === "allServices" || a.service === service) &&
      ancestry.some((p) => p.type === a.scope && p.id === a.name),
  );
};

const destinationAllowed = (
  world: World,
  destination: string,
  subject: IamMember,
  sourceProject: string,
): boolean => {
  const logging =
    /^logging.googleapis.com\/projects\/([^/]+)\/locations\/([^/]+)\/buckets\/([^/]+)$/.exec(
      destination,
    );
  if (logging?.[1]) {
    const builtin = logging[2] === "global" && ["_Required", "_Default"].includes(logging[3] ?? "");
    const exists =
      builtin ||
      world.observabilityLab.buckets.some(
        (b) =>
          b.projectId === logging[1] &&
          b.location === logging[2] &&
          b.name === logging[3] &&
          b.deleteRequestedAt === -1,
      );
    const permissions = EffectivePermissions.resolve(world, subject, {
      type: "project",
      id: logging[1],
    }).permissions;
    const authorized =
      sourceProject === logging[1] ||
      (permissions.has("logging.buckets.write") && permissions.has("logging.logEntries.route"));
    return World.hasApi(world, logging[1], "logging.googleapis.com") && exists && authorized;
  }
  const bq = /^bigquery.googleapis.com\/projects\/([^/]+)\/datasets\/([^/]+)$/.exec(destination);
  if (bq?.[1]) {
    const permissions = EffectivePermissions.resolve(world, subject, {
      type: "project",
      id: bq[1],
    }).permissions;
    return (
      World.hasApi(world, bq[1], "bigquery.googleapis.com") &&
      world.dataProcessing.datasets.some((d) => d.projectId === bq[1] && d.name === bq[2]) &&
      permissions.has("logging.logEntries.route") &&
      permissions.has("bigquery.tables.create") &&
      permissions.has("bigquery.tables.updateData")
    );
  }
  const gcs = /^storage.googleapis.com\/([^/]+)$/.exec(destination);
  if (gcs?.[1]) {
    const bucket = world.buckets.find((b) => b.name === gcs[1]);
    if (!bucket || !World.hasApi(world, bucket.projectId, "storage.googleapis.com")) {
      return false;
    }
    const permissions = EffectivePermissions.resolve(world, subject, {
      type: "bucket",
      id: bucket.name,
    }).permissions;
    return permissions.has("storage.objects.create") && permissions.has("logging.logEntries.route");
  }
  const pubsub = /^pubsub.googleapis.com\/projects\/([^/]+)\/topics\/([^/]+)$/.exec(destination);
  if (pubsub?.[1]) {
    const permissions = EffectivePermissions.resolve(world, subject, {
      type: "project",
      id: pubsub[1],
    }).permissions;
    return (
      World.hasApi(world, pubsub[1], "pubsub.googleapis.com") &&
      world.pubsubTopics.some((t) => t.projectId === pubsub[1] && t.name === pubsub[2]) &&
      permissions.has("pubsub.topics.publish") &&
      permissions.has("logging.logEntries.route")
    );
  }
  return false;
};

/** Evaluate each sink independently at ingestion. Repaired IAM never replays earlier records. */
export const ingestLog = (
  world: World,
  seed: Omit<ObserveLog, "name"> & { name?: string },
): World => {
  const sequence =
    1 +
    Math.max(
      0,
      ...world.observabilityLab.logs.map((l) => Number(/^log-(\d+)$/.exec(l.name)?.[1] ?? 0)),
    );
  const log: ObserveLog = { ...seed, name: seed.name ?? `log-${sequence}` };
  if (
    world.observabilityLab.logs.some((l) => l.name === log.name && l.projectId === log.projectId)
  ) {
    return world;
  }
  const required = log.kind === "ADMIN_ACTIVITY" || log.kind === "SYSTEM_EVENT";
  const defaultExcluded =
    !required &&
    world.observabilityLab.exclusions.some(
      (e) =>
        e.projectId === log.projectId &&
        e.sink === "_Default" &&
        !e.disabled &&
        logMatches(e.filter, log),
    );
  const internal: LogDelivery = {
    projectId: log.projectId,
    name: `${log.name}-internal`,
    log: log.name,
    destination: `logging.googleapis.com/projects/${log.projectId}/locations/global/buckets/${required ? "_Required" : "_Default"}`,
    state: defaultExcluded ? "EXCLUDED" : "STORED",
  };
  const deliveries = world.logSinks
    .filter((s) => s.projectId === log.projectId && logMatches(s.filter, log))
    .map((sink, index): LogDelivery => {
      const excluded = world.observabilityLab.exclusions.some(
        (e) =>
          e.projectId === sink.projectId &&
          e.sink === sink.name &&
          !e.disabled &&
          logMatches(e.filter, log),
      );
      let state: LogDelivery["state"] = "STORED";
      if (excluded) {
        state = "EXCLUDED";
      } else if (
        !destinationAllowed(
          world,
          sink.destination,
          sink.writerIdentity as IamMember,
          log.projectId,
        )
      ) {
        state = "DENIED";
      }
      return {
        projectId: log.projectId,
        name: `${log.name}-${index}`,
        log: log.name,
        destination: sink.destination,
        state,
      };
    });
  const logs = [...world.observabilityLab.logs, log].slice(-1000);
  const retained = new Set(logs.map((l) => `${l.projectId}/${l.name}`));
  return {
    ...world,
    observabilityLab: {
      ...world.observabilityLab,
      logs,
      deliveries: [...world.observabilityLab.deliveries, internal, ...deliveries]
        .filter((d) => retained.has(`${d.projectId}/${d.log}`))
        .slice(-1000),
    },
  };
};

export const storedLogs = (
  world: World,
  projectId: string,
  location: string,
  bucketName: string,
): readonly ObserveLog[] => {
  const bucket = world.observabilityLab.buckets.find(
    (b) => b.projectId === projectId && b.location === location && b.name === bucketName,
  );
  if (
    bucket &&
    bucket.deleteRequestedAt >= 0 &&
    world.observabilityLab.clock - bucket.deleteRequestedAt >= 604800
  ) {
    return [];
  }
  const retention = bucketName === "_Required" ? 400 : (bucket?.retentionDays ?? 30);
  const destination = `logging.googleapis.com/projects/${projectId}/locations/${location}/buckets/${bucketName}`;
  return world.observabilityLab.logs.filter(
    (log) =>
      world.observabilityLab.deliveries.some(
        (d) =>
          d.log === log.name &&
          d.projectId === log.projectId &&
          d.destination === destination &&
          d.state === "STORED",
      ) && log.time > world.observabilityLab.clock - retention * 86400,
  );
};
export const canReadView = (world: World, subject: IamMember, view: LogView): boolean => {
  const permissions = EffectivePermissions.resolve(world, subject, {
    type: "project",
    id: view.projectId,
  }).permissions;
  return (
    permissions.has("logging.views.access") ||
    identitySubjects(world, subject).some((member) => view.readers.includes(member))
  );
};
