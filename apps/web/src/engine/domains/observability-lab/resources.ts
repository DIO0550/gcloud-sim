import type { World } from "@/engine/domains/world";
import type { JsonRecord } from "@/types/Json";
import { collectorStatus } from "./collectors";
import { objectiveResult } from "./evaluation";
import { storedLogs } from "./logging";
import type { ObservabilityLab } from "./model";

export const ObserveCollections = [
  "channels",
  "descriptors",
  "scopes",
  "collectors",
  "policies",
  "evaluations",
  "objectives",
  "buckets",
  "views",
  "exclusions",
  "audit",
  "deliveries",
  "links",
] as const satisfies readonly (keyof ObservabilityLab)[];
export type ObserveCollection = (typeof ObserveCollections)[number];
export const observationIdentity = (item: {
  name: string;
  location?: string;
  bucket?: string;
  sink?: string;
  service?: string;
}): string =>
  [item.location, item.bucket, item.sink, item.service, item.name]
    .filter((part): part is string => !!part)
    .map(encodeURIComponent)
    .join("/");

export const observeResources = (world: World, projectId: string) =>
  ObserveCollections.flatMap((collection) =>
    world.observabilityLab[collection]
      .filter((item) => item.projectId === projectId)
      .map((item) => {
        let resource: JsonRecord = { ...item };
        const collector = world.observabilityLab.collectors.find(
          (c) => c.projectId === projectId && c.name === item.name,
        );
        if (collection === "collectors" && collector) {
          resource = {
            ...resource,
            status: collectorStatus(world, collector),
            installedSoftware: false,
          };
        }
        const objective = world.observabilityLab.objectives.find(
          (c) => c.projectId === projectId && c.name === item.name,
        );
        if (collection === "objectives" && objective) {
          resource = { ...resource, ...objectiveResult(objective, world.observabilityLab.clock) };
        }
        const bucket = world.observabilityLab.buckets.find(
          (c) => c.projectId === projectId && observationIdentity(c) === observationIdentity(item),
        );
        if (collection === "buckets" && bucket) {
          let lifecycleState = "ACTIVE";
          if (bucket.deleteRequestedAt >= 0) {
            lifecycleState = "DELETE_REQUESTED";
            if (world.observabilityLab.clock - bucket.deleteRequestedAt >= 604800) {
              lifecycleState = "DELETED";
            }
          }
          resource = {
            ...resource,
            lifecycleState,
            retainedLogs: storedLogs(world, bucket.projectId, bucket.location, bucket.name).length,
          };
        }
        return {
          collection,
          name: observationIdentity(item),
          label: `${collection}: ${observationIdentity(item)}`,
          resource,
        };
      }),
  );
