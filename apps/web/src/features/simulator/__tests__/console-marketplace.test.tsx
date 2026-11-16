import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";

import { chooseOption, renderSimulator } from "@/features/simulator/__tests__/setup";

const consoleNav = () => screen.getByRole("navigation", { name: "Console ナビゲーション" });

test("Marketplace で LAMP を検索し、規約に同意して API を有効にし、e2-medium でデプロイできる", async () => {
  const user = userEvent.setup();
  renderSimulator();
  await user.click(screen.getByRole("button", { name: "Console" }));
  await user.click(within(consoleNav()).getByRole("button", { name: "すべてのプロダクト" }));
  await user.click(within(consoleNav()).getByRole("button", { name: "プロダクトを検索" }));

  await user.type(screen.getByRole("textbox", { name: "Marketplace を検索" }), "LAMP{Enter}");
  const results = screen.getByRole("list", { name: "検索結果" });
  expect(within(results).getAllByRole("listitem")).toHaveLength(3);
  expect(results).not.toHaveTextContent("WordPress");

  await user.click(within(results).getByRole("button", { name: /LAMP Stack on Debian/ }));
  expect(screen.queryByRole("button", { name: "使ってみる" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "検索結果に戻る" }));

  await user.click(screen.getByRole("button", { name: /LAMP Stack Server on Ubuntu/ }));
  expect(screen.getByRole("table", { name: "構成" })).toHaveTextContent("phpMyAdmin");
  await user.click(screen.getByRole("button", { name: "使ってみる" }));

  const agree = screen.getByRole("button", { name: "同意する" });
  expect(agree).toBeDisabled();
  await user.click(screen.getByRole("checkbox", { name: "利用規約への同意" }));
  await user.click(agree);
  const dialog = screen.getByRole("dialog", { name: "利用規約に同意しました" });
  await user.click(within(dialog).getByRole("button", { name: "デプロイ" }));

  const apis = screen.getByRole("region", { name: "必要な API" });
  expect(apis).toHaveTextContent("Infrastructure Manager API");
  expect(apis).not.toHaveTextContent("Compute Engine API");
  await user.click(within(apis).getByRole("button", { name: "有効にする" }));

  await waitFor(() => expect(screen.getByLabelText("デプロイ名")).toHaveValue("lamp-1"));
  await chooseOption(user, "ゾーン", "asia-northeast1-b");
  await chooseOption(user, "マシンタイプ", "e2-medium（Efficient Instance, 2 vCPUs, 4 GB RAM）");
  const command = screen.getByRole("region", { name: "同等のコマンドライン" });
  expect(command).toHaveTextContent(
    "gcloud infra-manager deployments apply projects/ace-dev-01/locations/asia-northeast1/deployments/lamp-1",
  );
  expect(command).toHaveTextContent("zone=asia-northeast1-b,machine_type=e2-medium");
  await user.click(screen.getByRole("button", { name: "デプロイ" }));

  const deployed = await screen.findByRole("region", { name: "デプロイ lamp-1" });
  expect(within(deployed).getByRole("status")).toHaveTextContent("lamp-1 をデプロイしました");
  expect(deployed).toHaveTextContent(/サイトのアドレスhttp:\/\/34\.84\.\d+\.\d+\//);
  expect(deployed).toHaveTextContent("e2-medium");
  await user.click(within(deployed).getByRole("button", { name: "lamp-1-vm" }));
  expect(screen.getByRole("table", { name: "VM インスタンス" })).toHaveTextContent("lamp-1-vm");
});

test("ソリューションのデプロイから削除すると、VM も一緒に消える", async () => {
  const user = userEvent.setup();
  const { terminal } = renderSimulator();
  await waitFor(() => expect(terminal.written.length).toBeGreaterThan(0));
  terminal.type("gcloud services enable config.googleapis.com\r");
  terminal.type(
    "gcloud infra-manager deployments apply lamp-1 --location=asia-northeast1 --service-account=projects/ace-dev-01/serviceAccounts/481200000001-compute@developer.gserviceaccount.com --gcs-source=gs://gcloud-sim-marketplace/lamp-stack-ubuntu/blueprint.tar.gz --input-values=zone=asia-northeast1-a\r",
  );
  await user.click(screen.getByRole("button", { name: "Console" }));
  await user.click(within(consoleNav()).getByRole("button", { name: "すべてのプロダクト" }));
  await user.click(within(consoleNav()).getByRole("button", { name: "ソリューションのデプロイ" }));
  const deployed = await screen.findByRole("region", { name: "デプロイ lamp-1" });
  await user.click(within(deployed).getByRole("button", { name: "lamp-1 を削除" }));
  await waitFor(() =>
    expect(screen.queryByRole("region", { name: "デプロイ lamp-1" })).not.toBeInTheDocument(),
  );
  expect(screen.getByText(/デプロイしたソリューションはまだありません/)).toBeInTheDocument();
});
