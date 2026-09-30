// @vitest-environment node
import { expect, test } from "vitest";

import { run, session } from "@/engine/__tests__/setup";

const createRole =
  "gcloud iam roles create instanceCreator --project=ace-dev-01 --permissions=compute.instances.create,compute.instances.list --title='Instance Creator'";

test("roles create はカスタムロールを作り、describe と --project 付きの list に出る", () => {
  const s = run(
    session(),
    createRole,
    "gcloud iam roles describe instanceCreator --project=ace-dev-01",
  );
  expect(s.text).toContain("name: projects/ace-dev-01/roles/instanceCreator");
  expect(s.text).toContain("- compute.instances.create");
  const listed = run(s, "gcloud iam roles list --project=ace-dev-01");
  expect(listed.text).toMatch(/projects\/ace-dev-01\/roles\/instanceCreator\s+Instance Creator/);
  expect(run(s, "gcloud iam roles list").text).not.toContain("instanceCreator");
});

test("カスタムロールを付けると有効権限に効く（付ける前は E-006、付けた後は通る）", () => {
  const before = run(
    session(),
    createRole,
    "gcloud compute instances create web-1 --zone=asia-northeast1-a --account=dev@example.com",
  );
  expect(before.text).toContain("Required 'compute.instances.create' permission");
  const after = run(
    before,
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:dev@example.com --role=projects/ace-dev-01/roles/instanceCreator",
    "gcloud compute instances create web-1 --zone=asia-northeast1-a --account=dev@example.com",
  );
  expect(after.text).toContain("Created [");
});

test("roles create はカタログに無い権限と悪い ID を INVALID_ARGUMENT で拒み、同名は E-008", () => {
  const unknown = run(
    session(),
    "gcloud iam roles create flyer --project=ace-dev-01 --permissions=compute.instances.fly",
  );
  expect(unknown.text).toContain("Permission compute.instances.fly is not valid");
  const bad = run(
    session(),
    "gcloud iam roles create a-b --project=ace-dev-01 --permissions=compute.instances.list",
  );
  expect(bad.text).toContain("The role id a-b is invalid");
  expect(run(session(), createRole, createRole).text).toContain("already exists");
});

test("World に無いカスタムロールへのバインディングは E-009", () => {
  const s = run(
    session(),
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:dev@example.com --role=projects/ace-dev-01/roles/ghost",
  );
  expect(s.text).toContain(
    "Role projects/ace-dev-01/roles/ghost is not supported for this resource",
  );
});

test("roles copy は事前定義ロールの権限を写す", () => {
  const s = run(
    session(),
    "gcloud iam roles copy --source=roles/compute.viewer --destination=computeReader",
    "gcloud iam roles describe computeReader",
  );
  expect(s.text).toContain("title: Compute Viewer");
  expect(s.text).toContain("- compute.instances.list");
  expect(
    run(session(), "gcloud iam roles copy --source=roles/nope --destination=x").text,
  ).toContain("The role named roles/nope was not found");
});

test("keys create は鍵を記録し、keys list に出て、その名前で activate-service-account できる", () => {
  const s = run(
    session(),
    "gcloud iam service-accounts keys create web-key.json --iam-account=web-sa@ace-dev-01.iam.gserviceaccount.com",
    "gcloud iam service-accounts keys list --iam-account=web-sa@ace-dev-01.iam.gserviceaccount.com",
  );
  expect(s.text).toMatch(/[0-9a-f]{40}\s+2026-09-30T14:02:31\.000Z/);
  const activated = run(
    s,
    "gcloud auth activate-service-account --key-file=web-key.json",
    "gcloud config get account",
  );
  expect(activated.text).toBe("web-sa@ace-dev-01.iam.gserviceaccount.com");
  const unknown = run(
    session(),
    "gcloud iam service-accounts keys create k.json --iam-account=ghost@ace-dev-01.iam.gserviceaccount.com",
  );
  expect(unknown.text).toContain("Unknown service account");
});

test("service-accounts add-iam-policy-binding は SA 自身のポリシーに入り、get-iam-policy で読める", () => {
  const s = run(
    session(),
    "gcloud iam service-accounts add-iam-policy-binding web-sa@ace-dev-01.iam.gserviceaccount.com --member=user:dev@example.com --role=roles/iam.serviceAccountUser",
    "gcloud iam service-accounts get-iam-policy web-sa@ace-dev-01.iam.gserviceaccount.com",
  );
  expect(s.text).toContain("role: roles/iam.serviceAccountUser");
  expect(s.text).toContain("- user:dev@example.com");
  expect(
    s.world.projects[0]?.iamPolicy.bindings.some((b) => b.role === "roles/iam.serviceAccountUser"),
  ).toBe(false);
});

test("SA のポリシーはプロジェクト・フォルダ・組織から継承して評価される", () => {
  const s = run(
    session(),
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:dev@example.com --role=roles/iam.serviceAccountAdmin",
    "gcloud iam service-accounts add-iam-policy-binding web-sa@ace-dev-01.iam.gserviceaccount.com --member=user:ops@example.com --role=roles/iam.serviceAccountUser --account=dev@example.com",
  );
  expect(s.text).toContain(
    "Updated IAM policy for serviceAccount [web-sa@ace-dev-01.iam.gserviceaccount.com].",
  );
});
