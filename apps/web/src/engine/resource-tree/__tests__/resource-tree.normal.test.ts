// @vitest-environment node
import { expect, test } from "vitest";

import { run, session } from "@/engine/__tests__/setup";
import {
  BindingRow,
  type ResourceGroup,
  ResourceGroups,
  Selection,
  type TreeLabel,
  TreeNode,
} from "@/engine/resource-tree";
import { Option } from "@/utils/Option";

/** ラベルを比べやすい 1 つの綴りにする（グループは種別の値）。 */
const labelKey = (label: TreeLabel): string =>
  label.kind === "text" ? label.text : `group:${label.group}`;
const labels = (nodes: readonly TreeNode[]): readonly string[] =>
  nodes.map((n) => labelKey(n.label));
const find = (nodes: readonly TreeNode[], key: string): TreeNode | undefined =>
  nodes.reduce<TreeNode | undefined>(
    (found, n) => found ?? (labelKey(n.label) === key ? n : find(n.children, key)),
    undefined,
  );
const groupKey = (group: ResourceGroup): string => `group:${group}`;

test("組織 → フォルダ → プロジェクトの順に並び、請求アカウントは組織と並ぶ", () => {
  const tree = TreeNode.fromWorld(session().world);
  expect(labels(tree)).toEqual(["example.com", "01AB2C-DEF345-6789AB"]);
  expect(tree.map((n) => n.badge)).toEqual(["organization", "billing"]);
  expect(labels(tree[0]?.children ?? [])).toEqual(["dev", "prod"]);
  expect(labels(find(tree, "dev")?.children ?? [])).toEqual(["ace-dev-01"]);
});

test("プロジェクトの下にはリソース種別のグループが件数付きで出る", () => {
  const s = run(
    session(),
    "gcloud compute instances create web-1 --zone=asia-northeast1-a",
    "gcloud compute instances create batch-1 --zone=asia-northeast1-b",
  );
  const project = find(TreeNode.fromWorld(s.world), "ace-dev-01");
  const compute = find(project?.children ?? [], groupKey(ResourceGroups.Compute));
  expect(compute?.count).toEqual(Option.some(2));
  expect(labels(compute?.children ?? [])).toEqual(["batch-1", "web-1"]);
});

test("インスタンスが無いプロジェクトには Compute Engine のグループを出さない", () => {
  const project = find(TreeNode.fromWorld(session().world), "ace-prod-01");
  expect(labels(project?.children ?? [])).not.toContain(groupKey(ResourceGroups.Compute));
  expect(labels(project?.children ?? [])).toContain(groupKey(ResourceGroups.Vpc));
});

test("停止中のインスタンスは stopped の印になる", () => {
  const s = run(
    session(),
    "gcloud compute instances create web-1 --zone=asia-northeast1-a",
    "gcloud compute instances stop web-1 --zone=asia-northeast1-a",
  );
  expect(find(TreeNode.fromWorld(s.world), "web-1")?.status).toBe("stopped");
});

test("削除要求済みのプロジェクトはツリーに出ない", () => {
  const s = run(session(), "gcloud projects delete ace-prod-01 --quiet");
  expect(find(TreeNode.fromWorld(s.world), "ace-prod-01")).toBeUndefined();
});

test("ファイアウォールはネットワークの下に fw: 付きで出る", () => {
  const network = find(TreeNode.fromWorld(session().world), "default");
  expect(labels(network?.children ?? [])).toContain("fw: default-allow-ssh");
});

test("入れ子のフォルダは親フォルダの下に出る", () => {
  const s = run(
    session(),
    "gcloud resource-manager folders create --display-name=sub --folder=284100000001",
  );
  const dev = find(TreeNode.fromWorld(s.world), "dev");
  expect(labels(dev?.children ?? [])).toEqual(["sub", "ace-dev-01"]);
});

test("継承元は自分・フォルダ・組織を近い順に並べ、種別ごとに表示名を持つ", () => {
  const s = run(
    session(),
    "gcloud resource-manager folders create --display-name=sub --folder=284100000001",
    "gcloud projects create ace-sub-01 --folder=284100000010",
    "gcloud resource-manager folders add-iam-policy-binding 284100000010 --member=user:sub@example.com --role=roles/viewer",
    "gcloud resource-manager folders add-iam-policy-binding 284100000001 --member=user:dev@example.com --role=roles/viewer",
  );
  const rows = BindingRow.fromWorld(s.world, { type: "project", id: "ace-sub-01" });
  expect(rows.map((r) => r.origin)).toEqual([
    { kind: "self", target: { type: "project", id: "ace-sub-01" } },
    { kind: "folder", displayName: "sub" },
    { kind: "folder", displayName: "dev" },
    { kind: "organization", displayName: "example.com" },
    { kind: "organization", displayName: "example.com" },
  ]);
});

test("バケットの継承元にはプロジェクト由来の行がプロジェクトの id で出る", () => {
  const s = run(session(), "gcloud storage buckets create gs://b-1");
  const rows = BindingRow.fromWorld(s.world, { type: "bucket", id: "b-1" });
  const fromProject = rows.filter((r) => r.origin.kind === "project");
  expect(fromProject.map((r) => r.origin)).toEqual([
    { kind: "project", projectId: "ace-dev-01" },
    { kind: "project", projectId: "ace-dev-01" },
  ]);
  expect(rows.every(BindingRow.isInherited)).toBe(true);
});

test("describe コマンドはリソースごとに組み立てられ、組織には無い", () => {
  expect(
    Selection.describeCommand({
      kind: "instance",
      projectId: "p",
      zone: "asia-northeast1-a",
      name: "web-1",
    }),
  ).toEqual(Option.some("gcloud compute instances describe web-1 --zone=asia-northeast1-a"));
  expect(Selection.describeCommand({ kind: "organization" })).toEqual(Option.none);
});
