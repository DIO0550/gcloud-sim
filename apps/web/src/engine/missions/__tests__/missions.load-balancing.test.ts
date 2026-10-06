// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { executeLb } from "@/engine/__tests__/lb.setup";
import { initialWorld, session } from "@/engine/__tests__/setup";
import { World } from "@/engine/domains/world";
import {
  applicationLesson,
  bucketLesson,
  cleanupLesson,
  internalLesson,
  type LbLesson,
  lbSatisfied,
  negLesson,
  passthroughLesson,
  tlsLesson,
} from "@/engine/missions/load-balancing";
import { Result } from "@/utils/Result";

const cases: readonly Readonly<{ id: string; lesson: LbLesson; commands: readonly string[] }>[] = [
  { id: "m-lb-001", lesson: "application", commands: applicationLesson() },
  { id: "m-lb-002", lesson: "passthrough", commands: passthroughLesson },
  { id: "m-lb-003", lesson: "internal", commands: internalLesson },
  { id: "m-lb-004", lesson: "neg", commands: negLesson },
  { id: "m-lb-005", lesson: "tls", commands: tlsLesson },
  { id: "m-lb-006", lesson: "bucket", commands: bucketLesson },
  { id: "m-lb-007", lesson: "cleanup", commands: cleanupLesson },
];
test.each(cases)(
  "$id requires complete initial-world solution and stays incomplete partway",
  ({ id, lesson, commands }) => {
    const started = session(Result.unwrap(Engine.startMission(initialWorld(), id)));
    expect(lbSatisfied(started.world, lesson)).toBe(false);
    const partial = executeLb(started, ...commands.slice(0, -1));
    expect(lbSatisfied(partial.world, lesson)).toBe(false);
    expect(World.findMissionProgress(partial.world, id)).toMatchObject({
      value: { status: "in_progress" },
    });
    const complete = executeLb(partial, ...commands.slice(-1));
    expect(lbSatisfied(complete.world, lesson)).toBe(true);
    expect(World.findMissionProgress(complete.world, id)).toMatchObject({
      value: { status: "completed" },
    });
  },
);
