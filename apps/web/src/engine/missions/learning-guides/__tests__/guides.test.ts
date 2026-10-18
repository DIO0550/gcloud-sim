// @vitest-environment node
import { expect, test } from "vitest";
import { Engine, Shell, type ShellState } from "@/engine";
import { Now } from "@/engine/__tests__/fixture-setup";
import { ConfigurationFiles } from "@/engine/domains/configuration-files";
import { Mission } from "@/engine/missions";
import { MissionGuides } from "@/engine/missions/learning-guides";
import { Result } from "@/utils/Result";

test.each(Mission.all())(
  "$id: 掲載された手順を初期状態から順に進めると達成条件を満たす",
  (mission) => {
    const guide = MissionGuides.find(mission.id);
    if (!guide) {
      throw new Error(`学習手順がありません: ${mission.id}`);
    }
    expect(guide.steps.length).toBeGreaterThanOrEqual(2);
    expect(new Set(guide.steps.map((s) => s.title)).size).toBe(guide.steps.length);
    let world = Result.unwrap(Engine.startMission(Engine.initialWorld(Now), mission.id));
    let shell: ShellState = Shell.Ready;
    const variables: Record<string, string> = {};
    const resolve = (text: string): string =>
      text.replace(/<([A-Z_]+)>/g, (_, name: string) => {
        const value = variables[name];
        if (value === undefined) {
          throw new Error(`取得していない値を使っています: ${name}`);
        }
        return value;
      });

    for (const step of guide.steps) {
      expect(step.explanation, step.title).not.toBe("");
      expect(step.points.length, step.title).toBeGreaterThan(0);
      expect(step.expected, step.title).not.toBe("");
      for (const action of step.actions) {
        if (action.kind === "command" || action.kind === "answer") {
          const line = resolve(action.text);
          expect(line).not.toMatch(/\bsim\s/);
          const result = Engine.execute({ world, shell, line, now: Now });
          const text = result.lines.map((l) => l.text).join("\n");
          expect(result.outcome.kind === "failed", `${step.title}: ${line}\n${text}`).toBe(
            action.kind === "command" && action.expectFailure === true,
          );
          world = result.world;
          shell = result.shell;
          if (action.kind === "command" && action.capture) {
            const match = new RegExp(action.capture.pattern).exec(text);
            const value = match?.[1];
            expect(value, `${line}: 取得する値がありません\n${text}`).toBeDefined();
            if (value !== undefined) {
              variables[action.capture.name] = value;
            }
          }
          continue;
        }
        if (action.kind === "replace") {
          const before = ConfigurationFiles.filesOf(world)[action.name];
          expect(before, action.name).toContain(action.before);
          world = Result.unwrap(
            Engine.editFiles(world, {
              kind: "write",
              name: action.name,
              content: (before ?? "").replaceAll(action.before, action.after),
            }),
          );
          continue;
        }
        world = Result.unwrap(Engine.editFiles(world, action));
      }
    }
    expect(shell.kind).toBe("ready");
    expect(Mission.assertionResults(world, mission), mission.id).not.toContain(false);
  },
);
