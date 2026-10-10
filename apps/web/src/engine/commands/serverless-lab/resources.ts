import { CommandFailure } from "@/engine/cli/command-failure";
import {
  Column,
  CommandContext,
  CommandOutput,
  type CommandSpec,
  Flag,
  type FlagSpec,
  ParsedArgs,
  Positional,
  type ProjectContext,
} from "@/engine/cli/command-spec";
import { Candidates, parseBinding, projectCommand } from "@/engine/commands/shared";
import type { ApiName } from "@/engine/domains/catalog";
import { ResourceName } from "@/engine/domains/compute";
import { Ipv4 } from "@/engine/domains/gke-control-plane";
import { IamPolicy } from "@/engine/domains/iam-policy";
import { cacheOf, saveCache } from "@/engine/domains/managed-databases/cache";
import { documentValue, firestoreLocations, patch } from "@/engine/domains/managed-databases/model";
import {
  type Connector,
  type CryptoKey,
  type Database,
  type Redis,
  type ResourceId,
  type Secret,
  type ServerlessLab,
  sameId,
} from "@/engine/domains/serverless-lab/model";
import { allows, publishEvent } from "@/engine/domains/serverless-lab/runtime";
import { keyPath } from "@/engine/domains/storage-lab/model";
import type { World } from "@/engine/domains/world";
import type { JsonRecord } from "@/types/Json";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";
import { finish, invalid, labCandidates, regionFlag, requirePermission } from "./shared";

type Collection = "connectors" | "redis" | "databases" | "secrets" | "keys";
type Item<K extends Collection> = ServerlessLab[K][number];
export const patchLab = (world: World, patch: Partial<ServerlessLab>): World => ({
  ...world,
  serverlessLab: { ...world.serverlessLab, ...patch },
});
const sameResource = (
  a: ResourceId & { ring?: string },
  b: ResourceId & { ring?: string },
): boolean => sameId(a, b) && a.ring === b.ring;
const replace = <K extends Collection>(world: World, key: K, item: Item<K>): World =>
  patchLab(world, {
    [key]: [...world.serverlessLab[key].filter((r) => !sameResource(r, item)), item],
  });
const remove = <K extends Collection>(world: World, key: K, item: Item<K>): World =>
  patchLab(world, { [key]: world.serverlessLab[key].filter((r) => !sameResource(r, item)) });
const record = (r: Connector | Redis | Database | Secret | CryptoKey): JsonRecord => {
  if ("versions" in r) {
    return {
      ...r,
      versions: r.versions.map((v) => ({
        id: v.id,
        state: v.state,
        bytes: new TextEncoder().encode(v.data).length,
      })),
    };
  }
  return { ...r };
};

const idArgs = (
  ctx: ProjectContext,
  args: ParsedArgs,
  key: Collection,
): Result<ResourceId, CommandFailure> => {
  const name = ParsedArgs.requiredPositional(args, 0);
  if (key === "secrets") {
    return Result.ok({ projectId: ctx.project.projectId, name, region: "global" });
  }
  const raw = Option.or(ParsedArgs.string(args, "region"), ParsedArgs.string(args, "location"));
  if (key === "databases" && raw.some && firestoreLocations().includes(raw.value)) {
    return Result.ok({ projectId: ctx.project.projectId, name, region: raw.value });
  }
  return Result.map(CommandContext.resolveRegion(ctx, raw, "run/region"), (region) => ({
    projectId: ctx.project.projectId,
    name,
    region,
  }));
};
const itemArg = <K extends Collection>(
  ctx: ProjectContext,
  args: ParsedArgs,
  key: K,
): Result<Item<K>, CommandFailure> =>
  Result.flatMap(idArgs(ctx, args, key), (id) => {
    const item = ctx.world.serverlessLab[key].find(
      (r) =>
        sameId(r, id) && (!("ring" in r) || r.ring === ParsedArgs.requiredString(args, "keyring")),
    ) as Item<K> | undefined;
    return Option.toResult(Option.fromNullable(item), () =>
      CommandFailure.notFoundWith(`${key} ${id.name} does not exist in ${id.region}.`),
    );
  });
