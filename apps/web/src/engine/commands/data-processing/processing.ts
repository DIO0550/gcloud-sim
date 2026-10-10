import { CommandFailure } from "@/engine/cli/command-failure";
import { CommandOutput, Flag, ParsedArgs, type ProjectContext } from "@/engine/cli/command-spec";
import { Candidates } from "@/engine/commands/shared";
import { ResourceName } from "@/engine/domains/compute";
import {
  GcsTemplate,
  observe,
  type ProcessingJob,
  PubsubTemplate,
  patch,
  type Row,
  SparkJar,
} from "@/engine/domains/data-processing/model";
import { eligible, settings } from "@/engine/domains/data-processing/pubsub";
import { parseRows } from "@/engine/domains/data-processing/tabular";
import { allows, apiEnabled, attachAccount } from "@/engine/domains/serverless-lab/runtime";
import type { World } from "@/engine/domains/world";
import { Result } from "@/utils/Result";
import { subscriptionArg } from "./pubsub";
import {
  candidates,
  command,
  finish,
  integer,
  invalid,
  name,
  observed,
  readInput,
  regionFlag,
  saveTable,
  sf,
  tableArg,
  text,
  validRegion,
} from "./shared";

const putJob = (world: World, job: ProcessingJob) =>
  patch(world, {
    processingJobs: [
      ...world.dataProcessing.processingJobs.filter(
        (j) =>
          !(
            j.projectId === job.projectId &&
            j.kind === job.kind &&
            j.region === job.region &&
            j.name === job.name
          ),
      ),
      job,
    ],
  });
