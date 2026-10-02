import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import { Checkbox } from "@/components/Checkbox";

test("Checkbox はラベルの文字を押しても切り替わり、切り替え後の値を返す", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(
    <Checkbox checked={false} onChange={onChange}>
      50%
    </Checkbox>,
  );
  await user.click(screen.getByText("50%"));
  expect(onChange).toHaveBeenCalledWith(true);
});
