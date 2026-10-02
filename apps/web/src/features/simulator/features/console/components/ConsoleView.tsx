import type { ReactElement } from "react";

import type { ExecutionOutcome } from "@/engine";
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
  type ConsoleScreen as Screen,
} from "@/features/simulator/features/console/domains/console-screen";
import { enableApiCommand } from "@/features/simulator/features/console/domains/equivalent-command";
import type { ConsoleHandlers } from "@/features/simulator/features/console/types/screen-props";
import { Option } from "@/utils/Option";

type ConsoleViewProps = Readonly<{
  world: World;
  screen: Screen;
  /** 直近にこの Console から流したコマンドの結果。失敗なら画面の上に赤帯で出す */
  outcome: Option<ExecutionOutcome>;
  handlers: ConsoleHandlers;
  onOutcomeDismiss: () => void;
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
}: ConsoleViewProps): ReactElement => {
  const project = Option.flatMap(World.currentProjectId(world), (id) =>
    World.findActiveProject(world, id),
  );
  const api = ConsoleScreen.requiredApi(screen);
  const apiTitle = Option.map(api, (a) => ApiService.find(a).title);
  const enableApi = (projectId: string): void => {
    if (!Option.isSome(api) || !Option.isSome(apiTitle)) return;
    handlers.submit({
      line: enableApiCommand(api.value, projectId),
      note: `${apiTitle.value} を有効にする`,
      next: Option.none,
    });
  };
  const body = (): ReactElement => {
    if (!Option.isSome(project)) {
      return (
        <p className="text-muted text-sm">
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
      return <EnableApiPrompt apiTitle={missingApi.value} onEnable={() => enableApi(projectId)} />;
    }
    return (
      <>
        <FailureBanner
          outcome={outcome}
          onEnableApi={() => enableApi(projectId)}
          onDismiss={onOutcomeDismiss}
        />
        <ScreenRouter screen={screen} props={{ world, project: project.value, handlers }} />
      </>
    );
  };
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[15rem_minmax(0,1fr)]" data-testid="console-view">
      <ConsoleNav screen={screen} onChange={handlers.changeScreen} />
      <main className="min-h-0 overflow-auto bg-canvas px-8 py-7" aria-label="Console">
        {body()}
      </main>
    </div>
  );
};
