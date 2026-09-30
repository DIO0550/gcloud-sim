import { type ReactElement, useState } from "react";

import type { World } from "@/engine/domains/world";
import { Selection, ResourceTree as Tree, type TreeNode } from "@/engine/resource-tree";
import { Option } from "@/utils/Option";

type ResourceTreeProps = Readonly<{
  world: World;
  selection: Option<Selection>;
  /** 現在の core/project。ハイライトに使う（UC-007） */
  currentProjectId: Option<string>;
  onSelect: (selection: Selection) => void;
  onInsertDescribe: (command: string) => void;
}>;

type NodeProps = Readonly<{
  node: TreeNode;
  depth: number;
  selection: Option<Selection>;
  currentProjectId: Option<string>;
  onSelect: (selection: Selection) => void;
  onInsertDescribe: (command: string) => void;
}>;

const StatusDot = ({ status }: Readonly<{ status: TreeNode["status"] }>): ReactElement => {
  switch (status) {
    case "none":
      return <span className="hidden" />;
    case "running":
      return (
        <span role="img" aria-label="RUNNING" className="inline-block h-2 w-2 rounded-full bg-ok" />
      );
    case "stopped":
      return (
        <span
          role="img"
          aria-label="停止中"
          className="inline-block h-2 w-2 rounded-full bg-line"
        />
      );
  }
};

const Node = ({
  node,
  depth,
  selection,
  currentProjectId,
  onSelect,
  onInsertDescribe,
}: NodeProps): ReactElement => {
  // 組織 → フォルダ → プロジェクト → 種別グループ → リソースまでは開いておき、ネットワーク配下（fw）だけ畳む。
  const [isOpen, setOpen] = useState(depth < 4);
  const isSelected =
    Option.isSome(selection) &&
    Option.isSome(node.selection) &&
    Selection.equals(selection.value, node.selection.value);
  const isCurrentProject =
    Option.isSome(node.selection) &&
    node.selection.value.kind === "project" &&
    Option.isSome(currentProjectId) &&
    node.selection.value.projectId === currentProjectId.value;
  const hasChildren = node.children.length > 0;
  const select = (): void => {
    if (Option.isSome(node.selection)) onSelect(node.selection.value);
  };
  const insert = (): void => {
    const command = Option.flatMap(node.selection, Selection.describeCommand);
    if (Option.isSome(command)) onInsertDescribe(command.value);
  };
  return (
    <li>
      <div
        className={`flex items-center gap-1.5 rounded px-2 py-1 text-sm ${isSelected ? "bg-accent text-white" : "hover:bg-canvas"}`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="w-4 text-xs"
            onClick={() => setOpen((v) => !v)}
            aria-label={isOpen ? `${node.label} を折りたたむ` : `${node.label} を展開する`}
            aria-expanded={isOpen}
          >
            {isOpen ? "▾" : "▸"}
          </button>
        ) : (
          <span className="w-4" />
        )}
        <button
          type="button"
          className={`flex min-w-0 flex-1 items-center gap-2 text-left ${Option.isSome(node.selection) ? "" : "cursor-default"}`}
          onClick={select}
          onDoubleClick={insert}
          aria-current={isSelected ? "true" : undefined}
        >
          {node.badge !== "" && (
            <span
              className={`rounded border px-1 text-xs ${isSelected ? "border-white/60" : "border-line text-muted"}`}
            >
              {node.badge}
            </span>
          )}
          <StatusDot status={node.status} />
          <span
            className={`truncate font-mono ${isCurrentProject ? "font-bold text-accent" : ""} ${isSelected ? "text-white" : ""}`}
          >
            {node.label}
          </span>
          {Option.isSome(node.count) && (
            <span className={`text-xs ${isSelected ? "text-white/80" : "text-muted"}`}>
              {node.count.value}
            </span>
          )}
        </button>
      </div>
      {hasChildren && isOpen && (
        <ul>
          {node.children.map((child) => (
            <Node
              key={child.key}
              node={child}
              depth={depth + 1}
              selection={selection}
              currentProjectId={currentProjectId}
              onSelect={onSelect}
              onInsertDescribe={onInsertDescribe}
            />
          ))}
        </ul>
      )}
    </li>
  );
};

/** 左ペイン: 組織 → フォルダ → プロジェクト → リソースのツリー（UC-007）。 */
export const ResourceTree = ({
  world,
  selection,
  currentProjectId,
  onSelect,
  onInsertDescribe,
}: ResourceTreeProps): ReactElement => {
  const roots = Tree.fromWorld(world);
  return (
    <nav
      aria-label="リソース階層"
      className="flex min-h-0 flex-col border-line border-r bg-surface"
    >
      <h2 className="px-4 pt-4 pb-2 font-semibold text-muted text-sm">リソース階層</h2>
      <ul className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        {roots.map((node) => (
          <Node
            key={node.key}
            node={node}
            depth={0}
            selection={selection}
            currentProjectId={currentProjectId}
            onSelect={onSelect}
            onInsertDescribe={onInsertDescribe}
          />
        ))}
      </ul>
      <p className="border-line border-t px-4 py-3 text-muted text-xs">
        クリックでプロパティ、ダブルクリックで describe を入力行に挿入
      </p>
    </nav>
  );
};
