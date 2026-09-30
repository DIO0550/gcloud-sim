import { CommandFailure } from "@/engine/cli/command-failure";
import {
  Column,
  type CommandContext,
  CommandOutput,
  type CommandResult,
  type CommandSpec,
  Flag,
  OutputMessage,
  ParsedArgs,
  Positional,
  type TargetContext,
} from "@/engine/cli/command-spec";
import { Candidates, plainCommand, projectCommand, targetCommand } from "@/engine/commands/shared";
import { Budget } from "@/engine/domains/billing-budget";
import { ApiService } from "@/engine/domains/catalog";
import { BillingAccount, type PolicyTarget, Project } from "@/engine/domains/resource-hierarchy";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const BillingColumns = [
  Column.create("ACCOUNT_ID", "name", "basename"),
  Column.create("NAME", "displayName"),
  Column.create("OPEN", "open"),
  Column.create("MASTER_ACCOUNT_ID", "masterBillingAccount"),
];

const billingInfo = (project: Project) => ({
  billingAccountName: Option.isSome(project.billingAccountId)
    ? `billingAccounts/${project.billingAccountId.value}`
    : "",
  billingEnabled: Option.isSome(project.billingAccountId),
  name: `projects/${project.projectId}/billingInfo`,
  projectId: project.projectId,
});

const projectArgTarget = (
  ctx: CommandContext,
  args: ParsedArgs,
): Result<PolicyTarget, CommandFailure> => {
  const id = ParsedArgs.requiredPositional(args, 0);
  return Option.isSome(World.findActiveProject(ctx.world, id))
    ? Result.ok({ type: "project", id })
    : Result.err(CommandFailure.notFound(`projects/${id}`));
};

/** `projectArgTarget` で解決済みの対象からプロジェクトを引く。 */
const targetProject = (ctx: TargetContext): Result<Project, CommandFailure> =>
  Option.toResult(World.findActiveProject(ctx.world, ctx.target.id), () =>
    CommandFailure.notFound(`projects/${ctx.target.id}`),
  );

export const BillingCommands: readonly CommandSpec[] = [
  plainCommand({
    path: ["gcloud", "billing", "accounts", "list"],
    summary: "List all active billing accounts.",
    run: (ctx) =>
      Result.ok({
        world: ctx.world,
        output: CommandOutput.table(
          ctx.world.billingAccounts.map(BillingAccount.toRecord),
          BillingColumns,
        ),
      }),
  }),
  plainCommand({
    path: ["gcloud", "billing", "accounts", "describe"],
    summary: "Show metadata for a billing account.",
    positionals: [
      Positional.required(
        "ACCOUNT_ID",
        "Specify a billing account ID.",
        Candidates.billingAccounts,
      ),
    ],
    run: (ctx, args) => {
      const id = ParsedArgs.requiredPositional(args, 0);
      return Result.map(
        Option.toResult(World.findBillingAccount(ctx.world, id), () =>
          CommandFailure.notFound(`billingAccounts/${id}`),
        ),
        (account) => ({
          world: ctx.world,
          output: CommandOutput.yaml(BillingAccount.toRecord(account)),
        }),
      );
    },
  }),
  targetCommand({
    path: ["gcloud", "billing", "projects", "describe"],
    summary: "Show detailed billing information for a project.",
    positionals: [Positional.required("PROJECT_ID", "Specify a project ID.", Candidates.projects)],
    permission: "billing.resourceAssociations.list",
    resolveTarget: projectArgTarget,
    run: (ctx) =>
      Result.map(targetProject(ctx), (project) => ({
        world: ctx.world,
        output: CommandOutput.yaml(billingInfo(project)),
      })),
  }),
  targetCommand({
    path: ["gcloud", "billing", "projects", "link"],
    summary: "Link a project with a billing account.",
    positionals: [Positional.required("PROJECT_ID", "Specify a project ID.", Candidates.projects)],
    flags: [
      Flag.string("billing-account", "Specify a billing account ID.", {
        required: true,
        candidates: Candidates.billingAccounts,
      }),
    ],
    permission: "billing.resourceAssociations.create",
    resolveTarget: projectArgTarget,
    run: (ctx, args) => {
      const project = targetProject(ctx);
      if (!Result.isOk(project)) return project;
      const accountId = Option.unwrapOr(ParsedArgs.string(args, "billing-account"), "");
      const account = World.findBillingAccount(ctx.world, accountId);
      if (!Option.isSome(account))
        return Result.err(CommandFailure.notFound(`billingAccounts/${accountId}`));
      if (!account.value.open) {
        return Result.err(
          CommandFailure.invalidState(
            `The billing account [${accountId}] is closed and cannot be linked.`,
          ),
        );
      }
      const linked = Project.withBilling(project.value, Option.some(accountId));
      return Result.ok({
        world: World.replaceProject(ctx.world, linked),
        output: CommandOutput.yaml(billingInfo(linked)),
      });
    },
  }),
  targetCommand({
    path: ["gcloud", "billing", "projects", "unlink"],
    summary: "Unlink a project from its billing account.",
    positionals: [Positional.required("PROJECT_ID", "Specify a project ID.", Candidates.projects)],
    permission: "billing.resourceAssociations.delete",
    resolveTarget: projectArgTarget,
    run: (ctx) =>
      Result.map(targetProject(ctx), (project) => {
        const unlinked = Project.withBilling(project, Option.none);
        return {
          world: World.replaceProject(ctx.world, unlinked),
          output: CommandOutput.yaml(billingInfo(unlinked)),
        };
      }),
  }),
];

