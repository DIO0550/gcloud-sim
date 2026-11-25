// @vitest-environment node
import { expect, test } from "vitest";

import { run, session } from "@/engine/__tests__/setup";

test("service-accounts update は display-name と description を更新し、describe に反映される", () => {
  const s = run(
    session(),
    "gcloud iam service-accounts update web-sa@ace-dev-01.iam.gserviceaccount.com --display-name='Web App SA' --description='Updated description'",
    "gcloud iam service-accounts describe web-sa@ace-dev-01.iam.gserviceaccount.com",
  );
  expect(s.text).toContain("displayName: Web App SA");
  expect(s.text).toContain("description: Updated description");
});

test("service-accounts update は存在しない SA を NOT_FOUND、権限不足を PERMISSION_DENIED で拒む", () => {
  const missing = run(
    session(),
    "gcloud iam service-accounts update ghost@ace-dev-01.iam.gserviceaccount.com --display-name=Ghost",
  );
  expect(missing.text).toContain("Unknown service account");

  const denied = run(
    session(),
    "gcloud iam service-accounts update web-sa@ace-dev-01.iam.gserviceaccount.com --display-name=Nope --account=dev@example.com",
  );
  expect(denied.text).toContain("Required 'iam.serviceAccounts.update' permission");
});

test("roles update はカスタムロールのタイトル・説明・権限・stage を更新する", () => {
  const created = run(
    session(),
    "gcloud iam roles create customEditor --project=ace-dev-01 --permissions=compute.instances.list --title='Custom Editor'",
  );
  const replaced = run(
    created,
    "gcloud iam roles update customEditor --project=ace-dev-01 --title='Updated Editor' --description='Edited role' --permissions=compute.instances.list,compute.instances.get --stage=beta",
    "gcloud iam roles describe customEditor --project=ace-dev-01",
  );
  expect(replaced.text).toContain("title: Updated Editor");
  expect(replaced.text).toContain("description: Edited role");
  expect(replaced.text).toContain("- compute.instances.get");
  expect(replaced.text).toContain("stage: BETA");

  const patched = run(
    replaced,
    "gcloud iam roles update customEditor --project=ace-dev-01 --add-permissions=compute.instances.create --remove-permissions=compute.instances.list",
    "gcloud iam roles describe customEditor --project=ace-dev-01",
  );
  expect(patched.text).toContain("- compute.instances.create");
  expect(patched.text).toContain("- compute.instances.get");
  expect(patched.text).not.toContain("- compute.instances.list");
});

test("roles update は不正な権限・排他フラグ・未知ロール・権限不足を拒む", () => {
  const created = run(
    session(),
    "gcloud iam roles create customEditor --project=ace-dev-01 --permissions=compute.instances.list",
  );
  expect(
    run(
      created,
      "gcloud iam roles update customEditor --project=ace-dev-01 --permissions=compute.instances.fly",
    ).text,
  ).toContain("Permission compute.instances.fly is not valid");

  expect(
    run(
      created,
      "gcloud iam roles update customEditor --project=ace-dev-01 --permissions=compute.instances.list --add-permissions=compute.instances.get",
    ).text,
  ).toContain("cannot be combined");

  expect(
    run(created, "gcloud iam roles update ghost --project=ace-dev-01 --title=Ghost").text,
  ).toContain("was not found");

  expect(
    run(
      created,
      "gcloud iam roles update customEditor --project=ace-dev-01 --title=Nope --account=dev@example.com",
    ).text,
  ).toContain("Required 'iam.roles.update' permission");
});
