import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Engine, Shell } from "@/engine";
import {
  type NetworkLesson,
  NetworkPrelude,
  NetworkSolutions,
} from "@/engine/missions/network-lab";
import { NetworkLabProperties } from "./NetworkLabProperties";

const worldFor = (lesson: NetworkLesson, end?: number) =>
  [...NetworkPrelude, ...NetworkSolutions[lesson].slice(0, end)].reduce(
    (world, line) =>
      Engine.execute({ world, shell: Shell.Ready, line, now: "2026-10-01T10:20:00Z" }).world,
    Engine.initialWorld("2026-10-01T10:20:00Z"),
  );
const meta = {
  title: "Simulator/NetworkLabProperties",
  component: NetworkLabProperties,
  args: {
    world: worldFor("nat"),
    selection: {
      kind: "network-lab",
      collection: "nats",
      projectId: "ace-dev-01",
      name: "egress-nat",
      region: "us-central1",
      parent: "egress-router",
      subtype: "",
    },
  },
} satisfies Meta<typeof NetworkLabProperties>;
export default meta;
type Story = StoryObj<typeof meta>;
export const NatReachability: Story = {};
export const PrivateDns: Story = {
  args: {
    world: worldFor("dns"),
    selection: {
      kind: "network-lab",
      collection: "records",
      projectId: "ace-dev-01",
      name: "app.internal.example.",
      region: "global",
      parent: "internal",
      subtype: "A",
    },
  },
};
export const VpnEstablished: Story = {
  args: {
    world: worldFor("vpn"),
    selection: {
      kind: "network-lab",
      collection: "bgpPeers",
      projectId: "ace-dev-01",
      name: "peer-0",
      region: "us-central1",
      parent: "hybrid-router",
      subtype: "",
    },
  },
};
export const InterconnectPending: Story = {
  args: {
    world: worldFor("interconnect", 5),
    selection: {
      kind: "network-lab",
      collection: "attachments",
      projectId: "ace-dev-01",
      name: "partner-vlan",
      region: "us-central1",
      parent: "partner-router",
      subtype: "",
    },
  },
};
export const SecureTagPolicy: Story = {
  args: {
    world: worldFor("ngfw"),
    selection: {
      kind: "network-lab",
      collection: "policies",
      projectId: "ace-dev-01",
      name: "organization-web",
      region: "global",
      parent: "",
      subtype: "",
    },
  },
};
