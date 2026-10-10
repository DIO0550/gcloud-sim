import { papEnforced } from "@/engine/domains/admin-lab/policies";
import { StorageClass } from "@/engine/domains/catalog";
import type { IamPolicy } from "@/engine/domains/iam-policy";
import type { CryptoKey } from "@/engine/domains/serverless-lab/model";
import { allows } from "@/engine/domains/serverless-lab/runtime";
import { Bucket, type StorageObject } from "@/engine/domains/storage";
import type { World } from "@/engine/domains/world";
import { Decoder as D } from "@/utils/Decoder";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";
import { fileProfileValid } from "./files";

export type Protection = Readonly<{
  bucket: string;
  retention: number;
  locked: boolean;
  softDelete: number;
  defaultKey: string;
}>;
export type Version = Readonly<{
  bucket: string;
  name: string;
  generation: number;
  state: "LIVE" | "NONCURRENT" | "SOFT_DELETED";
  size: number;
  contentType: string;
  storageClass: string;
  created: string;
  updated: string;
  deleted: string;
  expires: string;
  kmsKey: string;
}>;
export type Signed = Readonly<{
  id: string;
  projectId: string;
  bucket: string;
  object: string;
  generation: number;
  signer: string;
  created: string;
  expires: string;
  verified: boolean;
  expired: boolean;
}>;
export type Transfer = Readonly<{
  projectId: string;
  name: string;
  source: string;
  destination: string;
  enabled: boolean;
  overwrite: "ALWAYS" | "DIFFERENT" | "NEVER";
  operation: "NONE" | "SUCCESS" | "FAILED";
  copied: number;
  bytes: number;
  error: string;
}>;
export type FileStorage = Readonly<{
  projectId: string;
  name: string;
  kind: "filestore" | "netapp-pool" | "netapp-volume" | "lustre";
  location: string;
  network: string;
  capacity: number;
  tier: string;
  protocol: string;
  share: string;
  pool: string;
}>;
export type StorageDecision = Readonly<{
  projectId: string;
  name: string;
  workload: string;
  service: string;
  protection: string;
}>;
export type StorageLab = Readonly<{
  protections: readonly Protection[];
  versions: readonly Version[];
  signed: readonly Signed[];
  transfers: readonly Transfer[];
  files: readonly FileStorage[];
  decisions: readonly StorageDecision[];
  nextGeneration: number;
}>;
export const emptyStorageLab = (): StorageLab => ({
  protections: [],
  versions: [],
  signed: [],
  transfers: [],
  files: [],
  decisions: [],
  nextGeneration: 1,
});
export const patchStorage = (world: World, change: Partial<StorageLab>): World => ({
  ...world,
  storageLab: { ...world.storageLab, ...change },
});
export const protectionFor = (world: World, bucket: string): Protection =>
  world.storageLab.protections.find((p) => p.bucket === bucket) ?? {
    bucket,
    retention: 0,
    locked: false,
    softDelete: 604800,
    defaultKey: "",
  };
export const keyPath = (key: CryptoKey): string =>
  `projects/${key.projectId}/locations/${key.region}/keyRings/${key.ring}/cryptoKeys/${key.name}`;
export const storageAgent = (world: World, projectId: string): string =>
  `service-${world.projects.find((p) => p.projectId === projectId)?.projectNumber}@gs-project-accounts.iam.gserviceaccount.com`;
export const transferAgent = (world: World, projectId: string): string =>
  `project-${world.projects.find((p) => p.projectId === projectId)?.projectNumber}@storage-transfer-service.iam.gserviceaccount.com`;
