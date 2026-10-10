// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { Now, run, session } from "@/engine/__tests__/setup";
import { Mission } from "@/engine/missions";
import {
  type ComputeLesson,
  ComputeMissions,
  ComputePrelude,
  ComputeSolutions,
  computeSatisfied,
} from "@/engine/missions/compute-lab";
import { Snapshot } from "@/engine/snapshot";

for (const mission of ComputeMissions) {
  test(`${mission.title}: fresh, intermediate, restored result`, () => {
    const started = Engine.startMission(session().world, mission.id);
    if (!started.ok) {
      throw new Error(started.error.reason);
    }
    const lesson = (mission.assertions[0] as { lesson: ComputeLesson }).lesson;
    let s = run(session(started.value), ...ComputePrelude);
    expect(computeSatisfied(s.world, lesson)).toBe(false);
    for (const [index, input] of ComputeSolutions[lesson].entries()) {
      const member =
        s.world.instanceGroups.find((g) => g.name === "healing")?.instanceNames[0] ?? "missing";
      const line = input.replace("@member", member);
      s = run(s, line);
      expect(s.text, line).not.toContain("ERROR:");
      if (index < ComputeSolutions[lesson].length - 1) {
        expect(computeSatisfied(s.world, lesson), line).toBe(false);
      }
      const saved = Snapshot.fromUnknown(Snapshot.create(s.world, Now));
      if (!saved.ok) {
        throw new Error(`${line}: ${JSON.stringify(saved.error)}`);
      }
      expect(saved.value.computeLab).toEqual(s.world.computeLab);
      s = session(saved.value);
    }
    expect(computeSatisfied(s.world, lesson), JSON.stringify(s.world.computeLab)).toBe(true);
    expect(Mission.assertionResults(s.world, mission).every(Boolean)).toBe(true);
  });
}
