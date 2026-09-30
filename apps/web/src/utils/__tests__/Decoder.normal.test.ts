// @vitest-environment node
import { expect, test } from "vitest";

import { Decoder } from "@/utils/Decoder";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

test("object は宣言したキーだけを持つ新しい値を返し、型が違えば位置付きの理由になる", () => {
  const decoder = Decoder.object<{ name: string; count: number }>({
    name: Decoder.string,
    count: Decoder.number,
  });
  expect(decoder({ name: "a", count: 1, extra: true }, "root")).toEqual(
    Result.ok({ name: "a", count: 1 }),
  );
  expect(decoder({ name: "a", count: "1" }, "root")).toEqual(
    Result.err("root.count must be a finite number (got string)"),
  );
});

test("array は要素の位置を理由に出す", () => {
  const decoder = Decoder.array(Decoder.string);
  expect(decoder(["a", 2], "list")).toEqual(Result.err("list[1] must be a string (got number)"));
});

test("literal は列挙にある綴りだけを通す", () => {
  const decoder = Decoder.literal(["a", "b"]);
  expect(decoder("a", "x")).toEqual(Result.ok("a"));
  expect(decoder("c", "x")).toEqual(Result.err("x must be one of a, b"));
});

test("option は書き出した形を Option に戻す", () => {
  const decoder = Decoder.option(Decoder.string);
  expect(decoder({ some: true, value: "v" }, "o")).toEqual(Result.ok(Option.some("v")));
  expect(decoder({ some: false }, "o")).toEqual(Result.ok(Option.none));
  expect(Result.isOk(decoder("v", "o"))).toBe(false);
});

test.each(["__proto__", "constructor", "prototype"])("record は %s キーを拒む", (key) => {
  const decoder = Decoder.record(Decoder.string);
  const polluted: unknown = JSON.parse(`{"${key}": "x"}`);
  expect(decoder(polluted, "map")).toEqual(Result.err(`map has a forbidden key: ${key}`));
});

test("number は有限の数だけを通す（JSON の 1e999 は Infinity になる）", () => {
  expect(Decoder.number(JSON.parse("1e999"), "n")).toEqual(
    Result.err("n must be a finite number (got number)"),
  );
  expect(Decoder.number(1.5, "n")).toEqual(Result.ok(1.5));
});

test("boolean は true / false だけを通す", () => {
  expect(Decoder.boolean("true", "b")).toEqual(Result.err("b must be a boolean (got string)"));
  expect(Decoder.boolean(false, "b")).toEqual(Result.ok(false));
});

test("object は配列を通さない", () => {
  const decoder = Decoder.object<{ name: string }>({ name: Decoder.string });
  expect(decoder(["a"], "o")).toEqual(Result.err("o must be an object (got array)"));
});

test("option は some が真偽でなければ拒む", () => {
  const decoder = Decoder.option(Decoder.string);
  expect(decoder({ some: "yes", value: "v" }, "o")).toEqual(
    Result.err("o must be an option ({some: boolean}) (got object)"),
  );
});

test("validated は parse の失敗を位置付きで返す", () => {
  const decoder = Decoder.validated((value: string) =>
    value === "ok" ? Result.ok(value) : Result.err(`bad: ${value}`),
  );
  expect(decoder("no", "v")).toEqual(Result.err("v: bad: no"));
  expect(decoder("ok", "v")).toEqual(Result.ok("ok"));
});

test("map は変換の失敗を位置付きで返す", () => {
  const decoder = Decoder.map(Decoder.number, (n) =>
    n > 0 ? Result.ok(n) : Result.err("must be positive"),
  );
  expect(decoder(0, "n")).toEqual(Result.err("n: must be positive"));
  expect(decoder(3, "n")).toEqual(Result.ok(3));
});

test("parsed はドメインの parse に通し、無ければ何の綴りかを添える", () => {
  const decoder = Decoder.parsed(
    (value: string) => (value === "ok" ? Option.some("ok" as const) : Option.none),
    "answer",
  );
  expect(decoder("ok", "a")).toEqual(Result.ok("ok"));
  expect(decoder("no", "a")).toEqual(Result.err("a is not a known answer: no"));
});