export const storageAllows = (
  world: World,
  bucket: Bucket,
  principal: string,
  permission: string,
): boolean => {
  if (!papEnforced(world, bucket)) {
    return allows(world, bucket.projectId, principal, permission, bucket.iamPolicy);
  }
  const privatePolicy = (policy: IamPolicy): IamPolicy => ({
    bindings: policy.bindings
      .map((binding) => ({
        ...binding,
        members: binding.members.filter((m) => m !== "allUsers" && m !== "allAuthenticatedUsers"),
      }))
      .filter((binding) => binding.members.length > 0),
  });
  const secured = {
    ...world,
    organization: { ...world.organization, iamPolicy: privatePolicy(world.organization.iamPolicy) },
    folders: world.folders.map((f) => ({ ...f, iamPolicy: privatePolicy(f.iamPolicy) })),
    projects: world.projects.map((p) => ({ ...p, iamPolicy: privatePolicy(p.iamPolicy) })),
  };
  return allows(secured, bucket.projectId, principal, permission, privatePolicy(bucket.iamPolicy));
};
export const keyAccess = (
  world: World,
  bucket: Bucket,
  keyName: string,
  action: "Encrypt" | "Decrypt",
): Result<string, string> => {
  if (!keyName) {
    return Result.ok("");
  }
  const key = world.serverlessLab.keys.find((k) => keyPath(k) === keyName);
  if (!key?.enabled || key.region.toUpperCase() !== bucket.location) {
    return Result.err("CMEK must exist, be ENABLED and match the bucket location.");
  }
  if (
    !allows(
      world,
      key.projectId,
      storageAgent(world, bucket.projectId),
      `cloudkms.cryptoKeyVersions.useTo${action}`,
      key.policy,
    )
  ) {
    return Result.err(
      `Cloud Storage service agent lacks cloudkms.cryptoKeyVersions.useTo${action}.`,
    );
  }
  return Result.ok(keyName);
};
const replace = (world: World, bucket: Bucket): World => ({
  ...world,
  buckets: world.buckets.map((b) => (b.name === bucket.name ? bucket : b)),
});
const versionOf = (bucket: Bucket, object: StorageObject, generation: number): Version => ({
  bucket: bucket.name,
  name: object.name,
  generation,
  state: "LIVE",
  size: object.size,
  contentType: object.contentType,
  storageClass: object.storageClass.some ? object.storageClass.value : bucket.storageClass,
  created: object.created ?? object.updated,
  updated: object.updated,
  deleted: "",
  expires: "",
  kmsKey: object.kmsKey ?? "",
});
export const trackBucket = (world: World, name: string): World => {
  const bucket = world.buckets.find((b) => b.name === name);
  if (!bucket) {
    return world;
  }
  let next = world.storageLab.nextGeneration;
  const versions = [...world.storageLab.versions];
  const objects = bucket.objects.map((object) => {
    if (object.generation !== undefined) {
      return object;
    }
    const generation = next++;
    const source = world.dataProcessing.files.find(
      (f) => f.uri === `gs://${bucket.name}/${object.name}` && f.token === object.updated,
    );
    const updated = {
      ...object,
      updated: object.updated.split("#")[0] ?? object.updated,
      contentType: source ? `${object.contentType};sim-token=${source.token}` : object.contentType,
      generation,
      created: object.updated.split("#")[0] ?? object.updated,
      kmsKey: "",
      storageClass: object.storageClass.some
        ? object.storageClass
        : Option.some(bucket.storageClass),
    };
    versions.push(versionOf(bucket, updated, generation));
    return updated;
  });
  return patchStorage(replace(world, { ...bucket, objects }), { versions, nextGeneration: next });
};
export const retentionAllows = (
  world: World,
  bucket: string,
  created: string,
  now: string,
): boolean => {
  const seconds = protectionFor(world, bucket).retention;
  if (seconds === 0) {
    return true;
  }
  return Date.parse(now) >= Date.parse(created) + seconds * 1000;
};
const retired = (world: World, v: Version, now: string): Version | undefined => {
  const seconds = protectionFor(world, v.bucket).softDelete;
  if (seconds === 0) {
    return undefined;
  }
  return {
    ...v,
    state: "SOFT_DELETED",
    deleted: now,
    expires: new Date(Date.parse(now) + seconds * 1000).toISOString(),
  };
};
export const putObject = (
  initial: World,
  bucketName: string,
  object: StorageObject,
  now: string,
  explicitKey?: string,
  expectedGeneration?: number,
): Result<World, string> => {
  const world = trackBucket(initial, bucketName);
  const bucket = world.buckets.find((b) => b.name === bucketName);
  if (!bucket) {
    return Result.err("Destination bucket does not exist.");
  }
  const previous = world.storageLab.versions.find(
    (v) => v.bucket === bucketName && v.name === object.name && v.state === "LIVE",
  );
  if (expectedGeneration !== undefined && (previous?.generation ?? 0) !== expectedGeneration) {
    return Result.err("Generation precondition failed.");
  }
  if (previous && !retentionAllows(world, bucketName, previous.created, now)) {
    return Result.err("Object retention prevents replacement.");
  }
  const key = keyAccess(
    world,
    bucket,
    explicitKey ?? protectionFor(world, bucketName).defaultKey,
    "Encrypt",
  );
  if (!key.ok) {
    return key;
  }
  const generation = world.storageLab.nextGeneration;
  const stored = {
    ...object,
    generation,
    created: now,
    updated: now,
    kmsKey: key.value,
    storageClass: object.storageClass.some ? object.storageClass : Option.some(bucket.storageClass),
  };
  const versions = world.storageLab.versions.flatMap((v) => {
    if (v !== previous) {
      return [v];
    }
    if (bucket.versioning) {
      return [{ ...v, state: "NONCURRENT" as const }];
    }
    const deleted = retired(world, v, now);
    return deleted ? [deleted] : [];
  });
  return Result.ok(
    patchStorage(replace(world, Bucket.withObject(bucket, stored)), {
      versions: [...versions, versionOf(bucket, stored, generation)],
      nextGeneration: generation + 1,
    }),
  );
};
export const deleteObject = (
  initial: World,
  bucketName: string,
  name: string,
  now: string,
  generation?: number,
): Result<World, string> => {
  const world = trackBucket(initial, bucketName);
  const bucket = world.buckets.find((b) => b.name === bucketName);
  const version = world.storageLab.versions.find(
    (v) =>
      v.bucket === bucketName &&
      v.name === name &&
      (generation === undefined ? v.state === "LIVE" : v.generation === generation),
  );
  if (!bucket || !version || version.state === "SOFT_DELETED") {
    return Result.err("Active or noncurrent object generation not found.");
  }
  if (!retentionAllows(world, bucketName, version.created, now)) {
    return Result.err("Object retention prevents deletion.");
  }
  const preserve = version.state === "LIVE" && generation === undefined && bucket.versioning;
  const removed = preserve
    ? { ...version, state: "NONCURRENT" as const }
    : retired(world, version, now);
  const versions = world.storageLab.versions.flatMap((v) => {
    if (v !== version) {
      return [v];
    }
    return removed ? [removed] : [];
  });
  const updated = version.state === "LIVE" ? Bucket.withoutObject(bucket, name) : bucket;
  return Result.ok(patchStorage(replace(world, updated), { versions }));
};
export const bucketRecord = (world: World, bucket: Bucket) => {
  const p = protectionFor(world, bucket.name);
  return {
    ...Bucket.toRecord(bucket),
    retentionPolicy: { retentionPeriod: p.retention, isLocked: p.locked },
    softDeletePolicy: { retentionDurationSeconds: p.softDelete },
    encryption: { defaultKmsKeyName: p.defaultKey },
  };
};
export const validateStorageLab = (world: World): Result<World, string> => {
  const l = world.storageLab;
  const error = (message: string): Result<World, string> => Result.err(`Storage: ${message}`);
  if (
    !Number.isSafeInteger(l.nextGeneration) ||
    l.nextGeneration < 1 ||
    l.versions.some(
      (v) =>
        v.generation >= l.nextGeneration || !Number.isSafeInteger(v.generation) || v.generation < 1,
    )
  ) {
    return error("invalid generation counter.");
  }
  for (const p of l.protections) {
    const b = world.buckets.find((b) => b.name === p.bucket);
    if (
      !b ||
      !Number.isInteger(p.retention) ||
      p.retention < 0 ||
      p.retention >= 3155760000 ||
      (p.locked && p.retention === 0) ||
      !Number.isInteger(p.softDelete) ||
      (p.softDelete !== 0 && (p.softDelete < 604800 || p.softDelete >= 7776000)) ||
      (p.defaultKey &&
        !world.serverlessLab.keys.some(
          (k) => keyPath(k) === p.defaultKey && k.region.toUpperCase() === b.location,
        ))
    ) {
      return error("invalid bucket protection or CMEK reference.");
    }
  }
  const versionIds = l.versions.map((v) => `${v.bucket}/${v.name}#${v.generation}`);
  if (
    new Set(versionIds).size !== versionIds.length ||
    new Set(l.protections.map((p) => p.bucket)).size !== l.protections.length
  ) {
    return error("duplicate generation or protection.");
  }
  for (const v of l.versions) {
    const b = world.buckets.find((b) => b.name === v.bucket);
    if (
      !b ||
      !v.name ||
      !StorageClass.parse(v.storageClass).some ||
      !Number.isSafeInteger(v.size) ||
      v.size < 0 ||
      !Number.isFinite(Date.parse(v.created)) ||
      !Number.isFinite(Date.parse(v.updated)) ||
      (v.state === "SOFT_DELETED" &&
        (!Number.isFinite(Date.parse(v.deleted)) ||
          !Number.isFinite(Date.parse(v.expires)) ||
          Date.parse(v.expires) <= Date.parse(v.deleted))) ||
      (v.kmsKey &&
        !world.serverlessLab.keys.some(
          (k) => keyPath(k) === v.kmsKey && k.region.toUpperCase() === b.location,
        ))
    ) {
      return error("invalid object generation.");
    }
    if (
      v.state === "LIVE" &&
      !b.objects.some(
        (o) =>
          o.name === v.name &&
          o.generation === v.generation &&
          o.size === v.size &&
          o.contentType === v.contentType &&
          o.updated === v.updated &&
          o.created === v.created &&
          (o.kmsKey ?? "") === v.kmsKey &&
          (!o.storageClass.some || o.storageClass.value === v.storageClass),
      )
    ) {
      return error("live generation does not match bucket objects.");
    }
  }
  const live = l.versions.filter((v) => v.state === "LIVE").map((v) => `${v.bucket}/${v.name}`);
  if (new Set(live).size !== live.length) {
    return error("multiple live generations.");
  }
  for (const b of world.buckets) {
    if (
      b.objects.some(
        (o) =>
          o.generation !== undefined &&
          !l.versions.some(
            (v) =>
              v.bucket === b.name &&
              v.name === o.name &&
              v.generation === o.generation &&
              v.state === "LIVE",
          ),
      )
    ) {
      return error("object has no matching live generation.");
    }
  }
  for (const t of l.transfers) {
    if (
      !/^transferJobs\/[A-Za-z0-9_-]{1,64}$/.test(t.name) ||
      t.source === t.destination ||
      !world.buckets.some((b) => b.name === t.source) ||
      !world.buckets.some((b) => b.name === t.destination) ||
      !world.projects.some((p) => p.projectId === t.projectId) ||
      !Number.isInteger(t.copied) ||
      t.copied < 0 ||
      !Number.isSafeInteger(t.bytes) ||
      t.bytes < 0
    ) {
      return error("invalid transfer configuration or counters.");
    }
  }
  for (const f of l.files) {
    if (
      !world.networks.some((n) => n.projectId === f.projectId && n.name === f.network) ||
      !fileProfileValid(f) ||
      !Number.isInteger(f.capacity) ||
      f.capacity < 1 ||
      (f.kind === "netapp-volume" &&
        !l.files.some(
          (p) =>
            p.kind === "netapp-pool" &&
            p.projectId === f.projectId &&
            p.location === f.location &&
            p.name === f.pool &&
            p.network === f.network &&
            p.capacity >= f.capacity,
        ))
    ) {
      return error("invalid file storage configuration.");
    }
  }
  for (const pool of l.files.filter((f) => f.kind === "netapp-pool")) {
    const total = l.files
      .filter(
        (f) =>
          f.kind === "netapp-volume" &&
          f.projectId === pool.projectId &&
          f.location === pool.location &&
          f.pool === pool.name,
      )
      .reduce((sum, f) => sum + f.capacity, 0);
    if (total > pool.capacity) {
      return error("NetApp volumes exceed pool capacity.");
    }
  }
  const scoped = l.files.map((f) => `${f.kind}/${f.projectId}/${f.location}/${f.name}`);
  if (
    new Set(scoped).size !== scoped.length ||
    new Set(l.transfers.map((t) => t.name)).size !== l.transfers.length ||
    new Set(l.signed.map((s) => s.id)).size !== l.signed.length
  ) {
    return error("duplicate scoped resource.");
  }
  if (l.signed.length > 100) {
    return error("signed URL metadata is limited to 100 records.");
  }
  for (const s of l.signed) {
    if (
      !world.projects.some((p) => p.projectId === s.projectId) ||
      !Number.isFinite(Date.parse(s.created)) ||
      !Number.isFinite(Date.parse(s.expires)) ||
      !world.buckets.some((b) => b.name === s.bucket && b.projectId === s.projectId) ||
      !s.object ||
      !Number.isSafeInteger(s.generation) ||
      s.generation < 1 ||
      Date.parse(s.expires) <= Date.parse(s.created) ||
      Date.parse(s.expires) > Date.parse(s.created) + 43200000 ||
      !s.signer.endsWith(".gserviceaccount.com")
    ) {
      return error("invalid signed URL metadata.");
    }
  }
  return Result.ok(world);
};

