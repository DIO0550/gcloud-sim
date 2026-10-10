import { CommandFailure } from "@/engine/cli/command-failure";
import {
  CommandContext,
  CommandOutput,
  type CommandResult,
  type CommandSpec,
  Flag,
  OutputMessage,
  ParsedArgs,
  Positional,
  type ProjectContext,
  type TargetContext,
} from "@/engine/cli/command-spec";
import {
  alreadyExists,
  Candidates,
  iamBindingCommands,
  type ProjectCommandSeed,
  parseBinding,
  projectCommand,
  targetCommand,
} from "@/engine/commands/shared";
import { signStorageUrl } from "@/engine/commands/storage-lab/objects";
import {
  protectionOptions,
  storageNow,
  storagePermission,
  storageUrl,
  versionObject,
} from "@/engine/commands/storage-lab/runtime";
import { BucketLocation, StorageClass } from "@/engine/domains/catalog";
import { IamPolicy } from "@/engine/domains/iam-policy";
import type { PolicyTarget } from "@/engine/domains/resource-hierarchy";
import { SampleFile } from "@/engine/domains/sample-files";
import { type AclEntry, Bucket, GsUrl, type StorageObject } from "@/engine/domains/storage";
import {
  bucketRecord,
  deleteObject,
  keyAccess,
  patchStorage,
  putObject,
  trackBucket,
} from "@/engine/domains/storage-lab/model";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const bucketUrlArg = (args: ParsedArgs): Result<GsUrl, CommandFailure> =>
  Result.mapErr(GsUrl.parse(ParsedArgs.requiredPositional(args, 0)), (m) =>
    CommandFailure.invalidValue("URL", m),
  );

const requireBucket = (ctx: CommandContext, name: string): Result<Bucket, CommandFailure> =>
  Result.flatMap(
    Option.toResult(World.findBucket(ctx.world, name), () =>
      CommandFailure.notFoundWith(`gs://${name} bucket does not exist.`),
    ),
    (bucket) => {
      if (!World.hasApi(ctx.world, bucket.projectId, "storage.googleapis.com")) {
        return Result.err(
          CommandFailure.apiDisabled(
            "Cloud Storage API",
            "storage.googleapis.com",
            bucket.projectId,
          ),
        );
      }
      return Result.ok(bucket);
    },
  );

const bucketTarget = (
  ctx: CommandContext,
  args: ParsedArgs,
): Result<PolicyTarget, CommandFailure> =>
  Result.flatMap(bucketUrlArg(args), (url) =>
    Result.map(requireBucket(ctx, url.bucket), (b) => ({ type: "bucket", id: b.name })),
  );

const storageCommand = (seed: ProjectCommandSeed): CommandSpec => {
  const path = seed.path.join(" ");
  if (
    path === "gcloud storage buckets create" ||
    path === "gcloud storage buckets list" ||
    path === "gsutil mb"
  ) {
    return projectCommand({ ...seed, requiredApis: ["storage.googleapis.com"] });
  }
  const action = seed.path.at(-1);
  const dynamic = ["cp", "rsync", "rm", "sign-url"].includes(action ?? "");
  return targetCommand({
    ...seed,
    permissions: dynamic ? [] : (seed.permissions ?? [seed.permission ?? ""]),
    permission: undefined,
    resolveTarget: (ctx, args) => {
      const urls = args.positionals.filter(GsUrl.isGsUrl);
      const raw = urls.at(-1);
      if (!raw) {
        return Result.map(CommandContext.requireProject(ctx), (p) => ({
          type: "project" as const,
          id: p.projectId,
        }));
      }
      return Result.flatMap(storageUrl(raw), (u) =>
        Result.map(requireBucket(ctx, u.bucket), (b) => ({ type: "bucket" as const, id: b.name })),
      );
    },
    run: (ctx, args) => {
      const projectId =
        ctx.target.type === "bucket"
          ? ctx.world.buckets.find((b) => b.name === ctx.target.id)?.projectId
          : ctx.target.id;
      const project = ctx.world.projects.find((p) => p.projectId === projectId);
      if (!project) {
        return Result.err(CommandFailure.notFoundWith("Storage resource project not found."));
      }
      if (!World.hasApi(ctx.world, project.projectId, "storage.googleapis.com")) {
        return Result.err(
          CommandFailure.apiDisabled(
            "Cloud Storage API",
            "storage.googleapis.com",
            project.projectId,
          ),
        );
      }
      if (!dynamic && ctx.target.type === "bucket") {
        const bucket = ctx.world.buckets.find((b) => b.name === ctx.target.id);
        if (bucket) {
          for (const permission of seed.permissions ?? [seed.permission ?? ""]) {
            const check = storagePermission(ctx, bucket, permission);
            if (!check.ok) {
              return check;
            }
          }
        }
      }
      return seed.run({ ...ctx, project, now: storageNow(ctx) }, args);
    },
  });
};

/** `buckets create` と `gsutil mb` でフラグの綴りが違う分を吸収する。 */
type CreateBucketFlags = Readonly<{
  location: string;
  storageClass: string;
  uniformAccess: (args: ParsedArgs) => Result<boolean, CommandFailure>;
}>;

const createBucket = (
  ctx: ProjectContext,
  args: ParsedArgs,
  flags: CreateBucketFlags,
): CommandResult => {
  const url = bucketUrlArg(args);
  if (!Result.isOk(url)) return url;
  const rawLocation = Option.unwrapOr(ParsedArgs.string(args, flags.location), "US");
  const location = Option.toResult(BucketLocation.parse(rawLocation), () =>
    CommandFailure.invalidValue(
      `--${flags.location}`,
      `The specified location constraint is not valid: ${rawLocation}`,
    ),
  );
  if (!Result.isOk(location)) return location;
  const rawClass = Option.unwrapOr(ParsedArgs.string(args, flags.storageClass), "STANDARD");
  const storageClass = Option.toResult(StorageClass.parse(rawClass), () =>
    CommandFailure.invalidValue(`--${flags.storageClass}`, `Invalid storage class: ${rawClass}`),
  );
  if (!Result.isOk(storageClass)) return storageClass;
  const uniformAccess = flags.uniformAccess(args);
  if (!Result.isOk(uniformAccess)) return uniformAccess;
  const bucket = Result.mapErr(
    Bucket.create({
      projectId: ctx.project.projectId,
      name: url.value.bucket,
      location: location.value,
      storageClass: storageClass.value,
      uniformBucketLevelAccess: uniformAccess.value,
      publicAccessPrevention: ParsedArgs.boolean(args, "public-access-prevention"),
      timeCreated: ctx.now,
    }),
    (m) => CommandFailure.invalidValue("URL", m),
  );
  if (!Result.isOk(bucket)) return bucket;
  return Result.flatMap(
    Result.mapErr(World.withBucket(ctx.world, bucket.value), alreadyExists),
    (world) =>
      Result.map(
        Result.mapErr(protectionOptions(world, bucket.value, args), CommandFailure.invalidState),
        (world) => ({
          world,
          output: CommandOutput.messages(
            OutputMessage.plain(`Creating gs://${bucket.value.name}/...`),
          ),
        }),
      ),
  );
};

