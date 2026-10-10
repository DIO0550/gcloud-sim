import { CommandFailure } from "@/engine/cli/command-failure";
import {
  type CandidateSource,
  CommandOutput,
  type CommandResult,
  type CommandSpec,
  Flag,
  type FlagSpec,
  ParsedArgs,
  Positional,
  type ProjectContext,
} from "@/engine/cli/command-spec";
import { Candidates, projectCommand } from "@/engine/commands/shared";
import { type ApiName, Region } from "@/engine/domains/catalog";
import {
  type DataProcessing,
  type DataTable,
  locations,
  observe,
  patch,
  type Row,
  validateDataProcessing,
} from "@/engine/domains/data-processing/model";
import { allows, apiEnabled } from "@/engine/domains/serverless-lab/runtime";
import { GsUrl } from "@/engine/domains/storage";
import { keyAccess, storageAllows } from "@/engine/domains/storage-lab/model";
import { World } from "@/engine/domains/world";
import type { JsonRecord } from "@/types/Json";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

export const invalid = (s: string) => Result.err(CommandFailure.invalidArgumentWith(s));
export const missing = (s: string) => Result.err(CommandFailure.notFoundWith(s));
export const text = (a: ParsedArgs, key: string, fallback = "") =>
  Option.unwrapOr(ParsedArgs.string(a, key), fallback);
export const integer = (a: ParsedArgs, key: string, fallback: number) =>
  Option.unwrapOr(ParsedArgs.integer(a, key), fallback);
export const name = (a: ParsedArgs) => ParsedArgs.requiredPositional(a, 0);
export const sf = (key: string, required = false, candidates?: CandidateSource): FlagSpec =>
  Flag.string(key, `${key} for this lesson.`, { required, candidates });
export const regionFlag = sf("region", true, Candidates.regions);
export const locationFlag = sf("location", true, () => locations());
export const finish = (world: World, record: JsonRecord): CommandResult =>
  Result.ok({ world, output: CommandOutput.yaml(record) });
export const observed = (
  world: World,
  ctx: ProjectContext,
  resource: string,
  operation: string,
  record: JsonRecord,
): CommandResult =>
  finish(observe(world, ctx.project.projectId, resource, operation, record), record);
export const permit = (ctx: ProjectContext, permissions: readonly string[]) => {
  const absent = permissions.find(
    (p) => !allows(ctx.world, ctx.project.projectId, ctx.principal, p),
  );
  return absent ? invalid(`Permission ${absent} is required.`) : Result.ok(true);
};
export const candidates =
  (
    key: keyof Pick<
      DataProcessing,
      | "datasets"
      | "tables"
      | "jobs"
      | "clusters"
      | "processingJobs"
      | "kafkaClusters"
      | "kafkaTopics"
    >,
  ): CandidateSource =>
  (w, p) => {
    if (!p.some) {
      return [];
    }
    return w.dataProcessing[key]
      .filter((v) => v.projectId === p.value)
      .map((v) => ("dataset" in v ? `${v.dataset}.${v.name}` : v.name));
  };
export const command = (
  path: readonly string[],
  api: ApiName,
  permission: string | readonly string[],
  run: (c: ProjectContext, a: ParsedArgs) => CommandResult,
  flags: readonly FlagSpec[] = [],
  positional = true,
  source?: CandidateSource,
  destructive = false,
): CommandSpec =>
  projectCommand({
    path,
    summary: `${path.join(" ")}: bounded data lesson.`,
    flags: [
      ...flags,
      ...(path[0] === "sim"
        ? [sf("project", false, Candidates.projects), sf("account", false, Candidates.accounts)]
        : []),
      ...(destructive && path[0] === "sim" ? [Flag.boolean("quiet", "Skip confirmation.")] : []),
    ],
    positionals: positional
      ? [Positional.required("NAME", "Resource name, URI or SQL.", source)]
      : [],
    ...(typeof permission === "string" ? { permission } : { permissions: permission }),
    requiredApis: [api],
    destructive,
    run: (ctx, args) =>
      Result.flatMap(run(ctx, args), (v) =>
        Result.map(
          Result.mapErr(validateDataProcessing(v.world), CommandFailure.invalidState),
          () => v,
        ),
      ),
  });
