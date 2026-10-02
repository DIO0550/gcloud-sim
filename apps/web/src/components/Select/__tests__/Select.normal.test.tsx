import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, test, vi } from "vitest";

import { Select } from "@/components/Select";

type Fruit = "apple" | "banana" | "cherry";

const Fruits = [
  { value: "apple", label: "Apple" },
  { value: "banana", label: "Banana" },
  { value: "cherry", label: "Cherry" },
] as const;

const renderSelect = (onChange: (value: Fruit) => void = () => {}): void => {
  const Harness = () => {
    const [value, setValue] = useState<Fruit>("apple");
    return (
      <Select
        ariaLabel="果物"
        value={value}
        options={Fruits}
        onChange={(v) => {
          setValue(v);
          onChange(v);
        }}
      />
    );
  };
  render(<Harness />);
};

test("クリックで一覧が開き、選んだ値が返って一覧が閉じる", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  renderSelect(onChange);
  const combobox = screen.getByRole("combobox", { name: "果物" });
  expect(combobox).toHaveTextContent("Apple");
  expect(combobox).toHaveAttribute("aria-expanded", "false");

  await user.click(combobox);
  expect(screen.getByRole("option", { name: "Apple" })).toHaveAttribute("aria-selected", "true");
  await user.click(screen.getByRole("option", { name: "Cherry" }));

  expect(onChange).toHaveBeenCalledWith("cherry");
  expect(combobox).toHaveTextContent("Cherry");
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});

test("キーボードだけで開いて動かして選べる（↓ で開く、↓ で次、Enter で決定）", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  renderSelect(onChange);
  await user.tab();
  await user.keyboard("{ArrowDown}");
  const combobox = screen.getByRole("combobox", { name: "果物" });
  expect(combobox).toHaveAttribute("aria-expanded", "true");
  await user.keyboard("{ArrowDown}");
  expect(combobox).toHaveAttribute(
    "aria-activedescendant",
    screen.getByRole("option", { name: "Banana" }).id,
  );
  await user.keyboard("{Enter}");
  expect(onChange).toHaveBeenCalledWith("banana");
  expect(combobox).toHaveFocus();
});

test("Escape と外側のクリックでは値を変えずに閉じる", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  renderSelect(onChange);
  const combobox = screen.getByRole("combobox", { name: "果物" });
  await user.click(combobox);
  await user.keyboard("{ArrowDown}{Escape}");
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  await user.click(combobox);
  await user.click(document.body);
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
});

test("閉じたまま文字を打つと、その文字で始まる選択肢に切り替わる", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  renderSelect(onChange);
  await user.tab();
  await user.keyboard("c");
  expect(onChange).toHaveBeenCalledWith("cherry");
});
