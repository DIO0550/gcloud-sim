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
import { Candidates, plainCommand } from "@/engine/commands/shared";
import { CliComponent, CliVersion } from "@/engine/domains/catalog";
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
  plainCommand({
    path: ["gcloud", "config", "set"],
    summary: "Set a Google Cloud CLI property.",
    positionals: [
      Positional.required(
        "PROPERTY",
        "Property to be set. Note that SECTION/ is optional while referring to properties in the core section (e.g. project, account, compute/zone).",
        Candidates.configProperties,
      ),
      Positional.required("VALUE", "Value to be set."),
    ],
    run: (ctx, args) => {
      const raw = ParsedArgs.requiredPositional(args, 0);
      const value = ParsedArgs.requiredPositional(args, 1);
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
  }),
  plainCommand({
    path: ["gcloud", "config", "unset"],
    summary: "Unset a Google Cloud CLI property.",
    positionals: [
      Positional.required("PROPERTY", "Property to be unset.", Candidates.configProperties),
    ],
    run: (ctx, args) => {
      const raw = ParsedArgs.requiredPositional(args, 0);
      const property = ConfigProperty.parse(raw);
      if (!Option.isSome(property)) return Result.err(unknownProperty(raw));
      return Result.ok({
        world: World.withConfig(ctx.world, GcloudConfig.unset(ctx.world.config, property.value)),
        output: CommandOutput.messages(OutputMessage.plain(`Unset property [${property.value}].`)),
      });
    },
  }),
  ...(["get", "get-value"] as const).map(
    (name): CommandSpec =>
      plainCommand({
        path: ["gcloud", "config", name],
        summary: "Print the value of a Google Cloud CLI property.",
        positionals: [
          Positional.required(
            "PROPERTY",
            "The property to be fetched.",
            Candidates.configProperties,
          ),
        ],
        run: (ctx, args) => {
          const raw = ParsedArgs.requiredPositional(args, 0);
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
  plainCommand({
    path: ["gcloud", "config", "list"],
    summary: "List Google Cloud CLI properties for the currently active configuration.",
    flags: [
      Flag.boolean("all", "List all set and unset properties that match the section and property."),
    ],
    run: (ctx) =>
      Result.ok({
        world: ctx.world,
        output: CommandOutput.messages(
          ...configListLines(ctx.world.config).map(OutputMessage.plain),
        ),
      }),
  }),
  plainCommand({
    path: ["gcloud", "config", "configurations", "list"],
    summary: "List existing named configurations.",
    run: (ctx) =>
      Result.ok({
        world: ctx.world,
        output: CommandOutput.table(configurationRecords(ctx.world.config), ConfigurationColumns),
      }),
  }),
  plainCommand({
    path: ["gcloud", "config", "configurations", "create"],
    summary: "Create a new named configuration.",
    positionals: [
      Positional.required("CONFIGURATION_NAME", "Name of the configuration to create."),
    ],
    flags: [Flag.boolean("activate", "If true, activate this configuration upon create.")],
    run: (ctx, args) => {
      const raw = ParsedArgs.requiredPositional(args, 0);
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
  }),
  plainCommand({
    path: ["gcloud", "config", "configurations", "activate"],
    summary: "Activates an existing named configuration.",
    positionals: [
      Positional.required("CONFIGURATION_NAME", "Name of the configuration to activate."),
    ],
    run: (ctx, args) => {
      const name = ParsedArgs.requiredPositional(args, 0);
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
  }),
  plainCommand({
    path: ["gcloud", "config", "configurations", "describe"],
    summary: "Describes a named configuration by listing its properties.",
    positionals: [
      Positional.required("CONFIGURATION_NAME", "Name of the configuration to describe."),
    ],
    run: (ctx, args) => {
      const name = ParsedArgs.requiredPositional(args, 0);
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
  }),
  plainCommand({
    path: ["gcloud", "config", "configurations", "delete"],
    summary: "Deletes a named configuration.",
    positionals: [
      Positional.required("CONFIGURATION_NAME", "Name of the configuration to delete."),
    ],
    destructive: true,
    run: (ctx, args) => {
      const name = ParsedArgs.requiredPositional(args, 0);
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
  }),
];

const ComponentColumns = [
  Column.create("Status", "status"),
  Column.create("Name", "name"),
  Column.create("ID", "id"),
  Column.create("Size", "size"),
];

const componentRows = (world: World) =>
  CliComponent.all().map((c) => ({
    ...c,
    status:
      c.status === "Installed" || world.session.components.includes(c.id)
        ? "Installed"
        : "Not Installed",
  }));

/** `gcloud init` / `info` が出す環境の要約。 */
const environmentLines = (world: World): readonly string[] => {
  const values = GcloudConfig.active(world.config);
  return [
    `Google Cloud SDK [${CliVersion}]`,
    "",
    "Installation Properties: [/usr/lib/google-cloud-sdk/properties]",
    "User Config Directory: [~/.config/gcloud]",
    `Active Configuration Name: [${world.config.activeConfiguration}]`,
    `Active Configuration Path: [~/.config/gcloud/configurations/config_${world.config.activeConfiguration}]`,
    "",
    `Account: [${values["core/account"] ?? "None"}]`,
    `Project: [${values["core/project"] ?? "None"}]`,
    "",
    "Current Properties:",
    ...configListLines(world.config)
      .slice(0, -2)
      .map((l) => `  ${l}`),
  ];
};

export const SdkCommands: readonly CommandSpec[] = [
  plainCommand({
    path: ["gcloud", "version"],
    summary: "Print version information for Google Cloud CLI components.",
    run: (ctx) =>
      Result.ok({
        world: ctx.world,
        output: CommandOutput.messages(
          OutputMessage.plain(`Google Cloud SDK ${CliVersion}`),
          ...componentRows(ctx.world)
            .filter((c) => c.status === "Installed" && c.id !== "gcloud")
            .map((c) => OutputMessage.plain(`${c.id} ${c.id === "core" ? "2026.09.26" : "5.35"}`)),
          OutputMessage.hint(
            "gcloud-sim: 本物の Google Cloud CLI ではありません。バージョンは docs/COMMANDS.md の基準（TBD-001）です。",
          ),
        ),
      }),
  }),
  plainCommand({
    path: ["gcloud", "info"],
    summary: "Display information about the current gcloud environment.",
    flags: [Flag.boolean("run-diagnostics", "Run diagnostics (prints that all checks passed).")],
    run: (ctx, args) =>
      Result.ok({
        world: ctx.world,
        output: CommandOutput.messages(
          ...(ParsedArgs.boolean(args, "run-diagnostics")
            ? [
                OutputMessage.plain(
                  "Network diagnostic (skipped: gcloud-sim has no network)... passed (0/0 checks).",
                ),
                OutputMessage.plain(
                  "Property diagnostic detects issues that may be caused by properties... passed (1/1 checks).",
                ),
              ]
            : environmentLines(ctx.world).map(OutputMessage.plain)),
        ),
      }),
  }),
  plainCommand({
    path: ["gcloud", "init"],
    summary:
      "Initialize or reinitialize gcloud (non-interactive: prints the current configuration).",
    flags: [
      Flag.boolean("skip-diagnostics", "Do not run diagnostics."),
      Flag.boolean("console-only", "Prevent the command from launching a browser."),
    ],
    run: (ctx) =>
      Result.ok({
        world: ctx.world,
        output: CommandOutput.messages(
          OutputMessage.plain(
            "Welcome! This command will take you through the configuration of gcloud.",
          ),
          OutputMessage.plain(""),
          OutputMessage.plain(
            `Settings from your current configuration [${ctx.world.config.activeConfiguration}] are:`,
          ),
          ...configListLines(ctx.world.config).slice(0, -2).map(OutputMessage.plain),
          OutputMessage.plain(""),
          OutputMessage.hint(
            "gcloud-sim: 対話は再現しません。gcloud auth login ACCOUNT / gcloud config set project PROJECT_ID / gcloud config set compute/zone ZONE を順に打つと同じ状態になります。",
          ),
        ),
      }),
  }),
  plainCommand({
    path: ["gcloud", "components", "list"],
    summary: "List the status of all Google Cloud CLI components.",
    run: (ctx) =>
      Result.ok({
        world: ctx.world,
        output: CommandOutput.table(componentRows(ctx.world), ComponentColumns, [
          OutputMessage.plain(`Your current Google Cloud CLI version is: ${CliVersion}`),
          OutputMessage.plain(`The latest available version is: ${CliVersion}`),
          OutputMessage.plain(""),
        ]),
      }),
  }),
  plainCommand({
    path: ["gcloud", "components", "install"],
    summary: "Install specified components.",
    positionals: [
      Positional.variadic("COMPONENT_IDS", "The IDs of the components to install, e.g. kubectl."),
    ],
    run: (ctx, args) => {
      const unknown = args.positionals.find((id) => !Option.isSome(CliComponent.parse(id)));
      if (unknown !== undefined) {
        return Result.err(
          CommandFailure.invalidValue(
            "COMPONENT_IDS",
            `The following components are unknown [${unknown}].`,
          ),
        );
      }
      const world = args.positionals.reduce((w, id) => World.withComponent(w, id), ctx.world);
      return Result.ok({
        world,
        output: CommandOutput.messages(
          OutputMessage.plain(""),
          OutputMessage.plain(`Your current Google Cloud CLI version is: ${CliVersion}`),
          OutputMessage.plain(`Installing components from version: ${CliVersion}`),
          OutputMessage.plain(""),
          ...args.positionals.map((id) => OutputMessage.plain(`Installing ${id}...done.`)),
          OutputMessage.plain(""),
          OutputMessage.plain("Update done!"),
        ),
      });
    },
  }),
  plainCommand({
    path: ["gcloud", "components", "update"],
    summary: "Update all of your installed components.",
    run: (ctx) =>
      Result.ok({
        world: ctx.world,
        output: CommandOutput.messages(
          OutputMessage.plain(""),
          OutputMessage.plain(`All components are up to date.`),
          OutputMessage.plain(`Your current Google Cloud CLI version is: ${CliVersion}`),
        ),
      }),
  }),
];
