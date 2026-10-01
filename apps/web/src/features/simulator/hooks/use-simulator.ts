import { useReducer } from "react";

import { Engine, type ExecutionOutcome, type OutputLine, Shell, type ShellState } from "@/engine";
import type { World } from "@/engine/domains/world";
import type { Mission } from "@/engine/missions";
import type { TreeSelection } from "@/engine/resource-tree";
import { type ConsoleScreen, ConsoleScreens } from "@/features/simulator/features/console";
import type { ValueOf } from "@/types/ValueOf";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

/**
 * ターミナルに流れた 1 行。どこから来たか（打った / ヘッダー等の UI / Console のフォーム）を持ち、
 * `cli` 以外はグレーで出す（UC-008 の「グレー表示で記録」）。
 */
export type TranscriptLine = Readonly<{
  id: number;
  kind: "input" | "output" | "note";
  origin: "cli" | "ui" | "console";
  text: string;
  tone: OutputLine["tone"];
}>;

/** CLI と Console のどちらを出しているか（ヘッダーの切り替え）。 */
export const Views = { Cli: "cli", Console: "console" } as const;
export type View = ValueOf<typeof Views>;

/**
 * Console のフォームから流したコマンドの結果。成功なら一覧へ戻り、失敗ならフォームに赤帯を出す
 * （UC-008 例外フロー）。`line` は何を流したか。
 */
export type ConsoleOutcome = Readonly<{ line: string; outcome: ExecutionOutcome }>;

/** 保存しておく行数の上限。超えた分は古いものから捨てる（端末側は id で差分を取るので消えても困らない）。 */
export const TranscriptLimit = 2000;

export const PanelTabs = {
  Properties: "properties",
  Missions: "missions",
  Log: "log",
} as const;
export type PanelTab = ValueOf<typeof PanelTabs>;

/** 直近の保存の結果。E-010 の表示に使う。 */
export type SaveState =
  | Readonly<{ kind: "saved"; bytes: number }>
  | Readonly<{ kind: "failed"; reason: string }>;

export type SimulatorState = Readonly<{
  world: World;
  shell: ShellState;
  transcript: readonly TranscriptLine[];
  nextLineId: number;
  selection: Option<TreeSelection>;
  panelTab: PanelTab;
  settingsOpen: boolean;
  /** ツリーのダブルクリックで入力行に入れる文字列。端末が取り込んだら `insertConsumed` で消す */
  pendingInsert: Option<string>;
  selectedMissionId: Option<string>;
  importError: Option<string>;
  /** `clear` のたびに増える。ターミナルは値が変わったら画面を消す */
  screenClearCount: number;
  /** 直近でクリアしたミッション。パネルの通知に使う */
  celebration: Option<Mission>;
  saveState: SaveState;
  view: View;
  consoleScreen: ConsoleScreen;
  consoleOutcome: Option<ConsoleOutcome>;
}>;

export type SimulatorAction =
  | Readonly<{ type: "submitted"; line: string; now: string; origin: "cli" | "ui" }>
  | Readonly<{
      type: "consoleSubmitted";
      line: string;
      now: string;
      /** 端末に `# Console: ...` として先に出す説明 */
      note: string;
      /** 成功したら移る画面（フォーム → 一覧） */
      next: Option<ConsoleScreen>;
    }>
  | Readonly<{ type: "viewChanged"; view: View }>
  | Readonly<{ type: "consoleScreenChanged"; screen: ConsoleScreen }>
  | Readonly<{ type: "consoleOutcomeCleared" }>
  | Readonly<{ type: "selected"; selection: TreeSelection }>
  | Readonly<{ type: "insertRequested"; text: string }>
  | Readonly<{ type: "insertConsumed" }>
  | Readonly<{ type: "tabChanged"; tab: PanelTab }>
  | Readonly<{ type: "settingsToggled"; open: boolean }>
  | Readonly<{ type: "missionSelected"; id: string }>
  | Readonly<{ type: "missionStarted"; id: string }>
  | Readonly<{ type: "missionAbandoned"; id: string }>
  | Readonly<{ type: "hintRevealed"; id: string }>
  | Readonly<{ type: "worldReplaced"; world: World; reason: "import" | "reset" }>
  | Readonly<{ type: "importFailed"; message: string }>
  | Readonly<{ type: "importErrorCleared" }>
  | Readonly<{ type: "saved"; bytes: number }>
  | Readonly<{ type: "saveFailed"; reason: string }>
  | Readonly<{ type: "celebrationDismissed" }>;

