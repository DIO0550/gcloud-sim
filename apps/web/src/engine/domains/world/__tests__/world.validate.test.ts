// @vitest-environment node
import { expect, test } from "vitest";

import { initialWorld, run, session } from "@/engine/__tests__/setup";
import { IamPolicy } from "@/engine/domains/iam-policy";
import type { Folder } from "@/engine/domains/resource-hierarchy";
import { type World, World as WorldOps } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import { Option } from "@/utils/Option";
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
  expect(failure(orphan)).toBe("instances [ghost-vm] belongs to a missing project [nowhere]");
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

test("同じ置き場に同名のサブネットが 2 つある World は弾かれる", () => {
  const world = initialWorld();
  const tokyo = Option.unwrap(
    WorldOps.findLocated(world, "subnets", {
      projectId: F.devProjectId,
      location: "asia-northeast1",
      name: "default",
    }),
  );
  const dup: World = { ...world, subnets: [...world.subnets, tokyo] };
  expect(failure(dup)).toBe(`subnets [${F.devProjectId}/asia-northeast1/default] is duplicated`);
});

test("存在しないプロジェクトに属するバケットは弾かれる", () => {
  const s = run(session(), "gcloud storage buckets create gs://probe-1");
  const orphan: World = {
    ...s.world,
    buckets: s.world.buckets.map((b) => ({ ...b, projectId: "nowhere" })),
  };
  expect(failure(s.world)).toBe("");
  expect(failure(orphan)).toBe("buckets [probe-1] belongs to a missing project [nowhere]");
});

test("トピックの無いサブスクリプションは弾かれる", () => {
  const s = run(
    session(),
    "gcloud services enable pubsub.googleapis.com",
    "gcloud pubsub topics create orders",
    "gcloud pubsub subscriptions create orders-sub --topic=orders",
  );
  expect(failure(s.world)).toBe("");
  expect(failure({ ...s.world, pubsubTopics: [] })).toBe(
    "subscription [orders-sub] refers to a missing topic",
  );
});

test("クラスタの無い Deployment は弾かれる", () => {
  const s = run(
    session(),
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create app --zone=asia-northeast1-a --num-nodes=2",
    "kubectl create deployment web --image=nginx",
  );
  expect(failure(s.world)).toBe("");
  expect(failure({ ...s.world, clusters: [], nodePools: [] })).toBe(
    "[web] belongs to a missing cluster [app]",
  );
});

test("SQL インスタンスの無いバックアップは弾かれる", () => {
  const s = run(
    session(),
    "gcloud services enable sqladmin.googleapis.com",
    "gcloud sql instances create db1 --database-version=POSTGRES_15 --tier=db-f1-micro --region=asia-northeast1",
    "gcloud sql backups create --instance=db1",
  );
  expect(failure(s.world)).toBe("");
  expect(failure({ ...s.world, sqlInstances: [] })).toContain(
    "belongs to a missing Cloud SQL instance",
  );
});

test("請求先アカウントの無い予算は弾かれる", () => {
  const s = run(
    session(),
    `gcloud billing budgets create --billing-account=${F.billingAccountId} --display-name=B1 --budget-amount=1000JPY`,
  );
  expect(failure(s.world)).toBe("");
  const orphan: World = {
    ...s.world,
    budgets: s.world.budgets.map((b) => ({ ...b, billingAccountId: "nowhere" })),
  };
  expect(failure(orphan)).toContain("budget [B1] belongs to a missing billing account");
});