const serviceRecord = (project: Project, service: ApiService) => ({
  config: { name: service.name, title: service.title },
  name: `projects/${project.projectNumber}/services/${service.name}`,
  parent: `projects/${project.projectNumber}`,
  state: Project.hasApi(project, service.name) ? "ENABLED" : "DISABLED",
});

const ServiceColumns = [
  Column.create("NAME", "config.name"),
  Column.create("TITLE", "config.title"),
];

const parseServices = (args: ParsedArgs): Result<readonly ApiService[], CommandFailure> =>
  Result.all(
    args.positionals.map((raw) =>
      Option.toResult(ApiService.parse(raw), () =>
        CommandFailure.notFoundWith(
          `[${raw}] is not a known service. gcloud-sim knows: ${ApiService.all()
            .map((a) => a.name)
            .join(", ")}`,
        ),
      ),
    ),
  );

const BudgetColumns = [
  Column.create("NAME", "name", "basename"),
  Column.create("DISPLAY_NAME", "displayName"),
  Column.create("AMOUNT", "amount.specifiedAmount.units"),
  Column.create("CURRENCY", "amount.specifiedAmount.currencyCode"),
];

/** `--billing-account` の請求アカウント。無ければ E-005。 */
const billingAccountFlag = (ctx: CommandContext, args: ParsedArgs) => {
  const id = Option.unwrapOr(ParsedArgs.string(args, "billing-account"), "");
  return Option.toResult(World.findBillingAccount(ctx.world, id), () =>
    CommandFailure.notFound(`billingAccounts/${id}`),
  );
};

const billingAccountTarget = (
  ctx: CommandContext,
  args: ParsedArgs,
): Result<PolicyTarget, CommandFailure> =>
  Result.map(billingAccountFlag(ctx, args), () => ({
    type: "organization",
    id: ctx.world.organization.id,
  }));

