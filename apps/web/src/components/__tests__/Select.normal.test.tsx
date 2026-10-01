import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, test, vi } from "vitest";

import { Select } from "@/components/Select";
import { SuggestInput } from "@/components/SuggestInput";

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

const Roles = [
  { value: "roles/viewer", description: "閲覧者" },
  { value: "roles/editor", description: "編集者" },
  { value: "roles/compute.viewer", description: "Compute 閲覧者" },
];

const renderSuggest = (): void => {
  const Harness = () => {
    const [value, setValue] = useState("");
    return (
      <>
        <label htmlFor="role">ロール</label>
        <SuggestInput
          id="role"
          className=""
          value={value}
          suggestions={Roles}
          onChange={setValue}
        />
      </>
    );
  };
  render(<Harness />);
};

test("打った文字を値か説明に含む候補だけを出し、クリックで入る", async () => {
  const user = userEvent.setup();
  renderSuggest();
  const input = screen.getByLabelText("ロール");
  await user.type(input, "viewer");
  expect(screen.getAllByRole("option")).toHaveLength(2);
  await user.click(screen.getByRole("option", { name: /roles\/compute\.viewer/ }));
  expect(input).toHaveValue("roles/compute.viewer");
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});

test("候補に無い値もそのまま打てて、↓ と Enter で候補を選べる", async () => {
  const user = userEvent.setup();
  renderSuggest();
  const input = screen.getByLabelText("ロール");
  await user.type(input, "projects/p/roles/custom");
  expect(input).toHaveValue("projects/p/roles/custom");
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

  await user.clear(input);
  await user.type(input, "編集");
  await user.keyboard("{ArrowDown}{Enter}");
  expect(input).toHaveValue("roles/editor");
});