export const datasetArg = (ctx: ProjectContext, value: string, location: string) => {
  if (!locations().includes(location)) {
    return invalid("Unsupported location.");
  }
  const ds = ctx.world.dataProcessing.datasets.find(
    (d) => d.projectId === ctx.project.projectId && d.name === value,
  );
  if (!ds) {
    return missing("Dataset does not exist in the selected project.");
  }
  return ds.location === location
    ? Result.ok(ds)
    : invalid("Dataset location differs from --location.");
};
export const tableRef = (projectId: string, value: string) => {
  const parts = value.split(".");
  if (parts.length === 3 && parts[0] === projectId) {
    parts.shift();
  }
  if (parts.length !== 2 || parts.some((v) => !/^[a-z][a-z0-9_]*$/.test(v))) {
    return invalid("Use dataset.table or selected-project.dataset.table.");
  }
  return Result.ok({ dataset: parts[0] ?? "", name: parts[1] ?? "" });
};
export const tableArg = (ctx: ProjectContext, value: string, location: string) =>
  Result.flatMap(tableRef(ctx.project.projectId, value), (ref) =>
    Result.flatMap(datasetArg(ctx, ref.dataset, location), () => {
      const t = ctx.world.dataProcessing.tables.find(
        (v) =>
          v.projectId === ctx.project.projectId && v.dataset === ref.dataset && v.name === ref.name,
      );
      return t ? Result.ok(t) : missing("Table does not exist.");
    }),
  );
export const saveTable = (w: World, table: DataTable) =>
  patch(w, {
    tables: [
      ...w.dataProcessing.tables.filter(
        (v) =>
          !(
            v.projectId === table.projectId &&
            v.dataset === table.dataset &&
            v.name === table.name
          ),
      ),
      table,
    ],
  });
export const recordJob = (
  world: World,
  ctx: ProjectContext,
  type: "LOAD" | "QUERY" | "EXPORT",
  location: string,
  source: string,
  target: string,
  rows: readonly Row[],
) => {
  const n = World.nextNumber(world);
  const job = {
    projectId: ctx.project.projectId,
    name: `bq-job-${n.number}`,
    location,
    source,
    target,
    rows,
    type,
    state: "DONE" as const,
    error: "",
  };
  return {
    job,
    world: patch(n.world, { jobs: [...n.world.dataProcessing.jobs, job].slice(-100) }),
  };
};
export const storageAccess = (
  ctx: ProjectContext,
  uri: string,
  permission: string,
  principal: string = ctx.principal,
) =>
  Result.flatMap(Result.mapErr(GsUrl.parse(uri), CommandFailure.invalidArgumentWith), (url) => {
    const bucket = ctx.world.buckets.find(
      (b) => b.projectId === ctx.project.projectId && b.name === url.bucket,
    );
    if (
      !bucket ||
      !url.object ||
      !apiEnabled(ctx.world, ctx.project.projectId, "storage.googleapis.com")
    ) {
      return invalid("Storage API and a same-project bucket/object URI are required.");
    }
    if (!storageAllows(ctx.world, bucket, principal, permission)) {
      return invalid(`Permission ${permission} on the bucket is required.`);
    }
    return Result.ok({ bucket, url });
  });
export const readInput = (ctx: ProjectContext, uri: string, principal: string = ctx.principal) =>
  Result.flatMap(storageAccess(ctx, uri, "storage.objects.get", principal), ({ bucket, url }) => {
    const file = ctx.world.dataProcessing.files.find((f) => f.uri === uri);
    const object = bucket.objects.find((o) => o.name === url.object);
    if (
      !file ||
      !object ||
      (file.token !== object.updated && !object.contentType.endsWith(`;sim-token=${file.token}`)) ||
      object.size !== new TextEncoder().encode(file.data).length
    ) {
      return invalid("Input bytes are missing/stale. Use sim storage objects write.");
    }
    const key = keyAccess(ctx.world, bucket, object.kmsKey ?? "", "Decrypt");
    if (!key.ok) {
      return invalid(key.error);
    }
    return Result.ok({ file, bucket });
  });
export const validRegion = (s: string) => Region.parse(s).some;
