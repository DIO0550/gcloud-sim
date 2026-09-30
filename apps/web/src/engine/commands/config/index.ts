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
import { ConfigProperty, ConfigurationName, GcloudConfig } from "@/engine/domains/gcloud-config";
import { Principal } from "@/engine/domains/principal";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const unknownProperty = (raw: string): CommandFailure =>
  CommandFailure.invalidValue(
    "PROPERTY",
    `Section [${raw.includes("/") ? raw.split("/")[0] : "core"}] has no property [${raw.split("/").at(-1)}].`,
  );

const configListLines = (config: GcloudConfig): readonly string[] => {
  const values = GcloudConfig.active(config);
  const sections = new Map<string, string[]>();
  for (const property of ConfigProperty.all()) {
    const value = values[property];
    if (value === undefined) continue;
    const [section, name] = property.split("/") as [string, string];
    sections.set(section, [...(sections.get(section) ?? []), `${name} = ${value}`]);
  }
  const body = [...sections.entries()].flatMap(([section, entries]) => [
    `[${section}]`,
    ...entries,
  ]);
  return [...body, "", `Your active configuration is: [${config.activeConfiguration}]`];
};

const configurationRecords = (config: GcloudConfig) =>
  GcloudConfig.names(config).map((name) => {
    const values = Option.unwrapOr(GcloudConfig.valuesOf(config, name), {});
    return {
      name,
      is_active: name === config.activeConfiguration,
      properties: {
        core: { account: values["core/account"], project: values["core/project"] },
        compute: { zone: values["compute/zone"], region: values["compute/region"] },
      },
    };
  });

const ConfigurationColumns = [
  Column.create("NAME", "name"),
  Column.create("IS_ACTIVE", "is_active"),
  Column.create("ACCOUNT", "properties.core.account"),
  Column.create("PROJECT", "properties.core.project"),
  Column.create("COMPUTE_DEFAULT_ZONE", "properties.compute.zone"),
  Column.create("COMPUTE_DEFAULT_REGION", "properties.compute.region"),
];

