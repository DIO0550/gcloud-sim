import { type ReactElement, useMemo, useState } from "react";

import { TextButton } from "@/components/TextButton";
import type { World } from "@/engine/domains/world";
import {
  type ResourceGroup,
  type TreeBadge,
  type TreeLabel,
  TreeNode,
  TreeSelection,
} from "@/engine/resource-tree";
import { Option } from "@/utils/Option";

type ResourceTreeProps = Readonly<{
  world: World;
  selection: Option<TreeSelection>;
  /** 現在の core/project。ハイライトに使う（UC-007） */
  currentProjectId: Option<string>;
  onSelect: (selection: TreeSelection) => void;
  onInsertDescribe: (command: string) => void;
}>;

type NodeProps = Readonly<{
  node: TreeNode;
  depth: number;
  selection: Option<TreeSelection>;
  currentProjectId: Option<string>;
  onSelect: (selection: TreeSelection) => void;
  onInsertDescribe: (command: string) => void;
}>;

/** 種別バッジの綴り（モック 2a の `組織` / `フォルダ` / `PJ` / `請求`）。 */
const badgeText = (badge: TreeBadge): string => {
  switch (badge) {
    case "organization":
      return "組織";
    case "folder":
      return "フォルダ";
    case "project":
      return "PJ";
    case "billing":
      return "請求";
    case "none":
      return "";
  }
};

/** リソース種別グループの見出し（モック 2a のプロダクト名。足した種別も同じ流儀）。 */
const groupText = (group: ResourceGroup): string => {
  switch (group) {
    case "artifacts":
      return "Artifact Registry";
    case "local-docker":
      return "Docker（ローカル）";
    case "compute":
      return "Compute Engine";
    case "disks":
      return "ディスク";
    case "instance-groups":
      return "インスタンスグループ";
    case "load-balancing":
      return "ロードバランシング";
    case "vpc":
      return "VPC ネットワーク";
    case "storage":
      return "Cloud Storage";
    case "gke":
      return "Kubernetes Engine";
    case "run":
      return "Cloud Run";
    case "functions":
      return "Cloud Functions";
    case "app-engine":
      return "App Engine";
    case "sql":
      return "Cloud SQL";
    case "pubsub":
      return "Pub/Sub";
    case "monitoring":
      return "Monitoring";
    case "logging":
      return "Logging";
    case "kms":
      return "Cloud KMS";
    case "dns":
      return "Cloud DNS";
    case "deployment-manager":
      return "Deployment Manager";
    case "service-accounts":
      return "サービスアカウント";
    case "roles":
      return "ロール";
    case "iam":
      return "IAM";
  }
};

const labelText = (label: TreeLabel): string => {
  switch (label.kind) {
    case "text":
      return label.text;
    case "group":
      return groupText(label.group);
  }
};

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
          className="inline-block h-2 w-2 rounded-full bg-[#b5bcc5]"
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
  const label = labelText(node.label);
  const badge = badgeText(node.badge);
  const isSelected =
    Option.isSome(selection) &&
    Option.isSome(node.selection) &&
    TreeSelection.equals(selection.value, node.selection.value);
  const isCurrentProject =
    Option.isSome(node.selection) &&
    node.selection.value.kind === "project" &&
    Option.isSome(currentProjectId) &&
    node.selection.value.projectId === currentProjectId.value;
  const hasChildren = node.children.length > 0;
  // 組織・フォルダ・種別グループは名前（プロポーショナル）、プロジェクトとリソースは ID（等幅）で書く。
  const isName =
    node.label.kind === "group" || node.badge === "organization" || node.badge === "folder";
  const select = (): void => {
    if (Option.isSome(node.selection)) onSelect(node.selection.value);
  };
  const insert = (): void => {
    const command = Option.flatMap(node.selection, TreeSelection.describeCommand);
    if (Option.isSome(command)) onInsertDescribe(command.value);
  };
  return (
    <li>
      <div
        className={`flex items-center gap-1.5 rounded-md py-1 pr-2 text-[15px] ${isSelected ? "bg-accent text-white" : "hover:bg-canvas"}`}
        style={{ paddingLeft: `${6 + depth * 18}px` }}
      >
        {hasChildren ? (
          <TextButton
            tone={isSelected ? "inherit" : "muted"}
            className="w-4 text-[10px]"
            onClick={() => setOpen((v) => !v)}
            ariaLabel={isOpen ? `${label} を折りたたむ` : `${label} を展開する`}
            ariaExpanded={isOpen}
          >
            {isOpen ? "▾" : "▸"}
          </TextButton>
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
          {badge !== "" && (
            <span
              className={`rounded border px-1.5 py-px text-xs ${isSelected ? "border-white/60" : "border-line text-muted"}`}
            >
              {badge}
            </span>
          )}
          <StatusDot status={node.status} />
          <span
            className={`truncate ${isName ? "" : "font-mono"} ${isCurrentProject ? "font-bold text-accent" : ""} ${isSelected ? "font-medium text-white" : ""}`}
          >
            {label}
          </span>
          {Option.isSome(node.count) && (
            <span className={isSelected ? "text-white/80" : "text-muted/70"}>
              {node.count.value}
            </span>
          )}
          {isSelected && <span className="ml-auto text-xs">›</span>}
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
  // 選択やタブの切り替えでは World が変わらないので、ツリーの組み立ては World が変わったときだけ。
  const roots = useMemo(() => TreeNode.fromWorld(world), [world]);
  return (
    <nav
      aria-label="リソース階層"
      className="flex min-h-0 flex-col border-line border-r bg-surface"
    >
      <h2 className="px-4 pt-5 pb-3 font-bold text-[15px] text-muted">リソース階層</h2>
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
      <p className="mx-2 border-line border-t px-2 py-4 text-muted text-sm leading-relaxed">
        クリックでプロパティ、ダブルクリックで <span className="font-mono">describe</span>{" "}
        を入力行に挿入
      </p>
    </nav>
  );
};
