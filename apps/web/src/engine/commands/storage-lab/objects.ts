import { CommandFailure } from "@/engine/cli/command-failure";
import {
  type AuthorizedContext,
  type CommandResult,
  type CommandSpec,
  Flag,
  ParsedArgs,
  Positional,
  type ProjectContext,
} from "@/engine/cli/command-spec";
import { projectCommand, targetCommand } from "@/engine/commands/shared";
import { StorageClass } from "@/engine/domains/catalog";
import { allows } from "@/engine/domains/serverless-lab/runtime";
import type { Bucket as BucketType } from "@/engine/domains/storage";
import {
  deleteObject,
  keyAccess,
  patchStorage,
  putObject,
  storageAllows,
  trackBucket,
} from "@/engine/domains/storage-lab/model";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";
import {
  duration,
  storageFinish,
  storageNow,
  storagePermission,
  storageUrl,
  versionObject,
} from "./runtime";

const objectCommand = (
  path: readonly string[],
  permissions: readonly string[],
  run: (ctx: AuthorizedContext, bucket: BucketType, args: ParsedArgs) => CommandResult,
  flags: readonly import("@/engine/cli/command-spec").FlagSpec[] = [],
): CommandSpec =>
  targetCommand({
    path,
    summary: "Configure or inspect virtual object generations; no cloud requests.",
    permissions,
    positionals: [
      Positional.required("URL", "gs://BUCKET/OBJECT[#GENERATION]", (world) => [
        ...world.buckets.flatMap((b) => [
          `gs://${b.name}/`,
          ...b.objects.map((o) => `gs://${b.name}/${o.name}`),
        ]),
        ...world.storageLab.versions.map((v) => `gs://${v.bucket}/${v.name}#${v.generation}`),
      ]),
    ],
    flags: [
      ...flags,
      ...(path[0] === "sim"
        ? [Flag.string("project", "Project."), Flag.string("account", "Principal.")]
        : []),
    ],
    resolveTarget: (ctx, a) =>
      Result.flatMap(storageUrl(ParsedArgs.requiredPositional(a, 0)), (u) => {
        const b = ctx.world.buckets.find((b) => b.name === u.bucket);
        return b
          ? Result.ok({ type: "bucket" as const, id: b.name })
          : Result.err(CommandFailure.notFoundWith("Bucket not found."));
      }),
    run: (ctx, a) => {
      const b = ctx.world.buckets.find((b) => b.name === ctx.target.id);
      if (!b) {
        return Result.err(CommandFailure.notFoundWith("Bucket not found."));
      }
      if (!World.hasApi(ctx.world, b.projectId, "storage.googleapis.com")) {
        return Result.err(
          CommandFailure.apiDisabled("Cloud Storage API", "storage.googleapis.com", b.projectId),
        );
      }
      for (const permission of permissions) {
        const check = storagePermission(ctx, b, permission);
        if (!check.ok) {
          return check;
        }
      }
      return run({ ...ctx, now: storageNow(ctx) }, b, a);
    },
  });
