"use client";

import { type ReactElement, useCallback, useEffect, useState } from "react";

import { Engine } from "@/engine";
import type { World } from "@/engine/domains/world";
import { World as WorldOps } from "@/engine/domains/world";
import { Mission } from "@/engine/missions";
import { type ImportFailure, Snapshot } from "@/engine/snapshot";
import { ChangeLog } from "@/features/simulator/components/ChangeLog";
import { Header } from "@/features/simulator/components/Header";
import { MissionPanel } from "@/features/simulator/components/MissionPanel";
import { PropertiesPanel } from "@/features/simulator/components/PropertiesPanel";
import { ResourceTree } from "@/features/simulator/components/ResourceTree";
import { type SaveState, SettingsDialog } from "@/features/simulator/components/SettingsDialog";
import { Terminal } from "@/features/simulator/components/Terminal";
import { type PanelTab, PanelTabs, useSimulator } from "@/features/simulator/hooks/use-simulator";
import type { TerminalViewFactory } from "@/libs/terminal-view";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

/** 保存・ファイル・時計の境界。テストではフェイクを注入する。 */
export type SimulatorIo = Readonly<{
  now: () => string;
  save: (world: World, now: string) => Result<number, Readonly<{ reason: string }>>;
  download: (world: World, now: string) => void;
  readFile: (file: File) => Promise<Result<World, ImportFailure>>;
  confirm: (message: string) => boolean;
  createTerminalView: TerminalViewFactory;
  capacityBytes: number;
}>;

type SimulatorProps = Readonly<{
  initialWorld: World;
  io: SimulatorIo;
}>;

const Tabs: readonly Readonly<{ tab: PanelTab; label: (missions: string) => string }>[] = [
  { tab: PanelTabs.Properties, label: () => "プロパティ" },
  { tab: PanelTabs.Missions, label: (missions) => `ミッション ${missions}` },
  { tab: PanelTabs.Log, label: () => "変更ログ" },
];

/** CLI 画面全体（モック 2a）: ヘッダー / リソース階層 / ターミナル / 右ペイン / 設定。 */
export const Simulator = ({ initialWorld, io }: SimulatorProps): ReactElement => {
  const [state, dispatch] = useSimulator(initialWorld);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "saved", bytes: 0 });
  const { world } = state;

  // World が変わるたびに保存する（localStorage との同期。UC-005 自動保存）。
  useEffect(() => {
    const saved = io.save(world, io.now());
    if (Result.isOk(saved)) {
      setSaveState({ kind: "saved", bytes: saved.value });
    } else {
      setSaveState((previous) => {
        const alreadyWarned = previous.kind === "failed" && previous.reason === saved.error.reason;
        if (!alreadyWarned) dispatch({ type: "persistFailed", reason: saved.error.reason });
        return { kind: "failed", reason: saved.error.reason };
      });
    }
  }, [world, io, dispatch]);

  const submit = useCallback(
    (line: string) => dispatch({ type: "submitted", line, now: io.now(), origin: "cli" }),
    [io, dispatch],
  );
  const submitFromUi = (line: string): void =>
    dispatch({ type: "submitted", line, now: io.now(), origin: "ui" });
  const complete = useCallback((line: string) => Engine.complete(line), []);

  const importFile = async (file: File): Promise<void> => {
    const read = await io.readFile(file);
    if (!Result.isOk(read)) {
      dispatch({ type: "importFailed", message: Snapshot.describeFailure(read.error) });
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
  return (
    <div className="flex h-dvh flex-col bg-canvas text-ink">
      <Header
        world={world}
        onProjectChange={(projectId) => submitFromUi(`gcloud config set project ${projectId}`)}
        onPrincipalChange={(principal) => submitFromUi(`gcloud config set account ${principal}`)}
        onOpenSettings={() => dispatch({ type: "settingsToggled", open: true })}
      />
      <div className="grid min-h-0 flex-1 grid-cols-[19rem_minmax(0,1fr)_29rem]">
        <ResourceTree
          world={world}
          selection={state.selection}
          currentProjectId={WorldOps.currentProjectId(world)}
          onSelect={(selection) => dispatch({ type: "selected", selection })}
          onInsertDescribe={(command) => dispatch({ type: "insertRequested", text: command })}
        />
        <Terminal
          transcript={state.transcript}
          clearEpoch={state.clearEpoch}
          pendingInsert={state.pendingInsert}
          onSubmit={submit}
          complete={complete}
          createView={io.createTerminalView}
          caption={`configuration: ${world.config.activeConfiguration}`}
        />
        <aside className="flex min-h-0 flex-col border-line border-l bg-surface" aria-label="詳細">
          <div className="flex border-line border-b" role="tablist">
            {Tabs.map(({ tab, label }) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={state.panelTab === tab}
                className={`px-4 py-3 text-sm ${state.panelTab === tab ? "border-accent border-b-2 font-semibold" : "text-muted"}`}
                onClick={() => dispatch({ type: "tabChanged", tab })}
              >
                {label(`${counts.completed}/${counts.total}`)}
              </button>
            ))}
          </div>
          {Option.isSome(state.celebration) && (
            <div
              className="flex items-center justify-between bg-ok-soft px-4 py-2 text-ok-ink text-sm"
              role="status"
            >
              <span>✓ ミッションクリア「{state.celebration.value.title}」</span>
              <button
                type="button"
                className="text-xs underline"
                onClick={() => dispatch({ type: "celebrationDismissed" })}
              >
                閉じる
              </button>
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-auto">
            {state.panelTab === PanelTabs.Properties && (
              <PropertiesPanel
                world={world}
                selection={state.selection}
                onInsert={(command) => dispatch({ type: "insertRequested", text: command })}
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
          <p
            className={`border-line border-t px-4 py-1.5 text-xs ${saveState.kind === "saved" ? "text-muted" : "text-danger"}`}
          >
            {saveState.kind === "saved" ? "● 自動保存済み" : `● 保存に失敗: ${saveState.reason}`}
          </p>
        </aside>
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
