import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { renderSimulator, screenText } from "@/features/simulator/__tests__/setup";

test("画面でテンプレートを読み込み・編集・保存し、CLIへ独自コマンドを送らない", async () => {
  const user = userEvent.setup();
  const state = renderSimulator();
  await user.click(screen.getByRole("tab", { name: "ファイル" }));
  await user.click(screen.getByRole("button", { name: "テンプレートを読み込む" }));
  const content = screen.getByRole("textbox", { name: "設定ファイルの内容" });
  expect((content as HTMLTextAreaElement).value).toContain("google_compute_network");
  await user.clear(content);
  await user.type(content, "# edited configuration");
  await user.click(screen.getByRole("button", { name: "ファイルを保存" }));
  await waitFor(() =>
    expect(state.saved.at(-1)?.terraform.files["main.tf"]).toBe("# edited configuration"),
  );
  expect(screenText(state.terminal)).not.toMatch(/\bsim files\b/);
  await user.click(screen.getByRole("button", { name: "テンプレートを読み込む" }));
  expect(screen.getByRole("alert")).toHaveTextContent("同名のファイルがあります");
  expect(content).toHaveValue("# edited configuration");
  await user.clear(screen.getByRole("textbox", { name: "設定ファイル名" }));
  await user.type(screen.getByRole("textbox", { name: "設定ファイル名" }), "../main.tf");
  await user.click(screen.getByRole("button", { name: "ファイルを保存" }));
  expect(screen.getByRole("alert")).toHaveTextContent("相対パス");
  expect(content).toHaveValue("# edited configuration");
});
