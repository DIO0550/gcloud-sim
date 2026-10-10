import type { PubsubSubscription } from "@/engine/domains/data";
import { World } from "@/engine/domains/world";
import { Result } from "@/utils/Result";
import { type Message, patch, type Receipt } from "./model";

export const settings = (world: World, sub: PubsubSubscription) =>
  world.dataProcessing.subscriptions.find(
    (s) => s.projectId === sub.projectId && s.name === sub.name,
  ) ?? {
    projectId: sub.projectId,
    name: sub.name,
    retention: 604800,
    deadLetterTopic: "",
    maxAttempts: 5,
  };
export const enqueue = (
  world: World,
  projectId: string,
  topic: string,
  data: string,
  messageId = "",
): Result<Readonly<{ world: World; id: string }>, string> => {
  const subscriptions = world.pubsubSubscriptions.filter(
    (s) => s.projectId === projectId && s.topic === topic,
  );
  if (
    data.length > 4096 ||
    world.dataProcessing.messages.length >= 1000 ||
    world.dataProcessing.receipts.length + subscriptions.length > 5000
  ) {
    return Result.err("Pub/Sub message/receipt limit exceeded.");
  }
  const numbered = World.nextNumber(world);
  const id = messageId || `message-${numbered.number}`;
  const message: Message = {
    projectId,
    name: id,
    topic,
    data,
    publishedAt: world.dataProcessing.clock,
  };
  const receipts: Receipt[] = subscriptions.map((s) => ({
    projectId,
    subscription: s.name,
    message: id,
    attempts: 0,
    deadline: 0,
    ackId: "",
    state: "AVAILABLE",
  }));
  return Result.ok({
    id,
    world: patch(numbered.world, {
      messages: [...world.dataProcessing.messages, message],
      receipts: [...world.dataProcessing.receipts, ...receipts],
    }),
  });
};
export const eligible = (world: World, sub: PubsubSubscription): readonly Receipt[] =>
  world.dataProcessing.receipts.filter((r) => {
    if (r.projectId !== sub.projectId || r.subscription !== sub.name) {
      return false;
    }
    const message = world.dataProcessing.messages.find(
      (m) => m.projectId === r.projectId && m.name === r.message,
    );
    if (
      !message ||
      world.dataProcessing.clock - message.publishedAt >= settings(world, sub).retention
    ) {
      return false;
    }
    return (
      r.state === "AVAILABLE" ||
      (r.state === "IN_FLIGHT" && r.deadline <= world.dataProcessing.clock)
    );
  });
export const expire = (world: World): World =>
  patch(world, {
    receipts: world.dataProcessing.receipts.map((r) => {
      if (!["AVAILABLE", "IN_FLIGHT"].includes(r.state)) {
        return r;
      }
      const sub = world.pubsubSubscriptions.find(
        (s) => s.projectId === r.projectId && s.name === r.subscription,
      );
      const message = world.dataProcessing.messages.find(
        (m) => m.projectId === r.projectId && m.name === r.message,
      );
      if (
        sub &&
        message &&
        world.dataProcessing.clock - message.publishedAt >= settings(world, sub).retention
      ) {
        return { ...r, state: "EXPIRED", ackId: "" };
      }
      return r;
    }),
  });