const listUrl = (
  ctx: ProjectContext,
  target: Option<GsUrl>,
  long: boolean,
  allVersions = false,
  softDeleted = false,
): CommandResult => {
  if (!Option.isSome(target)) {
    const lines = World.bucketsOf(ctx.world, ctx.project.projectId).map((b) =>
      OutputMessage.plain(`gs://${b.name}/`),
    );
    return Result.ok({ world: ctx.world, output: CommandOutput.messages(...lines) });
  }
  const bucket = requireBucket(ctx, target.value.bucket);
  if (!Result.isOk(bucket)) return bucket;
  const prefix = target.value.object;
  if (allVersions && softDeleted) {
    return Result.err(CommandFailure.invalidState("Choose --all-versions or --soft-deleted."));
  }
  if (allVersions || softDeleted) {
    const world = trackBucket(ctx.world, bucket.value.name);
    const versions = world.storageLab.versions.filter(
      (v) =>
        v.bucket === bucket.value.name &&
        v.name.startsWith(prefix) &&
        (softDeleted
          ? v.state === "SOFT_DELETED" && Date.parse(v.expires) > Date.parse(ctx.now)
          : v.state !== "SOFT_DELETED"),
    );
    return Result.ok({
      world,
      output: CommandOutput.messages(
        ...versions.map((v) =>
          OutputMessage.plain(`gs://${v.bucket}/${v.name}#${v.generation}  ${v.state}`),
        ),
      ),
    });
  }
  const objects = bucket.value.objects.filter((o) => o.name.startsWith(prefix));
  const lines = objects.map((o) =>
    OutputMessage.plain(
      long
        ? `${String(o.size).padStart(10)}  ${o.updated}  gs://${bucket.value.name}/${o.name}`
        : `gs://${bucket.value.name}/${o.name}`,
    ),
  );
  const total = long
    ? [
        OutputMessage.plain(
          `TOTAL: ${objects.length} objects, ${objects.reduce((sum, o) => sum + o.size, 0)} bytes`,
        ),
      ]
    : [];
  return Result.ok({ world: ctx.world, output: CommandOutput.messages(...lines, ...total) });
};

const listRun = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const raw = ParsedArgs.positional(args, 0);
  const long = ParsedArgs.boolean(args, "long");
  if (!Option.isSome(raw)) {
    if (ParsedArgs.boolean(args, "all-versions") || ParsedArgs.boolean(args, "soft-deleted")) {
      return Result.err(CommandFailure.invalidState("Generation listing requires a bucket URL."));
    }
    return listUrl(ctx, Option.none, long);
  }
  return Result.flatMap(bucketUrlArg(args), (url) =>
    listUrl(
      ctx,
      Option.some(url),
      long,
      ParsedArgs.boolean(args, "all-versions"),
      ParsedArgs.boolean(args, "soft-deleted"),
    ),
  );
};

