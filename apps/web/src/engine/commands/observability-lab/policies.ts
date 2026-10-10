import { CommandFailure } from "@/engine/cli/command-failure";
import {
  type CommandResult,
  Flag,
  ParsedArgs,
  type ProjectContext,
} from "@/engine/cli/command-spec";
import { AlertPolicy } from "@/engine/domains/monitoring";
import { policyFromJson } from "@/engine/domains/observability-lab/policy";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";
import { command, invalid, missing, name, readJson, same, save, sf, text } from "./shared";

export const createPolicyFromFile = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const numbered = World.nextNumber(ctx.world);
  const input = readJson(ctx, text(args, "policy-from-file"));
  return Result.flatMap(input, (json) =>
    Result.flatMap(
      Result.mapErr(
        policyFromJson(json, ctx.project.projectId, String(numbered.number), numbered.number),
        CommandFailure.invalidArgumentWith,
      ),
      (parsed) => {
        const world = {
          ...numbered.world,
          alertPolicies: [...numbered.world.alertPolicies, parsed.policy],
        };
        const configuration = parsed.configuration;
        return save(
          world,
          { policies: [...world.observabilityLab.policies, configuration] },
          {
            ...AlertPolicy.toRecord(parsed.policy),
            combiner: configuration.combiner,
            simulated: true,
          },
        );
      },
    ),
  );
};

export const ObservePolicyCommands = [
  command({
    path: ["gcloud", "monitoring", "policies", "update"],
    permissions: ["monitoring.alertPolicies.update"],
    named: true,
    flags: [
      sf("policy-from-file"),
      Flag.enum("combiner", "Combine conditions.", ["OR", "AND", "AND_WITH_MATCHING_RESOURCE"]),
      Flag.boolean("enabled", "Policy enabled state."),
      Flag.list("set-notification-channels", "Replace full channel resource names."),
    ],
    run: (ctx, args) => {
      const project = ctx.project.projectId;
      const prefix = `projects/${project}/alertPolicies/`;
      const id = name(args).startsWith(prefix) ? name(args).slice(prefix.length) : name(args);
      const policy = ctx.world.alertPolicies.find((p) => p.projectId === project && p.name === id);
      if (!policy) {
        return missing("Alert policy not found in the selected project.");
      }
      const previous = ctx.world.observabilityLab.policies.find((p) => same(p, policy));
      const filename = text(args, "policy-from-file");
      if (filename) {
        if (
          ParsedArgs.booleanChoice(args, "enabled").some ||
          ParsedArgs.string(args, "combiner").some ||
          ParsedArgs.has(args, "set-notification-channels")
        ) {
          return invalid(
            "Use a policy file alone for full replacement, or flags alone for selected fields.",
          );
        }
        const numbered = World.nextNumber(ctx.world);
        return Result.flatMap(readJson(ctx, filename), (json) =>
          Result.flatMap(
            Result.mapErr(
              policyFromJson(json, project, id, numbered.number, previous),
              CommandFailure.invalidArgumentWith,
            ),
            (parsed) => {
              const world = {
                ...numbered.world,
                alertPolicies: numbered.world.alertPolicies.map((p) =>
                  p === policy ? parsed.policy : p,
                ),
              };
              return save(
                world,
                {
                  policies: [
                    ...world.observabilityLab.policies.filter((p) => !same(p, policy)),
                    parsed.configuration,
                  ],
                  evaluations: world.observabilityLab.evaluations.filter((e) => !same(e, policy)),
                },
                {
                  ...AlertPolicy.toRecord(parsed.policy),
                  combiner: parsed.configuration.combiner,
                  simulated: true,
                },
              );
            },
          ),
        );
      }
      if (!previous) {
        return invalid(
          "Update this legacy single-condition policy with a supported JSON policy first.",
        );
      }
      const enabled = ParsedArgs.booleanChoice(args, "enabled");
      const combiner = ParsedArgs.string(args, "combiner");
      const channelFlag = ParsedArgs.has(args, "set-notification-channels");
      if (!enabled.some && !combiner.some && !channelFlag) {
        return invalid("Specify an update field.");
      }
      const raw = ParsedArgs.list(args, "set-notification-channels");
      const channelPrefix = `projects/${project}/notificationChannels/`;
      if (
        channelFlag &&
        raw.some((c) => !c.startsWith(channelPrefix) || c.slice(channelPrefix.length).includes("/"))
      ) {
        return invalid("Use full channel names from the policy project.");
      }
      const configuration = {
        ...previous,
        combiner: Option.unwrapOr(combiner, previous.combiner) as typeof previous.combiner,
        channels: channelFlag ? raw.map((c) => c.slice(channelPrefix.length)) : previous.channels,
      };
      const updated = { ...policy, enabled: Option.unwrapOr(enabled, policy.enabled) };
      const world = {
        ...ctx.world,
        alertPolicies: ctx.world.alertPolicies.map((p) => (p === policy ? updated : p)),
      };
      return save(
        world,
        {
          policies: ctx.world.observabilityLab.policies.map((p) =>
            p === previous ? configuration : p,
          ),
          evaluations: ctx.world.observabilityLab.evaluations.filter((e) => !same(e, policy)),
        },
        { ...AlertPolicy.toRecord(updated), combiner: configuration.combiner, simulated: true },
      );
    },
  }),
];
