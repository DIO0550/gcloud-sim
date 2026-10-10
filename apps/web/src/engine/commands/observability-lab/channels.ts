import { CommandOutput, Flag, ParsedArgs } from "@/engine/cli/command-spec";
import type { NotificationChannel } from "@/engine/domains/observability-lab/model";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";
import { command, finish, invalid, missing, name, same, save, sf, text } from "./shared";

export const channelRecord = (c: NotificationChannel) => ({
  name: `projects/${c.projectId}/notificationChannels/${c.name}`,
  displayName: c.name,
  type: "email",
  labels: { email_address: c.email },
  enabled: c.enabled,
  verificationStatus: c.verified ? "VERIFIED" : "UNVERIFIED",
});
const id = (raw: string, project: string): string =>
  raw.replace(`projects/${project}/notificationChannels/`, "");
const channelFlags = (action: string) => {
  if (action === "update") {
    return [Flag.boolean("enabled", "Channel enablement does not verify delivery.")];
  }
  if (action === "delete") {
    return [Flag.boolean("force", "Remove references from policies before deletion.")];
  }
  return [];
};

export const ObserveChannelCommands = [
  command({
    path: ["gcloud", "monitoring", "channels", "create"],
    permissions: ["monitoring.notificationChannels.create"],
    flags: [
      sf("display-name", true),
      Flag.enum("type", "Only email is modeled.", ["email"], { required: true }),
      Flag.keyvalue("channel-labels", "email_address=ADDRESS", { required: true }),
      Flag.boolean("enabled", "Enable the channel; verification is separate."),
    ],
    run: (ctx, args) => {
      const labels = ParsedArgs.keyvalue(args, "channel-labels");
      if (Object.keys(labels).length !== 1 || !labels.email_address) {
        return invalid("Email channel needs only email_address.");
      }
      const channel: NotificationChannel = {
        projectId: ctx.project.projectId,
        name: text(args, "display-name"),
        email: labels.email_address,
        enabled: Option.unwrapOr(ParsedArgs.booleanChoice(args, "enabled"), true),
        verified: false,
      };
      if (ctx.world.observabilityLab.channels.some((c) => same(c, channel))) {
        return invalid("Channel ID already exists; lesson display names are unique IDs.");
      }
      return save(
        ctx.world,
        { channels: [...ctx.world.observabilityLab.channels, channel] },
        channelRecord(channel),
      );
    },
  }),
  command({
    path: ["gcloud", "monitoring", "channels", "list"],
    permissions: ["monitoring.notificationChannels.list"],
    run: (ctx) =>
      Result.ok({
        world: ctx.world,
        output: CommandOutput.yamlList(
          ctx.world.observabilityLab.channels
            .filter((c) => c.projectId === ctx.project.projectId)
            .map(channelRecord),
        ),
      }),
  }),
  ...(["describe", "update", "delete"] as const).map((action) =>
    command({
      path: ["gcloud", "monitoring", "channels", action],
      permissions: [`monitoring.notificationChannels.${action === "describe" ? "get" : action}`],
      named: true,
      destructive: action === "delete",
      flags: channelFlags(action),
      run: (ctx, args) => {
        const channel = ctx.world.observabilityLab.channels.find(
          (c) =>
            c.projectId === ctx.project.projectId &&
            c.name === id(name(args), ctx.project.projectId),
        );
        if (!channel) {
          return missing("Notification channel not found in the selected project.");
        }
        if (action === "describe") {
          return finish(ctx.world, channelRecord(channel));
        }
        if (action === "update") {
          const enabled = ParsedArgs.booleanChoice(args, "enabled");
          if (!enabled.some) {
            return invalid("Specify --enabled or --no-enabled.");
          }
          const updated = { ...channel, enabled: enabled.value };
          return save(
            ctx.world,
            {
              channels: ctx.world.observabilityLab.channels.map((c) =>
                c === channel ? updated : c,
              ),
            },
            channelRecord(updated),
          );
        }
        const policies = ctx.world.observabilityLab.policies;
        if (
          !ParsedArgs.boolean(args, "force") &&
          policies.some(
            (p) => p.projectId === channel.projectId && p.channels.includes(channel.name),
          )
        ) {
          return invalid("Channel is referenced. Remove policy references or use --force.");
        }
        const updated = policies.map((p) =>
          p.projectId === channel.projectId
            ? { ...p, channels: p.channels.filter((c) => c !== channel.name) }
            : p,
        );
        return save(
          ctx.world,
          {
            channels: ctx.world.observabilityLab.channels.filter((c) => c !== channel),
            policies: updated,
            evaluations: ctx.world.observabilityLab.evaluations.filter(
              (e) => e.projectId !== channel.projectId,
            ),
          },
          { deleted: channel.name },
        );
      },
    }),
  ),
  command({
    path: ["sim", "monitoring", "channels", "verify"],
    permissions: ["monitoring.notificationChannels.update"],
    named: true,
    run: (ctx, args) => {
      const channel = ctx.world.observabilityLab.channels.find(
        (c) => c.projectId === ctx.project.projectId && c.name === name(args),
      );
      if (!channel) {
        return missing("Channel not found.");
      }
      const updated = { ...channel, verified: true };
      return save(
        ctx.world,
        { channels: ctx.world.observabilityLab.channels.map((c) => (c === channel ? updated : c)) },
        {
          ...channelRecord(updated),
          simulated: true,
          message: "Synthetic verification; no email or external verification code.",
        },
      );
    },
  }),
];
