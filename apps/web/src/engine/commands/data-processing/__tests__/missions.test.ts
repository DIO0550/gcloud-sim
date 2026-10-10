// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { Now, run, session } from "@/engine/__tests__/setup";
import { Mission } from "@/engine/missions";
import {
  type DataLesson,
  DataMissions,
  DataPrelude,
  DataSolutions,
  dataSatisfied,
} from "@/engine/missions/data-processing";
import { Snapshot } from "@/engine/snapshot";

for (const mission of DataMissions) {
  test(`${mission.title}: initial, every intermediate, saved solution`, () => {
    const started = Engine.startMission(session().world, mission.id);
    if (!started.ok) {
      throw new Error(started.error.reason);
    }
    const lesson = (mission.assertions[0] as { lesson: DataLesson }).lesson;
    let s = run(session(started.value), ...DataPrelude);
    expect(dataSatisfied(s.world, lesson)).toBe(false);
    const commands = DataSolutions[lesson];
    for (const [i, line] of commands.entries()) {
      s = run(s, line);
      const expectedFailure =
        lesson === "recovery" &&
        s.world.dataProcessing.processingJobs.some((j) => j.state === "FAILED");
      if (!expectedFailure) {
        expect(s.text, line).not.toContain("ERROR:");
      }
      if (i < commands.length - 1) {
        expect(dataSatisfied(s.world, lesson), line).toBe(false);
      }
      const saved = Snapshot.fromUnknown(Snapshot.create(s.world, Now));
      if (!saved.ok) {
        throw new Error(`${line}: ${JSON.stringify(saved.error)}`);
      }
      expect(saved.value.dataProcessing).toEqual(s.world.dataProcessing);
      s = session(saved.value);
    }
    expect(dataSatisfied(s.world, lesson), JSON.stringify(s.world.dataProcessing)).toBe(true);
    expect(Mission.assertionResults(s.world, mission).every(Boolean)).toBe(true);
  });
}
