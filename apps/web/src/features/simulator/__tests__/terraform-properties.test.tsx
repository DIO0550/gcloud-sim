import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { run, session } from "@/engine/__tests__/setup";
import { TerraformLessonSteps } from "@/engine/missions/terraform-lessons";
import { TreeNode, TreeSelection } from "@/engine/resource-tree";
import { TerraformProperties } from "@/features/simulator/components/TerraformProperties";

test("workspace masks sensitive outputs and every indexed tree command executes", () => {
  const secret = run(session(), ...TerraformLessonSteps.sensitive);
  render(
    <TerraformProperties
      world={secret.world}
      selection={{ kind: "terraform", collection: "workspace", name: "作業領域" }}
    />,
  );
  expect(screen.getByText("(sensitive value)")).toBeInTheDocument();
  expect(screen.queryByText("teaching-token-only")).not.toBeInTheDocument();
  const built = run(session(), ...TerraformLessonSteps.auto);
  const tree = JSON.stringify(TreeNode.fromWorld(built.world));
  for (const name of built.world.terraform.resources.map((r) => r.address)) {
    const selection = { kind: "terraform", collection: "resources", name } as const;
    expect(tree).toContain(JSON.stringify(TreeSelection.key(selection)).slice(1, -1));
    const command = TreeSelection.describeCommand(selection);
    expect(command.some).toBe(true);
    if (command.some) {
      expect(run(built, command.value).text).not.toContain("ERROR:");
    }
  }
});
