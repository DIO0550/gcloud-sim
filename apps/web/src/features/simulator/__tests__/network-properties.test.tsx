import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { run, session } from "@/engine/__tests__/setup";
import { NetworkPrelude, NetworkSolutions } from "@/engine/missions/network-lab";
import { TreeNode, TreeSelection } from "@/engine/resource-tree";
import { NetworkLabProperties } from "@/features/simulator/components/NetworkLabProperties";

test("NAT scope and reachability are displayed with a working scoped describe", () => {
  const s = run(session(), ...NetworkPrelude, ...NetworkSolutions.nat);
  const selection = {
    kind: "network-lab",
    collection: "nats",
    projectId: "ace-dev-01",
    name: "egress-nat",
    region: "us-central1",
    parent: "egress-router",
    subtype: "",
  } as const;
  render(<NetworkLabProperties world={s.world} selection={selection} />);
  expect(screen.getByText("subnets").nextElementSibling).toHaveTextContent("egress-subnet");
  expect(
    screen.getAllByText("egress-worker → internet").at(-1)?.nextElementSibling,
  ).toHaveTextContent("接続可能");
  const describe = TreeSelection.describeCommand(selection);
  expect(describe.some).toBe(true);
  if (describe.some) {
    expect(run(s, describe.value).text).toContain("router: egress-router");
  }
  expect(JSON.stringify(TreeNode.fromWorld(s.world))).toContain("nats: egress-nat");
});
test("DNS tree selections preserve zone and type for equal names", () => {
  const s = run(
    session(),
    ...NetworkPrelude,
    ...NetworkSolutions.dns,
    "gcloud dns record-sets create app.internal.example. --zone=internal --type=TXT --rrdatas=verified",
  );
  const selection = {
    kind: "network-lab",
    collection: "records",
    projectId: "ace-dev-01",
    name: "app.internal.example.",
    region: "global",
    parent: "internal",
    subtype: "TXT",
  } as const;
  render(<NetworkLabProperties world={s.world} selection={selection} />);
  expect(screen.getByText("data").nextElementSibling).toHaveTextContent("verified");
  const describe = TreeSelection.describeCommand(selection);
  if (describe.some) {
    expect(run(s, describe.value).text).toContain("type: TXT");
  }
  expect(TreeSelection.key(selection)).not.toEqual(
    TreeSelection.key({ ...selection, subtype: "A" }),
  );
});
test("hybrid details retain pending state and change after explicit activation", () => {
  const s = run(session(), ...NetworkPrelude, ...NetworkSolutions.interconnect.slice(0, 5));
  const selection = {
    kind: "network-lab",
    collection: "attachments",
    projectId: "ace-dev-01",
    name: "partner-vlan",
    region: "us-central1",
    parent: "partner-router",
    subtype: "",
  } as const;
  const view = render(<NetworkLabProperties world={s.world} selection={selection} />);
  expect(screen.getByText("state").nextElementSibling).toHaveTextContent("PENDING_PARTNER");
  const active = run(s, ...NetworkSolutions.interconnect.slice(5));
  view.rerender(<NetworkLabProperties world={active.world} selection={selection} />);
  expect(screen.getByText("state").nextElementSibling).toHaveTextContent("ACTIVE");
  expect(screen.getByText("peerAsn").nextElementSibling).toHaveTextContent("64514");
});
