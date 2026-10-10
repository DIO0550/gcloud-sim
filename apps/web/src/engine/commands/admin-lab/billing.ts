import {
  type CommandContext,
  type CommandSpec,
  Flag,
  ParsedArgs,
  Positional,
} from "@/engine/cli/command-spec";
import { projectCommand } from "@/engine/commands/shared";
import { type BillingExport, observeAdmin, patchAdmin } from "@/engine/domains/admin-lab/model";
import { Budget } from "@/engine/domains/billing-budget";
import { EffectivePermissions } from "@/engine/domains/effective-permissions";
import { Principal } from "@/engine/domains/principal";
import { allows } from "@/engine/domains/serverless-lab/runtime";
import { Result } from "@/utils/Result";
import { finish, invalid, missing, scoped, sf, text } from "./shared";

const billingScope = (ctx: CommandContext, a: ParsedArgs) => {
  const account = ctx.world.billingAccounts.find((b) => b.id === text(a, "billing-account"));
  if (!account) {
    return missing("Billing account not found.");
  }
  return Result.ok(`organizations/${ctx.world.organization.id}`);
};
export const BillingLabCommands: readonly CommandSpec[] = [
  ...["update", "delete"].map((op) =>
    scoped({
      path: ["gcloud", "billing", "budgets", op],
      api: "billingbudgets.googleapis.com",
      permission: `billing.budgets.${op}`,
      scope: billingScope,
      flags: [
        sf("billing-account", true),
        ...(op === "update"
          ? [sf("budget-amount"), sf("display-name"), sf("add-threshold-rule")]
          : []),
      ],
      destructive: op === "delete",
      positionals: [
        Positional.required("BUDGET_ID", "Existing budget ID.", (w) => w.budgets.map(Budget.id)),
      ],
      run: (ctx, a) => {
        const budget = ctx.world.budgets.find(
          (b) =>
            b.billingAccountId === text(a, "billing-account") &&
            Budget.id(b) === ParsedArgs.requiredPositional(a, 0),
        );
        if (!budget) {
          return missing("Budget not found in this billing account.");
        }
        if (op === "delete") {
          return finish(
            { ...ctx.world, budgets: ctx.world.budgets.filter((b) => b !== budget) },
            { deleted: budget.name },
          );
        }
        if (
          !["budget-amount", "display-name", "add-threshold-rule"].some((k) => ParsedArgs.has(a, k))
        ) {
          return invalid("Specify an amount, display name or threshold rule to update.");
        }
        const amount = ParsedArgs.has(a, "budget-amount")
          ? Budget.parseAmount(text(a, "budget-amount").replace(/JPY$/i, ""))
          : Result.ok(budget.amount);
        if (!amount.ok) {
          return invalid(amount.error);
        }
        let thresholds = budget.thresholds;
        if (ParsedArgs.has(a, "add-threshold-rule")) {
          const rule = /^percent=(\d+)(?:,basis=current-spend)?$/.exec(
            text(a, "add-threshold-rule"),
          );
          const percent = rule ? Number(rule[1]) : Number.NaN;
          if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
            return invalid(
              "Update lesson follows SDK update reference: integer percent=0..100, basis=current-spend only. Create uses fractional percent values.",
            );
          }
          thresholds = [...new Set([...thresholds, percent / 100])].sort((a, b) => a - b);
        }
        const displayName = text(a, "display-name", budget.displayName);
        if (!displayName.trim()) {
          return invalid("Budget display name must not be empty.");
        }
        const updated = { ...budget, amount: amount.value, displayName, thresholds };
        return finish(
          { ...ctx.world, budgets: ctx.world.budgets.map((b) => (b === budget ? updated : b)) },
          Budget.toRecord(updated),
        );
      },
    }),
  ),
  scoped({
    path: ["sim", "billing", "budgets", "evaluate"],
    api: "billingbudgets.googleapis.com",
    permission: "billing.budgets.get",
    scope: billingScope,
    flags: [sf("billing-account", true), sf("spend", true)],
    positionals: [Positional.required("BUDGET_ID", "Budget ID.", (w) => w.budgets.map(Budget.id))],
    run: (ctx, a) => {
      const budget = ctx.world.budgets.find(
        (b) =>
          b.billingAccountId === text(a, "billing-account") &&
          Budget.id(b) === ParsedArgs.requiredPositional(a, 0),
      );
      if (!budget) {
        return missing("Budget not found.");
      }
      const raw = text(a, "spend");
      const spend = /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : Number.NaN;
      if (!Number.isFinite(spend) || spend < 0) {
        return invalid("Spend must be a nonnegative finite teaching amount in JPY.");
      }
      const thresholds = budget.thresholds.filter((p) => spend >= budget.amount * p);
      const projectId = ctx.projectId.some ? ctx.projectId.value : "";
      const world = observeAdmin(ctx.world, {
        projectId,
        kind: "budget",
        resource: budget.name,
        result: thresholds.length > 0 ? "notification" : "below-threshold",
        value: spend,
      });
      return finish(world, {
        budget: budget.name,
        spend,
        notifications: thresholds.map((p) => ({ thresholdPercent: p })),
        billingEnabled: ctx.world.projects
          .filter(
            (p) => p.billingAccountId.some && p.billingAccountId.value === budget.billingAccountId,
          )
          .map((p) => p.projectId),
        resourcesStopped: false,
        model:
          "Ordinary threshold notifications only. The separate REST spendCap feature is unsupported.",
      });
    },
  }),
  ...["configure", "describe", "run"].map((op) =>
    projectCommand({
      path: ["sim", "billing", "export", op],
      summary:
        "Configure and inspect simulated billing export; no public export-configuration API is claimed.",
      permission: "bigquery.datasets.get",
      requiredApis: ["bigquery.googleapis.com"],
      flags: [
        sf("project"),
        sf("account"),
        sf("billing-account", true),
        ...(op === "configure" ? [sf("dataset", true), sf("location", true)] : []),
      ],
      run: (ctx, a) => {
        const account = ctx.world.billingAccounts.find(
          (b) => b.id === text(a, "billing-account") && b.open,
        );
        if (!account) {
          return missing("Open billing account not found.");
        }
        const grants = EffectivePermissions.resolve(ctx.world, Principal.toMember(ctx.principal), {
          type: "organization",
          id: ctx.world.organization.id,
        }).grants;
        if (!grants.some((g) => g.role === "roles/owner" || g.role === "roles/billing.admin")) {
          return invalid(
            "This simulated export configuration requires Billing Admin/Owner at the modeled organization. Real Cloud Identity/customer and billing-account roles are outside this projection.",
          );
        }
        const existing = ctx.world.adminLab.exports.find((e) => e.billingAccountId === account.id);
        if (op === "configure") {
          const dataset = ctx.world.dataProcessing.datasets.find(
            (d) =>
              d.projectId === ctx.project.projectId &&
              d.name === text(a, "dataset") &&
              d.location === text(a, "location"),
          );
          if (
            !dataset ||
            !allows(ctx.world, ctx.project.projectId, ctx.principal, "bigquery.tables.create")
          ) {
            return invalid(
              "Choose an existing matching-location dataset and hold bigquery.tables.create.",
            );
          }
          const value: BillingExport = {
            billingAccountId: account.id,
            projectId: ctx.project.projectId,
            dataset: dataset.name,
            location: dataset.location,
            enabled: true,
          };
          return finish(
            patchAdmin(ctx.world, {
              exports: [...ctx.world.adminLab.exports.filter((e) => e !== existing), value],
            }),
            { ...value },
          );
        }
        if (!existing || existing.projectId !== ctx.project.projectId) {
          return missing("Billing export not configured in this project.");
        }
        if (op === "describe") {
          return finish(ctx.world, { ...existing });
        }
        if (
          !existing.enabled ||
          !allows(ctx.world, ctx.project.projectId, ctx.principal, "bigquery.tables.create")
        ) {
          return invalid("Enabled export and bigquery.tables.create are required.");
        }
        const table = {
          projectId: existing.projectId,
          dataset: existing.dataset,
          name: "gcp_billing_export_v1_simulated",
          schema: [
            { name: "service", type: "STRING" as const },
            { name: "cost", type: "FLOAT64" as const },
            { name: "location", type: "STRING" as const },
          ],
          rows: [
            { service: "Compute Engine", cost: 100, location: "us-central1" },
            { service: "Cloud Storage", cost: 20, location: "asia-northeast1" },
          ],
        };
        const world = {
          ...ctx.world,
          dataProcessing: {
            ...ctx.world.dataProcessing,
            tables: [
              ...ctx.world.dataProcessing.tables.filter(
                (t) =>
                  !(
                    t.projectId === table.projectId &&
                    t.dataset === table.dataset &&
                    t.name === table.name
                  ),
              ),
              table,
            ],
          },
        };
        return finish(
          observeAdmin(world, {
            projectId: ctx.project.projectId,
            kind: "billing-export",
            resource: existing.dataset,
            result: "written",
            value: 120,
          }),
          {
            table: `${existing.dataset}.${table.name}`,
            rows: 2,
            model: "Fixed synthetic amounts for SQL practice, not prices or actual charges.",
          },
        );
      },
    }),
  ),
  projectCommand({
    path: ["sim", "billing", "placement", "evaluate"],
    summary:
      "Evaluate an existing storage placement against data region, access frequency and budget.",
    permission: "storage.buckets.get",
    requiredApis: ["storage.googleapis.com"],
    flags: [
      sf("project"),
      sf("account"),
      sf("bucket", true),
      sf("data-region", true),
      sf("budget-id", true),
      Flag.enum("access-pattern", "Access frequency.", ["frequent", "infrequent", "rare"], {
        required: true,
      }),
    ],
    run: (ctx, a) => {
      const bucket = ctx.world.buckets.find(
        (b) => b.projectId === ctx.project.projectId && b.name === text(a, "bucket"),
      );
      const budget = ctx.world.budgets.find(
        (b) =>
          Budget.id(b) === text(a, "budget-id") &&
          ctx.project.billingAccountId.some &&
          b.billingAccountId === ctx.project.billingAccountId.value &&
          (b.projectIds.length === 0 || b.projectIds.includes(ctx.project.projectId)),
      );
      if (!bucket || !budget) {
        return missing("Choose a bucket and budget covering this billed project.");
      }
      const classes: Readonly<Record<string, string>> = {
        frequent: "STANDARD",
        infrequent: "NEARLINE",
        rare: "ARCHIVE",
      };
      const fit =
        bucket.location.toLowerCase() === text(a, "data-region") &&
        bucket.storageClass === classes[text(a, "access-pattern")];
      const world = observeAdmin(ctx.world, {
        projectId: ctx.project.projectId,
        kind: "placement",
        resource: bucket.name,
        result: fit ? "fit" : "mismatch",
        value: budget.amount,
      });
      return finish(world, {
        fit,
        location: bucket.location,
        storageClass: bucket.storageClass,
        budget: budget.name,
        model:
          "Illustrative access-frequency and colocation judgment; no latency or bill forecast.",
      });
    },
  }),
];
