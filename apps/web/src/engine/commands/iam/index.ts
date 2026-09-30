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
  type ProjectContext,
} from "@/engine/cli/command-spec";
import {
  alreadyExists,
  Candidates,
  iamBindingCommands,
  plainCommand,
  projectCommand,
} from "@/engine/commands/shared";
import { ServiceAccountKey } from "@/engine/domains/credentials";
import { RoleName } from "@/engine/domains/iam-policy";
import type { PolicyTarget } from "@/engine/domains/resource-hierarchy";
import { CustomRole, RoleCatalog } from "@/engine/domains/role-catalog";
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

const unknownRole = (raw: string): CommandFailure =>
  CommandFailure.notFoundWith(`NOT_FOUND: The role named ${raw} was not found.`);

const KeyColumns = [
  Column.create("KEY_ID", "name", "basename"),
  Column.create("CREATED_AT", "validAfterTime"),
  Column.create("EXPIRES_AT", "validBeforeTime"),
  Column.create("DISABLED", "disabled"),
];

const serviceAccountTarget = (
  ctx: CommandContext,
  args: ParsedArgs,
): Result<PolicyTarget, CommandFailure> => {
  const email = ParsedArgs.requiredPositional(args, 0);
  return Option.isSome(World.findServiceAccount(ctx.world, email))
    ? Result.ok({ type: "service-account", id: email })
    : Result.err(unknownServiceAccount(email));
};

/** `--project` 付きのカスタムロール作成。権限はカタログにあるものだけ（`CustomRole.create`）。 */
const createRole = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const stageRaw = ParsedArgs.string(args, "stage");
  const stage = Option.map(stageRaw, (s) => s.toUpperCase());
  const known = Option.filter(stage, (s) => ["GA", "BETA", "ALPHA", "DISABLED"].includes(s));
  if (Option.isSome(stage) && !Option.isSome(known)) {
    return Result.err(
      CommandFailure.invalidChoice("--stage", Option.unwrapOr(stageRaw, ""), [
        "alpha",
        "beta",
        "ga",
        "disabled",
      ]),
    );
  }
  const role = Result.mapErr(
    CustomRole.create({
      projectId: ctx.project.projectId,
      roleId: ParsedArgs.requiredPositional(args, 0),
      title: ParsedArgs.string(args, "title"),
      description: ParsedArgs.string(args, "description"),
      includedPermissions: ParsedArgs.list(args, "permissions"),
      stage: Option.map(known, (s) => s as CustomRole["stage"]),
    }),
    CommandFailure.invalidIamArgument,
  );
  if (!Result.isOk(role)) return role;
  return Result.map(
    Result.mapErr(World.withCustomRole(ctx.world, role.value), alreadyExists),
    (world) => ({
      world,
      output: CommandOutput.yaml(CustomRole.toRecord(role.value), [
        OutputMessage.plain(`Created role [${role.value.roleId}].`),
      ]),
    }),
  );
};

const copyRole = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const sourceRaw = Option.unwrapOr(ParsedArgs.string(args, "source"), "");
  const sourceName = Option.flatMap(RoleName.parse(sourceRaw), (name) =>
    Option.or(
      RoleCatalog.find(name),
      Option.map(World.findCustomRole(ctx.world, name), (c) => ({
        name: CustomRole.name(c),
        title: c.title,
        includedPermissions: c.includedPermissions,
      })),
    ),
  );
  if (!Option.isSome(sourceName)) return Result.err(unknownRole(sourceRaw));
  const role = Result.mapErr(
    CustomRole.fromRole(sourceName.value, {
      projectId: Option.unwrapOr(ParsedArgs.string(args, "dest-project"), ctx.project.projectId),
      roleId: Option.unwrapOr(ParsedArgs.string(args, "destination"), ""),
    }),
    CommandFailure.invalidIamArgument,
  );
  if (!Result.isOk(role)) return role;
  return Result.map(
    Result.mapErr(World.withCustomRole(ctx.world, role.value), alreadyExists),
    (world) => ({
      world,
      output: CommandOutput.yaml(CustomRole.toRecord(role.value), [
        OutputMessage.plain(`Created role [${role.value.roleId}].`),
      ]),
    }),
  );
};

