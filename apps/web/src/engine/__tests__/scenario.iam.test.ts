// @vitest-environment node
import { expect, test } from "vitest";

import { run, session } from "@/engine/__tests__/setup";
import { World } from "@/engine/domains/world";
import { BindingRow } from "@/engine/resource-tree";
import { Option } from "@/utils/Option";

/** UC-004 代替フロー（本ツールの核心）を shell 経由で通しで確かめる。 */
test("dev に切り替える → 拒否される → フォルダに付与する → dev で再実行すると成功する", () => {
  const step1 = run(session(), "gcloud config set account dev@example.com");
  expect(step1.text).toBe("Updated property [core/account].");

  const step2 = run(step1, "gcloud compute instances create web-2 --zone=asia-northeast1-a");
  expect(step2.lines.map((l) => [l.tone, l.text])).toEqual([
    ["error", "ERROR: (gcloud.compute.instances.create) Could not fetch resource:"],
    ["error", " - Required 'compute.instances.create' permission for 'projects/ace-dev-01'"],
    [
      "hint",
      "gcloud-sim: hint: この権限を含むロール: roles/compute.instanceAdmin.v1, roles/compute.instanceAdmin, roles/compute.admin, roles/editor, roles/owner",
    ],
  ]);
  expect(World.findInstance(step2.world, "ace-dev-01", "asia-northeast1-a", "web-2")).toEqual(
    Option.none,
  );

  const step3 = run(
    step2,
    "gcloud config set account owner@example.com",
    "gcloud resource-manager folders add-iam-policy-binding 284100000001 --member=user:dev@example.com --role=roles/compute.instanceAdmin.v1",
  );
  expect(step3.text).toContain("Updated IAM policy for folder [284100000001].");
  expect(step3.text).toContain("- user:dev@example.com");

  const step4 = run(step2, ...[], "gcloud config set account dev@example.com");
  const success = run(
    step3,
    "gcloud config set account dev@example.com",
    "gcloud compute instances create web-2 --zone=asia-northeast1-a",
  );
  expect(success.lines[0]?.text).toBe(
    "Created [https://www.googleapis.com/compute/v1/projects/ace-dev-01/zones/asia-northeast1-a/instances/web-2].",
  );
  expect(success.lines[2]?.text).toMatch(/^web-2\s+asia-northeast1-a\s+e2-medium\s+.*RUNNING$/);
  expect(World.currentPrincipal(step4.world)).toEqual(Option.some("dev@example.com"));

  const rows = BindingRow.fromWorld(success.world, { type: "project", id: "ace-dev-01" });
  const devRows = rows.filter((r) => r.member === "user:dev@example.com");
  expect(devRows).toEqual([
    {
      member: "user:dev@example.com",
      role: "roles/viewer",
      origin: { kind: "self", target: { type: "project", id: "ace-dev-01" } },
    },
    {
      member: "user:dev@example.com",
      role: "roles/compute.instanceAdmin.v1",
      origin: { kind: "folder", displayName: "dev" },
    },
  ]);
  expect(devRows.map(BindingRow.isInherited)).toEqual([false, true]);
});

test("--account でその 1 回だけ主体を変えられる", () => {
  const s = run(
    session(),
    "gcloud compute instances create web-2 --zone=asia-northeast1-a --account=dev@example.com",
  );
  expect(s.text).toContain("Required 'compute.instances.create' permission");
  expect(World.currentPrincipal(s.world)).toEqual(Option.some("owner@example.com"));
});

test("API 未有効化と権限不足が同時なら API 未有効化（E-007）が先に出る", () => {
  const s = run(
    session(),
    "gcloud config set account dev@example.com",
    "gcloud compute instances create web-2 --zone=asia-northeast1-a --project=ace-prod-01",
  );
  expect(s.text).toContain("Compute Engine API has not been used in project ace-prod-01");
});
