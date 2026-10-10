// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { Now, run, session } from "@/engine/__tests__/setup";
import { Mission } from "@/engine/missions";
import {
  type StorageLesson,
  StorageMissions,
  StoragePrelude,
  StorageSolutions,
  storageSatisfied,
} from "@/engine/missions/storage-lab";
import { Snapshot } from "@/engine/snapshot";

for (const mission of StorageMissions) {
  test(`${mission.title}: fresh, intermediate, restored state`, () => {
    const started = Engine.startMission(session().world, mission.id);
    if (!started.ok) {
      throw new Error(started.error.reason);
    }
    const lesson = (mission.assertions[0] as { lesson: StorageLesson }).lesson;
    let s = run(session(started.value), ...StoragePrelude);
    expect(storageSatisfied(s.world, lesson)).toBe(false);
    for (const [index, line] of StorageSolutions[lesson].entries()) {
      s = run(s, line);
      expect(s.text, line).not.toContain("ERROR:");
      if (index < StorageSolutions[lesson].length - 1) {
        expect(storageSatisfied(s.world, lesson), line).toBe(false);
      }
      const saved = Snapshot.fromUnknown(Snapshot.create(s.world, Now));
      if (!saved.ok) {
        throw new Error(`${line}: ${JSON.stringify(saved.error)}`);
      }
      expect(saved.value.storageLab).toEqual(s.world.storageLab);
      s = session(saved.value);
    }
    expect(storageSatisfied(s.world, lesson), JSON.stringify(s.world.storageLab)).toBe(true);
    expect(Mission.assertionResults(s.world, mission).every(Boolean)).toBe(true);
  });
}
