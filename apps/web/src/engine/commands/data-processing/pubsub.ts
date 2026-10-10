import { CommandFailure } from "@/engine/cli/command-failure";
import { Flag, ParsedArgs, type ProjectContext } from "@/engine/cli/command-spec";
import { Candidates } from "@/engine/commands/shared";
import {
  PubsubName,
  type PubsubSubscription,
  PubsubSubscription as Sub,
} from "@/engine/domains/data";
import { patch, type Receipt } from "@/engine/domains/data-processing/model";
import { eligible, enqueue, expire, settings } from "@/engine/domains/data-processing/pubsub";
import { allows } from "@/engine/domains/serverless-lab/runtime";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";
import { command, finish, integer, invalid, name, observed, sf, text } from "./shared";

export const subscriptionArg = (ctx: ProjectContext, value: string) => {
  const sub = ctx.world.pubsubSubscriptions.find(
    (s) => s.projectId === ctx.project.projectId && s.name === value,
  );
  return sub
    ? Result.ok(sub)
    : Result.err(
        CommandFailure.notFound(`projects/${ctx.project.projectId}/subscriptions/${value}`),
      );
};
const deliver = (ctx: ProjectContext, sub: PubsubSubscription, limit: number, ack: boolean) => {
  if (limit < 1 || limit > 100) {
    return invalid("--limit must be 1..100.");
  }
  let world = expire(ctx.world);
  const records: { ackId: string; messageId: string; data: string; deliveryAttempt: number }[] = [];
  for (const r of eligible(world, sub).slice(0, limit)) {
    const config = settings(world, sub);
    const message = world.dataProcessing.messages.find(
      (m) => m.projectId === r.projectId && m.name === r.message,
    );
    if (!message) {
      return invalid("Message reference is missing.");
    }
    if (config.deadLetterTopic && r.attempts >= config.maxAttempts) {
      const agent = `service-${ctx.project.projectNumber}@gcp-sa-pubsub.iam.gserviceaccount.com`;
      if (
        !allows(world, sub.projectId, agent, "pubsub.topics.publish") ||
        !allows(world, sub.projectId, agent, "pubsub.subscriptions.consume")
      ) {
        return invalid("Dead-letter service agent needs publisher and subscriber roles.");
      }
      const sent = enqueue(world, sub.projectId, config.deadLetterTopic, message.data);
      if (!sent.ok) {
        return invalid(sent.error);
      }
      world = patch(sent.value.world, {
        receipts: sent.value.world.dataProcessing.receipts.map((v) =>
          v === r ? { ...v, state: "DEAD_LETTER", ackId: "" } : v,
        ),
      });
      continue;
    }
    if (r.attempts >= 100) {
      return invalid("Delivery attempt limit reached.");
    }
    const numbered = World.nextNumber(world);
    const receipt: Receipt = {
      ...r,
      attempts: r.attempts + 1,
      deadline: world.dataProcessing.clock + sub.ackDeadlineSeconds,
      ackId: ack ? "" : `ack-${numbered.number}`,
      state: ack ? "ACKED" : "IN_FLIGHT",
    };
    world = patch(numbered.world, {
      receipts: numbered.world.dataProcessing.receipts.map((v) => (v === r ? receipt : v)),
    });
    records.push({
      ackId: receipt.ackId,
      messageId: message.name,
      data: message.data,
      deliveryAttempt: receipt.attempts,
    });
  }
  return Result.ok({ world, records });
};
export const PubsubDataCommands = [
  command(
    ["gcloud", "pubsub", "subscriptions", "pull"],
    "pubsub.googleapis.com",
    "pubsub.subscriptions.consume",
    (ctx, a) =>
      Result.flatMap(subscriptionArg(ctx, name(a)), (sub) => {
        if (sub.pushEndpoint.some) {
          return invalid("Pull requires a pull subscription.");
        }
        return Result.flatMap(
          deliver(ctx, sub, integer(a, "limit", 1), ParsedArgs.boolean(a, "auto-ack")),
          (v) => observed(v.world, ctx, sub.name, "pull", { messages: v.records }),
        );
      }),
    [
      Flag.integer("limit", "1..100 messages."),
      Flag.boolean("auto-ack", "Acknowledge delivered messages."),
    ],
    true,
    Candidates.pubsubSubscriptions,
  ),
  command(
    ["gcloud", "pubsub", "subscriptions", "ack"],
    "pubsub.googleapis.com",
    "pubsub.subscriptions.consume",
    (ctx, a) =>
      Result.flatMap(subscriptionArg(ctx, name(a)), (sub) => {
        if (sub.pushEndpoint.some) {
          return invalid("Explicit ACK requires a pull subscription.");
        }
        const ids = text(a, "ack-ids").split(",");
        const receipts = ctx.world.dataProcessing.receipts.filter(
          (r) =>
            r.projectId === sub.projectId &&
            r.subscription === sub.name &&
            r.state === "IN_FLIGHT" &&
            r.deadline > ctx.world.dataProcessing.clock &&
            ids.includes(r.ackId),
        );
        if (
          ids.some((s) => s === "") ||
          new Set(ids).size !== ids.length ||
          receipts.length !== ids.length
        ) {
          return invalid("Unknown, duplicate or expired ACK ID.");
        }
        return observed(
          patch(ctx.world, {
            receipts: ctx.world.dataProcessing.receipts.map((r) =>
              receipts.includes(r) ? { ...r, state: "ACKED", ackId: "" } : r,
            ),
          }),
          ctx,
          sub.name,
          "ack",
          { acknowledged: receipts.length },
        );
      }),
    [sf("ack-ids", true)],
    true,
    Candidates.pubsubSubscriptions,
  ),
  command(
    ["sim", "pubsub", "push"],
    "pubsub.googleapis.com",
    "pubsub.subscriptions.consume",
    (ctx, a) =>
      Result.flatMap(subscriptionArg(ctx, name(a)), (sub) => {
        const code = integer(a, "response-code", 200);
        if (!sub.pushEndpoint.some || ![200, 503].includes(code)) {
          return invalid("Specify a push subscription and --response-code=200 or 503.");
        }
        return Result.flatMap(deliver(ctx, sub, integer(a, "limit", 1), code === 200), (v) =>
          observed(v.world, ctx, sub.name, "push", { responseCode: code, messages: v.records }),
        );
      }),
    [
      Flag.integer("response-code", "200 acknowledges; 503 retries after the deadline."),
      Flag.integer("limit", "1..100 messages."),
    ],
    true,
    Candidates.pubsubSubscriptions,
  ),
  command(
    ["sim", "time", "advance"],
    "pubsub.googleapis.com",
    "pubsub.subscriptions.consume",
    (ctx, a) => {
      const seconds = integer(a, "seconds", 0);
      const clock = ctx.world.dataProcessing.clock + seconds;
      if (seconds < 1 || seconds > 604800 || clock > 3153600000) {
        return invalid("Advance by 1..604800 virtual seconds.");
      }
      return finish(expire(patch(ctx.world, { clock })), { clock });
    },
    [Flag.integer("seconds", "Virtual seconds.", { required: true })],
    false,
  ),
  command(
    ["gcloud", "pubsub", "subscriptions", "update"],
    "pubsub.googleapis.com",
    "pubsub.subscriptions.update",
    (ctx, a) =>
      Result.flatMap(subscriptionArg(ctx, name(a)), (sub) => {
        const old = settings(ctx.world, sub);
        const retention = integer(a, "message-retention-duration", old.retention);
        const maxAttempts = integer(a, "max-delivery-attempts", old.maxAttempts);
        const deadLetterTopic = text(a, "dead-letter-topic", old.deadLetterTopic);
        if (
          retention < 10 ||
          retention > 604800 ||
          maxAttempts < 5 ||
          maxAttempts > 100 ||
          (deadLetterTopic &&
            (deadLetterTopic === sub.topic ||
              !ctx.world.pubsubTopics.some(
                (t) => t.projectId === sub.projectId && t.name === deadLetterTopic,
              )))
        ) {
          return invalid(
            "Invalid retention (10..604800 seconds) or dead-letter configuration (5..100 attempts).",
          );
        }
        if (ParsedArgs.boolean(a, "clear-push-endpoint") && text(a, "push-endpoint")) {
          return invalid("Conflicting push endpoint flags.");
        }
        let endpoint = sub.pushEndpoint;
        if (ParsedArgs.boolean(a, "clear-push-endpoint")) {
          endpoint = Option.none;
        } else if (text(a, "push-endpoint")) {
          endpoint = Option.some(text(a, "push-endpoint"));
        }
        const created = Sub.create({
          ...sub,
          pushEndpoint: endpoint,
          ackDeadlineSeconds: Option.some(integer(a, "ack-deadline", sub.ackDeadlineSeconds)),
        });
        if (!created.ok) {
          return invalid(created.error);
        }
        const config = {
          projectId: sub.projectId,
          name: sub.name,
          retention,
          maxAttempts,
          deadLetterTopic,
        };
        const world = {
          ...ctx.world,
          pubsubSubscriptions: ctx.world.pubsubSubscriptions.map((s) =>
            s === sub ? created.value : s,
          ),
        };
        return finish(
          expire(
            patch(world, {
              subscriptions: [
                ...world.dataProcessing.subscriptions.filter(
                  (s) => !(s.projectId === sub.projectId && s.name === sub.name),
                ),
                config,
              ],
            }),
          ),
          {
            ...config,
            ackDeadlineSeconds: created.value.ackDeadlineSeconds,
            pushEndpoint: Option.unwrapOr(endpoint, ""),
          },
        );
      }),
    [
      Flag.integer("message-retention-duration", "Retention seconds."),
      Flag.integer("max-delivery-attempts", "Dead-letter attempts."),
      sf("dead-letter-topic", false, Candidates.pubsubTopics),
      Flag.integer("ack-deadline", "ACK seconds: 10..600."),
      sf("push-endpoint"),
      Flag.boolean("clear-push-endpoint", "Change to pull."),
    ],
    true,
    Candidates.pubsubSubscriptions,
  ),
  command(
    ["gcloud", "pubsub", "subscriptions", "delete"],
    "pubsub.googleapis.com",
    "pubsub.subscriptions.delete",
    (ctx, a) =>
      Result.flatMap(subscriptionArg(ctx, name(a)), (sub) => {
        if (
          ctx.world.dataProcessing.processingJobs.some(
            (j) =>
              j.projectId === sub.projectId &&
              j.input === `subscription:${sub.name}` &&
              ["QUEUED", "RUNNING"].includes(j.state),
          )
        ) {
          return invalid("An active processing job uses this subscription.");
        }
        const world = {
          ...ctx.world,
          pubsubSubscriptions: ctx.world.pubsubSubscriptions.filter((s) => s !== sub),
        };
        return finish(
          patch(world, {
            subscriptions: world.dataProcessing.subscriptions.filter(
              (s) => !(s.projectId === sub.projectId && s.name === sub.name),
            ),
            receipts: world.dataProcessing.receipts.filter(
              (r) => !(r.projectId === sub.projectId && r.subscription === sub.name),
            ),
          }),
          { deleted: sub.name },
        );
      }),
    [],
    true,
    Candidates.pubsubSubscriptions,
    true,
  ),
  command(
    ["gcloud", "pubsub", "topics", "delete"],
    "pubsub.googleapis.com",
    "pubsub.topics.delete",
    (ctx, a) => {
      const topic = ctx.world.pubsubTopics.find(
        (t) => t.projectId === ctx.project.projectId && t.name === name(a),
      );
      if (!topic || !PubsubName.parse(name(a)).ok) {
        return invalid("Topic does not exist.");
      }
      if (
        ctx.world.pubsubSubscriptions.some(
          (s) => s.projectId === topic.projectId && s.topic === topic.name,
        ) ||
        ctx.world.dataProcessing.subscriptions.some(
          (s) => s.projectId === topic.projectId && s.deadLetterTopic === topic.name,
        ) ||
        ctx.world.serverlessLab.deployments.some(
          (d) =>
            d.projectId === topic.projectId &&
            d.trigger.kind === "topic" &&
            d.trigger.source === topic.name,
        ) ||
        ctx.world.serverlessLab.triggers.some(
          (t) =>
            t.projectId === topic.projectId &&
            t.filter.kind === "topic" &&
            t.filter.source === topic.name,
        )
      ) {
        return invalid("Topic still has subscriptions or triggers.");
      }
      return finish(
        { ...ctx.world, pubsubTopics: ctx.world.pubsubTopics.filter((t) => t !== topic) },
        { deleted: topic.name },
      );
    },
    [],
    true,
    Candidates.pubsubTopics,
    true,
  ),
];
