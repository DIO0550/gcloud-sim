"use client";

import { type ReactElement, useCallback, useEffect } from "react";
import { Tab } from "@/components/Tab";
import { TextButton } from "@/components/TextButton";
import { Engine } from "@/engine";
import { World as WorldOps } from "@/engine/domains/world";
import { Mission } from "@/engine/missions";
import { ChangeLog } from "@/features/simulator/components/ChangeLog";
import { Header } from "@/features/simulator/components/Header";
import { MissionPanel } from "@/features/simulator/components/MissionPanel";
import { PropertiesPanel } from "@/features/simulator/components/PropertiesPanel";
import { ResourceTree } from "@/features/simulator/components/ResourceTree";
import { SettingsDialog } from "@/features/simulator/components/SettingsDialog";
import { Terminal } from "@/features/simulator/components/Terminal";
import { type ConsoleHandlers, ConsoleView } from "@/features/simulator/features/console";
import {
  type PanelTab,
  PanelTabs,
  type SimulatorStart,
  useSimulator,
  Views,
} from "@/features/simulator/hooks/use-simulator";
import { describeImportFailure } from "@/features/simulator/utils/import-failure-message";
import type { Clipboard } from "@/libs/clipboard";
import type { SnapshotFile } from "@/libs/snapshot-file";
import type { TerminalViewFactory } from "@/libs/terminal-view";
import type { WorldStorage } from "@/libs/world-storage";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

/** 保存・ファイル・時計の境界。本物は `libs/` の関数そのもので、テストではフェイクを注入する。 */
export type SimulatorIo = Readonly<{
  now: () => string;
  save: typeof WorldStorage.save;
  download: typeof SnapshotFile.download;
  readFile: typeof SnapshotFile.read;
  confirm: (message: string) => boolean;
  /** クリップボードへ書く（Console の「同等のコマンドライン」のコピー）。失敗はその理由 */
  copy: typeof Clipboard.copy;
  createTerminalView: TerminalViewFactory;
  capacityBytes: number;
}>;

type SimulatorProps = Readonly<{
  start: SimulatorStart;
  io: SimulatorIo;
}>;

const Tabs: readonly Readonly<{ tab: PanelTab; label: (missions: string) => string }>[] = [
  { tab: PanelTabs.Properties, label: () => "プロパティ" },
  { tab: PanelTabs.Missions, label: (missions) => `ミッション ${missions}` },
  { tab: PanelTabs.Log, label: () => "変更ログ" },
];