/** 起動時の状態。 */
export type SimulatorStart = Readonly<{
  world: World;
  /** 起動時に端末へ出す注意（保存が読めなかった等）。無ければ `none` */
  warning: Option<string>;
}>;

const append = (
  state: SimulatorState,
  lines: readonly Omit<TranscriptLine, "id">[],
): SimulatorState => {
  const appended = [
    ...state.transcript,
    ...lines.map((line, i) => ({ ...line, id: state.nextLineId + i })),
  ];
  return {
    ...state,
    transcript: appended.slice(-TranscriptLimit),
    nextLineId: state.nextLineId + lines.length,
  };
};

/** UI 由来の 1 行（ミッション開始・取り込み・保存失敗の知らせ）。 */
const uiLine = (text: string, tone: TranscriptLine["tone"]): Omit<TranscriptLine, "id"> => ({
  kind: "output",
  origin: "ui",
  text,
  tone,
});

const uiWarning = (text: string): Omit<TranscriptLine, "id"> => uiLine(text, "warning");

/** 起動時の状態を作る。保存があればそれ、無ければ初期 World。 */
export const initialSimulatorState = (start: SimulatorStart): SimulatorState => {
  const state: SimulatorState = {
    world: start.world,
    shell: Shell.Ready,
    transcript: [],
    nextLineId: 1,
    selection: Option.none,
    panelTab: PanelTabs.Properties,
    settingsOpen: false,
    pendingInsert: Option.none,
    selectedMissionId: Option.none,
    importError: Option.none,
    screenClearCount: 0,
    celebration: Option.none,
    saveState: { kind: "saved", bytes: 0 },
    view: Views.Cli,
    consoleScreen: ConsoleScreens.VmList,
    consoleOutcome: Option.none,
  };
  return Option.isSome(start.warning) ? append(state, [uiWarning(start.warning.value)]) : state;
};

/**
 * 1 行を shell に通し、入力と出力を transcript に足す。`cli` 以外の由来は出力をグレー（muted）に
 * する。先頭に `note` があれば `# Console: ...` のコメント行を置く。
 */
const executed = (
  state: SimulatorState,
  seed: Readonly<{
    line: string;
    now: string;
    origin: TranscriptLine["origin"];
    note: Option<string>;
  }>,
): Readonly<{ state: SimulatorState; outcome: ExecutionOutcome }> => {
  const result = Engine.execute({
    world: state.world,
    shell: state.shell,
    line: seed.line,
    now: seed.now,
  });
  const outputTone = (tone: OutputLine["tone"]): OutputLine["tone"] =>
    seed.origin === "cli" ? tone : "muted";
  const note: readonly Omit<TranscriptLine, "id">[] = Option.isSome(seed.note)
    ? [{ kind: "note", origin: seed.origin, text: `# Console: ${seed.note.value}`, tone: "muted" }]
    : [];
  const lines: readonly Omit<TranscriptLine, "id">[] = [
    ...note,
    { kind: "input", origin: seed.origin, text: seed.line, tone: "plain" },
    ...result.lines.map(
      (l): Omit<TranscriptLine, "id"> => ({
        kind: "output",
        origin: seed.origin,
        text: l.text,
        tone: outputTone(l.tone),
      }),
    ),
  ];
  const celebration = Option.fromNullable(result.completed.at(-1));
  return {
    state: {
      ...append(state, lines),
      world: result.world,
      shell: result.shell,
      screenClearCount: result.clearsScreen ? state.screenClearCount + 1 : state.screenClearCount,
      celebration: Option.isSome(celebration) ? celebration : state.celebration,
    },
    outcome: result.outcome,
  };
};

const submitted = (
  state: SimulatorState,
  action: Extract<SimulatorAction, { type: "submitted" }>,
): SimulatorState => executed(state, { ...action, note: Option.none }).state;

