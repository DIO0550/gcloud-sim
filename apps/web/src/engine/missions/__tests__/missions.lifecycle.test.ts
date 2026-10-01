// @vitest-environment node
import { expect, test } from "vitest";

import { Engine } from "@/engine";
import { initialWorld, Now, run, session } from "@/engine/__tests__/setup";
import { World } from "@/engine/domains/world";
import { Mission } from "@/engine/missions";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const startedSession = (id: string) =>
  session(Result.unwrap(Engine.startMission(initialWorld(), id)));

test("すべてのミッションの setup は不変条件を満たし、開始直後はクリアしていない", () => {
  for (const mission of Engine.missions()) {
    const started = Engine.startMission(initialWorld(), mission.id);
    expect(Result.isOk(started), mission.id).toBe(true);
    if (Result.isOk(started)) {
      expect(Mission.assertionResults(started.value, mission).every(Boolean), mission.id).toBe(
        false,
      );
      expect(Option.unwrap(World.findMissionProgress(started.value, mission.id)).status).toBe(
        "in_progress",
      );
    }
  }
});

test("アサーションが全部真になった実行でクリアになり祝福が出る", () => {
  const start = startedSession("m-setup-001");
  const linked = run(
    start,
    "gcloud billing projects link ace-prod-01 --billing-account=01AB2C-DEF345-6789AB",
  );
  expect(Option.unwrap(World.findMissionProgress(linked.world, "m-setup-001")).status).toBe(
    "in_progress",
  );
  const done = run(linked, "gcloud services enable compute.googleapis.com --project=ace-prod-01");
  expect(done.text).toContain(
    "gcloud-sim: ✓ ミッションクリア「ace-prod-01 で Compute Engine を使えるようにする」",
  );
  expect(Option.unwrap(World.findMissionProgress(done.world, "m-setup-001")).status).toBe(
    "completed",
  );
});

test("開始していないミッションは条件を満たしてもクリアにならない", () => {
  const s = run(
    session(),
    "gcloud billing projects link ace-prod-01 --billing-account=01AB2C-DEF345-6789AB",
    "gcloud services enable compute.googleapis.com --project=ace-prod-01",
  );
  expect(s.text).not.toContain("ミッションクリア");
  expect(Option.unwrap(World.findMissionProgress(s.world, "m-setup-001")).status).toBe("available");
});

test("中断すると available に戻り、World の変更は残る", () => {
  const start = startedSession("m-setup-001");
  const linked = run(
    start,
    "gcloud billing projects link ace-prod-01 --billing-account=01AB2C-DEF345-6789AB",
  );
  const abandoned = Engine.abandonMission(linked.world, "m-setup-001");
  expect(Option.unwrap(World.findMissionProgress(abandoned, "m-setup-001")).status).toBe(
    "available",
  );
  expect(
    Option.isSome(Option.unwrap(World.findProject(abandoned, "ace-prod-01")).billingAccountId),
  ).toBe(true);
});

test("completed から available へは戻らず、再挑戦で in_progress になる", () => {
  const done = run(
    startedSession("m-setup-001"),
    "gcloud billing projects link ace-prod-01 --billing-account=01AB2C-DEF345-6789AB",
    "gcloud services enable compute.googleapis.com --project=ace-prod-01",
  );
  expect(
    Option.unwrap(
      World.findMissionProgress(Engine.abandonMission(done.world, "m-setup-001"), "m-setup-001"),
    ).status,
  ).toBe("completed");
  const retried = Result.unwrap(Engine.startMission(done.world, "m-setup-001"));
  expect(Option.unwrap(World.findMissionProgress(retried, "m-setup-001")).status).toBe(
    "in_progress",
  );
});

