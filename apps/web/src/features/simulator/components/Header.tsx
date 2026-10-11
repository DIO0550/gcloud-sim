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
  /** Console の下の端末（ドロワー）を開いているか */
  isTerminalOpen: boolean;
  onTerminalToggle: () => void;
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
  isTerminalOpen,
  onTerminalToggle,
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

  if (view === "console") {
    return (
      <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-3 border-line border-b bg-surface px-4 py-2 text-sm lg:flex-nowrap">
        <GhostButton
          ariaLabel="Console ナビゲーションを切り替え"
          ariaExpanded={isNavigationOpen}
          onClick={onNavigationToggle}
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5">
            <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </GhostButton>
        <h1 className="shrink-0 font-bold font-mono text-lg tracking-tight">gcloud-sim</h1>
        <span className="hidden whitespace-nowrap rounded border border-line px-2 py-1 text-muted text-xs sm:block">
          Console ビュー
        </span>
        <div className="flex shrink-0 items-center gap-2 rounded border border-line px-3 py-1.5">
          <span aria-hidden="true" className="h-4 w-4 rounded-sm bg-accent" />
          <Select
            variant="bare"
            ariaLabel="プロジェクト"
            value={projectId}
            onChange={onProjectChange}
            options={projectOptions}
          />
        </div>
        <div className="order-last flex min-w-0 basis-full items-center gap-2 rounded-lg bg-code px-3 lg:order-none lg:ml-1 lg:flex-1 lg:basis-auto">
          <span aria-hidden="true" className="text-muted">
            ⌕
          </span>
          <div className="min-w-0 flex-1">
            <SuggestInput
              ariaLabel="プロダクト、画面を検索"
              placeholder="プロダクト、画面を検索"
              value={search}
              onChange={setSearch}
              className="h-9 w-full min-w-0 bg-transparent text-sm focus:outline-none"
              suggestions={searchScreens.map((screen) => ({
                value: screenText(screen),
                description: sectionText(ConsoleScreen.section(screen)),
              }))}
              onSelect={(value) => {
                const screen = searchScreens.find((item) => screenText(item) === value);
                if (screen !== undefined) onNavigate(screen);
                setSearch("");
              }}
            />
          </div>
        </div>
        <ToggleButton variant="ghost" pressed={isTerminalOpen} onClick={onTerminalToggle}>
          <span className="font-mono">&gt;_</span> ターミナル
        </ToggleButton>
        <SegmentedControl
          label="表示"
          value={view}
          options={Object.values(Views).map((v) => ({ value: v, label: viewText(v) }))}
          onChange={onViewChange}
        />
        <GhostButton ariaLabel="設定" onClick={onOpenSettings}>
          ⚙
        </GhostButton>
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
      </header>
    );
  }
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-3 border-line border-b bg-surface px-4 py-2.5 lg:gap-4 lg:px-5">
      <h1 className="shrink-0 font-bold font-mono text-lg tracking-tight">gcloud-sim</h1>
      <span className="whitespace-nowrap rounded border border-line px-2 py-0.5 text-muted text-xs">
        非公式・学習用
      </span>
      <SegmentedControl
        label="表示"
        value={view}
        options={Object.values(Views).map((v) => ({ value: v, label: viewText(v) }))}
        onChange={onViewChange}
        className="lg:ml-4"
      />
      <div className="flex w-full flex-wrap items-center gap-2 text-sm lg:ml-auto lg:w-auto lg:gap-3">
        <div className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5">
          <span className="hidden whitespace-nowrap text-muted sm:inline">プロジェクト</span>
          <Select
            variant="bare"
            ariaLabel="プロジェクト"
            value={projectId}
            onChange={onProjectChange}
            options={[
              ...(WorldOps.hasProjectId(world, projectId)
                ? []
                : [{ value: projectId, label: projectId === "" ? "(未設定)" : projectId }]),
              ...WorldOps.activeProjects(world).map((p) => ({
                value: p.projectId,
                label: p.projectId,
              })),
            ]}
          />
        </div>
        <div
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
            options={[
              ...(Option.isSome(principal) ? [] : [{ value: "", label: "(未選択)" }]),
              ...world.session.accounts.map((account) => ({ value: account, label: account })),
            ]}
          />
        </div>
        <GhostButton onClick={onOpenSettings}>設定</GhostButton>
      </div>
    </header>
  );
};
