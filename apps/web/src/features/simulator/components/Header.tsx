import type { ReactElement } from "react";

import { GhostButton, ToggleButton } from "@/components/Button";
import { Select } from "@/components/Select";
import type { World } from "@/engine/domains/world";
import { World as WorldOps } from "@/engine/domains/world";
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
}>;

const viewText = (view: View): string => {
  switch (view) {
    case "cli":
      return "CLI";
    case "console":
      return "Console";
  }
};

/** 画面上部: 名前・非公式の注記・CLI/Console の切り替え・プロジェクト・プリンシパル・設定。 */
export const Header = ({
  world,
  view,
  onViewChange,
  onProjectChange,
  onPrincipalChange,
  onOpenSettings,
  isTerminalOpen,
  onTerminalToggle,
}: HeaderProps): ReactElement => {
  const projectId = Option.unwrapOr(WorldOps.currentProjectId(world), "");
  const principal = WorldOps.currentPrincipal(world);
  // 組織の Owner 以外で操作しているときは警告色（UC-004: 権限不足を体験している最中だと分かるように）。
  const isOwner = Option.isSome(principal) && WorldOps.isOrganizationOwner(world, principal.value);
  const principalValue = Option.unwrapOr(principal, "");
  return (
    <header className="flex items-center gap-4 border-line border-b bg-surface px-5 py-2.5">
      <h1 className="font-bold font-mono text-lg tracking-tight">gcloud-sim</h1>
      <span className="rounded border border-line px-2 py-0.5 text-muted text-xs">
        非公式・学習用
      </span>
      <fieldset className="ml-4 flex rounded-lg border border-line bg-canvas p-0.5 text-sm">
        <legend className="sr-only">表示</legend>
        {Object.values(Views).map((v) => (
          <ToggleButton
            key={v}
            variant="segment"
            pressed={view === v}
            onClick={() => onViewChange(v)}
          >
            {viewText(v)}
          </ToggleButton>
        ))}
      </fieldset>
      <div className="ml-auto flex items-center gap-3 text-sm">
        {view === "console" && (
          <ToggleButton variant="ghost" pressed={isTerminalOpen} onClick={onTerminalToggle}>
            <span className="font-mono">&gt;_</span> ターミナル
          </ToggleButton>
        )}
        <div className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5">
          <span className="text-muted">プロジェクト</span>
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
          <span className="text-muted">プリンシパル</span>
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
