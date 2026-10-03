import type { ReactElement } from "react";
import {
  IamSection,
  NotFound,
  Section,
  type SelectionProps,
} from "@/features/simulator/components/PropertyParts";

export const ContainerLabProperties = ({
  world,
  selection,
}: SelectionProps<"container-lab">): ReactElement => {
  const item = world.containerLab[selection.collection].find((i) => i.id === selection.id);
  if (!item) return <NotFound what="コンテナ教材のリソース" />;
  return (
    <>
      <Section
        title="設定"
        rows={Object.entries(item)
          .filter(([key]) => key !== "iamPolicy")
          .map(([label, value]) => ({
            label,
            value: typeof value === "object" ? JSON.stringify(value) : String(value),
          }))}
      />
      {selection.collection === "repositories" && (
        <>
          <Section
            title="保存したイメージ"
            rows={world.containerLab.registryImages
              .filter((i) => i.repositoryId === selection.id)
              .map((i) => ({
                label: `${i.name}: ${i.tags.join(", ") || "タグなし"}`,
                value: i.digest,
              }))}
          />
          <IamSection world={world} target={{ type: "artifact-repository", id: selection.id }} />
        </>
      )}
    </>
  );
};
