import { LogEntry } from "@/engine/domains/observability";
import { ingestLog } from "@/engine/domains/observability-lab/logging";
import type { World } from "@/engine/domains/world";

/** Only new modeled operations/connection checks enter the router; imports never replay history. */
export const observationEvents = (before: World, after: World, now: string): World => {
  let world = after;
  for (const operation of after.operations) {
    if (before.operations.some((o) => o.id === operation.id)) {
      continue;
    }
    const entry = LogEntry.fromOperation(operation);
    world = ingestLog(world, {
      name: `operation-${operation.id}`,
      projectId: entry.projectId,
      kind: "ADMIN_ACTIVITY",
      service: "compute.googleapis.com",
      method: entry.methodName,
      resource: entry.resourceName,
      principal: entry.principalEmail,
      severity: "NOTICE",
      time: world.observabilityLab.clock,
      timestamp: entry.timestamp,
      text: "Modeled Compute administration operation.",
    });
  }
  for (const entry of after.networkLab.logs) {
    if (before.networkLab.logs.includes(entry) || entry.kind === "NAT") {
      continue;
    }
    world = ingestLog(world, {
      projectId: entry.projectId,
      kind: entry.kind,
      service: "compute.googleapis.com",
      method: `network.${entry.kind.toLowerCase()}`,
      resource: entry.source,
      principal: "simulated-network",
      severity: entry.allowed ? "NOTICE" : "ERROR",
      time: world.observabilityLab.clock,
      timestamp: now,
      text: `${entry.source} -> ${entry.destination}: ${entry.allowed ? "ALLOW" : "DENY"} (${entry.rule})`,
    });
  }
  return world;
};
