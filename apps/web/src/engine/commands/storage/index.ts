import { CommandFailure } from "@/engine/cli/command-failure";
import {
  type CommandContext,
  CommandOutput,
  type CommandResult,
  type CommandSpec,
  Flag,
  OutputMessage,
  ParsedArgs,
  Positional,
  type ProjectContext,
} from "@/engine/cli/command-spec";
import { alreadyExists, iamBindingCommands, projectCommand } from "@/engine/commands/shared";
import { BucketLocation, StorageClass } from "@/engine/domains/catalog";
import { IamPolicy } from "@/engine/domains/iam-policy";
import type { PolicyTarget } from "@/engine/domains/resource-hierarchy";
import { Bucket, GsUrl, type StorageObject } from "@/engine/domains/storage";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const bucketUrlArg = (args: ParsedArgs): Result<GsUrl, CommandFailure> =>
  Result.mapErr(GsUrl.parse(Option.unwrapOr(ParsedArgs.positional(args, 0), "")), (m) =>
    CommandFailure.invalidValue("URL", m),
  );

const requireBucket = (ctx: CommandContext, name: string): Result<Bucket, CommandFailure> =>
  Option.toResult(World.findBucket(ctx.world, name), () =>
    CommandFailure.notFoundWith(`gs://${name} bucket does not exist.`),
  );

const bucketTarget = (
  ctx: CommandContext,
  args: ParsedArgs,
): Result<PolicyTarget, CommandFailure> =>
  Result.flatMap(bucketUrlArg(args), (url) =>
    Result.map(requireBucket(ctx, url.bucket), (b) => ({ type: "bucket", id: b.name })),
  );

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
  return Result.map(
    Result.mapErr(World.withBucket(ctx.world, bucket.value), alreadyExists),
    (world) => ({
      world,
      output: CommandOutput.messages(OutputMessage.plain(`Creating gs://${bucket.value.name}/...`)),
    }),
  );
};

const listUrl = (ctx: ProjectContext, target: Option<GsUrl>, long: boolean): CommandResult => {
  if (!Option.isSome(target)) {
    const lines = World.bucketsOf(ctx.world, ctx.project.projectId).map((b) =>
      OutputMessage.plain(`gs://${b.name}/`),
    );
    return Result.ok({ world: ctx.world, output: CommandOutput.messages(...lines) });
  }
  const bucket = requireBucket(ctx, target.value.bucket);
  if (!Result.isOk(bucket)) return bucket;
  const prefix = target.value.object;
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
  if (!Option.isSome(raw)) return listUrl(ctx, Option.none, long);
  return Result.flatMap(bucketUrlArg(args), (url) => listUrl(ctx, Option.some(url), long));
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
});

const copy = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const source = Option.unwrapOr(ParsedArgs.positional(args, 0), "");
  const destination = Option.unwrapOr(ParsedArgs.positional(args, 1), "");
  const sourceUrl = GsUrl.isGsUrl(source) ? GsUrl.parse(source) : Result.err(source);
  const destinationUrl = GsUrl.isGsUrl(destination)
    ? GsUrl.parse(destination)
    : Result.err(destination);
  if (!Result.isOk(sourceUrl) && !Result.isOk(destinationUrl)) {
    return Result.err(
      CommandFailure.invalidValue(
        "DESTINATION",
        "At least one of SOURCE or DESTINATION must be a gs:// URL. gcloud-sim has no local file system.",
      ),
    );
  }
  const sourceObject: Result<StorageObject, CommandFailure> = Result.isOk(sourceUrl)
    ? Result.flatMap(requireBucket(ctx, sourceUrl.value.bucket), (bucket) =>
        Option.toResult(
          Option.fromNullable(bucket.objects.find((o) => o.name === sourceUrl.value.object)),
          () =>
            CommandFailure.notFoundWith(
              `The following URLs matched no objects or files:\n-${source}`,
            ),
        ),
      )
    : Result.ok(objectFromLocal(source, ctx.now));
  if (!Result.isOk(sourceObject)) return sourceObject;
  if (!Result.isOk(destinationUrl)) {
    return Result.ok({
      world: ctx.world,
      output: CommandOutput.messages(
        OutputMessage.plain(`Copying ${source} to file://${destination}`),
        OutputMessage.plain("  Completed files 1/1 | 1.0kiB/1.0kiB"),
      ),
    });
  }
  const bucket = requireBucket(ctx, destinationUrl.value.bucket);
  if (!Result.isOk(bucket)) return bucket;
  const targetName =
    destinationUrl.value.object === "" || destinationUrl.value.object.endsWith("/")
      ? `${destinationUrl.value.object}${sourceObject.value.name}`
      : destinationUrl.value.object;
  const stored: StorageObject = { ...sourceObject.value, name: targetName, updated: ctx.now };
  return Result.ok({
    world: World.replaceBucket(ctx.world, Bucket.withObject(bucket.value, stored)),
    output: CommandOutput.messages(
      OutputMessage.plain(
        `Copying ${GsUrl.isGsUrl(source) ? source : `file://${source}`} to gs://${bucket.value.name}/${targetName}`,
      ),
      OutputMessage.plain("  Completed files 1/1 | 1.0kiB/1.0kiB"),
    ),
  });
};

