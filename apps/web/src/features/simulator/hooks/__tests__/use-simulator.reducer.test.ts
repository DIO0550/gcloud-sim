// @vitest-environment node
import { expect, test } from "vitest";

import { Engine } from "@/engine";
import { World } from "@/engine/domains/world";
import {
  initialSimulatorState,
  type SimulatorState,
  simulatorReducer,
} from "@/features/simulator/hooks/use-simulator";
import { Option } from "@/utils/Option";

const Now = "2026-09-30T14:02:31.000Z";
const start = (): SimulatorState => initialSimulatorState(Engine.initialWorld(Now));
const submit = (state: SimulatorState, line: string, origin: "cli" | "ui" = "cli") =>
  simulatorReducer(state, { type: "submitted", line, now: Now, origin });

test("コマンドを送ると入力と出力が transcript に積まれ World が進む", () => {
  const s = submit(start(), "gcloud compute instances create web-1 --zone=asia-northeast1-a");
  expect(s.transcript[0]).toMatchObject({
    kind: "input",
    origin: "cli",
    text: "gcloud compute instances create web-1 --zone=asia-northeast1-a",
  });
  expect(s.transcript[1]).toMatchObject({
    kind: "output",
    text: expect.stringContaining("Created ["),
  });
  expect(
    Option.isSome(World.findInstance(s.world, "ace-dev-01", "asia-northeast1-a", "web-1")),
  ).toBe(true);
});

test("UI 由来の実行は出力が muted になる", () => {
  const s = submit(start(), "gcloud config set project ace-prod-01", "ui");
  expect(s.transcript[1]).toMatchObject({ kind: "output", origin: "ui", tone: "muted" });
});

test("clear で clearEpoch が進む", () => {
  const s = submit(start(), "clear");
  expect(s.clearEpoch).toBe(1);
});

test("確認プロンプトの状態は次の行で消費される", () => {
  const asked = submit(
    submit(start(), "gcloud compute instances create web-1 --zone=asia-northeast1-a"),
    "gcloud compute instances delete web-1 --zone=asia-northeast1-a",
  );
  expect(asked.shell.kind).toBe("confirming");
  const answered = submit(asked, "n");
  expect(answered.shell.kind).toBe("ready");
});

test("ツリーの選択でプロパティタブに切り替わる", () => {
  const s = simulatorReducer(
    { ...start(), panelTab: "log" },
    { type: "selected", selection: { kind: "project", projectId: "ace-dev-01" } },
  );
  expect(s.panelTab).toBe("properties");
  expect(s.selection).toEqual(Option.some({ kind: "project", projectId: "ace-dev-01" }));
});

test("挿入要求は同じ文字列でも seq が進む", () => {
  const once = simulatorReducer(start(), { type: "insertRequested", text: "gcloud projects list" });
  const twice = simulatorReducer(once, { type: "insertRequested", text: "gcloud projects list" });
  expect(Option.unwrap(twice.pendingInsert).seq).toBe(2);
});

test("ミッションを開始すると in_progress になり開始のメッセージが出る", () => {
  const s = simulatorReducer(start(), { type: "missionStarted", id: "m-setup-001" });
  expect(Option.unwrap(World.findMission(s.world, "m-setup-001")).status).toBe("in_progress");
  expect(s.transcript.at(-1)?.text).toContain("ミッション開始");
});

test("存在しないミッションは利用できないと出て World は変わらない", () => {
  const before = start();
  const s = simulatorReducer(before, { type: "missionStarted", id: "m-none" });
  expect(s.world).toBe(before.world);
  expect(s.transcript.at(-1)?.text).toContain("このミッションは現在利用できません");
});

test("ミッションをクリアすると celebration に入る", () => {
  const started = simulatorReducer(start(), { type: "missionStarted", id: "m-setup-001" });
  const done = submit(
    submit(
      started,
      "gcloud billing projects link ace-prod-01 --billing-account=01AB2C-DEF345-6789AB",
    ),
    "gcloud services enable compute.googleapis.com --project=ace-prod-01",
  );
  expect(Option.isSome(done.celebration)).toBe(true);
  expect(simulatorReducer(done, { type: "celebrationDismissed" }).celebration).toEqual(Option.none);
});

test("World を置き換えると選択と shell 状態がリセットされ設定が閉じる", () => {
  const dirty: SimulatorState = {
    ...submit(start(), "gcloud compute instances delete x --zone=asia-northeast1-a"),
    settingsOpen: true,
    selection: Option.some({ kind: "organization" }),
  };
  const fresh = Engine.initialWorld(Now);
  const s = simulatorReducer(dirty, { type: "worldReplaced", world: fresh, reason: "reset" });
  expect(s.world).toBe(fresh);
  expect(s.shell.kind).toBe("ready");
  expect(s.selection).toEqual(Option.none);
  expect(s.settingsOpen).toBe(false);
  expect(s.transcript.at(-1)?.text).toContain("初期状態に戻しました");
});

test("import の失敗は importError に入り、設定を閉じると消える", () => {
  const failed = simulatorReducer(start(), {
    type: "importFailed",
    message: "schemaVersion 9 は未対応です。",
  });
  expect(failed.importError).toEqual(Option.some("schemaVersion 9 は未対応です。"));
  expect(simulatorReducer(failed, { type: "settingsToggled", open: false }).importError).toEqual(
    Option.none,
  );
});

test("保存に失敗すると黄色の警告が transcript に出る", () => {
  const s = simulatorReducer(start(), { type: "persistFailed", reason: "QuotaExceededError" });
  expect(s.transcript.at(-1)).toMatchObject({
    tone: "warning",
    text: expect.stringContaining("failed to persist state"),
  });
});
