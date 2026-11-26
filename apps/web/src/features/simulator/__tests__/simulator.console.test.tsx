import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";

import {
  chooseOption,
  renderSimulator,
  resourceTree,
  screenText,
  typeLine,
} from "@/features/simulator/__tests__/setup";

const openConsole = async (user: ReturnType<typeof userEvent.setup>): Promise<void> => {
  await user.click(screen.getByRole("button", { name: "Console" }));
  expect(screen.getByRole("main", { name: "Console" })).toBeInTheDocument();
};

const consoleNav = () => screen.getByRole("navigation", { name: "Console ナビゲーション" });

/** Compute の専用ナビから別のプロダクトへ移る場合は、全プロダクト一覧を開く。 */
const navigateConsole = async (
  user: ReturnType<typeof userEvent.setup>,
  name: string,
): Promise<void> => {
  const nav = within(consoleNav());
  if (nav.queryByRole("button", { name }) === null) {
    await user.click(nav.getByRole("button", { name: "すべてのプロダクト" }));
  }
  await user.click(within(consoleNav()).getByRole("button", { name }));
};

/** VM 一覧から専用の作成ページ（UI 案 2c）へ。 */
const openVmCreate = async (user: ReturnType<typeof userEvent.setup>): Promise<void> => {
  await navigateConsole(user, "VM インスタンス");
  await user.click(screen.getByRole("button", { name: "インスタンスを作成" }));
  expect(screen.getByRole("navigation", { name: "VM 作成の設定" })).toBeInTheDocument();
};

test("ヘッダーの検索は候補を確定して画面を切り替え、閉じた左ナビも再度開ける", async () => {
  const user = userEvent.setup();
  renderSimulator();
  await openConsole(user);
  const search = screen.getByRole("combobox", { name: "プロダクト、画面を検索" });
  await user.type(search, "IAM");
  expect(screen.getByRole("table", { name: "VM インスタンス" })).toBeInTheDocument();
  await user.keyboard("{ArrowDown}{Enter}");
  expect(screen.getByRole("table", { name: "IAM ポリシー" })).toBeInTheDocument();
  const toggle = screen.getByRole("button", { name: "Console ナビゲーションを切り替え" });
  await user.click(toggle);
  expect(
    screen.queryByRole("navigation", { name: "Console ナビゲーション" }),
  ).not.toBeInTheDocument();
  await user.click(toggle);
  expect(consoleNav()).toBeInTheDocument();
});

test("IAM は選択するまで詳細を開かず、フィルタと継承の表示を切り替えられる", async () => {
  const user = userEvent.setup();
  renderSimulator();
  await openConsole(user);
  await navigateConsole(user, "IAM");
  expect(screen.queryByRole("region", { name: /に効いているロール$/ })).not.toBeInTheDocument();
  await user.type(screen.getByRole("textbox", { name: "フィルタ" }), "owner@example.com");
  const table = screen.getByRole("table", { name: "IAM ポリシー" });
  expect(table).toHaveTextContent("owner@example.com");
  expect(table).not.toHaveTextContent("dev@example.com");
  await user.click(screen.getByRole("checkbox", { name: "継承されたロールを表示" }));
  expect(table).not.toHaveTextContent("owner@example.com");
  await user.clear(screen.getByRole("textbox", { name: "フィルタ" }));
  expect(table).toHaveTextContent("dev@example.com");
  await user.click(screen.getByRole("checkbox", { name: "dev@example.com を選択" }));
  expect(
    screen.getByRole("region", { name: "dev@example.com に効いているロール" }),
  ).toBeInTheDocument();
});

