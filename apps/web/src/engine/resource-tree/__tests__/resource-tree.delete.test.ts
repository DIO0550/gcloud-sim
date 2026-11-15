// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { initialWorld, run, session } from "@/engine/__tests__/setup";
import { World } from "@/engine/domains/world";
import { TreeNode, type TreeSelection } from "@/engine/resource-tree";
import { Option } from "@/utils/Option";

const flat = (nodes: readonly TreeNode[]): readonly TreeNode[] =>
  nodes.flatMap((node) => [node, ...flat(node.children)]);

const nodeOf = (world: World, kind: TreeSelection["kind"], label: string): TreeNode => {
  const node = flat(TreeNode.fromWorld(world)).find(
    (n) =>
      Option.isSome(n.selection) &&
      n.selection.value.kind === kind &&
      n.label.kind === "text" &&
      n.label.text === label,
  );
  if (node === undefined) throw new Error(`no ${kind} node labelled ${label}`);
  return node;
};

const selectionOf = (node: TreeNode): TreeSelection => {
  if (!Option.isSome(node.selection)) throw new Error("node has no selection");
  return node.selection.value;
};

const zone = "--zone=asia-northeast1-a";

/** 作ったものがツリーに出て、そのノードの「delete を挿入」のコマンドで消える。 */
test.each([
  ["instance", "web-1", `gcloud compute instances create web-1 ${zone}`],
  ["disk", "data-1", `gcloud compute disks create data-1 ${zone} --size=200GB`],
  ["instance-template", "tpl-1", "gcloud compute instance-templates create tpl-1"],
  ["firewall", "fw-1", "gcloud compute firewall-rules create fw-1 --allow=tcp:22"],
  ["address", "ip-1", "gcloud compute addresses create ip-1 --region=asia-northeast1"],
  ["bucket", "ace-dev-01-tmp", "gcloud storage buckets create gs://ace-dev-01-tmp"],
  ["service-account", "batch-runner", "gcloud iam service-accounts create batch-runner"],
  [
    "custom-role",
    "vmReader",
    "gcloud iam roles create vmReader --project=ace-dev-01 --permissions=compute.instances.get",
  ],
  ["cluster", "c-1", `gcloud container clusters create c-1 ${zone}`],
] as const)("%s %s はツリーの delete コマンドで消える", (kind, label, create) => {
  const created = run(session(), "gcloud services enable container.googleapis.com", create);
  const node = nodeOf(created.world, kind, label);
  const command = Engine.deleteCommand(created.world, selectionOf(node));
  expect(Option.isSome(command)).toBe(true);
  if (!Option.isSome(command)) return;
  const asked = run(created, command.value);
  expect(asked.text).toContain("Do you want to continue (Y/n)?");
  const deleted = run(asked, "y");
  expect(flat(TreeNode.fromWorld(deleted.world)).some((n) => n.key === node.key)).toBe(false);
});

test("別のプロジェクトのリソースを選んでも --project 付きなのでそのプロジェクトのものが消える", () => {
  const created = run(
    session(),
    `gcloud compute instances create web-1 ${zone}`,
    "gcloud config set project ace-prod-01",
  );
  const command = Engine.deleteCommand(
    created.world,
    selectionOf(nodeOf(created.world, "instance", "web-1")),
  );
  expect(command).toEqual(
    Option.some(
      "gcloud compute instances delete web-1 --zone=asia-northeast1-a --project=ace-dev-01",
    ),
  );
});

test("中身の残るフォルダは消せず、空にしてから消せる", () => {
  const world = initialWorld();
  const folder = world.folders.find((f) =>
    world.projects.some((p) => p.parent.type === "folder" && p.parent.id === f.id),
  );
  if (folder === undefined) throw new Error("initial world has no folder with a project");
  const project = world.projects.find((p) => p.parent.id === folder.id);
  const blocked = run(
    session(world),
    `gcloud resource-manager folders delete ${folder.id} --quiet`,
  );
  expect(blocked.text).toContain("FAILED_PRECONDITION");
  expect(blocked.text).toContain(`projects/${project?.projectId}`);
  expect(Option.isSome(World.findFolder(blocked.world, folder.id))).toBe(true);
  const emptied = run(
    session(world),
    `gcloud projects delete ${project?.projectId} --quiet`,
    `gcloud resource-manager folders delete ${folder.id} --quiet`,
  );
  expect(emptied.text).toContain(`Deleted [folders/${folder.id}].`);
  expect(Option.isSome(World.findFolder(emptied.world, folder.id))).toBe(false);
  // 削除要求中だったプロジェクトはフォルダと一緒に消し切る（親を失って戻せなくなるので）。
  expect(emptied.text).toContain(
    `削除要求中のプロジェクト（${project?.projectId}）も完全に削除しました`,
  );
  expect(Option.isSome(World.findProject(emptied.world, project?.projectId ?? ""))).toBe(false);
});

test("本物でも消せないもの（KMS のキーリング）と組織・請求には delete コマンドを出さない", () => {
  const created = run(
    session(),
    "gcloud services enable cloudkms.googleapis.com",
    "gcloud kms keyrings create kr-1 --location=asia-northeast1",
  );
  const world = created.world;
  expect(
    Engine.deleteCommand(world, {
      kind: "key-ring",
      projectId: "ace-dev-01",
      location: "asia-northeast1",
      name: "kr-1",
    }),
  ).toEqual(Option.none);
  expect(Engine.deleteCommand(world, { kind: "organization", id: world.organization.id })).toEqual(
    Option.none,
  );
  expect(Engine.deleteCommand(world, { kind: "billing", id: "01AB2C-DEF345-6789AB" })).toEqual(
    Option.none,
  );
});