const consoleSubmitted = (
  state: SimulatorState,
  action: Extract<SimulatorAction, { type: "consoleSubmitted" }>,
): SimulatorState => {
  const { state: next, outcome } = executed(state, {
    line: action.line,
    now: action.now,
    origin: "console",
    note: Option.some(action.note),
  });
  const moves = outcome.kind === "succeeded" && Option.isSome(action.next);
  return {
    ...next,
    consoleOutcome: Option.some({ line: action.line, outcome }),
    consoleScreen: moves && Option.isSome(action.next) ? action.next.value : state.consoleScreen,
  };
};

const missionStarted = (state: SimulatorState, id: string): SimulatorState => {
  const started = Engine.startMission(state.world, id);
  if (Result.isOk(started)) {
    const mission = Engine.missions().find((m) => m.id === id);
    return {
      ...append(state, [
        uiLine(`gcloud-sim: ミッション開始「${mission?.title ?? id}」`, "success"),
      ]),
      world: started.value,
      selectedMissionId: Option.some(id),
    };
  }
  return append(state, [uiWarning("gcloud-sim: このミッションは現在利用できません。")]);
};

const saveFailed = (state: SimulatorState, reason: string): SimulatorState => {
  const alreadyWarned = state.saveState.kind === "failed" && state.saveState.reason === reason;
  const failed: SimulatorState = { ...state, saveState: { kind: "failed", reason } };
  return alreadyWarned
    ? failed
    : append(failed, [
        uiWarning(
          `gcloud-sim: warning: failed to persist state (${reason}). 設定からエクスポートして退避してください。`,
        ),
      ]);
};

export const simulatorReducer = (
  state: SimulatorState,
  action: SimulatorAction,
): SimulatorState => {
  switch (action.type) {
    case "submitted":
      return submitted(state, action);
    case "consoleSubmitted":
      return consoleSubmitted(state, action);
    case "viewChanged":
      return { ...state, view: action.view, consoleOutcome: Option.none };
    case "consoleScreenChanged":
      return { ...state, consoleScreen: action.screen, consoleOutcome: Option.none };
    case "consoleOutcomeCleared":
      return { ...state, consoleOutcome: Option.none };
    case "selected":
      return { ...state, selection: Option.some(action.selection), panelTab: PanelTabs.Properties };
    case "insertRequested":
      return { ...state, pendingInsert: Option.some(action.text) };
    case "insertConsumed":
      return { ...state, pendingInsert: Option.none };
    case "tabChanged":
      return { ...state, panelTab: action.tab };
    case "settingsToggled":
      return {
        ...state,
        settingsOpen: action.open,
        importError: action.open ? state.importError : Option.none,
      };
    case "missionSelected":
      return { ...state, selectedMissionId: Option.some(action.id), panelTab: PanelTabs.Missions };
    case "missionStarted":
      return missionStarted(state, action.id);
    case "missionAbandoned":
      return { ...state, world: Engine.abandonMission(state.world, action.id) };
    case "hintRevealed":
      return { ...state, world: Engine.revealHint(state.world, action.id) };
    case "worldReplaced": {
      const text =
        action.reason === "import"
          ? "gcloud-sim: Snapshot を取り込みました。"
          : "gcloud-sim: 初期状態に戻しました。";
      return {
        ...append(state, [uiLine(text, "success")]),
        world: action.world,
        shell: Shell.Ready,
        selection: Option.none,
        importError: Option.none,
        settingsOpen: false,
        consoleOutcome: Option.none,
      };
    }
    case "importFailed":
      return { ...state, importError: Option.some(action.message) };
    case "importErrorCleared":
      return { ...state, importError: Option.none };
    case "saved":
      return { ...state, saveState: { kind: "saved", bytes: action.bytes } };
    case "saveFailed":
      return saveFailed(state, action.reason);
    case "celebrationDismissed":
      return { ...state, celebration: Option.none };
  }
};

/**
 * シミュレータの状態と操作。I/O（保存・ファイル・時計）は持たず、呼び出し側が渡す。
 *
 * @param start 起動時の World と注意
 * @returns 状態と dispatch
 */
export const useSimulator = (start: SimulatorStart) =>
  useReducer(simulatorReducer, start, initialSimulatorState);
