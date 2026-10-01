import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";

import { renderSimulator, resourceTree, screenText } from "@/features/simulator/__tests__/setup";

const typeLine = async (
  terminal: ReturnType<typeof renderSimulator>["terminal"],
  line: string,
): Promise<void> => {
  await waitFor(() => expect(terminal.written.length).toBeGreaterThan(0));
  terminal.type(`${line}\r`);
};

const openConsole = async (user: ReturnType<typeof userEvent.setup>): Promise<void> => {
  await user.click(screen.getByRole("button", { name: "Console" }));
  expect(screen.getByRole("main", { name: "Console" })).toBeInTheDocument();
};

const consoleNav = () => screen.getByRole("navigation", { name: "Console ナビゲーション" });

/** 左ナビの「VM インスタンス」から一覧の「インスタンスを作成」へ（作成画面はナビ項目ではない: UI 案 s1）。 */
const openVmCreate = async (user: ReturnType<typeof userEvent.setup>): Promise<void> => {
  await user.click(within(consoleNav()).getByRole("button", { name: "VM インスタンス" }));
  await user.click(screen.getByRole("button", { name: "インスタンスを作成" }));
  expect(within(consoleNav()).getByRole("button", { name: "VM インスタンス" })).toHaveAttribute(
    "aria-current",
    "page",
  );
};

test("Console に切り替えて VM 作成を送信すると、一覧に VM が出て端末に # Console: の行と灰色のコマンドが記録される", async () => {
  const user = userEvent.setup();
  const { terminal } = renderSimulator();
  await openConsole(user);
  await openVmCreate(user);
  await user.type(screen.getByLabelText("名前"), "web-2");
  await user.type(screen.getByLabelText("ネットワーク タグ"), "http-server");
  const panel = screen.getByRole("region", { name: "同等のコマンドライン" });
  expect(panel).toHaveTextContent(
    "gcloud compute instances create web-2 --project=ace-dev-01 --zone=asia-northeast1-a --machine-type=e2-small",
  );
  expect(panel).toHaveTextContent("--tags=http-server");
  await user.click(screen.getByRole("button", { name: "作成" }));
  const table = await screen.findByRole("table", { name: "VM インスタンス" });
  expect(within(table).getByText("web-2")).toBeInTheDocument();
  expect(within(table).getByRole("img", { name: "RUNNING" })).toBeInTheDocument();
  await waitFor(() =>
    expect(screenText(terminal)).toContain("# Console: インスタンスを作成 (web-2)"),
  );
  expect(screenText(terminal)).toContain(
    "$ gcloud compute instances create web-2 --project=ace-dev-01",
  );
  expect(screenText(terminal)).toContain(
    "Created [https://www.googleapis.com/compute/v1/projects/ace-dev-01/zones/asia-northeast1-a/instances/web-2].",
  );
});

test("Console で作った VM は CLI の list にも見える（同じ World を同じ経路で更新している）", async () => {
  const user = userEvent.setup();
  const { terminal } = renderSimulator();
  await openConsole(user);
  await openVmCreate(user);
  await user.type(screen.getByLabelText("名前"), "web-3");
  await user.click(screen.getByRole("button", { name: "作成" }));
  await screen.findByRole("table", { name: "VM インスタンス" });
  await user.click(screen.getByRole("button", { name: "CLI" }));
  await typeLine(terminal, "gcloud compute instances list");
  await waitFor(() => expect(screenText(terminal)).toMatch(/web-3\s+asia-northeast1-a\s+e2-small/));
});

