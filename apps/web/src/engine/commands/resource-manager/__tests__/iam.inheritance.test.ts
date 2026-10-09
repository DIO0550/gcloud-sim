// @vitest-environment node
import { expect, test } from "vitest";

import { run, session } from "@/engine/__tests__/setup";
import { EffectivePermissions } from "@/engine/domains/effective-permissions";
import { InitialWorldFixture as F } from "@/engine/initial-world";

const asDev = "gcloud config set account dev@example.com";
const asOwner = "gcloud config set account owner@example.com";

test("フォルダに付けたロールは配下のプロジェクトで効く", () => {
  const s = run(
    session(),
    `gcloud resource-manager folders add-iam-policy-binding ${F.devFolderId} --member=user:dev@example.com --role=roles/compute.instanceAdmin.v1`,
  );
  const effective = EffectivePermissions.resolve(s.world, "user:dev@example.com", {
    type: "project",
    id: F.devProjectId,
  });
  expect(EffectivePermissions.allows(effective, "compute.instances.create")).toBe(true);
  expect(effective.grants).toContainEqual({
    role: "roles/compute.instanceAdmin.v1",
    grantedAt: { type: "folder", id: F.devFolderId },
  });
});

test("フォルダに付けたロールは兄弟フォルダのプロジェクトには効かない", () => {
  const s = run(
    session(),
    `gcloud resource-manager folders add-iam-policy-binding ${F.devFolderId} --member=user:dev@example.com --role=roles/compute.instanceAdmin.v1`,
  );
  const effective = EffectivePermissions.resolve(s.world, "user:dev@example.com", {
    type: "project",
    id: F.prodProjectId,
  });
  expect(EffectivePermissions.allows(effective, "compute.instances.create")).toBe(false);
});

test("組織に付けたロールはすべてのプロジェクトで効く", () => {
  const s = run(
    session(),
    `gcloud organizations add-iam-policy-binding ${F.organizationId} --member=group:ops@example.com --role=roles/viewer`,
  );
  const effective = EffectivePermissions.resolve(s.world, "group:ops@example.com", {
    type: "project",
    id: F.prodProjectId,
  });
  expect(EffectivePermissions.allows(effective, "compute.instances.list")).toBe(true);
});

test("カタログに無い権限は許可に倒す", () => {
  const effective = EffectivePermissions.resolve(session().world, "user:nobody@example.com", {
    type: "project",
    id: F.devProjectId,
  });
  expect(EffectivePermissions.allows(effective, "compute.instances.create")).toBe(false);
  expect(EffectivePermissions.allows(effective, "example.unregistered.action")).toBe(true);
});

test("add-iam-policy-binding は更新後のポリシーを YAML で出す", () => {
  const s = run(
    session(),
    `gcloud projects add-iam-policy-binding ${F.devProjectId} --member=user:dev@example.com --role=roles/compute.instanceAdmin.v1`,
  );
  expect(s.text).toContain(`Updated IAM policy for project [${F.devProjectId}].`);
  expect(s.text).toContain("bindings:");
  expect(s.text).toContain("  - user:dev@example.com");
  expect(s.text).toContain("  role: roles/compute.instanceAdmin.v1");
});

test("同じロールに 2 回加えても members は増えない", () => {
  const cmd = `gcloud projects add-iam-policy-binding ${F.devProjectId} --member=user:dev@example.com --role=roles/viewer`;
  const s = run(session(), cmd, cmd);
  const viewer = s.world.projects
    .find((p) => p.projectId === F.devProjectId)
    ?.iamPolicy.bindings.find((b) => b.role === "roles/viewer");
  expect(viewer?.members).toEqual(["user:dev@example.com"]);
});

test("member のプレフィックスが不正なら E-009 になる", () => {
  const s = run(
    session(),
    `gcloud projects add-iam-policy-binding ${F.devProjectId} --member=dev@example.com --role=roles/viewer`,
  );
  expect(s.text).toContain(
    "ERROR: (gcloud.projects.add-iam-policy-binding) Invalid value for [member]: dev@example.com.",
  );
});

test("知らないロールは E-009 になる", () => {
  const s = run(
    session(),
    `gcloud projects add-iam-policy-binding ${F.devProjectId} --member=user:dev@example.com --role=roles/superadmin`,
  );
  expect(s.text).toContain("Role roles/superadmin is not supported for this resource.");
});

