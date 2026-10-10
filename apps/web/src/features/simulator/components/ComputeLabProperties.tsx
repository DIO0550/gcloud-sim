import type { ReactElement } from "react";
import { diskData } from "@/engine/domains/compute-lab/model";
import { NotFound, type Row, Section, type SelectionProps } from "./PropertyParts";

export const ComputeLabProperties = ({
  world,
  selection: s,
}: SelectionProps<"compute-lab">): ReactElement => {
  const r = world.computeLab[s.collection].find(
    (r) =>
      r.projectId === s.projectId &&
      r.name === s.name &&
      (!("location" in r) || r.location === s.location),
  );
  if (!r) {
    return <NotFound what="Compute構成" />;
  }
  const rows: Row[] = Object.entries(r).map(([label, value]) => ({
    label,
    value: typeof value === "string" ? value : JSON.stringify(value),
  }));
  if (s.collection === "disks") {
    rows.push({ label: "仮想ディスクデータ", value: diskData(world, s) });
  }
  rows.push(
    ...world.computeLab.observations
      .filter((o) => o.projectId === s.projectId && o.name === s.name && o.location === s.location)
      .slice(-3)
      .map((o) => ({ label: o.operation, value: o.result })),
  );
  return <Section title="VM構成・復旧・段階更新" rows={rows} />;
};
