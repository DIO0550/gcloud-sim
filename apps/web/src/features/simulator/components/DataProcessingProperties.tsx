import type { ReactElement } from "react";
import { NotFound, type Row, Section, type SelectionProps } from "./PropertyParts";

export const DataProcessingProperties = ({
  world,
  selection: s,
}: SelectionProps<"data-processing">): ReactElement => {
  const resource = world.dataProcessing[s.collection].find(
    (r) =>
      r.projectId === s.projectId &&
      r.name === s.name &&
      (!("region" in r) || r.region === s.location) &&
      (!("dataset" in r) || r.dataset === s.parent) &&
      (!("cluster" in r) || r.cluster === s.parent) &&
      (!("kind" in r) || r.kind === s.jobKind),
  );
  if (!resource) {
    return <NotFound what="データ処理リソース" />;
  }
  const rows: Row[] = Object.entries(resource).map(([label, value]) => ({
    label,
    value: typeof value === "string" ? value : JSON.stringify(value),
  }));
  const target = s.collection === "tables" ? `${s.parent}.${s.name}` : s.name;
  rows.push(
    ...world.dataProcessing.observations
      .filter((o) => o.projectId === s.projectId && o.resource === target)
      .slice(-5)
      .map((o, i) => ({ label: `result ${i + 1}: ${o.operation}`, value: o.result })),
  );
  return <Section title="データ・処理・接続" rows={rows} />;
};
