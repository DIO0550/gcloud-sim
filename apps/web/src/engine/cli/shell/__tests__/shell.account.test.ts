// @vitest-environment node
import { expect, test } from "vitest";

import { run, session } from "@/engine/__tests__/setup";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";

test("--account がメールでなければ E-003 になり、core/account には戻らない", () => {
  const s = run(session(), "gcloud compute instances list --account=not-an-email");
  expect(s.text).toContain(
    "ERROR: (gcloud.compute.instances.list) argument --account: Invalid account [not-an-email].",
  );
});

test("core/account が無いと target 種別のコマンドもアカウント未選択になる", () => {
  const s = run(
    session(),
    "gcloud config unset account",
    "gcloud projects get-iam-policy ace-dev-01",
  );
  expect(s.text).toContain(
    "ERROR: (gcloud.projects.get-iam-policy) You do not currently have an active account selected.",
  );
  expect(World.currentPrincipal(s.world)).toEqual(Option.none);
});

test("core/account が無くても --account を付ければその 1 回は実行できる", () => {
  const s = run(
    session(),
    "gcloud config unset account",
    "gcloud projects get-iam-policy ace-dev-01 --account=owner@example.com",
  );
  expect(s.text).toContain("bindings:");
  expect(World.currentPrincipal(s.world)).toEqual(Option.none);
});
