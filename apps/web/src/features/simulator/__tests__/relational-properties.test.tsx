import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { run, session } from "@/engine/__tests__/setup";
import { RelationalPrelude, RelationalSolutions } from "@/engine/missions/relational";
import { TreeNode } from "@/engine/resource-tree";
import { TreeSelection } from "@/engine/resource-tree/selection";
import { RelationalProperties } from "@/features/simulator/components/RelationalProperties";
import { SqlInstanceProperties } from "@/features/simulator/components/ServiceProperties";

test("SQL properties show private HA, failover and actual query data", () => {
  const s = run(session(), ...RelationalPrelude, ...RelationalSolutions.ha);
  render(
    <SqlInstanceProperties
      world={s.world}
      selection={{ kind: "sql-instance", projectId: "ace-dev-01", name: "ha-db" }}
    />,
  );
  expect(screen.getByText("POSTGRES_16 / REGIONAL")).toBeInTheDocument();
  expect(screen.getByText("public IP無効")).toBeInTheDocument();
  expect(screen.getByText("us-central1 / us-central1-b")).toBeInTheDocument();
  expect(screen.getByText(/private · affected=0.*before/)).toBeInTheDocument();
});
test("DMS selected job shows CDC/promotion and resource tree describe uses its project/region", () => {
  const s = run(session(), ...RelationalPrelude, ...RelationalSolutions.migration);
  const selection = {
    kind: "relational" as const,
    resource: "dms-job" as const,
    projectId: "ace-dev-01",
    name: "move-app",
    region: "us-central1",
    cluster: "",
  };
  render(<RelationalProperties world={s.world} selection={selection} />);
  expect(screen.getByText("COMPLETED")).toBeInTheDocument();
  expect(screen.getByText("PROMOTED")).toBeInTheDocument();
  expect(TreeSelection.describeCommand(selection)).toEqual({
    some: true,
    value:
      "gcloud database-migration migration-jobs describe move-app --region=us-central1 --project=ace-dev-01",
  });
  expect(JSON.stringify(TreeNode.fromWorld(s.world))).toContain("DMS: move-app");
});
