// @vitest-environment node
import { expect, test } from "vitest";
import { Now, run, session } from "@/engine/__tests__/setup";
import {
  TerraformLessonMissions,
  TerraformLessonSteps,
  terraformLessonSatisfied,
} from "@/engine/missions/terraform-lessons";
import { Snapshot } from "@/engine/snapshot";
import { Result } from "@/utils/Result";

for (const mission of TerraformLessonMissions) {
  test(`${mission.id}: the complete lesson survives save/reload and requires its final operation`, () => {
    const assertion = mission.assertions[0];
    if (assertion?.kind !== "terraformLesson") {
      throw new Error("Missing lesson assertion");
    }
    let s = session();
    expect(terraformLessonSatisfied(s.world, assertion)).toBe(false);
    for (const command of TerraformLessonSteps[assertion.lesson]) {
      s = run(s, command);
      expect(s.text, command).not.toContain("ERROR:");
      const saved = Snapshot.fromUnknown(JSON.parse(JSON.stringify(Snapshot.create(s.world, Now))));
      expect(Result.isOk(saved), command).toBe(true);
      if (Result.isOk(saved)) {
        s = { ...s, world: saved.value };
      }
    }
    expect(terraformLessonSatisfied(s.world, assertion), JSON.stringify(s.world.terraform)).toBe(
      true,
    );
    expect(
      terraformLessonSatisfied(
        { ...s.world, terraform: { ...s.world.terraform, resources: [], events: [], plans: {} } },
        assertion,
      ),
    ).toBe(false);
  });
}
