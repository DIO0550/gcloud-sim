// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { Now, run, session } from "@/engine/__tests__/setup";
import { Mission } from "@/engine/missions";
import {
  type AdminLesson,
  AdminMissions,
  AdminPrelude,
  AdminSolutions,
  adminSatisfied,
} from "@/engine/missions/admin-lab";
import { Snapshot } from "@/engine/snapshot";

for (const mission of AdminMissions) {
  test(`${mission.title}: fresh, intermediate, restored state`, () => {
    const started = Engine.startMission(session().world, mission.id);
    if (!started.ok) {
      throw new Error(started.error.reason);
    }
    const lesson = (mission.assertions[0] as { lesson: AdminLesson }).lesson;
    let s = run(session(started.value), ...AdminPrelude);
    expect(adminSatisfied(s.world, lesson)).toBe(false);
    for (const [index, line] of AdminSolutions[lesson].entries()) {
      s = run(s, line);
      expect(s.text, line).not.toContain("ERROR:");
      if (index < AdminSolutions[lesson].length - 1) {
        expect(adminSatisfied(s.world, lesson), line).toBe(false);
      }
      const saved = Snapshot.fromUnknown(Snapshot.create(s.world, Now));
      if (!saved.ok) {
        throw new Error(`${line}: ${JSON.stringify(saved.error)}`);
      }
      expect(saved.value.adminLab).toEqual(s.world.adminLab);
      s = session(saved.value);
    }
    expect(adminSatisfied(s.world, lesson), JSON.stringify(s.world.adminLab)).toBe(true);
    expect(Mission.assertionResults(s.world, mission).every(Boolean)).toBe(true);
  });
}
