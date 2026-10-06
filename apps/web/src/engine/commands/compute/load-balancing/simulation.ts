import { CommandFailure } from "@/engine/cli/command-failure";
import {
  type CommandSpec,
  Flag,
  ParsedArgs,
  type ParsedArgs as ParsedArgsType,
  Positional,
  type ProjectContext,
} from "@/engine/cli/command-spec";
import { ComputeApi } from "@/engine/commands/compute/shared";
import { CommonFlags, projectCommand } from "@/engine/commands/shared";
import type { Instance } from "@/engine/domains/compute";
import { Ipv4 } from "@/engine/domains/gke-control-plane";
import { ManagedInstanceGroup } from "@/engine/domains/instance-groups";
import { HealthCheck } from "@/engine/domains/load-balancing";
import {
  groupLink,
  lbBackend,
  lbFind,
  lbLink,
  lbProbe,
  lbRecord,
  lbReferences,
  validPort,
} from "@/engine/domains/load-balancing/graph";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";
import { forwardingArg } from "./forwarding";
import { groupArg } from "./lifecycle";
import { resourcePermission } from "./resources";
import {
  corePermission,
  finish,
  integer,
  invalid,
  replaceResource,
  requireLb,
  resourceArg,
  ScopeFlags,
  value,
} from "./shared";

