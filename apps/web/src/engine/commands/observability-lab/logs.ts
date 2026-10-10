import { CommandOutput, Flag, ParsedArgs } from "@/engine/cli/command-spec";
import { LogFilter } from "@/engine/commands/observability/filter";
import { EffectivePermissions } from "@/engine/domains/effective-permissions";
import { auditEnabled, ingestLog, storedLogs } from "@/engine/domains/observability-lab/logging";
import type { AuditConfiguration, ObserveLog } from "@/engine/domains/observability-lab/model";
import { Principal } from "@/engine/domains/principal";
import { World } from "@/engine/domains/world";
import { Result } from "@/utils/Result";
import { command, finish, invalid, missing, name, save, sf, text } from "./shared";

const location = sf("location", true);
const knownServices = [
  "compute.googleapis.com",
  "storage.googleapis.com",
  "bigquery.googleapis.com",
] as const;

export const ObserveLogCommands = [
  command({
    path: ["sim", "logging", "audit", "configure"],
    api: "logging.googleapis.com",
    permissions: ["resourcemanager.projects.setIamPolicy"],
    flags: [
      sf("scope", true),
      Flag.enum("service", "Bounded audit service.", ["allServices", ...knownServices], {
        required: true,
      }),
      Flag.boolean("admin-read", "Enable admin reads."),
      Flag.boolean("data-read", "Enable data reads."),
      Flag.boolean("data-write", "Enable data writes."),
    ],
    run: (ctx, args) => {
      const [scope, id] = text(args, "scope").split("/");
      const targets = World.ancestry(ctx.world, { type: "project", id: ctx.project.projectId });
      const target = targets.find((t) => `${t.type}s` === scope && t.id === id);
      if (!target) {
        return invalid(
          "Scope must be this project or one of its existing folder/organization ancestors.",
        );
      }
      const permission = `resourcemanager.${scope}.setIamPolicy`;
      if (
        !EffectivePermissions.resolve(
          ctx.world,
          Principal.toMember(ctx.principal),
          target,
        ).permissions.has(permission)
      ) {
        return invalid("IAM configuration permission is required at the chosen scope.");
      }
      const item: AuditConfiguration = {
        projectId: ctx.project.projectId,
        name: target.id,
        scope: target.type as AuditConfiguration["scope"],
        service: text(args, "service"),
        adminRead: ParsedArgs.boolean(args, "admin-read"),
        dataRead: ParsedArgs.boolean(args, "data-read"),
        dataWrite: ParsedArgs.boolean(args, "data-write"),
      };
      const kept = ctx.world.observabilityLab.audit.filter(
        (a) => a.scope !== item.scope || a.name !== item.name || a.service !== item.service,
      );
      return save(
        ctx.world,
        { audit: [...kept, item] },
        {
          ...item,
          inheritance: "Enabled ancestor audit types cannot be disabled by a child.",
          simulated: true,
        },
      );
    },
  }),
  command({
    path: ["sim", "logging", "audit", "emit"],
    api: "logging.googleapis.com",
    permissions: ["logging.logEntries.create"],
    flags: [
      Flag.enum(
        "category",
        "Fixed synthetic audit fixture.",
        ["ADMIN_ACTIVITY", "DATA_ACCESS", "SYSTEM_EVENT", "POLICY_DENIED"],
        { required: true },
      ),
      Flag.enum("service", "Existing service API.", knownServices, { required: true }),
      Flag.enum("access", "Data Access type.", ["adminRead", "dataRead", "dataWrite"]),
    ],
    run: (ctx, args) => {
      const service = text(args, "service") as (typeof knownServices)[number];
      if (!World.hasApi(ctx.world, ctx.project.projectId, service)) {
        return invalid("Enable the fixture's service API in the selected project.");
      }
      const kind = text(args, "category") as ObserveLog["kind"];
      const access = text(args, "access", "dataRead") as "adminRead" | "dataRead" | "dataWrite";
      if (kind !== "DATA_ACCESS" && ParsedArgs.has(args, "access")) {
        return invalid("--access is only valid for Data Access audit fixtures.");
      }
      if (
        kind === "DATA_ACCESS" &&
        !auditEnabled(ctx.world, ctx.project.projectId, service, access)
      ) {
        return finish(ctx.world, {
          recorded: false,
          reason: "Data Access is disabled for this service/type.",
          simulated: true,
        });
      }
      const world = ingestLog(ctx.world, {
        projectId: ctx.project.projectId,
        kind,
        service,
        method: `sim.fixture.${kind === "DATA_ACCESS" ? access : kind.toLowerCase()}`,
        resource: `projects/${ctx.project.projectId}/simulated-audit-fixture`,
        principal: ctx.principal,
        severity: kind === "POLICY_DENIED" ? "ERROR" : "NOTICE",
        time: ctx.world.observabilityLab.clock,
        timestamp: ctx.now,
        text: "Fixed audit teaching fixture; no actual service operation or policy denial.",
      });
      return finish(world, { recorded: true, category: kind, simulated: true });
    },
  }),
  command({
    path: ["sim", "logging", "router", "describe"],
    api: "logging.googleapis.com",
    permissions: ["logging.sinks.get"],
    run: (ctx) =>
      Result.ok({
        world: ctx.world,
        output: CommandOutput.yamlList(
          ctx.world.observabilityLab.deliveries
            .filter((d) => d.projectId === ctx.project.projectId)
            .map((d) => ({ ...d, replayed: false })),
        ),
      }),
  }),
  ...(["configure", "delete", "list"] as const).map((action) =>
    command({
      path: ["sim", "logging", "exclusions", action],
      api: "logging.googleapis.com",
      permissions: [`logging.exclusions.${action === "configure" ? "create" : action}`],
      named: action !== "list",
      destructive: action === "delete",
      flags: [
        sf("sink", true),
        ...(action === "configure"
          ? [sf("log-filter", true), Flag.boolean("disabled", "Disable this sink-local exclusion.")]
          : []),
      ],
      run: (ctx, args) => {
        const sink = text(args, "sink");
        if (
          sink !== "_Default" &&
          !ctx.world.logSinks.some((s) => s.projectId === ctx.project.projectId && s.name === sink)
        ) {
          return missing(
            "Use a custom sink or the built-in _Default sink; _Required cannot be excluded.",
          );
        }
        const belongs = (e: { projectId: string; sink: string }) =>
          e.projectId === ctx.project.projectId && e.sink === sink;
        if (action === "list") {
          return Result.ok({
            world: ctx.world,
            output: CommandOutput.yamlList(
              ctx.world.observabilityLab.exclusions.filter(belongs).map((e) => ({ ...e })),
            ),
          });
        }
        const previous = ctx.world.observabilityLab.exclusions.find(
          (e) => belongs(e) && e.name === name(args),
        );
        if (action === "delete") {
          if (!previous) {
            return missing("Exclusion not found in this sink.");
          }
          return save(
            ctx.world,
            { exclusions: ctx.world.observabilityLab.exclusions.filter((e) => e !== previous) },
            { deleted: name(args) },
          );
        }
        if (
          previous &&
          !EffectivePermissions.resolve(ctx.world, Principal.toMember(ctx.principal), {
            type: "project",
            id: ctx.project.projectId,
          }).permissions.has("logging.exclusions.update")
        ) {
          return invalid("Updating an existing exclusion requires logging.exclusions.update.");
        }
        const filter = text(args, "log-filter");
        const parsed = LogFilter.parse(filter);
        if (!Result.isOk(parsed)) {
          return parsed;
        }
        const item = {
          projectId: ctx.project.projectId,
          name: name(args),
          sink,
          filter,
          disabled: ParsedArgs.boolean(args, "disabled"),
        };
        return save(
          ctx.world,
          {
            exclusions: [
              ...ctx.world.observabilityLab.exclusions.filter((e) => e !== previous),
              item,
            ],
          },
          {
            ...item,
            effect: "This sink only; log-based metrics and other sinks remain independent.",
          },
        );
      },
    }),
  ),
  ...(["create", "describe", "delete"] as const).map((action) =>
    command({
      path: ["sim", "logging", "analytics", "links", action],
      api: "logging.googleapis.com",
      permissions: [`logging.links.${action === "describe" ? "get" : action}`],
      named: true,
      destructive: action === "delete",
      flags: [location, sf("bucket", true), ...(action === "create" ? [sf("dataset", true)] : [])],
      run: (ctx, args) => {
        const lab = ctx.world.observabilityLab;
        const bucket = lab.buckets.find(
          (b) =>
            b.projectId === ctx.project.projectId &&
            b.name === text(args, "bucket") &&
            b.location === text(args, "location") &&
            b.deleteRequestedAt === -1 &&
            b.analyticsEnabled,
        );
        if (!bucket) {
          return invalid("Use an active Analytics-enabled bucket in this project/location.");
        }
        const previous = lab.links.find(
          (l) =>
            l.projectId === bucket.projectId &&
            l.location === bucket.location &&
            l.bucket === bucket.name &&
            l.name === name(args),
        );
        if (action !== "create") {
          if (!previous) {
            return missing("Analytics link not found in this bucket/location.");
          }
          if (action === "describe") {
            return finish(ctx.world, { ...previous, copied: false });
          }
          return save(
            ctx.world,
            { links: lab.links.filter((l) => l !== previous) },
            { deleted: name(args), bucketPreserved: true, datasetPreserved: true },
          );
        }
        const dataset = ctx.world.dataProcessing.datasets.find(
          (d) =>
            d.projectId === bucket.projectId &&
            d.name === text(args, "dataset") &&
            d.location === bucket.location,
        );
        const permissions = EffectivePermissions.resolve(
          ctx.world,
          Principal.toMember(ctx.principal),
          { type: "project", id: bucket.projectId },
        ).permissions;
        if (
          previous ||
          lab.links.some(
            (l) =>
              l.projectId === bucket.projectId &&
              l.bucket === bucket.name &&
              l.location === bucket.location,
          ) ||
          !dataset ||
          !World.hasApi(ctx.world, bucket.projectId, "bigquery.googleapis.com") ||
          !permissions.has("bigquery.datasets.get")
        ) {
          return invalid(
            "Link needs an unused Analytics bucket, same-project/location existing dataset, BigQuery API and dataset access.",
          );
        }
        const item = {
          projectId: bucket.projectId,
          name: name(args),
          location: bucket.location,
          bucket: bucket.name,
          dataset: dataset.name,
        };
        return save(
          ctx.world,
          { links: [...lab.links, item] },
          {
            ...item,
            copied: false,
            model: "Simulator projection of linked Analytics; dataset is retained independently.",
          },
        );
      },
    }),
  ),
  command({
    path: ["sim", "logging", "analytics", "query"],
    api: "logging.googleapis.com",
    permissions: ["logging.views.access"],
    named: true,
    flags: [
      location,
      Flag.enum("group-by", "Bounded aggregation.", ["kind", "severity"], { required: true }),
    ],
    run: (ctx, args) => {
      const bucket = ctx.world.observabilityLab.buckets.find(
        (b) =>
          b.projectId === ctx.project.projectId &&
          b.name === name(args) &&
          b.location === text(args, "location") &&
          b.analyticsEnabled &&
          b.deleteRequestedAt === -1,
      );
      if (!bucket) {
        return invalid(
          "Query requires a live Analytics-enabled bucket; no arbitrary SQL is executed.",
        );
      }
      const records = storedLogs(ctx.world, bucket.projectId, bucket.location, bucket.name);
      const field = text(args, "group-by") as "kind" | "severity";
      const groups = [...new Set(records.map((l) => l[field]))];
      return Result.ok({
        world: ctx.world,
        output: CommandOutput.yamlList(
          groups.map((group) => ({
            group,
            count: records.filter((l) => l[field] === group).length,
            copied: false,
          })),
        ),
      });
    },
  }),
];
