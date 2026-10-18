import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { renderSimulator, typeLine } from "./setup";

test("Computeの各メニューは共有リソースの一覧へ移動し、端末へコマンドを挿入しない", async () => {
  const user = userEvent.setup();
  const { terminal, saved } = renderSimulator();
  const commands = [
    "gcloud compute instance-templates create console-template",
    "gcloud compute instance-groups managed create console-group --template=console-template --size=1 --zone=us-central1-a",
    "gcloud compute disks create console-disk --size=20GB --zone=us-central1-a",
    "gcloud compute snapshots create console-snapshot --source-disk=console-disk --source-disk-zone=us-central1-a",
    "gcloud compute images create console-image --source-snapshot=console-snapshot",
  ];
  for (const command of commands) {
    await act(async () => typeLine(terminal, command));
  }
  await waitFor(() => expect(saved.at(-1)?.computeLab.images).toHaveLength(1));
  await user.click(screen.getByRole("button", { name: "Console" }));
  const before = [...terminal.written];
  const nav = within(screen.getByRole("navigation", { name: "Console ナビゲーション" }));
  const items = [
    ["インスタンス テンプレート", "console-template"],
    ["インスタンス グループ", "console-group"],
    ["ディスク", "console-disk"],
    ["スナップショット", "console-snapshot"],
    ["イメージ", "console-image"],
    ["オペレーション", "DONE"],
    ["ゾーン", "us-central1-a"],
  ] as const;
  for (const [label, content] of items) {
    const button = nav.getByRole("button", { name: label });
    await user.click(button);
    expect(screen.getByRole("table", { name: label })).toHaveTextContent(content);
    expect(button).toHaveAttribute("aria-current", "page");
    expect(
      nav.getAllByRole("button").filter((b) => b.getAttribute("aria-current") === "page"),
    ).toEqual([button]);
  }
  await user.click(nav.getByRole("button", { name: "VM インスタンス" }));
  expect(screen.getByRole("table", { name: "VM インスタンス" })).toHaveTextContent("console-group");
  expect(terminal.written).toEqual(before);
});
