import { expect, test } from "vitest";
import { run, session } from "@/engine/__tests__/fixture-setup";
import { aiSolutions } from "@/engine/missions/ace-support";
import { TreeNode, TreeSelection } from "@/engine/resource-tree";
import { Option } from "@/utils/Option";

test("旧Snapshotの判断・AI教材をリソースツリーやコマンド挿入に出さない", () => {
  const state = run(
    session(),
    ...aiSolutions("notebook"),
    "sim ace scenarios choose platform-vm --choice=gce --reason='VM OS control'",
  );
  const tree = JSON.stringify(TreeNode.fromWorld(state.world));
  for (const selection of [
    {
      kind: "ace-support",
      collection: "resources",
      projectId: "ace-dev-01",
      region: "us-central1",
      name: "ace-notebook",
    },
    {
      kind: "ace-support",
      collection: "decisions",
      projectId: "ace-dev-01",
      region: "",
      name: "platform-vm",
    },
  ] as const) {
    expect(tree).not.toContain(TreeSelection.key(selection));
    expect(TreeSelection.describeCommand(selection)).toEqual(Option.none);
  }
});
