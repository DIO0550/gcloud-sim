import { CommandContext, type CommandSpec, Flag, ParsedArgs } from "@/engine/cli/command-spec";
import { Ipv4 } from "@/engine/domains/gke-control-plane";
import {
  type Check,
  evaluateConnection,
  natFor,
  patchNetwork,
  subnetOverlap,
} from "@/engine/domains/network-lab/model";
import { World } from "@/engine/domains/world";
import { Result } from "@/utils/Result";
import {
  command,
  finish,
  integer,
  invalid,
  lifecycle,
  list,
  missing,
  name,
  ref,
  rf,
  sf,
  text,
  zf,
} from "./shared";

const routes = ["gcloud", "compute", "routes"];
const nats = ["gcloud", "compute", "routers", "nats"];
export const NetworkCommands: readonly CommandSpec[] = [
  command(
    ["gcloud", "compute", "networks", "subnets", "expand-ip-range"],
    "compute.subnetworks.expandIpCidrRange",
    (c, a) =>
      Result.flatMap(CommandContext.resolveRegion(c, ParsedArgs.string(a, "region")), (region) => {
        const s = c.world.subnets.find(
          (s) => s.projectId === c.project.projectId && s.name === name(a) && s.region === region,
        );
        if (!s) {
          return missing("Subnetwork not found in this region.");
        }
        const next = Ipv4.range(text(a, "prefix"));
        const previous = Ipv4.range(s.ipCidrRange);
        if (
          !next.some ||
          !previous.some ||
          next.value.prefix >= previous.value.prefix ||
          next.value.start > previous.value.start ||
          next.value.start + next.value.size < previous.value.start + previous.value.size ||
          s.purpose === "REGIONAL_MANAGED_PROXY" ||
          subnetOverlap(c.world, s.projectId, s.network, text(a, "prefix"), s.name)
        ) {
          return invalid(
            "Expansion must strictly contain the old range, stay canonical and avoid VPC/peer subnet overlap; proxy-only expansion is not modeled.",
          );
        }
        const updated = { ...s, ipCidrRange: text(a, "prefix") };
        return finish(
          { ...c.world, subnets: c.world.subnets.map((v) => (v === s ? updated : v)) },
          updated,
        );
      }),
    [rf, sf("prefix", true)],
  ),
  command(
    [...routes, "create"],
    "compute.routes.create",
    (c, a) =>
      Result.flatMap(ref(c, a), (r) => {
        const network = text(a, "network", "default");
        if (!World.findNetwork(c.world, r.projectId, network).some) {
          return missing("Route VPC not found.");
        }
        const gateway = text(a, "next-hop-gateway");
        const tunnel = text(a, "next-hop-vpn-tunnel");
        if (Boolean(gateway) === Boolean(tunnel)) {
          return invalid(
            "Choose --next-hop-gateway=default-internet-gateway or an existing --next-hop-vpn-tunnel with --next-hop-vpn-tunnel-region.",
          );
        }
        if (gateway && gateway !== "default-internet-gateway") {
          return invalid("Only default-internet-gateway is modeled.");
        }
        const created = {
          ...r,
          network,
          destination: text(a, "destination-range"),
          priority: integer(a, "priority", 1000),
          nextHop: gateway || `${text(a, "next-hop-vpn-tunnel-region")}/${tunnel}`,
          tags: ParsedArgs.list(a, "tags"),
        };
        return finish(
          patchNetwork(c.world, { routes: [...c.world.networkLab.routes, created] }),
          created,
        );
      }),
    [
      sf("network"),
      sf("destination-range", true),
      Flag.integer("priority", "0..65535."),
      sf("next-hop-gateway"),
      sf("next-hop-vpn-tunnel"),
      sf("next-hop-vpn-tunnel-region"),
      Flag.list("tags", "Apply to these network tags."),
    ],
  ),
  ...lifecycle(routes, "routes", "compute.routes"),
  command(
    [...nats, "create"],
    "compute.routers.update",
    (c, a) =>
      Result.flatMap(ref(c, a, true), (r) => {
        if (!ParsedArgs.boolean(a, "auto-allocate-nat-external-ips")) {
          return invalid("This model requires --auto-allocate-nat-external-ips.");
        }
        const created = {
          ...r,
          router: text(a, "router"),
          subnets: ParsedArgs.list(a, "nat-custom-subnet-ip-ranges"),
          allSubnets: ParsedArgs.boolean(a, "nat-all-subnet-ip-ranges"),
          logging: ParsedArgs.boolean(a, "enable-logging"),
        };
        return finish(
          patchNetwork(c.world, { nats: [...c.world.networkLab.nats, created] }),
          created,
        );
      }),
    [
      rf,
      sf("router", true),
      Flag.boolean("auto-allocate-nat-external-ips", "Allocate virtual NAT IPs."),
      Flag.boolean("nat-all-subnet-ip-ranges", "All subnets in router VPC and region."),
      Flag.list("nat-custom-subnet-ip-ranges", "Named subnets; primary IPv4 only."),
      Flag.boolean("enable-logging", "Record explicit connectivity checks."),
    ],
  ),
  ...["list", "describe", "delete"].map((op) =>
    command(
      [...nats, op],
      op === "delete" ? "compute.routers.update" : "compute.routers.get",
      (c, a) =>
        Result.flatMap(
          CommandContext.resolveRegion(c, ParsedArgs.string(a, "region")),
          (region) => {
            const router = text(a, "router");
            if (
              !c.world.routers.some(
                (r) =>
                  r.projectId === c.project.projectId && r.region === region && r.name === router,
              )
            ) {
              return missing("NAT router not found in region.");
            }
            const all = c.world.networkLab.nats.filter(
              (n) =>
                n.projectId === c.project.projectId && n.region === region && n.router === router,
            );
            if (op === "list") {
              return list(c.world, all);
            }
            const found = all.find((n) => n.name === name(a));
            if (!found) {
              return missing("NAT configuration not found on this router.");
            }
            if (op === "delete") {
              return finish(
                patchNetwork(c.world, { nats: c.world.networkLab.nats.filter((n) => n !== found) }),
                { deleted: found.name },
              );
            }
            return finish(c.world, found);
          },
        ),
      [rf, sf("router", true)],
      op !== "list",
      "compute.googleapis.com",
      op === "delete",
      "nats",
    ),
  ),
  ...["enable", "disable"].map((op) =>
    command(
      ["gcloud", "compute", "shared-vpc", op],
      op === "enable"
        ? "compute.organizations.enableXpnHost"
        : "compute.organizations.disableXpnHost",
      (c, a) => {
        if (name(a) !== c.project.projectId) {
          return invalid("Set --project to the host project named in the command.");
        }
        const host = c.world.networkLab.shared.find((s) => s.host === name(a));
        if (op === "enable") {
          if (host || c.world.networkLab.shared.some((s) => s.services.includes(name(a)))) {
            return invalid("Already a host or service project.");
          }
          return finish(
            patchNetwork(c.world, {
              shared: [...c.world.networkLab.shared, { host: name(a), services: [] }],
            }),
            { host: name(a) },
          );
        }
        if (!host) {
          return missing("Shared VPC host not enabled.");
        }
        if (host.services.length > 0) {
          return invalid("Detach service projects before disabling a host.");
        }
        return finish(
          patchNetwork(c.world, { shared: c.world.networkLab.shared.filter((s) => s !== host) }),
          { disabled: name(a) },
        );
      },
    ),
  ),
  ...["add", "remove"].map((op) =>
    command(
      ["gcloud", "compute", "shared-vpc", "associated-projects", op],
      op === "add"
        ? "compute.organizations.enableXpnResource"
        : "compute.organizations.disableXpnResource",
      (c, a) => {
        const host = c.world.networkLab.shared.find((s) => s.host === text(a, "host-project"));
        if (
          !host ||
          host.host !== c.project.projectId ||
          !c.world.projects.some((p) => p.projectId === name(a))
        ) {
          return invalid(
            "Use an enabled --host-project as --project and an existing service project.",
          );
        }
        if (op === "add" && host.services.includes(name(a))) {
          return invalid("Service project already attached.");
        }
        if (op === "remove" && !host.services.includes(name(a))) {
          return missing("Service project not attached.");
        }
        if (
          op === "remove" &&
          c.world.instances.some(
            (i) =>
              i.projectId === name(a) &&
              i.networkInterfaces.some(
                (n) =>
                  c.world.networks.some((v) => v.projectId === host.host && v.name === n.network) &&
                  !c.world.networks.some(
                    (v) => v.projectId === i.projectId && v.name === n.network,
                  ),
              ),
          )
        ) {
          return invalid("Delete service-project VMs on host subnets before detaching.");
        }
        const updated = {
          ...host,
          services:
            op === "add" ? [...host.services, name(a)] : host.services.filter((p) => p !== name(a)),
        };
        return finish(
          patchNetwork(c.world, {
            shared: c.world.networkLab.shared.map((s) => (s === host ? updated : s)),
          }),
          { host: updated.host, services: updated.services },
        );
      },
      [sf("host-project", true)],
    ),
  ),
  command(
    ["gcloud", "compute", "shared-vpc", "get-host-project"],
    "compute.projects.get",
    (c, a) => {
      if (name(a) !== c.project.projectId) {
        return invalid("Use --project for the queried service project.");
      }
      const shared = c.world.networkLab.shared.find((s) => s.services.includes(name(a)));
      return shared
        ? finish(c.world, { hostProject: shared.host })
        : missing("No Shared VPC host attached.");
    },
  ),
  command(
    ["gcloud", "compute", "shared-vpc", "associated-projects", "list"],
    "compute.projects.get",
    (c) =>
      list(
        c.world,
        c.world.networkLab.shared
          .filter((s) => s.host === c.project.projectId)
          .flatMap((s) => s.services.map((name) => ({ name, host: s.host }))),
      ),
    [],
    false,
  ),
  command(
    ["gcloud", "compute", "networks", "peerings", "delete"],
    "compute.networks.removePeering",
    (c, a) => {
      const found = c.world.peerings.find(
        (p) =>
          p.projectId === c.project.projectId &&
          p.name === name(a) &&
          p.network === text(a, "network"),
      );
      if (!found) {
        return missing("Peering not found on this VPC.");
      }
      return finish(
        {
          ...c.world,
          peerings: c.world.peerings
            .filter((p) => p !== found)
            .map((p) =>
              p.projectId === found.peerProjectId &&
              p.network === found.peerNetwork &&
              p.peerProjectId === found.projectId &&
              p.peerNetwork === found.network
                ? { ...p, state: "INACTIVE" as const }
                : p,
            ),
        },
        { deleted: name(a) },
      );
    },
    [sf("network", true)],
    true,
    "compute.googleapis.com",
    true,
  ),
  command(
    ["sim", "network", "connectivity"],
    "compute.instances.get",
    (c, a) =>
      Result.flatMap(CommandContext.resolveZone(c, ParsedArgs.string(a, "zone")), (zone) => {
        const source = c.world.instances.find(
          (i) => i.projectId === c.project.projectId && i.zone === zone && i.name === name(a),
        );
        if (!source) {
          return missing("Source VM not found in this project/zone.");
        }
        const port = integer(a, "port", 443);
        if (port < 1 || port > 65535 || !Number.isInteger(port)) {
          return invalid("Port must be 1..65535.");
        }
        const check: Check = {
          projectId: c.project.projectId,
          name: name(a),
          region: zone.slice(0, -2),
          zone,
          destination: text(a, "destination"),
          destinationProject: text(a, "destination-project", c.project.projectId),
          destinationZone: text(a, "destination-zone", zone),
          protocol: text(a, "protocol", "tcp"),
          port,
          allowed: false,
          reason: "",
          dns: text(a, "dns-name"),
        };
        if (Boolean(check.destination) === Boolean(check.dns)) {
          return invalid("Choose --destination (VM, IPv4, internet or google-apis) or --dns-name.");
        }
        const decision = evaluateConnection(c.world, check);
        const completed = { ...check, allowed: decision.allowed, reason: decision.reason };
        const owner = source.networkInterfaces[0]?.networkProject ?? source.projectId;
        const subnet = c.world.subnets.find(
          (s) =>
            s.projectId === owner &&
            s.name === source.networkInterfaces[0]?.subnetwork &&
            s.region === check.region,
        );
        const logs = [...c.world.networkLab.logs];
        const nat = natFor(c.world, source);
        const usesNat =
          decision.allowed &&
          decision.reason === "internet-route" &&
          source.networkInterfaces.every((n) => n.externalIP.kind === "none");
        for (const kind of ["FLOW", "FIREWALL", "NAT"] as const) {
          if (
            (kind === "FLOW" && subnet?.flowLogs) ||
            (kind === "FIREWALL" && decision.logging) ||
            (kind === "NAT" && usesNat && nat?.logging)
          ) {
            logs.push({
              projectId: c.project.projectId,
              name: name(a),
              region: check.region,
              kind,
              source: name(a),
              destination: check.destination || check.dns,
              allowed: decision.allowed,
              rule: kind === "NAT" ? (nat?.name ?? "") : decision.rule,
            });
          }
        }
        return finish(
          patchNetwork(c.world, {
            checks: [...c.world.networkLab.checks, completed].slice(-100),
            logs: logs.slice(-100),
          }),
          {
            ...completed,
            model: "Configuration reachability only; no packets/application response.",
          },
        );
      }),
    [
      zf,
      sf("destination"),
      sf("destination-project"),
      sf("destination-zone"),
      sf("dns-name"),
      Flag.enum("protocol", "Protocol.", ["tcp", "udp", "icmp"]),
      Flag.integer("port", "Destination port; default 443."),
    ],
  ),
  command(
    ["sim", "network", "logs", "list"],
    "compute.networks.get",
    (c) =>
      list(
        c.world,
        c.world.networkLab.logs.filter((l) => l.projectId === c.project.projectId),
      ),
    [],
    false,
  ),
];
