import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { run, session } from "@/engine/__tests__/setup";
import { AdminPrelude, AdminSolutions } from "@/engine/missions/admin-lab";
import { TreeNode, TreeSelection } from "@/engine/resource-tree";
import { AdminLabProperties } from "@/features/simulator/components/AdminLabProperties";

test("pending quotas show request and grant separately and appear in their scope", () => {
  const s = run(session(), ...AdminPrelude, AdminSolutions.quota[0]);
  const selection = {
    kind: "admin-lab",
    scope: "projects/ace-dev-01",
    collection: "quotas",
    name: "admin-cpus",
  } as const;
  render(<AdminLabProperties world={s.world} selection={selection} />);
  expect(screen.getByText("申請値").nextElementSibling).toHaveTextContent("32");
  expect(screen.getByText("承認値").nextElementSibling).toHaveTextContent("24");
  expect(screen.getByText("申請処理中").nextElementSibling).toHaveTextContent("はい");
  expect(JSON.stringify(TreeNode.fromWorld(s.world))).toContain(TreeSelection.key(selection));
});
test("organization identity and policy resources retain scope and working describe actions", () => {
  const s = run(session(), ...AdminPrelude, ...AdminSolutions.group, ...AdminSolutions.orgPap);
  const group = {
    kind: "admin-lab",
    scope: "organizations/123456789012",
    collection: "groups",
    name: "admin-readers@example.com",
  } as const;
  render(<AdminLabProperties world={s.world} selection={group} />);
  expect(screen.getByText("メンバー").nextElementSibling).toHaveTextContent("student@example.com");
  const describe = TreeSelection.describeCommand(group);
  expect(describe.some).toBe(true);
  if (describe.some) {
    expect(run(s, describe.value).text).toContain("student@example.com");
  }
  const tree = JSON.stringify(TreeNode.fromWorld(s.world));
  expect(tree).toContain(TreeSelection.key(group));
  expect(tree).toContain("storage.publicAccessPrevention");
  expect(
    Engine.completionCandidates(
      s.world,
      "gcloud identity groups memberships add --group-email=admin",
    ),
  ).toContain("--group-email=admin-readers@example.com");
});