const serveTargets = (
  ctx: ProjectContext,
  args: ParsedArgsType,
): Result<readonly Instance[], CommandFailure> => {
  const group = groupArg(ctx, args);
  const selected = value(args, "instance", "");
  if (Result.isOk(group)) {
    const g = group.value;
    if (selected !== "" && !g.instanceNames.includes(selected)) {
      return Result.err(CommandFailure.invalidArgumentWith("Unknown MIG member."));
    }
    return Result.ok(
      ctx.world.instances.filter(
        (v) =>
          v.projectId === g.projectId &&
          g.instanceNames.includes(v.name) &&
          v.zone === ManagedInstanceGroup.zoneFor(g.location, g.instanceNames.indexOf(v.name)) &&
          (selected === "" || selected === v.name),
      ),
    );
  }
  const zone = ParsedArgs.string(args, "zone");
  const vm = ctx.world.instances.find(
    (v) =>
      v.projectId === ctx.project.projectId &&
      v.name === ParsedArgs.requiredPositional(args, 0) &&
      Option.isSome(zone) &&
      v.zone === zone.value,
  );
  if (vm === undefined || selected !== "") {
    return group;
  }
  return Result.ok([vm]);
};
export const SimulationCommands: readonly CommandSpec[] = [
  projectCommand({
    path: ["sim", "load-balancing", "serve"],
    summary: "Set explicit simulated listeners for a VM or MIG (no startup script/code execution).",
    positionals: [Positional.required("NAME", "VM or MIG name.")],
    flags: [
      CommonFlags.zone,
      CommonFlags.region,
      Flag.string("instance", "One member VM; omitted selects all members."),
      Flag.integer("port", "Application listen port.", { required: true }),
      Flag.enum("protocol", "Application protocol.", ["HTTP", "HTTPS", "TCP", "UDP"]),
      Flag.string("path", "HTTP health response path (default /)."),
      Flag.integer("status-code", "HTTP response status; 0 simulates no listener."),
    ],
    permission: "compute.instances.setMetadata",
    requiredApis: [ComputeApi],
    run: (ctx, args) =>
      Result.flatMap(serveTargets(ctx, args), (members) => {
        const port = integer(args, "port", 0);
        const status = integer(args, "status-code", 200);
        const path = value(args, "path", "/");
        const _selected = value(args, "instance", "");
        if (
          !validPort(port) ||
          (status !== 0 && (status < 100 || status > 599)) ||
          !path.startsWith("/")
        ) {
          return invalid("Invalid listen port, HTTP status/path or MIG member name.");
        }
        if (members.length === 0) {
          return invalid("No matching member VMs.");
        }
        const instances = ctx.world.instances.map((v) =>
          members.includes(v)
            ? {
                ...v,
                metadata: {
                  ...v.metadata,
                  "sim-lb-port": String(port),
                  "sim-lb-protocol": value(args, "protocol", "HTTP"),
                  "sim-lb-path": path,
                  "sim-lb-status": String(status),
                },
              }
            : v,
        );
        return finish(
          { ...ctx.world, instances },
          { simulated: true, members: members.map((v) => v.name), port, status },
        );
      }),
  }),
  projectCommand({
    path: ["sim", "load-balancing", "probe"],
    summary:
      "Deterministic IPv4 connectivity/diagnostics; no packets, latency, DNS, cache hits or real HA.",
    positionals: [Positional.required("NAME", "Forwarding rule name.")],
    flags: [
      ...ScopeFlags,
      Flag.integer("port", "Frontend port (default 80)."),
      Flag.string("host", "HTTP host/TLS certificate domain."),
      Flag.string("path", "Request path."),
      Flag.string("source-ip", "Client source IPv4."),
      Flag.string("source-network", "Internal client's VPC."),
      Flag.string("source-region", "Internal client's region."),
      Flag.integer("min-healthy", "Required healthy count for this teaching check (default 1)."),
    ],
    permissions: [],
    requiredApis: [ComputeApi],
    run: (ctx, args) =>
      Result.flatMap(forwardingArg(ctx, args), (r) => {
        const allowed = requireLb(ctx, [corePermission("forwardingRules", r.scope, "get")]);
        if (!Result.isOk(allowed)) {
          return allowed;
        }
        const pending = [r.target ?? ""];
        const visited = new Set<string>();
        const permissions: string[] = [];
        while (pending.length > 0) {
          const reference = pending.pop() ?? "";
          if (visited.has(reference)) {
            continue;
          }
          visited.add(reference);
          const resource = lbFind(ctx.world, reference);
          if (resource !== undefined) {
            permissions.push(resourcePermission(resource.kind, resource.location, "get"));
            pending.push(...lbReferences(resource));
          }
          const backend = lbBackend(ctx.world, reference);
          if (backend !== undefined) {
            permissions.push(corePermission("backendServices", backend.scope, "get"));
          }
        }
        const readable = requireLb(ctx, [...new Set(permissions)]);
        if (!Result.isOk(readable)) {
          return readable;
        }
        const request = {
          host: value(args, "host", "example.test"),
          path: value(args, "path", "/"),
          port: integer(args, "port", 80),
          sourceIp: value(args, "source-ip", "198.51.100.10"),
          network: value(args, "source-network", ""),
          region: value(args, "source-region", ""),
          minHealthy: integer(args, "min-healthy", 1),
        };
        if (
          !validPort(request.port) ||
          request.minHealthy < 1 ||
          request.minHealthy > 1000 ||
          !request.path.startsWith("/") ||
          !Ipv4.address(request.sourceIp).some
        ) {
          return invalid("Invalid request port/path, IPv4 or min-healthy (1..1000).");
        }
        return finish(ctx.world, { simulated: true, ...lbProbe(ctx.world, r, request) });
      }),
  }),
  projectCommand({
    path: ["sim", "load-balancing", "activate-certificate"],
    summary:
      "Explicitly model managed certificate provisioning after connecting an HTTPS frontend.",
    positionals: [Positional.required("NAME", "Global certificate.")],
    flags: ScopeFlags,
    permissions: ["compute.sslCertificates.get", "compute.targetHttpsProxies.setSslCertificates"],
    requiredApis: [ComputeApi],
    run: (ctx, args) =>
      Result.flatMap(resourceArg(ctx, args, "sslCertificates"), (r) => {
        if (r.kind !== "sslCertificates") {
          return invalid("Expected a certificate.");
        }
        const proxies = ctx.world.lbResources
          .filter((p) => p.kind === "targetHttpsProxies" && p.sslCertificates.includes(lbLink(r)))
          .map(lbLink);
        if (
          !ctx.world.forwardingRules.some(
            (f) =>
              f.projectId === r.projectId &&
              f.scope.kind === "global" &&
              proxies.includes(f.target ?? "") &&
              f.portRange === "443",
          )
        ) {
          return invalid(
            "Connect the certificate to a global external HTTPS frontend on port 443 first.",
          );
        }
        const next = { ...r, status: "ACTIVE" as const };
        return finish(replaceResource(ctx.world, next), { ...lbRecord(next), simulated: true });
      }),
  }),
  projectCommand({
    path: ["sim", "load-balancing", "checkpoint"],
    summary: "Record a working LB before the cleanup mission; records names only, deletes nothing.",
    positionals: [Positional.required("NAME", "Forwarding rule.")],
    flags: ScopeFlags,
    permission: "compute.projects.setCommonInstanceMetadata",
    requiredApis: [ComputeApi],
    run: (ctx, args) =>
      Result.flatMap(forwardingArg(ctx, args), (r) => {
        const probe = lbProbe(ctx.world, r, {
          host: "example.test",
          path: "/",
          port: Number(r.portRange),
          sourceIp: "198.51.100.10",
          network: "",
          region: "",
          minHealthy: 2,
        });
        if (!probe.success) {
          return invalid(
            "Cleanup checkpoint requires a working external LB with two healthy backends.",
          );
        }
        if (
          r.name !== "cleanup-front" ||
          probe.chain.join("/") !== "cleanup-front/cleanup-proxy/cleanup-map/cleanup-backend"
        ) {
          return invalid("This checkpoint is reserved for the cleanup-front lesson chain.");
        }
        const required = [
          "cleanup-front",
          "cleanup-proxy",
          "cleanup-map",
          "cleanup-backend",
          "cleanup-hc",
          "cleanup-ip",
          "cleanup-group",
          "cleanup-template",
          "cleanup-health",
        ];
        const resources = [
          ...ctx.world.lbResources,
          ...ctx.world.forwardingRules,
          ...ctx.world.backendServices,
          ...ctx.world.healthChecks,
          ...ctx.world.addresses,
          ...ctx.world.instanceGroups,
          ...ctx.world.instanceTemplates,
          ...ctx.world.firewallRules,
        ].filter((x) => x.projectId === r.projectId);
        const group = ctx.world.instanceGroups.find(
          (g) => g.projectId === r.projectId && g.name === "cleanup-group",
        );
        const backend = ctx.world.backendServices.find(
          (b) => b.projectId === r.projectId && b.name === "cleanup-backend",
        );
        const check = ctx.world.healthChecks.find(
          (h) => h.projectId === r.projectId && h.name === "cleanup-hc",
        );
        if (
          group === undefined ||
          backend === undefined ||
          check === undefined ||
          group.template !== "cleanup-template" ||
          !backend.backends.includes(groupLink(group)) ||
          !backend.healthChecks.includes(HealthCheck.selfLink(check)) ||
          r.addressName !== "cleanup-ip" ||
          !required.every((name) => resources.some((x) => x.name === name))
        ) {
          return invalid(
            "Build all named cleanup lesson resources before recording the checkpoint.",
          );
        }
        const names = [...required, ...group.instanceNames];
        const metadata = ctx.world.projectMetadata.find((m) => m.projectId === r.projectId) ?? {
          projectId: r.projectId,
          items: {},
        };
        const next = {
          ...metadata,
          items: {
            ...metadata.items,
            [`sim-lb-cleanup/${r.name}`]: JSON.stringify([...new Set(names)]),
          },
        };
        const world = {
          ...ctx.world,
          projectMetadata: [
            ...ctx.world.projectMetadata.filter((m) => m.projectId !== r.projectId),
            next,
          ],
        };
        return finish(world, { checkpoint: r.name, resources: names });
      }),
  }),
];
