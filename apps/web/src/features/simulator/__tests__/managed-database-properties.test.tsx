import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { run, session } from "@/engine/__tests__/setup";
import {
  ManagedDatabasePrelude,
  ManagedDatabaseSolutions,
} from "@/engine/missions/managed-databases";
import { TreeNode } from "@/engine/resource-tree";
import { TreeSelection } from "@/engine/resource-tree/selection";
import { ManagedDatabaseProperties } from "@/features/simulator/components/ManagedDatabaseProperties";
import { ServerlessProperties } from "@/features/simulator/components/ServerlessProperties";

test("Spanner properties show config, capacity and actual query results with a scoped describe", () => {
  const s = run(session(), ...ManagedDatabasePrelude, ...ManagedDatabaseSolutions.spanner);
  const selection = {
    kind: "managed-database" as const,
    collection: "spannerInstances" as const,
    projectId: "ace-dev-01",
    name: "global-app",
    instance: "",
    cluster: "",
  };
  render(<ManagedDatabaseProperties world={s.world} selection={selection} />);
  expect(screen.getByText("nam3")).toBeInTheDocument();
  expect(screen.getByText("2000 PU")).toBeInTheDocument();
  expect(screen.getByText(/"note":"committed"/)).toBeInTheDocument();
  const describe = TreeSelection.describeCommand(selection);
  expect(describe).toEqual({
    some: true,
    value: "gcloud spanner instances describe global-app --project=ace-dev-01",
  });
  if (describe.some) {
    expect(run(s, describe.value).text).toContain("2000");
  }
  expect(JSON.stringify(TreeNode.fromWorld(s.world))).toContain("Spanner: global-app");
});
test("Bigtable properties show replication lag and then the caught-up secondary", () => {
  const s = run(
    session(),
    ...ManagedDatabasePrelude,
    ...ManagedDatabaseSolutions.bigtableReplication.slice(0, 4),
  );
  const selection = {
    kind: "managed-database" as const,
    collection: "bigtableInstances" as const,
    projectId: "ace-dev-01",
    name: "replicated",
    instance: "",
    cluster: "",
  };
  const view = render(<ManagedDatabaseProperties world={s.world} selection={selection} />);
  expect(screen.getByText(/us-central1-b.*LAGGING/)).toBeInTheDocument();
  const updated = run(s, ...ManagedDatabaseSolutions.bigtableReplication.slice(4));
  view.rerender(<ManagedDatabaseProperties world={updated.world} selection={selection} />);
  expect(screen.getByText(/us-central1-b.*CAUGHT_UP/)).toBeInTheDocument();
  expect(screen.getByText(/"cluster":"secondary".*"value":"replicated"/)).toBeInTheDocument();
});
test("Firestore backup remains visible and describable after its source database is deleted", () => {
  const s = run(
    session(),
    ...ManagedDatabasePrelude,
    ...ManagedDatabaseSolutions.firestoreRestore,
    "gcloud firestore databases delete source-docs --location=us-central1 --quiet",
  );
  const selection = {
    kind: "managed-database" as const,
    collection: "firestoreCopies" as const,
    projectId: "ace-dev-01",
    name: "docs-copy",
    instance: "",
    cluster: "",
  };
  render(<ManagedDatabaseProperties world={s.world} selection={selection} />);
  expect(screen.getByText("source-docs")).toBeInTheDocument();
  expect(screen.getByText(/before/)).toBeInTheDocument();
  const describe = TreeSelection.describeCommand(selection);
  if (!describe.some) {
    throw new Error("Missing backup describe");
  }
  expect(run(s, describe.value).text).toContain("documentCount: 1");
  expect(JSON.stringify(TreeNode.fromWorld(s.world))).toContain("Firestore backup: docs-copy");
});
test("Redis properties show HA, failover count, current cache value and GET result", () => {
  const s = run(session(), ...ManagedDatabasePrelude, ...ManagedDatabaseSolutions.redisHa);
  render(
    <ServerlessProperties
      world={s.world}
      selection={{
        kind: "serverless-lab",
        collection: "redis",
        projectId: "ace-dev-01",
        name: "ha-cache",
        region: "us-central1",
        subtype: "",
      }}
    />,
  );
  expect(screen.getByText("STANDARD_HA / 1")).toBeInTheDocument();
  expect(screen.getByText("2 · no expiry")).toBeInTheDocument();
  expect(screen.getByText(/"value":"2".*"operation":"get"/)).toBeInTheDocument();
});
