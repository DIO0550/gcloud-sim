// @vitest-environment node
import { expect, test } from "vitest";

import { run, session } from "@/engine/__tests__/setup";
import { ResourceTree, Selection, type TreeNode } from "@/engine/resource-tree";
import { Option } from "@/utils/Option";

const labels = (nodes: readonly TreeNode[]): readonly string[] => nodes.map((n) => n.label);
const find = (nodes: readonly TreeNode[], label: string): TreeNode | undefined =>
  nodes.reduce<TreeNode | undefined>(
    (found, n) => found ?? (n.label === label ? n : find(n.children, label)),
    undefined,
  );

test("組織 → フォルダ → プロジェクトの順に並び、請求アカウントは組織と並ぶ", () => {
  const tree = ResourceTree.fromWorld(session().world);
  expect(labels(tree)).toEqual(["example.com", "01AB2C-DEF345-6789AB"]);
  expect(labels(tree[0]?.children ?? [])).toEqual(["dev", "prod"]);
  expect(labels(find(tree, "dev")?.children ?? [])).toEqual(["ace-dev-01"]);
});

test("プロジェクトの下にはリソース種別のグループが件数付きで出る", () => {
  const s = run(
    session(),
    "gcloud compute instances create web-1 --zone=asia-northeast1-a",
    "gcloud compute instances create batch-1 --zone=asia-northeast1-b",
  );
  const project = find(ResourceTree.fromWorld(s.world), "ace-dev-01");
  const compute = find(project?.children ?? [], "Compute Engine");
  expect(compute?.count).toEqual(Option.some(2));
  expect(labels(compute?.children ?? [])).toEqual(["batch-1", "web-1"]);
});

test("インスタンスが無いプロジェクトには Compute Engine のグループを出さない", () => {
  const project = find(ResourceTree.fromWorld(session().world), "ace-prod-01");
  expect(labels(project?.children ?? [])).not.toContain("Compute Engine");
  expect(labels(project?.children ?? [])).toContain("VPC ネットワーク");
});

test("停止中のインスタンスは stopped の印になる", () => {
  const s = run(
    session(),
    "gcloud compute instances create web-1 --zone=asia-northeast1-a",
    "gcloud compute instances stop web-1 --zone=asia-northeast1-a",
  );
  expect(find(ResourceTree.fromWorld(s.world), "web-1")?.status).toBe("stopped");
});

test("削除要求済みのプロジェクトはツリーに出ない", () => {
  const s = run(session(), "gcloud projects delete ace-prod-01 --quiet");
  expect(find(ResourceTree.fromWorld(s.world), "ace-prod-01")).toBeUndefined();
});

test("ファイアウォールはネットワークの下に fw: 付きで出る", () => {
  const network = find(ResourceTree.fromWorld(session().world), "default");
  expect(labels(network?.children ?? [])).toContain("fw: default-allow-ssh");
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