test("Console の Cloud Shell は閉じて再度開いても履歴を保ち、CLI と同じ端末を使う", async () => {
  const user = userEvent.setup();
  const { terminal } = renderSimulator();
  await typeLine(terminal, "gcloud config list");
  await openConsole(user);
  await user.click(screen.getByRole("button", { name: ">_ Cloud Shell" }));
  const before = [...terminal.written];
  await user.click(screen.getByRole("button", { name: "Cloud Shell を拡大" }));
  await user.click(screen.getByRole("button", { name: "Cloud Shell を元のサイズに戻す" }));
  await user.click(screen.getByRole("button", { name: "Cloud Shell を閉じる" }));
  await user.click(screen.getByRole("button", { name: ">_ Cloud Shell" }));
  await user.click(screen.getByRole("button", { name: "CLI" }));
  expect(terminal.written).toEqual(before);
  await typeLine(terminal, "gcloud config get-value project");
  await waitFor(() => expect(screenText(terminal)).toContain("ace-dev-01"));
});

test("Console に切り替えて VM 作成を送信すると、一覧に VM が出て端末に # Console: の行と灰色のコマンドが記録される", async () => {
  const user = userEvent.setup();
  const { terminal } = renderSimulator();
  await openConsole(user);
  await openVmCreate(user);
  await user.type(screen.getByLabelText("名前"), "web-2");
  await user.click(screen.getByRole("button", { name: /ネットワーキング/ }));
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
  expect(screen.getByRole("alert")).toHaveTextContent(
    "小文字英字で始め、小文字・数字・ハイフンのみ使用できます",
  );
  expect(screen.getByRole("button", { name: "作成" })).toBeDisabled();
  expect(screen.queryByRole("table", { name: "VM インスタンス" })).not.toBeInTheDocument();
  expect(screenText(terminal)).not.toContain("# Console:");
});

