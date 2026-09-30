// @vitest-environment node
import { expect, test } from "vitest";

import { Tokenizer } from "@/engine/cli/tokenizer";
import { Result } from "@/utils/Result";

test("空白で区切る", () => {
  expect(Result.unwrap(Tokenizer.tokenize("gcloud compute  instances list"))).toEqual([
    "gcloud",
    "compute",
    "instances",
    "list",
  ]);
});

test("ダブルクォートの中の空白は区切らない", () => {
  expect(Result.unwrap(Tokenizer.tokenize('create --display-name="Batch SA" x'))).toEqual([
    "create",
    "--display-name=Batch SA",
    "x",
  ]);
});

test("シングルクォートの中ではバックスラッシュをそのまま残す", () => {
  expect(Result.unwrap(Tokenizer.tokenize("echo 'a\\b'"))).toEqual(["echo", "a\\b"]);
});

test("クォートの外のバックスラッシュは次の 1 文字をそのまま入れる", () => {
  expect(Result.unwrap(Tokenizer.tokenize("a\\ b"))).toEqual(["a b"]);
});

test("空行はトークンが無い", () => {
  expect(Result.unwrap(Tokenizer.tokenize("   "))).toEqual([]);
});

test("閉じないクォートは失敗になる", () => {
  const result = Tokenizer.tokenize('gcloud config set project "ace');
  expect(Result.isOk(result)).toBe(false);
  if (!Result.isOk(result)) expect(result.error.quote).toBe('"');
});

test("空のクォートは空文字のトークンになる", () => {
  expect(Result.unwrap(Tokenizer.tokenize('--name=""'))).toEqual(["--name="]);
});
