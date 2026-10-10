import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { run, session } from "@/engine/__tests__/setup";
import { StoragePrelude, StorageSolutions } from "@/engine/missions/storage-lab";
import { TreeNode, TreeSelection } from "@/engine/resource-tree";
import { BucketProperties } from "@/features/simulator/components/ServiceProperties";
import { StorageLabProperties } from "@/features/simulator/components/StorageLabProperties";

test("bucket properties show protection and historical generations", () => {
  const s = run(session(), ...StoragePrelude, ...StorageSolutions.recovery);
  render(
    <BucketProperties world={s.world} selection={{ kind: "bucket", name: "storage-recovery" }} />,
  );
  expect(screen.getByText("retentionPeriod").nextElementSibling).toHaveTextContent("0s");
  expect(screen.getByText("softDeleteRetention").nextElementSibling).toHaveTextContent("604800s");
  expect(screen.getByText("report.json#1").nextElementSibling).toHaveTextContent("NONCURRENT");
  expect(screen.getByText("report.json#2").nextElementSibling).toHaveTextContent("LIVE");
});
test("file resource tree and describe retain project, location and service", () => {
  const s = run(session(), ...StoragePrelude, ...StorageSolutions.netapp);
  const selection = {
    kind: "storage-lab",
    collection: "files",
    projectId: "ace-dev-01",
    name: "shared-volume",
    location: "us-central1",
    subtype: "netapp-volume",
  } as const;
  render(<StorageLabProperties world={s.world} selection={selection} />);
  expect(screen.getByText("pool").nextElementSibling).toHaveTextContent("shared-pool");
  expect(screen.getByText("capacity").nextElementSibling).toHaveTextContent("1024");
  const command = TreeSelection.describeCommand(selection);
  expect(command.some).toBe(true);
  if (command.some) {
    expect(run(s, command.value).text).toContain("state: READY");
  }
  expect(JSON.stringify(TreeNode.fromWorld(s.world))).toContain("netapp-volume: shared-volume");
  expect(TreeSelection.key({ ...selection, subtype: "netapp-pool" })).not.toBe(
    TreeSelection.key(selection),
  );
});
test("transfer properties expose real simulated failure and success results", () => {
  const ready = run(session(), ...StoragePrelude, ...StorageSolutions.transfer);
  const s = run(
    ready,
    "gcloud transfer jobs update transferJobs/storage-lesson --status=disabled",
    "gcloud transfer jobs run transferJobs/storage-lesson",
  );
  const selection = {
    kind: "storage-lab",
    collection: "transfers",
    projectId: "ace-dev-01",
    name: "transferJobs/storage-lesson",
    location: "",
    subtype: "",
  } as const;
  const view = render(<StorageLabProperties world={s.world} selection={selection} />);
  expect(screen.getByText("operation").nextElementSibling).toHaveTextContent("FAILED");
  expect(screen.getByText("error").nextElementSibling).toHaveTextContent("disabled");
  view.rerender(<StorageLabProperties world={ready.world} selection={selection} />);
  expect(screen.getByText("operation").nextElementSibling).toHaveTextContent("SUCCESS");
  expect(screen.getByText("copied").nextElementSibling).toHaveTextContent("1");
});
