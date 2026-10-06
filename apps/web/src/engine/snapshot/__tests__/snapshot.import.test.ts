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
  const result = Snapshot.fromUnknown({
    schemaVersion: 30,
    exportedAt: Now,
    world: initialWorld(),
  });
  expect(Result.isOk(result)).toBe(false);
  if (!Result.isOk(result)) {
    expect(result.error).toEqual({ kind: "unsupportedVersion", version: "30" });
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
    expect(result.error).toEqual({
      kind: "malformed",
      reason: "world.instances must be an array (got undefined)",
    });
});

test("カタログに無いゾーンを持つインスタンスは E-011 になり位置が理由に出る", () => {
  const s = run(session(), "gcloud compute instances create web-1 --zone=asia-northeast1-a");
  const world = { ...s.world, instances: [{ ...s.world.instances[0], zone: "mars-central1-a" }] };
  const result = Snapshot.fromUnknown({ schemaVersion: 1, exportedAt: Now, world });
  expect(Result.isOk(result)).toBe(false);
  if (!Result.isOk(result))
    expect(result.error).toEqual({
      kind: "malformed",
      reason: "world.instances[0].zone is not a known zone: mars-central1-a",
    });
});

test('schemaVersion が文字列の "1" なら数ではないので E-011（malformed）になる', () => {
  const result = Snapshot.fromUnknown({
    schemaVersion: "1",
    exportedAt: Now,
    world: initialWorld(),
  });
  expect(Result.isOk(result)).toBe(false);
  if (!Result.isOk(result)) expect(result.error.kind).toBe("malformed");
});

test("configuration の知らないプロパティは取り込まない", () => {
  const world = initialWorld();
  const tampered = {
    ...world,
    config: {
      ...world.config,
      configurations: { default: { "core/project": "ace-dev-01", "core/colour": "blue" } },
    },
  };
  const imported = Result.unwrap(
    Snapshot.fromUnknown({ schemaVersion: 1, exportedAt: Now, world: tampered }),
  );
  expect(imported.config.configurations.default).toEqual({ "core/project": "ace-dev-01" });
});

test.each([
  [
    "instances[0].disks[0].type",
    (w: World) => ({
      ...w,
      instances: [
        { ...w.instances[0], disks: [{ ...w.instances[0]?.disks[0], type: "pd-quantum" }] },
      ],
    }),
    "world.instances[0].disks[0].type is not a known disk type: pd-quantum",
  ],
  [
    "firewallRules[0].direction",
    (w: World) => ({ ...w, firewallRules: [{ ...w.firewallRules[0], direction: "SIDEWAYS" }] }),
    "world.firewallRules[0].direction is not a known direction: SIDEWAYS",
  ],
  [
    "organization member",
    (w: World) => ({
      ...w,
      organization: {
        ...w.organization,
        iamPolicy: { bindings: [{ role: "roles/owner", members: ["owner@example.com"] }] },
      },
    }),
    "world.organization.iamPolicy.bindings[0].members[0]: Invalid value for [member]: owner@example.com.",
  ],
  [
    "organization role",
    (w: World) => ({
      ...w,
      organization: {
        ...w.organization,
        iamPolicy: { bindings: [{ role: "owner", members: ["user:owner@example.com"] }] },
      },
    }),
    "world.organization.iamPolicy.bindings[0].role is not a known role name: owner",
  ],
  [
    "session account",
    (w: World) => ({ ...w, session: { accounts: ["not-an-email"] } }),
    "world.session.accounts[0]: Invalid account [not-an-email]. Expected an email address.",
  ],
  [
    "instance status",
    (w: World) => ({ ...w, instances: [{ ...w.instances[0], status: "SLEEPING" }] }),
    "world.instances[0].status must be one of RUNNING, TERMINATED, SUSPENDED",
  ],
])("%s の綴りが閉じた型に無ければ E-011 になり、位置が理由に出る", (_label, tamper, reason) => {
  const s = run(
    session(),
    "gcloud compute instances create web-1 --zone=asia-northeast1-a",
    "gcloud compute firewall-rules create allow-http --allow=tcp:80",
  );
  const result = Snapshot.fromUnknown({
    schemaVersion: 1,
    exportedAt: Now,
    world: tamper(s.world),
  });
  expect(Result.isOk(result)).toBe(false);
  if (!Result.isOk(result)) {
    expect(result.error.kind).toBe("malformed");
    expect(result.error).toHaveProperty("reason");
    expect((result.error as { reason: string }).reason).toContain(reason);
  }
});

test("知らないキーは取り込まず、宣言したキーだけの World になる", () => {
  const world = { ...initialWorld(), extra: { __proto__: { polluted: true } } };
  const imported = Result.unwrap(
    Snapshot.fromUnknown({ schemaVersion: 1, exportedAt: Now, world }),
  );
  expect("extra" in imported).toBe(false);
  expect(Object.keys(imported).toSorted()).toEqual(Object.keys(initialWorld()).toSorted());
});

test("configuration に __proto__ キーがあれば E-011 になる", () => {
  const world = initialWorld();
  const tampered = {
    ...world,
    config: {
      ...world.config,
      configurations: JSON.parse('{"default":{},"__proto__":{"polluted":"yes"}}'),
    },
  };
  const result = Snapshot.fromUnknown({ schemaVersion: 1, exportedAt: Now, world: tampered });
  expect(Result.isOk(result)).toBe(false);
  if (!Result.isOk(result)) expect(result.error.kind).toBe("malformed");
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
