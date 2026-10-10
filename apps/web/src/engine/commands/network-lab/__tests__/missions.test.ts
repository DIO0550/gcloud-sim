// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { Now, run, session } from "@/engine/__tests__/setup";
import { Mission } from "@/engine/missions";
import {
  type NetworkLesson,
  NetworkMissions,
  NetworkPrelude,
  NetworkSolutions,
  networkSatisfied,
} from "@/engine/missions/network-lab";
import { Snapshot } from "@/engine/snapshot";

for (const mission of NetworkMissions) {
  test(`${mission.title}: fresh, intermediate, restored state`, () => {
    const started = Engine.startMission(session().world, mission.id);
    if (!started.ok) {
      throw new Error(started.error.reason);
    }
    const lesson = (mission.assertions[0] as { lesson: NetworkLesson }).lesson;
    let s = run(session(started.value), ...NetworkPrelude);
    expect(networkSatisfied(s.world, lesson)).toBe(false);
    for (const [index, line] of NetworkSolutions[lesson].entries()) {
      s = run(s, line);
      expect(s.text, line).not.toContain("ERROR:");
      if (index < NetworkSolutions[lesson].length - 1) {
        expect(networkSatisfied(s.world, lesson), line).toBe(false);
      }
      const saved = Snapshot.fromUnknown(Snapshot.create(s.world, Now));
      if (!saved.ok) {
        throw new Error(`${line}: ${JSON.stringify(saved.error)}`);
      }
      expect(saved.value.networkLab).toEqual(s.world.networkLab);
      s = session(saved.value);
    }
    expect(networkSatisfied(s.world, lesson), JSON.stringify(s.world.networkLab)).toBe(true);
    expect(Mission.assertionResults(s.world, mission).every(Boolean)).toBe(true);
  });
}
