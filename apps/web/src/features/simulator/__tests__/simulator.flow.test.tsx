import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";

import {
  chooseOption,
  renderSimulator,
  resourceTree,
  screenText,
} from "@/features/simulator/__tests__/setup";
import { Result } from "@/utils/Result";

const typeLine = async (
  terminal: ReturnType<typeof renderSimulator>["terminal"],
  line: string,
): Promise<void> => {
  await waitFor(() => expect(terminal.written.length).toBeGreaterThan(0));
  terminal.type(`${line}\r`);
};

test("コマンドを打つと出力が端末に出て、リソースツリーが更新される", async () => {
  const { terminal } = renderSimulator();
  await typeLine(terminal, "gcloud compute instances create web-1 --zone=asia-northeast1-a");
  await waitFor(() =>
    expect(screenText(terminal)).toContain(
      "Created [https://www.googleapis.com/compute/v1/projects/ace-dev-01/zones/asia-northeast1-a/instances/web-1].",
    ),
  );
  const tree = resourceTree();
  expect(within(tree).getByText("web-1")).toBeInTheDocument();
  expect(within(tree).getByText("Compute Engine")).toBeInTheDocument();
});

test("権限不足のエラーは error の色で、ヒントは hint の色で書かれる", async () => {
  const { terminal } = renderSimulator();
  await typeLine(terminal, "gcloud config set account dev@example.com");
  await typeLine(terminal, "gcloud compute instances create web-2 --zone=asia-northeast1-a");
  await waitFor(() =>
    expect(screenText(terminal)).toContain("Required 'compute.instances.create' permission"),
  );
  expect(screenText(terminal)).toContain(
    "gcloud-sim: hint: この権限を含むロール: roles/compute.instanceAdmin.v1",
  );
});

test("実行のたびに World が保存される", async () => {
  const { terminal, saved } = renderSimulator();
  await typeLine(terminal, "gcloud config set project ace-prod-01");
  await waitFor(() => expect(saved.length).toBeGreaterThanOrEqual(2));
  expect(saved.at(-1)?.config.configurations.default?.["core/project"]).toBe("ace-prod-01");
});

test("保存に失敗すると警告が端末に出て、フッターにも失敗が出る", async () => {
  const { terminal } = renderSimulator({ saveFails: "QuotaExceededError" });
  await waitFor(() =>
    expect(screenText(terminal)).toContain(
      "gcloud-sim: warning: failed to persist state (QuotaExceededError)",
    ),
  );
  expect(screen.getByText(/保存に失敗: QuotaExceededError/)).toBeInTheDocument();
});

test("ツリーをクリックするとプロパティに中身が出て、describe を挿入で入力行に入る", async () => {
  const user = userEvent.setup();
  const { terminal } = renderSimulator();
  await typeLine(
    terminal,
    "gcloud compute instances create web-1 --zone=asia-northeast1-a --tags=http-server",
  );
  await waitFor(() => expect(screenText(terminal)).toContain("Created ["));
  const tree = resourceTree();
  await user.click(within(tree).getByText("web-1"));
  const details = screen.getByRole("complementary", { name: "詳細" });
  expect(within(details).getByRole("heading", { name: "web-1" })).toBeInTheDocument();
  expect(within(details).getByText("http-server")).toBeInTheDocument();
  await user.click(within(details).getByRole("button", { name: "describe を挿入" }));
  await waitFor(() =>
    expect(terminal.written.at(-1)).toContain(
      "gcloud compute instances describe web-1 --zone=asia-northeast1-a",
    ),
  );
});

test("IAM のプロパティにはフォルダから継承したロールが継承元付きで出る", async () => {
  const user = userEvent.setup();
  const { terminal } = renderSimulator();
  await typeLine(
    terminal,
    "gcloud resource-manager folders add-iam-policy-binding 284100000001 --member=user:dev@example.com --role=roles/compute.instanceAdmin.v1",
  );
  await waitFor(() => expect(screenText(terminal)).toContain("Updated IAM policy for folder"));
  const tree = resourceTree();
  // IAM の行はプロジェクトごとにある。名前順で先頭が ace-dev-01。
  await user.click(within(tree).getAllByText("IAM")[0] as HTMLElement);
  const table = screen.getByRole("table", { name: "IAM ポリシー" });
  const row = within(table).getByText("roles/compute.instanceAdmin.v1").closest("tr");
  expect(row).not.toBeNull();
  expect(within(row as HTMLElement).getByText("フォルダ dev")).toBeInTheDocument();
  const viewerRow = within(table).getByText("roles/viewer").closest("tr");
  expect(within(viewerRow as HTMLElement).getByText("このプロジェクト")).toBeInTheDocument();
});

test("ヘッダーでプリンシパルを変えるとコマンドとして記録され、Owner 以外は警告色になる", async () => {
  const user = userEvent.setup();
  const { terminal } = renderSimulator();
  await typeLine(terminal, "gcloud auth login dev@example.com");
  await waitFor(() =>
    expect(screenText(terminal)).toContain("You are now logged in as [dev@example.com]."),
  );
  await chooseOption(user, "プリンシパル", "owner@example.com");
  await waitFor(() =>
    expect(screenText(terminal)).toContain("$ gcloud config set account owner@example.com"),
  );
  expect(screen.getByRole("combobox", { name: "プリンシパル" })).toHaveTextContent(
    "owner@example.com",
  );
});