test("名前の形式が悪いと項目の直下にエラーが出て送信されない", async () => {
  const user = userEvent.setup();
  const { terminal } = renderSimulator();
  await openConsole(user);
  await openVmCreate(user);
  await user.type(screen.getByLabelText("名前"), "Web_2");
  await user.click(screen.getByRole("button", { name: "作成" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Invalid value for field 'resource.name'");
  expect(screen.queryByRole("table", { name: "VM インスタンス" })).not.toBeInTheDocument();
  expect(screenText(terminal)).not.toContain("# Console:");
});

test("サービスアカウントの作成フォームは送信すると一覧に増える", async () => {
  const user = userEvent.setup();
  renderSimulator();
  await openConsole(user);
  await user.click(within(consoleNav()).getByRole("button", { name: "サービスアカウント" }));
  await user.click(screen.getByRole("button", { name: "サービスアカウントを作成" }));
  await user.type(screen.getByLabelText("サービスアカウント ID"), "batch-sa");
  await user.click(screen.getByRole("button", { name: "作成" }));
  const table = await screen.findByRole("table", { name: "サービスアカウント" });
  expect(
    within(table).getByText("batch-sa@ace-dev-01.iam.gserviceaccount.com"),
  ).toBeInTheDocument();
});

test("dev@example.com で VM 作成を送ると赤帯に Required ... permission が出る", async () => {
  const user = userEvent.setup();
  const { terminal } = renderSimulator();
  await typeLine(terminal, "gcloud auth login dev@example.com");
  await waitFor(() =>
    expect(screenText(terminal)).toContain("You are now logged in as [dev@example.com]."),
  );
  await openConsole(user);
  await openVmCreate(user);
  await user.type(screen.getByLabelText("名前"), "web-2");
  await user.click(screen.getByRole("button", { name: "作成" }));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(
    "Required 'compute.instances.create' permission for 'projects/ace-dev-01'",
  );
  expect(screen.getByLabelText("名前")).toHaveValue("web-2");
});

test("API が無効なプロジェクトの VM 一覧は「API を有効にする」だけを出し、押すと services enable が流れる", async () => {
  const user = userEvent.setup();
  const { terminal } = renderSimulator();
  await user.selectOptions(screen.getByRole("combobox", { name: "プロジェクト" }), "ace-prod-01");
  await openConsole(user);
  await user.click(within(consoleNav()).getByRole("button", { name: "VM インスタンス" }));
  await user.click(screen.getByRole("button", { name: "Compute Engine API を有効にする" }));
  await waitFor(() =>
    expect(screenText(terminal)).toContain(
      "$ gcloud services enable compute.googleapis.com --project=ace-prod-01",
    ),
  );
  expect(screenText(terminal)).toContain("Billing must be enabled");
  expect(
    screen.getByRole("button", { name: "Compute Engine API を有効にする" }),
  ).toBeInTheDocument();
});

test("IAM 画面でアクセス権を付与すると継承元付きの表に出て、継承された行には削除が無い", async () => {
  const user = userEvent.setup();
  const { terminal } = renderSimulator();
  await openConsole(user);
  await user.click(within(consoleNav()).getByRole("button", { name: "IAM" }));
  await user.click(screen.getByRole("button", { name: "アクセス権を付与" }));
  await user.type(screen.getByLabelText("新しいプリンシパル"), "user:alice@example.com");
  await user.clear(screen.getByLabelText("ロール"));
  await user.type(screen.getByLabelText("ロール"), "roles/compute.viewer");
  await user.click(screen.getByRole("button", { name: "保存" }));
  const table = await screen.findByRole("table", { name: "IAM ポリシー" });
  await waitFor(() =>
    expect(within(table).getByText("user:alice@example.com")).toBeInTheDocument(),
  );
  const aliceRow = within(table).getByText("user:alice@example.com").closest("tr") as HTMLElement;
  expect(within(aliceRow).getByRole("button", { name: "削除" })).toBeInTheDocument();
  const ownerRow = within(table).getByText("user:owner@example.com").closest("tr") as HTMLElement;
  expect(within(ownerRow).getByText("組織 example.com")).toBeInTheDocument();
  expect(within(ownerRow).queryByRole("button", { name: "削除" })).not.toBeInTheDocument();
  expect(screenText(terminal)).toContain(
    "$ gcloud projects add-iam-policy-binding ace-dev-01 --member=user:alice@example.com --role=roles/compute.viewer",
  );
  await user.click(within(aliceRow).getByRole("button", { name: "削除" }));
  await waitFor(() =>
    expect(within(table).queryByText("user:alice@example.com")).not.toBeInTheDocument(),
  );
});

test("VM 一覧で選んで停止すると状態が TERMINATED になり、削除は確認してから --quiet で流れる", async () => {
  const user = userEvent.setup();
  const { terminal } = renderSimulator();
  await typeLine(terminal, "gcloud compute instances create batch-1 --zone=asia-northeast1-b");
  await waitFor(() => expect(screenText(terminal)).toContain("Created ["));
  await openConsole(user);
  await user.click(within(consoleNav()).getByRole("button", { name: "VM インスタンス" }));
  await user.click(screen.getByRole("radio", { name: "batch-1 を選択" }));
  await user.click(screen.getByRole("button", { name: "停止" }));
  const table = screen.getByRole("table", { name: "VM インスタンス" });
  await waitFor(() =>
    expect(within(table).getByRole("img", { name: "TERMINATED" })).toBeInTheDocument(),
  );
  expect(screenText(terminal)).toContain("# Console: 停止 (batch-1)");
  await user.click(screen.getByRole("radio", { name: "batch-1 を選択" }));
  await user.click(screen.getByRole("button", { name: "削除" }));
  await waitFor(() => expect(within(table).queryByText("batch-1")).not.toBeInTheDocument());
  expect(screenText(terminal)).toContain(
    "$ gcloud compute instances delete batch-1 --zone=asia-northeast1-b --project=ace-dev-01 --quiet",
  );
  expect(screenText(terminal)).not.toContain("Do you want to continue");
});

test("ファイアウォール・バケット・予算の作成も同じ経路で流れて一覧に出る", async () => {
  const user = userEvent.setup();
  const { terminal } = renderSimulator();
  await openConsole(user);
  await user.click(within(consoleNav()).getByRole("button", { name: "ファイアウォール" }));
  await user.click(screen.getByRole("button", { name: "ファイアウォール ルールを作成" }));
  await user.type(screen.getByLabelText("名前"), "allow-http");
  await user.type(screen.getByLabelText("ターゲットタグ"), "http-server");
  await user.click(screen.getByRole("button", { name: "作成" }));
  await waitFor(() =>
    expect(
      within(screen.getByRole("table", { name: "ファイアウォール ルール" })).getByText(
        "allow-http",
      ),
    ).toBeInTheDocument(),
  );
  await user.click(within(consoleNav()).getByRole("button", { name: "バケット" }));
  await user.click(screen.getByRole("button", { name: "作成" }));
  await user.type(screen.getByLabelText("名前"), "ace-dev-01-logs");
  await user.click(screen.getAllByRole("button", { name: "作成" })[1] as HTMLElement);
  await waitFor(() =>
    expect(
      within(screen.getByRole("table", { name: "バケット" })).getByText("ace-dev-01-logs"),
    ).toBeInTheDocument(),
  );
  await user.click(within(consoleNav()).getByRole("button", { name: "予算とアラート" }));
  await user.click(screen.getByRole("button", { name: "予算を作成" }));
  await user.type(screen.getByLabelText("名前"), "Dev budget");
  await user.click(screen.getByRole("button", { name: "作成" }));
  await waitFor(() =>
    expect(
      within(screen.getByRole("table", { name: "予算" })).getByText("Dev budget"),
    ).toBeInTheDocument(),
  );
  expect(screenText(terminal)).toContain(
    '$ gcloud billing budgets create --billing-account=01AB2C-DEF345-6789AB --display-name="Dev budget"',
  );
});

test("同等のコマンドラインの「コピー」はクリップボードへ、「ターミナルに貼り付け」は入力行へ入る", async () => {
  const user = userEvent.setup();
  const { terminal, copied } = renderSimulator();
  await openConsole(user);
  await openVmCreate(user);
  await user.type(screen.getByLabelText("名前"), "web-2");
  await user.click(screen.getByRole("button", { name: "コピー" }));
  expect(copied[0]).toContain("gcloud compute instances create web-2");
  await user.click(screen.getByRole("button", { name: "ターミナルに貼り付け" }));
  await waitFor(() =>
    expect(terminal.written.at(-1)).toContain("gcloud compute instances create web-2"),
  );
});

test("Console に切り替えても端末は消えず、CLI に戻ると同じ端末が続く", async () => {
  const user = userEvent.setup();
  const { terminal } = renderSimulator();
  await typeLine(terminal, "gcloud config set compute/zone asia-northeast1-b");
  await waitFor(() => expect(screenText(terminal)).toContain("Updated property [compute/zone]."));
  const before = terminal.written.length;
  await openConsole(user);
  await user.click(screen.getByRole("button", { name: "CLI" }));
  expect(resourceTree()).toBeInTheDocument();
  expect(terminal.written.length).toBe(before);
});
