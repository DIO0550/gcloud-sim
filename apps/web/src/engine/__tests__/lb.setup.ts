import { expect } from "vitest";
import { run, type Session, session } from "@/engine/__tests__/setup";
import { World } from "@/engine/domains/world";
import { applicationLesson } from "@/engine/missions/load-balancing";
import { Result } from "@/utils/Result";
export const executeLb = (start: Session, ...commands: readonly string[]): Session =>
  commands.reduce((s, c) => {
    const next = run(s, c);
    expect(next.text, c).not.toMatch(/^(ERROR:|error:|Error from server)/m);
    const validation = World.validate(next.world);
    expect(
      Result.isOk(validation),
      `${c}: ${Result.isOk(validation) ? "" : validation.error}`,
    ).toBe(true);
    return next;
  }, start);
export const applicationCommands = applicationLesson;
export const applicationLb = (prefix = "web", start = session()): Session =>
  executeLb(start, ...applicationCommands(prefix));