export const signStorageUrl = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  if (ctx.world.storageLab.signed.length >= 100) {
    return Result.err(
      CommandFailure.invalidState("Virtual signed URL metadata limit reached (100)."),
    );
  }
  const url = storageUrl(ParsedArgs.requiredPositional(args, 0));
  if (!url.ok) {
    return url;
  }
  const bucket = ctx.world.buckets.find((b) => b.name === url.value.bucket);
  if (!bucket?.objects.some((o) => o.name === url.value.object)) {
    return Result.err(CommandFailure.notFoundWith("The URL matched no objects."));
  }
  if (ParsedArgs.has(args, "private-key-file")) {
    return Result.err(
      CommandFailure.invalidState(
        "Private key files are not read. Use a modeled service account with signBlob permission.",
      ),
    );
  }
  if (url.value.generation !== undefined) {
    return Result.err(
      CommandFailure.invalidState("Signing specific generations is not supported in this lesson."),
    );
  }
  const signer = Option.unwrapOr(
    ParsedArgs.string(args, "impersonate-service-account"),
    ctx.principal,
  );
  const account = ctx.world.serviceAccounts.find((s) => s.email === signer);
  if (!account) {
    return Result.err(
      CommandFailure.invalidState(
        "Choose an existing modeled service account with --impersonate-service-account.",
      ),
    );
  }
  if (!World.hasApi(ctx.world, account.projectId, "iamcredentials.googleapis.com")) {
    return Result.err(
      CommandFailure.apiDisabled(
        "IAM Service Account Credentials API",
        "iamcredentials.googleapis.com",
        account.projectId,
      ),
    );
  }
  if (
    !allows(
      ctx.world,
      account.projectId,
      ctx.principal,
      "iam.serviceAccounts.signBlob",
      account.iamPolicy,
    )
  ) {
    return Result.err(
      CommandFailure.permissionDenied({
        permission: "iam.serviceAccounts.signBlob",
        target: { type: "service-account", id: signer },
        rolesIncluding: ["roles/iam.serviceAccountTokenCreator"],
      }),
    );
  }
  const read = storagePermission(ctx, bucket, "storage.objects.get", signer);
  if (!read.ok) {
    return read;
  }
  const seconds = duration(Option.unwrapOr(ParsedArgs.string(args, "duration"), "1h"));
  if (!seconds.ok || seconds.value < 1 || seconds.value > 43200) {
    return Result.err(
      CommandFailure.invalidValue(
        "--duration",
        "System-managed signing supports 1s through 12h; default 1h.",
      ),
    );
  }
  const world = trackBucket(ctx.world, bucket.name);
  const generation =
    world.storageLab.versions.find(
      (v) => v.bucket === bucket.name && v.name === url.value.object && v.state === "LIVE",
    )?.generation ?? 0;
  const id = `signed-${world.storageLab.nextGeneration}`;
  const expires = new Date(Date.parse(ctx.now) + seconds.value * 1000).toISOString();
  const signed = {
    id,
    projectId: bucket.projectId,
    bucket: bucket.name,
    object: url.value.object,
    generation,
    signer,
    created: ctx.now,
    expires,
    verified: false,
    expired: false,
  };
  return storageFinish(
    patchStorage(world, {
      signed: [...world.storageLab.signed, signed],
      nextGeneration: world.storageLab.nextGeneration + 1,
    }),
    {
      id,
      expiration: expires,
      http_verb: "GET",
      resource: `gs://${bucket.name}/${url.value.object}`,
      signed_url: `https://storage.googleapis.com/${bucket.name}/${encodeURIComponent(url.value.object)}?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Expires=${seconds.value}&generation=${generation}&X-Goog-Signature=SIMULATED-${id}`,
      model: "Virtual signature only; this URL cannot authenticate real requests.",
    },
  );
};
const restore = (soft: boolean): CommandSpec =>
  objectCommand(
    soft ? ["gcloud", "storage", "restore"] : ["sim", "storage", "versions", "restore"],
    ["storage.objects.get", "storage.objects.create", ...(soft ? ["storage.objects.restore"] : [])],
    (ctx, bucket, a) =>
      Result.flatMap(storageUrl(ParsedArgs.requiredPositional(a, 0)), (u) => {
        const world = trackBucket(ctx.world, bucket.name);
        const v = world.storageLab.versions.find(
          (v) => v.bucket === bucket.name && v.name === u.object && v.generation === u.generation,
        );
        if (
          !v ||
          v.state !== (soft ? "SOFT_DELETED" : "NONCURRENT") ||
          (soft && Date.parse(ctx.now) >= Date.parse(v.expires))
        ) {
          return Result.err(
            CommandFailure.invalidState(
              "Requested restorable generation is unavailable or expired.",
            ),
          );
        }
        if (bucket.objects.some((o) => o.name === v.name)) {
          if (!ParsedArgs.boolean(a, "allow-overwrite")) {
            return Result.err(
              CommandFailure.invalidState(
                "Live object exists; choose --allow-overwrite and hold delete permission.",
              ),
            );
          }
          const deletion = storagePermission(ctx, bucket, "storage.objects.delete");
          if (!deletion.ok) {
            return deletion;
          }
        }
        const key = keyAccess(world, bucket, v.kmsKey, "Decrypt");
        if (!key.ok) {
          return Result.err(CommandFailure.invalidState(key.error));
        }
        return Result.flatMap(
          Result.mapErr(
            putObject(world, bucket.name, versionObject(v), ctx.now, v.kmsKey),
            CommandFailure.invalidState,
          ),
          (world) =>
            storageFinish(world, {
              restoredFrom: v.generation,
              liveGeneration: world.storageLab.nextGeneration - 1,
              state: "LIVE",
              model: "New live generation; historical source is preserved.",
            }),
        );
      }),
    [Flag.boolean("allow-overwrite", "Replace an existing live object with delete permission.")],
  );