type ResourceSeed<K extends Collection> = Readonly<{
  key: K;
  group: readonly string[];
  permission: string;
  api: ApiName;
  flags: readonly FlagSpec[];
  create: (
    ctx: ProjectContext,
    args: ParsedArgs,
    id: ResourceId,
  ) => Result<Item<K>, CommandFailure>;
}>;
const crud = <K extends Collection>(seed: ResourceSeed<K>): readonly CommandSpec[] =>
  ["create", "list", "describe", "delete"].map((action) =>
    projectCommand({
      path: [...seed.group, action],
      summary: `${action} ${seed.key} in the fixed serverless lesson.`,
      positionals:
        action === "list"
          ? []
          : [Positional.required("NAME", "Resource name.", labCandidates(seed.key))],
      flags: [
        regionFlag,
        Flag.string("location", "Resource location.", {
          candidates: seed.key === "databases" ? () => firestoreLocations() : Candidates.regions,
        }),
        ...seed.flags,
      ],
      destructive: action === "delete",
      permission: `${seed.permission}.${action === "describe" ? "get" : action}`,
      requiredApis: [seed.api],
      run: (ctx, args) => {
        if (action === "list") {
          const region = Option.or(
            ParsedArgs.string(args, "region"),
            ParsedArgs.string(args, "location"),
          );
          const rows = ctx.world.serverlessLab[seed.key]
            .filter(
              (r) =>
                r.projectId === ctx.project.projectId &&
                (!region.some || r.region === region.value),
            )
            .map(record);
          return Result.ok({
            world: ctx.world,
            output: CommandOutput.table(rows, [
              Column.create("NAME", "name"),
              Column.create("LOCATION", "region"),
            ]),
          });
        }
        if (action === "create") {
          const id = idArgs(ctx, args, seed.key);
          if (!Result.isOk(id)) {
            return id;
          }
          if (seed.key !== "databases" && !Result.isOk(ResourceName.parse(id.value.name))) {
            return invalid("Invalid resource name.");
          }
          if (
            ctx.world.serverlessLab[seed.key].some(
              (r) =>
                sameId(r, id.value) &&
                (!("ring" in r) || r.ring === ParsedArgs.requiredString(args, "keyring")),
            )
          ) {
            return invalid("Resource already exists.");
          }
          const created = seed.create(ctx, args, id.value);
          if (!Result.isOk(created)) {
            return created;
          }
          let world = replace(ctx.world, seed.key, created.value);
          if (seed.key === "redis") {
            const tier = Option.unwrapOr(ParsedArgs.string(args, "tier"), "BASIC") as
              | "BASIC"
              | "STANDARD_HA";
            world = saveCache(world, { ...id.value, tier, failovers: 0, entries: [] });
          }
          return finish(world, record(created.value));
        }
        const found = itemArg(ctx, args, seed.key);
        if (!Result.isOk(found)) {
          return found;
        }
        if (action === "describe") {
          if (seed.key === "redis") {
            const redis = ctx.world.serverlessLab.redis.find((v) => sameId(v, found.value));
            if (redis) {
              return finish(ctx.world, { ...record(found.value), ...cacheOf(ctx.world, redis) });
            }
          }
          if (seed.key === "databases") {
            return finish(ctx.world, {
              ...record(found.value),
              consistency: "STRONG",
              indexes: ctx.world.managedDatabases.indexes.filter(
                (i) => i.projectId === found.value.projectId && i.database === found.value.name,
              ),
            });
          }
          return finish(ctx.world, record(found.value));
        }
        const r = found.value;
        if (
          seed.key === "connectors" &&
          ctx.world.serverlessLab.deployments.some(
            (d) =>
              d.projectId === r.projectId &&
              d.region === r.region &&
              d.revisions.some((v) => v.config.connector === r.name),
          )
        ) {
          return invalid("A revision still references this connector.");
        }
        if (
          seed.key === "databases" &&
          ctx.world.serverlessLab.documents.some(
            (d) => d.projectId === r.projectId && d.database === r.name,
          )
        ) {
          return invalid("Delete documents before deleting their database.");
        }
        if (seed.key === "keys") {
          const key = ctx.world.serverlessLab.keys.find((k) => sameResource(k, r));
          if (
            key &&
            (ctx.world.storageLab.protections.some((p) => p.defaultKey === keyPath(key)) ||
              ctx.world.storageLab.versions.some((v) => v.kmsKey === keyPath(key)))
          ) {
            return invalid("A bucket or object generation still references this key.");
          }
        }
        let removed = remove(ctx.world, seed.key, r);
        if (seed.key === "redis") {
          removed = patch(removed, {
            caches: removed.managedDatabases.caches.filter((c) => !sameId(c, r)),
          });
        }
        if (seed.key === "databases") {
          removed = patch(removed, {
            indexes: removed.managedDatabases.indexes.filter(
              (i) => !(i.projectId === r.projectId && i.database === r.name),
            ),
          });
        }
        return finish(removed, { deleted: r.name });
      },
    }),
  );
