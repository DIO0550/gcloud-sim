import { afterEach, expect, test } from "vitest";

import { initialWorld, Now } from "@/engine/__tests__/setup";
import { StorageKey, WorldStorage } from "@/libs/world-storage";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

afterEach(() => {
  localStorage.clear();
});

test("保存が無ければ none", () => {
  expect(WorldStorage.load()).toEqual(Result.ok(Option.none));
});

test("save した World を load で読み戻せる", () => {
  const world = initialWorld();
  const saved = WorldStorage.save(world, Now);
  expect(Result.isOk(saved)).toBe(true);
  expect(WorldStorage.load()).toEqual(Result.ok(Option.some(world)));
});

test("壊れた JSON は退避してから理由を返す", () => {
  localStorage.setItem(StorageKey, "{not json");
  const loaded = WorldStorage.load();
  expect(Result.isOk(loaded)).toBe(false);
  if (!Result.isOk(loaded)) {
    expect(loaded.error.failure.kind).toBe("malformed");
    expect(loaded.error.backupKey).toEqual(Option.some("gcloud-sim:world:unreadable"));
  }
  expect(localStorage.getItem("gcloud-sim:world:unreadable")).toBe("{not json");
  expect(localStorage.getItem(StorageKey)).toBe("{not json");
});

test("版が違う保存も退避して unsupportedVersion で返す", () => {
  localStorage.setItem(
    StorageKey,
    JSON.stringify({ schemaVersion: 20, exportedAt: Now, world: {} }),
  );
  const loaded = WorldStorage.load();
  expect(Result.isOk(loaded)).toBe(false);
  if (!Result.isOk(loaded))
    expect(loaded.error.failure).toEqual({ kind: "unsupportedVersion", version: "20" });
});
