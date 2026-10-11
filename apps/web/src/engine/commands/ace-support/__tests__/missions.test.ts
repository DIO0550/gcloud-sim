// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { Now, run, session } from "@/engine/__tests__/setup";
import { AceScenarios } from "@/engine/domains/ace-support/catalog";
import { Mission } from "@/engine/missions";
import {
  AceDecisionMissions,
  AiMissions,
  aceSatisfied,
  aiSolutions,
} from "@/engine/missions/ace-support";
import { Snapshot } from "@/engine/snapshot";

for (const mission of [...AceDecisionMissions, ...AiMissions]) {
  test(`${mission.title}: initial, incomplete, solution and saved state`, () => {
    const started = Engine.startMission(session().world, mission.id);
    if (!started.ok) {
      throw new Error(started.error.reason);
    }
    let s = session(started.value);
    const a = mission.assertions[0];
    if (!a) {
      throw new Error("Missing assertion");
    }
    if (a.kind !== "aceDecision" && a.kind !== "aiLesson") {
      throw new Error("Invalid assertion");
    }
    expect(aceSatisfied(s.world, a)).toBe(false);
    let steps: readonly string[];
    if (a.kind === "aceDecision") {
      const scenario = AceScenarios.find((item) => item.id === a.scenario);
      if (!scenario) {
        throw new Error("Missing scenario");
      }
      s = run(
        s,
        `sim ace scenarios choose ${scenario.id} --choice=${scenario.choices.find((c) => c !== scenario.answer)} --reason='incorrect trial'`,
      );
      expect(s.text).toContain("INCORRECT");
      expect(aceSatisfied(s.world, a)).toBe(false);
      steps = [mission.hints[1] as string];
    } else {
      steps = aiSolutions(a.lesson);
    }
    for (const [i, line] of steps.entries()) {
      s = run(s, line);
      expect(s.text, line).not.toContain("ERROR:");
      if (i < steps.length - 1) {
        expect(aceSatisfied(s.world, a), line).toBe(false);
      }
      const saved = Snapshot.fromUnknown(Snapshot.create(s.world, Now));
      if (!saved.ok) {
        throw new Error(`${line}: ${JSON.stringify(saved.error)}`);
      }
      expect(saved.value.aceSupport).toEqual(s.world.aceSupport);
      s = session(saved.value);
    }
    expect(Mission.assertionResults(s.world, mission).every(Boolean), s.text).toBe(true);
  });
}
