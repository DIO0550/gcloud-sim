// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { Now, run, session } from "@/engine/__tests__/setup";
import { Mission } from "@/engine/missions";
import {
  type RelationalLesson,
  RelationalMissions,
  RelationalPrelude,
  RelationalSolutions,
  relationalSatisfied,
} from "@/engine/missions/relational";
import { Snapshot } from "@/engine/snapshot";

for (const mission of RelationalMissions) {
  test(`${mission.title}: initial, every intermediate step, solution and save/restore`, () => {
    const initial = Engine.startMission(session().world, mission.id);
    if (!initial.ok) {
      throw new Error(initial.error.reason);
    }
    const lesson = (mission.assertions[0] as { lesson: RelationalLesson }).lesson;
    let s = run(session(initial.value), ...RelationalPrelude);
    expect(relationalSatisfied(s.world, lesson)).toBe(false);
    const commands = RelationalSolutions[lesson];
    for (const [i, raw] of commands.entries()) {
      const backup = s.world.sqlBackups.at(-1)?.id ?? "MISSING";
      const line = raw.replace("BACKUP_ID", backup);
      s = run(s, line);
      expect(s.text, line).not.toContain("ERROR:");
      if (i < commands.length - 1) {
        expect(relationalSatisfied(s.world, lesson), line).toBe(false);
      }
      const restored = Snapshot.fromUnknown(Snapshot.create(s.world, Now));
      expect(restored, line).toMatchObject({ ok: true });
    }
    expect(relationalSatisfied(s.world, lesson), s.text).toBe(true);
    expect(Mission.assertionResults(s.world, mission).every(Boolean)).toBe(true);
    const restored = Snapshot.fromUnknown(Snapshot.create(s.world, Now));
    if (!restored.ok) {
      throw new Error(JSON.stringify(restored.error));
    }
    expect(restored.value.relational).toEqual(s.world.relational);
    expect(relationalSatisfied(restored.value, lesson)).toBe(true);
  });
}