const createKey = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const email = Option.unwrapOr(ParsedArgs.string(args, "iam-account"), "");
  if (!Option.isSome(World.findServiceAccount(ctx.world, email))) {
    return Result.err(unknownServiceAccount(email));
  }
  const numbered = World.nextNumber(ctx.world);
  const key = ServiceAccountKey.create({
    serviceAccountEmail: email,
    file: ParsedArgs.requiredPositional(args, 0),
    validAfterTime: ctx.now,
    sequence: numbered.number,
  });
  return Result.ok({
    world: World.withServiceAccountKey(numbered.world, key),
    output: CommandOutput.messages(
      OutputMessage.plain(
        `created key [${key.keyId}] of type [json] as [${key.file}] for [${email}]`,
      ),
      OutputMessage.hint(
        `gcloud-sim: 秘密鍵は書き出しません。${key.file} は gcloud auth activate-service-account --key-file=${key.file} で使えます。`,
      ),
    ),
  });
};

export const IamCommands: readonly CommandSpec[] = [
  projectCommand({
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
    permission: "iam.serviceAccounts.create",
    run: (ctx, args) => {
      const accountId = ParsedArgs.requiredPositional(args, 0);
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
  }),
  projectCommand({
    path: ["gcloud", "iam", "service-accounts", "list"],
    summary: "List all of a project's service accounts.",
    permission: "iam.serviceAccounts.list",
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
  }),
  projectCommand({
    path: ["gcloud", "iam", "service-accounts", "describe"],
    summary: "Show metadata for a service account from a project.",
    positionals: [
      Positional.required(
        "SERVICE_ACCOUNT",
        "The service account email to describe.",
        Candidates.serviceAccounts,
      ),
    ],
    permission: "iam.serviceAccounts.get",
    run: (ctx, args) => {
      const email = ParsedArgs.requiredPositional(args, 0);
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
  }),
  projectCommand({
    path: ["gcloud", "iam", "service-accounts", "delete"],
    summary: "Delete a service account from a project.",
    positionals: [
      Positional.required(
        "SERVICE_ACCOUNT",
        "The service account email to delete.",
        Candidates.serviceAccounts,
      ),
    ],
    destructive: true,
    permission: "iam.serviceAccounts.delete",
    run: (ctx, args) => {
      const email = ParsedArgs.requiredPositional(args, 0);
      if (!Option.isSome(World.findServiceAccount(ctx.world, email))) {
        return Result.err(unknownServiceAccount(email));
      }
      return Result.ok({
        world: World.withoutServiceAccount(ctx.world, email),
        output: CommandOutput.messages(OutputMessage.plain(`deleted service account [${email}]`)),
      });
    },
  }),
  plainCommand({
    path: ["gcloud", "iam", "roles", "list"],
    summary:
      "List predefined roles known to gcloud-sim, or a project's custom roles with --project (as the real gcloud does).",
    flags: [Flag.boolean("show-deleted", "Show deleted roles (accepted, none are deleted).")],
    run: (ctx) => {
      const rows = Option.isSome(ctx.projectFlag)
        ? World.customRolesOf(ctx.world, ctx.projectFlag.value).map((r) => ({
            name: CustomRole.name(r),
            title: r.title,
            stage: r.stage,
          }))
        : RoleCatalog.all().map((r) => ({ name: r.name, title: r.title, stage: "GA" }));
      return Result.ok({ world: ctx.world, output: CommandOutput.table(rows, RoleColumns) });
    },
  }),
  plainCommand({
    path: ["gcloud", "iam", "roles", "describe"],
    summary: "Show metadata for a role, including the permissions gcloud-sim records for it.",
    positionals: [
      Positional.required(
        "ROLE_ID",
        "The role to describe, e.g. roles/viewer or a custom role ID with --project.",
      ),
    ],
    run: (ctx, args) => {
      const raw = ParsedArgs.requiredPositional(args, 0);
      const fullName =
        raw.startsWith("roles/") || raw.startsWith("projects/")
          ? raw
          : `projects/${Option.unwrapOr(ctx.projectId, "-")}/roles/${raw}`;
      const name = RoleName.parse(fullName);
      const custom = Option.flatMap(name, (n) => World.findCustomRole(ctx.world, n));
      if (Option.isSome(custom)) {
        return Result.ok({
          world: ctx.world,
          output: CommandOutput.yaml(CustomRole.toRecord(custom.value)),
        });
      }
      const role = Option.flatMap(name, RoleCatalog.find);
      if (!Option.isSome(role)) return Result.err(unknownRole(raw));
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
  }),
  projectCommand({
    path: ["gcloud", "iam", "roles", "create"],
    summary: "Create a custom role for a project.",
    positionals: [Positional.required("ROLE_ID", "The ID of the role to create, e.g. viewerPlus.")],
    flags: [
      Flag.list(
        "permissions",
        "The permissions the role grants (must be in gcloud-sim's role catalog).",
        { required: true },
      ),
      Flag.string("title", "The title of the role."),
      Flag.string("description", "The description of the role."),
      Flag.string("stage", "The state of the role: alpha, beta, ga or disabled."),
    ],
    permission: "iam.roles.create",
    run: createRole,
  }),
  projectCommand({
    path: ["gcloud", "iam", "roles", "copy"],
    summary: "Create a role from an existing role.",
    flags: [
      Flag.string("source", "The source role name or ID, e.g. roles/viewer.", { required: true }),
      Flag.string("destination", "The destination role ID for the new custom role.", {
        required: true,
      }),
      Flag.string(
        "dest-project",
        "The project of the destination role (default: current project).",
      ),
    ],
    permission: "iam.roles.create",
    run: copyRole,
  }),
  projectCommand({
    path: ["gcloud", "iam", "service-accounts", "keys", "create"],
    summary:
      "Create a private key for a service account (the key is recorded, not written to disk).",
    positionals: [
      Positional.required("OUTPUT-FILE", "Path where the key file is written, e.g. key.json."),
    ],
    flags: [
      Flag.string("iam-account", "The service account for which to create a key.", {
        required: true,
      }),
      Flag.enum("key-file-type", "The type of key file to create.", ["json", "p12"]),
    ],
    permission: "iam.serviceAccountKeys.create",
    run: createKey,
  }),
  projectCommand({
    path: ["gcloud", "iam", "service-accounts", "keys", "list"],
    summary: "List the keys for a service account.",
    flags: [
      Flag.string("iam-account", "The service account whose keys to list.", { required: true }),
    ],
    permission: "iam.serviceAccountKeys.list",
    run: (ctx, args) => {
      const email = Option.unwrapOr(ParsedArgs.string(args, "iam-account"), "");
      if (!Option.isSome(World.findServiceAccount(ctx.world, email))) {
        return Result.err(unknownServiceAccount(email));
      }
      return Result.ok({
        world: ctx.world,
        output: CommandOutput.table(
          World.keysOf(ctx.world, email).map((k) => ({
            ...ServiceAccountKey.toRecord(k),
            disabled: false,
          })),
          KeyColumns,
        ),
      });
    },
  }),
  ...iamBindingCommands({
    group: ["gcloud", "iam", "service-accounts"],
    positional: Positional.required(
      "SERVICE_ACCOUNT",
      "The service account email.",
      Candidates.serviceAccounts,
    ),
    label: (target) => `serviceAccount [${target.id}]`,
    resolveTarget: serviceAccountTarget,
    permissions: {
      get: "iam.serviceAccounts.getIamPolicy",
      set: "iam.serviceAccounts.setIamPolicy",
    },
  }),
];
