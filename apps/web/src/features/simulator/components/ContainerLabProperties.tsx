import type { ReactElement } from "react";
import { releaseCleanupComplete } from "@/engine/domains/container-lab/release";
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
  if (selection.collection === "releases") {
    const evidence = world.containerLab.releases.find((r) => r.id === selection.id);
    if (!evidence) {
      return <NotFound what="公開検証の履歴" />;
    }

    return (
      <>
        <Section
          title="公開検証の履歴"
          rows={[
            { label: "教材", value: evidence.id },
            { label: "イメージ", value: evidence.digest },
            { label: "ローカル検証", value: evidence.localValidatedAt },
            { label: "GKE検証", value: evidence.deploymentValidatedAt || "未検証" },
            { label: "片付け", value: releaseCleanupComplete(world) ? "完了" : "未完了" },
          ]}
        />
        <p className="text-muted text-sm">
          検証済みの履歴は片付け後も保持します。教材の状態確認であり、実通信・コード実行・課金は行いません。
        </p>
      </>
    );
  }

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
