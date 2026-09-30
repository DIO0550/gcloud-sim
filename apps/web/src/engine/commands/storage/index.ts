import { CommandFailure } from "@/engine/cli/command-error";
import {
  type CommandContext,
  CommandOutput,
  type CommandResult,
  type CommandSpec,
  Flag,
  type FlagSpec,
  OutputMessage,
  ParsedArgs,
  Positional,
  type ProjectContext,
} from "@/engine/cli/command-spec";
import { alreadyExists, iamBindingCommands } from "@/engine/commands/shared";
import { BucketLocation, StorageClass } from "@/engine/domains/catalog";
import { IamPolicy } from "@/engine/domains/iam-policy";
import type { PolicyTarget } from "@/engine/domains/resource-hierarchy";
import { Bucket, BucketName, GsUrl, type StorageObject } from "@/engine/domains/storage";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const bucketUrlArg = (args: ParsedArgs, index = 0): Result<GsUrl, CommandFailure> =>
  Result.mapErr(GsUrl.parse(Option.unwrapOr(ParsedArgs.positional(args, index), "")), (m) =>
    CommandFailure.invalidValue("URL", m),
  );

const requireBucket = (ctx: CommandContext, name: string): Result<Bucket, CommandFailure> => {
  const bucket = World.findBucket(ctx.world, name);
  return Option.isSome(bucket)
    ? Result.ok(bucket.value)
    : Result.err(CommandFailure.notFoundMessage(`gs://${name} bucket does not exist.`));
};

const bucketTarget = (
  ctx: CommandContext,
  args: ParsedArgs,
): Result<PolicyTarget, CommandFailure> =>
  Result.flatMap(bucketUrlArg(args), (url) =>
    Result.map(requireBucket(ctx, url.bucket), (b) => ({ type: "bucket", id: b.name })),
  );

