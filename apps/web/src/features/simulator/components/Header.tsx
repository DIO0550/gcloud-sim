import { type ReactElement, useState } from "react";
import { GhostButton } from "@/components/GhostButton";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Select } from "@/components/Select";
import { SuggestInput } from "@/components/SuggestInput";
import { ToggleButton } from "@/components/ToggleButton";
import type { World } from "@/engine/domains/world";
import { World as WorldOps } from "@/engine/domains/world";
import {
  screenText,
  sectionText,
} from "@/features/simulator/features/console/components/ConsoleNav";
import { ConsoleScreen } from "@/features/simulator/features/console/domains/console-screen";
import { type View, Views } from "@/features/simulator/hooks/use-simulator";
import { Option } from "@/utils/Option";

type HeaderProps = Readonly<{
  world: World;
  view: View;
  onViewChange: (view: View) => void;
  onProjectChange: (projectId: string) => void;
  onPrincipalChange: (principal: string) => void;
  onOpenSettings: () => void;
  onCreateResource: () => void;
  /** Console の下の端末（ドロワー）を開いているか */
  isTerminalOpen: boolean;
  onTerminalToggle: () => void;
  /** Console の右に演習（ミッション）のパネルを開いているか */
  isMissionsOpen: boolean;
  onMissionsToggle: () => void;
  isNavigationOpen: boolean;
  onNavigationToggle: () => void;
  onNavigate: (screen: ConsoleScreen) => void;
}>;

const viewText = (view: View): string => {
  switch (view) {
    case "cli":
      return "CLI";
    case "console":
      return "Console";
  }
};

