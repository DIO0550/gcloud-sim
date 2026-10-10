import { CommandFailure } from "@/engine/cli/command-failure";
import {
  type CommandSpec,
  Flag,
  ParsedArgs,
  Positional,
  type ProjectContext,
} from "@/engine/cli/command-spec";
import { invalid, missing, name, sf, text } from "@/engine/commands/compute-lab/shared";
import { allows } from "@/engine/domains/serverless-lab/runtime";
import { GsUrl } from "@/engine/domains/storage";
import {
  keyAccess,
  patchStorage,
  putObject,
  storageAllows,
  type Transfer,
  transferAgent,
} from "@/engine/domains/storage-lab/model";
import { World } from "@/engine/domains/world";
import { Result } from "@/utils/Result";
import { storageConfig } from "./config";
import { storageFinish, storageNow } from "./runtime";

const api = "storagetransfer.googleapis.com";
const path = ["gcloud", "transfer", "jobs"];
const overwriteFlag = Flag.enum("overwrite-when", "Overwrite rule for destination objects.", [
  "always",
  "different",
  "never",
]);
const overwrite = (a: ParsedArgs, fallback: Transfer["overwrite"] = "DIFFERENT") =>
  text(a, "overwrite-when", fallback).toUpperCase() as Transfer["overwrite"];
