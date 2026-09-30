import type { ReactElement } from "react";

import type { World } from "@/engine/domains/world";
import { World as WorldOps } from "@/engine/domains/world";
import { Option } from "@/utils/Option";

type HeaderProps = Readonly<{
  world: World;
  onProjectChange: (projectId: string) => void;
  onPrincipalChange: (principal: string) => void;
  onOpenSettings: () => void;
}>;

/** 画面上部: 名前・非公式の注記・CLI/Console の切り替え・プロジェクト・プリンシパル・設定。 */
export const Header = ({
  world,
  onProjectChange,
  onPrincipalChange,
  onOpenSettings,
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
        <span
          className="rounded-md bg-surface px-3 py-1 font-semibold shadow-sm"
          aria-current="page"
        >
          CLI
        </span>
        <button
          type="button"
          className="px-3 py-1 text-muted"
          disabled
          title="Console ビューは Phase 2 で有効になります"
        >
          Console
        </button>
      </fieldset>
      <div className="ml-auto flex items-center gap-3 text-sm">
        <label className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5">
          <span className="text-muted">プロジェクト</span>
          <select
            className="bg-transparent font-mono"
            value={projectId}
            onChange={(event) => onProjectChange(event.target.value)}
            aria-label="プロジェクト"
          >
            {!WorldOps.hasProjectId(world, projectId) && (
              <option value={projectId}>{projectId === "" ? "(未設定)" : projectId}</option>
            )}
            {WorldOps.activeProjects(world).map((p) => (
              <option key={p.projectId} value={p.projectId}>
                {p.projectId}
              </option>
            ))}
          </select>
        </label>
        <label
          className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 ${isOwner ? "border-line" : "border-warn bg-warn-soft"}`}
        >
          <span className="text-muted">プリンシパル</span>
          <select
            className={`bg-transparent font-mono ${isOwner ? "" : "text-warn-ink"}`}
            value={principalValue}
            onChange={(event) => onPrincipalChange(event.target.value)}
            aria-label="プリンシパル"
          >
            {!Option.isSome(principal) && <option value="">(未選択)</option>}
            {world.session.accounts.map((account) => (
              <option key={account} value={account}>
                {account}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="rounded-lg px-3 py-1.5 hover:bg-canvas"
          onClick={onOpenSettings}
        >
          設定
        </button>
      </div>
    </header>
  );
};
