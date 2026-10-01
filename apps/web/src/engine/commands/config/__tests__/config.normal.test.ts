// @vitest-environment node
import { expect, test } from "vitest";

import { run, session } from "@/engine/__tests__/setup";
import { GcloudConfig } from "@/engine/domains/gcloud-config";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";

test("config set project で存在する ID なら警告なしで更新される", () => {
  const s = run(session(), "gcloud config set project ace-prod-01");
  expect(s.text).toBe("Updated property [core/project].");
  expect(GcloudConfig.get(s.world.config, "core/project")).toEqual(Option.some("ace-prod-01"));
});

test("config set project で存在しない ID でも設定は成功し WARNING が出る", () => {
  const s = run(session(), "gcloud config set project nope-123456");
  expect(s.text).toContain("Updated property [core/project].");
  expect(s.text).toContain(
    "WARNING: You do not appear to have access to project [nope-123456] or it does not exist.",
  );
  expect(GcloudConfig.get(s.world.config, "core/project")).toEqual(Option.some("nope-123456"));
});

test("config set account でプリンシパルが切り替わる", () => {
  const s = run(session(), "gcloud config set account dev@example.com");
  expect(s.text).toBe("Updated property [core/account].");
  expect(World.currentPrincipal(s.world)).toEqual(Option.some("dev@example.com"));
});

test("config set account にメールでない値は E-003 になる", () => {
  const s = run(session(), "gcloud config set account dev");
  expect(s.text).toContain("ERROR: (gcloud.config.set) argument VALUE: Invalid account [dev].");
});

test("知らないプロパティは Section has no property になる", () => {
  const s = run(session(), "gcloud config set core/colour blue");
  expect(s.text).toContain("Section [core] has no property [colour].");
});

test("config get は値を出し、未設定なら (unset)", () => {
  expect(run(session(), "gcloud config get project").text).toBe("ace-dev-01");
  expect(run(session(), "gcloud config get compute/zone").text).toBe("(unset)");
});

test("config list はセクションごとに並べ、アクティブな configuration を末尾に出す", () => {
  const s = run(
    session(),
    "gcloud config set compute/zone asia-northeast1-a",
    "gcloud config list",
  );
  expect(s.lines.map((l) => l.text)).toEqual([
    "[core]",
    "account = owner@example.com",
    "project = ace-dev-01",
    "[compute]",
    "zone = asia-northeast1-a",
    "",
    "Your active configuration is: [default]",
  ]);
});

test("configurations create は作成してアクティブにする", () => {
  const s = run(session(), "gcloud config configurations create prod");
  expect(s.text).toBe("Created [prod].\nActivated [prod].");
  expect(s.world.config.activeConfiguration).toBe("prod");
});

test("configurations create --no-activate はアクティブにしない", () => {
  const s = run(session(), "gcloud config configurations create prod --no-activate");
  expect(s.text).toBe("Created [prod].");
  expect(s.world.config.activeConfiguration).toBe("default");
});

test("configurations activate で無い名前は E-005 になる", () => {
  const s = run(session(), "gcloud config configurations activate nope");
  expect(s.text).toContain(
    "ERROR: (gcloud.config.configurations.activate) Cannot activate configuration [nope], it does not exist.",
  );
});

test("configurations activate で切り替えると core/account のプリンシパルも揃う", () => {
  const s = run(
    session(),
    "gcloud config configurations create dev-cfg",
    "gcloud config set account dev@example.com",
    "gcloud config configurations activate default",
  );
  expect(World.currentPrincipal(s.world)).toEqual(Option.some("owner@example.com"));
});

test("configurations list は table で出す", () => {
  const s = run(session(), "gcloud config configurations list");
  expect(s.lines[0]?.text).toMatch(/^NAME\s+IS_ACTIVE\s+ACCOUNT\s+PROJECT/);
  expect(s.lines[1]?.text).toMatch(/^default\s+true\s+owner@example\.com\s+ace-dev-01/);
});

test("core/account を unset すると主体が無くなり、権限の要るコマンドは選択を促す", () => {
  const s = run(session(), "gcloud config unset account", "gcloud compute instances list");
  expect(World.currentPrincipal(s.world)).toEqual(Option.none);
  expect(s.text).toContain("You do not currently have an active account selected.");
  expect(run(s, "gcloud config list").text).toContain("project = ace-dev-01");
});

test("auth login は疑似的にプリンシパルを登録して切り替える", () => {
  const s = run(session(), "gcloud auth login dev@example.com", "gcloud auth list");
  expect(World.currentPrincipal(s.world)).toEqual(Option.some("dev@example.com"));
  expect(s.text).toContain("*       dev@example.com");
  expect(s.text).toContain("        owner@example.com");
});
