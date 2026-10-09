import { type CommandResult, Flag } from "@/engine/cli/command-spec";
import { labCandidates } from "@/engine/commands/serverless-lab/shared";
import { Candidates } from "@/engine/commands/shared";
import { cacheOf, cacheOperation, saveCache } from "@/engine/domains/managed-databases/cache";
import { documentValue, patch } from "@/engine/domains/managed-databases/model";
import { allows, invoke } from "@/engine/domains/serverless-lab/runtime";
import { command, finish, integer, invalid, missing, name, observed, sf, text } from "./shared";

const cacheCommands = (["set", "get", "delete", "increment"] as const).map((operation) =>
  command(
    ["sim", "redis", "cache", operation],
    "redis.googleapis.com",
    "redis.instances.get",
    (ctx, args) => {
      const redis = ctx.world.serverlessLab.redis.find(
        (r) =>
          r.projectId === ctx.project.projectId &&
          r.name === text(args, "instance") &&
          r.region === text(args, "region"),
      );
      if (!redis) {
        return missing("Redis instance does not exist in this project/region.");
      }
      if (
        redis.network !== text(args, "network") ||
        !ctx.world.networks.some((n) => n.projectId === redis.projectId && n.name === redis.network)
      ) {
        return invalid("Cache connection requires the instance's authorized VPC network.");
      }
      if (operation === "set" && !args.flags.value) {
        return invalid("SET requires --value.");
      }
      const result = cacheOperation(
        ctx.world,
        redis,
        operation,
        name(args),
        text(args, "value"),
        integer(args, "ttl", 0),
      );
      return result.ok ? finish(result.value.world, result.value.record) : invalid(result.error);
    },
    [
      sf("instance", true, labCandidates("redis")),
      sf("region", true, Candidates.regions),
      sf("network", true, Candidates.networks),
      ...(operation === "set"
        ? [
            sf("value", true),
            Flag.integer("ttl", "Expiration in virtual seconds (0 means no expiry)."),
          ]
        : []),
    ],
    true,
    undefined,
    operation === "delete",
  ),
);
const failover = command(
  ["gcloud", "redis", "instances", "failover"],
  "redis.googleapis.com",
  "redis.instances.update",
  (ctx, args) => {
    const r = ctx.world.serverlessLab.redis.find(
      (r) =>
        r.projectId === ctx.project.projectId &&
        r.name === name(args) &&
        r.region === text(args, "region"),
    );
    if (!r) {
      return missing("Redis instance does not exist in this region.");
    }
    const c = cacheOf(ctx.world, r);
    if (c.tier !== "STANDARD_HA") {
      return invalid("Failover requires STANDARD_HA. Tier is selected at creation.");
    }
    return finish(saveCache(ctx.world, { ...c, failovers: c.failovers + 1 }), {
      host: r.host,
      tier: c.tier,
      failovers: c.failovers + 1,
      cacheDurability:
        "This deterministic exercise keeps keys; a cache is not a durable database or backup.",
    });
  },
  [sf("region", true, Candidates.regions)],
  true,
  labCandidates("redis"),
);
const time = command(
  ["sim", "databases", "time", "advance"],
  "redis.googleapis.com",
  "redis.instances.get",
  (ctx, args) => {
    const seconds = integer(args, "seconds", 0);
    if (
      !Number.isSafeInteger(seconds) ||
      seconds < 1 ||
      seconds > 86400 ||
      ctx.world.managedDatabases.clock + seconds > 3153600000
    ) {
      return invalid("Advance by 1–86400 virtual seconds.");
    }
    const clock = ctx.world.managedDatabases.clock + seconds;
    return finish(patch(ctx.world, { clock }), {
      clock,
      scope: "Shared virtual lesson clock; wall time does not expire cache keys.",
    });
  },
  [Flag.integer("seconds", "Virtual seconds.", { required: true })],
  false,
);

const functionCommands = (["read", "increment-cache"] as const).map((operation) =>
  command(
    ["sim", "functions", "database", operation],
    "cloudfunctions.googleapis.com",
    "cloudfunctions.functions.get",
    (ctx, args): CommandResult => {
      const d = ctx.world.serverlessLab.deployments.find(
        (d) =>
          d.projectId === ctx.project.projectId &&
          d.region === text(args, "region") &&
          d.kind === "function" &&
          d.name === name(args),
      );
      if (!d) {
        return missing("Configured function does not exist in this region.");
      }
      const invoked = invoke(ctx.world, d, ctx.principal, "external");
      if (invoked.invocation.status !== "SUCCEEDED") {
        return invalid(invoked.invocation.reason);
      }
      const served = d.revisions.find((r) => r.name === invoked.invocation.revision);
      if (!served) {
        return invalid("Serving revision is missing.");
      }
      const config = served.config;
      if (operation === "read") {
        if (
          !config.env.FIRESTORE_DATABASE ||
          !allows(ctx.world, d.projectId, config.serviceAccount, "datastore.entities.get")
        ) {
          return invalid("Set FIRESTORE_DATABASE and grant runtime SA datastore.entities.get.");
        }
        const doc = ctx.world.serverlessLab.documents.find(
          (doc) =>
            doc.projectId === d.projectId &&
            doc.database === config.env.FIRESTORE_DATABASE &&
            doc.path === text(args, "document"),
        );
        if (!doc) {
          return missing("Document does not exist in the function's configured database.");
        }
        const value = documentValue(doc.data);
        if (!value.ok) {
          return invalid(value.error);
        }
        return observed(invoked.world, ctx, "firestore", doc.database, `function:${d.name}`, {
          path: doc.path,
          data: doc.data,
          runtimeServiceAccount: config.serviceAccount,
          function: d.name,
        });
      }
      const redis = ctx.world.serverlessLab.redis.find(
        (r) =>
          r.projectId === d.projectId &&
          r.region === d.region &&
          r.name === config.env.REDIS_INSTANCE,
      );
      if (!redis) {
        return missing("Set REDIS_INSTANCE on the function.");
      }
      const result = cacheOperation(invoked.world, redis, "increment", text(args, "key"));
      if (!result.ok) {
        return invalid(result.error);
      }
      return observed(
        result.value.world,
        ctx,
        "redis",
        `${redis.region}/${redis.name}`,
        `function:${d.name}`,
        { ...result.value.record, runtimeServiceAccount: config.serviceAccount, function: d.name },
      );
    },
    [
      sf("region", true, Candidates.regions),
      ...(operation === "read" ? [sf("document", true)] : [sf("key", true)]),
    ],
    true,
    labCandidates("deployments"),
  ),
);
export const RedisLessonCommands = [...cacheCommands, failover, time, ...functionCommands];
