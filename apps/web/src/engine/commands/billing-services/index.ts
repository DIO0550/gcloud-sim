import { CommandFailure } from "@/engine/cli/command-failure";
import {
  Column,
  type CommandContext,
  CommandOutput,
  type CommandSpec,
  Flag,
  OutputMessage,
  ParsedArgs,
  Positional,
  type TargetContext,
} from "@/engine/cli/command-spec";
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
  const id = Option.unwrapOr(ParsedArgs.positional(args, 0), "");
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
  {
    kind: "plain",
    path: ["gcloud", "billing", "accounts", "list"],
    summary: "List all active billing accounts.",
    positionals: [],
    flags: [],
    destructive: false,
    run: (ctx) =>
      Result.ok({
        world: ctx.world,
        output: CommandOutput.table(
          ctx.world.billingAccounts.map(BillingAccount.toRecord),
          BillingColumns,
        ),
      }),
  },
  {
    kind: "plain",
    path: ["gcloud", "billing", "accounts", "describe"],
    summary: "Show metadata for a billing account.",
    positionals: [Positional.required("ACCOUNT_ID", "Specify a billing account ID.")],
    flags: [],
    destructive: false,
    run: (ctx, args) => {
      const id = Option.unwrapOr(ParsedArgs.positional(args, 0), "");
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
  },
  {
    kind: "target",
    path: ["gcloud", "billing", "projects", "describe"],
    summary: "Show detailed billing information for a project.",
    positionals: [Positional.required("PROJECT_ID", "Specify a project ID.")],
    flags: [],
    destructive: false,
    requiredPermissions: ["billing.resourceAssociations.list"],
    resolveTarget: projectArgTarget,
    run: (ctx) =>
      Result.map(targetProject(ctx), (project) => ({
        world: ctx.world,
        output: CommandOutput.yaml(billingInfo(project)),
      })),
  },
  {
    kind: "target",
    path: ["gcloud", "billing", "projects", "link"],
    summary: "Link a project with a billing account.",
    positionals: [Positional.required("PROJECT_ID", "Specify a project ID.")],
    flags: [Flag.string("billing-account", "Specify a billing account ID.", { required: true })],
    destructive: false,
    requiredPermissions: ["billing.resourceAssociations.create"],
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
  },
  {
    kind: "target",
    path: ["gcloud", "billing", "projects", "unlink"],
    summary: "Unlink a project from its billing account.",
    positionals: [Positional.required("PROJECT_ID", "Specify a project ID.")],
    flags: [],
    destructive: false,
    requiredPermissions: ["billing.resourceAssociations.delete"],
    resolveTarget: projectArgTarget,
    run: (ctx) =>
      Result.map(targetProject(ctx), (project) => {
        const unlinked = Project.withBilling(project, Option.none);
        return {
          world: World.replaceProject(ctx.world, unlinked),
          output: CommandOutput.yaml(billingInfo(unlinked)),
        };
      }),
  },
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

export const ServiceCommands: readonly CommandSpec[] = [
  {
    kind: "project",
    path: ["gcloud", "services", "enable"],
    summary: "Enable a service for consumption for a project.",
    positionals: [
      Positional.variadic(
        "SERVICE",
        "The names of the services to enable, e.g. compute.googleapis.com.",
      ),
    ],
    flags: [
      Flag.boolean(
        "async",
        "Return immediately, without waiting for the operation in progress to complete.",
      ),
    ],
    destructive: false,
    requiredPermissions: ["serviceusage.services.enable"],
    requiredApis: [],
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
  },
  {
    kind: "project",
    path: ["gcloud", "services", "disable"],
    summary: "Disable a service for the current project.",
    positionals: [Positional.variadic("SERVICE", "The names of the services to disable.")],
    flags: [
      Flag.boolean(
        "force",
        "If specified, the disable call will proceed even if there are enabled services which depend on the service to be disabled.",
      ),
    ],
    destructive: false,
    requiredPermissions: ["serviceusage.services.disable"],
    requiredApis: [],
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
  },
  {
    kind: "project",
    path: ["gcloud", "services", "list"],
    summary: "List services for a project.",
    positionals: [],
    flags: [
      Flag.boolean("enabled", "(DEFAULT) Return the services which the project has enabled."),
      Flag.boolean("available", "Return the services available to the project to enable."),
    ],
    destructive: false,
    requiredPermissions: ["serviceusage.services.list"],
    requiredApis: [],
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
  },
];
