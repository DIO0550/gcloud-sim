import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { run, session } from "@/engine/__tests__/setup";
import { DataPrelude, DataSolutions } from "@/engine/missions/data-processing";
import { TreeNode, TreeSelection } from "@/engine/resource-tree";
import { DataProcessingProperties } from "@/features/simulator/components/DataProcessingProperties";
import { SubscriptionProperties } from "@/features/simulator/components/ServiceProperties";

test("BigQuery properties show real schema/rows/query and generate a scoped command", () => {
  const s = run(session(), ...DataPrelude, ...DataSolutions.load);
  const selection = {
    kind: "data-processing",
    collection: "tables",
    projectId: "ace-dev-01",
    name: "orders",
    location: "US",
    parent: "warehouse",
    jobKind: "",
  } as const;
  render(<DataProcessingProperties world={s.world} selection={selection} />);
  expect(screen.getByText(/"type":"INT64"/)).toBeInTheDocument();
  expect(screen.getByText("rows").nextElementSibling).toHaveTextContent('"amount":20');
  expect(screen.getByText(/"total":30/)).toBeInTheDocument();
  const describe = TreeSelection.describeCommand(selection);
  expect(describe).toEqual({
    some: true,
    value: "bq show warehouse.orders --location=US --project=ace-dev-01",
  });
  if (describe.some) {
    expect(run(s, describe.value).text).toContain("alice");
  }
  expect(JSON.stringify(TreeNode.fromWorld(s.world))).toContain("warehouse/orders");
});
test("failed and recovered jobs expose their state/error, source and output", () => {
  const end = DataSolutions.recovery.findIndex((s) => s.includes("retry recover"));
  const s = run(session(), ...DataPrelude, ...DataSolutions.recovery.slice(0, end));
  const selection = {
    kind: "data-processing",
    collection: "processingJobs",
    projectId: "ace-dev-01",
    name: "recover-job",
    location: "us-central1",
    parent: "",
    jobKind: "dataflow",
  } as const;
  const view = render(<DataProcessingProperties world={s.world} selection={selection} />);
  expect(screen.getByText("FAILED")).toBeInTheDocument();
  expect(screen.getByText("error").nextElementSibling).toHaveTextContent("NDJSON row must");
  const done = run(s, ...DataSolutions.recovery.slice(end));
  view.rerender(<DataProcessingProperties world={done.world} selection={selection} />);
  expect(screen.getByText("DONE")).toBeInTheDocument();
  expect(screen.getByText("recover.orders")).toBeInTheDocument();
  const describe = TreeSelection.describeCommand(selection);
  if (describe.some) {
    expect(run(done, describe.value).text).toContain("DONE");
  }
});
test("subscription properties show retry count, ACK and virtual deadlines", () => {
  const s = run(session(), ...DataPrelude, ...DataSolutions.redelivery);
  render(
    <SubscriptionProperties
      world={s.world}
      selection={{ kind: "subscription", projectId: "ace-dev-01", name: "retry-events" }}
    />,
  );
  expect(screen.getByText(/"attempts":2.*"state":"ACKED"/)).toBeInTheDocument();
  expect(screen.getByText("virtualClock")).toBeInTheDocument();
  expect(screen.getByText("retentionSeconds")).toBeInTheDocument();
});
test("Kafka properties show private subnet/capacity and tested SASL/TLS connection", () => {
  const s = run(session(), ...DataPrelude, ...DataSolutions.kafka);
  const selection = {
    kind: "data-processing",
    collection: "kafkaClusters",
    projectId: "ace-dev-01",
    name: "event-kafka",
    location: "us-central1",
    parent: "",
    jobKind: "",
  } as const;
  render(<DataProcessingProperties world={s.world} selection={selection} />);
  expect(screen.getByText("kafka-subnet")).toBeInTheDocument();
  expect(screen.getByText("3221225472")).toBeInTheDocument();
  expect(screen.getByText(/"auth":"SASL_IAM","tls":true/)).toBeInTheDocument();
  const describe = TreeSelection.describeCommand(selection);
  if (describe.some) {
    expect(run(s, describe.value).text).toContain("kafka-subnet");
  }
});