const objectFromLocal = (path: string, now: string): StorageObject => ({
  name:
    path
      .replace(/^file:\/\//, "")
      .split("/")
      .filter((s) => s !== "")
      .at(-1) ?? "object",
  size: 1024,
  contentType: "application/octet-stream",
  updated: now,
  storageClass: Option.none,
});

const copy = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const source = ParsedArgs.requiredPositional(args, 0);
  const destination = ParsedArgs.requiredPositional(args, 1);
  const sourceUrl = GsUrl.isGsUrl(source)
    ? storageUrl(source)
    : Result.err(CommandFailure.invalidValue("SOURCE", source));
  const destinationUrl = GsUrl.isGsUrl(destination)
    ? storageUrl(destination)
    : Result.err(CommandFailure.invalidValue("DESTINATION", destination));
  if (!Result.isOk(sourceUrl) && !Result.isOk(destinationUrl)) {
    return Result.err(
      CommandFailure.invalidValue(
        "DESTINATION",
        "At least one of SOURCE or DESTINATION must be a gs:// URL. gcloud-sim has no local file system.",
      ),
    );
  }
  if (ParsedArgs.boolean(args, "recursive")) {
    return Result.err(
      CommandFailure.invalidState(
        "Recursive cp is not modeled. Use bucket-to-bucket rsync for a bounded prefix copy.",
      ),
    );
  }
  let world = ctx.world;
  const sourceObject: Result<StorageObject, CommandFailure> = Result.isOk(sourceUrl)
    ? Result.flatMap(requireBucket(ctx, sourceUrl.value.bucket), (bucket) => {
        const permission = storagePermission(ctx, bucket, "storage.objects.get");
        if (!permission.ok) {
          return permission;
        }
        world = trackBucket(world, bucket.name);
        const version = world.storageLab.versions.find(
          (v) =>
            v.bucket === bucket.name &&
            v.name === sourceUrl.value.object &&
            v.state !== "SOFT_DELETED" &&
            (sourceUrl.value.generation === undefined
              ? v.state === "LIVE"
              : v.generation === sourceUrl.value.generation),
        );
        if (version) {
          const key = keyAccess(world, bucket, version.kmsKey, "Decrypt");
          if (!key.ok) {
            return Result.err(CommandFailure.invalidState(key.error));
          }
        }
        return Option.toResult(
          Option.fromNullable(version ? versionObject(version) : undefined),
          () =>
            CommandFailure.notFoundWith(
              `The following URLs matched no objects or files:\n-${source}`,
            ),
        );
      })
    : Result.ok(objectFromLocal(source, ctx.now));
  if (!Result.isOk(sourceObject)) return sourceObject;
  if (!Result.isOk(destinationUrl)) {
    return Result.ok({
      world,
      output: CommandOutput.messages(
        OutputMessage.plain(`Copying ${source} to file://${destination}`),
        OutputMessage.plain("  Completed files 1/1 | 1.0kiB/1.0kiB"),
      ),
    });
  }
  const bucket = requireBucket(ctx, destinationUrl.value.bucket);
  if (!Result.isOk(bucket)) return bucket;
  const permission = storagePermission(ctx, bucket.value, "storage.objects.create");
  if (!permission.ok) {
    return permission;
  }
  if (destinationUrl.value.generation !== undefined) {
    return Result.err(
      CommandFailure.invalidValue(
        "DESTINATION",
        "Destination must be a live object URL without a generation suffix.",
      ),
    );
  }
  const targetName =
    destinationUrl.value.object === "" || destinationUrl.value.object.endsWith("/")
      ? `${destinationUrl.value.object}${sourceObject.value.name}`
      : destinationUrl.value.object;
  const stored: StorageObject = { ...sourceObject.value, name: targetName, updated: ctx.now };
  if (bucket.value.objects.some((o) => o.name === targetName)) {
    const deletion = storagePermission(ctx, bucket.value, "storage.objects.delete");
    if (!deletion.ok) {
      return deletion;
    }
  }
  const expected = ParsedArgs.integer(args, "if-generation-match");
  if (expected.some && (!Number.isSafeInteger(expected.value) || expected.value < 0)) {
    return Result.err(
      CommandFailure.invalidValue("--if-generation-match", "Expected nonnegative integer."),
    );
  }
  return Result.map(
    Result.mapErr(
      putObject(
        world,
        bucket.value.name,
        stored,
        ctx.now,
        Option.isSome(ParsedArgs.string(args, "encryption-key"))
          ? Option.unwrapOr(ParsedArgs.string(args, "encryption-key"), "")
          : undefined,
        expected.some ? expected.value : undefined,
      ),
      CommandFailure.invalidState,
    ),
    (world) => ({
      world,
      output: CommandOutput.messages(
        OutputMessage.plain(
          `Copying ${GsUrl.isGsUrl(source) ? source : `file://${source}`} to gs://${bucket.value.name}/${targetName}`,
        ),
        OutputMessage.plain("  Completed files 1/1 | 1.0kiB/1.0kiB"),
      ),
    }),
  );
};

const remove = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const url = storageUrl(ParsedArgs.requiredPositional(args, 0));
  if (!Result.isOk(url)) return url;
  const bucket = requireBucket(ctx, url.value.bucket);
  if (!Result.isOk(bucket)) return bucket;
  const recursive = ParsedArgs.boolean(args, "recursive");
  const wantsBucket = url.value.object === "";
  const permission = storagePermission(
    ctx,
    bucket.value,
    wantsBucket ? "storage.buckets.delete" : "storage.objects.delete",
  );
  if (!permission.ok) {
    return permission;
  }
  if (wantsBucket) {
    if (
      ctx.world.lbResources.some(
        (r) =>
          r.kind === "backendBuckets" &&
          r.projectId === bucket.value.projectId &&
          r.bucketName === bucket.value.name,
      )
    ) {
      return Result.err(
        CommandFailure.invalidState(
          "Bucket is still referenced by a backend bucket. Delete the backend bucket first.",
        ),
      );
    }
    if (!recursive && bucket.value.objects.length > 0) {
      return Result.err(
        CommandFailure.invalidState(
          `gs://${bucket.value.name} bucket is not empty. Use --recursive to delete the objects too.`,
        ),
      );
    }
    if (
      ctx.world.storageLab.transfers.some(
        (t) => t.source === bucket.value.name || t.destination === bucket.value.name,
      )
    ) {
      return Result.err(
        CommandFailure.invalidState(
          "Delete referencing transfer jobs before deleting this bucket.",
        ),
      );
    }
    let world = trackBucket(ctx.world, bucket.value.name);
    const active = world.storageLab.versions.filter(
      (v) => v.bucket === bucket.value.name && v.state !== "SOFT_DELETED",
    );
    if (!recursive && active.length > 0) {
      return Result.err(
        CommandFailure.invalidState(
          "Bucket contains noncurrent generations. Delete them explicitly or use --recursive.",
        ),
      );
    }
    if (active.length > 0) {
      const objectsPermission = storagePermission(ctx, bucket.value, "storage.objects.delete");
      if (!objectsPermission.ok) {
        return objectsPermission;
      }
    }
    for (const v of active) {
      const next = deleteObject(world, v.bucket, v.name, ctx.now, v.generation);
      if (!next.ok) {
        return Result.err(CommandFailure.invalidState(next.error));
      }
      world = next.value;
    }
    world = patchStorage(World.withoutBucket(world, bucket.value.name), {
      protections: world.storageLab.protections.filter((p) => p.bucket !== bucket.value.name),
      versions: world.storageLab.versions.filter((v) => v.bucket !== bucket.value.name),
    });
    return Result.ok({
      world,
      output: CommandOutput.messages(
        ...bucket.value.objects.map((o) =>
          OutputMessage.plain(`Removing gs://${bucket.value.name}/${o.name}...`),
        ),
        OutputMessage.plain(`Removing gs://${bucket.value.name}/...`),
      ),
    });
  }
  if (url.value.generation !== undefined && recursive) {
    return Result.err(
      CommandFailure.invalidState("Choose a generation or a recursive live prefix, not both."),
    );
  }
  if (url.value.generation !== undefined) {
    return Result.map(
      Result.mapErr(
        deleteObject(ctx.world, bucket.value.name, url.value.object, ctx.now, url.value.generation),
        CommandFailure.invalidState,
      ),
      (world) => ({
        world,
        output: CommandOutput.messages(
          OutputMessage.plain(`Removing ${ParsedArgs.requiredPositional(args, 0)}...`),
        ),
      }),
    );
  }
  const targets = bucket.value.objects.filter((o) =>
    recursive ? o.name.startsWith(url.value.object) : o.name === url.value.object,
  );
  if (targets.length === 0) {
    return Result.err(
      CommandFailure.notFoundWith(
        `The following URLs matched no objects or files:\n-gs://${bucket.value.name}/${url.value.object}`,
      ),
    );
  }
  let world = ctx.world;
  for (const target of targets) {
    const deleted = deleteObject(world, bucket.value.name, target.name, ctx.now);
    if (!deleted.ok) {
      return Result.err(CommandFailure.invalidState(deleted.error));
    }
    world = deleted.value;
  }
  return Result.ok({
    world,
    output: CommandOutput.messages(
      ...targets.map((o) => OutputMessage.plain(`Removing gs://${bucket.value.name}/${o.name}...`)),
    ),
  });
};

