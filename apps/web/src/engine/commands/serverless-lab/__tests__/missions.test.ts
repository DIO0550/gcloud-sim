// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { Now, run, session } from "@/engine/__tests__/setup";
import { Mission } from "@/engine/missions";
import {
  type ServerlessLesson,
  ServerlessMissions,
  ServerlessPrelude,
  ServerlessSolutions,
  serverlessSatisfied,
} from "@/engine/missions/serverless";
import { Snapshot } from "@/engine/snapshot";
import { Result } from "@/utils/Result";

for (const m of ServerlessMissions) {
  const lesson = m.assertions[0] as { lesson: ServerlessLesson };
  test(`${lesson.lesson}: fresh World, every solution step and Snapshot roundtrip`, () => {
    const initial = Engine.startMission(session().world, m.id);
    expect(initial.ok).toBe(true);
    if (!initial.ok) {
      throw new Error(initial.error.reason);
    }
    let s = run(session(initial.value), ...ServerlessPrelude);
    expect(serverlessSatisfied(s.world, lesson.lesson)).toBe(false);
    const steps = ServerlessSolutions[lesson.lesson];
    for (const [i, step] of steps.entries()) {
      const number = s.world.projects.find((p) => p.projectId === "ace-dev-01")!.projectNumber;
      const line = step
        .replace("SERVICE_AGENT", `service-${number}@serverless-robot-prod.iam.gserviceaccount.com`)
        .replace("EVENT_ID", s.world.serverlessLab.events.at(-1)?.id ?? "MISSING");
      s = run(s, line);
      if (
        !line.includes("functions call private-api") &&
        !line.includes("functions call secret-api")
      ) {
        expect(s.text, line).not.toContain("ERROR:");
      }
      if (i < steps.length - 1) {
        expect(serverlessSatisfied(s.world, lesson.lesson), line).toBe(false);
      }
    }
    expect(serverlessSatisfied(s.world, lesson.lesson), s.text).toBe(true);
    expect(Mission.assertionResults(s.world, m).every(Boolean)).toBe(true);
    const restored = Snapshot.fromUnknown(Snapshot.create(s.world, Now));
    expect(restored, s.text).toMatchObject({ ok: true });
    if (Result.isOk(restored)) {
      expect(restored.value.serverlessLab).toEqual(s.world.serverlessLab);
      expect(serverlessSatisfied(restored.value, lesson.lesson)).toBe(true);
    }
  });
}
