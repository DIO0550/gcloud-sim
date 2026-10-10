import type { ReactElement } from "react";
import { observeResources } from "@/engine/domains/observability-lab/resources";
import { NotFound, Section, type SelectionProps } from "./PropertyParts";

const labels: Readonly<Record<string, string>> = {
  enabled: "有効",
  verified: "検証済み",
  email: "通知先",
  goal: "SLO目標",
  sli: "SLI",
  burnRate: "バーンレート",
  remainingBudget: "残りエラーバジェット",
  retentionDays: "保持日数",
  locked: "保持ロック",
  analyticsEnabled: "Analytics有効",
  retainedLogs: "保持中のログ",
  active: "発火",
  notifications: "通知対象",
  time: "仮想時刻（秒）",
  lifecycleState: "状態",
  status: "状態",
  projectId: "プロジェクト",
  resource: "対象",
  serviceAccount: "サービスアカウント",
  destination: "転送先",
  state: "転送結果",
  filter: "フィルタ",
  readers: "閲覧メンバー",
  conditions: "条件",
  results: "評価結果",
  channels: "通知チャネル",
  combiner: "条件の結合",
};
const valueText = (value: unknown): string => {
  if (typeof value === "boolean") {
    return value ? "はい" : "いいえ";
  }
  if (value === null || value === undefined) {
    return "データなし";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
};
export const ObservabilityLabProperties = ({
  world,
  selection,
}: SelectionProps<"observability-lab">): ReactElement => {
  const item = observeResources(world, selection.projectId).find(
    (r) => r.collection === selection.collection && r.name === selection.name,
  );
  if (!item) {
    return <NotFound what="監視・ログ構成" />;
  }
  return (
    <>
      <Section
        title={item.label}
        rows={Object.entries(item.resource).map(([key, value]) => ({
          label: labels[key] ?? key,
          value: valueText(value),
        }))}
      />
      <p className="text-muted text-sm">
        仮想時刻: {world.observabilityLab.clock}{" "}
        秒。通知と収集の結果は教材内のシミュレーションです。
      </p>
    </>
  );
};
