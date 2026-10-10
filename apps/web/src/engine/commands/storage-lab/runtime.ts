import { CommandFailure } from "@/engine/cli/command-failure";
import {
  type AuthorizedContext,
  CommandOutput,
  type CommandResult,
  ParsedArgs,
} from "@/engine/cli/command-spec";
import { StorageClass } from "@/engine/domains/catalog";
import { type Bucket, GsUrl, type StorageObject } from "@/engine/domains/storage";
import {
  keyPath,
  patchStorage,
  protectionFor,
  storageAllows,
  type Version,
  validateStorageLab,
} from "@/engine/domains/storage-lab/model";
import type { World } from "@/engine/domains/world";
import type { JsonRecord } from "@/types/Json";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

export const storagePermission = (
  ctx: AuthorizedContext,
  bucket: Bucket,
  permission: string,
  principal: string = ctx.principal,
): Result<Bucket, CommandFailure> => {
  if (!storageAllows(ctx.world, bucket, principal, permission)) {
    return Result.err(
      CommandFailure.permissionDenied({
        permission,
        target: { type: "bucket", id: bucket.name },
        rolesIncluding: ["roles/storage.objectAdmin"],
      }),
    );
  }
  return Result.ok(bucket);
};
export const storageNow = (ctx: { now: string; world: World }): string =>
  new Date(Date.parse(ctx.now) + ctx.world.dataProcessing.clock * 1000).toISOString();
export const storageUrl = (url: string) =>
  Result.mapErr(
    Result.map(GsUrl.parse(url), (u) => {
      const match = /^(.*)#([1-9]\d*)$/.exec(u.object);
      return {
        ...u,
        object: match?.[1] ?? u.object,
        generation: match ? Number(match[2]) : undefined,
      };
    }),
    (m) => CommandFailure.invalidValue("URL", m),
  );
export const duration = (text: string): Result<number, string> => {
  if (text === "0") {
    return Result.ok(0);
  }
  const match = /^(\d+)([smhd])$/.exec(text);
  const units: Readonly<Record<string, number>> = { s: 1, m: 60, h: 3600, d: 86400 };
  const seconds = match ? Number(match[1]) * (units[match[2] ?? ""] ?? 0) : -1;
  if (!Number.isSafeInteger(seconds) || seconds < 1) {
    return Result.err("Expected positive duration such as 1h, 7d, or 0 to disable where allowed.");
  }
  return Result.ok(seconds);
};
export const protectionOptions = (
  world: World,
  bucket: Bucket,
  args: ParsedArgs,
): Result<World, string> => {
  const old = protectionFor(world, bucket.name);
  const retention = ParsedArgs.string(args, "retention-period");
  const soft = ParsedArgs.string(args, "soft-delete-duration");
  if (retention.some && ParsedArgs.boolean(args, "clear-retention-period")) {
    return Result.err("Choose either retention-period or clear-retention-period.");
  }
  const nextRetention = retention.some ? duration(retention.value) : Result.ok(old.retention);
  const nextSoft = soft.some ? duration(soft.value) : Result.ok(old.softDelete);
  if (!nextRetention.ok) {
    return nextRetention;
  }
  if (!nextSoft.ok) {
    return nextSoft;
  }
  const seconds = ParsedArgs.boolean(args, "clear-retention-period") ? 0 : nextRetention.value;
  if (old.locked && seconds < old.retention) {
    return Result.err("Locked retention cannot be shortened or removed.");
  }
  const key = Option.unwrapOr(ParsedArgs.string(args, "default-encryption-key"), old.defaultKey);
  if (
    key &&
    !world.serverlessLab.keys.some(
      (k) => keyPath(k) === key && k.region.toUpperCase() === bucket.location,
    )
  ) {
    return Result.err("Default CMEK must exist in the same bucket location.");
  }
  const p = {
    ...old,
    retention: seconds,
    softDelete: nextSoft.value,
    defaultKey: key,
    locked: old.locked || ParsedArgs.boolean(args, "lock-retention-period"),
  };
  return validateStorageLab(
    patchStorage(world, {
      protections: [...world.storageLab.protections.filter((p) => p.bucket !== bucket.name), p],
    }),
  );
};
export const versionObject = (v: Version): StorageObject => ({
  name: v.name,
  generation: v.generation,
  size: v.size,
  contentType: v.contentType,
  created: v.created,
  updated: v.updated,
  kmsKey: v.kmsKey,
  storageClass: StorageClass.parse(v.storageClass),
});
export const storageFinish = (world: World, record: JsonRecord): CommandResult =>
  Result.map(Result.mapErr(validateStorageLab(world), CommandFailure.invalidState), (world) => ({
    world,
    output: CommandOutput.yaml(record),
  }));