const PublicAccessPreventionFlag = Flag.boolean(
  "public-access-prevention",
  "Sets public access prevention to enforced.",
);

const UrlPositional = Positional.required(
  "URL",
  "The URL of the bucket (gs://BUCKET).",
  Candidates.buckets,
);
const ObjectUrlPositional = Positional.required(
  "URL",
  "The gs:// URL of the object or bucket to delete.",
  Candidates.buckets,
);
const ListPositional = Positional.optional(
  "URL",
  "The URL to list (gs://BUCKET[/PREFIX]). Lists buckets when omitted.",
  Candidates.buckets,
);
const CopyPositionals = [
  Positional.required("SOURCE", "The source path or gs:// URL."),
  Positional.required("DESTINATION", "The destination path or gs:// URL."),
];
const ProtectionFlags = [
  Flag.string("retention-period", "Object retention period, e.g. 1d."),
  Flag.string("soft-delete-duration", "7d to less than 90d, or 0 to disable."),
  Flag.string("default-encryption-key", "Full CryptoKey path in the bucket location."),
];
const CopyProtectionFlags = [
  Flag.integer("if-generation-match", "Destination generation precondition; 0 means absent."),
  Flag.string("encryption-key", "Full destination CMEK CryptoKey path."),
];

export const StorageCommands: readonly CommandSpec[] = [
  storageCommand({
    path: ["gcloud", "storage", "buckets", "create"],
    summary: "Create Cloud Storage buckets.",
    positionals: [UrlPositional],
    flags: [
      ...ProtectionFlags,
      Flag.string("location", "Location for the bucket, e.g. ASIA-NORTHEAST1, ASIA, US."),
      Flag.string(
        "default-storage-class",
        "Default storage class for the bucket (STANDARD, NEARLINE, COLDLINE, ARCHIVE).",
      ),
      Flag.boolean("uniform-bucket-level-access", "Turns on uniform bucket-level access setting."),
      PublicAccessPreventionFlag,
    ],
    permission: "storage.buckets.create",
    run: (ctx, args) =>
      createBucket(ctx, args, {
        location: "location",
        storageClass: "default-storage-class",
        uniformAccess: (a) => Result.ok(ParsedArgs.boolean(a, "uniform-bucket-level-access")),
      }),
  }),
  storageCommand({
    path: ["gcloud", "storage", "buckets", "list"],
    summary: "List Cloud Storage buckets.",
    permission: "storage.buckets.list",
    run: (ctx) =>
      Result.ok({
        world: ctx.world,
        output: CommandOutput.yamlList(
          World.bucketsOf(ctx.world, ctx.project.projectId).map(Bucket.toRecord),
        ),
      }),
  }),
  storageCommand({
    path: ["gcloud", "storage", "buckets", "describe"],
    summary: "Describe a Cloud Storage bucket.",
    positionals: [UrlPositional],
    permission: "storage.buckets.get",
    run: (ctx, args) =>
      Result.flatMap(bucketUrlArg(args), (url) =>
        Result.map(requireBucket(ctx, url.bucket), (bucket) => ({
          world: ctx.world,
          output: CommandOutput.yaml(bucketRecord(ctx.world, bucket)),
        })),
      ),
  }),
  storageCommand({
    path: ["gcloud", "storage", "buckets", "delete"],
    summary: "Delete Cloud Storage buckets.",
    positionals: [UrlPositional],
    flags: [
      Flag.boolean("recursive", "Delete the objects in the bucket too.", { aliases: ["-r"] }),
    ],
    permission: "storage.buckets.delete",
    destructive: true,
    run: remove,
  }),
  ...iamBindingCommands({
    group: ["gcloud", "storage", "buckets"],
    positional: UrlPositional,
    label: (target) => `gs://${target.id}`,
    resolveTarget: bucketTarget,
    permissions: { get: "storage.buckets.getIamPolicy", set: "storage.buckets.setIamPolicy" },
  }),
  storageCommand({
    path: ["gcloud", "storage", "ls"],
    summary: "List Cloud Storage buckets and objects.",
    positionals: [ListPositional],
    flags: [
      Flag.boolean("all-versions", "Include live and noncurrent generations."),
      Flag.boolean("soft-deleted", "List soft-deleted generations."),
      Flag.boolean("long", "Print long listing (size, update time).", { aliases: ["-l"] }),
      Flag.boolean("recursive", "Recursively list the contents.", { aliases: ["-r"] }),
    ],
    permission: "storage.objects.list",
    run: listRun,
  }),
  storageCommand({
    path: ["gcloud", "storage", "cp"],
    summary: "Upload, download, and copy Cloud Storage objects (contents are not stored).",
    positionals: CopyPositionals,
    flags: [
      ...CopyProtectionFlags,
      Flag.boolean("recursive", "Recursively copy the contents of directories.", {
        aliases: ["-r"],
      }),
    ],
    permission: "storage.objects.create",
    run: copy,
  }),
  storageCommand({
    path: ["gcloud", "storage", "rm"],
    summary: "Delete objects and buckets.",
    positionals: [ObjectUrlPositional],
    flags: [
      Flag.boolean("recursive", "Recursively delete the contents of buckets or directories.", {
        aliases: ["-r"],
      }),
    ],
    permission: "storage.objects.delete",
    destructive: true,
    run: remove,
  }),
];

