import { ArgParser } from "@/engine/cli/arg-parser";
import { ErrorCodes } from "@/engine/cli/command-failure";
import { CommandRegistry } from "@/engine/cli/registry";
import { type ExecutionStatus, type OutputLine, Shell, type ShellState } from "@/engine/cli/shell";
import { Tokenizer } from "@/engine/cli/tokenizer";
import { AllCommands } from "@/engine/commands";
import { Zone } from "@/engine/domains/catalog";
import { ConfigurationFiles } from "@/engine/domains/configuration-files";
import { observationEvents } from "@/engine/domains/observability-lab/events";
import { storageEvents } from "@/engine/domains/serverless-lab/runtime";
import { type World, World as WorldOps } from "@/engine/domains/world";
import { InitialWorld } from "@/engine/initial-world";
import { Mission, type MissionSetupFailure } from "@/engine/missions";
import { TreeSelection } from "@/engine/resource-tree";
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
  outcome: ExecutionStatus;
}>;

/** GKE のクラスタとノードプールは置き場（`--zone` / `--region`）が無いと引けないので、World から足す。 */
const withClusterLocation = (world: World, selection: TreeSelection, command: string): string => {
  if (selection.kind !== "cluster" && selection.kind !== "node-pool") return command;
  const name = selection.kind === "cluster" ? selection.name : selection.cluster;
  const cluster = WorldOps.clustersOf(world, selection.projectId).find((c) => c.name === name);
  if (cluster === undefined) return command;
  const scope = Option.isSome(Zone.parse(cluster.location)) ? "zone" : "region";
  return `${command} --${scope}=${cluster.location}`;
};

export const Engine = {
  registry,
  editFiles: ConfigurationFiles.edit,

  /**
   * 1 行を実行し、続けてミッションを評価する（UC-001 ステップ 1〜8, 10）。保存（ステップ 9）は呼び出し側。
   *
   * @param input World・shell 状態・入力行・時刻
   * @returns 新しい World・shell 状態・出力行・クリアしたミッション
   */
  execute(input: ExecuteInput): ExecuteResult {
    const submitted = Shell.submit({ ...input, state: input.shell, registry });
    const observed = observationEvents(input.world, submitted.world, input.now);
    const evaluated = Mission.evaluate(storageEvents(input.world, observed, input.line));
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
      Shell.globalsFor(tokens.value[0]),
    );
  },

  /**
   * ツリーで選んだリソースを消すコマンド（プロパティパネルの「delete を挿入」）。登録簿で解決でき、
   * 引数がそのまま通るものだけを返す（未実装の delete や、本物でも消せないもの（KMS のキーリング等）は `none`）。
   * プロジェクトの中のものには `--project` を付ける（今のプロジェクトと違うプロジェクトのものを選んでも消せるように）。
   *
   * @param selection ツリーの選択
   * @returns 入力行に入れる削除コマンド
   */
  deleteCommand(world: World, selection: TreeSelection): Option<string> {
    const base = TreeSelection.deleteCommand(selection);
    if (!Option.isSome(base)) return Option.none;
    const projectId = TreeSelection.projectIdOf(selection);
    const located = withClusterLocation(world, selection, base.value);
    const command =
      located.startsWith("gcloud ") &&
      selection.kind !== "project" &&
      Option.isSome(projectId) &&
      !located.includes("--project")
        ? `${located} --project=${projectId.value}`
        : located;
    const tokens = Tokenizer.tokenize(command);
    if (!Result.isOk(tokens)) return Option.none;
    const resolved = CommandRegistry.resolve(registry, tokens.value);
    if (!Result.isOk(resolved) || resolved.value.spec.kind === "not-implemented") {
      return Option.none;
    }
    const { spec, rest } = resolved.value;
    const parsed = ArgParser.parse(
      rest,
      [...spec.flags, ...Shell.globalsFor(spec.path[0])],
      spec.positionals,
    );
    return Result.isOk(parsed) ? Option.some(command) : Option.none;
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

  /**
   * @param now 開始した時刻。setup が「何分前の操作」を作るときの基準（省略時は World 内の最新の時刻）
   */
  startMission(world: World, id: string, now?: string): Result<World, MissionSetupFailure> {
    const mission = Mission.find(id);
    return Option.isSome(mission)
      ? Mission.start(world, mission.value, now)
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

export { ErrorCodes, type ExecutionStatus, type OutputLine, Shell, type ShellState };
