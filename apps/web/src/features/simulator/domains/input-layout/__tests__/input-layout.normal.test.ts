// @vitest-environment node
import { expect, test } from "vitest";

import { InputLayout } from "@/features/simulator/domains/input-layout";
import { Option } from "@/utils/Option";

const Prompt = "\x1b[32m$\x1b[0m ";

test("初回は行頭から消してプロンプトとバッファを書き、カーソルを末尾に置く", () => {
  const redraw = InputLayout.redraw(Option.none, { buffer: "gcloud", cursor: 6 }, 80);
  expect(redraw.sequence).toBe(`\r\x1b[J${Prompt}gcloud\x1b[9G`);
  expect(redraw.rendered).toEqual({ length: 6, cursor: 6 });
});

test("カーソルが途中なら列だけ戻す", () => {
  const redraw = InputLayout.redraw(Option.none, { buffer: "abcd", cursor: 1 }, 80);
  expect(redraw.sequence).toBe(`\r\x1b[J${Prompt}abcd\x1b[4G`);
});

test("折り返した行の 2 行目にカーソルがあれば、消す前に 1 行上へ戻る", () => {
  const previous = Option.some({ length: 10, cursor: 10 });
  const redraw = InputLayout.redraw(previous, { buffer: "0123456789a", cursor: 11 }, 8);
  expect(redraw.sequence.startsWith("\x1b[1A\r\x1b[J")).toBe(true);
  expect(redraw.sequence.endsWith("\x1b[6G")).toBe(true);
});

test("書き終わりがちょうど右端なら空白で折り返させてから戻す", () => {
  const redraw = InputLayout.redraw(Option.none, { buffer: "123456", cursor: 6 }, 8);
  expect(redraw.sequence).toBe(`\r\x1b[J${Prompt}123456 \x1b[D\x1b[1G`);
});

test("カーソルが前の行にあるときは書き終わりから上へ戻る", () => {
  const redraw = InputLayout.redraw(Option.none, { buffer: "0123456789abcdef", cursor: 2 }, 8);
  expect(redraw.sequence).toBe(`\r\x1b[J${Prompt}0123456789abcdef\x1b[2A\x1b[5G`);
});

test("erase は前回のカーソル行数だけ上へ戻って画面末尾まで消す", () => {
  expect(InputLayout.erase(Option.some({ length: 20, cursor: 20 }), 8)).toBe("\x1b[2A\r\x1b[J");
  expect(InputLayout.erase(Option.none, 8)).toBe("\r\x1b[J");
});
