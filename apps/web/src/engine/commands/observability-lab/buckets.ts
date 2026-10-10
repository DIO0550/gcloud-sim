import { CommandOutput, Flag, ParsedArgs } from "@/engine/cli/command-spec";
import { LogFilter } from "@/engine/commands/observability/filter";
import { IamMember } from "@/engine/domains/iam-policy";
import {
  canReadView,
  observeLogRecord,
  storedLogs,
} from "@/engine/domains/observability-lab/logging";
import type { LogView, ObserveBucket } from "@/engine/domains/observability-lab/model";
import { parseViewFilter } from "@/engine/domains/observability-lab/view-filter";
import { Principal } from "@/engine/domains/principal";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";
import { command, finish, invalid, missing, name, same, save, sf, text } from "./shared";

const location = sf("location", true, ["global", "us-central1", "asia-northeast1"]);
const builtin = (projectId: string, name: string): ObserveBucket => ({
  projectId,
  name,
  location: "global",
  retentionDays: name === "_Required" ? 400 : 30,
  locked: name === "_Required",
  analyticsEnabled: false,
  deleteRequestedAt: -1,
});
const bucketRecord = (b: ObserveBucket, clock: number) => {
  let lifecycleState = "ACTIVE";
  if (b.deleteRequestedAt >= 0) {
    lifecycleState = "DELETE_REQUESTED";
    if (clock - b.deleteRequestedAt >= 604800) {
      lifecycleState = "DELETED";
    }
  }
  return {
    ...b,
    lifecycleState,
    model: "Virtual retention and seven-day deletion grace; no physical log storage.",
  };
};
const findBucket = (
  world: import("@/engine/domains/world").World,
  projectId: string,
  name: string,
  location: string,
): ObserveBucket | undefined =>
  world.observabilityLab.buckets.find(
    (b) => b.projectId === projectId && b.name === name && b.location === location,
  ) ??
  (location === "global" && ["_Required", "_Default"].includes(name)
    ? builtin(projectId, name)
    : undefined);

const bucketPermission = (action: string): string => {
  if (action === "describe") {
    return "get";
  }
  if (action === "undelete") {
    return "update";
  }
  return action;
};

