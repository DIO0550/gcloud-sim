import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import { Switch } from "@/components/Switch";

test("Switch は押すと反対の値を返す", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Switch checked ariaLabel="継承を表示" onChange={onChange} />);
  const toggle = screen.getByRole("switch", { name: "継承を表示" });
  expect(toggle).toHaveAttribute("aria-checked", "true");
  await user.click(toggle);
  expect(onChange).toHaveBeenCalledWith(false);
});
