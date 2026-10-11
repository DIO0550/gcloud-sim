import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { run, session } from "@/engine/__tests__/setup";
import { Snapshot } from "@/engine/snapshot";
import {
  chooseOption,
  Now,
  renderSimulator,
  resourceTree,
} from "@/features/simulator/__tests__/setup";

test("画面で組織→フォルダ→プロジェクトを作成し、選択・既定プロジェクト・保存に反映する", async () => {
  const user = userEvent.setup();
  const { saved } = renderSimulator();
  await user.click(screen.getByRole("button", { name: "階層にリソースを追加" }));
  await chooseOption(user, "作成する種類", "組織（学習用）");
  await user.type(screen.getByRole("textbox", { name: "名前" }), "learning.example");
  await user.click(screen.getByRole("button", { name: "作成" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(
    within(resourceTree()).getByRole("button", { name: /組織\s*learning\.example/ }),
  ).toBeInTheDocument();
  expect(
    within(screen.getByRole("complementary", { name: "詳細" })).getByText("learning.example"),
  ).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "階層にリソースを追加" }));
  await chooseOption(user, "作成する種類", "フォルダ");
  expect(screen.getByRole("combobox", { name: "作成先" })).toHaveTextContent("learning.example");
  await user.type(screen.getByRole("textbox", { name: "名前" }), 'Study "A"');
  await user.click(screen.getByRole("button", { name: "作成" }));
  expect(
    within(resourceTree()).getByRole("button", { name: /フォルダ\s*Study "A"/ }),
  ).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "learning.example を折りたたむ" }));
  await user.click(screen.getByRole("button", { name: "リソースを作成" }));
  expect(screen.getByRole("combobox", { name: "作成先" })).toHaveTextContent('Study "A"');
  await user.type(screen.getByRole("textbox", { name: "名前" }), "My Project");
  await user.type(screen.getByRole("textbox", { name: "プロジェクト ID" }), "Invalid_ID");
  await user.click(screen.getByRole("button", { name: "作成" }));
  expect(screen.getByRole("alert")).toHaveTextContent("invalid");
  expect(screen.getByRole("textbox", { name: "名前" })).toHaveValue("My Project");
  await user.clear(screen.getByRole("textbox", { name: "プロジェクト ID" }));
  await user.type(screen.getByRole("textbox", { name: "プロジェクト ID" }), "learning-project");
  await user.click(screen.getByRole("button", { name: "作成" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(
    within(resourceTree()).getByRole("button", { name: /PJ\s*learning-project/ }),
  ).toHaveAttribute("aria-current", "true");
  expect(screen.getByRole("combobox", { name: "プロジェクト" })).toHaveTextContent(
    "learning-project",
  );
  await waitFor(() => expect(saved.at(-1)?.projects.at(-1)?.projectId).toBe("learning-project"));
  const world = saved.at(-1);
  expect(world?.projects.at(-1)?.parent.id).toBe(world?.folders.at(-1)?.id);
  expect(world?.folders.at(-1)?.parent.id).toBe(world?.additionalOrganizations[0]?.id);
  expect(world && Snapshot.fromUnknown(Snapshot.create(world, Now)).ok).toBe(true);
});

test("権限不足はフォームに表示し、キャンセルしてもリソースを作らない", async () => {
  const user = userEvent.setup();
  const world = run(session(), "gcloud config set account dev@example.com").world;
  const { saved } = renderSimulator({}, world);
  await user.click(screen.getByRole("button", { name: "リソースを作成" }));
  await chooseOption(user, "作成する種類", "フォルダ");
  await user.type(screen.getByRole("textbox", { name: "名前" }), "forbidden");
  await user.click(screen.getByRole("button", { name: "作成" }));
  expect(screen.getByRole("alert")).toHaveTextContent("resourcemanager.folders.create");
  expect(saved.at(-1)?.folders).toEqual(world.folders);
  await user.click(screen.getByRole("button", { name: "キャンセル" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("Consoleからも作成でき、プロジェクト切り替えを外せば現在の選択を保つ", async () => {
  const user = userEvent.setup();
  const { saved } = renderSimulator();
  await user.click(screen.getByRole("button", { name: "Console" }));
  await user.click(screen.getByRole("button", { name: "リソースを作成" }));
  await user.type(screen.getByRole("textbox", { name: "プロジェクト ID" }), "console-project");
  await user.click(screen.getByRole("checkbox", { name: "作成したプロジェクトに切り替える" }));
  await user.click(screen.getByRole("button", { name: "作成" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "プロジェクト" })).toHaveTextContent("ace-dev-01");
  await waitFor(() =>
    expect(saved.at(-1)?.projects.some((project) => project.projectId === "console-project")).toBe(
      true,
    ),
  );
});
