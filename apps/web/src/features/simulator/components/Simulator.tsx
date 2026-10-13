"use client";

import { type CSSProperties, type ReactElement, useCallback, useEffect, useState } from "react";
import { Tab } from "@/components/Tab";
import { TextButton } from "@/components/TextButton";
import { Engine } from "@/engine";
import { KubeContext } from "@/engine/domains/kube-context";
import { World as WorldOps } from "@/engine/domains/world";
import { Mission } from "@/engine/missions";
import { ChangeLog } from "@/features/simulator/components/ChangeLog";
import { FileWorkspace } from "@/features/simulator/components/FileWorkspace";
import { Header } from "@/features/simulator/components/Header";
import { HierarchyCreateDialog } from "@/features/simulator/components/HierarchyCreateDialog";
import { MissionPanel } from "@/features/simulator/components/MissionPanel";
import { PanelResizeHandle } from "@/features/simulator/components/PanelResizeHandle";
import { PropertiesPanel } from "@/features/simulator/components/PropertiesPanel";
import { ResourceTree } from "@/features/simulator/components/ResourceTree";
import { SettingsDialog } from "@/features/simulator/components/SettingsDialog";
import { Terminal } from "@/features/simulator/components/Terminal";
import { HierarchyCreate } from "@/features/simulator/domains/hierarchy-create";
import { type ConsoleHandlers, ConsoleView } from "@/features/simulator/features/console";
import { ConsoleScreens } from "@/features/simulator/features/console/domains/console-screen";
import { usePanelWidths } from "@/features/simulator/hooks/use-panel-widths";
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

const Tabs: readonly Readonly<{ tab: PanelTab; label: string }>[] = [
  { tab: PanelTabs.Properties, label: "プロパティ" },
  { tab: PanelTabs.Missions, label: "ミッション" },
  { tab: PanelTabs.Log, label: "変更ログ" },
  { tab: PanelTabs.Files, label: "ファイル" },
];