const record = (job: Transfer) => ({
  name: job.name,
  projectId: job.projectId,
  status: job.enabled ? "ENABLED" : "DISABLED",
  transferSpec: {
    gcsDataSource: { bucketName: job.source },
    gcsDataSink: { bucketName: job.destination },
    transferOptions: { overwriteWhen: job.overwrite },
  },
  latestOperation: {
    status: job.operation,
    counters: { objectsCopiedToSink: String(job.copied), bytesCopiedToSink: String(job.bytes) },
    error: job.error,
  },
});
const bucketRoot = (c: ProjectContext, value: string): Result<string, string> => {
  const parsed = GsUrl.parse(value);
  if (
    !parsed.ok ||
    parsed.value.object !== "" ||
    !c.world.buckets.some((b) => b.name === parsed.value.bucket)
  ) {
    return Result.err(
      "Use an existing gs://BUCKET root. Prefixes and other source types are unsupported.",
    );
  }
  return Result.ok(parsed.value.bucket);
};
const transferData = (
  c: ProjectContext,
  job: Transfer,
): Result<{ world: World; copied: number; bytes: number }, string> => {
  if (!job.enabled) {
    return Result.err("Transfer job is disabled.");
  }
  const source = c.world.buckets.find((b) => b.name === job.source);
  const destination = c.world.buckets.find((b) => b.name === job.destination);
  if (!source || !destination) {
    return Result.err("Transfer bucket reference no longer exists.");
  }
  const agent = transferAgent(c.world, job.projectId);
  for (const [bucket, permissions] of [
    [source, ["storage.buckets.get", "storage.objects.list", "storage.objects.get"]],
    [destination, ["storage.buckets.get", "storage.objects.create"]],
  ] as const) {
    if (!World.hasApi(c.world, bucket.projectId, "storage.googleapis.com")) {
      return Result.err(`Cloud Storage API is disabled for ${bucket.projectId}.`);
    }
    const denied = permissions.find((p) => !storageAllows(c.world, bucket, agent, p));
    if (denied) {
      return Result.err(`Transfer service agent lacks ${denied} on ${bucket.name}.`);
    }
  }
  let world = c.world;
  let copied = 0;
  let bytes = 0;
  for (const object of source.objects) {
    const current = world.buckets
      .find((b) => b.name === destination.name)
      ?.objects.find((o) => o.name === object.name);
    if (current && job.overwrite === "NEVER") {
      continue;
    }
    // Metadata comparison is the simulator's bounded DIFFERENT rule; no file payloads/checksums exist.
    if (
      current &&
      job.overwrite === "DIFFERENT" &&
      current.size === object.size &&
      current.contentType === object.contentType &&
      current.updated === object.updated
    ) {
      continue;
    }
    if (current && !storageAllows(world, destination, agent, "storage.objects.delete")) {
      return Result.err("Transfer service agent lacks storage.objects.delete for overwrite.");
    }
    const decrypted = keyAccess(world, source, object.kmsKey ?? "", "Decrypt");
    if (!decrypted.ok) {
      return decrypted;
    }
    const result = putObject(world, destination.name, object, storageNow(c));
    if (!result.ok) {
      return result;
    }
    world = result.value;
    copied++;
    bytes += object.size;
  }
  return Result.ok({ world, copied, bytes });
};
const execute = (c: ProjectContext, job: Transfer) => {
  if (!allows(c.world, job.projectId, c.principal, "storagetransfer.jobs.run")) {
    return Result.err(
      CommandFailure.permissionDenied({
        permission: "storagetransfer.jobs.run",
        target: { type: "project", id: job.projectId },
        rolesIncluding: ["roles/storagetransfer.admin"],
      }),
    );
  }
  const data = transferData(c, job);
  let world = c.world;
  let updated: Transfer = { ...job, operation: "FAILED", copied: 0, bytes: 0, error: "" };
  if (data.ok) {
    world = data.value.world;
    updated = {
      ...job,
      operation: "SUCCESS",
      copied: data.value.copied,
      bytes: data.value.bytes,
      error: "",
    };
  }
  if (!data.ok) {
    updated = { ...updated, error: data.error };
  }
  return storageFinish(
    patchStorage(world, {
      transfers: world.storageLab.transfers.map((t) => (t.name === job.name ? updated : t)),
    }),
    record(updated),
  );
};
const create = storageConfig(
  [...path, "create"],
  "storagetransfer.jobs.create",
  api,
  (c, a) => {
    const source = bucketRoot(c, ParsedArgs.requiredPositional(a, 0));
    const destination = bucketRoot(c, ParsedArgs.requiredPositional(a, 1));
    if (!source.ok) {
      return invalid(source.error);
    }
    if (!destination.ok) {
      return invalid(destination.error);
    }
    let sequence = 1;
    while (c.world.storageLab.transfers.some((t) => t.name === `transferJobs/lesson-${sequence}`)) {
      sequence += 1;
    }
    const job: Transfer = {
      projectId: c.project.projectId,
      name: text(a, "name", `transferJobs/lesson-${sequence}`),
      source: source.value,
      destination: destination.value,
      enabled: true,
      overwrite: overwrite(a),
      operation: "NONE",
      copied: 0,
      bytes: 0,
      error: "",
    };
    if (
      !/^transferJobs\/[A-Za-z0-9_-]{1,64}$/.test(job.name) ||
      c.world.storageLab.transfers.some((t) => t.name === job.name)
    ) {
      return invalid("Transfer job name must be a unique transferJobs/NAME.");
    }
    const world = patchStorage(c.world, { transfers: [...c.world.storageLab.transfers, job] });
    if (ParsedArgs.boolean(a, "do-not-run")) {
      return storageFinish(world, record(job));
    }
    return execute({ ...c, world }, job);
  },
  [
    sf("name"),
    overwriteFlag,
    Flag.boolean("do-not-run", "Create configuration without starting a transfer."),
  ],
  false,
);
export const StorageTransferCommands: readonly CommandSpec[] = [
  {
    ...create,
    positionals: [
      Positional.required("SOURCE", "Existing gs://BUCKET root."),
      Positional.required("DESTINATION", "Existing gs://BUCKET root."),
    ],
  },
  ...["run", "describe", "list", "update", "delete"].map((op) =>
    storageConfig(
      [...path, op],
      `storagetransfer.jobs.${op === "describe" ? "get" : op}`,
      api,
      (c, a) => {
        const jobs = c.world.storageLab.transfers.filter(
          (t) => t.projectId === c.project.projectId,
        );
        if (op === "list") {
          const names = ParsedArgs.list(a, "job-names");
          const states = ParsedArgs.list(a, "job-statuses").map((s) => s.toUpperCase());
          if (states.some((s) => !["ENABLED", "DISABLED", "DELETED"].includes(s))) {
            return invalid("Job status must be enabled, disabled or deleted.");
          }
          return storageFinish(c.world, {
            transferJobs: jobs
              .filter(
                (t) =>
                  (names.length === 0 || names.includes(t.name)) &&
                  (states.length === 0 || states.includes(t.enabled ? "ENABLED" : "DISABLED")),
              )
              .map(record),
          });
        }
        const job = jobs.find((t) => t.name === name(a));
        if (!job) {
          return missing("Transfer job not found in this project.");
        }
        if (op === "describe") {
          return storageFinish(c.world, record(job));
        }
        if (op === "run") {
          return execute(c, job);
        }
        if (op === "delete" || text(a, "status") === "deleted") {
          return storageFinish(
            patchStorage(c.world, {
              transfers: c.world.storageLab.transfers.filter((t) => t !== job),
            }),
            { name: job.name, status: "DELETED" },
          );
        }
        const source = text(a, "source") ? bucketRoot(c, text(a, "source")) : Result.ok(job.source);
        const destination = text(a, "destination")
          ? bucketRoot(c, text(a, "destination"))
          : Result.ok(job.destination);
        if (!source.ok) {
          return invalid(source.error);
        }
        if (!destination.ok) {
          return invalid(destination.error);
        }
        const updated = {
          ...job,
          source: source.value,
          destination: destination.value,
          overwrite: overwrite(a, job.overwrite),
          enabled: text(a, "status", job.enabled ? "enabled" : "disabled") === "enabled",
          operation: "NONE" as const,
          copied: 0,
          bytes: 0,
          error: "",
        };
        return storageFinish(
          patchStorage(c.world, {
            transfers: c.world.storageLab.transfers.map((t) => (t === job ? updated : t)),
          }),
          record(updated),
        );
      },
      op === "update"
        ? [
            Flag.enum("status", "Job status.", ["enabled", "disabled", "deleted"]),
            overwriteFlag,
            sf("source"),
            sf("destination"),
          ]
        : op === "run"
          ? [Flag.boolean("no-async", "Return the completed simulated operation.")]
          : op === "list"
            ? [
                Flag.list("job-names", "Filter names."),
                Flag.list("job-statuses", "Filter statuses."),
              ]
            : [],
      op !== "list",
      op === "delete",
    ),
  ),
  storageConfig(
    ["sim", "storage", "transfer-service-agent"],
    "storagetransfer.projects.getServiceAccount",
    api,
    (c) => storageFinish(c.world, { accountEmail: transferAgent(c.world, c.project.projectId) }),
    [],
    false,
  ),
];
