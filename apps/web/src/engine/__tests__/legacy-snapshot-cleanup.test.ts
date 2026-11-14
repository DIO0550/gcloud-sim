// @vitest-environment node
import { expect, test } from "vitest";
import { Engine, Shell } from "@/engine";
import { Now, run, session } from "@/engine/__tests__/fixture-setup";
import { aiSolutions } from "@/engine/missions/ace-support";
import { MissionStep } from "@/engine/missions/mission-step";
import { Snapshot } from "@/engine/snapshot";
import { Result } from "@/utils/Result";

test("旧AI教材の架空リソースをimport時に除き、正式なCLIで関連SAを削除できる", () => {
  const legacy = run(session(), ...MissionStep.lines(aiSolutions("notebook")));
  expect(legacy.world.aceSupport.resources).toHaveLength(1);
  const world = Result.unwrap(Snapshot.fromUnknown(Snapshot.create(legacy.world, Now)));
  expect(world.aceSupport).toEqual({ resources: [], decisions: [] });
  const deleted = Engine.execute({
    world,
    shell: Shell.Ready,
    now: Now,
    line: "gcloud iam service-accounts delete ace-notebook@ace-dev-01.iam.gserviceaccount.com --quiet",
  });
  expect(deleted.outcome.kind, deleted.lines.map((line) => line.text).join("\n")).toBe("succeeded");
});
