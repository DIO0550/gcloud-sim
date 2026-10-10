import type { ReactElement } from "react";
import { NotFound, Section, type SelectionProps } from "./PropertyParts";
export const StorageLabProperties = ({
  world,
  selection: s,
}: SelectionProps<"storage-lab">): ReactElement => {
  const resource =
    s.collection === "signed"
      ? world.storageLab.signed.find((r) => r.projectId === s.projectId && r.id === s.name)
      : world.storageLab[s.collection].find(
          (r) =>
            r.projectId === s.projectId &&
            r.name === s.name &&
            (!("location" in r) || r.location === s.location) &&
            (!("kind" in r) || r.kind === s.subtype),
        );
  if (!resource) {
    return <NotFound what="ストレージ構成" />;
  }
  return (
    <Section
      title="ストレージ構成と実行結果"
      rows={Object.entries(resource).map(([label, value]) => ({
        label,
        value: typeof value === "string" ? value : JSON.stringify(value),
      }))}
    />
  );
};