const policyCommands = <K extends "secrets" | "keys">(
  key: K,
  group: readonly string[],
  permission: string,
  api: ApiName,
): readonly CommandSpec[] =>
  ["get-iam-policy", "add-iam-policy-binding", "remove-iam-policy-binding"].map((action) =>
    projectCommand({
      path: [...group, action],
      summary: "Read or change the resource IAM policy.",
      positionals: [Positional.required("NAME", "Resource name.", labCandidates(key))],
      flags: [
        regionFlag,
        Flag.string("location", "Key location."),
        Flag.string("keyring", "Key ring."),
        Flag.string("member", "IAM member.", { candidates: Candidates.members }),
        Flag.string("role", "IAM role.", { candidates: Candidates.roles }),
      ],
      permission: `${permission}.${action === "get-iam-policy" ? "getIamPolicy" : "setIamPolicy"}`,
      requiredApis: [api],
      run: (ctx, args) => {
        const found = itemArg(ctx, args, key);
        if (!Result.isOk(found)) {
          return found;
        }
        if (action === "get-iam-policy") {
          return finish(ctx.world, IamPolicy.toRecord(found.value.policy));
        }
        const binding = parseBinding(ctx.world, args);
        if (!Result.isOk(binding)) {
          return binding;
        }
        const { role, member } = binding.value;
        const current = found.value;
        const next =
          action === "add-iam-policy-binding"
            ? Option.some(IamPolicy.addBinding(current.policy, role, member))
            : IamPolicy.removeBinding(current.policy, role, member);
        if (!next.some) {
          return invalid("Binding does not exist.");
        }
        return finish(
          replace(ctx.world, key, { ...current, policy: next.value }),
          IamPolicy.toRecord(next.value),
        );
      },
    }),
  );