/** CLI 画面全体（モック 2a）: ヘッダー / リソース階層 / ターミナル / 右ペイン / 設定。 */
export const Simulator = ({ start, io }: SimulatorProps): ReactElement => {
  const [state, dispatch] = useSimulator(start);
  const { world, saveState } = state;

  // World が変わるたびに保存する（localStorage との同期。UC-005 自動保存）。
  useEffect(() => {
    const saved = io.save(world, io.now());
    if (Result.isOk(saved)) {
      dispatch({ type: "saved", bytes: saved.value });
    } else {
      dispatch({ type: "saveFailed", reason: saved.error.reason });
    }
  }, [world, io, dispatch]);

  const submit = useCallback(
    (line: string) => dispatch({ type: "submitted", line, now: io.now(), origin: "cli" }),
    [io, dispatch],
  );
  const submitFromUi = (line: string): void =>
    dispatch({ type: "submitted", line, now: io.now(), origin: "ui" });
  const completionCandidates = useCallback(
    (line: string) => Engine.completionCandidates(world, line),
    [world],
  );
  const insertConsumed = useCallback(() => dispatch({ type: "insertConsumed" }), [dispatch]);

  const importFile = async (file: File): Promise<void> => {
    const read = await io.readFile(file);
    if (!Result.isOk(read)) {
      dispatch({ type: "importFailed", message: describeImportFailure(read.error) });
      return;
    }
    if (!io.confirm("現在の状態を上書きします。よろしいですか？")) return;
    dispatch({ type: "worldReplaced", world: read.value, reason: "import" });
  };

  const reset = (): void => {
    if (
      !io.confirm(
        "初期状態に戻します。現在のリソースとミッション進捗は失われます。よろしいですか？",
      )
    )
      return;
    dispatch({ type: "worldReplaced", world: Engine.initialWorld(io.now()), reason: "reset" });
  };

  const counts = Mission.counts(world);
  const isConsole = state.view === Views.Console;
  const copy = async (text: string): Promise<void> => {
    const copied = await io.copy(text);
    if (!Result.isOk(copied)) dispatch({ type: "copyFailed", reason: copied.error });
  };
  const consoleHandlers: ConsoleHandlers = {
    submit: ({ line, note, next }) =>
      dispatch({ type: "consoleSubmitted", line, now: io.now(), note, next }),
    insert: (line) => dispatch({ type: "insertRequested", text: line }),
    copy: (text) => void copy(text),
    confirm: io.confirm,
    changeScreen: (screen) => dispatch({ type: "consoleScreenChanged", screen }),
  };
  // Console でも端末は同じ位置に置いたまま（下のドロワーになる）。別の位置に描くと端末が作り直され、
  // 打った行の映りが消える。
  return (
    <div className="flex h-dvh flex-col bg-canvas text-ink">
      <Header
        world={world}
        view={state.view}
        onViewChange={(view) => dispatch({ type: "viewChanged", view })}
        onProjectChange={(projectId) => submitFromUi(`gcloud config set project ${projectId}`)}
        onPrincipalChange={(principal) => submitFromUi(`gcloud config set account ${principal}`)}
        onOpenSettings={() => dispatch({ type: "settingsToggled", open: true })}
        isTerminalOpen={state.consoleTerminalOpen}
        onTerminalToggle={() =>
          dispatch({ type: "consoleTerminalToggled", open: !state.consoleTerminalOpen })
        }
      />
      <div
        className={`grid min-h-0 flex-1 ${isConsole ? "grid-cols-[minmax(0,1fr)]" : "grid-cols-[17.5rem_minmax(0,1fr)_26rem]"}`}
      >
        {!isConsole && (
          <ResourceTree
            world={world}
            selection={state.selection}
            currentProjectId={WorldOps.currentProjectId(world)}
            onSelect={(selection) => dispatch({ type: "selected", selection })}
            onInsertDescribe={(command) => dispatch({ type: "insertRequested", text: command })}
          />
        )}
        <div className="flex min-h-0 flex-col">
          {isConsole && (
            <ConsoleView
              world={world}
              screen={state.consoleScreen}
              outcome={Option.map(state.consoleOutcome, (o) => o.outcome)}
              handlers={consoleHandlers}
              onOutcomeDismiss={() => dispatch({ type: "consoleOutcomeCleared" })}
            />
          )}
          {/* Console では端末を閉じても描いたまま隠す（作り直すと打った行の映りが消える）。 */}
          <div
            className={
              isConsole
                ? `${state.consoleTerminalOpen ? "flex" : "hidden"} h-72 shrink-0 flex-col border-line border-t`
                : "contents"
            }
          >
            <Terminal
              transcript={state.transcript}
              screenClearCount={state.screenClearCount}
              pendingInsert={state.pendingInsert}
              onInsertConsumed={insertConsumed}
              onSubmit={submit}
              completionCandidates={completionCandidates}
              createView={io.createTerminalView}
              caption={`configuration: ${world.config.activeConfiguration}`}
              status={
                <span className={saveState.kind === "saved" ? "text-ok" : "text-danger"}>
                  {saveState.kind === "saved"
                    ? "● 自動保存済み"
                    : `● 保存に失敗: ${saveState.reason}`}
                </span>
              }
            />
          </div>
        </div>
        {!isConsole && (
          <aside
            className="flex min-h-0 flex-col border-line border-l bg-surface"
            aria-label="詳細"
          >
            <div className="flex border-line border-b" role="tablist">
              {Tabs.map(({ tab, label }) => (
                <Tab
                  key={tab}
                  selected={state.panelTab === tab}
                  className="px-4 py-3.5"
                  onClick={() => dispatch({ type: "tabChanged", tab })}
                >
                  {label(`${counts.completed}/${counts.total}`)}
                </Tab>
              ))}
            </div>
            {Option.isSome(state.celebration) && (
              <div
                className="flex items-center justify-between bg-ok-soft px-4 py-2 text-ok-ink text-sm"
                role="status"
              >
                <span>✓ ミッションクリア「{state.celebration.value.title}」</span>
                <TextButton
                  tone="inherit"
                  className="text-xs underline"
                  onClick={() => dispatch({ type: "celebrationDismissed" })}
                >
                  閉じる
                </TextButton>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-auto">
              {state.panelTab === PanelTabs.Properties && (
                <PropertiesPanel
                  world={world}
                  selection={state.selection}
                  onInsert={(command) => dispatch({ type: "insertRequested", text: command })}
                  onOpenConsole={(screen) => {
                    dispatch({ type: "viewChanged", view: Views.Console });
                    dispatch({ type: "consoleScreenChanged", screen });
                  }}
                />
              )}
              {state.panelTab === PanelTabs.Missions && (
                <MissionPanel
                  world={world}
                  missions={Engine.missions()}
                  selectedId={state.selectedMissionId}
                  onSelect={(id) => dispatch({ type: "missionSelected", id })}
                  onStart={(id) => dispatch({ type: "missionStarted", id })}
                  onAbandon={(id) => dispatch({ type: "missionAbandoned", id })}
                  onHint={(id) => dispatch({ type: "hintRevealed", id })}
                />
              )}
              {state.panelTab === PanelTabs.Log && (
                <ChangeLog world={world} transcript={state.transcript} />
              )}
            </div>
          </aside>
        )}
      </div>
      {state.settingsOpen && (
        <SettingsDialog
          world={world}
          saveState={saveState}
          capacityBytes={io.capacityBytes}
          now={io.now()}
          importError={state.importError}
          onClose={() => dispatch({ type: "settingsToggled", open: false })}
          onExport={() => io.download(world, io.now())}
          onImport={importFile}
          onReset={reset}
        />
      )}
    </div>
  );
};
