// @vitest-environment node
import { expect, test } from "vitest";

import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

test("filter は条件を満たす値だけを残す", () => {
  expect(Option.filter(Option.some(3), (n) => n > 2)).toEqual(Option.some(3));
  expect(Option.filter(Option.some(1), (n) => n > 2)).toEqual(Option.none);
  expect(Option.filter(Option.none as Option<number>, () => true)).toEqual(Option.none);
});

test("toResult は値があれば ok、無ければ error() の err にする", () => {
  expect(Option.toResult(Option.some("v"), () => "missing")).toEqual(Result.ok("v"));
  expect(Option.toResult(Option.none, () => "missing")).toEqual(Result.err("missing"));
});