export const ConfigCommands: readonly CommandSpec[] = [
  {
    kind: "plain",
    path: ["gcloud", "config", "set"],
    summary: "Set a Google Cloud CLI property.",
    positionals: [
      Positional.required(
        "PROPERTY",
        "Property to be set. Note that SECTION/ is optional while referring to properties in the core section (e.g. project, account, compute/zone).",
      ),
      Positional.required("VALUE", "Value to be set."),
    ],
    flags: [],
    destructive: false,
    run: (ctx, args) => {
      const raw = Option.unwrapOr(ParsedArgs.positional(args, 0), "");
      const value = Option.unwrapOr(ParsedArgs.positional(args, 1), "");
      const property = ConfigProperty.parse(raw);
      if (!Option.isSome(property)) return Result.err(unknownProperty(raw));
      if (property.value === "core/account") {
        const principal = Result.mapErr(Principal.parse(value), (m) =>
          CommandFailure.invalidValue("VALUE", m),
        );
        return Result.map(principal, (p) => ({
          world: World.withPrincipal(ctx.world, p),
          output: CommandOutput.messages(OutputMessage.plain("Updated property [core/account].")),
        }));
      }
      const world = World.withConfig(
        ctx.world,
        GcloudConfig.set(ctx.world.config, property.value, value),
      );
      const warning =
        property.value === "core/project" && !World.hasProjectId(ctx.world, value)
          ? [
              OutputMessage.warning(
                `WARNING: You do not appear to have access to project [${value}] or it does not exist.`,
              ),
            ]
          : [];
      return Result.ok({
        world,
        output: CommandOutput.messages(
          OutputMessage.plain(`Updated property [${property.value}].`),
          ...warning,
        ),
      });
    },
  },
  {
    kind: "plain",
    path: ["gcloud", "config", "unset"],
    summary: "Unset a Google Cloud CLI property.",
    positionals: [Positional.required("PROPERTY", "Property to be unset.")],
    flags: [],
    destructive: false,
    run: (ctx, args) => {
      const raw = Option.unwrapOr(ParsedArgs.positional(args, 0), "");
      const property = ConfigProperty.parse(raw);
      if (!Option.isSome(property)) return Result.err(unknownProperty(raw));
      return Result.ok({
        world: World.withConfig(ctx.world, GcloudConfig.unset(ctx.world.config, property.value)),
        output: CommandOutput.messages(OutputMessage.plain(`Unset property [${property.value}].`)),
      });
    },
  },
  ...(["get", "get-value"] as const).map(
    (name): CommandSpec => ({
      kind: "plain",
      path: ["gcloud", "config", name],
      summary: "Print the value of a Google Cloud CLI property.",
      positionals: [Positional.required("PROPERTY", "The property to be fetched.")],
      flags: [],
      destructive: false,
      run: (ctx, args) => {
        const raw = Option.unwrapOr(ParsedArgs.positional(args, 0), "");
        const property = ConfigProperty.parse(raw);
        if (!Option.isSome(property)) return Result.err(unknownProperty(raw));
        const value = GcloudConfig.get(ctx.world.config, property.value);
        const output = Option.isSome(value)
          ? CommandOutput.messages(OutputMessage.plain(value.value))
          : CommandOutput.messages(OutputMessage.plain(`(unset)`));
        return Result.ok({ world: ctx.world, output });
      },
    }),
  ),
  {
    kind: "plain",
    path: ["gcloud", "config", "list"],
    summary: "List Google Cloud CLI properties for the currently active configuration.",
    positionals: [],
    flags: [
      Flag.boolean("all", "List all set and unset properties that match the section and property."),
    ],
    destructive: false,
    run: (ctx) =>
      Result.ok({
        world: ctx.world,
        output: CommandOutput.messages(
          ...configListLines(ctx.world.config).map(OutputMessage.plain),
        ),
      }),
  },
  {
    kind: "plain",
    path: ["gcloud", "config", "configurations", "list"],
    summary: "List existing named configurations.",
    positionals: [],
    flags: [],
    destructive: false,
    run: (ctx) =>
      Result.ok({
        world: ctx.world,
        output: CommandOutput.table(configurationRecords(ctx.world.config), ConfigurationColumns),
      }),
  },
  {
    kind: "plain",
    path: ["gcloud", "config", "configurations", "create"],
    summary: "Create a new named configuration.",
    positionals: [
      Positional.required("CONFIGURATION_NAME", "Name of the configuration to create."),
    ],
    flags: [Flag.boolean("activate", "If true, activate this configuration upon create.")],
    destructive: false,
    run: (ctx, args) => {
      const raw = Option.unwrapOr(ParsedArgs.positional(args, 0), "");
      const name = Result.mapErr(ConfigurationName.parse(raw), (m) =>
        CommandFailure.invalidValue("CONFIGURATION_NAME", m),
      );
      if (!Result.isOk(name)) return name;
      const activate = Option.unwrapOr(ParsedArgs.booleanChoice(args, "activate"), true);
      const config = GcloudConfig.withConfiguration(ctx.world.config, name.value, activate);
      if (!Option.isSome(config)) {
        return Result.err(
          CommandFailure.invalidValue(
            "CONFIGURATION_NAME",
            `Cannot create configuration [${name.value}], it already exists.`,
          ),
        );
      }
      const activated = activate ? [OutputMessage.plain(`Activated [${name.value}].`)] : [];
      return Result.ok({
        world: World.withConfig(ctx.world, config.value),
        output: CommandOutput.messages(
          OutputMessage.plain(`Created [${name.value}].`),
          ...activated,
        ),
      });
    },
  },
  {
    kind: "plain",
    path: ["gcloud", "config", "configurations", "activate"],
    summary: "Activates an existing named configuration.",
    positionals: [
      Positional.required("CONFIGURATION_NAME", "Name of the configuration to activate."),
    ],
    flags: [],
    destructive: false,
    run: (ctx, args) => {
      const name = Option.unwrapOr(ParsedArgs.positional(args, 0), "");
      const config = GcloudConfig.activate(ctx.world.config, name);
      if (!Option.isSome(config)) {
        return Result.err(
          CommandFailure.notFoundWith(
            `Cannot activate configuration [${name}], it does not exist.`,
          ),
        );
      }
      return Result.ok({
        world: World.withConfig(ctx.world, config.value),
        output: CommandOutput.messages(OutputMessage.plain(`Activated [${name}].`)),
      });
    },
  },
  {
    kind: "plain",
    path: ["gcloud", "config", "configurations", "describe"],
    summary: "Describes a named configuration by listing its properties.",
    positionals: [
      Positional.required("CONFIGURATION_NAME", "Name of the configuration to describe."),
    ],
    flags: [],
    destructive: false,
    run: (ctx, args) => {
      const name = Option.unwrapOr(ParsedArgs.positional(args, 0), "");
      const record = configurationRecords(ctx.world.config).find((r) => r.name === name);
      if (record === undefined) {
        return Result.err(
          CommandFailure.notFoundWith(
            `Cannot describe configuration [${name}], it does not exist.`,
          ),
        );
      }
      return Result.ok({ world: ctx.world, output: CommandOutput.yaml(record) });
    },
  },
  {
    kind: "plain",
    path: ["gcloud", "config", "configurations", "delete"],
    summary: "Deletes a named configuration.",
    positionals: [
      Positional.required("CONFIGURATION_NAME", "Name of the configuration to delete."),
    ],
    flags: [],
    destructive: true,
    run: (ctx, args) => {
      const name = Option.unwrapOr(ParsedArgs.positional(args, 0), "");
      const config = GcloudConfig.withoutConfiguration(ctx.world.config, name);
      if (!Option.isSome(config)) {
        return Result.err(
          CommandFailure.invalidValue(
            "CONFIGURATION_NAME",
            `Cannot delete configuration [${name}], it is the active configuration or does not exist.`,
          ),
        );
      }
      return Result.ok({
        world: World.withConfig(ctx.world, config.value),
        output: CommandOutput.messages(OutputMessage.plain(`Deleted [${name}].`)),
      });
    },
  },
];