const runtime = (
  ctx: ProjectContext,
  job: ProcessingJob,
): Result<Readonly<{ rows: readonly Row[]; world: World }>, string> => {
  const error = (v: string) => Result.err(v);
  const api = job.kind === "dataflow" ? "dataflow.googleapis.com" : "dataproc.googleapis.com";
  if (
    !apiEnabled(ctx.world, job.projectId, api) ||
    !apiEnabled(ctx.world, job.projectId, "bigquery.googleapis.com") ||
    !allows(ctx.world, job.projectId, job.serviceAccount, `${job.kind}.jobs.update`) ||
    !allows(ctx.world, job.projectId, job.serviceAccount, "bigquery.tables.updateData")
  ) {
    return error("Runtime APIs/worker role/BigQuery write permission are missing.");
  }
  const target = tableArg(ctx, job.output, job.region);
  if (!target.ok) {
    return error("Output table/location is missing.");
  }
  let world = ctx.world;
  let data = "";
  if (job.template === PubsubTemplate) {
    if (
      !apiEnabled(world, job.projectId, "pubsub.googleapis.com") ||
      !allows(world, job.projectId, job.serviceAccount, "pubsub.subscriptions.consume")
    ) {
      return error("Runtime SA needs Pub/Sub subscriber permission and API.");
    }
    const sub = subscriptionArg(ctx, job.input.slice(13));
    if (!sub.ok || sub.value.pushEndpoint.some) {
      return error("A pull subscription is required.");
    }
    const receipts = eligible(world, sub.value);
    if (
      receipts.some(
        (r) =>
          settings(world, sub.value).deadLetterTopic &&
          r.attempts >= settings(world, sub.value).maxAttempts,
      )
    ) {
      return error("Forward exhausted messages to their dead-letter topic before processing.");
    }
    data = receipts
      .map(
        (r) =>
          world.dataProcessing.messages.find(
            (m) => m.projectId === r.projectId && m.name === r.message,
          )?.data ?? "",
      )
      .join("\n");
    world = patch(world, {
      receipts: world.dataProcessing.receipts.map((r) =>
        receipts.includes(r) ? { ...r, state: "ACKED", ackId: "", attempts: r.attempts + 1 } : r,
      ),
    });
  } else {
    const input = readInput(ctx, job.input, job.serviceAccount);
    if (!input.ok || input.value.bucket.location.toLowerCase() !== job.region) {
      return error("Runtime storage permission/input or regional location is missing.");
    }
    data = input.value.file.data;
  }
  const parsed = parseRows(data, target.value.schema, "NEWLINE_DELIMITED_JSON");
  if (!parsed.ok) {
    return parsed;
  }
  const rows = parsed.value.map((r) =>
    Object.fromEntries(
      Object.entries(r).map(([k, v]) => [
        k,
        job.transform === "uppercase" && typeof v === "string" ? v.toUpperCase() : v,
      ]),
    ),
  );
  if (target.value.rows.length + rows.length > 1000) {
    return error("Output row limit exceeded.");
  }
  return Result.ok({
    rows,
    world: saveTable(world, { ...target.value, rows: [...target.value.rows, ...rows] }),
  });
};
const createJob = (ctx: ProjectContext, a: ParsedArgs, kind: ProcessingJob["kind"]) => {
  const region = text(a, "region");
  const jobName = kind === "dataflow" ? name(a) : text(a, "id");
  const cluster =
    kind === "dataproc"
      ? ctx.world.dataProcessing.clusters.find(
          (c) =>
            c.projectId === ctx.project.projectId &&
            c.region === region &&
            c.name === text(a, "cluster"),
        )
      : undefined;
  const serviceAccount =
    kind === "dataflow" ? text(a, "service-account-email") : (cluster?.serviceAccount ?? "");
  if (
    !validRegion(region) ||
    !ResourceName.parse(jobName).ok ||
    (kind === "dataproc" && !cluster) ||
    ctx.world.dataProcessing.processingJobs.some(
      (j) =>
        j.projectId === ctx.project.projectId &&
        j.kind === kind &&
        j.region === region &&
        j.name === jobName,
    )
  ) {
    return invalid("Invalid/duplicate job, region or cluster.");
  }
  const attached = attachAccount(ctx.world, ctx.project.projectId, ctx.principal, serviceAccount);
  if (!attached.ok) {
    return invalid(attached.error);
  }
  const params = ParsedArgs.keyvalue(a, "parameters");
  if (Object.keys(params).some((k) => !["input", "output", "transform"].includes(k))) {
    return invalid("Unsupported template parameter.");
  }
  const template = kind === "dataflow" ? text(a, "gcs-location") : text(a, "jars");
  const input = kind === "dataflow" ? (params.input ?? "") : text(a, "input");
  const output = kind === "dataflow" ? (params.output ?? "") : text(a, "output");
  let transform = kind === "dataflow" ? (params.transform ?? "identity") : "identity";
  if (kind === "dataproc") {
    if (!["sim.Identity", "sim.Uppercase"].includes(text(a, "class"))) {
      return invalid("Only sim.Identity/sim.Uppercase sample classes are supported.");
    }
    transform = text(a, "class") === "sim.Uppercase" ? "uppercase" : "identity";
  }
  if (
    (kind === "dataflow" && ![GcsTemplate, PubsubTemplate].includes(template)) ||
    (kind === "dataproc" && template !== SparkJar) ||
    !["identity", "uppercase"].includes(transform)
  ) {
    return invalid("Unsupported template, sample jar or transform.");
  }
  const target = tableArg(ctx, output, region);
  if (!target.ok) {
    return target;
  }
  if (template === PubsubTemplate) {
    if (!input.startsWith("subscription:") || !subscriptionArg(ctx, input.slice(13)).ok) {
      return invalid("Use input=subscription:EXISTING_SUBSCRIPTION.");
    }
  } else {
    const source = readInput(ctx, input);
    if (!source.ok || source.value.bucket.location.toLowerCase() !== region) {
      return invalid("Input must exist in the job region.");
    }
  }
  const job: ProcessingJob = {
    projectId: ctx.project.projectId,
    name: jobName,
    kind,
    region,
    serviceAccount,
    cluster: cluster?.name ?? "",
    template,
    input,
    output,
    transform: transform as ProcessingJob["transform"],
    state: "QUEUED",
    error: "",
    processed: 0,
  };
  return finish(putJob(ctx.world, job), { ...job });
};
export const ProcessingCommands = [
  command(
    ["gcloud", "dataflow", "jobs", "run"],
    "dataflow.googleapis.com",
    "dataflow.jobs.create",
    (c, a) => createJob(c, a, "dataflow"),
    [
      regionFlag,
      sf("gcs-location", true, () => [GcsTemplate, PubsubTemplate]),
      sf("service-account-email", true, Candidates.serviceAccounts),
      Flag.keyvalue("parameters", "input/output/transform."),
    ],
  ),
  command(
    ["gcloud", "dataproc", "jobs", "submit", "spark"],
    "dataproc.googleapis.com",
    "dataproc.jobs.create",
    (c, a) => createJob(c, a, "dataproc"),
    [
      regionFlag,
      sf("id", true),
      sf("cluster", true, candidates("clusters")),
      sf("jars", true, () => [SparkJar]),
      sf("class", true, () => ["sim.Identity", "sim.Uppercase"]),
      sf("input", true),
      sf("output", true, candidates("tables")),
    ],
    false,
  ),
  ...(["dataflow", "dataproc"] as const).flatMap((kind) =>
    (["list", "describe", "cancel", "advance", "retry"] as const).map((action) => {
      const permission =
        action === "describe"
          ? "get"
          : action === "advance" || action === "retry"
            ? "update"
            : action;
      const api = kind === "dataflow" ? "dataflow.googleapis.com" : "dataproc.googleapis.com";
      const root = action === "advance" || action === "retry" ? "sim" : "gcloud";
      return command(
        [root, kind, "jobs", action],
        api,
        `${kind}.jobs.${permission}`,
        (ctx, a) => {
          const region = text(a, "region");
          if (!validRegion(region)) {
            return invalid("Invalid region.");
          }
          const jobs = ctx.world.dataProcessing.processingJobs.filter(
            (j) => j.projectId === ctx.project.projectId && j.kind === kind && j.region === region,
          );
          if (action === "list") {
            return finish(ctx.world, { jobs });
          }
          const job = jobs.find((j) => j.name === name(a));
          if (!job) {
            return invalid("Job does not exist in this project/region.");
          }
          if (action === "describe") {
            return finish(ctx.world, { ...job });
          }
          if (action === "retry") {
            if (job.state !== "FAILED") {
              return invalid("Only failed jobs can be retried.");
            }
            const next = { ...job, state: "QUEUED" as const, error: "" };
            return finish(putJob(ctx.world, next), { ...next });
          }
          if (!["QUEUED", "RUNNING"].includes(job.state)) {
            return invalid("Only active jobs can advance/cancel.");
          }
          if (action === "cancel" || job.state === "QUEUED") {
            const state = action === "cancel" ? ("CANCELLED" as const) : ("RUNNING" as const);
            const next = { ...job, state };
            return finish(putJob(ctx.world, next), { ...next });
          }
          const result = runtime(ctx, job);
          if (!result.ok) {
            const failed = { ...job, state: "FAILED" as const, error: result.error };
            const world = observe(
              putJob(ctx.world, failed),
              job.projectId,
              job.name,
              `${kind}-failed`,
              failed,
            );
            return Result.ok({
              world,
              output: CommandOutput.yaml({ ...failed }),
              failure: CommandFailure.invalidArgumentWith(result.error),
            });
          }
          const next = { ...job, state: "DONE" as const, processed: result.value.rows.length };
          return observed(putJob(result.value.world, next), ctx, job.name, `${kind}-done`, {
            ...next,
          });
        },
        [regionFlag],
        action !== "list",
        candidates("processingJobs"),
        action === "cancel",
      );
    }),
  ),
  ...(["create", "list", "describe", "update", "delete"] as const).map((action) =>
    command(
      ["gcloud", "dataproc", "clusters", action],
      "dataproc.googleapis.com",
      `dataproc.clusters.${action === "describe" ? "get" : action}`,
      (ctx, a) => {
        const region = text(a, "region");
        if (!validRegion(region)) {
          return invalid("Invalid region.");
        }
        const clusters = ctx.world.dataProcessing.clusters.filter(
          (c) => c.projectId === ctx.project.projectId && c.region === region,
        );
        if (action === "list") {
          return finish(ctx.world, { clusters });
        }
        const existing = clusters.find((c) => c.name === name(a));
        if (action === "create") {
          const workers = integer(a, "num-workers", 2);
          const attached = attachAccount(
            ctx.world,
            ctx.project.projectId,
            ctx.principal,
            text(a, "service-account"),
          );
          if (
            existing ||
            !ResourceName.parse(name(a)).ok ||
            workers < 2 ||
            workers > 20 ||
            !ctx.world.networks.some(
              (n) => n.projectId === ctx.project.projectId && n.name === text(a, "network"),
            ) ||
            !apiEnabled(ctx.world, ctx.project.projectId, "compute.googleapis.com") ||
            !attached.ok
          ) {
            return invalid("Invalid cluster/network/workers/service account or Compute API.");
          }
          const cluster = {
            projectId: ctx.project.projectId,
            name: name(a),
            region,
            network: text(a, "network"),
            workers,
            serviceAccount: attached.value,
          };
          return finish(
            patch(ctx.world, { clusters: [...ctx.world.dataProcessing.clusters, cluster] }),
            cluster,
          );
        }
        if (!existing) {
          return invalid("Cluster does not exist in this region.");
        }
        if (action === "describe") {
          return finish(ctx.world, { ...existing });
        }
        if (action === "delete") {
          if (
            ctx.world.dataProcessing.processingJobs.some(
              (j) =>
                j.projectId === existing.projectId &&
                j.cluster === existing.name &&
                j.region === existing.region &&
                ["QUEUED", "RUNNING"].includes(j.state),
            )
          ) {
            return invalid("Cancel/finish active jobs before deleting a cluster.");
          }
          return finish(
            patch(ctx.world, {
              clusters: ctx.world.dataProcessing.clusters.filter((c) => c !== existing),
            }),
            { deleted: existing.name },
          );
        }
        const workers = integer(a, "num-workers", 0);
        if (workers < 2 || workers > 20) {
          return invalid("Worker count must be 2..20.");
        }
        const cluster = { ...existing, workers };
        return finish(
          patch(ctx.world, {
            clusters: ctx.world.dataProcessing.clusters.map((c) => (c === existing ? cluster : c)),
          }),
          cluster,
        );
      },
      [
        regionFlag,
        ...(action === "create"
          ? [
              sf("network", true, Candidates.networks),
              sf("service-account", true, Candidates.serviceAccounts),
            ]
          : []),
        ...(action === "create" || action === "update"
          ? [Flag.integer("num-workers", "2..20 workers.")]
          : []),
      ],
      action !== "list",
      candidates("clusters"),
      action === "delete",
    ),
  ),
];
