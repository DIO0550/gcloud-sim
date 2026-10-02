import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, test, vi } from "vitest";

import { TextInput } from "@/components/TextInput";

test("TextInput は打った文字列をそのまま返す", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  const Harness = () => {
    const [value, setValue] = useState("");
    return (
      <TextInput
        ariaLabel="名前"
        value={value}
        onChange={(v) => {
          setValue(v);
          onChange(v);
        }}
      />
    );
  };
  render(<Harness />);
  await user.type(screen.getByRole("textbox", { name: "名前" }), "vm-1");
  expect(onChange).toHaveBeenLastCalledWith("vm-1");
  expect(screen.getByRole("textbox", { name: "名前" })).toHaveValue("vm-1");
});

test("TextInput の invalid は aria-invalid になる", () => {
  render(<TextInput ariaLabel="名前" value="" onChange={() => {}} invalid />);
  expect(screen.getByRole("textbox", { name: "名前" })).toHaveAttribute("aria-invalid", "true");
});
