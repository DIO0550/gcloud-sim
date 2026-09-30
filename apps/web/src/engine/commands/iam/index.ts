import { CommandFailure } from "@/engine/cli/command-failure";
import {
  Column,
  CommandOutput,
  type CommandSpec,
  Flag,
  OutputMessage,
  ParsedArgs,
  Positional,
} from "@/engine/cli/command-spec";
import { alreadyExists } from "@/engine/commands/shared";
import { RoleName } from "@/engine/domains/iam-policy";
import { RoleCatalog } from "@/engine/domains/role-catalog";
import { ServiceAccount } from "@/engine/domains/service-account";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const ServiceAccountColumns = [
  Column.create("DISPLAY NAME", "displayName"),
  Column.create("EMAIL", "email"),
  Column.create("DISABLED", "disabled"),
];

const RoleColumns = [Column.create("NAME", "name"), Column.create("TITLE", "title")];

const unknownServiceAccount = (email: string): CommandFailure =>
  CommandFailure.notFoundWith(`NOT_FOUND: Unknown service account: ${email}`);

export const IamCommands: readonly CommandSpec[] = [
  {
    kind: "project",
    path: ["gcloud", "iam", "service-accounts", "create"],
    summary: "Create a service account for a project.",
    positionals: [
      Positional.required(
        "NAME",
        "The internal name of the new service account. Used to generate an email.",
      ),
    ],
    flags: [
      Flag.string("display-name", "Textual name to display for the account."),
      Flag.string("description", "Textual description for the account."),
    ],
    destructive: false,
    requiredPermissions: ["iam.serviceAccounts.create"],
    requiredApis: [],
    run: (ctx, args) => {
      const accountId = Option.unwrapOr(ParsedArgs.positional(args, 0), "");
      const numbered = World.nextNumber(ctx.world);
      const account = Result.mapErr(
        ServiceAccount.create({
          accountId,
          displayName: Option.unwrapOr(ParsedArgs.string(args, "display-name"), ""),
          description: Option.unwrapOr(ParsedArgs.string(args, "description"), ""),
          projectId: ctx.project.projectId,
          uniqueId: String(100000000000000000000n + BigInt(numbered.number)),
        }),
        (m) => CommandFailure.invalidValue("NAME", m),
      );
      if (!Result.isOk(account)) return account;
      return Result.map(
        Result.mapErr(World.withServiceAccount(numbered.world, account.value), alreadyExists),
        (world) => ({
          world,
          output: CommandOutput.messages(
            OutputMessage.plain(`Created service account [${accountId}].`),
          ),
        }),
      );
    },
  },
  {
    kind: "project",
    path: ["gcloud", "iam", "service-accounts", "list"],
    summary: "List all of a project's service accounts.",
    positionals: [],
    flags: [],
    destructive: false,
    requiredPermissions: ["iam.serviceAccounts.list"],
    requiredApis: [],
    run: (ctx) => {
      const defaultCompute = {
        displayName: "Compute Engine default service account",
        email: ServiceAccount.defaultComputeEmail(ctx.project.projectNumber),
        disabled: false,
      };
      const own = World.serviceAccountsOf(ctx.world, ctx.project.projectId).map(
        ServiceAccount.toRecord,
      );
      return Result.ok({
        world: ctx.world,
        output: CommandOutput.table([defaultCompute, ...own], ServiceAccountColumns),
      });
    },
  },
  {
    kind: "project",
    path: ["gcloud", "iam", "service-accounts", "describe"],
    summary: "Show metadata for a service account from a project.",
    positionals: [Positional.required("SERVICE_ACCOUNT", "The service account email to describe.")],
    flags: [],
    destructive: false,
    requiredPermissions: ["iam.serviceAccounts.get"],
    requiredApis: [],
    run: (ctx, args) => {
      const email = Option.unwrapOr(ParsedArgs.positional(args, 0), "");
      return Result.map(
        Option.toResult(World.findServiceAccount(ctx.world, email), () =>
          unknownServiceAccount(email),
        ),
        (account) => ({
          world: ctx.world,
          output: CommandOutput.yaml(ServiceAccount.toRecord(account)),
        }),
      );
    },
  },
  {
    kind: "project",
    path: ["gcloud", "iam", "service-accounts", "delete"],
    summary: "Delete a service account from a project.",
    positionals: [Positional.required("SERVICE_ACCOUNT", "The service account email to delete.")],
    flags: [],
    destructive: true,
    requiredPermissions: ["iam.serviceAccounts.delete"],
    requiredApis: [],
    run: (ctx, args) => {
      const email = Option.unwrapOr(ParsedArgs.positional(args, 0), "");
      if (!Option.isSome(World.findServiceAccount(ctx.world, email))) {
        return Result.err(unknownServiceAccount(email));
      }
      return Result.ok({
        world: World.withoutServiceAccount(ctx.world, email),
        output: CommandOutput.messages(OutputMessage.plain(`deleted service account [${email}]`)),
      });
    },
  },
  {
    kind: "plain",
    path: ["gcloud", "iam", "roles", "list"],
    summary: "List predefined roles known to gcloud-sim.",
    positionals: [],
    flags: [],
    destructive: false,
    run: (ctx) =>
      Result.ok({
        world: ctx.world,
        output: CommandOutput.table(
          RoleCatalog.all().map((r) => ({ name: r.name, title: r.title, stage: "GA" })),
          RoleColumns,
        ),
      }),
  },
  {
    kind: "plain",
    path: ["gcloud", "iam", "roles", "describe"],
    summary: "Show metadata for a role, including the permissions gcloud-sim records for it.",
    positionals: [Positional.required("ROLE_ID", "The role to describe, e.g. roles/viewer.")],
    flags: [],
    destructive: false,
    run: (ctx, args) => {
      const raw = Option.unwrapOr(ParsedArgs.positional(args, 0), "");
      const role = Option.flatMap(RoleName.parse(raw), RoleCatalog.find);
      if (!Option.isSome(role))
        return Result.err(
          CommandFailure.notFoundWith(`NOT_FOUND: The role named ${raw} was not found.`),
        );
      return Result.ok({
        world: ctx.world,
        output: CommandOutput.yaml({
          description: `${role.value.title} (gcloud-sim records ${role.value.includedPermissions.length} of its permissions)`,
          etag: "AA==",
          includedPermissions: [...role.value.includedPermissions],
          name: role.value.name,
          stage: "GA",
          title: role.value.title,
        }),
      });
    },
  },
];