export const ObserveBucketCommands = [
  command({
    path: ["gcloud", "logging", "buckets", "list"],
    api: "logging.googleapis.com",
    permissions: ["logging.buckets.list"],
    flags: [location],
    run: (ctx, args) => {
      const loc = text(args, "location");
      const custom = ctx.world.observabilityLab.buckets.filter(
        (b) => b.projectId === ctx.project.projectId && b.location === loc,
      );
      const system =
        loc === "global"
          ? ["_Required", "_Default"]
              .filter((name) => !custom.some((b) => b.name === name))
              .map((name) => builtin(ctx.project.projectId, name))
          : [];
      return Result.ok({
        world: ctx.world,
        output: CommandOutput.yamlList(
          [...custom, ...system].map((b) => bucketRecord(b, ctx.world.observabilityLab.clock)),
        ),
      });
    },
  }),
  ...(["create", "describe", "update", "delete", "undelete"] as const).map((action) =>
    command({
      path: ["gcloud", "logging", "buckets", action],
      api: "logging.googleapis.com",
      permissions: [`logging.buckets.${bucketPermission(action)}`],
      named: true,
      destructive: action === "delete",
      flags: [
        location,
        ...(["create", "update"].includes(action)
          ? [
              Flag.integer("retention-days", "Retention, 1 to 3650 days."),
              Flag.boolean("enable-analytics", "Upgrade to Observability Analytics; irreversible."),
              ...(action === "update"
                ? [Flag.boolean("locked", "Irreversible retention lock.")]
                : []),
            ]
          : []),
      ],
      run: (ctx, args) => {
        const previous = findBucket(
          ctx.world,
          ctx.project.projectId,
          name(args),
          text(args, "location"),
        );
        if (action === "create") {
          if (previous || !/^[a-z][a-z0-9_-]{0,62}$/.test(name(args))) {
            return invalid("Use an unused user-defined bucket name.");
          }
          const item: ObserveBucket = {
            projectId: ctx.project.projectId,
            name: name(args),
            location: text(args, "location"),
            retentionDays: Option.unwrapOr(ParsedArgs.integer(args, "retention-days"), 30),
            locked: false,
            analyticsEnabled: ParsedArgs.boolean(args, "enable-analytics"),
            deleteRequestedAt: -1,
          };
          return save(
            ctx.world,
            { buckets: [...ctx.world.observabilityLab.buckets, item] },
            bucketRecord(item, ctx.world.observabilityLab.clock),
          );
        }
        if (!previous) {
          return missing("Log bucket not found in this project/location.");
        }
        if (action === "describe") {
          return finish(ctx.world, bucketRecord(previous, ctx.world.observabilityLab.clock));
        }
        if (
          previous.name === "_Required" &&
          (action !== "update" ||
            ParsedArgs.has(args, "retention-days") ||
            ParsedArgs.has(args, "locked"))
        ) {
          return invalid(
            "_Required retention is fixed at 400 days; only Analytics upgrade is supported.",
          );
        }
        const clock = ctx.world.observabilityLab.clock;
        if (action === "undelete") {
          if (previous.deleteRequestedAt < 0 || clock - previous.deleteRequestedAt >= 604800) {
            return invalid("Undelete requires an outstanding request within seven virtual days.");
          }
        }
        if (action === "delete") {
          if (
            previous.name === "_Default" ||
            (previous.locked &&
              storedLogs(ctx.world, previous.projectId, previous.location, previous.name).length >
                0) ||
            previous.deleteRequestedAt >= 0 ||
            ctx.world.observabilityLab.links.some(
              (l) =>
                l.projectId === previous.projectId &&
                l.bucket === previous.name &&
                l.location === previous.location,
            )
          ) {
            return invalid(
              "Built-in, linked, pending buckets and locked buckets with unexpired logs cannot be deleted.",
            );
          }
        }
        if (action === "update") {
          if (
            !["retention-days", "locked", "enable-analytics"].some((flag) =>
              ParsedArgs.has(args, flag),
            )
          ) {
            return invalid("Supply a supported bucket update flag.");
          }
          if (
            previous.locked &&
            previous.name !== "_Required" &&
            ParsedArgs.boolean(args, "enable-analytics") &&
            !previous.analyticsEnabled
          ) {
            return invalid("Upgrade Analytics before locking this bucket.");
          }
          if (previous.deleteRequestedAt >= 0) {
            return invalid("Undelete the bucket before updating it.");
          }
          if (
            (previous.locked && ParsedArgs.integer(args, "retention-days").some) ||
            (previous.locked &&
              ParsedArgs.booleanChoice(args, "locked").some &&
              !ParsedArgs.boolean(args, "locked")) ||
            (previous.analyticsEnabled &&
              ParsedArgs.booleanChoice(args, "enable-analytics").some &&
              !ParsedArgs.boolean(args, "enable-analytics"))
          ) {
            return invalid(
              "Retention lock and Analytics upgrades are irreversible; locked retention cannot change.",
            );
          }
        }
        const updated = {
          ...previous,
          retentionDays: Option.unwrapOr(
            ParsedArgs.integer(args, "retention-days"),
            previous.retentionDays,
          ),
          locked: previous.locked || ParsedArgs.boolean(args, "locked"),
          analyticsEnabled:
            previous.analyticsEnabled || ParsedArgs.boolean(args, "enable-analytics"),
          deleteRequestedAt: previous.deleteRequestedAt,
        };
        if (action === "delete") {
          updated.deleteRequestedAt = clock;
        }
        if (action === "undelete") {
          updated.deleteRequestedAt = -1;
        }
        return save(
          ctx.world,
          {
            buckets: [
              ...ctx.world.observabilityLab.buckets.filter(
                (b) => !(same(b, previous) && b.location === previous.location),
              ),
              updated,
            ],
          },
          bucketRecord(updated, ctx.world.observabilityLab.clock),
        );
      },
    }),
  ),
  ...(["create", "describe", "update", "delete", "list"] as const).map((action) =>
    command({
      path: ["gcloud", "logging", "views", action],
      api: "logging.googleapis.com",
      permissions: [`logging.views.${action === "describe" ? "get" : action}`],
      named: action !== "list",
      destructive: action === "delete",
      flags: [
        location,
        sf("bucket", true),
        ...(["create", "update"].includes(action) ? [sf("log-filter", action === "create")] : []),
      ],
      run: (ctx, args) => {
        const bucket = findBucket(
          ctx.world,
          ctx.project.projectId,
          text(args, "bucket"),
          text(args, "location"),
        );
        if (!bucket || bucket.deleteRequestedAt >= 0) {
          return missing("Use an active bucket in the selected project/location.");
        }
        const refs = ctx.world.observabilityLab.views.filter(
          (v) =>
            v.projectId === ctx.project.projectId &&
            v.bucket === bucket.name &&
            v.location === bucket.location,
        );
        if (action === "list") {
          return Result.ok({
            world: ctx.world,
            output: CommandOutput.yamlList(refs.map((v) => ({ ...v, readers: [...v.readers] }))),
          });
        }
        const previous = refs.find((v) => v.name === name(args));
        if (action !== "create" && !previous) {
          return missing("View not found in this bucket/location.");
        }
        if (action === "describe" && previous) {
          return finish(ctx.world, { ...previous, readers: [...previous.readers] });
        }
        if (action === "delete" && previous) {
          return save(
            ctx.world,
            { views: ctx.world.observabilityLab.views.filter((v) => v !== previous) },
            { deleted: previous.name },
          );
        }
        if (action === "create" && previous) {
          return invalid("View already exists.");
        }
        const filter = text(args, "log-filter", previous?.filter ?? "");
        const parsed = parseViewFilter(filter, ctx.project.projectId);
        if (!Result.isOk(parsed)) {
          return parsed;
        }
        const item: LogView = {
          projectId: ctx.project.projectId,
          name: name(args),
          bucket: bucket.name,
          location: bucket.location,
          filter,
          readers: previous?.readers ?? [],
        };
        return save(
          ctx.world,
          {
            buckets: [
              ...ctx.world.observabilityLab.buckets.filter(
                (b) => !(same(b, bucket) && b.location === bucket.location),
              ),
              bucket,
            ],
            views: [...ctx.world.observabilityLab.views.filter((v) => v !== previous), item],
          },
          {
            ...item,
            readers: [...item.readers],
            filterLimitation:
              "Bounded source(), log_id(), resource.type equality and AND/OR/NOT; no payload or severity filters.",
          },
        );
      },
    }),
  ),
  command({
    path: ["sim", "logging", "views", "grant-reader"],
    api: "logging.googleapis.com",
    permissions: ["logging.views.setIamPolicy"],
    named: true,
    flags: [location, sf("bucket", true), sf("member", true)],
    run: (ctx, args) => {
      const view = ctx.world.observabilityLab.views.find(
        (v) =>
          v.projectId === ctx.project.projectId &&
          v.name === name(args) &&
          v.bucket === text(args, "bucket") &&
          v.location === text(args, "location"),
      );
      const member = IamMember.parse(text(args, "member"));
      if (!view || !Result.isOk(member)) {
        return invalid("Use an existing view and a supported user/group/serviceAccount member.");
      }
      const updated = { ...view, readers: [...new Set([...view.readers, member.value])] };
      return save(
        ctx.world,
        { views: ctx.world.observabilityLab.views.map((v) => (v === view ? updated : v)) },
        { name: view.name, member: member.value, scope: "This view only", simulated: true },
      );
    },
  }),
  command({
    path: ["sim", "logging", "views", "read"],
    api: "logging.googleapis.com",
    permissions: [],
    named: true,
    flags: [location, sf("bucket", true)],
    run: (ctx, args) => {
      const view = ctx.world.observabilityLab.views.find(
        (v) =>
          v.projectId === ctx.project.projectId &&
          v.name === name(args) &&
          v.bucket === text(args, "bucket") &&
          v.location === text(args, "location"),
      );
      if (!view || !canReadView(ctx.world, Principal.toMember(ctx.principal), view)) {
        return invalid("Logging view access is missing for this identity.");
      }
      const parsed = parseViewFilter(view.filter, view.projectId);
      if (!parsed.ok) {
        return parsed;
      }
      const logs = storedLogs(ctx.world, view.projectId, view.location, view.bucket).filter((l) =>
        LogFilter.matches(parsed.value, observeLogRecord(l)),
      );
      return Result.ok({
        world: ctx.world,
        output: CommandOutput.yamlList(logs.map(observeLogRecord)),
      });
    },
  }),
];
