import type { CommandSpec } from "@/engine/cli/command-spec";
import { observeAdmin, validScope } from "@/engine/domains/admin-lab/model";
import { scopeChain } from "@/engine/domains/admin-lab/policies";
import type { World } from "@/engine/domains/world";
import type { JsonRecord } from "@/types/Json";
import { Result } from "@/utils/Result";
import { invalid, missing, records, scoped, sf, text } from "./shared";

const inventory = (
  world: World,
): readonly Readonly<{ projectId: string; record: JsonRecord }>[] => [
  ...world.instances.map((r) => ({
    projectId: r.projectId,
    record: {
      name: `//compute.googleapis.com/projects/${r.projectId}/zones/${r.zone}/instances/${r.name}`,
      assetType: "compute.googleapis.com/Instance",
      location: r.zone,
      displayName: r.name,
    },
  })),
  ...world.buckets.map((r) => ({
    projectId: r.projectId,
    record: {
      name: `//storage.googleapis.com/${r.name}`,
      assetType: "storage.googleapis.com/Bucket",
      location: r.location,
      displayName: r.name,
    },
  })),
  ...world.networks.map((r) => ({
    projectId: r.projectId,
    record: {
      name: `//compute.googleapis.com/projects/${r.projectId}/global/networks/${r.name}`,
      assetType: "compute.googleapis.com/Network",
      location: "global",
      displayName: r.name,
    },
  })),
  ...world.serviceAccounts.map((r) => ({
    projectId: r.projectId,
    record: {
      name: `//iam.googleapis.com/projects/${r.projectId}/serviceAccounts/${r.email}`,
      assetType: "iam.googleapis.com/ServiceAccount",
      location: "global",
      displayName: r.email,
    },
  })),
  ...world.sqlInstances.map((r) => ({
    projectId: r.projectId,
    record: {
      name: `//sqladmin.googleapis.com/projects/${r.projectId}/instances/${r.name}`,
      assetType: "sqladmin.googleapis.com/Instance",
      location: r.region,
      displayName: r.name,
    },
  })),
  ...world.clusters.map((r) => ({
    projectId: r.projectId,
    record: {
      name: `//container.googleapis.com/projects/${r.projectId}/locations/${r.location}/clusters/${r.name}`,
      assetType: "container.googleapis.com/Cluster",
      location: r.location,
      displayName: r.name,
    },
  })),
  ...world.serverlessLab.deployments
    .filter((r) => r.kind === "run")
    .map((r) => ({
      projectId: r.projectId,
      record: {
        name: `//run.googleapis.com/projects/${r.projectId}/locations/${r.region}/services/${r.name}`,
        assetType: "run.googleapis.com/Service",
        location: r.region,
        displayName: r.name,
      },
    })),
];
export const AssetCommands: readonly CommandSpec[] = [
  scoped({
    path: ["gcloud", "asset", "search-all-resources"],
    api: "cloudasset.googleapis.com",
    permission: "cloudasset.assets.searchAllResources",
    flags: [sf("scope"), sf("query")],
    scope: (ctx, a) => {
      const scope = text(a, "scope", ctx.projectId.some ? `projects/${ctx.projectId.value}` : "");
      return validScope(ctx.world, scope)
        ? Result.ok(scope)
        : missing("Asset search scope does not exist.");
    },
    run: (ctx, a, scope) => {
      const query = text(a, "query");
      if (query && !/^name:[a-zA-Z0-9_@./:-]+\*?$/.test(query)) {
        return invalid(
          "Only an empty query or name:TEXT with an optional final * is modeled; complex queries are unsupported.",
        );
      }
      const needle = query.replace(/^name:/, "").replace(/\*$/, "");
      const matches = inventory(ctx.world).filter(
        (r) =>
          scopeChain(ctx.world, `projects/${r.projectId}`).includes(scope) &&
          (!needle || String(r.record.name).includes(needle)),
      );
      const projectId = ctx.projectId.some ? ctx.projectId.value : "";
      const world = observeAdmin(ctx.world, {
        projectId,
        kind: "assets",
        resource: scope,
        result: query || "all",
        value: matches.length,
      });
      return records(
        world,
        matches.map((r) => ({
          ...r.record,
          project: `projects/${ctx.world.projects.find((p) => p.projectId === r.projectId)?.projectNumber ?? ""}`,
          folders: scopeChain(ctx.world, `projects/${r.projectId}`).filter((s) =>
            s.startsWith("folders/"),
          ),
          organization: `organizations/${ctx.world.organization.id}`,
        })),
      );
    },
  }),
];
