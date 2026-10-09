import { CommandFailure } from "@/engine/cli/command-failure";
import {
  Column,
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
  describeNamedCommand,
  projectCommand,
} from "@/engine/commands/shared";
import { PubsubSubscription, PubsubTopic } from "@/engine/domains/data";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const PubsubApi = "pubsub.googleapis.com" as const;
const TopicColumns = [Column.create("NAME", "name")];
const SubscriptionColumns = [
  Column.create("NAME", "name"),
  Column.create("TOPIC", "topic"),
  Column.create("TYPE", "type"),
];

const createTopic = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const topic = Result.mapErr(
    PubsubTopic.create({
      projectId: ctx.project.projectId,
      name: ParsedArgs.requiredPositional(args, 0),
      createTime: ctx.now,
    }),
    (m) => CommandFailure.invalidValue("TOPIC", m),
  );
  if (!Result.isOk(topic)) return topic;
  return Result.map(
    Result.mapErr(
      World.withNamed(ctx.world, "pubsubTopics", topic.value, PubsubTopic.fullName(topic.value)),
      alreadyExists,
    ),
    (world) => ({
      world,
      output: CommandOutput.messages(
        OutputMessage.plain(`Created topic [${PubsubTopic.fullName(topic.value)}].`),
      ),
    }),
  );
};

const createSubscription = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const topicName = ParsedArgs.requiredString(args, "topic");
  const topic = World.findNamed(ctx.world, "pubsubTopics", {
    projectId: ctx.project.projectId,
    name: topicName,
  });
  if (!Option.isSome(topic)) {
    return Result.err(
      CommandFailure.notFoundWith(`NOT_FOUND: Resource not found (resource=${topicName}).`),
    );
  }
  const subscription = Result.mapErr(
    PubsubSubscription.create({
      projectId: ctx.project.projectId,
      name: ParsedArgs.requiredPositional(args, 0),
      topic: topicName,
      ackDeadlineSeconds: ParsedArgs.integer(args, "ack-deadline"),
      pushEndpoint: ParsedArgs.string(args, "push-endpoint"),
      createTime: ctx.now,
    }),
    (m) => CommandFailure.invalidValue("SUBSCRIPTION", m),
  );
  if (!Result.isOk(subscription)) return subscription;
  return Result.map(
    Result.mapErr(
      World.withNamed(
        ctx.world,
        "pubsubSubscriptions",
        subscription.value,
        PubsubSubscription.fullName(subscription.value),
      ),
      alreadyExists,
    ),
    (world) => ({
      world,
      output: CommandOutput.messages(
        OutputMessage.plain(
          `Created subscription [${PubsubSubscription.fullName(subscription.value)}].`,
        ),
      ),
    }),
  );
};

export const PubsubCommands: readonly CommandSpec[] = [
  projectCommand({
    path: ["gcloud", "pubsub", "topics", "create"],
    summary: "Create one or more Cloud Pub/Sub topics.",
    positionals: [Positional.required("TOPIC", "ID of the topic to create.")],
    permission: "pubsub.topics.create",
    requiredApis: [PubsubApi],
    run: createTopic,
  }),
  projectCommand({
    path: ["gcloud", "pubsub", "topics", "list"],
    summary: "List Cloud Pub/Sub topics.",
    permission: "pubsub.topics.list",
    requiredApis: [PubsubApi],
    run: (ctx) =>
      Result.ok({
        world: ctx.world,
        output: CommandOutput.table(
          World.namedOf(ctx.world, "pubsubTopics", ctx.project.projectId).map(PubsubTopic.toRecord),
          TopicColumns,
        ),
      }),
  }),
  describeNamedCommand({
    path: ["gcloud", "pubsub", "topics", "describe"],
    summary: "Describe a Cloud Pub/Sub topic.",
    positional: { name: "TOPIC", description: "ID of the topic to describe." },
    collection: "pubsubTopics",
    permission: "pubsub.topics.get",
    requiredApis: [PubsubApi],
    resourcePath: (ref) => `projects/${ref.projectId}/topics/${ref.name}`,
    record: PubsubTopic.toRecord,
  }),
  projectCommand({
    path: ["gcloud", "pubsub", "subscriptions", "create"],
    summary: "Create one or more Cloud Pub/Sub subscriptions.",
    positionals: [Positional.required("SUBSCRIPTION", "ID of the subscription to create.")],
    flags: [
      Flag.string(
        "topic",
        "The name of the topic from which this subscription is receiving messages.",
        { required: true, candidates: Candidates.pubsubTopics },
      ),
      Flag.integer(
        "ack-deadline",
        "The number of seconds the system will wait for a subscriber to acknowledge (default 10).",
      ),
      Flag.string(
        "push-endpoint",
        "A URL to use as the endpoint for this subscription (push delivery).",
      ),
    ],
    permission: "pubsub.subscriptions.create",
    requiredApis: [PubsubApi],
    run: createSubscription,
  }),
  projectCommand({
    path: ["gcloud", "pubsub", "subscriptions", "list"],
    summary: "List Cloud Pub/Sub subscriptions.",
    permission: "pubsub.topics.list",
    requiredApis: [PubsubApi],
    run: (ctx) =>
      Result.ok({
        world: ctx.world,
        output: CommandOutput.table(
          World.namedOf(ctx.world, "pubsubSubscriptions", ctx.project.projectId).map((s) => ({
            ...PubsubSubscription.toRecord(s),
            type: Option.isSome(s.pushEndpoint) ? "PUSH" : "PULL",
          })),
          SubscriptionColumns,
        ),
      }),
  }),
  describeNamedCommand({
    path: ["gcloud", "pubsub", "subscriptions", "describe"],
    summary: "Describe a Cloud Pub/Sub subscription.",
    positional: { name: "SUBSCRIPTION", description: "ID of the subscription to describe." },
    collection: "pubsubSubscriptions",
    permission: "pubsub.subscriptions.get",
    requiredApis: [PubsubApi],
    resourcePath: (ref) => `projects/${ref.projectId}/subscriptions/${ref.name}`,
    record: PubsubSubscription.toRecord,
  }),
];