test("サービスアカウントの作成フォームは送信すると一覧に増える", async () => {
  const user = userEvent.setup();
  renderSimulator();
  await openConsole(user);
  await navigateConsole(user, "サービスアカウント");
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
  await chooseOption(user, "プロジェクト", "ace-prod-01");
  await openConsole(user);
  await navigateConsole(user, "VM インスタンス");
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

test("IAM 画面でアクセス権を付与すると継承元付きの表に出て、継承だけの人には削除が無い", async () => {
  const user = userEvent.setup();
  const { terminal } = renderSimulator();
  await openConsole(user);
  await navigateConsole(user, "IAM");
  await user.click(screen.getByRole("button", { name: "アクセス権を付与" }));
  await user.type(screen.getByLabelText("新しいプリンシパル"), "user:alice@example.com");
  await user.clear(screen.getByLabelText("ロール"));
  await user.type(screen.getByLabelText("ロール"), "roles/compute.viewer");
  await user.click(screen.getByRole("button", { name: "保存" }));
  const table = await screen.findByRole("table", { name: "IAM ポリシー" });
  await waitFor(() => expect(within(table).getByText("alice@example.com")).toBeInTheDocument());
  const aliceRow = within(table).getByText("alice@example.com").closest("tr") as HTMLElement;
  expect(within(aliceRow).getByText("Compute 閲覧者")).toBeInTheDocument();
  expect(within(aliceRow).getByText("このプロジェクト")).toBeInTheDocument();
  const ownerRow = within(table).getByText("owner@example.com").closest("tr") as HTMLElement;
  expect(within(ownerRow).getByText("組織 example.com")).toBeInTheDocument();
  expect(screenText(terminal)).toContain(
    "$ gcloud projects add-iam-policy-binding ace-dev-01 --member=user:alice@example.com --role=roles/compute.viewer",
  );
  // 継承だけの人を選ぶと、削除の代わりに継承元のポリシーを変えるコマンドが出る。
  await user.click(within(ownerRow).getByRole("button", { name: "owner@example.com を編集" }));
  const changes = screen.getByRole("region", { name: "ロールの変更" });
  expect(within(changes).queryByRole("button", { name: "削除" })).not.toBeInTheDocument();
  expect(changes).toHaveTextContent("gcloud organizations");
  await user.click(within(aliceRow).getByRole("button", { name: "alice@example.com を編集" }));
  await user.click(within(changes).getByRole("button", { name: "削除" }));
  await waitFor(() =>
    expect(within(table).queryByText("alice@example.com")).not.toBeInTheDocument(),
  );
});

test("VM 一覧で選んで停止すると状態が TERMINATED になり、削除は確認してから --quiet で流れる", async () => {
  const user = userEvent.setup();
  const { terminal } = renderSimulator();
  await typeLine(terminal, "gcloud compute instances create batch-1 --zone=asia-northeast1-b");
  await waitFor(() => expect(screenText(terminal)).toContain("Created ["));
  await openConsole(user);
  await navigateConsole(user, "VM インスタンス");
  await user.click(screen.getByRole("checkbox", { name: "batch-1 を選択" }));
  await user.click(screen.getByRole("button", { name: "停止" }));
  const table = screen.getByRole("table", { name: "VM インスタンス" });
  await waitFor(() =>
    expect(within(table).getByRole("img", { name: "TERMINATED" })).toBeInTheDocument(),
  );
  expect(screenText(terminal)).toContain("# Console: 停止 (batch-1)");
  // 選んだままなので、停止した VM にはそのまま削除を出せる。
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
  await navigateConsole(user, "ファイアウォール");
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
  await navigateConsole(user, "バケット");
  await user.click(screen.getByRole("button", { name: "作成" }));
  await user.type(screen.getByLabelText("名前"), "ace-dev-01-logs");
  await user.click(screen.getAllByRole("button", { name: "作成" })[1] as HTMLElement);
  await waitFor(() =>
    expect(
      within(screen.getByRole("table", { name: "バケット" })).getByText("ace-dev-01-logs"),
    ).toBeInTheDocument(),
  );
  await navigateConsole(user, "予算とアラート");
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

test("Console で作ったファイアウォール・バケット・予算は行の「削除」で確認してから --quiet で消える", async () => {
  const user = userEvent.setup();
  const { terminal } = renderSimulator();
  await typeLine(
    terminal,
    "gcloud compute firewall-rules create allow-http --network=default --allow=tcp:80",
  );
  await typeLine(terminal, "gcloud storage buckets create gs://ace-dev-01-logs");
  await typeLine(terminal, "gcloud storage cp report.csv gs://ace-dev-01-logs/");
  await waitFor(() => expect(screenText(terminal)).toContain("Copying file://report.csv"));
  await openConsole(user);
  await navigateConsole(user, "ファイアウォール");
  const rules = screen.getByRole("table", { name: "ファイアウォール ルール" });
  await user.click(within(rules).getByRole("button", { name: "allow-http を削除" }));
  await waitFor(() => expect(within(rules).queryByText("allow-http")).not.toBeInTheDocument());
  expect(screenText(terminal)).toContain(
    "$ gcloud compute firewall-rules delete allow-http --project=ace-dev-01 --quiet",
  );
  // 中身のあるバケットはオブジェクトごと消す（本物の Console と同じ）。
  await navigateConsole(user, "バケット");
  const buckets = screen.getByRole("table", { name: "バケット" });
  await user.click(within(buckets).getByRole("button", { name: "ace-dev-01-logs を削除" }));
  await waitFor(() =>
    expect(within(buckets).queryByText("ace-dev-01-logs")).not.toBeInTheDocument(),
  );
  expect(screenText(terminal)).toContain(
    "$ gcloud storage rm --recursive gs://ace-dev-01-logs --project=ace-dev-01 --quiet",
  );
  await navigateConsole(user, "予算とアラート");
  await user.click(screen.getByRole("button", { name: "予算を作成" }));
  await user.type(screen.getByLabelText("名前"), "Dev budget");
  await user.click(screen.getByRole("button", { name: "作成" }));
  const budgets = screen.getByRole("table", { name: "予算" });
  await waitFor(() => expect(within(budgets).getByText("Dev budget")).toBeInTheDocument());
  await user.click(within(budgets).getByRole("button", { name: "Dev budget を削除" }));
  await waitFor(() => expect(within(budgets).queryByText("Dev budget")).not.toBeInTheDocument());
  expect(screenText(terminal)).not.toContain("Do you want to continue");
});

test("サービスアカウントとカスタムロールも一覧から消せ、事前定義ロールには削除が無い", async () => {
  const user = userEvent.setup();
  const { terminal } = renderSimulator();
  await typeLine(terminal, "gcloud iam service-accounts create batch-runner");
  await typeLine(
    terminal,
    "gcloud iam roles create vmReader --project=ace-dev-01 --permissions=compute.instances.get",
  );
  await waitFor(() => expect(screenText(terminal)).toContain("Created role [vmReader]."));
  await openConsole(user);
  await navigateConsole(user, "サービスアカウント");
  const accounts = screen.getByRole("table", { name: "サービスアカウント" });
  const email = "batch-runner@ace-dev-01.iam.gserviceaccount.com";
  await user.click(within(accounts).getByRole("button", { name: `${email} を削除` }));
  await waitFor(() => expect(within(accounts).queryByText(email)).not.toBeInTheDocument());
  await navigateConsole(user, "ロール");
  const roles = screen.getByRole("table", { name: "ロール" });
  expect(within(roles).queryByRole("button", { name: "roles/viewer を削除" })).toBeNull();
  await user.click(
    within(roles).getByRole("button", { name: "projects/ace-dev-01/roles/vmReader を削除" }),
  );
  await waitFor(() =>
    expect(within(roles).queryByText("projects/ace-dev-01/roles/vmReader")).not.toBeInTheDocument(),
  );
  expect(screenText(terminal)).toContain(
    "$ gcloud iam roles delete vmReader --project=ace-dev-01 --quiet",
  );
});

test("確認ダイアログでキャンセルすると削除しない", async () => {
  const user = userEvent.setup();
  const { terminal } = renderSimulator({ confirmAnswer: false });
  await typeLine(terminal, "gcloud storage buckets create gs://ace-dev-01-keep");
  await waitFor(() => expect(screenText(terminal)).toContain("Creating gs://ace-dev-01-keep/"));
  await openConsole(user);
  await navigateConsole(user, "バケット");
  const buckets = screen.getByRole("table", { name: "バケット" });
  await user.click(within(buckets).getByRole("button", { name: "ace-dev-01-keep を削除" }));
  expect(within(buckets).getByText("ace-dev-01-keep")).toBeInTheDocument();
  expect(screenText(terminal)).not.toContain("buckets delete");
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

test("作成ページの設定ナビと開閉では入力が残り、戻る操作で VM 一覧に戻る", async () => {
  const user = userEvent.setup();
  renderSimulator();
  await openConsole(user);
  await openVmCreate(user);
  await user.type(screen.getByLabelText("名前"), "web-sections");
  await user.click(screen.getByRole("button", { name: /ネットワーキング/ }));
  await user.type(screen.getByLabelText("ネットワーク タグ"), "http-server");
  await user.click(screen.getByRole("button", { name: /OS とストレージ/ }));
  await user.clear(screen.getByLabelText("サイズ"));
  await user.type(screen.getByLabelText("サイズ"), "20GB");
  await user.click(screen.getByRole("button", { name: /マシンの構成/ }));
  expect(screen.queryByLabelText("ネットワーク タグ")).not.toBeInTheDocument();
  const command = screen.getByRole("region", { name: "同等のコマンドライン" });
  expect(command).toHaveTextContent("--tags=http-server");
  expect(command).toHaveTextContent("--boot-disk-size=20GB");
  await user.click(screen.getByRole("button", { name: "Console ナビゲーションを切り替え" }));
  expect(screen.queryByRole("navigation", { name: "VM 作成の設定" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("名前")).toHaveValue("web-sections");
  expect(screen.getByRole("region", { name: "同等のコマンドライン" })).toHaveTextContent(
    "web-sections",
  );
  await user.click(screen.getByRole("button", { name: "VM インスタンスに戻る" }));
  expect(screen.getByRole("table", { name: "VM インスタンス" })).toBeInTheDocument();
});

test("送信を試みる前は空の名前にもエラーを出さず、送信を試みると出る", async () => {
  const user = userEvent.setup();
  renderSimulator();
  await openConsole(user);
  await navigateConsole(user, "ファイアウォール");
  await user.click(screen.getByRole("button", { name: "ファイアウォール ルールを作成" }));
  expect(screen.queryAllByRole("alert")).toHaveLength(0);
  await user.click(screen.getByRole("button", { name: "作成" }));
  expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
});

test("キャンセルで作成フォームが閉じる", async () => {
  const user = userEvent.setup();
  renderSimulator();
  await openConsole(user);
  await navigateConsole(user, "バケット");
  await user.click(screen.getByRole("button", { name: "作成" }));
  expect(screen.getByLabelText("名前")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "キャンセル" }));
  expect(screen.queryByLabelText("名前")).not.toBeInTheDocument();
});

test.each([
  ["クラスタ", "Kubernetes Engine API を有効にする"],
  ["サービス", "Cloud Run Admin API を有効にする"],
  ["ファイアウォール", "Compute Engine API を有効にする"],
])("API が無効なプロジェクトで %s を開くと「%s」だけが出る", async (item, button) => {
  const user = userEvent.setup();
  renderSimulator();
  await chooseOption(user, "プロジェクト", "ace-prod-01");
  await openConsole(user);
  await navigateConsole(user, item);
  expect(screen.getByRole("button", { name: button })).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});

test("コピーに失敗すると端末に理由付きの警告が出る", async () => {
  const user = userEvent.setup();
  const { terminal, copied } = renderSimulator({ copyFails: "NotAllowedError" });
  await openConsole(user);
  await openVmCreate(user);
  await user.click(screen.getByRole("button", { name: "コピー" }));
  await waitFor(() => expect(screenText(terminal)).toContain("NotAllowedError"));
  expect(copied).toEqual([]);
});

test("VPC ネットワークの作成はネットワーク・サブネット・選んだルールを順に流し、VM はそのサブネットを選べる", async () => {
  const user = userEvent.setup();
  const { terminal } = renderSimulator();
  await openConsole(user);
  await navigateConsole(user, "VPC ネットワーク");
  await user.click(screen.getByRole("button", { name: "VPC ネットワークを作成" }));
  await user.type(screen.getByLabelText("名前"), "managementnet");
  await chooseOption(user, "サブネット作成モード", "カスタム");
  await user.type(screen.getByLabelText("サブネットの名前"), "managementsubnet-us");
  await user.type(screen.getByLabelText("IPv4 範囲"), "10.130.0.0/20");
  await user.click(screen.getByRole("checkbox", { name: /managementnet-allow-ssh/ }));
  await user.click(screen.getByRole("button", { name: "作成" }));
  await waitFor(() =>
    expect(
      within(screen.getByRole("table", { name: "VPC ネットワーク" })).getByText("managementnet"),
    ).toBeInTheDocument(),
  );
  const text = screenText(terminal);
  expect(text).toContain(
    "$ gcloud compute networks create managementnet --project=ace-dev-01 --subnet-mode=custom",
  );
  expect(text).toContain(
    "$ gcloud compute networks subnets create managementsubnet-us --project=ace-dev-01 --network=managementnet --region=us-central1 --range=10.130.0.0/20",
  );
  expect(text).toContain(
    "$ gcloud compute firewall-rules create managementnet-allow-ssh --project=ace-dev-01 --network=managementnet --direction=INGRESS --priority=65534 --allow=tcp:22 --source-ranges=0.0.0.0/0",
  );
  await openVmCreate(user);
  await user.type(screen.getByLabelText("名前"), "mgmt-vm");
  await chooseOption(user, "リージョン", "us-central1（アイオワ）");
  await user.click(screen.getByRole("button", { name: /ネットワーキング/ }));
  await chooseOption(user, "ネットワーク", "managementnet");
  expect(screen.getByRole("combobox", { name: "サブネットワーク" })).toHaveTextContent(
    "managementsubnet-us",
  );
  await user.click(screen.getByRole("button", { name: "作成" }));
  await waitFor(() =>
    expect(screenText(terminal)).toContain("--network=managementnet --subnet=managementsubnet-us"),
  );
});

test("GKE クラスタ（Autopilot / Standard）と Cloud Run サービスを GUI から作成できる", async () => {
  const user = userEvent.setup();
  const { terminal } = renderSimulator();
  await typeLine(terminal, "gcloud services enable container.googleapis.com run.googleapis.com");
  await waitFor(() => expect(screenText(terminal)).toContain("finished successfully"));

  await openConsole(user);
  await navigateConsole(user, "クラスタ");
  await user.click(screen.getByRole("button", { name: "＋ クラスタを作成" }));
  await user.type(screen.getByLabelText("名前"), "auto-gke");
  await user.click(screen.getByRole("button", { name: "作成" }));
  const clusterTable = await screen.findByRole("table", { name: "クラスタ" });
  expect(within(clusterTable).getByText("auto-gke")).toBeInTheDocument();
  expect(within(clusterTable).getByText("Autopilot")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "＋ クラスタを作成" }));
  await user.click(screen.getByRole("radio", { name: /GKE Standard/ }));
  await user.type(screen.getByLabelText("名前"), "std-gke");
  await user.click(screen.getByRole("button", { name: "作成" }));
  expect(await within(clusterTable).findByText("std-gke")).toBeInTheDocument();
  expect(within(clusterTable).getByText("Standard")).toBeInTheDocument();

  await user.click(within(clusterTable).getByRole("button", { name: "std-gke に接続" }));
  await waitFor(() =>
    expect(screenText(terminal)).toContain("gcloud container clusters get-credentials std-gke"),
  );

  await navigateConsole(user, "サービス");
  await user.click(screen.getByRole("button", { name: "＋ サービスを作成" }));
  await user.type(screen.getByLabelText("サービス名"), "hello-run");
  await user.click(screen.getByRole("button", { name: "作成" }));
  const runTable = await screen.findByRole("table", { name: "Cloud Run サービス" });
  expect(within(runTable).getByText("hello-run")).toBeInTheDocument();
});

test("ディスク・スナップショット・カスタムイメージを GUI から順に作成できる", async () => {
  const user = userEvent.setup();
  renderSimulator();
  await openConsole(user);

  await navigateConsole(user, "ディスク");
  await user.click(screen.getByRole("button", { name: "＋ ディスクを作成" }));
  await user.type(screen.getByLabelText("名前"), "data-disk-gui");
  await user.click(screen.getByRole("button", { name: "作成" }));
  const diskTable = await screen.findByRole("table", { name: "ディスク" });
  expect(within(diskTable).getByText("data-disk-gui")).toBeInTheDocument();

  await navigateConsole(user, "スナップショット");
  await user.click(screen.getByRole("button", { name: "＋ スナップショットを作成" }));
  await user.type(screen.getByLabelText("名前"), "snap-gui");
  await user.click(screen.getByRole("button", { name: "作成" }));
  const snapTable = await screen.findByRole("table", { name: "スナップショット" });
  expect(within(snapTable).getByText("snap-gui")).toBeInTheDocument();

  await navigateConsole(user, "イメージ");
  await user.click(screen.getByRole("button", { name: "＋ イメージを作成" }));
  await user.type(screen.getByLabelText("名前"), "img-gui");
  await user.click(screen.getByRole("button", { name: "作成" }));
  const imageTable = await screen.findByRole("table", { name: "イメージ" });
  expect(within(imageTable).getByText("img-gui")).toBeInTheDocument();
});

test("インスタンス テンプレート作成専用ページで HTTP タグ・起動スクリプト・メタデータを設定して作成できる", async () => {
  const user = userEvent.setup();
  const { terminal } = renderSimulator();
  await openConsole(user);

  await navigateConsole(user, "インスタンス テンプレート");
  await user.click(screen.getByRole("button", { name: "＋ インスタンス テンプレートを作成" }));
  expect(
    screen.getByRole("navigation", { name: "インスタンス テンプレート作成の設定" }),
  ).toBeInTheDocument();

  await user.type(screen.getByLabelText("名前"), "web-tpl-v1");
  await user.click(screen.getByRole("button", { name: /ネットワーキング/ }));
  await user.click(screen.getByRole("checkbox", { name: /HTTP トラフィックを許可する/ }));
  await user.click(screen.getByRole("button", { name: /管理・詳細設定/ }));
  await user.click(screen.getByRole("button", { name: "サンプルを入力" }));
  await user.click(screen.getByRole("button", { name: "＋ 項目を追加" }));
  await user.type(screen.getByLabelText("メタデータ キー 1"), "env");
  await user.type(screen.getByLabelText("メタデータ 値 1"), "prod");

  const panel = screen.getByRole("region", { name: "同等のコマンドライン" });
  expect(panel).toHaveTextContent("gcloud compute instance-templates create web-tpl-v1");
  expect(panel).toHaveTextContent("--tags=http-server");
  expect(panel).toHaveTextContent("startup-script=");
  expect(panel).toHaveTextContent("env=prod");

  await user.click(screen.getByRole("button", { name: "作成" }));
  const table = await screen.findByRole("table", { name: "インスタンス テンプレート" });
  expect(within(table).getByText("web-tpl-v1")).toBeInTheDocument();
  expect(within(table).getByText("http-server")).toBeInTheDocument();
  await waitFor(() =>
    expect(screenText(terminal)).toContain("$ gcloud compute instance-templates create web-tpl-v1"),
  );
});

test("Cloud Shell からエディタを開いてファイルを保存でき、端末の履歴も失われない", async () => {
  const user = userEvent.setup();
  const { terminal } = renderSimulator();
  await typeLine(terminal, "gcloud config get-value project");
  await waitFor(() => expect(screenText(terminal)).toContain("ace-dev-01"));

  await openConsole(user);
  await user.click(screen.getByRole("button", { name: ">_ Cloud Shell" }));
  const before = [...terminal.written];

  await user.click(screen.getByRole("button", { name: "エディタを開く" }));
  const editor = screen.getByRole("complementary", { name: "Cloud Shell エディタ" });
  expect(editor).toBeInTheDocument();

  const fileNameInput = within(editor).getByRole("textbox", { name: "設定ファイル名" });
  await user.clear(fileNameInput);
  await user.type(fileNameInput, "package.json");
  const contentInput = within(editor).getByRole("textbox", { name: "設定ファイルの内容" });
  await user.clear(contentInput);
  await user.type(contentInput, '{{"name":"helloworld"}}');
  await user.click(within(editor).getByRole("button", { name: "ファイルを保存" }));
  expect(within(editor).getByRole("status")).toHaveTextContent("保存しました。");

  await user.click(screen.getByRole("button", { name: "エディタを閉じる" }));
  expect(
    screen.queryByRole("complementary", { name: "Cloud Shell エディタ" }),
  ).not.toBeInTheDocument();
  expect(terminal.written).toEqual(before);
});

test("Cloud Shell のウェブでプレビューはポート 8080 のコンテナ起動状態に応じて 502 と 200 OK を切り替える", async () => {
  const user = userEvent.setup();
  const { terminal } = renderSimulator();

  await openConsole(user);
  await user.click(screen.getByRole("button", { name: ">_ Cloud Shell" }));
  await user.click(screen.getByRole("button", { name: "ウェブでプレビュー" }));
  await user.click(screen.getByRole("menuitem", { name: /ポート 8080 でプレビュー/ }));

  const dialogBefore = screen.getByRole("dialog", { name: "ウェブでプレビュー" });
  expect(dialogBefore).toHaveTextContent("502 Bad Gateway");
  expect(dialogBefore).toHaveTextContent("ポート 8080 に接続できませんでした");
  await user.click(within(dialogBefore).getByRole("button", { name: "閉じる" }));

  await typeLine(terminal, "docker build -t hello:v1 ./hello-web");
  await waitFor(() => expect(screenText(terminal)).toContain("Built hello:v1"));
  await typeLine(terminal, "docker run -d --name helloworld -p 8080:8080 hello:v1");
  await waitFor(() => expect(screenText(terminal)).toContain("Simulated container started"));

  await user.click(screen.getByRole("button", { name: "ウェブでプレビュー" }));
  const menuItem = screen.getByRole("menuitem", { name: /ポート 8080 でプレビュー/ });
  expect(menuItem).toHaveTextContent("実行中");
  await user.click(menuItem);

  const dialogAfter = screen.getByRole("dialog", { name: "ウェブでプレビュー" });
  expect(dialogAfter).toHaveTextContent("200 OK");
  expect(dialogAfter).toHaveTextContent("Hello World!");
  expect(dialogAfter).toHaveTextContent("helloworld");
  expect(dialogAfter).toHaveTextContent("8080 → 8080");
});

test("検索からネットワーク サービスを開いて固定し、Cloud NAT と新しい Cloud Router を構成できる", async () => {
  const user = userEvent.setup();
  const { terminal } = renderSimulator();

  // privatenet VPC を用意する
  await typeLine(terminal, "gcloud compute networks create privatenet --subnet-mode=custom");
  await waitFor(() => expect(screenText(terminal)).toContain("privatenet"));

  await openConsole(user);

  // タイトルバーの検索から「ネットワーク サービス」を選ぶ
  const search = screen.getByRole("combobox", { name: "プロダクト、画面を検索" });
  await user.type(search, "ネットワーク サービス");
  await user.click(
    screen.getByRole("option", { name: /ネットワーク サービス.*プロダクトとページ/ }),
  );

  // ネットワーク サービスの横にある固定アイコンをクリックする
  const pinButton = within(consoleNav()).getByRole("button", {
    name: "ネットワーク サービス を固定",
  });
  await user.click(pinButton);
  expect(
    within(consoleNav()).getByRole("button", { name: "ネットワーク サービス の固定を解除" }),
  ).toHaveAttribute("aria-pressed", "true");

  // 左ナビの「Cloud NAT」をクリックし、「開始」から NAT ゲートウェイを構成する
  await user.click(within(consoleNav()).getByRole("button", { name: "Cloud NAT" }));
  await user.click(screen.getByRole("button", { name: "開始" }));

  const natForm = screen.getByRole("region", { name: "Cloud NAT ゲートウェイの作成" });
  await user.type(within(natForm).getByLabelText("ゲートウェイの名前"), "nat-config");
  await chooseOption(user, "ネットワーク", "privatenet");
  await chooseOption(user, "リージョン", "us-central1");

  // Cloud Router で「新しいルーターを作成」を選び、nat-router を作成する
  await chooseOption(user, "Cloud Router", "新しいルーターを作成");
  const routerPanel = within(natForm).getByRole("region", { name: "ルーターの作成" });
  await user.type(within(routerPanel).getByLabelText("名前"), "nat-router");
  await user.click(within(routerPanel).getByRole("button", { name: "作成" }));

  // ルーター作成パネルが閉じて nat-router が自動選択される
  await waitFor(() =>
    expect(
      within(natForm).queryByRole("region", { name: "ルーターの作成" }),
    ).not.toBeInTheDocument(),
  );
  expect(within(natForm).getByLabelText("Cloud Router")).toHaveTextContent("nat-router");

  // Cloud NAT ゲートウェイを作成する
  await user.click(within(natForm).getByRole("button", { name: "作成" }));

  const table = screen.getByRole("table", { name: "Cloud NAT ゲートウェイ" });
  expect(table).toHaveTextContent("nat-config");
  expect(table).toHaveTextContent("privatenet");
  expect(table).toHaveTextContent("us-central1");
  expect(table).toHaveTextContent("nat-router");
  expect(table).toHaveTextContent("すべてのサブネット");

  // Cloud Router 画面でも作成された nat-router を確認できる
  await user.click(within(consoleNav()).getByRole("button", { name: "Cloud Router" }));
  const routerTable = screen.getByRole("table", { name: "Cloud Router" });
  expect(routerTable).toHaveTextContent("nat-router");
  expect(routerTable).toHaveTextContent("privatenet");
  expect(routerTable).toHaveTextContent("us-central1");
});
