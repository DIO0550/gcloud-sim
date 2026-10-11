import { findScenario } from "@/engine/domains/ace-support/catalog";
import { NotFound, Section, type SelectionProps } from "./PropertyParts";

export const AceSupportProperties = ({ world, selection }: SelectionProps<"ace-support">) => {
  if (selection.collection === "decisions") {
    const d = world.aceSupport.decisions.find(
      (item) => item.projectId === selection.projectId && item.scenario === selection.name,
    );
    const scenario = findScenario(selection.name);
    if (!d || !scenario) {
      return <NotFound what="判断記録" />;
    }
    return (
      <>
        <Section
          title="選定演習"
          rows={[
            { label: "要件", value: scenario.requirements },
            { label: "選択", value: d.choice },
            { label: "判定", value: d.choice === scenario.answer ? "正解" : "見直し" },
            { label: "記録した理由", value: d.reason },
            { label: "解説", value: scenario.reason },
            { label: "試行回数", value: d.attempts },
          ]}
        />
        <p className="text-sm text-muted">
          選択肢を固定要件で採点します。自由文の意味は採点しません。
        </p>
      </>
    );
  }
  const r = world.aceSupport.resources.find(
    (item) =>
      item.projectId === selection.projectId &&
      item.region === selection.region &&
      item.name === selection.name,
  );
  if (!r) {
    return <NotFound what="AI教材構成" />;
  }
  return (
    <>
      <Section
        title="AI教材の構成・操作履歴"
        rows={[
          { label: "種類", value: r.kind },
          { label: "platform", value: r.platform },
          { label: "region", value: r.region },
          { label: "SA", value: r.serviceAccount },
          { label: "subnet", value: r.subnet },
          { label: "アクセス", value: r.access },
          { label: "idle設定（分）", value: r.idleMinutes },
          { label: "教材状態", value: r.status },
          { label: "構成revision", value: r.revision },
          { label: "開始時revision", value: r.lastStartedRevision },
          { label: "開始 / 停止", value: `${r.starts} / ${r.stops}` },
        ]}
      />
      <p className="text-sm text-muted">
        構成と明示操作の教材です。RUNNINGでも実agent・VM・IDEは起動せず、推論・通信・課金は行いません。idle設定で自動的に時刻や状態は進みません。
      </p>
    </>
  );
};
