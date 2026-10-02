import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, test } from "vitest";

import { SuggestInput } from "@/components/SuggestInput";

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
