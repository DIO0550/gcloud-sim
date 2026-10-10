import { EffectivePermissions } from "@/engine/domains/effective-permissions";
import { Principal } from "@/engine/domains/principal";
import type { Bucket, StorageObject } from "@/engine/domains/storage";
import {
  deleteObject,
  keyAccess,
  protectionFor,
  putObject,
} from "@/engine/domains/storage-lab/model";
import type { TfChange } from "@/engine/domains/terraform";
import {
  TfBackend,
  type TfGcsBackend,
  type TfRemoteState,
  type TfStateData,
} from "@/engine/domains/terraform/backend";
import { TfResources } from "@/engine/domains/terraform/resources";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";

const fail = (message: string): never => {
  throw new Error(message);
};
const equal = TfResources.equal;
const findRemote = (world: World, config: TfGcsBackend): TfRemoteState | undefined =>
  world.terraform.backend.remotes.find((r) => TfBackend.key(r.config) === TfBackend.key(config));
const authorize = (world: World, config: TfGcsBackend, write: boolean): Bucket => {
  const bucket =
    world.buckets.find((b) => b.name === config.bucket) ??
    fail(`Backend bucket does not exist: ${config.bucket}. Create it before terraform init.`);
  if (!Option.isSome(World.findActiveProject(world, bucket.projectId)))
    fail(`Backend project not found: ${bucket.projectId}`);
  if (!World.hasApi(world, bucket.projectId, "storage.googleapis.com"))
    fail(`storage.googleapis.com is disabled in backend project ${bucket.projectId}.`);
  if (write && protectionFor(world, bucket.name).retention > 0) {
    fail("Backend retention policy prevents safe state replacement and lock deletion.");
  }
  for (const object of bucket.objects.filter((o) => o.name === TfBackend.path(config))) {
    const key = keyAccess(world, bucket, object.kmsKey ?? "", "Decrypt");
    if (!key.ok) {
      fail(key.error);
    }
  }
  const adc = world.session.adc;
  if (!Option.isSome(adc))
    return fail(
      "Application Default Credentials are missing. Run gcloud auth application-default login.",
    );
  const grants = EffectivePermissions.resolve(world, Principal.toMember(adc.value), {
    type: "bucket",
    id: bucket.name,
  });
  const permissions = [
    "storage.objects.get",
    "storage.objects.list",
    ...(write ? ["storage.objects.create", "storage.objects.delete"] : []),
  ];
  for (const permission of permissions)
    if (!EffectivePermissions.allows(grants, permission))
      fail(`Backend permission denied: ${permission} on gs://${bucket.name} for ADC ${adc.value}.`);
  return bucket;
};
const stateObject = (remote: TfRemoteState): StorageObject => ({
  name: TfBackend.path(remote.config),
  size: JSON.stringify({ generation: remote.generation, ...remote.data }).length,
  contentType: "application/json",
  updated: remote.updated,
  storageClass: Option.none,
});
const lockObject = (remote: TfRemoteState): StorageObject => {
  if (!Option.isSome(remote.lock)) return fail("State is not locked.");
  return {
    name: TfBackend.path(remote.config, true),
    size: JSON.stringify(remote.lock.value).length,
    contentType: "application/json",
    updated: remote.lock.value.created,
    storageClass: Option.none,
  };
};
const matchesObject = (actual: StorageObject | undefined, expected: StorageObject): boolean => {
  if (!actual) {
    return false;
  }
  return (
    actual.name === expected.name &&
    actual.size === expected.size &&
    actual.contentType === expected.contentType &&
    actual.updated === expected.updated
  );
};
const stored = (world: World, bucket: string, object: StorageObject, now: string): World => {
  const result = putObject(world, bucket, object, now);
  if (!result.ok) {
    return fail(result.error);
  }
  return result.value;
};
const verifyObject = (bucket: Bucket, remote: TfRemoteState): void => {
  const actual = bucket.objects.find((o) => o.name === TfBackend.path(remote.config));
  if (!matchesObject(actual, stateObject(remote)))
    fail(
      "Remote state object was deleted or changed outside Terraform. This simulator cannot recover arbitrary overwritten state.",
    );
};
const unlocked = (
  bucket: Bucket,
  remote: TfRemoteState | undefined,
  config: TfGcsBackend,
): void => {
  if (remote && Option.isSome(remote.lock))
    fail(
      `Error acquiring the state lock. Lock ID: ${remote.lock.value.id}; owner: ${remote.lock.value.owner}. Verify the other operation stopped before terraform force-unlock.`,
    );
  if (bucket.objects.some((o) => o.name === TfBackend.path(config, true)))
    fail(
      "State lock object exists but its owner is unknown. Inspect it before removing the object.",
    );
};
const replaceRemote = (world: World, remote: TfRemoteState): World => ({
  ...world,
  terraform: {
    ...world.terraform,
    backend: {
      ...world.terraform.backend,
      remotes: [
        ...world.terraform.backend.remotes.filter(
          (r) => TfBackend.key(r.config) !== TfBackend.key(remote.config),
        ),
        remote,
      ],
    },
  },
});
const writeRemote = (world: World, config: TfGcsBackend, data: TfStateData, now: string): World => {
  const bucket = authorize(world, config, true);
  const old = findRemote(world, config);
  unlocked(bucket, old, config);
  if (old) verifyObject(bucket, old);
  if (!old && bucket.objects.some((o) => o.name === TfBackend.path(config)))
    fail(
      "Destination state object already exists and is not a simulator state. It will not be overwritten.",
    );
  if (!old && world.terraform.backend.remotes.length >= 8)
    fail("At most 8 remote backend locations are supported.");
  const versions = old
    ? [
        ...old.versions,
        ...(bucket.versioning ? [{ generation: old.generation, data: old.data }] : []),
      ].slice(-10)
    : [];
  const remote: TfRemoteState = {
    config,
    generation: (old?.generation ?? 0) + 1,
    data,
    versions,
    updated: now,
    lock: Option.none,
  };
  const next = replaceRemote(world, remote);
  return stored(next, bucket.name, stateObject(remote), now);
};
const check = (world: World, write = false, configuration = true): void => {
  const backend = world.terraform.backend;
  if (configuration && !equal(TfBackend.configuration(world.terraform.files), backend.config))
    fail("Backend configuration changed. Run terraform init -migrate-state.");
  if (backend.config.kind === "local") return;
  if (!world.terraform.initialized) fail("Run terraform init first.");
  const bucket = authorize(world, backend.config, write);
  const remote =
    findRemote(world, backend.config) ?? fail("Remote state is missing. Run terraform init.");
  verifyObject(bucket, remote);
  if (write) unlocked(bucket, remote, backend.config);
  if (
    remote.generation !== backend.generation ||
    !equal(remote.data, TfBackend.data(world.terraform))
  )
    fail("Remote state changed; run terraform init to reload it before continuing.");
};
export const TfBackendRuntime = {
  check,
  initialize(
    world: World,
    migrate: boolean,
    now: string,
  ): Readonly<{ world: World; message: string }> {
    const source = world.terraform.backend.config;
    const target = TfBackend.configuration(world.terraform.files);
    const changed = !equal(source, target);
    if (world.terraform.initialized && changed && !migrate)
      fail(
        "Backend configuration changed. Use terraform init -migrate-state to copy the existing state.",
      );
    if (source.kind === "gcs" && changed) check(world, true, false);
    let next = world;
    let data = TfBackend.data(world.terraform);
    let generation = 0;
    let warning = "";
    if (target.kind === "gcs") {
      const bucket = authorize(world, target, true);
      const existing = findRemote(world, target);
      unlocked(bucket, existing, target);
      if (existing) verifyObject(bucket, existing);
      if (!existing && bucket.objects.some((o) => o.name === TfBackend.path(target)))
        fail("Destination state object already exists and will not be overwritten.");
      if (!bucket.versioning)
        warning =
          "\nWarning: Object Versioning is disabled on the backend bucket. Enable it to retain state generations.";
      const adopt = existing && (!world.terraform.initialized || !changed);
      if (adopt) {
        data = existing.data;
        generation = existing.generation;
      }
      if (!adopt) {
        if (existing && !equal(existing.data, data))
          fail("Destination backend contains different state. Migration refuses to overwrite it.");
        next = writeRemote(next, target, data, now);
        generation = findRemote(next, target)?.generation ?? fail("Remote state write failed.");
      }
    }
    const backend = {
      ...next.terraform.backend,
      config: target,
      generation,
      revision: world.terraform.backend.revision + (changed ? 1 : 0),
      migration:
        changed && world.terraform.initialized && migrate
          ? Option.some({ from: source, to: target, data })
          : world.terraform.backend.migration,
    };
    next = { ...next, terraform: { ...next.terraform, ...data, initialized: true, backend } };
    return {
      world: next,
      message: `Terraform initialized: ${TfBackend.key(target)} (simulated).${changed && world.terraform.initialized ? " State copied; infrastructure was not changed." : ""}${warning}`,
    };
  },
  protect(world: World, changes: readonly TfChange[]): void {
    const config = world.terraform.backend.config;
    if (config.kind !== "gcs") return;
    if (
      changes.some(
        (c) =>
          c.action === "delete" &&
          c.resource.type === "google_storage_bucket" &&
          c.resource.name === config.bucket,
      )
    )
      fail("Cannot delete the active backend bucket. Migrate state to another backend first.");
  },
  commit(before: World, after: World, now: string): World {
    check(before, true);
    const config = before.terraform.backend.config;
    if (config.kind === "local") return after;
    const next = writeRemote(after, config, TfBackend.data(after.terraform), now);
    const generation = findRemote(next, config)?.generation ?? fail("Remote state write failed.");
    return {
      ...next,
      terraform: { ...next.terraform, backend: { ...next.terraform.backend, generation } },
    };
  },
  inspect(world: World): string {
    const backend = world.terraform.backend;
    const remote = backend.config.kind === "gcs" ? findRemote(world, backend.config) : undefined;
    check(world);
    return JSON.stringify(
      {
        backend: backend.config,
        revision: backend.revision,
        generation: backend.generation,
        state: TfBackend.key(backend.config),
        versions:
          remote?.versions.map((v) => ({
            generation: v.generation,
            serial: v.data.serial,
            resources: v.data.resources.length,
          })) ?? [],
        lock: remote && Option.isSome(remote.lock) ? remote.lock.value : null,
      },
      null,
      2,
    );
  },
  lock(world: World, now: string): Readonly<{ world: World; id: string }> {
    check(world, true);
    const config = world.terraform.backend.config;
    if (config.kind !== "gcs") return fail("The lock exercise requires a GCS backend.");
    const old = findRemote(world, config) ?? fail("Remote state missing.");
    const numbered = World.nextNumber(world);
    const id = `tf-lock-${numbered.number}`;
    const adc = world.session.adc;
    const remote: TfRemoteState = {
      ...old,
      lock: Option.some({ id, owner: Option.isSome(adc) ? adc.value : "", created: now }),
    };
    const next = replaceRemote(numbered.world, remote);
    return {
      world: stored(next, config.bucket, lockObject(remote), now),
      id,
    };
  },
  unlock(world: World, id: string, now: string): World {
    // Recovery uses the initialized backend even if configuration has been edited.
    check(world, false, false);
    const config = world.terraform.backend.config;
    if (config.kind !== "gcs") return fail("Local state has no simulated remote lock.");
    const bucket = authorize(world, config, true);
    const remote = findRemote(world, config) ?? fail("Remote state missing.");
    if (!Option.isSome(remote.lock) || remote.lock.value.id !== id)
      fail("Lock ID does not match. No lock was removed.");
    if (
      !matchesObject(
        bucket.objects.find((o) => o.name === TfBackend.path(config, true)),
        lockObject(remote),
      )
    )
      fail("Lock object changed outside Terraform; refusing to remove it.");
    const next = replaceRemote(world, { ...remote, lock: Option.none });
    const deleted = deleteObject(next, config.bucket, TfBackend.path(config, true), now);
    if (!deleted.ok) {
      return fail(deleted.error);
    }
    return deleted.value;
  },
} as const;