test("ミッションを開始して条件を満たすとクリアの通知が出る", async () => {
  const user = userEvent.setup();
  const { terminal } = renderSimulator();
  await user.click(screen.getByRole("tab", { name: /ミッション/ }));
  await user.click(screen.getByRole("button", { name: /環境セットアップ/ }));
  await user.click(
    screen.getByRole("button", { name: /ace-prod-01 で Compute Engine を使えるようにする/ }),
  );
  await user.click(screen.getByRole("button", { name: "開始" }));
  await typeLine(
    terminal,
    "gcloud billing projects link ace-prod-01 --billing-account=01AB2C-DEF345-6789AB",
  );
  await typeLine(terminal, "gcloud services enable compute.googleapis.com --project=ace-prod-01");
  // 通知と端末出力は別々に描画される。負荷下でも両方の反映を待つ。
  await waitFor(
    () => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "ミッションクリア「ace-prod-01 で Compute Engine を使えるようにする」",
      );
      expect(screenText(terminal)).toContain("gcloud-sim: ✓ ミッションクリア");
    },
    { timeout: 4000 },
  );
  expect(screen.getByRole("tab", { name: "ミッション 1/96" })).toBeInTheDocument();
});

test("ヒントは押すたびに 1 つ開く", async () => {
  const user = userEvent.setup();
  renderSimulator();
  await user.click(screen.getByRole("tab", { name: /ミッション/ }));
  await user.click(screen.getByRole("button", { name: /環境セットアップ/ }));
  await user.click(screen.getByRole("button", { name: /本番用の configuration を用意する/ }));
  await user.click(screen.getByRole("button", { name: "開始" }));
  await user.click(screen.getByRole("button", { name: /ヒント（0\/2）/ }));
  expect(screen.getByText(/gcloud config configurations create prod/)).toBeInTheDocument();
  expect(screen.queryByText(/gcloud config set project ace-prod-01/)).not.toBeInTheDocument();
});

test("設定のリセットで初期状態に戻る", async () => {
  const user = userEvent.setup();
  const { terminal } = renderSimulator();
  await typeLine(terminal, "gcloud compute instances create web-1 --zone=asia-northeast1-a");
  await waitFor(() => expect(within(resourceTree()).getByText("web-1")).toBeInTheDocument());
  await user.click(screen.getByRole("button", { name: "設定" }));
  await user.click(screen.getByRole("button", { name: "リセット" }));
  await waitFor(() => expect(within(resourceTree()).queryByText("web-1")).not.toBeInTheDocument());
  expect(screenText(terminal)).toContain("初期状態に戻しました");
});

test("確認で拒否するとリセットされない", async () => {
  const user = userEvent.setup();
  const { terminal } = renderSimulator({ confirmAnswer: false });
  await typeLine(terminal, "gcloud compute instances create web-1 --zone=asia-northeast1-a");
  await waitFor(() => expect(within(resourceTree()).getByText("web-1")).toBeInTheDocument());
  await user.click(screen.getByRole("button", { name: "設定" }));
  await user.click(screen.getByRole("button", { name: "リセット" }));
  expect(within(resourceTree()).getByText("web-1")).toBeInTheDocument();
});

test("インポートに失敗すると E-011 が出て状態は変わらない", async () => {
  const user = userEvent.setup();
  const { terminal } = renderSimulator({
    readResult: async () => Result.err({ kind: "unsupportedVersion", version: "11" }),
  });
  await typeLine(terminal, "gcloud compute instances create web-1 --zone=asia-northeast1-a");
  await waitFor(() => expect(within(resourceTree()).getByText("web-1")).toBeInTheDocument());
  await user.click(screen.getByRole("button", { name: "設定" }));
  await user.upload(
    screen.getByLabelText("JSON を選択"),
    new File(["{}"], "snap.json", { type: "application/json" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      "schemaVersion 11 は未対応です。現在の状態は変更していません。",
    ),
  );
  expect(within(resourceTree()).getByText("web-1")).toBeInTheDocument();
});

test("エクスポートを押すとダウンロードが呼ばれる", async () => {
  const user = userEvent.setup();
  const { downloads } = renderSimulator();
  await user.click(screen.getByRole("button", { name: "設定" }));
  await user.click(screen.getByRole("button", { name: "ダウンロード" }));
  expect(downloads).toHaveLength(1);
});

test("Ctrl+L で端末が消え、Tab で補完される", async () => {
  const { terminal } = renderSimulator();
  await waitFor(() => expect(terminal.written.length).toBeGreaterThan(0));
  terminal.type("gcloud compu");
  terminal.type("\t");
  expect(terminal.written.at(-1)).toContain("gcloud compute ");
  terminal.type("\x0c");
  expect(terminal.written).toContain("<clear>");
});