export const AuthCommands: readonly CommandSpec[] = [
  {
    kind: "plain",
    path: ["gcloud", "auth", "login"],
    summary:
      "Authorize gcloud to access Google Cloud (simulated: registers ACCOUNT as the active principal).",
    positionals: [
      Positional.required(
        "ACCOUNT",
        "User account to authorize. gcloud-sim has no browser flow, so the account is required.",
      ),
    ],
    flags: [
      Flag.boolean("brief", "Minimal user output."),
      Flag.boolean("no-launch-browser", "Do not launch a browser."),
    ],
    destructive: false,
    run: (ctx, args) => {
      const raw = Option.unwrapOr(ParsedArgs.positional(args, 0), "");
      const principal = Result.mapErr(Principal.parse(raw), (m) =>
        CommandFailure.invalidValue("ACCOUNT", m),
      );
      return Result.map(principal, (p) => ({
        world: World.withPrincipal(ctx.world, p),
        output: CommandOutput.messages(
          OutputMessage.plain(`You are now logged in as [${p}].`),
          OutputMessage.plain(
            `Your current project is [${Option.unwrapOr(World.currentProjectId(ctx.world), "None")}].  You can change this setting by running:`,
          ),
          OutputMessage.plain("  $ gcloud config set project PROJECT_ID"),
          OutputMessage.hint(
            "gcloud-sim: 認証は疑似です。任意のメールをプリンシパルとして登録するだけで、実在の認証情報は扱いません。",
          ),
        ),
      }));
    },
  },
  {
    kind: "plain",
    path: ["gcloud", "auth", "list"],
    summary: "Lists credentialed accounts.",
    positionals: [],
    flags: [],
    destructive: false,
    run: (ctx) => {
      const current = World.currentPrincipal(ctx.world);
      const rows = ctx.world.session.accounts.map((account) => ({
        active: Option.isSome(current) && current.value === account ? "*" : "",
        account,
      }));
      return Result.ok({
        world: ctx.world,
        output: CommandOutput.withTrailing(
          CommandOutput.table(
            rows,
            [Column.create("ACTIVE", "active"), Column.create("ACCOUNT", "account")],
            [OutputMessage.plain("                 Credentialed Accounts")],
          ),
          OutputMessage.plain(""),
          OutputMessage.plain("To set the active account, run:"),
          OutputMessage.plain("    $ gcloud config set account `ACCOUNT`"),
        ),
      });
    },
  },
  {
    kind: "plain",
    path: ["gcloud", "auth", "revoke"],
    summary: "Revoke access credentials for an account (simulated).",
    positionals: [
      Positional.optional("ACCOUNT", "Account to revoke. Defaults to the active account."),
    ],
    flags: [],
    destructive: false,
    run: (ctx, args) => {
      const account = Option.or(ParsedArgs.positional(args, 0), World.currentPrincipal(ctx.world));
      if (!Option.isSome(account)) return Result.err(CommandFailure.noActiveAccount());
      const isCredentialed = ctx.world.session.accounts.some((a) => a === account.value);
      if (!isCredentialed) {
        return Result.err(
          CommandFailure.notFoundWith(
            `Account [${account.value}] is not among the credentialed accounts.`,
          ),
        );
      }
      return Result.ok({
        world: ctx.world,
        output: CommandOutput.messages(
          OutputMessage.plain(`Revoked credentials:`),
          OutputMessage.plain(` - ${account.value}`),
          OutputMessage.hint(
            "gcloud-sim: 疑似認証なので、アカウント一覧からは外しません（再ログインは不要）。",
          ),
        ),
      });
    },
  },
];
