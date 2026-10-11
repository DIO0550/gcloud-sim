import { type ReactElement, useEffect, useMemo, useState } from "react";
import { StatusDot } from "@/components/StatusDot";

import { TextButton } from "@/components/TextButton";
import type { World } from "@/engine/domains/world";
import {
  type ResourceGroup,
  type ResourceLabelKind,
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
  onCreate: () => void;
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
    case "builds":
      return "Cloud Build";
    case "ace-support":
      return "AI構成・選定演習";
    case "terraform":
      return "Terraform";
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
    case "admin":
      return "組織・ID・クォータ・課金";
    case "storage":
      return "Cloud Storage";
    case "gke":
      return "Kubernetes Engine";
    case "serverless":
      return "サーバーレス設定・連携";
    case "run":
      return "Cloud Run";
    case "functions":
      return "Cloud Functions";
    case "app-engine":
      return "App Engine";
    case "managed-databases":
      return "Spanner・Bigtable・バックアップ";
    case "network-lab":
      return "VPC・接続・DNS・Firewall";
    case "compute-lab":
      return "VM構成・復旧・段階更新";
    case "data-processing":
      return "BigQuery・データ処理・Kafka";
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

const resourcePrefixes: Readonly<Record<ResourceLabelKind, string>> = {
  snapshot: "snapshot",
  "instance-template": "template",
  "instance-group": "mig",
  "health-check": "hc",
  "backend-service": "bes",
  "forwarding-rule": "fr",
  address: "ip",
  firewall: "fw",
  subnet: "subnet",
  router: "router",
  "node-pool": "pool",
  "kube-statefulset": "sts",
  "kube-deployment": "deploy",
  "kube-service": "svc",
  "kube-hpa": "hpa",
  pvc: "pvc",
  "kube-ingress": "ing",
  "kube-network-policy": "netpol",
  "kube-namespace": "namespace",
  storageclass: "sc",
  pv: "pv",
  subscription: "sub",
  budget: "budget",
};

const labelText = (label: TreeLabel): string => {
  switch (label.kind) {
    case "text":
      return label.resource === undefined
        ? label.text
        : `${resourcePrefixes[label.resource]}: ${label.text}`;
    case "group":
      return groupText(label.group);
  }
};

const containsSelection = (node: TreeNode, selection: TreeSelection): boolean => {
  if (Option.isSome(node.selection) && TreeSelection.equals(node.selection.value, selection)) {
    return true;
  }
  return node.children.some((child) => containsSelection(child, selection));
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
  const selectedDescendant =
    Option.isSome(selection) &&
    node.children.some((child) => containsSelection(child, selection.value));
  useEffect(() => {
    if (Option.isSome(selection) && selectedDescendant) {
      setOpen(true);
    }
  }, [selection, selectedDescendant]);
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
  const badgeColor = isCurrentProject ? "text-accent" : "text-muted";
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
              className={`shrink-0 rounded border px-1 py-px text-sm leading-5 ${isSelected ? "border-white/60 text-white" : `border-line bg-surface ${badgeColor}`}`}
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
  onCreate,
}: ResourceTreeProps): ReactElement => {
  // 選択やタブの切り替えでは World が変わらないので、ツリーの組み立ては World が変わったときだけ。
  const roots = useMemo(() => TreeNode.fromWorld(world), [world]);
  return (
    <nav
      aria-label="リソース階層"
      className="order-3 flex h-64 min-w-0 flex-col border-line border-r bg-surface lg:order-none lg:h-auto lg:min-h-0"
    >
      <div className="flex items-center justify-between px-4 pt-5 pb-3">
        <h2 className="font-bold text-[15px] text-muted">リソース階層</h2>
        <TextButton onClick={onCreate} ariaLabel="階層にリソースを追加">
          ＋ 作成
        </TextButton>
      </div>
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
