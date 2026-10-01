import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import Home from "./page";

// jsdom には xterm.js が要る canvas が無いので、端末が開けない旨のログだけを黙らせる（console は境界）。
const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

afterEach(() => {
  errorLog.mockClear();
});

test("サイト名を見出しに出す", () => {
  render(<Home />);

  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("gcloud-sim");
});