test("ヒントは 1 つずつ開示され、上限で止まる", () => {
  const world = Result.unwrap(Engine.startMission(initialWorld(), "m-setup-001"));
  const once = Engine.revealHint(world, "m-setup-001");
  expect(Option.unwrap(World.findMissionProgress(once, "m-setup-001")).revealedHints).toBe(1);
  const many = Engine.revealHint(
    Engine.revealHint(Engine.revealHint(once, "m-setup-001"), "m-setup-001"),
    "m-setup-001",
  );
  expect(Option.unwrap(World.findMissionProgress(many, "m-setup-001")).revealedHints).toBe(3);
});

test("m-ops-001 の setup は batch-1 を用意し、停止 + スナップショットでクリアになる", () => {
  const start = startedSession("m-ops-001");
  expect(
    Option.isSome(World.findInstance(start.world, "ace-dev-01", "asia-northeast1-b", "batch-1")),
  ).toBe(true);
  const done = run(
    start,
    "gcloud compute instances stop batch-1 --zone=asia-northeast1-b",
    "gcloud compute snapshots create batch-1-snap --source-disk=batch-1 --source-disk-zone=asia-northeast1-b",
  );
  expect(done.text).toContain("ミッションクリア");
});

test("m-iam-001 はプロジェクトに editor を付けた解き方では不正解のまま", () => {
  const start = startedSession("m-iam-001");
  expect(World.currentPrincipal(start.world)).toEqual(Option.some("dev@example.com"));
  const wrong = run(
    start,
    "gcloud config set account owner@example.com",
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:dev@example.com --role=roles/editor",
    "gcloud resource-manager folders add-iam-policy-binding 284100000001 --member=user:dev@example.com --role=roles/compute.instanceAdmin.v1",
    "gcloud config set account dev@example.com",
    "gcloud compute instances create web-2 --zone=asia-northeast1-a",
  );
  expect(wrong.text).not.toContain("ミッションクリア");
  const fixed = run(
    wrong,
    "gcloud config set account owner@example.com",
    "gcloud projects remove-iam-policy-binding ace-dev-01 --member=user:dev@example.com --role=roles/editor",
  );
  expect(fixed.text).toContain("ミッションクリア");
});

test("effectivePermission は付与前は偽で、フォルダへの付与で真になる", () => {
  const mission = Option.unwrap(Mission.find("m-iam-001"));
  const index = mission.assertions.findIndex((a) => a.kind === "effectivePermission");
  const before = startedSession("m-iam-001");
  expect(Mission.assertionResults(before.world, mission)[index]).toBe(false);
  const granted = run(
    before,
    "gcloud config set account owner@example.com",
    "gcloud resource-manager folders add-iam-policy-binding 284100000001 --member=user:dev@example.com --role=roles/compute.instanceAdmin.v1",
  );
  expect(Mission.assertionResults(granted.world, mission)[index]).toBe(true);
});

test("m-ops-001 の setup が用意する batch-1 は RUNNING・外部 IP なし・既定のディスクで、2 度当てても 1 台のまま", () => {
  const once = Result.unwrap(Engine.startMission(initialWorld(), "m-ops-001"));
  const instance = Option.unwrap(
    World.findInstance(once, "ace-dev-01", "asia-northeast1-b", "batch-1"),
  );
  expect(instance).toMatchObject({
    status: "RUNNING",
    machineType: "e2-medium",
    disks: [{ deviceName: "batch-1", boot: true, sizeGb: 10, type: "pd-balanced" }],
    networkInterfaces: [{ network: "default", externalIP: { kind: "none" } }],
  });
  expect(instance.scopes).toHaveLength(6);
  const twice = Result.unwrap(Engine.startMission(once, "m-ops-001"));
  expect(World.instancesOf(twice, "ace-dev-01")).toHaveLength(1);
});

test("存在しないミッションは E-015 相当の失敗になる", () => {
  const result = Engine.startMission(initialWorld(), "m-none");
  expect(Result.isOk(result)).toBe(false);
});

test("Engine.initialWorld はすべてのミッションを available で持つ", () => {
  const world = Engine.initialWorld(Now);
  expect(world.missions).toHaveLength(Engine.missions().length);
  expect(world.missions.every((m) => m.status === "available")).toBe(true);
});
