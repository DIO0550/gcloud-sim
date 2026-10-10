import { type CommandSpec, Flag, ParsedArgs } from "@/engine/cli/command-spec";
import { patchNetwork, same } from "@/engine/domains/network-lab/model";
import { Result } from "@/utils/Result";
import { command, finish, integer, invalid, lifecycle, missing, ref, rf, sf, text } from "./shared";

const gateway = ["gcloud", "compute", "vpn-gateways"];
const peerGateway = ["gcloud", "compute", "external-vpn-gateways"];
const tunnels = ["gcloud", "compute", "vpn-tunnels"];
const attachments = ["gcloud", "compute", "interconnects", "attachments"];
export const HybridCommands: readonly CommandSpec[] = [
  command(
    [...gateway, "create"],
    "compute.vpnGateways.create",
    (c, a) =>
      Result.flatMap(ref(c, a, true), (r) => {
        const created = { ...r, network: text(a, "network") };
        return finish(
          patchNetwork(c.world, { gateways: [...c.world.networkLab.gateways, created] }),
          created,
        );
      }),
    [rf, sf("network", true)],
  ),
  ...lifecycle(gateway, "gateways", "compute.vpnGateways", true),
  command(
    [...peerGateway, "create"],
    "compute.externalVpnGateways.create",
    (c, a) =>
      Result.flatMap(ref(c, a), (r) => {
        const spec = text(a, "interfaces").split(",");
        const ips = spec.map((s, index) => {
          const m = /^([01])=([0-9.]+)$/.exec(s);
          return m && Number(m[1]) === index ? (m[2] ?? "") : "";
        });
        const redundancy = text(a, "redundancy-type");
        if (
          (ips.length === 1 && redundancy !== "single-ip-internally-redundant") ||
          (ips.length === 2 && redundancy !== "two-ips-redundancy")
        ) {
          return invalid(
            "Use interface 0 (single-ip-internally-redundant), or interfaces 0 and 1 (two-ips-redundancy).",
          );
        }
        const created = { ...r, interfaces: ips };
        return finish(
          patchNetwork(c.world, { peerGateways: [...c.world.networkLab.peerGateways, created] }),
          created,
        );
      }),
    [
      sf("interfaces", true),
      Flag.enum(
        "redundancy-type",
        "Bounded peer topology.",
        ["single-ip-internally-redundant", "two-ips-redundancy"],
        { required: true },
      ),
    ],
  ),
  ...lifecycle(peerGateway, "peerGateways", "compute.externalVpnGateways"),
  command(
    [...tunnels, "create"],
    "compute.vpnTunnels.create",
    (c, a) =>
      Result.flatMap(ref(c, a, true), (r) => {
        if (integer(a, "ike-version", 2) !== 2 || text(a, "shared-secret").length < 8) {
          return invalid(
            "Use IKEv2 and a synthetic secret of at least 8 characters; the simulator does not store or verify real secrets.",
          );
        }
        const created = {
          ...r,
          gateway: text(a, "vpn-gateway"),
          peerGateway: text(a, "peer-external-gateway"),
          interface: integer(a, "interface", -1),
          peerInterface: integer(a, "peer-external-gateway-interface", -1),
          router: text(a, "router"),
          state: "DOWN" as const,
        };
        return finish(
          patchNetwork(c.world, { tunnels: [...c.world.networkLab.tunnels, created] }),
          created,
        );
      }),
    [
      rf,
      sf("vpn-gateway", true),
      sf("peer-external-gateway", true),
      Flag.integer("interface", "HA gateway interface 0 or 1.", { required: true }),
      Flag.integer("peer-external-gateway-interface", "Peer interface.", { required: true }),
      sf("router", true),
      Flag.integer("ike-version", "Only 2 is modeled."),
      sf("shared-secret", true),
    ],
  ),
  ...lifecycle(tunnels, "tunnels", "compute.vpnTunnels", true),
  command(
    ["gcloud", "compute", "routers", "add-interface"],
    "compute.routers.update",
    (c, a) =>
      Result.flatMap(ref(c, a, true), (r) => {
        const created = {
          ...r,
          name: text(a, "interface-name"),
          router: r.name,
          tunnel: text(a, "vpn-tunnel"),
          ip: text(a, "ip-address"),
          mask: integer(a, "mask-length", 30),
        };
        return finish(
          patchNetwork(c.world, { interfaces: [...c.world.networkLab.interfaces, created] }),
          created,
        );
      }),
    [
      rf,
      sf("interface-name", true),
      sf("vpn-tunnel", true),
      sf("ip-address", true),
      Flag.integer("mask-length", "Link-local /30 only."),
    ],
  ),
  command(
    ["gcloud", "compute", "routers", "add-bgp-peer"],
    "compute.routers.update",
    (c, a) =>
      Result.flatMap(ref(c, a, true), (r) => {
        const created = {
          ...r,
          name: text(a, "peer-name"),
          router: r.name,
          interface: text(a, "interface"),
          peerIp: text(a, "peer-ip-address"),
          peerAsn: integer(a, "peer-asn", 0),
          remotePrefix: "",
          state: "DOWN" as const,
        };
        return finish(
          patchNetwork(c.world, { bgpPeers: [...c.world.networkLab.bgpPeers, created] }),
          created,
        );
      }),
    [
      rf,
      sf("peer-name", true),
      sf("interface", true),
      sf("peer-ip-address", true),
      Flag.integer("peer-asn", "Peer public/private ASN; different from router ASN.", {
        required: true,
      }),
    ],
  ),
  command(
    ["sim", "network", "bgp", "establish"],
    "compute.routers.update",
    (c, a) =>
      Result.flatMap(ref(c, a, true), (r) => {
        const peer = c.world.networkLab.bgpPeers.find(
          (p) => same(p, r) && p.router === text(a, "router"),
        );
        if (!peer) {
          return missing("BGP peer not found on this router/region.");
        }
        const iface = c.world.networkLab.interfaces.find(
          (i) => same(i, { ...peer, name: peer.interface }) && i.router === peer.router,
        );
        const tunnel = c.world.networkLab.tunnels.find((t) =>
          same(t, { ...peer, name: iface?.tunnel ?? "" }),
        );
        if (!tunnel) {
          return missing("VPN tunnel is missing.");
        }
        const updated = { ...peer, state: "UP" as const, remotePrefix: text(a, "remote-prefix") };
        return finish(
          patchNetwork(c.world, {
            bgpPeers: c.world.networkLab.bgpPeers.map((p) => (p === peer ? updated : p)),
            tunnels: c.world.networkLab.tunnels.map((t) =>
              t === tunnel ? { ...t, state: "ESTABLISHED" as const } : t,
            ),
          }),
          updated,
        );
      }),
    [rf, sf("router", true), sf("remote-prefix", true)],
    true,
    "compute.googleapis.com",
    false,
    "bgpPeers",
  ),
  command(
    ["sim", "network", "bgp", "disconnect"],
    "compute.routers.update",
    (c, a) =>
      Result.flatMap(ref(c, a, true), (r) => {
        const peer = c.world.networkLab.bgpPeers.find(
          (p) => same(p, r) && p.router === text(a, "router"),
        );
        if (!peer) {
          return missing("BGP peer not found.");
        }
        const iface = c.world.networkLab.interfaces.find((i) =>
          same(i, { ...peer, name: peer.interface }),
        );
        return finish(
          patchNetwork(c.world, {
            bgpPeers: c.world.networkLab.bgpPeers.map((p) =>
              p === peer ? { ...p, state: "DOWN" as const } : p,
            ),
            tunnels: c.world.networkLab.tunnels.map((t) =>
              same(t, { ...peer, name: iface?.tunnel ?? "" })
                ? { ...t, state: "DOWN" as const }
                : t,
            ),
          }),
          { peer: peer.name, state: "DOWN" },
        );
      }),
    [rf, sf("router", true)],
    true,
    "compute.googleapis.com",
    false,
    "bgpPeers",
  ),
  ...["remove-bgp-peer", "remove-interface"].map((op) =>
    command(
      ["gcloud", "compute", "routers", op],
      "compute.routers.update",
      (c, a) =>
        Result.flatMap(ref(c, a, true), (r) => {
          const collection = op === "remove-bgp-peer" ? "bgpPeers" : "interfaces";
          const resource = c.world.networkLab[collection].find(
            (v) =>
              v.projectId === r.projectId &&
              v.region === r.region &&
              v.router === r.name &&
              v.name === text(a, op === "remove-bgp-peer" ? "peer-name" : "interface-name"),
          );
          if (!resource) {
            return missing("Router interface/peer not found in scope.");
          }
          return finish(
            patchNetwork(c.world, {
              [collection]: c.world.networkLab[collection].filter((v) => v !== resource),
            }),
            { deleted: resource.name },
          );
        }),
      [rf, sf(op === "remove-bgp-peer" ? "peer-name" : "interface-name", true)],
      true,
      "compute.googleapis.com",
      true,
    ),
  ),
  command(
    ["sim", "network", "hybrid", "describe"],
    "compute.routers.get",
    (c, a) =>
      Result.flatMap(ref(c, a, true), (r) => {
        const router = c.world.routers.find(
          (v) => v.projectId === r.projectId && v.region === r.region && v.name === r.name,
        );
        if (!router) {
          return missing("Cloud Router not found in this region.");
        }
        const peers = c.world.networkLab.bgpPeers.filter(
          (p) => p.projectId === r.projectId && p.region === r.region && p.router === r.name,
        );
        const up = peers.filter((p) => p.state === "UP");
        const interfaces = new Set(
          up.map((p) => {
            const i = c.world.networkLab.interfaces.find((i) =>
              same(i, { ...p, name: p.interface }),
            );
            return c.world.networkLab.tunnels.find((t) => same(t, { ...p, name: i?.tunnel ?? "" }))
              ?.interface;
          }),
        );
        return finish(c.world, {
          name: r.name,
          region: r.region,
          asn: router.asn,
          peers,
          haReady: interfaces.has(0) && interfaces.has(1),
          model: "Explicit simulated peer establishment; no VPN negotiation or SLA measurement.",
        });
      }),
    [rf],
  ),
  command(
    [...attachments, "partner", "create"],
    "compute.interconnectAttachments.create",
    (c, a) =>
      Result.flatMap(ref(c, a, true), (r) => {
        const edge = text(a, "edge-availability-domain", "availability-domain-1") as
          | "availability-domain-1"
          | "availability-domain-2";
        const created = {
          ...r,
          router: text(a, "router"),
          edge,
          enabled: ParsedArgs.boolean(a, "admin-enabled"),
          state: "PENDING_PARTNER" as const,
          remotePrefix: "",
          peerAsn: 0,
        };
        return finish(
          patchNetwork(c.world, { attachments: [...c.world.networkLab.attachments, created] }),
          created,
        );
      }),
    [
      rf,
      sf("router", true),
      Flag.enum("edge-availability-domain", "Independent edge.", [
        "availability-domain-1",
        "availability-domain-2",
      ]),
      Flag.boolean("admin-enabled", "Enable the virtual attachment."),
    ],
  ),
  ...lifecycle(attachments, "attachments", "compute.interconnectAttachments", true),
  command(
    ["sim", "network", "interconnect", "activate"],
    "compute.interconnectAttachments.update",
    (c, a) =>
      Result.flatMap(ref(c, a, true), (r) => {
        const attachment = c.world.networkLab.attachments.find((v) => same(v, r));
        if (!attachment) {
          return missing("Partner VLAN attachment not found.");
        }
        const updated = {
          ...attachment,
          enabled: true,
          state: "ACTIVE" as const,
          remotePrefix: text(a, "remote-prefix"),
          peerAsn: integer(a, "peer-asn", 0),
        };
        return finish(
          patchNetwork(c.world, {
            attachments: c.world.networkLab.attachments.map((v) =>
              v === attachment ? updated : v,
            ),
          }),
          updated,
        );
      }),
    [
      rf,
      sf("remote-prefix", true),
      Flag.integer("peer-asn", "Peer public/private ASN.", { required: true }),
    ],
    true,
    "compute.googleapis.com",
    false,
    "attachments",
  ),
  command(
    [...attachments, "partner", "update"],
    "compute.interconnectAttachments.update",
    (c, a) =>
      Result.flatMap(ref(c, a, true), (r) => {
        const attachment = c.world.networkLab.attachments.find((v) => same(v, r));
        if (!attachment) {
          return missing("Partner VLAN attachment not found.");
        }
        const enabled = ParsedArgs.boolean(a, "admin-enabled");
        const updated = {
          ...attachment,
          enabled,
          state: enabled ? attachment.state : ("PENDING_PARTNER" as const),
        };
        return finish(
          patchNetwork(c.world, {
            attachments: c.world.networkLab.attachments.map((v) =>
              v === attachment ? updated : v,
            ),
          }),
          updated,
        );
      }),
    [rf, Flag.boolean("admin-enabled", "Enable or disable attachment.", { required: true })],
    true,
    "compute.googleapis.com",
    false,
    "attachments",
  ),
];
