import { act, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { ElementSize } from "@/libs/element-size";
import { renderSimulator, resourceTree, typeLine } from "./setup";

afterEach(() => vi.restoreAllMocks());

test("左端のボタンでCLIの階層を開閉し、幅と入力履歴を保持する", async () => {
  const user = userEvent.setup();
  const { terminal } = renderSimulator();
  const toggle = screen.getByRole("button", { name: "CLI ナビゲーションを切り替え" });
  expect(toggle.closest("header")?.firstElementChild).toBe(toggle);
  const tree = resourceTree();
  const left = screen.getByRole("separator", { name: "左サイドバーの幅" });
  left.focus();
  await user.keyboard("{ArrowRight}");
  await act(async () => typeLine(terminal, "gcloud config list"));
  const before = [...terminal.written];

  await user.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(tree).not.toBeVisible();
  expect(screen.queryByRole("separator", { name: "左サイドバーの幅" })).not.toBeInTheDocument();
  expect(screen.getByTestId("simulator-layout").style.getPropertyValue("--cli-left-width")).toBe(
    "0px",
  );
  expect(screen.getByRole("separator", { name: "右サイドバーの幅" })).toBeInTheDocument();

  await user.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(resourceTree()).toBe(tree);
  expect(screen.getByRole("separator", { name: "左サイドバーの幅" })).toHaveAttribute(
    "aria-valuenow",
    "296",
  );
  expect(terminal.written).toEqual(before);
  await user.click(screen.getByRole("button", { name: "Console" }));
  const consoleToggle = screen.getByRole("button", { name: "Console ナビゲーションを切り替え" });
  expect(consoleToggle).toBe(toggle);
  expect(consoleToggle.closest("header")?.firstElementChild).toBe(toggle);
});

/** jsdomが持たない、ブラウザのpointer capture境界を置き換える。 */
const capture = (element: HTMLElement): void => {
  let captured: number | undefined;
  element.setPointerCapture = vi.fn((id: number) => {
    captured = id;
  });
  element.hasPointerCapture = (id) => captured === id;
  element.releasePointerCapture = vi.fn(() => {
    captured = undefined;
  });
};
const drag = async (
  user: ReturnType<typeof userEvent.setup>,
  element: HTMLElement,
  from: number,
  to: number,
): Promise<void> => {
  capture(element);
  await user.pointer([
    { target: element, keys: "[MouseLeft>]", coords: { clientX: from } },
    { target: element, coords: { clientX: to } },
    { target: element, keys: "[/MouseLeft]" },
  ]);
};

test("左右の境界をドラッグし、最大幅とリセットを適用できる", async () => {
  const user = userEvent.setup();
  renderSimulator();
  const left = screen.getByRole("separator", { name: "左サイドバーの幅" });
  const right = screen.getByRole("separator", { name: "右サイドバーの幅" });
  await drag(user, left, 280, 360);
  await drag(user, right, 1024, 944);
  expect(left).toHaveAttribute("aria-valuenow", "360");
  expect(right).toHaveAttribute("aria-valuenow", "496");
  expect(screen.getByTestId("simulator-layout").style.getPropertyValue("--cli-left-width")).toBe(
    "360px",
  );
  expect(screen.getByTestId("simulator-layout").style.getPropertyValue("--cli-right-width")).toBe(
    "496px",
  );
  await drag(user, left, 360, 2000);
  expect(left).toHaveAttribute("aria-valuenow", left.getAttribute("aria-valuemax"));
  await user.dblClick(left);
  expect(left).toHaveAttribute("aria-valuenow", "280");
  expect(document.body.style.userSelect).toBe("");
  expect(document.body.style.cursor).toBe("");
});

test("表示切り替えの位置と各ペインの幅を切り替え後も保持する", async () => {
  const user = userEvent.setup();
  renderSimulator();
  const switcher = screen.getByTestId("view-switcher");
  const left = screen.getByRole("separator", { name: "左サイドバーの幅" });
  left.focus();
  await user.keyboard("{ArrowRight}");
  expect(left).toHaveAttribute("aria-valuenow", "296");
  await user.click(screen.getByRole("button", { name: "Console" }));
  expect(screen.getByTestId("view-switcher")).toBe(switcher);
  const navigation = screen.getByRole("separator", { name: "コンソールの左サイドバーの幅" });
  await drag(user, navigation, 232, 312);
  await user.click(screen.getByRole("button", { name: "Console ナビゲーションを切り替え" }));
  expect(
    screen.queryByRole("separator", { name: "コンソールの左サイドバーの幅" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Console ナビゲーションを切り替え" }));
  expect(screen.getByRole("separator", { name: "コンソールの左サイドバーの幅" })).toHaveAttribute(
    "aria-valuenow",
    "312",
  );
  await user.click(screen.getByRole("button", { name: "CLI" }));
  expect(screen.getByTestId("view-switcher")).toBe(switcher);
  expect(screen.getByRole("separator", { name: "左サイドバーの幅" })).toHaveAttribute(
    "aria-valuenow",
    "296",
  );
});

test("画面を狭めても中央に320pxを残し、広げると指定幅に戻る", async () => {
  const observers: { element: Element; changed: () => void }[] = [];
  vi.spyOn(ElementSize, "observe").mockImplementation((element, changed) => {
    observers.push({ element, changed });
    return () => {};
  });
  const user = userEvent.setup();
  renderSimulator();
  const left = screen.getByRole("separator", { name: "左サイドバーの幅" });
  const right = screen.getByRole("separator", { name: "右サイドバーの幅" });
  left.focus();
  await user.keyboard("{End}");
  right.focus();
  await user.keyboard("{End}");
  const layout = screen.getByTestId("simulator-layout");
  const observer = observers.find((o) => o.element === layout);
  if (!observer) {
    throw new Error("レイアウトの監視が見つかりません");
  }
  let width = 1024;
  vi.spyOn(layout, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, 0, width, 900));
  act(observer.changed);
  const combined =
    Number(left.getAttribute("aria-valuenow")) + Number(right.getAttribute("aria-valuenow"));
  expect(width - combined).toBeGreaterThanOrEqual(320);
  width = 1440;
  act(observer.changed);
  expect(left).toHaveAttribute("aria-valuenow", "520");
  expect(right).toHaveAttribute("aria-valuenow", "600");
  right.focus();
  await user.keyboard("{Home}");
  expect(right).toHaveAttribute("aria-valuenow", "280");
});

test("ドラッグ中の表示切り替えやpointer cancelで選択禁止を解除する", async () => {
  const user = userEvent.setup();
  renderSimulator();
  const left = screen.getByRole("separator", { name: "左サイドバーの幅" });
  capture(left);
  await user.pointer({ target: left, keys: "[MouseLeft>]", coords: { clientX: 280 } });
  expect(document.body.style.userSelect).toBe("none");
  const event = new Event("pointercancel", { bubbles: true });
  Object.defineProperty(event, "pointerId", { value: 1 });
  fireEvent(left, event);
  expect(document.body.style.userSelect).toBe("");
  await user.pointer({ target: left, keys: "[/MouseLeft]" });
  await user.pointer({ target: left, keys: "[MouseLeft>]", coords: { clientX: 280 } });
  await user.click(screen.getByRole("button", { name: "Console" }));
  expect(document.body.style.userSelect).toBe("");
  expect(document.body.style.cursor).toBe("");
});
