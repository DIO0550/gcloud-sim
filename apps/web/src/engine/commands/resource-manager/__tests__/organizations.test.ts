// @vitest-environment node
import { expect, test } from "vitest";
import { Now, run, session } from "@/engine/__tests__/setup";
import { World } from "@/engine/domains/world";
import { TreeNode } from "@/engine/resource-tree";
import { Snapshot } from "@/engine/snapshot";
import { Result } from "@/utils/Result";

const extraOrganization = () => {
  const signedIn = run(session(), "gcloud config set account dev@example.com");
  const world = Result.unwrap(World.createOrganization(signedIn.world, "learning.example"));
  const organization = world.additionalOrganizations[0];
  if (organization === undefined) {
    throw new Error("Organization was not created");
  }
  return { world, organization };
};

test("追加組織の配下にフォルダ・プロジェクトを作成し、CLI・ツリー・保存に反映する", () => {
  const { world, organization } = extraOrganization();
  const folderCreated = run(
    session(world),
    `gcloud resource-manager folders create --display-name=learning --organization=${organization.id}`,
  );
  const folder = folderCreated.world.folders.at(-1);
  expect(folder?.parent).toEqual({ type: "organization", id: organization.id });
  const created = run(
    folderCreated,
    `gcloud projects create learning-project --folder=${folder?.id} --set-as-default`,
  );
  expect(created.text).not.toContain("ERROR");
  expect(created.world.projects.at(-1)?.parent).toEqual({ type: "folder", id: folder?.id });
  expect(World.currentProjectId(created.world)).toEqual({ some: true, value: "learning-project" });
  expect(run(created, "gcloud organizations list").text).toContain("learning.example");
  expect(run(created, `gcloud organizations describe ${organization.id}`).text).toContain(
    "learning.example",
  );
  const tree = TreeNode.fromWorld(created.world);
  expect(
    tree
      .find((node) => node.key === `organization:${organization.id}`)
      ?.children.some((child) => child.key === `folder:${folder?.id}`),
  ).toBe(true);
  expect(World.validate(created.world).ok).toBe(true);
  expect(
    Result.unwrap(
      Snapshot.fromUnknown(JSON.parse(JSON.stringify(Snapshot.create(created.world, Now)))),
    ),
  ).toEqual(created.world);
});

test("組織間で所有者権限が混ざらず、IAM更新も指定した組織だけに効く", () => {
  const { world, organization } = extraOrganization();
  const denied = run(
    session(world),
    `gcloud projects create denied-project --organization=${world.organization.id}`,
  );
  expect(denied.text).toContain("resourcemanager.projects.create");
  expect(denied.world.projects).toEqual(world.projects);
  const granted = run(
    session(world),
    `gcloud organizations add-iam-policy-binding ${organization.id} --member=user:owner@example.com --role=roles/viewer`,
  );
  expect(granted.text).not.toContain("ERROR");
  expect(granted.world.organization).toEqual(world.organization);
  expect(granted.world.additionalOrganizations[0]?.iamPolicy.bindings).toContainEqual({
    role: "roles/viewer",
    members: ["user:owner@example.com"],
  });
  const owner = run(
    granted,
    "gcloud config set account owner@example.com",
    `gcloud resource-manager folders create --display-name=denied --organization=${organization.id}`,
  );
  expect(owner.text).toContain("resourcemanager.folders.create");
  expect(owner.world.folders).toEqual(world.folders);
});

test("追加組織でも最後の所有者を削除できない", () => {
  const { world, organization } = extraOrganization();
  const denied = run(
    session(world),
    `gcloud organizations remove-iam-policy-binding ${organization.id} --member=user:dev@example.com --role=roles/owner`,
  );
  expect(denied.text).toContain("E-012");
  expect(denied.world.additionalOrganizations).toEqual(world.additionalOrganizations);
});

test("空の組織名・重複名を拒否し、IDも衝突しない", () => {
  const { world, organization } = extraOrganization();
  expect(World.createOrganization(world, " ").ok).toBe(false);
  expect(World.createOrganization(world, " LEARNING.EXAMPLE ").ok).toBe(false);
  const next = Result.unwrap(
    World.createOrganization(
      { ...world, sequence: Number(organization.id) - 123456789000 },
      "another.example",
    ),
  );
  expect(new Set(World.organizations(next).map((item) => item.id)).size).toBe(3);
});

test("v44 の保存データを、元の階層を保ったまま移行する", () => {
  const { additionalOrganizations: _unused, ...legacy } = session().world;
  const restored = Result.unwrap(
    Snapshot.fromUnknown({ schemaVersion: 44, exportedAt: Now, world: legacy }),
  );
  expect(restored.additionalOrganizations).toEqual([]);
  expect(restored.organization).toEqual(legacy.organization);
  expect(restored.folders).toEqual(legacy.folders);
  expect(restored.projects).toEqual(legacy.projects);
});

test("組織IDの重複や所有者のない追加組織はインポートできない", () => {
  const { world, organization } = extraOrganization();
  const duplicate = { ...world, additionalOrganizations: [world.organization] };
  expect(Snapshot.fromUnknown(Snapshot.create(duplicate, Now)).ok).toBe(false);
  const ownerless = {
    ...world,
    additionalOrganizations: [{ ...organization, iamPolicy: { bindings: [] } }],
  };
  expect(Snapshot.fromUnknown(Snapshot.create(ownerless, Now)).ok).toBe(false);
});

test("同じ親の重複フォルダ名と深すぎる階層を作成しない", () => {
  let current = session();
  let parent = `--organization=${current.world.organization.id}`;
  for (let depth = 0; depth < 10; depth += 1) {
    current = run(
      current,
      `gcloud resource-manager folders create --display-name=level-${depth} ${parent}`,
    );
    expect(current.text).not.toContain("ERROR");
    parent = `--folder=${current.world.folders.at(-1)?.id}`;
  }
  const tooDeep = run(
    current,
    `gcloud resource-manager folders create --display-name=too-deep ${parent}`,
  );
  expect(tooDeep.text).toContain("Folder nesting limit exceeded");
  expect(tooDeep.world.folders).toEqual(current.world.folders);
  const duplicate = run(
    session(),
    `gcloud resource-manager folders create --display-name=dev --organization=${current.world.organization.id}`,
  );
  expect(duplicate.text).toContain("already exists");
});