/** CLI（2a）と Console（2b〜2d）のヘッダー。同じプロジェクトと認証アカウントを切り替える。 */
export const Header = ({
  world,
  view,
  onViewChange,
  onProjectChange,
  onPrincipalChange,
  onOpenSettings,
  onCreateResource,
  isTerminalOpen,
  onTerminalToggle,
  isMissionsOpen,
  onMissionsToggle,
  isNavigationOpen,
  onNavigationToggle,
  onNavigate,
}: HeaderProps): ReactElement => {
  const [search, setSearch] = useState("");
  const projectId = Option.unwrapOr(WorldOps.currentProjectId(world), "");
  const principal = WorldOps.currentPrincipal(world);
  // 組織の Owner 以外で操作しているときは警告色（UC-004: 権限不足を体験している最中だと分かるように）。
  const isOwner = Option.isSome(principal) && WorldOps.isOrganizationOwner(world, principal.value);
  const principalValue = Option.unwrapOr(principal, "");
  const projectOptions = [
    ...(WorldOps.hasProjectId(world, projectId)
      ? []
      : [{ value: projectId, label: projectId === "" ? "(未設定)" : projectId }]),
    ...WorldOps.activeProjects(world).map((p) => ({ value: p.projectId, label: p.projectId })),
  ];
  const principalOptions = [
    ...(Option.isSome(principal) ? [] : [{ value: "", label: "(未選択)" }]),
    ...world.session.accounts.map((account) => ({ value: account, label: account })),
  ];
  const searchScreens = ConsoleScreen.all().filter(
    (screen) => ConsoleScreen.navItem(screen) === screen,
  );

  return (
    <header className="relative z-20 flex min-h-12 shrink-0 flex-wrap items-center gap-2.5 border-line border-b bg-surface px-3 py-1.5 text-sm shadow-[0_1px_2px_rgba(60,64,67,0.12)] lg:flex-nowrap">
      <GhostButton
        ariaLabel={`${viewText(view)} ナビゲーションを切り替え`}
        ariaExpanded={isNavigationOpen}
        onClick={onNavigationToggle}
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5 text-muted">
          <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </GhostButton>
      <div className="flex shrink-0 items-center gap-2.5" data-testid="view-switcher">
        <div className="flex shrink-0 items-center gap-2">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6 shrink-0">
            <path
              d="M12 5.5a5.5 5.5 0 0 1 5.17 3.63A4 4 0 0 1 17 17H7.5a4.5 4.5 0 0 1-.82-8.92A5.5 5.5 0 0 1 12 5.5Z"
              fill="none"
              stroke="#4285f4"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <path d="M7.5 17H17" stroke="#34a853" strokeWidth="2" strokeLinecap="round" />
            <path d="M12 5.5a5.5 5.5 0 0 1 4.6 2.5" stroke="#ea4335" strokeWidth="2" fill="none" />
            <path
              d="M6.68 8.08A4.5 4.5 0 0 0 3 12.5"
              stroke="#fbbc04"
              strokeWidth="2"
              fill="none"
            />
          </svg>
          <h1 className="shrink-0 font-semibold text-base text-ink tracking-tight">
            <span className="font-mono">gcloud-sim</span>
          </h1>
        </div>
        <SegmentedControl
          label="表示"
          value={view}
          options={Object.values(Views).map((v) => ({ value: v, label: viewText(v) }))}
          onChange={onViewChange}
          className="shrink-0 [&_button]:w-20"
        />
      </div>
      <span className="hidden shrink-0 whitespace-nowrap rounded-full border border-line bg-canvas px-2 py-0.5 text-[11px] text-muted sm:block">
        非公式・学習用
      </span>
      {view === Views.Console ? (
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 lg:w-auto lg:flex-1 lg:flex-nowrap">
          <div className="flex shrink-0 items-center gap-2 rounded border border-line bg-surface px-2.5 py-1 transition-colors hover:bg-canvas">
            <svg
              aria-hidden="true"
              viewBox="0 0 18 18"
              className="h-4 w-4 shrink-0 text-muted"
              fill="none"
            >
              <circle cx="9" cy="3.5" r="2" fill="currentColor" />
              <circle cx="4" cy="13.5" r="2" fill="currentColor" />
              <circle cx="14" cy="13.5" r="2" fill="currentColor" />
              <path d="M9 5.5v3.5m0 0-4 3.5m4-3.5 4 3.5" stroke="currentColor" strokeWidth="1.4" />
            </svg>
            <Select
              variant="bare"
              ariaLabel="プロジェクト"
              value={projectId}
              onChange={onProjectChange}
              options={projectOptions}
            />
          </div>
          <div className="order-last flex min-w-0 basis-full items-center gap-2 rounded-lg border border-transparent bg-code px-3 transition-all focus-within:border-accent focus-within:bg-surface focus-within:shadow-[0_1px_4px_rgba(60,64,67,0.2)] lg:order-none lg:mx-2 lg:max-w-xl lg:flex-1 lg:basis-auto">
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              className="h-4 w-4 shrink-0 text-muted"
              fill="none"
            >
              <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.7" />
              <path
                d="m13.2 13.2 3.3 3.3"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
            <div className="min-w-0 flex-1">
              <SuggestInput
                ariaLabel="プロダクト、画面を検索"
                placeholder="プロダクト、画面を検索"
                emptyMessage="一致する画面がありません"
                value={search}
                onChange={setSearch}
                className="h-8 w-full min-w-0 bg-transparent text-sm focus:outline-none"
                suggestions={searchScreens.map((screen) => ({
                  value: screenText(screen),
                  description: sectionText(ConsoleScreen.section(screen)),
                }))}
                onSelect={(value) => {
                  const screen = searchScreens.find((item) => screenText(item) === value);
                  if (screen !== undefined) {
                    onNavigate(screen);
                  }
                  setSearch("");
                }}
              />
            </div>
            <kbd className="hidden rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[11px] text-muted sm:inline">
              /
            </kbd>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <ToggleButton
              variant="ghost"
              pressed={isTerminalOpen}
              onClick={onTerminalToggle}
              title="Cloud Shell をアクティブにする"
            >
              <span className="font-mono">&gt;_</span> Cloud Shell
            </ToggleButton>
            <ToggleButton variant="ghost" pressed={isMissionsOpen} onClick={onMissionsToggle}>
              ミッション
            </ToggleButton>
            <GhostButton ariaLabel="設定" onClick={onOpenSettings}>
              ⚙
            </GhostButton>
            <span title="組織・フォルダ・プロジェクトを作成">
              <GhostButton ariaLabel="リソースを作成" onClick={onCreateResource}>
                ＋ 作成
              </GhostButton>
            </span>
            <span
              className="ml-1"
              title={
                isOwner
                  ? `認証アカウント: ${principalValue}`
                  : `組織 Owner 以外で操作中: ${principalValue}（権限不足の動作を確認できます）`
              }
            >
              <Select
                variant="avatar"
                font="sans"
                align="end"
                ariaLabel="プリンシパル"
                className={isOwner ? "" : "ring-2 ring-warn"}
                value={principalValue}
                onChange={onPrincipalChange}
                options={principalOptions}
              />
            </span>
          </div>
        </div>
      ) : (
        <div className="flex w-full flex-wrap items-center gap-2 text-sm lg:ml-auto lg:w-auto lg:gap-3">
          <div className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5">
            <span className="hidden whitespace-nowrap text-muted sm:inline">プロジェクト</span>
            <Select
              variant="bare"
              ariaLabel="プロジェクト"
              value={projectId}
              onChange={onProjectChange}
              options={projectOptions}
            />
          </div>
          <div
            title={
              isOwner
                ? `認証アカウント: ${principalValue}`
                : `組織 Owner 以外で操作中: ${principalValue}（権限不足の動作を確認できます）`
            }
            className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 ${isOwner ? "border-line" : "border-warn bg-warn-soft"}`}
          >
            <span className="hidden whitespace-nowrap text-muted sm:inline">プリンシパル</span>
            <Select
              variant="bare"
              align="end"
              ariaLabel="プリンシパル"
              className={isOwner ? "" : "text-warn-ink"}
              value={principalValue}
              onChange={onPrincipalChange}
              options={principalOptions}
            />
          </div>
          <GhostButton onClick={onOpenSettings}>設定</GhostButton>
          <span title="組織・フォルダ・プロジェクトを作成">
            <GhostButton ariaLabel="リソースを作成" onClick={onCreateResource}>
              ＋ 作成
            </GhostButton>
          </span>
        </div>
      )}
    </header>
  );
};
