// @vitest-environment node
import { expect, test } from "vitest";

import { ArgParser } from "@/engine/cli/arg-parser";
import { Flag, ParsedArgs, Positional } from "@/engine/cli/command-spec";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const flags = [
  Flag.string("zone", "zone"),
  Flag.boolean("address", "address"),
  Flag.enum("provisioning-model", "model", ["STANDARD", "SPOT"]),
  Flag.list("tags", "tags"),
  Flag.keyvalue("metadata", "metadata"),
  Flag.integer("priority", "priority"),
  Flag.string("member", "member", { required: true }),
  Flag.boolean("quiet", "quiet", { aliases: ["-q"] }),
];
const positionals = [Positional.required("NAME", "name")];

test("--zone=a と --zone a は同じ引数になる", () => {
  const equals = Result.unwrap(
    ArgParser.parse(["web-1", "--zone=asia-northeast1-a", "--member=x"], flags, positionals),
  );
  const spaced = Result.unwrap(
    ArgParser.parse(["web-1", "--zone", "asia-northeast1-a", "--member=x"], flags, positionals),
  );
  expect(ParsedArgs.string(equals, "zone")).toEqual(Option.some("asia-northeast1-a"));
  expect(spaced).toEqual(equals);
});

test("--no-address は boolean を false にする", () => {
  const args = Result.unwrap(
    ArgParser.parse(["web-1", "--no-address", "--member=x"], flags, positionals),
  );
  expect(ParsedArgs.booleanChoice(args, "address")).toEqual(Option.some(false));
});

test("--address は boolean を true にし、無指定は none", () => {
  const on = Result.unwrap(
    ArgParser.parse(["web-1", "--address", "--member=x"], flags, positionals),
  );
  const off = Result.unwrap(ArgParser.parse(["web-1", "--member=x"], flags, positionals));
  expect(ParsedArgs.booleanChoice(on, "address")).toEqual(Option.some(true));
  expect(ParsedArgs.booleanChoice(off, "address")).toEqual(Option.none);
});

test("未知のフラグは E-003 になる", () => {
  const result = ArgParser.parse(["web-1", "--foo=1", "--member=x"], flags, positionals);
  expect(Result.isOk(result)).toBe(false);
  if (!Result.isOk(result)) {
    expect(result.error.code).toBe("E-003");
    expect(result.error.message).toBe("unrecognized arguments: --foo");
  }
});

test("choices に無い値は E-003 で候補を出す", () => {
  const result = ArgParser.parse(
    ["web-1", "--provisioning-model=CHEAP", "--member=x"],
    flags,
    positionals,
  );
  expect(Result.isOk(result)).toBe(false);
  if (!Result.isOk(result))
    expect(result.error.message).toContain("Valid choices are [STANDARD, SPOT]");
});

test("必須フラグが無いと E-004 になる", () => {
  const result = ArgParser.parse(["web-1"], flags, positionals);
  expect(Result.isOk(result)).toBe(false);
  if (!Result.isOk(result)) {
    expect(result.error.code).toBe("E-004");
    expect(result.error.message).toBe("argument --member: Must be specified.");
  }
});

test("必須の位置引数が無いと E-004 になる", () => {
  const result = ArgParser.parse(["--member=x"], flags, positionals);
  expect(Result.isOk(result)).toBe(false);
  if (!Result.isOk(result)) expect(result.error.message).toBe("argument NAME: Must be specified.");
});

test("list はカンマで分け、keyvalue は k=v の対にする", () => {
  const args = Result.unwrap(
    ArgParser.parse(
      ["web-1", "--tags=http-server,https-server", "--metadata=a=1,b=2", "--member=x"],
      flags,
      positionals,
    ),
  );
  expect(ParsedArgs.list(args, "tags")).toEqual(["http-server", "https-server"]);
  expect(ParsedArgs.keyvalue(args, "metadata")).toEqual({ a: "1", b: "2" });
});

test("integer に数字以外を渡すと E-003 になる", () => {
  const result = ArgParser.parse(["web-1", "--priority=high", "--member=x"], flags, positionals);
  expect(Result.isOk(result)).toBe(false);
  if (!Result.isOk(result))
    expect(result.error.message).toBe("argument --priority: Value [high] must be an integer.");
});

test("-q は --quiet に展開される", () => {
  const args = Result.unwrap(ArgParser.parse(["web-1", "-q", "--member=x"], flags, positionals));
  expect(ParsedArgs.boolean(args, "quiet")).toBe(true);
});

test("値を取るフラグの後ろに値が無いと E-003 になる", () => {
  const result = ArgParser.parse(["web-1", "--member"], flags, positionals);
  expect(Result.isOk(result)).toBe(false);
  if (!Result.isOk(result))
    expect(result.error.message).toBe("argument --member: expected one argument");
});

test("余分な位置引数は unrecognized arguments になる", () => {
  const result = ArgParser.parse(["web-1", "web-2", "--member=x"], flags, positionals);
  expect(Result.isOk(result)).toBe(false);
  if (!Result.isOk(result)) expect(result.error.message).toBe("unrecognized arguments: web-2");
});

test("補完と実行は boolean の否定・別名・区切りを同じように解釈する", () => {
  const tokens = ["--no-address", "-q", "--member=x", "--", "--zone=literal"];
  const parsed = Result.unwrap(ArgParser.parse(tokens, flags, positionals));
  const cursor = Result.unwrap(ArgParser.completion(tokens, "next", flags));
  expect(cursor.args).toEqual(parsed);
  expect(parsed.positionals).toEqual(["--zone=literal"]);
  expect(ParsedArgs.booleanChoice(parsed, "address")).toEqual(Option.some(false));
  expect(ParsedArgs.boolean(parsed, "quiet")).toBe(true);
  expect(cursor.target).toEqual({ kind: "positional", index: 1 });
});

test("大量の可変長引数でも補完位置と実行の引数順を保持する", () => {
  const names = Array.from({ length: 20000 }, (_, index) => `item-${index}`);
  const cursor = Result.unwrap(ArgParser.completion(names, "next", []));
  const parsed = Result.unwrap(ArgParser.parse(names, [], [Positional.variadic("NAME", "names")]));
  expect(cursor.args).toEqual(parsed);
  expect(parsed.positionals).toEqual(names);
  expect(cursor.target).toEqual({ kind: "positional", index: names.length });
});

test.each(["__proto__", "constructor", "prototype"])(
  "keyvalue は Snapshot で復元できないキー %s を拒否する",
  (key) => {
    const result = ArgParser.parse(
      ["web-1", `--metadata=${key}=x`, "--member=x"],
      flags,
      positionals,
    );
    expect(Result.isOk(result)).toBe(false);
    if (Result.isOk(result)) {
      return;
    }
    expect(result.error.code).toBe("E-003");
    expect(result.error.message).toContain(`Forbidden dictionary key: ${key}`);
  },
);