test("最後の組織 Owner は外せない（E-012）", () => {
  const s = run(
    session(),
    `gcloud organizations remove-iam-policy-binding ${F.organizationId} --member=user:owner@example.com --role=roles/owner`,
  );
  expect(s.text).toContain("gcloud-sim: refusing to remove the last owner of the organization");
  expect(
    s.world.organization.iamPolicy.bindings.find((b) => b.role === "roles/owner")?.members,
  ).toEqual(["user:owner@example.com"]);
});

test("Owner が 2 人いれば片方は外せる", () => {
  const s = run(
    session(),
    `gcloud organizations add-iam-policy-binding ${F.organizationId} --member=user:second@example.com --role=roles/owner`,
    `gcloud organizations remove-iam-policy-binding ${F.organizationId} --member=user:owner@example.com --role=roles/owner`,
  );
  expect(s.text).toContain(`Updated IAM policy for organization [${F.organizationId}].`);
  expect(
    s.world.organization.iamPolicy.bindings.find((b) => b.role === "roles/owner")?.members,
  ).toEqual(["user:second@example.com"]);
});

test("無いバインディングを外そうとすると not found になる", () => {
  const s = run(
    session(),
    `gcloud projects remove-iam-policy-binding ${F.devProjectId} --member=user:dev@example.com --role=roles/owner`,
  );
  expect(s.text).toContain(
    "Policy binding with the specified principal, role, and condition not found!",
  );
});

test("setIamPolicy 権限が無い主体は add-iam-policy-binding で E-006 になる", () => {
  const s = run(
    session(),
    asDev,
    `gcloud projects add-iam-policy-binding ${F.devProjectId} --member=user:dev@example.com --role=roles/owner`,
  );
  expect(s.text).toContain(
    "Required 'resourcemanager.projects.setIamPolicy' permission for 'projects/ace-dev-01'",
  );
});

test("projects list は主体が見えるプロジェクトだけを出す", () => {
  const all = run(session(), "gcloud projects list");
  expect(all.text).toContain("ace-dev-01");
  expect(all.text).toContain("ace-prod-01");
  const dev = run(session(), asDev, "gcloud projects list");
  expect(dev.text).toContain("ace-dev-01");
  expect(dev.text).not.toContain("ace-prod-01");
});

test("projects create は親に create 権限があれば作り、作成者を Owner にする", () => {
  const s = run(
    session(),
    `gcloud projects create ace-sandbox-01 --folder=${F.devFolderId} --name="Sandbox"`,
  );
  expect(s.text).toContain(
    "Create in progress for [https://cloudresourcemanager.googleapis.com/v1/projects/ace-sandbox-01].",
  );
  const project = s.world.projects.find((p) => p.projectId === "ace-sandbox-01");
  expect(project?.parent).toEqual({ type: "folder", id: F.devFolderId });
  expect(project?.iamPolicy.bindings).toEqual([
    { role: "roles/owner", members: ["user:owner@example.com"] },
  ]);
});

test("projects create で形式の悪い ID は E-003 になる", () => {
  const s = run(session(), "gcloud projects create Bad_ID");
  expect(s.text).toContain("Project ID [Bad_ID] is invalid.");
});

test("projects delete は確認後に DELETE_REQUESTED にし、list から消える", () => {
  const s = run(
    session(),
    `gcloud projects delete ${F.prodProjectId} --quiet`,
    "gcloud projects list",
  );
  expect(s.text).not.toContain("ace-prod-01");
  expect(s.world.projects.find((p) => p.projectId === F.prodProjectId)?.lifecycleState).toBe(
    "DELETE_REQUESTED",
  );
});

test("DELETE_REQUESTED のプロジェクトへの操作は E-005 になり、undelete で戻る", () => {
  const deleted = run(
    session(),
    `gcloud projects delete ${F.prodProjectId} --quiet`,
    `gcloud compute instances list --project=${F.prodProjectId}`,
  );
  expect(deleted.text).toContain(`The resource 'projects/${F.prodProjectId}' was not found`);
  const restored = run(
    deleted,
    `gcloud projects undelete ${F.prodProjectId}`,
    "gcloud projects list",
  );
  expect(restored.text).toContain("ace-prod-01");
});

test("owner に戻れば再びすべてのプロジェクトが見える", () => {
  const s = run(session(), asDev, asOwner, "gcloud projects list");
  expect(s.text).toContain("ace-prod-01");
});
