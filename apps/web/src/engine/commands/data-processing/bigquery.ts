import { type CommandSpec, Flag, ParsedArgs, Positional } from "@/engine/cli/command-spec";
import { compatibleLocation, locations, patch } from "@/engine/domains/data-processing/model";
import { parseRows, parseSchema, select } from "@/engine/domains/data-processing/tabular";
import { validIdentifier } from "@/engine/domains/relational/model";
import { Bucket } from "@/engine/domains/storage";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";
import {
  candidates,
  command,
  datasetArg,
  finish,
  integer,
  invalid,
  locationFlag,
  name,
  observed,
  permit,
  readInput,
  recordJob,
  saveTable,
  sf,
  storageAccess,
  tableArg,
  tableRef,
  text,
} from "./shared";

const api = "bigquery.googleapis.com";
const commands: readonly CommandSpec[] = [
  command(
    ["bq", "mk"],
    api,
    [],
    (ctx, a) => {
      const value = name(a);
      const location = text(a, "location");
      const dataset = ParsedArgs.boolean(a, "dataset");
      if (dataset === ParsedArgs.boolean(a, "table") || !locations().includes(location)) {
        return invalid("Specify exactly one of --dataset/--table and a supported --location.");
      }
      if (dataset) {
        const allowed = permit(ctx, ["bigquery.datasets.create"]);
        if (!allowed.ok) {
          return allowed;
        }
        if (
          !validIdentifier(value) ||
          ctx.world.dataProcessing.datasets.some(
            (d) => d.projectId === ctx.project.projectId && d.name === value,
          ) ||
          text(a, "schema")
        ) {
          return invalid("Invalid/duplicate dataset or unsupported dataset schema.");
        }
        const item = { projectId: ctx.project.projectId, name: value, location };
        return finish(
          patch(ctx.world, { datasets: [...ctx.world.dataProcessing.datasets, item] }),
          item,
        );
      }
      const allowed = permit(ctx, ["bigquery.tables.create", "bigquery.datasets.get"]);
      if (!allowed.ok) {
        return allowed;
      }
      const ref = tableRef(ctx.project.projectId, value);
      if (!ref.ok) {
        return ref;
      }
      const ds = datasetArg(ctx, ref.value.dataset, location);
      const schema = parseSchema(text(a, "schema"));
      if (!ds.ok) {
        return ds;
      }
      if (!schema.ok) {
        return invalid(schema.error);
      }
      if (
        ctx.world.dataProcessing.tables.some(
          (t) =>
            t.projectId === ctx.project.projectId &&
            t.dataset === ref.value.dataset &&
            t.name === ref.value.name,
        )
      ) {
        return invalid("Table already exists.");
      }
      const table = {
        projectId: ctx.project.projectId,
        ...ref.value,
        schema: schema.value,
        rows: [],
      };
      return finish(saveTable(ctx.world, table), table);
    },
    [
      Flag.boolean("dataset", "Create a dataset."),
      Flag.boolean("table", "Create a table."),
      locationFlag,
      sf("schema"),
    ],
  ),
  command(
    ["bq", "load"],
    api,
    ["bigquery.jobs.create", "bigquery.tables.get", "bigquery.tables.updateData"],
    (ctx, a) => {
      const target = tableArg(ctx, name(a), text(a, "location"));
      if (!target.ok) {
        return target;
      }
      const source = a.positionals[1] ?? text(a, "source");
      if (a.positionals[1] && text(a, "source")) {
        return invalid("Specify one input URI, as SOURCE or --source.");
      }
      const input = readInput(ctx, source);
      if (!input.ok) {
        return input;
      }
      if (!compatibleLocation(input.value.bucket.location, text(a, "location"))) {
        return invalid("Input bucket and dataset locations differ.");
      }
      const rows = parseRows(
        input.value.file.data,
        target.value.schema,
        text(a, "source_format", "CSV"),
        integer(a, "skip_leading_rows", 0),
      );
      if (!rows.ok) {
        return invalid(rows.error);
      }
      const contents = ParsedArgs.boolean(a, "replace")
        ? rows.value
        : [...target.value.rows, ...rows.value];
      if (contents.length > 1000) {
        return invalid("Table row limit exceeded.");
      }
      const job = recordJob(
        saveTable(ctx.world, { ...target.value, rows: contents }),
        ctx,
        "LOAD",
        text(a, "location"),
        source,
        name(a),
        rows.value,
      );
      return observed(job.world, ctx, name(a), "load", { ...job.job });
    },
    [
      locationFlag,
      sf("source"),
      sf("source_format"),
      Flag.integer("skip_leading_rows", "CSV header rows: 0 or 1."),
      Flag.boolean("replace", "Replace table rows."),
    ],
    true,
    candidates("tables"),
  ),
  command(
    ["bq", "query"],
    api,
    ["bigquery.jobs.create", "bigquery.tables.get", "bigquery.tables.getData"],
    (ctx, a) => {
      if (ParsedArgs.boolean(a, "use_legacy_sql")) {
        return invalid("Legacy SQL is unsupported.");
      }
      const from = /\bFROM\s+[`]?([a-z0-9_.-]+)[`]?/i.exec(name(a));
      if (!from) {
        return invalid("A single FROM dataset.table is required.");
      }
      const table = tableArg(ctx, from[1] ?? "", text(a, "location"));
      if (!table.ok) {
        return table;
      }
      const rows = select(name(a), table.value);
      if (!rows.ok) {
        return invalid(rows.error);
      }
      const job = recordJob(
        ctx.world,
        ctx,
        "QUERY",
        text(a, "location"),
        name(a),
        from[1] ?? "",
        rows.value,
      );
      return observed(job.world, ctx, from[1] ?? "", "query", {
        rows: rows.value,
        job: job.job.name,
      });
    },
    [locationFlag, Flag.boolean("use_legacy_sql", "Legacy SQL is unsupported.")],
  ),
  command(
    ["bq", "ls"],
    api,
    [],
    (ctx, a) => {
      const location = text(a, "location");
      const dataset = a.positionals[0] ?? text(a, "dataset");
      if (a.positionals[0] && text(a, "dataset")) {
        return invalid("Specify one dataset, as DATASET or --dataset.");
      }
      if (!locations().includes(location)) {
        return invalid("Unsupported location.");
      }
      if (ParsedArgs.boolean(a, "jobs")) {
        const allowed = permit(ctx, ["bigquery.jobs.list"]);
        if (!allowed.ok) {
          return allowed;
        }
        if (dataset) {
          return invalid("--jobs cannot be combined with --dataset.");
        }
        return finish(ctx.world, {
          jobs: ctx.world.dataProcessing.jobs.filter(
            (j) => j.projectId === ctx.project.projectId && j.location === location,
          ),
        });
      }
      const allowed = permit(ctx, [
        "bigquery.datasets.get",
        ...(dataset ? ["bigquery.tables.list"] : []),
      ]);
      if (!allowed.ok) {
        return allowed;
      }
      if (!dataset) {
        return finish(ctx.world, {
          datasets: ctx.world.dataProcessing.datasets.filter(
            (d) => d.projectId === ctx.project.projectId && d.location === location,
          ),
        });
      }
      const ds = datasetArg(ctx, dataset, location);
      if (!ds.ok) {
        return ds;
      }
      return finish(ctx.world, {
        tables: ctx.world.dataProcessing.tables.filter(
          (t) => t.projectId === ctx.project.projectId && t.dataset === ds.value.name,
        ),
      });
    },
    [
      locationFlag,
      sf("dataset", false, candidates("datasets")),
      Flag.boolean("jobs", "List retained jobs."),
    ],
    false,
  ),
  command(
    ["bq", "show"],
    api,
    [],
    (ctx, a) => {
      if (ParsedArgs.boolean(a, "job")) {
        const allowed = permit(ctx, ["bigquery.jobs.get"]);
        if (!allowed.ok) {
          return allowed;
        }
        const job = ctx.world.dataProcessing.jobs.find(
          (j) =>
            j.projectId === ctx.project.projectId &&
            j.name === name(a) &&
            j.location === text(a, "location"),
        );
        if (!job || ParsedArgs.boolean(a, "schema")) {
          return invalid("Job does not exist in this location or --schema conflicts with --job.");
        }
        return finish(ctx.world, { ...job });
      }
      if (!name(a).includes(".")) {
        const allowed = permit(ctx, ["bigquery.datasets.get"]);
        if (!allowed.ok) {
          return allowed;
        }
        if (ParsedArgs.boolean(a, "schema")) {
          return invalid("--schema requires a table.");
        }
        return Result.flatMap(datasetArg(ctx, name(a), text(a, "location")), (d) =>
          finish(ctx.world, { ...d }),
        );
      }
      const allowed = permit(ctx, [
        "bigquery.tables.get",
        ...(ParsedArgs.boolean(a, "schema") ? [] : ["bigquery.tables.getData"]),
      ]);
      if (!allowed.ok) {
        return allowed;
      }
      return Result.flatMap(tableArg(ctx, name(a), text(a, "location")), (t) =>
        finish(ctx.world, ParsedArgs.boolean(a, "schema") ? { schema: t.schema } : { ...t }),
      );
    },
    [
      locationFlag,
      Flag.boolean("job", "Describe job."),
      Flag.boolean("schema", "Show schema only."),
    ],
    true,
    candidates("tables"),
  ),
  command(
    ["bq", "rm"],
    api,
    [],
    (ctx, a) => {
      if (name(a).includes(".")) {
        const allowed = permit(ctx, ["bigquery.tables.delete", "bigquery.tables.get"]);
        if (!allowed.ok) {
          return allowed;
        }
        return Result.flatMap(tableArg(ctx, name(a), text(a, "location")), (t) =>
          finish(
            patch(ctx.world, { tables: ctx.world.dataProcessing.tables.filter((v) => v !== t) }),
            { deleted: name(a) },
          ),
        );
      }
      const allowed = permit(ctx, ["bigquery.datasets.delete", "bigquery.datasets.get"]);
      if (!allowed.ok) {
        return allowed;
      }
      return Result.flatMap(datasetArg(ctx, name(a), text(a, "location")), (d) => {
        const tables = ctx.world.dataProcessing.tables.filter(
          (t) => t.projectId === d.projectId && t.dataset === d.name,
        );
        if (
          (tables.length > 0 && !ParsedArgs.boolean(a, "recursive")) ||
          ctx.world.dataProcessing.billingExports.some(
            (e) => e.projectId === d.projectId && e.dataset === d.name,
          )
        ) {
          return invalid("Dataset has tables/export dependencies.");
        }
        return finish(
          patch(ctx.world, {
            datasets: ctx.world.dataProcessing.datasets.filter((v) => v !== d),
            tables: ctx.world.dataProcessing.tables.filter((t) => !tables.includes(t)),
          }),
          { deleted: d.name },
        );
      });
    },
    [locationFlag, Flag.boolean("recursive", "Delete contained tables.")],
    true,
    candidates("datasets"),
    true,
  ),
  command(
    ["sim", "storage", "objects", "write"],
    "storage.googleapis.com",
    "storage.objects.create",
    (ctx, a) => {
      const access = storageAccess(ctx, name(a), "storage.objects.create");
      if (!access.ok) {
        return access;
      }
      const { bucket, url } = access.value;
      if (bucket.objects.some((o) => o.name === url.object)) {
        const overwrite = storageAccess(ctx, name(a), "storage.objects.delete");
        if (!overwrite.ok) {
          return overwrite;
        }
      }
      const data = text(a, "data").replaceAll("\\n", "\n");
      if (
        data.length > 100000 ||
        (ctx.world.dataProcessing.files.length >= 200 &&
          !ctx.world.dataProcessing.files.some((f) => f.uri === name(a)))
      ) {
        return invalid("Teaching input size/file limit exceeded.");
      }
      const numbered = World.nextNumber(ctx.world);
      const token = `${ctx.now}#${numbered.number}`;
      const size = new TextEncoder().encode(data).length;
      const w = World.replaceBucket(
        numbered.world,
        Bucket.withObject(bucket, {
          name: url.object,
          size,
          contentType: "text/plain",
          updated: token,
          storageClass: Option.none,
        }),
      );
      return finish(
        patch(w, {
          files: [
            ...w.dataProcessing.files.filter((f) => f.uri !== name(a)),
            { uri: name(a), data, token },
          ],
        }),
        { uri: name(a), size },
      );
    },
    [sf("data", true)],
  ),
];
export const BigQueryCommands: readonly CommandSpec[] = commands.map((spec) => {
  if (spec.kind === "not-implemented") {
    return spec;
  }
  if (spec.path[1] === "load") {
    return {
      ...spec,
      positionals: [
        ...spec.positionals,
        Positional.optional("SOURCE", "GCS input URI; alternative to --source."),
      ],
    };
  }
  if (spec.path[1] === "ls") {
    return {
      ...spec,
      positionals: [
        Positional.optional("DATASET", "Dataset whose tables to list.", candidates("datasets")),
      ],
    };
  }
  return spec;
});
