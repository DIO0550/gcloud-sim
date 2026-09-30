// @vitest-environment node
import { expect, test } from "vitest";

import { run, session } from "@/engine/__tests__/setup";
import { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";

test("請求がリンクされていないプロジェクトで課金対象 API を有効化すると E-016 になる", () => {
  const s = run(
    session(),
    `gcloud services enable compute.googleapis.com --project=${F.prodProjectId}`,
  );
  expect(s.text).toContain(
    `Billing must be enabled for activation of service 'compute.googleapis.com' in project '${F.prodProjectId}' to proceed.`,
  );
  expect(s.text).toContain("gcloud billing projects link");
  expect(World.hasApi(s.world, F.prodProjectId, "compute.googleapis.com")).toBe(false);
});

test("請求をリンクすれば有効化できる", () => {
  const s = run(
    session(),
    `gcloud billing projects link ${F.prodProjectId} --billing-account=${F.billingAccountId}`,
    `gcloud services enable compute.googleapis.com --project=${F.prodProjectId}`,
  );
  expect(s.text).toContain("finished successfully.");
  expect(World.hasApi(s.world, F.prodProjectId, "compute.googleapis.com")).toBe(true);
});

test("課金の要らない API は請求なしでも有効化できる", () => {
  const s = run(
    session(),
    `gcloud services enable storage.googleapis.com --project=${F.prodProjectId}`,
  );
  expect(World.hasApi(s.world, F.prodProjectId, "storage.googleapis.com")).toBe(true);
});

test("billing projects link は billingInfo を YAML で出す", () => {
  const s = run(
    session(),
    `gcloud billing projects link ${F.prodProjectId} --billing-account=${F.billingAccountId}`,
  );
  expect(s.text).toContain(`billingAccountName: billingAccounts/${F.billingAccountId}`);
  expect(s.text).toContain("billingEnabled: true");
});

test("存在しない請求アカウントは E-005 になる", () => {
  const s = run(
    session(),
    `gcloud billing projects link ${F.prodProjectId} --billing-account=000000-000000-000000`,
  );
  expect(s.text).toContain("The resource 'billingAccounts/000000-000000-000000' was not found");
});

test("unlink すると billingEnabled が false になる", () => {
  const s = run(session(), `gcloud billing projects unlink ${F.devProjectId}`);
  expect(s.text).toContain("billingEnabled: false");
});

test("billing accounts list は table で出す", () => {
  const s = run(session(), "gcloud billing accounts list");
  expect(s.lines[0]?.text).toMatch(/^ACCOUNT_ID\s+NAME\s+OPEN/);
  expect(s.lines[1]?.text).toMatch(/^01AB2C-DEF345-6789AB\s+My Billing Account\s+true/);
});

test("services list は有効な API だけを出し、--available で全部出す", () => {
  const enabled = run(session(), "gcloud services list");
  expect(enabled.text).toContain("compute.googleapis.com");
  expect(enabled.text).not.toContain("container.googleapis.com");
  const available = run(session(), "gcloud services list --available");
  expect(available.text).toContain("container.googleapis.com");
});

test("services disable で API が外れる", () => {
  const s = run(
    session(),
    "gcloud services disable compute.googleapis.com",
    "gcloud compute instances list",
  );
  expect(s.text).toContain("Compute Engine API has not been used in project ace-dev-01");
});

test("知らない API 名は E-005 になる", () => {
  const s = run(session(), "gcloud services enable nope.googleapis.com");
  expect(s.text).toContain("[nope.googleapis.com] is not a known service.");
});
