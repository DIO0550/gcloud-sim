// @vitest-environment node
import { expect, test } from "vitest";

import { run, session } from "@/engine/__tests__/setup";
import type { CustomRole } from "@/engine/domains/role-catalog";
import {
  IamBindingEditForm,
  RoleEditForm,
  ServiceAccountEditForm,
  ServiceAccountKeyCreateForm,
} from "@/features/simulator/features/console/domains/edit-command/iam";

test("ServiceAccountEditForm は既存の SA から update コマンドを組み立ててエンジンで通る", () => {
  const form = {
    ...ServiceAccountEditForm.fromServiceAccount({
      email: "web-sa@ace-dev-01.iam.gserviceaccount.com",
      displayName: "Web SA",
      description: "",
    }),
    displayName: "Web Backend SA",
    description: "App service account",
  };
  expect(ServiceAccountEditForm.collectErrors(form)).toEqual({});
  const line = ServiceAccountEditForm.toCommand(form, "ace-dev-01");
  expect(line).toBe(
    'gcloud iam service-accounts update web-sa@ace-dev-01.iam.gserviceaccount.com --project=ace-dev-01 --display-name="Web Backend SA" --description="App service account"',
  );

  const after = run(session(), line);
  const updated = after.world.serviceAccounts.find(
    (s) => s.email === "web-sa@ace-dev-01.iam.gserviceaccount.com",
  );
  expect(updated?.displayName).toBe("Web Backend SA");
  expect(updated?.description).toBe("App service account");
});

test("RoleEditForm はカスタムロールの編集コマンドを検証・生成し、エンジンで通る", () => {
  const role: CustomRole = {
    projectId: "ace-dev-01",
    roleId: "customViewer",
    title: "Custom Viewer",
    description: "Initial",
    includedPermissions: ["compute.instances.list"],
    stage: "GA",
    etag: "BwYCustom0=",
  };
  const initial = RoleEditForm.fromCustomRole(role);
  expect(initial.permissions).toBe("compute.instances.list");

  const emptyPerms = { ...initial, permissions: "   " };
  expect(RoleEditForm.collectErrors(emptyPerms).permissions).toBeDefined();

  const edited = {
    ...initial,
    title: "Custom Compute Reader",
    description: "Updated role",
    permissions: "compute.instances.list, compute.instances.get",
  };
  expect(RoleEditForm.collectErrors(edited)).toEqual({});
  const line = RoleEditForm.toCommand(edited, "ace-dev-01");
  expect(line).toBe(
    'gcloud iam roles update customViewer --project=ace-dev-01 --permissions=compute.instances.list,compute.instances.get --title="Custom Compute Reader" --description="Updated role"',
  );

  const after = run(
    session(),
    "gcloud iam roles create customViewer --project=ace-dev-01 --permissions=compute.instances.list --title='Custom Viewer'",
    line,
  );
  const updated = after.world.customRoles.find((r) => r.roleId === "customViewer");
  expect(updated?.title).toBe("Custom Compute Reader");
  expect(updated?.description).toBe("Updated role");
  expect(updated?.includedPermissions).toEqual(["compute.instances.list", "compute.instances.get"]);
});

test("IamBindingEditForm はロール変更の 2 ステップを検証・生成し、エンジンで通る", () => {
  const initial = IamBindingEditForm.fromBinding("user:dev@example.com", "roles/viewer");
  expect(IamBindingEditForm.collectErrors(initial).role).toContain("変更前と同じロール");

  const invalid = { ...initial, role: "invalid" };
  expect(IamBindingEditForm.collectErrors(invalid).role).toContain("roles/...");

  const edited = { ...initial, role: "roles/compute.viewer" };
  expect(IamBindingEditForm.collectErrors(edited)).toEqual({});
  const steps = IamBindingEditForm.toSteps(edited, "ace-dev-01");
  expect(steps.map((s) => s.line)).toEqual([
    "gcloud projects remove-iam-policy-binding ace-dev-01 --member=user:dev@example.com --role=roles/viewer",
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:dev@example.com --role=roles/compute.viewer",
  ]);

  const after = run(
    session(),
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:dev@example.com --role=roles/viewer",
    ...steps.map((s) => s.line),
  );
  const project = after.world.projects.find((p) => p.projectId === "ace-dev-01");
  const roles = project?.iamPolicy.bindings
    .filter((b) => b.members.includes("user:dev@example.com"))
    .map((b) => b.role);
  expect(roles).toContain("roles/compute.viewer");
  expect(roles).not.toContain("roles/viewer");
});

test("ServiceAccountKeyCreateForm はキーの作成・削除コマンドを検証・生成し、エンジンで通る", () => {
  const email = "web-sa@ace-dev-01.iam.gserviceaccount.com";
  const initial = ServiceAccountKeyCreateForm.forServiceAccount(email);
  expect(initial).toEqual({ email, outputFile: "./web-sa-key.json" });

  expect(
    ServiceAccountKeyCreateForm.collectErrors({ ...initial, outputFile: "   " }).outputFile,
  ).toBeDefined();
  expect(
    ServiceAccountKeyCreateForm.collectErrors({ ...initial, outputFile: "my key.json" }).outputFile,
  ).toBeDefined();
  expect(ServiceAccountKeyCreateForm.collectErrors(initial)).toEqual({});

  const createLine = ServiceAccountKeyCreateForm.toCommand(initial, "ace-dev-01");
  expect(createLine).toBe(
    "gcloud iam service-accounts keys create ./web-sa-key.json --iam-account=web-sa@ace-dev-01.iam.gserviceaccount.com --project=ace-dev-01",
  );

  const created = run(session(), createLine);
  const createdKey = created.world.serviceAccountKeys.find(
    (k) => k.serviceAccountEmail === email && k.file === "./web-sa-key.json",
  );
  expect(createdKey).toBeDefined();

  const deleteLine = ServiceAccountKeyCreateForm.deleteCommand(
    createdKey?.keyId ?? "",
    email,
    "ace-dev-01",
  );
  expect(deleteLine).toBe(
    `gcloud iam service-accounts keys delete ${createdKey?.keyId ?? ""} --iam-account=${email} --project=ace-dev-01 --quiet`,
  );

  const deleted = run(created, deleteLine);
  expect(deleted.world.serviceAccountKeys.some((k) => k.keyId === createdKey?.keyId)).toBe(false);
});