const createBudget = (ctx: TargetContext, args: ParsedArgs): CommandResult => {
  const account = billingAccountFlag(ctx, args);
  if (!Result.isOk(account)) return account;
  const rawAmount = Option.unwrapOr(ParsedArgs.string(args, "budget-amount"), "");
  const amountMatch = /^(\d+(?:\.\d+)?)([A-Za-z]{3})?$/.exec(rawAmount);
  const amount = amountMatch === null ? Number.NaN : Number(amountMatch[1]);
  if (!Number.isFinite(amount)) {
    return Result.err(
      CommandFailure.invalidValue(
        "--budget-amount",
        `Invalid value: ${rawAmount}. Expected a number such as 100000JPY.`,
      ),
    );
  }
  const thresholds = ParsedArgs.list(args, "threshold-rule").map((rule) =>
    Number(rule.replace(/^percent=/, "")),
  );
  if (thresholds.some((t) => !Number.isFinite(t))) {
    return Result.err(
      CommandFailure.invalidValue("--threshold-rule", "Expected percent=0.5 (repeatable)."),
    );
  }
  const projectIds = ParsedArgs.list(args, "filter-projects").map((p) =>
    p.replace(/^projects\//, ""),
  );
  const unknownProject = projectIds.find((p) => !World.hasProjectId(ctx.world, p));
  if (unknownProject !== undefined)
    return Result.err(CommandFailure.notFound(`projects/${unknownProject}`));
  const numbered = World.nextNumber(ctx.world);
  const budget = Result.mapErr(
    Budget.create({
      billingAccountId: account.value.id,
      displayName: Option.unwrapOr(ParsedArgs.string(args, "display-name"), ""),
      amount,
      thresholds,
      projectIds,
      createTime: ctx.now,
      sequence: numbered.number,
    }),
    (m) => CommandFailure.invalidValue("--display-name", m),
  );
  return Result.map(budget, (b) => ({
    world: World.withBudget(numbered.world, b),
    output: CommandOutput.yaml(Budget.toRecord(b), [
      OutputMessage.plain(`Created budget [${b.name}].`),
    ]),
  }));
};

export const BudgetCommands: readonly CommandSpec[] = [
  targetCommand({
    path: ["gcloud", "billing", "budgets", "create"],
    summary: "Create a budget for a billing account.",
    flags: [
      Flag.string("billing-account", "The billing account ID the budget belongs to.", {
        required: true,
        candidates: Candidates.billingAccounts,
      }),
      Flag.string("display-name", "The display name of the budget.", { required: true }),
      Flag.string("budget-amount", "The amount of the budget, e.g. 100000JPY.", { required: true }),
      Flag.list(
        "threshold-rule",
        "Rules that trigger alerts, e.g. percent=0.5 (repeatable; default 0.5,0.9,1.0).",
      ),
      Flag.list("filter-projects", "Project IDs the budget applies to (default: all projects)."),
    ],
    permission: "billing.budgets.create",
    resolveTarget: billingAccountTarget,
    run: createBudget,
  }),
  targetCommand({
    path: ["gcloud", "billing", "budgets", "list"],
    summary: "List budgets for a billing account.",
    flags: [
      Flag.string("billing-account", "The billing account ID.", {
        required: true,
        candidates: Candidates.billingAccounts,
      }),
    ],
    permission: "billing.budgets.list",
    resolveTarget: billingAccountTarget,
    run: (ctx, args) =>
      Result.map(billingAccountFlag(ctx, args), (account) => ({
        world: ctx.world,
        output: CommandOutput.table(
          World.budgetsOf(ctx.world, account.id).map(Budget.toRecord),
          BudgetColumns,
        ),
      })),
  }),
  targetCommand({
    path: ["gcloud", "billing", "budgets", "describe"],
    summary: "Describe a budget.",
    positionals: [
      Positional.required(
        "BUDGET",
        "ID of the budget (the last segment of billingAccounts/A/budgets/ID).",
        Candidates.budgets,
      ),
    ],
    flags: [
      Flag.string("billing-account", "The billing account ID the budget belongs to.", {
        required: true,
        candidates: Candidates.billingAccounts,
      }),
    ],
    permission: "billing.budgets.get",
    resolveTarget: billingAccountTarget,
    run: (ctx, args) => {
      const account = billingAccountFlag(ctx, args);
      if (!Result.isOk(account)) return account;
      const id = ParsedArgs.requiredPositional(args, 0);
      const budget = Option.toResult(
        Option.fromNullable(
          World.budgetsOf(ctx.world, account.value.id).find((b) => Budget.id(b) === id),
        ),
        () => CommandFailure.notFound(`billingAccounts/${account.value.id}/budgets/${id}`),
      );
      return Result.map(budget, (b) => ({
        world: ctx.world,
        output: CommandOutput.yaml(Budget.toRecord(b)),
      }));
    },
  }),
];

export const ServiceCommands: readonly CommandSpec[] = [
  projectCommand({
    path: ["gcloud", "services", "enable"],
    summary: "Enable a service for consumption for a project.",
    positionals: [
      Positional.variadic(
        "SERVICE",
        "The names of the services to enable, e.g. compute.googleapis.com.",
        Candidates.apis,
      ),
    ],
    flags: [
      Flag.boolean(
        "async",
        "Return immediately, without waiting for the operation in progress to complete.",
      ),
    ],
    permission: "serviceusage.services.enable",
    run: (ctx, args) => {
      const services = parseServices(args);
      if (!Result.isOk(services)) return services;
      const needsBilling = services.value.find(
        (s) => s.billingRequired && !Option.isSome(ctx.project.billingAccountId),
      );
      if (needsBilling !== undefined) {
        return Result.err(CommandFailure.billingRequired(needsBilling.name, ctx.project.projectId));
      }
      const enabled = services.value.reduce(
        (project, s) => Project.withApi(project, s.name),
        ctx.project,
      );
      return Result.ok({
        world: World.replaceProject(ctx.world, enabled),
        output: CommandOutput.messages(
          OutputMessage.plain(
            `Operation "operations/acat.p2-${ctx.project.projectNumber}-${ctx.world.sequence}" finished successfully.`,
          ),
        ),
      });
    },
  }),
  projectCommand({
    path: ["gcloud", "services", "disable"],
    summary: "Disable a service for the current project.",
    positionals: [
      Positional.variadic("SERVICE", "The names of the services to disable.", Candidates.apis),
    ],
    flags: [
      Flag.boolean(
        "force",
        "If specified, the disable call will proceed even if there are enabled services which depend on the service to be disabled.",
      ),
    ],
    permission: "serviceusage.services.disable",
    run: (ctx, args) => {
      const services = parseServices(args);
      if (!Result.isOk(services)) return services;
      const disabled = services.value.reduce(
        (project, s) => Project.withoutApi(project, s.name),
        ctx.project,
      );
      return Result.ok({
        world: World.replaceProject(ctx.world, disabled),
        output: CommandOutput.messages(
          OutputMessage.plain(
            `Operation "operations/acat.p2-${ctx.project.projectNumber}-${ctx.world.sequence}" finished successfully.`,
          ),
        ),
      });
    },
  }),
  projectCommand({
    path: ["gcloud", "services", "list"],
    summary: "List services for a project.",
    flags: [
      Flag.boolean("enabled", "(DEFAULT) Return the services which the project has enabled."),
      Flag.boolean("available", "Return the services available to the project to enable."),
    ],
    permission: "serviceusage.services.list",
    run: (ctx, args) => {
      const available = ParsedArgs.boolean(args, "available");
      const services = ApiService.all().filter(
        (s) => available || Project.hasApi(ctx.project, s.name),
      );
      return Result.ok({
        world: ctx.world,
        output: CommandOutput.table(
          services.map((s) => serviceRecord(ctx.project, s)),
          ServiceColumns,
        ),
      });
    },
  }),
];
