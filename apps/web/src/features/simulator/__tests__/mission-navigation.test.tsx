import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { Mission, MissionDomains } from "@/engine/missions";
import { renderSimulator } from "@/features/simulator/__tests__/setup";

test("カテゴリ→ミッション→手順だけを表示し、戻っても挑戦とヒントを保持する", async () => {
  const user = userEvent.setup();
  renderSimulator();
  await user.click(screen.getByRole("tab", { name: /ミッション/ }));
  await user.selectOptions(screen.getByRole("combobox", { name: "ミッション分類" }), "practice");
  const categories = screen.getByRole("region", { name: "ミッションカテゴリ" });
  expect(within(categories).getAllByRole("button")).toHaveLength(5);
  expect(screen.queryByRole("button", { name: /本番用の configuration/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /環境セットアップ/ }));
  expect(screen.queryByRole("button", { name: /Cloud Buildで/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /本番用の configuration/ }));
  expect(
    screen.queryByRole("button", { name: /ace-prod-01 で Compute Engine/ }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "手順・ヒント" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "開始" }));
  await user.click(screen.getByRole("button", { name: /ヒント（0\/2）/ }));
  await user.click(screen.getByRole("button", { name: "一覧へ戻る" }));
  expect(screen.queryByText(/gcloud config configurations create prod/)).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /本番用の configuration.*挑戦中/ }));
  expect(screen.getByText(/gcloud config configurations create prod/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /ヒント（1\/2）/ })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "カテゴリへ" }));
  expect(screen.getByRole("button", { name: /環境セットアップ.*1件 挑戦中/ })).toBeInTheDocument();
});

test("全ミッションがカテゴリから選択できる", async () => {
  const user = userEvent.setup();
  renderSimulator();
  await user.click(screen.getByRole("tab", { name: /ミッション/ }));
  await user.selectOptions(screen.getByRole("combobox", { name: "ミッション分類" }), "practice");
  for (const domain of Object.values(MissionDomains)) {
    await user.click(screen.getByRole("button", { name: new RegExp(domain) }));
    const list = screen.getByRole("region", { name: domain });
    const buttons = within(list).getAllByRole("button");
    for (const mission of Mission.all().filter((m) => m.domain === domain)) {
      expect(buttons.filter((b) => b.textContent?.includes(mission.title))).toHaveLength(1);
    }
    await user.click(screen.getByRole("button", { name: "カテゴリへ" }));
  }
});

test("試験ガイド4セクションと操作カテゴリは進捗を共有し、状態で絞り込める", async () => {
  const user = userEvent.setup();
  renderSimulator();
  await user.click(screen.getByRole("tab", { name: /ミッション/ }));
  expect(
    within(screen.getByRole("region", { name: "ミッションカテゴリ" })).getAllByRole("button"),
  ).toHaveLength(4);
  await user.click(screen.getByRole("button", { name: /2\. クラウド ソリューションの計画と実装/ }));
  await user.click(screen.getByRole("button", { name: /OSと独自ドライバを制御するAI基盤/ }));
  await user.click(screen.getByRole("button", { name: "開始" }));
  await user.click(screen.getByRole("button", { name: "一覧へ戻る" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "ミッション進捗" }), "in_progress");
  expect(screen.getByRole("button", { name: /OSと独自ドライバ.*挑戦中/ })).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /管理された学習ジョブを選ぶ/ }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "カテゴリへ" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "ミッション分類" }), "practice");
  expect(screen.getByRole("button", { name: /計画と構成.*1件 挑戦中/ })).toBeInTheDocument();
});
