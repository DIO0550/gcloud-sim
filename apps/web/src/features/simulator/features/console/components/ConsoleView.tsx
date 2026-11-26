import { type ReactElement, useState } from "react";

import { ApiService } from "@/engine/domains/catalog";
import { World } from "@/engine/domains/world";
import { ConsoleNav } from "@/features/simulator/features/console/components/ConsoleNav";
import {
  EnableApiPrompt,
  FailureBanner,
} from "@/features/simulator/features/console/components/ConsoleParts";
import { ScreenRouter } from "@/features/simulator/features/console/components/ScreenRouter";
import {
  ConsoleScreen,
  type ConsoleSection,
  type ConsoleScreen as Screen,
} from "@/features/simulator/features/console/domains/console-screen";
import { enableApiCommand } from "@/features/simulator/features/console/domains/equivalent-command";
import type {
  ConsoleHandlers,
  ConsoleOutcome,
} from "@/features/simulator/features/console/types/screen-props";
import { Option } from "@/utils/Option";

type ConsoleViewProps = Readonly<{
  world: World;
  screen: Screen;
  /** 直近にこの Console から流したコマンドの結果。失敗なら画面の上に赤帯で出す */
  outcome: Option<ConsoleOutcome>;
  handlers: ConsoleHandlers;
  onOutcomeDismiss: () => void;
  navigationOpen: boolean;
  onCloseNavigation?: () => void;
  terminalOpen: boolean;
}>;

/**
 * Console ビュー（UC-008 / DJ-011）。左ナビと画面。操作はすべて `handlers.submit` で CLI と同じ経路を通る。
 * プロジェクトが未設定なら画面を出さず、API が無効なら「API を有効にする」だけを出す（本物と同じ導線）。
 */
export const ConsoleView = ({
  world,
  screen,
  outcome,
  handlers,
  onOutcomeDismiss,
  navigationOpen,
  onCloseNavigation,
  terminalOpen,
}: ConsoleViewProps): ReactElement => {
  const [pinnedSections, setPinnedSections] = useState<readonly ConsoleSection[]>([]);
  const togglePin = (section: ConsoleSection): void => {
    setPinnedSections((prev) =>
      prev.includes(section) ? prev.filter((item) => item !== section) : [...prev, section],
    );
  };
  const project = Option.flatMap(World.currentProjectId(world), (id) =>
    World.findActiveProject(world, id),
  );
  const api = ConsoleScreen.requiredApi(screen);
  const apiTitle = Option.map(api, (a) => ApiService.find(a).title);
  const enableApi = (projectId: string, overrideApiName?: string, overrideTitle?: string): void => {
    const parsedOverride =
      overrideApiName !== undefined ? ApiService.parse(overrideApiName) : Option.none;
    const targetApi = Option.isSome(parsedOverride)
      ? parsedOverride.value.name
      : Option.isSome(api)
        ? api.value
        : undefined;
    if (targetApi === undefined) return;
    const targetTitle =
      overrideTitle ??
      (Option.isSome(parsedOverride)
        ? parsedOverride.value.title
        : Option.unwrapOr(apiTitle, targetApi));
    handlers.submit({
      line: enableApiCommand(targetApi, projectId),
      note: `${targetTitle} を有効にする`,
      next: Option.none,
    });
  };
  const isFullPageCreate = ConsoleScreen.isFullPageCreate(screen);
  const body = (): ReactElement => {
    if (!Option.isSome(project)) {
      return (
        <p className="p-5 text-muted text-sm">
          プロジェクトが選ばれていません。ヘッダーでプロジェクトを選ぶか、CLI で gcloud config set
          project PROJECT_ID を実行してください。
        </p>
      );
    }
    const projectId = project.value.projectId;
    const missingApi = Option.filter(apiTitle, () =>
      Option.isSome(api) ? !World.hasApi(world, projectId, api.value) : false,
    );
    if (Option.isSome(missingApi)) {
      return (
        <div className={isFullPageCreate ? "p-5" : ""}>
          <EnableApiPrompt apiTitle={missingApi.value} onEnable={() => enableApi(projectId)} />
        </div>
      );
    }
    return (
      <>
        <FailureBanner
          outcome={Option.map(outcome, (o) => o.outcome)}
          onEnableApi={(name, title) => enableApi(projectId, name, title)}
          onDismiss={onOutcomeDismiss}
          className={isFullPageCreate ? "mx-5 mt-4 mb-0" : ""}
        />
        <ScreenRouter
          key={projectId}
          screen={screen}
          props={{ world, project: project.value, handlers, navigationOpen, outcome }}
        />
      </>
    );
  };
  return (
    <div
      className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] md:grid-cols-[var(--console-nav-width)_minmax(0,1fr)]"
      data-testid="console-view"
    >
      {navigationOpen && !isFullPageCreate && (
        <ConsoleNav
          screen={screen}
          onChange={handlers.changeScreen}
          onClose={onCloseNavigation}
          pinnedSections={pinnedSections}
          onTogglePin={togglePin}
        />
      )}
      <main
        className={`min-h-0 min-w-0 md:col-start-2 ${isFullPageCreate ? "flex flex-col overflow-auto bg-surface xl:overflow-hidden" : "overflow-auto bg-canvas px-5 py-5"} ${terminalOpen ? "pb-[var(--console-terminal-height)]" : ""}`}
        aria-label="Console"
      >
        {body()}
      </main>
    </div>
  );
};
