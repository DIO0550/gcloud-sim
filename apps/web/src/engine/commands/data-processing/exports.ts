import { type DataTable, type Field, patch } from "@/engine/domains/data-processing/model";
import { type IamMember, IamPolicy } from "@/engine/domains/iam-policy";
import { allows, apiEnabled } from "@/engine/domains/serverless-lab/runtime";
import { World } from "@/engine/domains/world";
import { Result } from "@/utils/Result";
import {
  candidates,
  command,
  datasetArg,
  finish,
  invalid,
  locationFlag,
  name,
  observed,
  recordJob,
  saveTable,
  sf,
  tableRef,
  text,
} from "./shared";

const billingSchema: readonly Field[] = [
  { name: "service", type: "STRING" },
  { name: "cost", type: "FLOAT64" },
  { name: "currency", type: "STRING" },
  { name: "project", type: "STRING" },
];
const logSchema: readonly Field[] = [
  { name: "insert_id", type: "STRING" },
  { name: "method", type: "STRING" },
  { name: "principal", type: "STRING" },
  { name: "severity", type: "STRING" },
];
const compatibleSchema = (t: DataTable | undefined, schema: readonly Field[]) =>
  !t || JSON.stringify(t.schema) === JSON.stringify(schema);
export const ExportCommands = [
  command(
    ["sim", "billing", "exports", "configure"],
    "bigquery.googleapis.com",
    ["bigquery.datasets.get", "billing.resourceAssociations.list"],
    (ctx, a) =>
      Result.flatMap(datasetArg(ctx, name(a), text(a, "location")), (ds) => {
        const account = ctx.project.billingAccountId;
        if (
          !account.some ||
          !ctx.world.billingAccounts.some((b) => b.id === account.value && b.open)
        ) {
          return invalid("An open billing account must be linked.");
        }
        const item = {
          projectId: ctx.project.projectId,
          account: account.value,
          dataset: ds.name,
          location: ds.location,
        };
        return finish(
          patch(ctx.world, {
            billingExports: [
              ...ctx.world.dataProcessing.billingExports.filter(
                (e) => e.projectId !== ctx.project.projectId,
              ),
              item,
            ],
          }),
          item,
        );
      }),
    [locationFlag],
    true,
    candidates("datasets"),
  ),
  command(
    ["sim", "billing", "exports", "run"],
    "bigquery.googleapis.com",
    [
      "bigquery.jobs.create",
      "bigquery.tables.create",
      "bigquery.tables.updateData",
      "billing.resourceAssociations.list",
    ],
    (ctx) => {
      const config = ctx.world.dataProcessing.billingExports.find(
        (e) => e.projectId === ctx.project.projectId,
      );
      if (
        !config ||
        !ctx.project.billingAccountId.some ||
        ctx.project.billingAccountId.value !== config.account ||
        !ctx.world.billingAccounts.some((b) => b.id === config.account && b.open)
      ) {
        return invalid("Configure an export for the current open billing account.");
      }
      const existing = ctx.world.dataProcessing.tables.find(
        (t) =>
          t.projectId === config.projectId &&
          t.dataset === config.dataset &&
          t.name === "gcp_billing_export",
      );
      if (!compatibleSchema(existing, billingSchema)) {
        return invalid("Billing export table schema differs.");
      }
      const rows = [
        { service: "Compute Engine", cost: 12.5, currency: "USD", project: config.projectId },
        { service: "Cloud Storage", cost: 2.5, currency: "USD", project: config.projectId },
      ];
      const table = {
        projectId: config.projectId,
        dataset: config.dataset,
        name: "gcp_billing_export",
        schema: billingSchema,
        rows,
      };
      const job = recordJob(
        saveTable(ctx.world, table),
        ctx,
        "EXPORT",
        config.location,
        "simulated-billing",
        `${config.dataset}.${table.name}`,
        rows,
      );
      return observed(job.world, ctx, job.job.target, "billing-export", { rows, simulated: true });
    },
    [],
    false,
  ),
  command(
    ["sim", "logging", "sinks", "grant-writer"],
    "logging.googleapis.com",
    ["logging.sinks.get", "resourcemanager.projects.setIamPolicy"],
    (ctx, a) => {
      const sink = ctx.world.logSinks.find(
        (s) => s.projectId === ctx.project.projectId && s.name === name(a),
      );
      const destination = sink?.destination.match(
        /^bigquery.googleapis.com\/projects\/([^/]+)\/datasets\/([^/]+)$/,
      );
      if (
        !sink ||
        !destination ||
        destination[1] !== ctx.project.projectId ||
        !datasetArg(ctx, destination[2] ?? "", text(a, "location")).ok
      ) {
        return invalid("Sink must target an existing same-project BigQuery dataset/location.");
      }
      const project = {
        ...ctx.project,
        iamPolicy: IamPolicy.addBinding(
          IamPolicy.addBinding(
            ctx.project.iamPolicy,
            "roles/logging.logWriter",
            sink.writerIdentity as IamMember,
          ),
          "roles/bigquery.dataEditor",
          sink.writerIdentity as IamMember,
        ),
      };
      return finish(World.replaceProject(ctx.world, project), {
        writerIdentity: sink.writerIdentity,
        roles: ["roles/bigquery.dataEditor", "roles/logging.logWriter"],
      });
    },
    [locationFlag],
  ),
  command(
    ["sim", "logging", "sinks", "export"],
    "logging.googleapis.com",
    ["logging.sinks.get", "logging.logEntries.list"],
    (ctx, a) => {
      const sink = ctx.world.logSinks.find(
        (s) => s.projectId === ctx.project.projectId && s.name === name(a),
      );
      const ref = tableRef(ctx.project.projectId, text(a, "table"));
      if (
        !sink ||
        !ref.ok ||
        sink.destination !==
          `bigquery.googleapis.com/projects/${ctx.project.projectId}/datasets/${ref.value.dataset}` ||
        !datasetArg(ctx, ref.value.dataset, text(a, "location")).ok ||
        !apiEnabled(ctx.world, ctx.project.projectId, "bigquery.googleapis.com")
      ) {
        return invalid("Sink/output dataset/location or BigQuery API is missing.");
      }
      const writer = sink.writerIdentity.replace(/^serviceAccount:/, "");
      if (
        !allows(ctx.world, ctx.project.projectId, writer, "bigquery.tables.create") ||
        !allows(ctx.world, ctx.project.projectId, writer, "bigquery.tables.updateData") ||
        !allows(ctx.world, ctx.project.projectId, writer, "logging.logEntries.route")
      ) {
        return invalid("Sink writer needs BigQuery table create/write permission.");
      }
      const existing = ctx.world.dataProcessing.tables.find(
        (t) =>
          t.projectId === ctx.project.projectId &&
          t.dataset === ref.value.dataset &&
          t.name === ref.value.name,
      );
      if (!compatibleSchema(existing, logSchema)) {
        return invalid("Log export table schema differs.");
      }
      const entries = ctx.world.observabilityLab.logs.filter(
        (log) =>
          log.projectId === ctx.project.projectId &&
          (log.kind !== "DATA_ACCESS" ||
            allows(
              ctx.world,
              ctx.project.projectId,
              ctx.principal,
              "logging.privateLogEntries.list",
            )) &&
          ctx.world.observabilityLab.deliveries.some(
            (delivery) =>
              delivery.projectId === log.projectId &&
              delivery.log === log.name &&
              delivery.destination === sink.destination &&
              delivery.state === "STORED",
          ),
      );
      const previous = existing?.rows ?? [];
      const rows = entries
        .filter((e) => !previous.some((r) => r.insert_id === e.name))
        .map((e) => ({
          insert_id: e.name,
          method: e.method,
          principal: e.principal,
          severity: e.severity,
        }));
      if (previous.length + rows.length > 1000) {
        return invalid("Log export row limit exceeded.");
      }
      const table = {
        projectId: ctx.project.projectId,
        ...ref.value,
        schema: logSchema,
        rows: [...previous, ...rows],
      };
      const job = recordJob(
        saveTable(ctx.world, table),
        ctx,
        "EXPORT",
        text(a, "location"),
        sink.name,
        text(a, "table"),
        rows,
      );
      return observed(job.world, ctx, text(a, "table"), "log-export", {
        inserted: rows.length,
        writerIdentity: sink.writerIdentity,
      });
    },
    [locationFlag, sf("table", true, candidates("tables"))],
  ),
];
