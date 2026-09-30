import { useReducer } from "react";

import { Engine, type OutputLine, Shell, type ShellState } from "@/engine";
import type { World } from "@/engine/domains/world";
import type { Mission } from "@/engine/missions";
import type { Selection } from "@/engine/resource-tree";
import type { ValueOf } from "@/types/ValueOf";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

/** ターミナルに流れた 1 行。`ui` 由来はグレーで出す（UC-008 の「グレー表示で記録」を CLI 画面でも使う）。 */
export type TranscriptLine = Readonly<{
  id: number;
  kind: "input" | "output";
  origin: "cli" | "ui";
  text: string;
  tone: OutputLine["tone"];
}>;

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
  selection: Option<Selection>;
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
}>;

export type SimulatorAction =
  | Readonly<{ type: "submitted"; line: string; now: string; origin: TranscriptLine["origin"] }>
  | Readonly<{ type: "selected"; selection: Selection }>
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

const uiWarning = (text: string): Omit<TranscriptLine, "id"> => ({
  kind: "output",
  origin: "ui",
  text,
  tone: "warning",
});

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
  };
  return Option.isSome(start.warning) ? append(state, [uiWarning(start.warning.value)]) : state;
};

const submitted = (
  state: SimulatorState,
  action: Extract<SimulatorAction, { type: "submitted" }>,
): SimulatorState => {
  const result = Engine.execute({
    world: state.world,
    shell: state.shell,
    line: action.line,
    now: action.now,
  });
  const outputTone = (tone: OutputLine["tone"]): OutputLine["tone"] =>
    action.origin === "ui" ? "muted" : tone;
  const lines: readonly Omit<TranscriptLine, "id">[] = [
    { kind: "input", origin: action.origin, text: action.line, tone: "plain" },
    ...result.lines.map(
      (l): Omit<TranscriptLine, "id"> => ({
        kind: "output",
        origin: action.origin,
        text: l.text,
        tone: outputTone(l.tone),
      }),
    ),
  ];
  const celebration = Option.fromNullable(result.completed.at(-1));
  return {
    ...append(state, lines),
    world: result.world,
    shell: result.shell,
    screenClearCount: result.clearsScreen ? state.screenClearCount + 1 : state.screenClearCount,
    celebration: Option.isSome(celebration) ? celebration : state.celebration,
  };
};

const missionStarted = (state: SimulatorState, id: string): SimulatorState => {
  const started = Engine.startMission(state.world, id);
  if (Result.isOk(started)) {
    const mission = Engine.missions().find((m) => m.id === id);
    return {
      ...append(state, [
        {
          kind: "output",
          origin: "ui",
          text: `gcloud-sim: ミッション開始「${mission?.title ?? id}」`,
          tone: "success",
        },
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
        ...append(state, [{ kind: "output", origin: "ui", text, tone: "success" }]),
        world: action.world,
        shell: Shell.Ready,
        selection: Option.none,
        importError: Option.none,
        settingsOpen: false,
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