const ConnectorCommands = crud({
  key: "connectors",
  group: ["gcloud", "compute", "networks", "vpc-access", "connectors"],
  permission: "vpcaccess.connectors",
  api: "vpcaccess.googleapis.com",
  flags: [
    Flag.string("network", "Existing VPC network.", { candidates: Candidates.networks }),
    Flag.string("range", "Unused aligned IPv4 /28 range."),
  ],
  create: (ctx, args, id) => {
    const network = ParsedArgs.requiredString(args, "network");
    if (!ctx.world.networks.some((n) => n.projectId === id.projectId && n.name === network)) {
      return invalid("VPC network does not exist.");
    }
    const range = ParsedArgs.requiredString(args, "range");
    const octets = range.replace(/\/28$/, "").split(".").map(Number);
    if (
      !/^\d+\.\d+\.\d+\.\d+\/28$/.test(range) ||
      octets.length !== 4 ||
      !octets.every((n) => n >= 0 && n <= 255) ||
      (octets[3] ?? 1) % 16 !== 0
    ) {
      return invalid("Connector range must be an aligned IPv4 /28.");
    }
    if (
      ctx.world.serverlessLab.connectors.some(
        (r) =>
          r.projectId === id.projectId && r.network === network && Ipv4.overlaps(r.range, range),
      )
    ) {
      return invalid("Connector range is already in use.");
    }
    if (
      ctx.world.subnets.some(
        (s) =>
          s.projectId === id.projectId &&
          s.network === network &&
          Ipv4.overlaps(s.ipCidrRange, range),
      )
    ) {
      return invalid("Connector range overlaps a subnet in this VPC.");
    }
    return Result.ok({ ...id, network, range });
  },
});
const RedisCommands = crud({
  key: "redis",
  group: ["gcloud", "redis", "instances"],
  permission: "redis.instances",
  api: "redis.googleapis.com",
  flags: [
    Flag.string("network", "Authorized VPC network.", { candidates: Candidates.networks }),
    Flag.integer("size", "Size in GiB (1–100)."),
    Flag.enum("tier", "Availability tier.", ["BASIC", "STANDARD_HA"]),
  ],
  create: (ctx, args, id) => {
    const network = Option.unwrapOr(ParsedArgs.string(args, "network"), "default");
    const sizeGb = Option.unwrapOr(ParsedArgs.integer(args, "size"), 1);
    if (
      !ctx.world.networks.some((n) => n.projectId === id.projectId && n.name === network) ||
      !Number.isSafeInteger(sizeGb) ||
      sizeGb < 1 ||
      sizeGb > 100
    ) {
      return invalid("Redis requires an existing VPC and size of 1–100 GiB.");
    }
    return Result.ok({
      ...id,
      network,
      sizeGb,
      host: `10.200.${Math.floor(ctx.world.serverlessLab.redis.length / 250)}.${(ctx.world.serverlessLab.redis.length % 250) + 1}`,
    });
  },
});
const DatabaseCommands = crud({
  key: "databases",
  group: ["gcloud", "firestore", "databases"],
  permission: "datastore.databases",
  api: "firestore.googleapis.com",
  flags: [Flag.enum("type", "Database mode.", ["firestore-native", "datastore-mode"])],
  create: (ctx, args, id) => {
    if (!/^(\(default\)|[a-z][a-z0-9-]{2,62})$/.test(id.name)) {
      return invalid("Use (default) or a 3–63 character database ID.");
    }
    if (
      ctx.world.serverlessLab.databases.some(
        (d) => d.projectId === id.projectId && d.name === id.name,
      )
    ) {
      return invalid("Database ID already exists in this project.");
    }
    return Result.ok({
      ...id,
      mode: Option.unwrapOr(
        ParsedArgs.string(args, "type"),
        "firestore-native",
      ) as Database["mode"],
    });
  },
});
const SecretCommands = crud({
  key: "secrets",
  group: ["gcloud", "secrets"],
  permission: "secretmanager.secrets",
  api: "secretmanager.googleapis.com",
  flags: [
    Flag.enum("replication-policy", "The lesson supports automatic replication.", ["automatic"]),
  ],
  create: (_ctx, _args, id) => Result.ok({ ...id, policy: IamPolicy.Empty, versions: [] }),
});
const KeyCommands = crud({
  key: "keys",
  group: ["gcloud", "kms", "keys"],
  permission: "cloudkms.cryptoKeys",
  api: "cloudkms.googleapis.com",
  flags: [
    Flag.string("keyring", "Existing key ring."),
    Flag.enum("purpose", "Only symmetric encryption is modeled.", ["encryption"]),
  ],
  create: (ctx, args, id) => {
    const ring = ParsedArgs.requiredString(args, "keyring");
    if (
      !ctx.world.kmsKeyRings.some(
        (r) => r.projectId === id.projectId && r.location === id.region && r.name === ring,
      )
    ) {
      return invalid("Key ring does not exist in this location.");
    }
    return Result.ok({ ...id, ring, policy: IamPolicy.Empty, enabled: true });
  },
});
const versionArg = (ctx: ProjectContext, args: ParsedArgs) => {
  const name = ParsedArgs.requiredString(args, "secret");
  const secret = ctx.world.serverlessLab.secrets.find(
    (s) => s.projectId === ctx.project.projectId && s.name === name,
  );
  if (!secret) {
    return invalid("Secret does not exist.");
  }
  const version = ParsedArgs.requiredPositional(args, 0);
  const v =
    version === "latest"
      ? secret.versions.at(-1)
      : secret.versions.find((v) => String(v.id) === version);
  if (!v) {
    return invalid("Secret version does not exist.");
  }
  return Result.ok({ secret, v });
};
const VersionCommands: readonly CommandSpec[] = [
  projectCommand({
    path: ["sim", "secrets", "versions", "add"],
    summary: "Add a small lesson secret value without reading host files.",
    positionals: [Positional.required("SECRET", "Secret name.", labCandidates("secrets"))],
    flags: [Flag.string("data", "Lesson value (never a real credential).", { required: true })],
    permission: "secretmanager.versions.add",
    requiredApis: ["secretmanager.googleapis.com"],
    run: (ctx, args) => {
      const found = itemArg(ctx, args, "secrets");
      if (!Result.isOk(found)) {
        return found;
      }
      const data = ParsedArgs.requiredString(args, "data");
      if (data.length > 4096 || found.value.versions.length >= 100) {
        return invalid("Lesson secrets are limited to 4096 characters and 100 versions.");
      }
      const v = { id: (found.value.versions.at(-1)?.id ?? 0) + 1, state: "ENABLED" as const, data };
      return finish(
        replace(ctx.world, "secrets", { ...found.value, versions: [...found.value.versions, v] }),
        { version: v.id, state: v.state },
      );
    },
  }),
  ...["access", "enable", "disable", "destroy"].map((action) =>
    projectCommand({
      path: ["gcloud", "secrets", "versions", action],
      summary: "Evaluate access or change the state of a lesson secret version.",
      positionals: [Positional.required("VERSION", "Version number or latest.")],
      flags: [
        Flag.string("secret", "Secret name.", {
          required: true,
          candidates: labCandidates("secrets"),
        }),
      ],
      destructive: action === "destroy",
      permissions: action === "access" ? [] : [`secretmanager.versions.${action}`],
      requiredApis: ["secretmanager.googleapis.com"],
      run: (ctx, args) => {
        const found = versionArg(ctx, args);
        if (!Result.isOk(found)) {
          return found;
        }
        const { secret, v } = found.value;
        if (action === "access") {
          if (
            v.state !== "ENABLED" ||
            !allows(
              ctx.world,
              secret.projectId,
              ctx.principal,
              "secretmanager.versions.access",
              secret.policy,
            )
          ) {
            return invalid(
              "Secret version must be enabled and the caller must have Secret Accessor permission.",
            );
          }
          return finish(ctx.world, {
            status: "ACCESS_GRANTED",
            bytes: new TextEncoder().encode(v.data).length,
            value: "[REDACTED: lesson secret]",
          });
        }
        if (v.state === "DESTROYED") {
          return invalid("Destroyed versions cannot be restored.");
        }
        const states = { enable: "ENABLED", disable: "DISABLED", destroy: "DESTROYED" } as const;
        const state = states[action as keyof typeof states];
        const updated = {
          ...secret,
          versions: secret.versions.map((r) => {
            if (r.id !== v.id) {
              return r;
            }
            return { ...r, state, data: state === "DESTROYED" ? "" : r.data };
          }),
        };
        return finish(replace(ctx.world, "secrets", updated), { version: v.id, state });
      },
    }),
  ),
  projectCommand({
    path: ["gcloud", "kms", "keys", "versions", "update"],
    summary: "Enable or disable the lesson key's primary version (version 1).",
    positionals: [Positional.required("VERSION", "Only primary version 1 is modeled.")],
    flags: [
      regionFlag,
      Flag.string("location", "Key location."),
      Flag.string("keyring", "Key ring.", { required: true }),
      Flag.string("key", "Crypto key.", { required: true }),
      Flag.enum("state", "Key state.", ["enabled", "disabled"], { required: true }),
    ],
    permission: "cloudkms.cryptoKeyVersions.update",
    requiredApis: ["cloudkms.googleapis.com"],
    run: (ctx, args) => {
      if (ParsedArgs.requiredPositional(args, 0) !== "1") {
        return invalid("Only key version 1 is modeled.");
      }
      const found = itemArg(
        ctx,
        { ...args, positionals: [ParsedArgs.requiredString(args, "key")] },
        "keys",
      );
      if (!Result.isOk(found)) {
        return found;
      }
      const key = {
        ...found.value,
        enabled: ParsedArgs.requiredString(args, "state") === "enabled",
      };
      return finish(replace(ctx.world, "keys", key), { name: key.name, enabled: key.enabled });
    },
  }),
];
const DocumentCommands: readonly CommandSpec[] = ["write", "delete", "read"].map((action) =>
  projectCommand({
    path: ["sim", "firestore", "documents", action],
    summary: "Read/change a lesson document; emits Firestore events without SDK execution.",
    positionals: [Positional.required("PATH", "collection/document path.")],
    flags: [
      Flag.string("database", "Database ID.", {
        required: true,
        candidates: labCandidates("databases"),
      }),
      Flag.string("data", "Small JSON document value."),
    ],
    permissions: [],
    requiredApis: ["firestore.googleapis.com"],
    run: (ctx, args) => {
      const database = ParsedArgs.requiredString(args, "database");
      if (
        !ctx.world.serverlessLab.databases.some(
          (d) =>
            d.projectId === ctx.project.projectId &&
            d.name === database &&
            d.mode === "firestore-native",
        )
      ) {
        return invalid("Firestore Native database does not exist.");
      }
      const path = ParsedArgs.requiredPositional(args, 0);
      const parts = path.split("/");
      if (
        parts.length % 2 !== 0 ||
        parts.some((s) => !s || s === "." || s === "..") ||
        path.length > 500
      ) {
        return invalid("Specify a collection/document path.");
      }
      const match = (d: { projectId: string; database: string; path: string }) =>
        d.projectId === ctx.project.projectId && d.database === database && d.path === path;
      const old = ctx.world.serverlessLab.documents.find(match);
      const permissions = { read: "get", delete: "delete", write: old ? "update" : "create" };
      const authorized = requirePermission(
        ctx,
        `datastore.entities.${permissions[action as keyof typeof permissions]}`,
      );
      if (!Result.isOk(authorized)) {
        return authorized;
      }
      if (action === "read") {
        return old
          ? finish(ctx.world, { path, data: old.data, version: old.version })
          : invalid("Document does not exist.");
      }
      if (action === "delete" && !old) {
        return invalid("Document does not exist.");
      }
      const data = Option.unwrapOr(ParsedArgs.string(args, "data"), "{}");
      const checked = documentValue(data);
      if (!checked.ok) {
        return invalid(checked.error);
      }
      if (action === "write" && !Number.isSafeInteger((old?.version ?? 0) + 1)) {
        return invalid("Document version limit exceeded.");
      }
      let docs = ctx.world.serverlessLab.documents.filter((d) => !match(d));
      if (action === "write") {
        docs = [
          ...docs,
          {
            projectId: ctx.project.projectId,
            database,
            path,
            data,
            version: (old?.version ?? 0) + 1,
          },
        ];
      }
      const writtenChange = old ? "updated" : "created";
      const change = action === "delete" ? "deleted" : writtenChange;
      let world = publishEvent(patchLab(ctx.world, { documents: docs }), {
        projectId: ctx.project.projectId,
        kind: "firestore",
        source: database,
        document: path,
        eventType: `google.cloud.firestore.document.v1.${change}`,
      });
      world = publishEvent(world, {
        projectId: ctx.project.projectId,
        kind: "firestore",
        source: database,
        document: path,
        eventType: "google.cloud.firestore.document.v1.written",
      });
      return finish(world, { path, change, eventId: world.serverlessLab.events.at(-2)?.id ?? "" });
    },
  }),
);
export const ServerlessResourceCommands: readonly CommandSpec[] = [
  ...ConnectorCommands,
  ...RedisCommands,
  ...DatabaseCommands,
  ...SecretCommands,
  ...KeyCommands,
  ...VersionCommands,
  ...DocumentCommands,
  ...policyCommands(
    "secrets",
    ["gcloud", "secrets"],
    "secretmanager.secrets",
    "secretmanager.googleapis.com",
  ),
  ...policyCommands(
    "keys",
    ["gcloud", "kms", "keys"],
    "cloudkms.cryptoKeys",
    "cloudkms.googleapis.com",
  ),
];
