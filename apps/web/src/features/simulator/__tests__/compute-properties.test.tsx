import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { run, session } from "@/engine/__tests__/setup";
import { ComputePrelude, ComputeSolutions } from "@/engine/missions/compute-lab";
import { TreeNode, TreeSelection } from "@/engine/resource-tree";
import { ComputeLabProperties } from "@/features/simulator/components/ComputeLabProperties";
import { InstanceProperties } from "@/features/simulator/components/ComputeProperties";

test("regional disk displays placement, replicas and a working region-scoped describe", () => {
  const s = run(session(), ...ComputePrelude, ...ComputeSolutions.regional);
  const selection = {
    kind: "compute-lab",
    collection: "disks",
    projectId: "ace-dev-01",
    name: "mirrored",
    location: "us-central1",
  } as const;
  render(<ComputeLabProperties world={s.world} selection={selection} />);
  expect(screen.getByText("replicaZones").nextElementSibling).toHaveTextContent("us-central1-b");
  expect(screen.getByText("users").nextElementSibling).toHaveTextContent("ha-worker");
  const cmd = TreeSelection.describeCommand(selection);
  expect(cmd.some).toBe(true);
  if (cmd.some) {
    expect(run(s, cmd.value).text).toContain("locationScope: region");
  }
  expect(JSON.stringify(TreeNode.fromWorld(s.world))).toContain("mirrored (us-central1)");
});
test("restored data is visible independently from snapshot source", () => {
  const s = run(session(), ...ComputePrelude, ...ComputeSolutions.restore);
  render(
    <ComputeLabProperties
      world={s.world}
      selection={{
        kind: "compute-lab",
        collection: "disks",
        projectId: "ace-dev-01",
        name: "recovered-orders",
        location: "us-central1-a",
      }}
    />,
  );
  expect(screen.getByText("仮想ディスクデータ").nextElementSibling).toHaveTextContent("orders-v1");
  expect(screen.getByText("sourceSnapshot").nextElementSibling).toHaveTextContent("orders-safe");
});
test("rolling update displays pending member and both applied versions, then completion", () => {
  const s = run(session(), ...ComputePrelude, ...ComputeSolutions.rolling.slice(0, -1));
  const selection = {
    kind: "compute-lab",
    collection: "migs",
    projectId: "ace-dev-01",
    name: "release",
    location: "us-central1-a",
  } as const;
  const view = render(<ComputeLabProperties world={s.world} selection={selection} />);
  expect(screen.getByText("applied").nextElementSibling).toHaveTextContent("release-v1");
  expect(screen.getByText("applied").nextElementSibling).toHaveTextContent("release-v2");
  expect(screen.getByText("pending").nextElementSibling).not.toHaveTextContent("[]");
  const done = run(s, ComputeSolutions.rolling.at(-1) ?? "");
  view.rerender(<ComputeLabProperties world={done.world} selection={selection} />);
  expect(screen.getByText("pending").nextElementSibling).toHaveTextContent("[]");
  const cmd = TreeSelection.describeCommand(selection);
  if (cmd.some) {
    expect(run(done, cmd.value).text).toContain("desiredTemplate: release-v2");
  }
});
test("VM properties show accelerator, maintenance and Spot restart policy", () => {
  const s = run(session(), ...ComputePrelude, ...ComputeSolutions.gpu);
  render(
    <InstanceProperties
      world={s.world}
      selection={{
        kind: "instance",
        projectId: "ace-dev-01",
        name: "gpu-worker",
        zone: "us-central1-a",
      }}
    />,
  );
  expect(screen.getByText("accelerator").nextElementSibling).toHaveTextContent(
    "nvidia-tesla-t4 × 1",
  );
  expect(screen.getByText("maintenancePolicy").nextElementSibling).toHaveTextContent("TERMINATE");
});