/** `gsutil mb -b on|off` を真偽に読む。 */
const gsutilUniformAccess = (args: ParsedArgs): Result<boolean, CommandFailure> => {
  const raw = ParsedArgs.string(args, "b");
  if (!Option.isSome(raw)) return Result.ok(false);
  if (raw.value === "on") return Result.ok(true);
  if (raw.value === "off") return Result.ok(false);
  return Result.err(CommandFailure.invalidChoice("-b", raw.value, ["on", "off"]));
};

/** `gsutil` の主要コマンドを `gcloud storage` のエイリアスとして受ける（TBD-003）。 */
export const GsutilCommands: readonly CommandSpec[] = [
  storageCommand({
    path: ["gsutil", "mb"],
    summary: "Make buckets (alias of gcloud storage buckets create).",
    positionals: [UrlPositional],
    flags: [
      Flag.string("l", "Location for the bucket.", { aliases: ["-l"] }),
      Flag.string("c", "Default storage class for the bucket.", { aliases: ["-c"] }),
      Flag.string("b", "Uniform bucket-level access (on|off).", { aliases: ["-b"] }),
      PublicAccessPreventionFlag,
    ],
    permission: "storage.buckets.create",
    run: (ctx, args) =>
      createBucket(ctx, args, {
        location: "l",
        storageClass: "c",
        uniformAccess: gsutilUniformAccess,
      }),
  }),
  storageCommand({
    path: ["gsutil", "ls"],
    summary: "List providers, buckets, or objects (alias of gcloud storage ls).",
    positionals: [ListPositional],
    flags: [
      Flag.boolean("long", "Print long listing.", { aliases: ["-l"] }),
      Flag.boolean("recursive", "Recursively list.", { aliases: ["-r"] }),
    ],
    permission: "storage.objects.list",
    run: listRun,
  }),
  storageCommand({
    path: ["gsutil", "cp"],
    summary: "Copy files and objects (alias of gcloud storage cp).",
    positionals: CopyPositionals,
    flags: [
      Flag.boolean("recursive", "Recursive copy.", { aliases: ["-r", "-R"] }),
      Flag.boolean("m", "Parallel (ignored).", { aliases: ["-m"] }),
    ],
    permission: "storage.objects.create",
    run: copy,
  }),
  storageCommand({
    path: ["gsutil", "rm"],
    summary: "Remove objects (alias of gcloud storage rm).",
    positionals: [ObjectUrlPositional],
    flags: [
      Flag.boolean("recursive", "Recursive delete.", { aliases: ["-r", "-R"] }),
      Flag.boolean("m", "Parallel (ignored).", { aliases: ["-m"] }),
    ],
    permission: "storage.objects.delete",
    destructive: true,
    run: remove,
  }),
  targetCommand({
    path: ["gsutil", "iam", "get"],
    summary: "Get the IAM policy of a bucket (alias of gcloud storage buckets get-iam-policy).",
    positionals: [UrlPositional],
    permission: "storage.buckets.getIamPolicy",
    resolveTarget: bucketTarget,
    run: (ctx) =>
      Result.map(
        Option.toResult(World.findPolicy(ctx.world, ctx.target), () =>
          CommandFailure.notFoundWith(`gs://${ctx.target.id} bucket does not exist.`),
        ),
        (policy) => ({ world: ctx.world, output: CommandOutput.yaml(IamPolicy.toRecord(policy)) }),
      ),
  }),
];

/** `--lifecycle-file` / `gsutil lifecycle set FILE` のサンプル。無い名前は本物と同じ no such file。 */
const lifecycleFile = (path: string) => {
  const sample = SampleFile.find(path);
  return Option.isSome(sample) && sample.value.kind === "lifecycle"
    ? Result.ok(sample.value.rules)
    : Result.err(
        CommandFailure.notFoundWith(
          `[Errno 2] No such file or directory: '${path}'\ngcloud-sim: 使えるサンプルは lifecycle.json / lifecycle-nearline.json です（中身は docs/COMMANDS.md）。`,
        ),
      );
};

const replaceBucket = (ctx: ProjectContext, bucket: Bucket, message: string): CommandResult =>
  Result.ok({
    world: World.replaceBucket(ctx.world, bucket),
    output: CommandOutput.messages(OutputMessage.plain(message)),
  });

const updateBucket = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const url = bucketUrlArg(args);
  if (!Result.isOk(url)) return url;
  const bucket = requireBucket(ctx, url.value.bucket);
  if (!Result.isOk(bucket)) return bucket;
  const versioning = ParsedArgs.booleanChoice(args, "versioning");
  const withVersioning = Option.isSome(versioning)
    ? Bucket.withVersioning(bucket.value, versioning.value)
    : bucket.value;
  const lifecyclePath = ParsedArgs.string(args, "lifecycle-file");
  const rules = Option.isSome(lifecyclePath)
    ? lifecycleFile(lifecyclePath.value)
    : Result.ok(withVersioning.lifecycleRules);
  if (!Result.isOk(rules)) return rules;
  const withLifecycle = Bucket.withLifecycleRules(withVersioning, rules.value);
  const rawClass = ParsedArgs.string(args, "default-storage-class");
  const storageClass = Option.isSome(rawClass)
    ? Option.toResult(StorageClass.parse(rawClass.value), () =>
        CommandFailure.invalidValue(
          "--default-storage-class",
          `Invalid storage class: ${rawClass.value}`,
        ),
      )
    : Result.ok(withLifecycle.storageClass);
  if (!Result.isOk(storageClass)) return storageClass;
  const next = Bucket.withAccessSettings(
    Bucket.withStorageClass(withLifecycle, storageClass.value),
    {
      uniformBucketLevelAccess: ParsedArgs.booleanChoice(args, "uniform-bucket-level-access"),
      publicAccessPrevention: ParsedArgs.booleanChoice(args, "public-access-prevention"),
    },
  );
  const world = World.replaceBucket(ctx.world, next);
  return Result.map(
    Result.mapErr(protectionOptions(world, next, args), CommandFailure.invalidState),
    (world) => ({
      world,
      output: CommandOutput.messages(OutputMessage.plain(`Updating gs://${next.name}/...`)),
    }),
  );
};

