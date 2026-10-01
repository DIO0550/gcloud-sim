import { ErrorCodes } from "@/engine/cli/command-failure";
import { CommandRegistry } from "@/engine/cli/registry";
import { type ExecutionOutcome, type OutputLine, Shell, type ShellState } from "@/engine/cli/shell";
import { Tokenizer } from "@/engine/cli/tokenizer";
import { AllCommands } from "@/engine/commands";
import type { World } from "@/engine/domains/world";
import { InitialWorld } from "@/engine/initial-world";
import { Mission, type MissionSetupFailure } from "@/engine/missions";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

/** UI が使うエンジンの公開入口（DJ-002 / DJ-011: Console ビューもここだけを使う）。 */

const registry = CommandRegistry.create(AllCommands);

export type ExecuteInput = Readonly<{
  world: World;
  shell: ShellState;
  line: string;
  now: string;
}>;

export type ExecuteResult = Readonly<{
  world: World;
  shell: ShellState;
  lines: readonly OutputLine[];
  clearsScreen: boolean;
  /** 今回の実行でクリアしたミッション（UC-006 ステップ 3 の祝福に使う） */
  completed: readonly Mission[];
  /** 成否。Console ビューが赤帯や一覧への遷移を決めるのに使う */
  outcome: ExecutionOutcome;
}>;

export const Engine = {
  registry,

  /**
   * 1 行を実行し、続けてミッションを評価する（UC-001 ステップ 1〜8, 10）。保存（ステップ 9）は呼び出し側。
   *
   * @param input World・shell 状態・入力行・時刻
   * @returns 新しい World・shell 状態・出力行・クリアしたミッション
   */
  execute(input: ExecuteInput): ExecuteResult {
    const submitted = Shell.submit({ ...input, state: input.shell, registry });
    const evaluated = Mission.evaluate(submitted.world);
    const celebration = evaluated.completed.flatMap((m): readonly OutputLine[] => [
      { text: "", tone: "plain" },
      { text: `gcloud-sim: ✓ ミッションクリア「${m.title}」`, tone: "success" },
    ]);
    return {
      world: evaluated.world,
      shell: submitted.state,
      lines: [...submitted.lines, ...celebration],
      clearsScreen: submitted.clearsScreen,
      completed: evaluated.completed,
      outcome: submitted.outcome,
    };
  },

  /**
   * Tab 補完の候補（TBD-009: コマンド名・フラグ名・フラグの値・リソース名）。
   *
   * @param world 候補を引く World（VM 名・バケット名などはここから出る）
   * @param line 入力途中の行
   * @returns 最後の語を置き換える候補
   */
  completionCandidates(world: World, line: string): readonly string[] {
    const endsWithSpace = /\s$/.test(line);
    const tokens = Tokenizer.tokenize(line);
    if (!Result.isOk(tokens)) return [];
    const confirmed = endsWithSpace ? tokens.value : tokens.value.slice(0, -1);
    const partial = endsWithSpace ? "" : (tokens.value.at(-1) ?? "");
    return CommandRegistry.complete(
      registry,
      { tokens: confirmed, partial, world },
      Shell.GlobalFlags,
    );
  },

  /**
   * 初期 World（UC-005 Reset）。
   *
   * @param now 作成時刻
   * @returns サンプル組織・フォルダ 2・プロジェクト 2・請求 1・default ネットワークの World
   */
  initialWorld(now: string): World {
    return InitialWorld.create(
      now,
      Mission.all().map((m) => m.id),
    );
  },

  missions(): readonly Mission[] {
    return Mission.all();
  },

  startMission(world: World, id: string): Result<World, MissionSetupFailure> {
    const mission = Mission.find(id);
    return Option.isSome(mission)
      ? Mission.start(world, mission.value)
      : Result.err({ missionId: id, reason: "unknown mission" });
  },

  abandonMission(world: World, id: string): World {
    return Mission.abandon(world, id);
  },

  revealHint(world: World, id: string): World {
    const mission = Mission.find(id);
    return Option.isSome(mission) ? Mission.revealHint(world, mission.value) : world;
  },
} as const;

export { ErrorCodes, type ExecutionOutcome, type OutputLine, Shell, type ShellState };
