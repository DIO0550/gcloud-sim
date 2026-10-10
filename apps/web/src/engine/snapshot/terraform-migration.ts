type RecordValue = Record<string, unknown>;
const record = (v: unknown): v is RecordValue =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const migrateData = (v: unknown): unknown =>
  record(v) ? { ...v, sensitiveOutputs: v.sensitiveOutputs ?? [] } : v;
type SizeChange = Readonly<{
  bucket: string;
  name: string;
  oldSize: number;
  size: number;
  updated: unknown;
}>;

export const migrateTerraform = (world: RecordValue): RecordValue => {
  if (!record(world.terraform)) {
    return world;
  }
  const state = world.terraform;
  const changes: SizeChange[] = [];
  const migrateRemote = (value: unknown): unknown => {
    if (!record(value)) {
      return value;
    }
    const config = value.config;
    if (
      record(config) &&
      config.kind === "gcs" &&
      typeof config.bucket === "string" &&
      typeof config.prefix === "string"
    ) {
      const versions = Array.isArray(value.versions) ? value.versions : [];
      for (const version of [...versions, value]) {
        if (!record(version) || !record(version.data) || typeof version.generation !== "number") {
          continue;
        }
        changes.push({
          bucket: config.bucket,
          name: `${config.prefix ? `${config.prefix}/` : ""}default.tfstate`,
          oldSize: JSON.stringify({ generation: version.generation, ...version.data }).length,
          size: JSON.stringify({
            generation: version.generation,
            ...(migrateData(version.data) as RecordValue),
          }).length,
          updated: version.updated,
        });
      }
    }
    return {
      ...value,
      data: migrateData(value.data),
      versions: Array.isArray(value.versions)
        ? value.versions.map((v: unknown) => (record(v) ? { ...v, data: migrateData(v.data) } : v))
        : value.versions,
    };
  };
  const backend = state.backend;
  const migratedBackend = record(backend)
    ? {
        ...backend,
        remotes: Array.isArray(backend.remotes)
          ? backend.remotes.map(migrateRemote)
          : backend.remotes,
        migration:
          record(backend.migration) && record(backend.migration.value)
            ? {
                ...backend.migration,
                value: {
                  ...backend.migration.value,
                  data: migrateData(backend.migration.value.data),
                },
              }
            : backend.migration,
      }
    : backend;
  const resize = (bucket: unknown, object: unknown): unknown => {
    if (!record(object)) {
      return object;
    }
    // Only upgrade intact known legacy objects. A changed size/type/timestamp remains detectable.
    const change = changes.find(
      (c) =>
        c.bucket === bucket &&
        c.name === object.name &&
        c.oldSize === object.size &&
        c.updated === object.updated &&
        object.contentType === "application/json",
    );
    return change ? { ...object, size: change.size } : object;
  };
  const storage = world.storageLab;
  return {
    ...world,
    buckets: Array.isArray(world.buckets)
      ? world.buckets.map((b: unknown) =>
          record(b) && Array.isArray(b.objects)
            ? { ...b, objects: b.objects.map((o: unknown) => resize(b.name, o)) }
            : b,
        )
      : world.buckets,
    storageLab:
      record(storage) && Array.isArray(storage.versions)
        ? {
            ...storage,
            versions: storage.versions.map((v: unknown) => (record(v) ? resize(v.bucket, v) : v)),
          }
        : storage,
    terraform: {
      ...state,
      providerVersion: state.providerVersion ?? "",
      sensitiveOutputs: state.sensitiveOutputs ?? [],
      events: state.events ?? [],
      plans: record(state.plans)
        ? Object.fromEntries(
            Object.entries(state.plans).map(([k, p]) => [
              k,
              record(p)
                ? {
                    ...p,
                    sensitiveOutputs: p.sensitiveOutputs ?? [],
                    dependencies: p.dependencies ?? {},
                  }
                : p,
            ]),
          )
        : state.plans,
      backend: migratedBackend,
    },
  };
};
