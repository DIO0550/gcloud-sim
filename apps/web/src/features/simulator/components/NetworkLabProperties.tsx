import type { ReactElement } from "react";
import { NotFound, type Row, Section, type SelectionProps } from "./PropertyParts";
export const NetworkLabProperties = ({
  world,
  selection: s,
}: SelectionProps<"network-lab">): ReactElement => {
  const resource =
    s.collection === "shared"
      ? world.networkLab.shared.find((r) => r.host === s.name)
      : world.networkLab[s.collection].find(
          (r) =>
            r.projectId === s.projectId &&
            r.name === s.name &&
            r.region === s.region &&
            (!("type" in r) || r.type === s.subtype) &&
            (!("zone" in r) || s.collection !== "records" || r.zone === s.parent),
        );
  if (!resource) {
    return <NotFound what="ネットワーク構成" />;
  }
  const rows: Row[] = Object.entries(resource).map(([label, value]) => ({
    label,
    value: typeof value === "string" ? value : JSON.stringify(value),
  }));
  rows.push(
    ...world.networkLab.checks
      .filter((c) => c.projectId === s.projectId)
      .slice(-3)
      .map((c) => ({
        label: `${c.name} → ${c.destination || c.dns}`,
        value: `${c.allowed ? "接続可能" : "接続不可"}: ${c.reason}`,
      })),
  );
  return <Section title="ネットワーク構成と診断" rows={rows} />;
};