const updateObject = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const url = bucketUrlArg(args);
  if (!Result.isOk(url)) return url;
  const bucket = requireBucket(ctx, url.value.bucket);
  if (!Result.isOk(bucket)) return bucket;
  const object = bucket.value.objects.find((o) => o.name === url.value.object);
  if (object === undefined) {
    return Result.err(
      CommandFailure.notFoundWith(
        `The following URLs matched no objects or files:\n-gs://${bucket.value.name}/${url.value.object}`,
      ),
    );
  }
  const rawClass = ParsedArgs.string(args, "storage-class");
  const storageClass = Option.isSome(rawClass)
    ? Result.map(
        Option.toResult(StorageClass.parse(rawClass.value), () =>
          CommandFailure.invalidValue(
            "--storage-class",
            `Invalid storage class: ${rawClass.value}`,
          ),
        ),
        (c) => Option.some(c),
      )
    : Result.ok(object.storageClass);
  if (!Result.isOk(storageClass)) return storageClass;
  const contentType = Option.unwrapOr(ParsedArgs.string(args, "content-type"), object.contentType);
  let world = trackBucket(ctx.world, bucket.value.name);
  const current = world.buckets
    .find((b) => b.name === bucket.value.name)
    ?.objects.find((o) => o.name === object.name);
  if (!current) {
    return Result.err(CommandFailure.notFoundWith("Object not found."));
  }
  const updated = { ...current, storageClass: storageClass.value, contentType, updated: ctx.now };
  if (rawClass.some) {
    for (const permission of ["storage.objects.create", "storage.objects.delete"]) {
      const check = storagePermission(ctx, bucket.value, permission);
      if (!check.ok) {
        return check;
      }
    }
    const result = putObject(world, bucket.value.name, updated, ctx.now, current.kmsKey);
    if (!result.ok) {
      return Result.err(CommandFailure.invalidState(result.error));
    }
    world = result.value;
  }
  if (!rawClass.some) {
    const b = world.buckets.find((b) => b.name === bucket.value.name);
    if (!b) {
      return Result.err(CommandFailure.notFoundWith("Bucket not found."));
    }
    world = patchStorage(World.replaceBucket(world, Bucket.withObject(b, updated)), {
      versions: world.storageLab.versions.map((v) =>
        v.bucket === b.name && v.generation === current.generation
          ? { ...v, contentType, updated: ctx.now }
          : v,
      ),
    });
  }
  return Result.ok({
    world,
    output: CommandOutput.messages(
      OutputMessage.plain(`Updating gs://${bucket.value.name}/${object.name}...`),
    ),
  });
};

/**
 * `rsync SRC DST`。gs:// 同士はオブジェクトを写す。ローカル側にはファイルが無いので、
 * ローカル → gs:// は 0 件、gs:// → ローカルは名前だけ出す。
 */
const rsync = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const source = ParsedArgs.requiredPositional(args, 0);
  const destination = ParsedArgs.requiredPositional(args, 1);
  if (!GsUrl.isGsUrl(source) && !GsUrl.isGsUrl(destination)) {
    return Result.err(
      CommandFailure.invalidValue(
        "DESTINATION",
        "At least one of SOURCE or DESTINATION must be a gs:// URL. gcloud-sim has no local file system.",
      ),
    );
  }
  const header = [
    OutputMessage.plain(`Building synchronization state...`),
    OutputMessage.plain("Starting synchronization..."),
  ];
  if (!GsUrl.isGsUrl(source)) {
    if (ParsedArgs.boolean(args, "delete-unmatched-destination-objects")) {
      return Result.err(
        CommandFailure.invalidState("Deletion from an unmodeled local directory is unsupported."),
      );
    }
    const destinationUrl = Result.mapErr(GsUrl.parse(destination), (m) =>
      CommandFailure.invalidValue("DESTINATION", m),
    );
    const target = Result.flatMap(destinationUrl, (u) => requireBucket(ctx, u.bucket));
    if (!Result.isOk(target)) return target;
    return Result.ok({
      world: ctx.world,
      output: CommandOutput.messages(
        ...header,
        OutputMessage.hint(
          "gcloud-sim: ローカルにファイルは無いので、同期したオブジェクトは 0 件です。",
        ),
      ),
    });
  }
  const sourceUrl = Result.mapErr(GsUrl.parse(source), (m) =>
    CommandFailure.invalidValue("SOURCE", m),
  );
  if (!Result.isOk(sourceUrl)) return sourceUrl;
  const sourceBucket = requireBucket(ctx, sourceUrl.value.bucket);
  if (!Result.isOk(sourceBucket)) return sourceBucket;
  for (const permission of ["storage.objects.list", "storage.objects.get"]) {
    const read = storagePermission(ctx, sourceBucket.value, permission);
    if (!read.ok) {
      return read;
    }
  }
  const prefix = sourceUrl.value.object;
  const objects = sourceBucket.value.objects.filter((o) => o.name.startsWith(prefix));
  for (const o of objects) {
    const key = keyAccess(ctx.world, sourceBucket.value, o.kmsKey ?? "", "Decrypt");
    if (!key.ok) {
      return Result.err(CommandFailure.invalidState(key.error));
    }
  }
  if (!GsUrl.isGsUrl(destination)) {
    return Result.ok({
      world: ctx.world,
      output: CommandOutput.messages(
        ...header,
        ...objects.map((o) =>
          OutputMessage.plain(
            `Copying gs://${sourceBucket.value.name}/${o.name} to file://${destination}/${o.name.slice(prefix.length)}`,
          ),
        ),
      ),
    });
  }
  const destinationUrl = Result.mapErr(GsUrl.parse(destination), (m) =>
    CommandFailure.invalidValue("DESTINATION", m),
  );
  if (!Result.isOk(destinationUrl)) return destinationUrl;
  const destinationBucket = requireBucket(ctx, destinationUrl.value.bucket);
  if (!Result.isOk(destinationBucket)) return destinationBucket;
  const write = storagePermission(ctx, destinationBucket.value, "storage.objects.create");
  if (!write.ok) {
    return write;
  }
  const targetPrefix = destinationUrl.value.object;
  const copied = objects.map(
    (o): StorageObject => ({
      ...o,
      name: `${targetPrefix}${o.name.slice(prefix.length)}`,
      updated: ctx.now,
    }),
  );
  const extras = ParsedArgs.boolean(args, "delete-unmatched-destination-objects")
    ? destinationBucket.value.objects.filter(
        (o) => o.name.startsWith(targetPrefix) && !copied.some((c) => c.name === o.name),
      )
    : [];
  if (
    extras.length > 0 ||
    copied.some((o) => destinationBucket.value.objects.some((d) => d.name === o.name))
  ) {
    const deletion = storagePermission(ctx, destinationBucket.value, "storage.objects.delete");
    if (!deletion.ok) {
      return deletion;
    }
  }
  let world = ctx.world;
  for (const o of copied) {
    const next = putObject(world, destinationBucket.value.name, o, ctx.now);
    if (!next.ok) {
      return Result.err(CommandFailure.invalidState(next.error));
    }
    world = next.value;
  }
  for (const o of extras) {
    const next = deleteObject(world, destinationBucket.value.name, o.name, ctx.now);
    if (!next.ok) {
      return Result.err(CommandFailure.invalidState(next.error));
    }
    world = next.value;
  }
  return Result.ok({
    world,
    output: CommandOutput.messages(
      ...header,
      ...copied.map((o, i) =>
        OutputMessage.plain(
          `Copying gs://${sourceBucket.value.name}/${objects[i]?.name ?? ""} to gs://${destinationBucket.value.name}/${o.name}`,
        ),
      ),
      OutputMessage.plain(`  Completed files ${copied.length}/${copied.length}`),
    ),
  });
};

