import { useReducer } from "react";

import { Engine, type OutputLine, Shell, type ShellState } from "@/engine";
import type { World } from "@/engine/domains/world";
import type { Mission, MissionSetupFailure } from "@/engine/missions";
import type { Selection } from "@/engine/resource-tree";
import type { ValueOf } from "@/types/ValueOf";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

/** ターミナルに流れた 1 行。`ui` 由来はグレーで出す（UC-008 の「グレー表示で記録」を CLI 画面でも使う）。 */
export type TranscriptEntry = Readonly<{
  id: number;
  kind: "input" | "output";
  origin: "cli" | "ui";
  text: string;
  tone: OutputLine["tone"];
}>;

export const PanelTabs = {
  Properties: "properties",
  Missions: "missions",
  Log: "log",
} as const;
export type PanelTab = ValueOf<typeof PanelTabs>;

export type SimulatorState = Readonly<{
  world: World;
  shell: ShellState;
  transcript: readonly TranscriptEntry[];
  nextEntryId: number;
  selection: Option<Selection>;
  panelTab: PanelTab;
  settingsOpen: boolean;
  /** ツリーのダブルクリックで入力行に入れる文字列。`seq` で同じ文字列の再挿入を区別する */
  pendingInsert: Option<Readonly<{ seq: number; text: string }>>;
  selectedMissionId: Option<string>;
  importError: Option<string>;
  /** `clear` のたびに増える。ターミナルは値が変わったら画面を消す */
  clearEpoch: number;
  /** 直近でクリアしたミッション。パネルの通知に使う */
  celebration: Option<Mission>;
}>;

export type SimulatorAction =
  | Readonly<{ type: "submitted"; line: string; now: string; origin: TranscriptEntry["origin"] }>
  | Readonly<{ type: "selected"; selection: Selection }>
  | Readonly<{ type: "insertRequested"; text: string }>
  | Readonly<{ type: "tabChanged"; tab: PanelTab }>
  | Readonly<{ type: "settingsToggled"; open: boolean }>
  | Readonly<{ type: "missionSelected"; id: string }>
  | Readonly<{ type: "missionStarted"; id: string }>
  | Readonly<{ type: "missionAbandoned"; id: string }>
  | Readonly<{ type: "hintRevealed"; id: string }>
  | Readonly<{ type: "worldReplaced"; world: World; reason: "import" | "reset" }>
  | Readonly<{ type: "importFailed"; message: string }>
  | Readonly<{ type: "importErrorCleared" }>
  | Readonly<{ type: "persistFailed"; reason: string }>
  | Readonly<{ type: "celebrationDismissed" }>;

/** 起動時の状態を作る。保存があればそれ、無ければ初期 World。 */
export const initialSimulatorState = (world: World): SimulatorState => ({
  world,
  shell: Shell.Ready,
  transcript: [],
  nextEntryId: 1,
  selection: Option.none,
  panelTab: PanelTabs.Properties,
  settingsOpen: false,
  pendingInsert: Option.none,
  selectedMissionId: Option.none,
  importError: Option.none,
  clearEpoch: 0,
  celebration: Option.none,
});

const append = (
  state: SimulatorState,
  entries: readonly Omit<TranscriptEntry, "id">[],
): SimulatorState => ({
  ...state,
  transcript: [
    ...state.transcript,
    ...entries.map((e, i) => ({ ...e, id: state.nextEntryId + i })),
  ],
  nextEntryId: state.nextEntryId + entries.length,
});

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
  const entries: readonly Omit<TranscriptEntry, "id">[] = [
    { kind: "input", origin: action.origin, text: action.line, tone: "plain" },
    ...result.lines.map(
      (l): Omit<TranscriptEntry, "id"> => ({
        kind: "output",
        origin: action.origin,
        text: l.text,
        tone: outputTone(l.tone),
      }),
    ),
  ];
  const celebration = Option.fromNullable(result.completed.at(-1));
  return {
    ...append(state, entries),
    world: result.world,
    shell: result.shell,
    clearEpoch: result.clearsScreen ? state.clearEpoch + 1 : state.clearEpoch,
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
  return append(state, [
    {
      kind: "output",
      origin: "ui",
      text: "gcloud-sim: このミッションは現在利用できません。",
      tone: "warning",
    },
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
    case "insertRequested": {
      const seq = Option.isSome(state.pendingInsert) ? state.pendingInsert.value.seq + 1 : 1;
      return { ...state, pendingInsert: Option.some({ seq, text: action.text }) };
    }
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
    case "persistFailed":
      return append(state, [
        {
          kind: "output",
          origin: "ui",
          text: `gcloud-sim: warning: failed to persist state (${action.reason}). 設定からエクスポートして退避してください。`,
          tone: "warning",
        },
      ]);
    case "celebrationDismissed":
      return { ...state, celebration: Option.none };
  }
};

/** ミッション setup の失敗（E-015）を開発者向けに読める形にする。 */
export const describeSetupFailure = (failure: MissionSetupFailure): string =>
  `mission ${failure.missionId} setup violated an invariant: ${failure.reason}`;

/**
 * シミュレータの状態と操作。I/O（保存・ファイル・時計）は持たず、呼び出し側が渡す。
 *
 * @param world 起動時の World
 * @returns 状態と dispatch
 */
export const useSimulator = (world: World) =>
  useReducer(simulatorReducer, world, initialSimulatorState);
