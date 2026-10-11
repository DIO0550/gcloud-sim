import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { run, session } from "@/engine/__tests__/setup";
import { aiSolutions } from "@/engine/missions/ace-support";
import { TreeNode, TreeSelection } from "@/engine/resource-tree";
import { AceSupportProperties } from "@/features/simulator/components/AceSupportProperties";

test("AI records appear under their project and have executable describe commands", () => {
  const s = run(
    session(),
    ...aiSolutions("notebook"),
    "sim ace scenarios choose platform-vm --choice=gce --reason='VM OS control'",
  );
  const tree = JSON.stringify(TreeNode.fromWorld(s.world));
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
    expect(tree).toContain(TreeSelection.key(selection));
    const command = TreeSelection.describeCommand(selection);
    if (!command.some) {
      throw new Error("Missing describe command");
    }
    expect(run(s, command.value).text).not.toContain("ERROR:");
  }
  render(
    <AceSupportProperties
      world={s.world}
      selection={{
        kind: "ace-support",
        collection: "resources",
        projectId: "ace-dev-01",
        region: "us-central1",
        name: "ace-notebook",
      }}
    />,
  );
  expect(screen.getByText("RUNNING")).toBeInTheDocument();
  expect(screen.getByText("private")).toBeInTheDocument();
  expect(screen.getByText(/実agent・VM・IDEは起動せず/)).toBeInTheDocument();
});

test("wrong decisions render their requirements, recorded reason and explanation without claiming a pass", () => {
  const s = run(
    session(),
    "sim ace scenarios choose platform-vm --choice=gke --reason='test reasoning'",
  );
  render(
    <AceSupportProperties
      world={s.world}
      selection={{
        kind: "ace-support",
        collection: "decisions",
        projectId: "ace-dev-01",
        region: "",
        name: "platform-vm",
      }}
    />,
  );
  expect(screen.getByText("見直し")).toBeInTheDocument();
  expect(screen.getByText("test reasoning")).toBeInTheDocument();
  expect(screen.getByText(/自由文の意味は採点しません/)).toBeInTheDocument();
});
