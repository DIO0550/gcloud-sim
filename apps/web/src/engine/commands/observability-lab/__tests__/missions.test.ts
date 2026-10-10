// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { Now, run, session } from "@/engine/__tests__/setup";
import { Mission } from "@/engine/missions";
import {
  type ObserveLesson,
  ObserveMissions,
  ObservePrelude,
  ObserveSolutions,
  observeSatisfied,
} from "@/engine/missions/observability-lab";
import { Snapshot } from "@/engine/snapshot";

for (const mission of ObserveMissions) {
  test(`${mission.title}: initial, every intermediate, saved solution`, () => {
    const started = Engine.startMission(session().world, mission.id);
    if (!started.ok) {
      throw new Error(started.error.reason);
    }
    const lesson = (mission.assertions[0] as { lesson: ObserveLesson }).lesson;
    let s = session(started.value);
    expect(observeSatisfied(s.world, lesson)).toBe(false);
    for (const line of ObservePrelude) {
      s = run(s, line);
      expect(s.text, line).not.toContain("ERROR:");
    }
    const commands = ObserveSolutions[lesson];
    for (const [i, line] of commands.entries()) {
      s = run(s, line);
      expect(s.text, line).not.toContain("ERROR:");
      if (i < commands.length - 1) {
        expect(observeSatisfied(s.world, lesson), line).toBe(false);
      }
      const saved = Snapshot.fromUnknown(Snapshot.create(s.world, Now));
      if (!saved.ok) {
        throw new Error(`${line}: ${JSON.stringify(saved.error)}`);
      }
      expect(saved.value.observabilityLab).toEqual(s.world.observabilityLab);
      s = session(saved.value);
    }
    expect(observeSatisfied(s.world, lesson), JSON.stringify(s.world.observabilityLab)).toBe(true);
    expect(Mission.assertionResults(s.world, mission).every(Boolean)).toBe(true);
  });
}