/** CLI 画面全体（モック 2a）: ヘッダー / リソース階層 / ターミナル / 右ペイン / 設定。 */
export const Simulator = ({ start, io }: SimulatorProps): ReactElement => {
  const [state, dispatch] = useSimulator(start);
  const [navigationOpen, setNavigationOpen] = useState(true);
  const [terminalMaximized, setTerminalMaximized] = useState(false);
  const panels = usePanelWidths();
  const { world, saveState } = state;
  const namespace = Option.flatMap(WorldOps.currentProjectId(world), (projectId) =>
    Option.flatMap(KubeContext.current(world, projectId), (cluster) =>
      Option.fromNullable(KubeContext.configuredNamespace(world, cluster)),
    ),
  );
  const terminalCaption = `configuration: ${world.config.activeConfiguration}${Option.isSome(namespace) ? ` · namespace: ${namespace.value}` : ""}`;

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
  const isCreate = state.consoleScreen === ConsoleScreens.VmCreate;
  const consoleLayout = {
    "--console-nav-width": navigationOpen && !isCreate ? `${panels.console.width}px` : "0px",
    "--console-terminal-height": terminalMaximized ? "70dvh" : "18rem",
  } as CSSProperties;
  const panelLayout = {
    ...consoleLayout,
    "--cli-left-width": `${panels.left.width}px`,
    "--cli-right-width": `${panels.right.width}px`,
  } as CSSProperties;
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
        onCreateResource={() => dispatch({ type: "hierarchyToggled", open: true })}
        isTerminalOpen={state.consoleTerminalOpen}
        onTerminalToggle={() =>
          dispatch({ type: "consoleTerminalToggled", open: !state.consoleTerminalOpen })
        }
        isNavigationOpen={navigationOpen}
        onNavigationToggle={() => setNavigationOpen((open) => !open)}
        onNavigate={consoleHandlers.changeScreen}
      />
      {Option.isSome(state.hierarchyNotice) && (
        <div
          role="status"
          className="flex shrink-0 items-center justify-between gap-3 border-line border-b bg-ok-soft px-4 py-2 text-ok-ink text-sm"
        >
          <span>{state.hierarchyNotice.value}</span>
          <div className="flex shrink-0 gap-4">
            {isConsole && (
              <TextButton
                tone="inherit"
                onClick={() => dispatch({ type: "viewChanged", view: Views.Cli })}
              >
                階層で確認
              </TextButton>
            )}
            <TextButton
              tone="inherit"
              ariaLabel="作成通知を閉じる"
              onClick={() => dispatch({ type: "hierarchyNoticeCleared" })}
            >
              閉じる
            </TextButton>
          </div>
        </div>
      )}
      <div
        ref={panels.containerRef}
        data-testid="simulator-layout"
        style={panelLayout}
        className={`relative grid min-h-0 flex-1 ${isConsole ? "grid-cols-[minmax(0,1fr)]" : "grid-cols-1 content-start overflow-y-auto lg:grid-cols-[var(--cli-left-width)_minmax(0,1fr)_var(--cli-right-width)] lg:content-normal lg:overflow-hidden"}`}
      >
        {!isConsole && (
          <ResourceTree
            world={world}
            selection={state.selection}
            currentProjectId={WorldOps.currentProjectId(world)}
            onSelect={(selection) => dispatch({ type: "selected", selection })}
            onInsertDescribe={(command) => dispatch({ type: "insertRequested", text: command })}
            onCreate={() => dispatch({ type: "hierarchyToggled", open: true })}
          />
        )}
        <div
          className={`relative flex min-w-0 flex-col ${isConsole ? "min-h-0" : "order-2 h-96 lg:order-none lg:h-auto lg:min-h-0"}`}
          style={consoleLayout}
        >
          {isConsole && (
            <ConsoleView
              world={world}
              screen={state.consoleScreen}
              outcome={Option.map(state.consoleOutcome, (o) => o.outcome)}
              handlers={consoleHandlers}
              navigationOpen={navigationOpen}
              terminalOpen={state.consoleTerminalOpen}
              onOutcomeDismiss={() => dispatch({ type: "consoleOutcomeCleared" })}
            />
          )}
          {/* Console では端末を閉じても描いたまま隠す（作り直すと打った行の映りが消える）。 */}
          <div
            className={
              isConsole
                ? `${state.consoleTerminalOpen ? "flex" : "hidden"} absolute right-0 bottom-0 left-0 z-20 h-[var(--console-terminal-height)] flex-col border-line border-t md:left-[var(--console-nav-width)]`
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
              caption={terminalCaption}
              consoleMode={isConsole}
              projectId={Option.unwrapOr(WorldOps.currentProjectId(world), "未設定")}
              isMaximized={terminalMaximized}
              onMaximizeToggle={() => setTerminalMaximized((maximized) => !maximized)}
              onClose={() => dispatch({ type: "consoleTerminalToggled", open: false })}
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
            className="order-1 flex h-[60dvh] min-h-96 min-w-0 flex-col border-line border-l bg-surface lg:order-none lg:h-auto lg:min-h-0"
            aria-label="詳細"
          >
            <div
              className="@container/sidebar-tabs grid shrink-0 grid-cols-4 border-line border-b"
              role="tablist"
              aria-label="詳細パネル"
            >
              {Tabs.map(({ tab, label }) => (
                <Tab
                  key={tab}
                  selected={state.panelTab === tab}
                  className="min-w-0 px-1 py-3.5 text-xs @min-[360px]/sidebar-tabs:text-sm"
                  onClick={() => dispatch({ type: "tabChanged", tab })}
                >
                  {label}
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
                <>
                  <p className="border-line border-b px-3 py-2 text-right text-xs text-muted">
                    {counts.completed}/{counts.total} クリア
                  </p>
                  <MissionPanel
                    world={world}
                    missions={Engine.missions()}
                    selectedId={state.selectedMissionId}
                    onSelect={(id) => dispatch({ type: "missionSelected", id })}
                    onStart={(id) => dispatch({ type: "missionStarted", id })}
                    onAbandon={(id) => dispatch({ type: "missionAbandoned", id })}
                    onHint={(id) => dispatch({ type: "hintRevealed", id })}
                  />
                </>
              )}
              {state.panelTab === PanelTabs.Log && (
                <ChangeLog world={world} transcript={state.transcript} />
              )}
              {state.panelTab === PanelTabs.Files && (
                <FileWorkspace
                  world={world}
                  onEdit={(edit) => {
                    const result = Engine.editFiles(world, edit);
                    if (!result.ok) {
                      return Result.err(result.error);
                    }
                    dispatch({ type: "filesChanged", world: result.value });
                    return Result.ok(undefined);
                  }}
                />
              )}
            </div>
          </aside>
        )}
        {!isConsole && (
          <>
            <PanelResizeHandle
              label="左サイドバーの幅"
              {...panels.left}
              direction="right"
              className="hidden lg:block"
              style={{ left: "calc(var(--cli-left-width) - 4px)" }}
            />
            <PanelResizeHandle
              label="右サイドバーの幅"
              {...panels.right}
              direction="left"
              className="hidden lg:block"
              style={{ right: "calc(var(--cli-right-width) - 4px)" }}
            />
          </>
        )}
        {isConsole && navigationOpen && !isCreate && (
          <PanelResizeHandle
            label="コンソールの左サイドバーの幅"
            {...panels.console}
            direction="right"
            className="hidden md:block"
            style={{ left: "calc(var(--console-nav-width) - 4px)" }}
          />
        )}
      </div>
      {state.hierarchyOpen && (
        <HierarchyCreateDialog
          world={world}
          initialParent={HierarchyCreate.defaultParent(world, state.selection)}
          error={state.hierarchyError}
          onSubmit={(input) => dispatch({ type: "hierarchySubmitted", input, now: io.now() })}
          onClose={() => dispatch({ type: "hierarchyToggled", open: false })}
        />
      )}
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
