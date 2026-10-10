import { CommandOutput, Flag } from "@/engine/cli/command-spec";
import { EffectivePermissions } from "@/engine/domains/effective-permissions";
import {
  type ObserveCollection,
  ObserveCollections,
  observeResources,
} from "@/engine/domains/observability-lab/resources";
import { Principal } from "@/engine/domains/principal";
import { World } from "@/engine/domains/world";
import { Result } from "@/utils/Result";
import { command, finish, invalid, missing, name, text } from "./shared";

const readPermissions: Readonly<Record<ObserveCollection, string>> = {
  channels: "monitoring.notificationChannels.get",
  descriptors: "monitoring.metricDescriptors.get",
  scopes: "monitoring.metricsScopes.get",
  collectors: "monitoring.metricDescriptors.get",
  policies: "monitoring.alertPolicies.get",
  evaluations: "monitoring.timeSeries.list",
  objectives: "monitoring.slos.get",
  buckets: "logging.buckets.get",
  views: "logging.views.get",
  exclusions: "logging.exclusions.get",
  audit: "resourcemanager.projects.getIamPolicy",
  deliveries: "logging.sinks.get",
  links: "logging.links.get",
};
export const ObserveResourceCommands = (["describe", "list"] as const).map((action) =>
  command({
    path: ["sim", "monitoring", "resources", action],
    api: null,
    permissions: [],
    named: action === "describe",
    flags: [
      Flag.enum("collection", "Observation resource collection.", ObserveCollections, {
        required: true,
      }),
    ],
    run: (ctx, args) => {
      const collection = text(args, "collection") as ObserveCollection;
      const logging = ["buckets", "views", "exclusions", "audit", "deliveries", "links"].includes(
        collection,
      );
      const api = logging ? "logging.googleapis.com" : "monitoring.googleapis.com";
      if (!World.hasApi(ctx.world, ctx.project.projectId, api)) {
        return invalid(`Enable ${api} before reading this collection.`);
      }
      const permissions = EffectivePermissions.resolve(
        ctx.world,
        Principal.toMember(ctx.principal),
        { type: "project", id: ctx.project.projectId },
      ).permissions;
      if (!permissions.has(readPermissions[collection])) {
        return invalid(`Resource access requires ${readPermissions[collection]}.`);
      }
      const items = observeResources(ctx.world, ctx.project.projectId).filter(
        (r) => r.collection === collection,
      );
      if (action === "list") {
        return Result.ok({
          world: ctx.world,
          output: CommandOutput.yamlList(items.map((r) => r.resource)),
        });
      }
      const item = items.find((r) => r.name === name(args));
      if (!item) {
        return missing("Resource not found in the selected project/collection.");
      }
      return finish(ctx.world, item.resource);
    },
  }),
);
