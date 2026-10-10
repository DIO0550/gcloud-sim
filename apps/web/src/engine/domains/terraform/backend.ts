import { BucketName } from "@/engine/domains/storage";
import { Hcl, type HclBlock } from "@/engine/domains/terraform/hcl";
import { type TfResource, TfResources } from "@/engine/domains/terraform/resources";
import { Decoder as D, type Decoder } from "@/utils/Decoder";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

export type TfGcsBackend = Readonly<{ kind: "gcs"; bucket: string; prefix: string }>;
export type TfBackendConfig = Readonly<{ kind: "local" }> | TfGcsBackend;
export type TfStateData = Readonly<{
  serial: number;
  sensitiveOutputs: readonly string[];
  resources: readonly TfResource[];
  outputs: Readonly<Record<string, string>>;
}>;
export type TfStateVersion = Readonly<{ generation: number; data: TfStateData }>;
export type TfRemoteState = Readonly<{
  config: TfGcsBackend;
  generation: number;
  data: TfStateData;
  updated: string;
  versions: readonly TfStateVersion[];
  lock: Option<Readonly<{ id: string; owner: string; created: string }>>;
}>;
export type TfMigration = Readonly<{
  from: TfBackendConfig;
  to: TfBackendConfig;
  data: TfStateData;
}>;
export type TfBackendState = Readonly<{
  config: TfBackendConfig;
  revision: number;
  generation: number;
  remotes: readonly TfRemoteState[];
  migration: Option<TfMigration>;
}>;
const gcs = D.object<TfGcsBackend>({
  kind: D.literal(["gcs"]),
  bucket: D.string,
  prefix: D.string,
});
const config: Decoder<TfBackendConfig> = (value, path) => {
  if (typeof value === "object" && value !== null && "kind" in value && value.kind === "local")
    return D.object<{ kind: "local" }>({ kind: D.literal(["local"]) })(value, path);
  return gcs(value, path);
};
const data = D.object<TfStateData>({
  serial: D.number,
  sensitiveOutputs: D.array(D.string),
  resources: D.array(TfResources.decoder),
  outputs: D.record(D.string),
});
const remote = D.object<TfRemoteState>({
  config: gcs,
  generation: D.number,
  data,
  updated: D.string,
  versions: D.array(D.object<TfStateVersion>({ generation: D.number, data })),
  lock: D.option(D.object({ id: D.string, owner: D.string, created: D.string })),
});
const fail = (message: string): never => {
  throw new Error(message);
};
const validateConfig = (c: TfBackendConfig): void => {
  if (c.kind === "local") return;
  const name = BucketName.parse(c.bucket);
  if (!Result.isOk(name)) fail(name.error);
  if (
    c.prefix.length > 200 ||
    (c.prefix !== "" &&
      c.prefix
        .split("/")
        .some(
          (p) =>
            !/^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(p) ||
            ["__proto__", "constructor", "prototype"].includes(p),
        ))
  )
    fail(
      "Invalid backend prefix: use relative non-empty path segments, without dot or parent-directory segments.",
    );
};
export const TfBackend = {
  empty: (): TfBackendState => ({
    config: { kind: "local" },
    revision: 0,
    generation: 0,
    remotes: [],
    migration: Option.none,
  }),
  dataDecoder: data,
  decoder: D.object<TfBackendState>({
    config,
    revision: D.number,
    generation: D.number,
    remotes: D.array(remote),
    migration: D.option(D.object<TfMigration>({ from: config, to: config, data })),
  }),
  block(block: HclBlock): TfBackendConfig {
    if (block.labels.length !== 1 || block.body.blocks.length)
      return fail("Invalid backend block.");
    const kind = block.labels[0];
    if (kind === "local") {
      if (Object.keys(block.body.attributes).length)
        fail("Custom local backend paths are not supported.");
      return { kind: "local" };
    }
    if (kind !== "gcs") return fail("Only local and gcs backends are supported.");
    for (const key of Object.keys(block.body.attributes))
      if (!["bucket", "prefix"].includes(key)) fail(`Unsupported backend attribute: ${key}`);
    const { bucket, prefix = "" } = block.body.attributes;
    if (typeof bucket !== "string" || typeof prefix !== "string")
      return fail(
        "Backend bucket and prefix must be literal strings; variables and resource references are not allowed.",
      );
    const c: TfGcsBackend = { kind, bucket, prefix };
    validateConfig(c);
    return c;
  },
  configuration(files: Readonly<Record<string, string>>): TfBackendConfig {
    const blocks = Object.entries(files)
      .filter(([name]) => name.endsWith(".tf") && !name.includes("/"))
      .flatMap(([, source]) =>
        Hcl.parse(source)
          .blocks.filter((b) => b.type === "terraform")
          .flatMap((b) => b.body.blocks.filter((c) => c.type === "backend")),
      );
    if (blocks.length > 1) fail("Only one backend block is allowed.");
    return blocks[0] ? TfBackend.block(blocks[0]) : { kind: "local" };
  },
  key(c: TfBackendConfig): string {
    return c.kind === "local" ? "local" : `gs://${c.bucket}/${TfBackend.path(c)}`;
  },
  path(c: TfGcsBackend, lock = false): string {
    return `${c.prefix ? `${c.prefix}/` : ""}default.${lock ? "tflock" : "tfstate"}`;
  },
  data(state: TfStateData): TfStateData {
    return {
      serial: state.serial,
      sensitiveOutputs: state.sensitiveOutputs,
      resources: state.resources,
      outputs: state.outputs,
    };
  },
  validate(state: TfBackendState): void {
    validateConfig(state.config);
    for (const value of [state.revision, state.generation])
      if (!Number.isSafeInteger(value) || value < 0)
        fail("Invalid backend revision or generation.");
    if (state.config.kind === "local" && state.generation !== 0)
      fail("Local backend cannot have a remote generation.");
    if (
      state.remotes.length > 8 ||
      new Set(state.remotes.map((r) => TfBackend.key(r.config))).size !== state.remotes.length
    )
      fail("Duplicate remote state or more than 8 backends.");
    for (const r of state.remotes) {
      validateConfig(r.config);
      if (!Number.isSafeInteger(r.generation) || r.generation < 1 || r.versions.length > 10)
        fail("Invalid remote state generation or history limit.");
      let previous = 0;
      for (const v of r.versions) {
        if (
          !Number.isSafeInteger(v.generation) ||
          v.generation <= previous ||
          v.generation >= r.generation
        )
          fail("Invalid remote state history.");
        previous = v.generation;
      }
      if (Option.isSome(r.lock) && (!/^tf-lock-\d+$/.test(r.lock.value.id) || !r.lock.value.owner))
        fail("Invalid remote state lock.");
    }
    if (Option.isSome(state.migration)) {
      validateConfig(state.migration.value.from);
      validateConfig(state.migration.value.to);
    }
  },
} as const;