export const ObjectStorageCommands: readonly CommandSpec[] = [
  objectCommand(
    ["gcloud", "storage", "objects", "describe"],
    ["storage.objects.get"],
    (ctx, bucket, a) =>
      Result.flatMap(storageUrl(ParsedArgs.requiredPositional(a, 0)), (u) => {
        const world = trackBucket(ctx.world, bucket.name);
        const v = world.storageLab.versions.find(
          (v) =>
            v.bucket === bucket.name &&
            v.name === u.object &&
            (u.generation === undefined ? v.state === "LIVE" : v.generation === u.generation) &&
            (v.state !== "SOFT_DELETED" || ParsedArgs.boolean(a, "soft-deleted")),
        );
        if (!v) {
          return Result.err(CommandFailure.notFoundWith("Object generation not found."));
        }
        return storageFinish(world, { ...v, generation: String(v.generation) });
      }),
    [Flag.boolean("soft-deleted", "Describe a soft-deleted generation.")],
  ),
  restore(true),
  restore(false),
  objectCommand(
    ["sim", "storage", "access", "check"],
    ["storage.buckets.get"],
    (ctx, bucket, a) => {
      const principal = Option.unwrapOr(ParsedArgs.string(a, "principal"), ctx.principal);
      const transport = Option.unwrapOr(ParsedArgs.string(a, "transport"), "https");
      const permission = "storage.objects.get";
      const publicAllowed =
        !bucket.publicAccessPrevention && storageAllows(ctx.world, bucket, "anonymous", permission);
      const direct =
        principal !== "anonymous" && storageAllows(ctx.world, bucket, principal, permission);
      const url = storageUrl(ParsedArgs.requiredPositional(a, 0));
      if (!url.ok) {
        return url;
      }
      const object = bucket.objects.find((o) => o.name === url.value.object);
      if (!object || url.value.generation !== undefined) {
        return Result.err(
          CommandFailure.notFoundWith("Access diagnostic requires an existing live object URL."),
        );
      }
      const legacyAcl =
        !bucket.uniformBucketLevelAccess &&
        bucket.acl.some(
          (entry) =>
            ["READER", "OWNER"].includes(entry.role) &&
            (entry.entity === principal ||
              (!bucket.publicAccessPrevention &&
                ["allUsers", "allAuthenticatedUsers"].includes(entry.entity))),
        );
      const allowed =
        transport === "https" &&
        (direct || publicAllowed || legacyAcl) &&
        keyAccess(ctx.world, bucket, object.kmsKey ?? "", "Decrypt").ok;
      const reason = transport !== "https" ? "lesson-requires-https" : "IAM/PAP";
      return storageFinish(
        patchStorage(ctx.world, {
          decisions: [
            ...ctx.world.storageLab.decisions.filter(
              (d) => d.name !== `access:${bucket.name}:${principal}`,
            ),
            {
              projectId: bucket.projectId,
              name: `access:${bucket.name}:${principal}`,
              workload: "access",
              service: allowed ? "allowed" : "denied",
              protection: reason,
            },
          ],
        }),
        {
          allowed,
          reason,
          principal,
          transport,
          model: "HTTPS is this exercise's security criterion; no HTTP request is sent.",
        },
      );
    },
    [
      Flag.string("principal", "Principal to evaluate, or anonymous."),
      Flag.enum("transport", "Lesson transport choice.", ["https", "http"]),
    ],
  ),
  objectCommand(
    ["sim", "storage", "lifecycle", "run"],
    ["storage.buckets.update"],
    (ctx, bucket) => {
      let world = trackBucket(ctx.world, bucket.name);
      let processed = 0;
      const live = world.storageLab.versions.filter(
        (v) => v.bucket === bucket.name && v.state === "LIVE",
      );
      for (const v of live) {
        const age = (Date.parse(ctx.now) - Date.parse(v.created)) / 86400000;
        const rule = bucket.lifecycleRules.find((r) => r.condition.age <= age);
        if (!rule) {
          continue;
        }
        if (rule.action.type === "SetStorageClass" && rule.action.storageClass === v.storageClass) {
          continue;
        }
        const result =
          rule.action.type === "Delete"
            ? deleteObject(world, bucket.name, v.name, ctx.now)
            : putObject(
                world,
                bucket.name,
                { ...versionObject(v), storageClass: StorageClass.parse(rule.action.storageClass) },
                ctx.now,
                v.kmsKey,
              );
        if (!result.ok) {
          return Result.err(CommandFailure.invalidState(result.error));
        }
        world = result.value;
        processed++;
      }
      return storageFinish(
        patchStorage(world, {
          decisions: [
            ...world.storageLab.decisions.filter((d) => d.name !== `lifecycle:${bucket.name}`),
            {
              projectId: bucket.projectId,
              name: `lifecycle:${bucket.name}`,
              workload: "lifecycle",
              service: "storage",
              protection: "applied",
            },
          ],
        }),
        { processed, execution: "Explicit lifecycle evaluation of live objects at virtual time." },
      );
    },
  ),
  projectCommand({
    path: ["sim", "storage", "time", "advance"],
    summary: "Advance shared virtual time; no automatic jobs.",
    permission: "storage.buckets.get",
    requiredApis: ["storage.googleapis.com"],
    flags: [
      Flag.integer("seconds", "1..31536000 virtual seconds.", { required: true }),
      Flag.string("project", "Project."),
      Flag.string("account", "Principal."),
    ],
    run: (ctx, a) => {
      const seconds = Option.unwrapOr(ParsedArgs.integer(a, "seconds"), 0);
      if (
        seconds < 1 ||
        seconds > 31536000 ||
        ctx.world.dataProcessing.clock + seconds > 3153600000
      ) {
        return Result.err(
          CommandFailure.invalidValue(
            "--seconds",
            "Expected 1..31536000 within the virtual clock limit.",
          ),
        );
      }
      const world = {
        ...ctx.world,
        dataProcessing: {
          ...ctx.world.dataProcessing,
          clock: ctx.world.dataProcessing.clock + seconds,
        },
      };
      return storageFinish(world, {
        clock: world.dataProcessing.clock,
        now: storageNow({ ...ctx, world }),
      });
    },
  }),
  projectCommand({
    path: ["sim", "storage", "signed-url", "check"],
    summary: "Inspect a virtual signature and expiry; no URL is fetched.",
    permission: "storage.buckets.get",
    requiredApis: ["storage.googleapis.com"],
    positionals: [
      Positional.required("ID", "Virtual signed URL id.", (w) =>
        w.storageLab.signed.map((s) => s.id),
      ),
    ],
    flags: [Flag.string("project", "Project."), Flag.string("account", "Principal.")],
    run: (ctx, a) => {
      const s = ctx.world.storageLab.signed.find(
        (s) =>
          s.id === ParsedArgs.requiredPositional(a, 0) && s.projectId === ctx.project.projectId,
      );
      if (!s) {
        return Result.err(
          CommandFailure.notFoundWith("Virtual signature not found in this project."),
        );
      }
      const b = ctx.world.buckets.find((b) => b.name === s.bucket);
      const v = ctx.world.storageLab.versions.find(
        (v) =>
          v.bucket === s.bucket &&
          v.name === s.object &&
          v.generation === s.generation &&
          v.state !== "SOFT_DELETED",
      );
      const expired = Date.parse(storageNow(ctx)) >= Date.parse(s.expires);
      const reasonFor = (): string => {
        if (expired) {
          return "expired";
        }
        if (!ctx.world.serviceAccounts.some((account) => account.email === s.signer)) {
          return "signer-unavailable";
        }
        if (!b || !v) {
          return "generation-unavailable";
        }
        if (!storageAllows(ctx.world, b, s.signer, "storage.objects.get")) {
          return "signer-permission-revoked";
        }
        if (!keyAccess(ctx.world, b, v.kmsKey, "Decrypt").ok) {
          return "cmek-unavailable";
        }
        return "available";
      };
      const reason = reasonFor();
      const allowed = reason === "available";
      return storageFinish(
        patchStorage(ctx.world, {
          signed: ctx.world.storageLab.signed.map((v) =>
            v === s ? { ...s, verified: s.verified || allowed, expired: s.expired || expired } : v,
          ),
        }),
        { id: s.id, allowed, reason, expires: s.expires },
      );
    },
  }),
];