const str = D.string;
export const storageLabDecoder = D.object<StorageLab>({
  protections: D.array(
    D.object<Protection>({
      bucket: str,
      retention: D.number,
      locked: D.boolean,
      softDelete: D.number,
      defaultKey: str,
    }),
  ),
  versions: D.array(
    D.object<Version>({
      bucket: str,
      name: str,
      generation: D.number,
      state: D.literal(["LIVE", "NONCURRENT", "SOFT_DELETED"]),
      size: D.number,
      contentType: str,
      storageClass: str,
      created: str,
      updated: str,
      deleted: str,
      expires: str,
      kmsKey: str,
    }),
  ),
  signed: D.array(
    D.object<Signed>({
      id: str,
      projectId: str,
      bucket: str,
      object: str,
      generation: D.number,
      signer: str,
      created: str,
      expires: str,
      verified: D.boolean,
      expired: D.boolean,
    }),
  ),
  transfers: D.array(
    D.object<Transfer>({
      projectId: str,
      name: str,
      source: str,
      destination: str,
      enabled: D.boolean,
      overwrite: D.literal(["ALWAYS", "DIFFERENT", "NEVER"]),
      operation: D.literal(["NONE", "SUCCESS", "FAILED"]),
      copied: D.number,
      bytes: D.number,
      error: str,
    }),
  ),
  files: D.array(
    D.object<FileStorage>({
      projectId: str,
      name: str,
      kind: D.literal(["filestore", "netapp-pool", "netapp-volume", "lustre"]),
      location: str,
      network: str,
      capacity: D.number,
      tier: str,
      protocol: str,
      share: str,
      pool: str,
    }),
  ),
  decisions: D.array(
    D.object<StorageDecision>({
      projectId: str,
      name: str,
      workload: str,
      service: str,
      protection: str,
    }),
  ),
  nextGeneration: D.number,
});
