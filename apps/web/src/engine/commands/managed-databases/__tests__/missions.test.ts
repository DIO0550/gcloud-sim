// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { Now, run, session } from "@/engine/__tests__/setup";
import { Mission } from "@/engine/missions";
import {
  type ManagedDatabaseLesson,
  ManagedDatabaseMissions,
  ManagedDatabasePrelude,
  ManagedDatabaseSolutions,
  managedDatabaseSatisfied,
} from "@/engine/missions/managed-databases";
import { Snapshot } from "@/engine/snapshot";

for (const mission of ManagedDatabaseMissions) {
  test(`${mission.title}: initial, intermediate states, solution and snapshot`, () => {
    const started = Engine.startMission(session().world, mission.id);
    if (!started.ok) {
      throw new Error(started.error.reason);
    }
    const lesson = (mission.assertions[0] as { lesson: ManagedDatabaseLesson }).lesson;
    let s = run(session(started.value), ...ManagedDatabasePrelude);
    expect(managedDatabaseSatisfied(s.world, lesson)).toBe(false);
    const commands = ManagedDatabaseSolutions[lesson];
    for (const [i, line] of commands.entries()) {
      s = run(s, line);
      expect(s.text, line).not.toContain("ERROR:");
      if (i < commands.length - 1) {
        expect(managedDatabaseSatisfied(s.world, lesson), line).toBe(false);
      }
      const saved = Snapshot.fromUnknown(Snapshot.create(s.world, Now));
      if (!saved.ok) {
        throw new Error(`${line}: ${JSON.stringify(saved.error)}`);
      }
      expect(saved.value.managedDatabases).toEqual(s.world.managedDatabases);
      // Continue from decoded arrays, which must not rely on object identity.
      s = session(saved.value);
    }
    expect(
      managedDatabaseSatisfied(s.world, lesson),
      JSON.stringify(s.world.managedDatabases),
    ).toBe(true);
    expect(Mission.assertionResults(s.world, mission).every(Boolean)).toBe(true);
  });
}