const signUrl = signStorageUrl;

/** `gsutil iam ch MEMBER:ROLE gs://B`。ロールの短縮形（`objectViewer`）は `roles/storage.` を補う。 */
const gsutilIamChange = (ctx: TargetContext, args: ParsedArgs): CommandResult => {
  const spec = ParsedArgs.requiredPositional(args, 0);
  const lastColon = spec.lastIndexOf(":");
  const member = lastColon === -1 ? spec : spec.slice(0, lastColon);
  const rawRole = lastColon === -1 ? "" : spec.slice(lastColon + 1);
  const role = rawRole.startsWith("roles/") ? rawRole : `roles/storage.${rawRole}`;
  const binding = parseBinding(ctx.world, {
    positionals: [],
    flags: { member: { kind: "string", value: member }, role: { kind: "string", value: role } },
  });
  if (!Result.isOk(binding)) return binding;
  const policy = Option.toResult(World.findPolicy(ctx.world, ctx.target), () =>
    CommandFailure.notFoundWith(`gs://${ctx.target.id} bucket does not exist.`),
  );
  if (!Result.isOk(policy)) return policy;
  const remove = ParsedArgs.boolean(args, "d");
  const next = remove
    ? IamPolicy.removeBinding(policy.value, binding.value.role, binding.value.member)
    : Option.some(IamPolicy.addBinding(policy.value, binding.value.role, binding.value.member));
  if (!Option.isSome(next)) {
    return Result.err(
      CommandFailure.notFoundWith(
        "Policy binding with the specified principal, role, and condition not found!",
      ),
    );
  }
  const world = Result.mapErr(World.withPolicy(ctx.world, ctx.target, next.value), (rejected) =>
    rejected.kind === "invalid"
      ? CommandFailure.invalidState(rejected.reason)
      : CommandFailure.notFoundWith(`gs://${ctx.target.id} bucket does not exist.`),
  );
  return Result.map(world, (w) => ({
    world: w,
    output: CommandOutput.messages(
      OutputMessage.plain(`Updated IAM policy for gs://${ctx.target.id}.`),
    ),
  }));
};

const gsutilVersioning = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const state = ParsedArgs.requiredPositional(args, 0);
  if (state !== "on" && state !== "off") {
    return Result.err(CommandFailure.invalidChoice("STATE", state, ["on", "off"]));
  }
  const url = Result.mapErr(GsUrl.parse(ParsedArgs.requiredPositional(args, 1)), (m) =>
    CommandFailure.invalidValue("URL", m),
  );
  if (!Result.isOk(url)) return url;
  const bucket = requireBucket(ctx, url.value.bucket);
  if (!Result.isOk(bucket)) return bucket;
  return replaceBucket(
    ctx,
    Bucket.withVersioning(bucket.value, state === "on"),
    `${state === "on" ? "Enabling" : "Suspending"} versioning for gs://${bucket.value.name}/...`,
  );
};

const gsutilLifecycle = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const rules = lifecycleFile(ParsedArgs.requiredPositional(args, 0));
  if (!Result.isOk(rules)) return rules;
  const url = Result.mapErr(GsUrl.parse(ParsedArgs.requiredPositional(args, 1)), (m) =>
    CommandFailure.invalidValue("URL", m),
  );
  if (!Result.isOk(url)) return url;
  const bucket = requireBucket(ctx, url.value.bucket);
  if (!Result.isOk(bucket)) return bucket;
  return replaceBucket(
    ctx,
    Bucket.withLifecycleRules(bucket.value, rules.value),
    `Setting lifecycle configuration on gs://${bucket.value.name}/...`,
  );
};

/** `gsutil acl ch -u USER:R gs://B`。`R` は R / W / O（READER / WRITER / OWNER）。 */
const gsutilAcl = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const grant = Option.or(ParsedArgs.string(args, "u"), ParsedArgs.string(args, "g"));
  if (!Option.isSome(grant)) return Result.err(CommandFailure.mustBeSpecified("-u or -g"));
  const colon = grant.value.lastIndexOf(":");
  const entity = colon === -1 ? grant.value : grant.value.slice(0, colon);
  const roleLetter = colon === -1 ? "" : grant.value.slice(colon + 1).toUpperCase();
  const roles: Readonly<Record<string, AclEntry["role"]>> = {
    R: "READER",
    READ: "READER",
    W: "WRITER",
    WRITE: "WRITER",
    O: "OWNER",
    FC: "OWNER",
  };
  const role = roles[roleLetter];
  if (role === undefined) {
    return Result.err(
      CommandFailure.invalidValue(
        "-u",
        `Invalid permission "${roleLetter}". Use R, W or O (e.g. -u user@example.com:R).`,
      ),
    );
  }
  const url = Result.mapErr(GsUrl.parse(ParsedArgs.requiredPositional(args, 0)), (m) =>
    CommandFailure.invalidValue("URL", m),
  );
  if (!Result.isOk(url)) return url;
  const bucket = requireBucket(ctx, url.value.bucket);
  if (!Result.isOk(bucket)) return bucket;
  if (
    bucket.value.publicAccessPrevention &&
    (entity === "allUsers" || entity === "allAuthenticatedUsers")
  ) {
    return Result.err(
      CommandFailure.invalidState("Public access prevention rejects public ACL grants."),
    );
  }
  const next = Result.mapErr(
    Bucket.withAcl(bucket.value, { entity, role }),
    CommandFailure.unsupportedOperation,
  );
  return Result.flatMap(next, (b) =>
    replaceBucket(ctx, b, `Updated ACL on gs://${b.name}/${url.value.object}`),
  );
};