const remove = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const url = bucketUrlArg(args);
  if (!Result.isOk(url)) return url;
  const bucket = requireBucket(ctx, url.value.bucket);
  if (!Result.isOk(bucket)) return bucket;
  const recursive = ParsedArgs.boolean(args, "recursive");
  const wantsBucket = url.value.object === "";
  if (wantsBucket) {
    if (!recursive && bucket.value.objects.length > 0) {
      return Result.err(
        CommandFailure.invalidState(
          `gs://${bucket.value.name} bucket is not empty. Use --recursive to delete the objects too.`,
        ),
      );
    }
    return Result.ok({
      world: World.withoutBucket(ctx.world, bucket.value.name),
      output: CommandOutput.messages(
        ...bucket.value.objects.map((o) =>
          OutputMessage.plain(`Removing gs://${bucket.value.name}/${o.name}...`),
        ),
        OutputMessage.plain(`Removing gs://${bucket.value.name}/...`),
      ),
    });
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
  const next = targets.reduce((b, o) => Bucket.withoutObject(b, o.name), bucket.value);
  return Result.ok({
    world: World.replaceBucket(ctx.world, next),
    output: CommandOutput.messages(
      ...targets.map((o) => OutputMessage.plain(`Removing gs://${bucket.value.name}/${o.name}...`)),
    ),
  });
};

const PublicAccessPreventionFlag = Flag.boolean(
  "public-access-prevention",
  "Sets public access prevention to enforced.",
);

const UrlPositional = Positional.required("URL", "The URL of the bucket (gs://BUCKET).");
const ObjectUrlPositional = Positional.required(
  "URL",
  "The gs:// URL of the object or bucket to delete.",
);
const ListPositional = Positional.optional(
  "URL",
  "The URL to list (gs://BUCKET[/PREFIX]). Lists buckets when omitted.",
);
const CopyPositionals = [
  Positional.required("SOURCE", "The source path or gs:// URL."),
  Positional.required("DESTINATION", "The destination path or gs:// URL."),
];

export const StorageCommands: readonly CommandSpec[] = [
  projectCommand({
    path: ["gcloud", "storage", "buckets", "create"],
    summary: "Create Cloud Storage buckets.",
    positionals: [UrlPositional],
    flags: [
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
  projectCommand({
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
  projectCommand({
    path: ["gcloud", "storage", "buckets", "describe"],
    summary: "Describe a Cloud Storage bucket.",
    positionals: [UrlPositional],
    permission: "storage.buckets.get",
    run: (ctx, args) =>
      Result.flatMap(bucketUrlArg(args), (url) =>
        Result.map(requireBucket(ctx, url.bucket), (bucket) => ({
          world: ctx.world,
          output: CommandOutput.yaml(Bucket.toRecord(bucket)),
        })),
      ),
  }),
  projectCommand({
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
  projectCommand({
    path: ["gcloud", "storage", "ls"],
    summary: "List Cloud Storage buckets and objects.",
    positionals: [ListPositional],
    flags: [
      Flag.boolean("long", "Print long listing (size, update time).", { aliases: ["-l"] }),
      Flag.boolean("recursive", "Recursively list the contents.", { aliases: ["-r"] }),
    ],
    permission: "storage.objects.list",
    run: listRun,
  }),
  projectCommand({
    path: ["gcloud", "storage", "cp"],
    summary: "Upload, download, and copy Cloud Storage objects (contents are not stored).",
    positionals: CopyPositionals,
    flags: [
      Flag.boolean("recursive", "Recursively copy the contents of directories.", {
        aliases: ["-r"],
      }),
    ],
    permission: "storage.objects.create",
    run: copy,
  }),
  projectCommand({
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
  projectCommand({
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
  projectCommand({
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
  projectCommand({
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
  projectCommand({
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
  {
    kind: "target",
    path: ["gsutil", "iam", "get"],
    summary: "Get the IAM policy of a bucket (alias of gcloud storage buckets get-iam-policy).",
    positionals: [UrlPositional],
    flags: [],
    destructive: false,
    requiredPermissions: ["storage.buckets.getIamPolicy"],
    resolveTarget: bucketTarget,
    run: (ctx) =>
      Result.map(
        Option.toResult(World.findPolicy(ctx.world, ctx.target), () =>
          CommandFailure.notFoundWith(`gs://${ctx.target.id} bucket does not exist.`),
        ),
        (policy) => ({ world: ctx.world, output: CommandOutput.yaml(IamPolicy.toRecord(policy)) }),
      ),
  },
];
