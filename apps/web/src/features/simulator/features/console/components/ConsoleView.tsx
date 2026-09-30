import type { ReactElement } from "react";

import type { ExecutionOutcome } from "@/engine";
import { ApiService } from "@/engine/domains/catalog";
import { World } from "@/engine/domains/world";
import { ConsoleNav } from "@/features/simulator/features/console/components/ConsoleNav";
import { EnableApiPrompt } from "@/features/simulator/features/console/components/parts";
import { ScreenRouter } from "@/features/simulator/features/console/components/ScreenRouter";
import {
  ConsoleScreen,
  type ConsoleScreen as Screen,
} from "@/features/simulator/features/console/domains/console-screen";
import { EnableApiCommand } from "@/features/simulator/features/console/domains/equivalent-command";
import type { ConsoleActions } from "@/features/simulator/features/console/types/screen-props";
import { Option } from "@/utils/Option";

type ConsoleViewProps = Readonly<{
  world: World;
  screen: Screen;
  outcome: Option<ExecutionOutcome>;
  actions: ConsoleActions;
  onOutcomeDismiss: () => void;
}>;

/**
 * Console ビュー（UC-008 / DJ-011）。左ナビと画面。操作はすべて `actions.submit` で CLI と同じ経路を通る。
 * プロジェクトが未設定なら画面を出さず、API が無効なら「API を有効にする」だけを出す（本物と同じ導線）。
 */
export const ConsoleView = ({
  world,
  screen,
  outcome,
  actions,
  onOutcomeDismiss,
}: ConsoleViewProps): ReactElement => {
  const projectId = World.currentProjectId(world);
  const api = ConsoleScreen.requiredApi(screen);
  const apiEnabled =
    api === "none" || (Option.isSome(projectId) && World.hasApi(world, projectId.value, api));
  const apiTitle =
    api === "none"
      ? ""
      : Option.unwrapOr(
          Option.map(ApiService.parse(api), (a) => a.title),
          api,
        );
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[15rem_minmax(0,1fr)]" data-testid="console-view">
      <ConsoleNav screen={screen} onChange={actions.changeScreen} />
      <main className="min-h-0 overflow-auto bg-canvas p-6" aria-label="Console">
        {!Option.isSome(projectId) ? (
          <p className="text-muted text-sm">
            プロジェクトが選ばれていません。ヘッダーでプロジェクトを選ぶか、CLI で gcloud config set
            project PROJECT_ID を実行してください。
          </p>
        ) : !apiEnabled ? (
          <EnableApiPrompt
            apiTitle={apiTitle}
            onEnable={() =>
              actions.submit({
                line: EnableApiCommand.toCommand(api, projectId.value),
                note: `${apiTitle} を有効にする`,
                next: Option.none,
              })
            }
          />
        ) : (
          <ScreenRouter
            screen={screen}
            props={{ world, projectId: projectId.value, actions, outcome, onOutcomeDismiss }}
          />
        )}
      </main>
    </div>
  );
};