const createBucket = (
  ctx: ProjectContext,
  args: ParsedArgs,
  flags: Readonly<{ location: string; storageClass: string }>,
): CommandResult => {
  const url = bucketUrlArg(args);
  if (!Result.isOk(url)) return url;
  const name = Result.mapErr(BucketName.parse(url.value.bucket), (m) =>
    CommandFailure.invalidValue("URL", m),
  );
  if (!Result.isOk(name)) return name;
  const rawLocation = Option.unwrapOr(ParsedArgs.string(args, flags.location), "US");
  const location = BucketLocation.parse(rawLocation);
  if (!Option.isSome(location))
    return Result.err(
      CommandFailure.invalidValue(
        `--${flags.location}`,
        `The specified location constraint is not valid: ${rawLocation}`,
      ),
    );
  const rawClass = Option.unwrapOr(ParsedArgs.string(args, flags.storageClass), "STANDARD");
  const storageClass = StorageClass.parse(rawClass);
  if (!Option.isSome(storageClass))
    return Result.err(
      CommandFailure.invalidValue(`--${flags.storageClass}`, `Invalid storage class: ${rawClass}`),
    );
  const bucket: Bucket = {
    projectId: ctx.project.projectId,
    name: name.value,
    location: location.value,
    storageClass: storageClass.value,
    uniformBucketLevelAccess: ParsedArgs.boolean(args, "uniform-bucket-level-access"),
    publicAccessPrevention: ParsedArgs.boolean(args, "public-access-prevention"),
    iamPolicy: IamPolicy.Empty,
    objects: [],
    timeCreated: ctx.now,
  };
  return Result.map(Result.mapErr(World.withBucket(ctx.world, bucket), alreadyExists), (world) => ({
    world,
    output: CommandOutput.messages(OutputMessage.plain(`Creating gs://${bucket.name}/...`)),
  }));
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
    ? Result.flatMap(requireBucket(ctx, sourceUrl.value.bucket), (bucket) => {
        const object = bucket.objects.find((o) => o.name === sourceUrl.value.object);
        return object === undefined
          ? Result.err(
              CommandFailure.notFoundMessage(
                `The following URLs matched no objects or files:\n-${source}`,
              ),
            )
          : Result.ok(object);
      })
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

const remove = (ctx: ProjectContext, args: ParsedArgs, recursiveFlag: string): CommandResult => {
  const url = bucketUrlArg(args);
  if (!Result.isOk(url)) return url;
  const bucket = requireBucket(ctx, url.value.bucket);
  if (!Result.isOk(bucket)) return bucket;
  const recursive = ParsedArgs.boolean(args, recursiveFlag);
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
      CommandFailure.notFoundMessage(
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

const projectSpec = (
  path: readonly string[],
  summary: string,
  positionals: readonly ReturnType<typeof Positional.required>[],
  flags: readonly FlagSpec[],
  permission: string,
  run: (ctx: ProjectContext, args: ParsedArgs) => CommandResult,
  destructive = false,
): CommandSpec => ({
  kind: "project",
  path,
  summary,
  positionals,
  flags,
  destructive,
  requiredPermissions: [permission],
  requiredApis: [],
  run,
});

const CreateFlags = [
  Flag.boolean("uniform-bucket-level-access", "Turns on uniform bucket-level access setting."),
  Flag.boolean("public-access-prevention", "Sets public access prevention to enforced."),
];

export const StorageCommands: readonly CommandSpec[] = [
  projectSpec(
    ["gcloud", "storage", "buckets", "create"],
    "Create Cloud Storage buckets.",
    [Positional.required("URL", "The URL of the bucket to create (gs://BUCKET).")],
    [
      Flag.string("location", "Location for the bucket, e.g. ASIA-NORTHEAST1, ASIA, US."),
      Flag.string(
        "default-storage-class",
        "Default storage class for the bucket (STANDARD, NEARLINE, COLDLINE, ARCHIVE).",
      ),
      ...CreateFlags,
    ],
    "storage.buckets.create",
    (ctx, args) =>
      createBucket(ctx, args, { location: "location", storageClass: "default-storage-class" }),
  ),
  projectSpec(
    ["gcloud", "storage", "buckets", "list"],
    "List Cloud Storage buckets.",
    [],
    [],
    "storage.buckets.list",
    (ctx) =>
      Result.ok({
        world: ctx.world,
        output: CommandOutput.yamlList(
          World.bucketsOf(ctx.world, ctx.project.projectId).map(Bucket.toRecord),
        ),
      }),
  ),
  projectSpec(
    ["gcloud", "storage", "buckets", "describe"],
    "Describe a Cloud Storage bucket.",
    [Positional.required("URL", "The URL of the bucket to describe.")],
    [],
    "storage.buckets.get",
    (ctx, args) =>
      Result.flatMap(bucketUrlArg(args), (url) =>
        Result.map(requireBucket(ctx, url.bucket), (bucket) => ({
          world: ctx.world,
          output: CommandOutput.yaml(Bucket.toRecord(bucket)),
        })),
      ),
  ),
  projectSpec(
    ["gcloud", "storage", "buckets", "delete"],
    "Delete Cloud Storage buckets.",
    [Positional.required("URL", "The URL of the bucket to delete.")],
    [],
    "storage.buckets.delete",
    (ctx, args) => remove(ctx, args, "recursive"),
    true,
  ),
  ...iamBindingCommands({
    group: ["gcloud", "storage", "buckets"],
    positional: Positional.required("URL", "The URL of the bucket (gs://BUCKET)."),
    label: (target) => `gs://${target.id}`,
    resolveTarget: bucketTarget,
    permissions: { get: "storage.buckets.getIamPolicy", set: "storage.buckets.setIamPolicy" },
  }),
  projectSpec(
    ["gcloud", "storage", "ls"],
    "List Cloud Storage buckets and objects.",
    [
      Positional.optional(
        "URL",
        "The URL to list (gs://BUCKET[/PREFIX]). Lists buckets when omitted.",
      ),
    ],
    [
      Flag.boolean("long", "Print long listing (size, update time).", { aliases: ["-l"] }),
      Flag.boolean("recursive", "Recursively list the contents.", { aliases: ["-r"] }),
    ],
    "storage.objects.list",
    (ctx, args) => {
      const raw = ParsedArgs.positional(args, 0);
      if (!Option.isSome(raw)) return listUrl(ctx, Option.none, ParsedArgs.boolean(args, "long"));
      return Result.flatMap(bucketUrlArg(args), (url) =>
        listUrl(ctx, Option.some(url), ParsedArgs.boolean(args, "long")),
      );
    },
  ),
  projectSpec(
    ["gcloud", "storage", "cp"],
    "Upload, download, and copy Cloud Storage objects (contents are not stored).",
    [
      Positional.required("SOURCE", "The source path or gs:// URL."),
      Positional.required("DESTINATION", "The destination path or gs:// URL."),
    ],
    [
      Flag.boolean("recursive", "Recursively copy the contents of directories.", {
        aliases: ["-r"],
      }),
    ],
    "storage.objects.create",
    copy,
  ),
  projectSpec(
    ["gcloud", "storage", "rm"],
    "Delete objects and buckets.",
    [Positional.required("URL", "The gs:// URL of the object or bucket to delete.")],
    [
      Flag.boolean("recursive", "Recursively delete the contents of buckets or directories.", {
        aliases: ["-r"],
      }),
    ],
    "storage.objects.delete",
    (ctx, args) => remove(ctx, args, "recursive"),
    true,
  ),
];

/** `gsutil` の主要コマンドを `gcloud storage` のエイリアスとして受ける（TBD-003）。 */
export const GsutilCommands: readonly CommandSpec[] = [
  projectSpec(
    ["gsutil", "mb"],
    "Make buckets (alias of gcloud storage buckets create).",
    [Positional.required("URL", "The URL of the bucket to create (gs://BUCKET).")],
    [
      Flag.string("l", "Location for the bucket.", { aliases: ["-l"] }),
      Flag.string("c", "Default storage class for the bucket.", { aliases: ["-c"] }),
      Flag.boolean("b", "Uniform bucket-level access (on|off).", { aliases: ["-b"] }),
      ...CreateFlags,
    ],
    "storage.buckets.create",
    (ctx, args) => createBucket(ctx, args, { location: "l", storageClass: "c" }),
  ),
  projectSpec(
    ["gsutil", "ls"],
    "List providers, buckets, or objects (alias of gcloud storage ls).",
    [Positional.optional("URL", "The URL to list.")],
    [
      Flag.boolean("long", "Print long listing.", { aliases: ["-l"] }),
      Flag.boolean("recursive", "Recursively list.", { aliases: ["-r"] }),
    ],
    "storage.objects.list",
    (ctx, args) => {
      const raw = ParsedArgs.positional(args, 0);
      if (!Option.isSome(raw)) return listUrl(ctx, Option.none, ParsedArgs.boolean(args, "long"));
      return Result.flatMap(bucketUrlArg(args), (url) =>
        listUrl(ctx, Option.some(url), ParsedArgs.boolean(args, "long")),
      );
    },
  ),
  projectSpec(
    ["gsutil", "cp"],
    "Copy files and objects (alias of gcloud storage cp).",
    [
      Positional.required("SOURCE", "The source path or gs:// URL."),
      Positional.required("DESTINATION", "The destination path or gs:// URL."),
    ],
    [
      Flag.boolean("recursive", "Recursive copy.", { aliases: ["-r", "-R"] }),
      Flag.boolean("m", "Parallel (ignored).", { aliases: ["-m"] }),
    ],
    "storage.objects.create",
    copy,
  ),
  projectSpec(
    ["gsutil", "rm"],
    "Remove objects (alias of gcloud storage rm).",
    [Positional.required("URL", "The gs:// URL of the object or bucket to delete.")],
    [
      Flag.boolean("recursive", "Recursive delete.", { aliases: ["-r", "-R"] }),
      Flag.boolean("m", "Parallel (ignored).", { aliases: ["-m"] }),
    ],
    "storage.objects.delete",
    (ctx, args) => remove(ctx, args, "recursive"),
    true,
  ),
  {
    kind: "target",
    path: ["gsutil", "iam", "get"],
    summary: "Get the IAM policy of a bucket (alias of gcloud storage buckets get-iam-policy).",
    positionals: [Positional.required("URL", "The URL of the bucket (gs://BUCKET).")],
    flags: [],
    destructive: false,
    requiredPermissions: ["storage.buckets.getIamPolicy"],
    resolveTarget: bucketTarget,
    run: (ctx, args) =>
      Result.flatMap(bucketUrlArg(args), (url) =>
        Result.map(requireBucket(ctx, url.bucket), (bucket) => ({
          world: ctx.world,
          output: CommandOutput.yaml({
            bindings: bucket.iamPolicy.bindings.map((b) => ({
              members: [...b.members],
              role: b.role,
            })),
            etag: "CAE=",
          }),
        })),
      ),
  },
];
