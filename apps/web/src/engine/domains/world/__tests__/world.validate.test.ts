// @vitest-environment node
import { expect, test } from "vitest";

import { initialWorld } from "@/engine/__tests__/setup";
import { IamPolicy } from "@/engine/domains/iam-policy";
import type { Folder } from "@/engine/domains/resource-hierarchy";
import { type World, World as WorldOps } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import { Result } from "@/utils/Result";

const folder = (
  id: string,
  parentId: string,
  parentType: "organization" | "folder" = "folder",
): Folder => ({
  id,
  displayName: id,
  parent:
    parentType === "organization"
      ? { type: "organization", id: parentId }
      : { type: "folder", id: parentId },
  iamPolicy: IamPolicy.Empty,
});

/** 組織直下から `depth` 段のフォルダ鎖（f-1 → f-2 → … → f-depth）。 */
const chain = (depth: number): readonly Folder[] =>
  Array.from({ length: depth }, (_, i) =>
    i === 0 ? folder("f-1", F.organizationId, "organization") : folder(`f-${i + 1}`, `f-${i}`),
  );

const failure = (world: World): string => {
  const result = WorldOps.validate(world);
  return Result.isOk(result) ? "" : result.error;
};

test("互いを親にするフォルダは組織へ届かないので不変条件違反になる", () => {
  const world = initialWorld();
  const cyclic: World = {
    ...world,
    folders: [...world.folders, folder("a", "b"), folder("b", "a")],
  };
  expect(failure(cyclic)).toContain("folder [a] does not reach the organization");
});

test("フォルダのネストは 10 段までで、11 段目は弾かれる。10 段目の下のプロジェクトは許す", () => {
  const world = initialWorld();
  const ten: World = {
    ...world,
    folders: [...world.folders, ...chain(10)],
    projects: world.projects.map((p, i) =>
      i === 0 ? { ...p, parent: { type: "folder", id: "f-10" } } : p,
    ),
  };
  expect(failure(ten)).toBe("");
  expect(failure({ ...world, folders: [...world.folders, ...chain(11)] })).toContain(
    "folder [f-11] does not reach",
  );
});

test("存在しないフォルダを親に持つプロジェクトは弾かれる", () => {
  const world = initialWorld();
  const projects = world.projects.map((p) =>
    p.projectId === F.prodProjectId
      ? { ...p, parent: { type: "folder" as const, id: "ghost" } }
      : p,
  );
  expect(failure({ ...world, projects })).toBe(
    `project [${F.prodProjectId}] does not reach the organization`,
  );
});

test("存在しないプロジェクトに属するインスタンスは弾かれる", () => {
  const world = initialWorld();
  const orphan = { ...world, instances: [{ ...instanceOf(), projectId: "nowhere" }] };
  expect(failure(orphan)).toBe("instance [ghost-vm] belongs to a missing project");
});

test("フォルダ id の重複は弾かれる", () => {
  const world = initialWorld();
  const dup = {
    ...world,
    folders: [...world.folders, folder(F.devFolderId, F.organizationId, "organization")],
  };
  expect(failure(dup)).toBe("folder IDs are not unique");
});

test("ancestry は循環したフォルダで止まり、各フォルダを 1 回ずつ並べる", () => {
  const world = initialWorld();
  const cyclic: World = {
    ...world,
    folders: [...world.folders, folder("a", "b"), folder("b", "a")],
  };
  const path = WorldOps.ancestry(cyclic, { type: "folder", id: "a" });
  expect(path).toEqual([
    { type: "folder", id: "a" },
    { type: "folder", id: "b" },
    { type: "folder", id: "a" },
  ]);
});

const instanceOf = () => ({
  projectId: F.devProjectId,
  name: "ghost-vm",
  zone: "asia-northeast1-a" as const,
  machineType: "e2-medium" as const,
  status: "RUNNING" as const,
  networkInterfaces: [],
  disks: [],
  tags: [],
  serviceAccount: "",
  scopes: [],
  preemptible: false,
  provisioningModel: "STANDARD" as const,
  metadata: {},
  creationTimestamp: "2026-01-01T00:00:00.000Z",
  id: "1",
});
