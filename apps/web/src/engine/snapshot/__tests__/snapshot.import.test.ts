// @vitest-environment node
import { expect, test } from "vitest";

import { initialWorld, Now, run, session } from "@/engine/__tests__/setup";
import { World } from "@/engine/domains/world";
import { Snapshot } from "@/engine/snapshot";
import { Result } from "@/utils/Result";

test("初期 World は不変条件を満たす", () => {
  expect(Result.isOk(World.validate(initialWorld()))).toBe(true);
});

test("export した JSON を import すると同じ World に戻る", () => {
  const s = run(session(), "gcloud compute instances create web-1 --zone=asia-northeast1-a");
  const json = JSON.stringify(Snapshot.create(s.world, Now));
  const imported = Snapshot.fromUnknown(JSON.parse(json));
  expect(Result.unwrap(imported)).toEqual(s.world);
});

test("schemaVersion が未対応なら E-011 で理由に版が入る", () => {
  const result = Snapshot.fromUnknown({ schemaVersion: 9, exportedAt: Now, world: initialWorld() });
  expect(Result.isOk(result)).toBe(false);
  if (!Result.isOk(result)) {
    expect(result.error).toEqual({ kind: "unsupportedVersion", version: "9" });
    expect(Snapshot.describeFailure(result.error)).toBe(
      "schemaVersion 9 は未対応です。現在の状態は変更していません。",
    );
  }
});

test("JSON オブジェクトでなければ E-011 になる", () => {
  const result = Snapshot.fromUnknown("nope");
  expect(Result.isOk(result)).toBe(false);
  if (!Result.isOk(result)) expect(result.error.kind).toBe("malformed");
});

test("world の必須の配列が欠けていれば E-011 になる", () => {
  const { instances: _dropped, ...broken } = initialWorld();
  const result = Snapshot.fromUnknown({ schemaVersion: 1, exportedAt: Now, world: broken });
  expect(Result.isOk(result)).toBe(false);
  if (!Result.isOk(result))
    expect(Snapshot.describeFailure(result.error)).toContain("world.instances must be an array");
});

test("不変条件に違反する World（組織 Owner 不在）は E-011 になる", () => {
  const world = initialWorld();
  const broken: World = {
    ...world,
    organization: { ...world.organization, iamPolicy: { bindings: [] } },
  };
  const result = Snapshot.fromUnknown({ schemaVersion: 1, exportedAt: Now, world: broken });
  expect(Result.isOk(result)).toBe(false);
  if (!Result.isOk(result))
    expect(result.error).toEqual({
      kind: "invariant",
      reason: "the organization has no roles/owner member",
    });
});

test("import で知らないミッション id は落ち、無い id は available で足される", () => {
  const world = initialWorld();
  const tampered: World = {
    ...world,
    missions: [
      { id: "m-old-999", status: "completed", revealedHints: 0 },
      ...world.missions.slice(1),
    ],
  };
  const imported = Result.unwrap(
    Snapshot.fromUnknown({ schemaVersion: 1, exportedAt: Now, world: tampered }),
  );
  expect(imported.missions.some((m) => m.id === "m-old-999")).toBe(false);
  expect(imported.missions.map((m) => m.id).toSorted()).toEqual(
    world.missions.map((m) => m.id).toSorted(),
  );
});

test("ファイル名は gcloud-sim-snapshot-YYYYMMDD-HHmm.json になる", () => {
  expect(Snapshot.fileName("2026-09-30T05:06:00.000Z")).toMatch(
    /^gcloud-sim-snapshot-\d{8}-\d{4}\.json$/,
  );
});
