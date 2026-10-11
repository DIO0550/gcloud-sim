// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { AceScenarios } from "@/engine/domains/ace-support/catalog";
import { Mission } from "@/engine/missions";
import { ExamSections, examSectionOf } from "@/engine/missions/exam-sections";

test("all 48 source rows lead to existing missions and every mission has one of four exam sections", () => {
  const source = readFileSync(
    new URL("../../../../../../../docs/ACE_SOURCE_MAP.md", import.meta.url),
    "utf8",
  );
  const rows = source.split("\n").filter((line) => line.startsWith("| ") && line.includes(".pdf"));
  expect(rows).toHaveLength(48);
  const ids = new Set(Mission.all().map((m) => m.id));
  for (const row of rows) {
    const referenced = [...row.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
    expect(referenced.length, row).toBeGreaterThan(0);
    for (const id of referenced) {
      expect(ids.has(id as string), row).toBe(true);
    }
  }
  expect(new Set(Mission.all().map((m) => m.id)).size).toBe(Mission.all().length);
  for (const mission of Mission.all()) {
    expect(Object.values(ExamSections)).toContain(examSectionOf(mission));
  }
  expect(new Set(AceScenarios.map((s) => s.id)).size).toBe(AceScenarios.length);
});
