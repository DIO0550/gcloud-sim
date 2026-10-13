import { type ExecuteInput, type ExecuteResult, Engine as PublicEngine, Shell } from "@/engine";
import { Mission, ScenarioMissions } from "@/engine/__tests__/fixture-missions";
import { CommandRegistry } from "@/engine/cli/registry";
import { Tokenizer } from "@/engine/cli/tokenizer";
import { AllCommands, ScenarioControls } from "@/engine/commands";
import { observationEvents } from "@/engine/domains/observability-lab/events";
import { storageEvents } from "@/engine/domains/serverless-lab/runtime";
import type { World } from "@/engine/domains/world";
import { Result } from "@/utils/Result";

export * from "@/engine";

/** 旧教材の状態操作を、ドメインモデルのテスト用fixtureとしてだけ実行する。公開Engineとは独立。 */
export const FixtureCommands = [...AllCommands, ...ScenarioControls];
const registry = CommandRegistry.create(FixtureCommands);
export const Engine = {
  ...PublicEngine,
  registry,
  missions: () => ScenarioMissions,
  completionCandidates(world: World, line: string): readonly string[] {
    const tokens = Tokenizer.tokenize(line);
    if (!tokens.ok) {
      return [];
    }
    const trailingSpace = /\s$/.test(line);
    return CommandRegistry.complete(
      registry,
      {
        tokens: trailingSpace ? tokens.value : tokens.value.slice(0, -1),
        partial: trailingSpace ? "" : (tokens.value.at(-1) ?? ""),
        world,
      },
      Shell.globalsFor(tokens.value[0]),
    );
  },
  revealHint(world: World, id: string): World {
    const mission = Mission.find(id);
    return mission.some ? Mission.revealHint(world, mission.value) : world;
  },
  startMission(world: World, id: string) {
    const mission = ScenarioMissions.find((m) => m.id === id);
    if (!mission) {
      return Result.err({ missionId: id, reason: "unknown mission" });
    }
    return Mission.start(world, mission);
  },
  execute(input: ExecuteInput): ExecuteResult {
    const submitted = Shell.submit({ ...input, state: input.shell, registry });
    const observed = observationEvents(input.world, submitted.world, input.now);
    const { world, completed } = Mission.evaluate(storageEvents(input.world, observed, input.line));
    return {
      world,
      shell: submitted.state,
      lines: [
        ...submitted.lines,
        ...completed.flatMap((m) => [
          { text: "", tone: "plain" as const },
          { text: `gcloud-sim: ✓ ミッションクリア「${m.title}」`, tone: "success" as const },
        ]),
      ],
      clearsScreen: submitted.clearsScreen,
      completed,
      outcome: submitted.outcome,
    };
  },
} as const;
