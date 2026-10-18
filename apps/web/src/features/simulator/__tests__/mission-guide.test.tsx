import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { MissionGuides } from "@/engine/missions/learning-guides";
import { MissionGuideView } from "@/features/simulator/components/MissionGuideView";
import { MissionPanel } from "@/features/simulator/components/MissionPanel";
import { Option } from "@/utils/Option";

const guide = (id: string) => {
  const found = MissionGuides.find(id);
  if (!found) {
    throw new Error(`教材がありません: ${id}`);
  }
  return found;
};

test("設定の作成、値の指定、結果確認を理由と構文説明とともに順番に表示する", () => {
  render(<MissionGuideView guide={guide("m-setup-002")} />);
  expect(screen.getAllByRole("heading", { level: 6 }).map((h) => h.textContent)).toEqual([
    "1. 本番用の設定を作成する",
    "2. プロジェクトとゾーンを設定する",
    "3. 保存された設定を確認する",
  ]);
  expect(screen.getByText(/普段の開発用設定を上書きせず/)).toBeInTheDocument();
  expect(
    screen.getByText(/クラウド上のプロジェクトを新規作成する操作ではありません/),
  ).toBeInTheDocument();
  expect(screen.getByText(/コマンドに--zoneを書くと、そちらが優先/)).toBeInTheDocument();
  expect(
    screen.getByText("gcloud config configurations create prod").closest("code"),
  ).toBeInTheDocument();
  expect(screen.getAllByText("確認する結果")).toHaveLength(3);
  expect(screen.getByText(/coreのprojectがace-prod-01/)).toBeInTheDocument();
});

test("ファイル変更は変更前と変更後を分け、エラー観察は意図を明示する", () => {
  render(<MissionGuideView guide={guide("m-gke-018")} />);
  expect(screen.getAllByText("変更前")).toHaveLength(2);
  expect(screen.getAllByText("変更後")).toHaveLength(2);
  expect(screen.getAllByText("エラーを観察する操作")).toHaveLength(2);
  expect(screen.getByText(/既存Podの環境変数は別途更新が必要/)).toBeInTheDocument();
  expect(screen.getByText("kubectl rollout restart deployment/frozen-web")).toBeInTheDocument();
});

test("ミッション画面はヒント文字列を貼り直さず、専用の学習手順を表示する", () => {
  const original = Engine.missions().find((m) => m.id === "m-setup-002");
  if (!original) {
    throw new Error("対象ミッションがありません");
  }
  render(
    <MissionPanel
      world={Engine.initialWorld("2026-10-18T00:00:00Z")}
      missions={[{ ...original, hints: ["古いヒント本文"] }]}
      selectedId={Option.some(original.id)}
      onSelect={() => {}}
      onStart={() => {}}
      onAbandon={() => {}}
    />,
  );
  expect(screen.queryByText("古いヒント本文")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "1. 本番用の設定を作成する" })).toBeInTheDocument();
  expect(screen.getByText("この演習で押さえること")).toBeInTheDocument();
});