export const StorageExtraCommands: readonly CommandSpec[] = [
  storageCommand({
    path: ["gcloud", "storage", "buckets", "update"],
    summary:
      "Update Cloud Storage buckets (versioning, lifecycle, storage class, access settings).",
    positionals: [UrlPositional],
    flags: [
      ...ProtectionFlags,
      Flag.boolean("clear-retention-period", "Remove an unlocked retention policy."),
      Flag.boolean("lock-retention-period", "Lock the virtual retention policy irreversibly."),
      Flag.boolean("versioning", "Enable object versioning (--no-versioning to disable)."),
      Flag.string("lifecycle-file", "Path to a lifecycle configuration file (sample files only)."),
      Flag.string("default-storage-class", "Default storage class for the bucket."),
      Flag.boolean(
        "uniform-bucket-level-access",
        "Turn uniform bucket-level access on (--no-... to turn off).",
      ),
      Flag.boolean(
        "public-access-prevention",
        "Enforce public access prevention (--no-... to inherit).",
      ),
    ],
    permission: "storage.buckets.update",
    run: updateBucket,
  }),
  storageCommand({
    path: ["gcloud", "storage", "objects", "update"],
    summary: "Update Cloud Storage objects (storage class, content type).",
    positionals: [Positional.required("URL", "The gs:// URL of the object.")],
    flags: [
      Flag.string("storage-class", "Storage class to set on the object."),
      Flag.string("content-type", "Content type to set on the object."),
    ],
    permission: "storage.objects.update",
    run: updateObject,
  }),
  storageCommand({
    path: ["gcloud", "storage", "rsync"],
    summary:
      "Synchronize content of two buckets/directories (objects are copied between gs:// URLs).",
    positionals: [
      Positional.required("SOURCE", "The source path or gs:// URL."),
      Positional.required("DESTINATION", "The destination path or gs:// URL."),
    ],
    flags: [
      Flag.boolean("recursive", "Recursively synchronize.", { aliases: ["-r"] }),
      Flag.boolean(
        "delete-unmatched-destination-objects",
        "Delete unmatched destination objects, respecting IAM and retention.",
      ),
    ],
    permission: "storage.objects.create",
    run: rsync,
  }),
  storageCommand({
    path: ["gcloud", "storage", "sign-url"],
    summary: "Generate a URL with embedded authentication for an object.",
    positionals: [Positional.required("URL", "The gs:// URL of the object.")],
    flags: [
      Flag.string(
        "duration",
        "The duration the signed URL is valid for, e.g. 10m, 1h (default 1h).",
      ),
      Flag.string("private-key-file", "The service account key file (accepted, not read)."),
      Flag.string("impersonate-service-account", "The service account to sign as."),
    ],
    permission: "storage.objects.get",
    run: signUrl,
  }),
];

export const GsutilExtraCommands: readonly CommandSpec[] = [
  targetCommand({
    path: ["gsutil", "iam", "ch"],
    summary: "Change a bucket's IAM policy, e.g. gsutil iam ch allUsers:objectViewer gs://BUCKET.",
    positionals: [
      Positional.required(
        "MEMBER:ROLE",
        "e.g. user:alice@example.com:objectViewer or allUsers:objectViewer.",
      ),
      UrlPositional,
    ],
    flags: [Flag.boolean("d", "Remove the binding instead of adding it.", { aliases: ["-d"] })],
    permission: "storage.buckets.setIamPolicy",
    resolveTarget: (ctx, args) =>
      bucketTarget(ctx, { ...args, positionals: args.positionals.slice(1) }),
    run: gsutilIamChange,
  }),
  storageCommand({
    path: ["gsutil", "rsync"],
    summary: "Synchronize content of two buckets/directories (alias of gcloud storage rsync).",
    positionals: [
      Positional.required("SOURCE", "The source path or gs:// URL."),
      Positional.required("DESTINATION", "The destination path or gs:// URL."),
    ],
    flags: [
      Flag.boolean("recursive", "Recursive sync.", { aliases: ["-r"] }),
      Flag.boolean("d", "Delete extra objects at the destination (accepted, not simulated).", {
        aliases: ["-d"],
      }),
      Flag.boolean("m", "Parallel (ignored).", { aliases: ["-m"] }),
    ],
    permission: "storage.objects.create",
    run: rsync,
  }),
  storageCommand({
    path: ["gsutil", "lifecycle", "set"],
    summary: "Set lifecycle configuration for a bucket from a file (sample files only).",
    positionals: [
      Positional.required("CONFIG_FILE", "Lifecycle configuration JSON, e.g. lifecycle.json."),
      UrlPositional,
    ],
    permission: "storage.buckets.update",
    run: gsutilLifecycle,
  }),
  storageCommand({
    path: ["gsutil", "versioning", "set"],
    summary: "Enable or disable versioning for a bucket.",
    positionals: [Positional.required("STATE", "on or off."), UrlPositional],
    permission: "storage.buckets.update",
    run: gsutilVersioning,
  }),
  storageCommand({
    path: ["gsutil", "acl", "ch"],
    summary: "Change bucket or object ACLs (rejected on buckets with uniform bucket-level access).",
    positionals: [Positional.required("URL", "The gs:// URL of the bucket or object.")],
    flags: [
      Flag.string("u", "Grant a user permission, e.g. -u alice@example.com:R.", {
        aliases: ["-u"],
      }),
      Flag.string("g", "Grant a group permission, e.g. -g ops@example.com:R.", { aliases: ["-g"] }),
    ],
    permission: "storage.buckets.update",
    run: gsutilAcl,
  }),
];
