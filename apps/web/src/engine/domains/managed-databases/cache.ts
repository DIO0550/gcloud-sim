import type { Redis } from "@/engine/domains/serverless-lab/model";
import type { World } from "@/engine/domains/world";
import type { JsonRecord } from "@/types/Json";
import { Result } from "@/utils/Result";
import { type Cache, observe, patch, same, validKey } from "./model";

export const cacheOf = (world: World, redis: Redis): Cache =>
  world.managedDatabases.caches.find((c) => same(c, redis) && c.region === redis.region) ?? {
    projectId: redis.projectId,
    name: redis.name,
    region: redis.region,
    tier: "BASIC",
    failovers: 0,
    entries: [],
  };
export const saveCache = (world: World, cache: Cache): World =>
  patch(world, {
    caches: [
      ...world.managedDatabases.caches.filter(
        (c) => !(same(c, cache) && c.region === cache.region),
      ),
      cache,
    ],
  });
export const cacheOperation = (
  world: World,
  redis: Redis,
  operation: "set" | "get" | "delete" | "increment",
  key: string,
  value = "",
  ttl = 0,
): Result<{ world: World; record: JsonRecord }, string> => {
  if (
    !validKey(key) ||
    value.length > 4096 ||
    !Number.isSafeInteger(ttl) ||
    ttl < 0 ||
    ttl > 86400
  ) {
    return Result.err("Cache key/value or TTL is invalid (TTL 0–86400 seconds).");
  }
  const c = cacheOf(world, redis);
  const live = c.entries.filter(
    (e) => e.expiresAt === 0 || e.expiresAt > world.managedDatabases.clock,
  );
  const old = live.find((e) => e.key === key);
  let entries = live;
  let result: string | null = old?.value ?? null;
  if (operation === "set") {
    result = value;
    entries = [
      ...live.filter((e) => e.key !== key),
      { key, value, expiresAt: ttl === 0 ? 0 : world.managedDatabases.clock + ttl },
    ];
  }
  if (operation === "increment") {
    const previous = old?.value ?? "0";
    if (!/^-?\d+$/.test(previous) || !Number.isSafeInteger(Number(previous) + 1)) {
      return Result.err("INCR requires an integer string without overflow.");
    }
    result = String(Number(previous) + 1);
    entries = [
      ...live.filter((e) => e.key !== key),
      { key, value: result, expiresAt: old?.expiresAt ?? 0 },
    ];
  }
  if (operation === "delete") {
    entries = live.filter((e) => e.key !== key);
    result = null;
  }
  if (entries.length > 200) {
    return Result.err("Cache lesson supports at most 200 keys; no capacity/eviction simulation.");
  }
  const record = {
    key,
    value: result,
    hit: old !== undefined,
    operation,
    clock: world.managedDatabases.clock,
    instance: redis.name,
  };
  const updated = saveCache(world, { ...c, entries });
  return Result.ok({
    world: observe(updated, {
      projectId: redis.projectId,
      service: "redis",
      resource: `${redis.region}/${redis.name}`,
      operation,
      result: JSON.stringify(record),
    }),
    record,
  });
};
