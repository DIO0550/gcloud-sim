import { CommandFailure } from "@/engine/cli/command-failure";
import {
  CommandContext,
  type CommandSpec,
  Flag,
  ParsedArgs,
  Positional,
  type ProjectContext,
} from "@/engine/cli/command-spec";
import { ComputeApi } from "@/engine/commands/compute/shared";
import { removeVmLab } from "@/engine/commands/compute-lab/vms";
import { Candidates, CommonFlags, projectCommand } from "@/engine/commands/shared";
import { Zone } from "@/engine/domains/catalog";
import { patchCompute, sameRef } from "@/engine/domains/compute-lab/model";
import { Address } from "@/engine/domains/compute-networking";
import { ManagedInstanceGroup } from "@/engine/domains/instance-groups";
import { BackendService, HealthCheck, LbScope } from "@/engine/domains/load-balancing";
import { groupLink, lbLink, lbReferences, validPort } from "@/engine/domains/load-balancing/graph";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";
import { forwardingArg } from "./forwarding";
import { backendArg } from "./index";
import { ResourcePaths, resourcePermission } from "./resources";
import { finish, invalid, requireLb, resolveScope, resourceArg, ScopeFlags } from "./shared";

export const groupArg = (
  ctx: ProjectContext,
  args: ParsedArgs,
): Result<ManagedInstanceGroup, CommandFailure> => {
  const zone = ParsedArgs.string(args, "zone");
  const region = ParsedArgs.string(args, "region");
  if (Option.isSome(zone) && Option.isSome(region)) {
    return Result.err(CommandFailure.invalidArgumentWith("Choose group --zone or --region."));
  }
  const location = Option.isSome(region)
    ? CommandContext.resolveRegion(ctx, region)
    : CommandContext.resolveZone(ctx, zone);
  return Result.flatMap(location, (l) =>
    Option.toResult(
      World.findLocated(ctx.world, "instanceGroups", {
        projectId: ctx.project.projectId,
        name: ParsedArgs.requiredPositional(args, 0),
        location: l,
      }),
      () =>
        CommandFailure.notFound(`instanceGroups/${ParsedArgs.requiredPositional(args, 0)}/${l}`),
    ),
  );
};
export const lbUsed = (world: World, ref: string): boolean =>
  world.lbResources.some((r) => lbReferences(r).includes(ref)) ||
  world.backendServices.some((b) => b.backends.includes(ref) || b.healthChecks.includes(ref)) ||
  world.forwardingRules.some(
    (r) =>
      r.target === ref ||
      (r.target === undefined && ref.endsWith(`/backendServices/${r.backendService}`)),
  );
const namedPortFlags = [
  CommonFlags.zone,
  CommonFlags.region,
  Flag.list("named-ports", "Named ports: http:80,https:443. Empty list clears ports.", {
    required: true,
  }),
];
const nameArg = Positional.required("NAME", "Resource name.");
export const LifecycleCommands: readonly CommandSpec[] = [
  projectCommand({
    path: ["gcloud", "compute", "instance-groups", "managed", "list-instances"],
    summary: "List only VMs belonging to the scoped managed instance group.",
    positionals: [nameArg],
    flags: [CommonFlags.zone, CommonFlags.region],
    permission: "compute.instanceGroupManagers.get",
    requiredApis: [ComputeApi],
    run: (ctx, args) =>
      Result.flatMap(groupArg(ctx, args), (g) =>
        finish(ctx.world, {
          name: g.name,
          instances: ctx.world.instances
            .filter(
              (v) =>
                v.projectId === g.projectId &&
                g.instanceNames.includes(v.name) &&
                v.zone ===
                  ManagedInstanceGroup.zoneFor(g.location, g.instanceNames.indexOf(v.name)),
            )
            .map((v) => ({
              instance: v.name,
              zone: v.zone,
              status: v.status,
              applicationPort: Number(v.metadata["sim-lb-port"] ?? 0),
            })),
        }),
      ),
  }),
  ...[
    ["instance-groups", "managed", "set-named-ports"],
    ["instance-groups", "set-named-ports"],
  ].map((path) =>
    projectCommand({
      path: ["gcloud", "compute", ...path],
      summary: "Set MIG named ports; this does not start an application or open a firewall.",
      positionals: [Positional.required("NAME", "MIG name.", Candidates.named("instanceGroups"))],
      flags: namedPortFlags,
      permission: "compute.instanceGroups.setNamedPorts",
      requiredApis: [ComputeApi],
      run: (ctx, args) =>
        Result.flatMap(groupArg(ctx, args), (g) => {
          const ports = ParsedArgs.list(args, "named-ports").map((p) => {
            const [name, port, ...extra] = p.split(":");
            return { name: name ?? "", port: Number(port), invalid: extra.length > 0 };
          });
          if (
            ports.some(
              (p) => p.invalid || !/^[a-z][a-z0-9-]{0,62}$/.test(p.name) || !validPort(p.port),
            ) ||
            new Set(ports.map((p) => `${p.name}:${p.port}`)).size !== ports.length
          ) {
            return invalid("Invalid/duplicate named port; use name:1..65535.");
          }
          const next = { ...g, namedPorts: ports.map(({ name, port }) => ({ name, port })) };
          return finish(World.replaceNamed(ctx.world, "instanceGroups", next), {
            name: g.name,
            namedPorts: next.namedPorts,
          });
        }),
    }),
  ),
  projectCommand({
    path: ["gcloud", "compute", "instance-groups", "get-named-ports"],
    summary: "Show MIG named ports.",
    positionals: [nameArg],
    flags: [CommonFlags.zone, CommonFlags.region],
    permission: "compute.instanceGroups.get",
    requiredApis: [ComputeApi],
    run: (ctx, args) =>
      Result.flatMap(groupArg(ctx, args), (g) =>
        finish(ctx.world, { name: g.name, namedPorts: g.namedPorts ?? [] }),
      ),
  }),
  ...Object.entries(ResourcePaths).map(([key, path]) => {
    const kind = key as keyof typeof ResourcePaths;
    return projectCommand({
      path: ["gcloud", "compute", path, "delete"],
      summary: `Delete ${path} after dependents.`,
      positionals: [nameArg],
      flags: kind === "networkEndpointGroups" ? [CommonFlags.zone] : ScopeFlags,
      destructive: true,
      permissions: [],
      requiredApis: [ComputeApi],
      run: (ctx, args) =>
        Result.flatMap(resourceArg(ctx, args, kind), (r) => {
          const permission = requireLb(ctx, [resourcePermission(kind, r.location, "delete")]);
          if (!Result.isOk(permission)) {
            return permission;
          }
          if (lbUsed(ctx.world, lbLink(r))) {
            return invalid("Resource is still referenced. Delete dependents first.");
          }
          return finish(World.withoutNamed(ctx.world, "lbResources", r), { deleted: lbLink(r) });
        }),
    });
  }),
  projectCommand({
    path: ["gcloud", "compute", "health-checks", "delete"],
    summary: "Delete an unused scoped health check.",
    positionals: [nameArg],
    flags: ScopeFlags,
    destructive: true,
    permissions: [],
    requiredApis: [ComputeApi],
    run: (ctx, args) =>
      Result.flatMap(resolveScope(ctx, args, true), (scope) => {
        const permission = requireLb(ctx, [
          scope.kind === "global"
            ? "compute.healthChecks.delete"
            : "compute.regionHealthChecks.delete",
        ]);
        if (!Result.isOk(permission)) {
          return permission;
        }
        const h = ctx.world.healthChecks.find(
          (h) =>
            h.projectId === ctx.project.projectId &&
            h.name === ParsedArgs.requiredPositional(args, 0) &&
            LbScope.equals(h.scope ?? LbScope.Global, scope),
        );
        if (h === undefined) {
          return Result.err(CommandFailure.notFound("healthChecks"));
        }
        if (
          ctx.world.computeLab.migs.some(
            (m) => m.projectId === h.projectId && m.healthCheck === h.name,
          ) ||
          lbUsed(ctx.world, HealthCheck.selfLink(h)) ||
          ctx.world.backendServices.some(
            (b) => b.projectId === h.projectId && b.healthChecks.includes(h.name),
          )
        ) {
          return invalid("Health check is still referenced by a backend service.");
        }
        return finish(World.withoutNamed(ctx.world, "healthChecks", h), {
          deleted: HealthCheck.selfLink(h),
        });
      }),
  }),
  projectCommand({
    path: ["gcloud", "compute", "backend-services", "delete"],
    summary: "Delete a backend after frontends and URL maps.",
    positionals: [nameArg],
    flags: ScopeFlags,
    destructive: true,
    permission: "compute.backendServices.delete",
    requiredApis: [ComputeApi],
    run: (ctx, args) =>
      Result.flatMap(backendArg(ctx, args), (b) =>
        lbUsed(ctx.world, BackendService.selfLink(b))
          ? invalid("Backend service is still referenced.")
          : finish(World.withoutNamed(ctx.world, "backendServices", b), { deleted: b.name }),
      ),
  }),
  projectCommand({
    path: ["gcloud", "compute", "forwarding-rules", "delete"],
    summary: "Delete frontend and release its reserved address.",
    positionals: [nameArg],
    flags: ScopeFlags,
    destructive: true,
    permission: "compute.forwardingRules.delete",
    requiredApis: [ComputeApi],
    run: (ctx, args) =>
      Result.flatMap(forwardingArg(ctx, args), (r) => {
        const world = World.withoutNamed(ctx.world, "forwardingRules", r);
        return finish(
          {
            ...world,
            addresses: world.addresses.map((a) =>
              a.projectId === r.projectId &&
              a.address === r.ipAddress &&
              !world.forwardingRules.some(
                (f) => f.projectId === a.projectId && f.ipAddress === a.address,
              )
                ? { ...a, status: "RESERVED" }
                : a,
            ),
          },
          { deleted: r.name },
        );
      }),
  }),
  projectCommand({
    path: ["gcloud", "compute", "addresses", "delete"],
    summary: "Delete an unused reserved address.",
    positionals: [nameArg],
    flags: ScopeFlags,
    destructive: true,
    permission: "compute.addresses.delete",
    requiredApis: [ComputeApi],
    run: (ctx, args) =>
      Result.flatMap(resolveScope(ctx, args), (scope) => {
        const a = ctx.world.addresses.find(
          (a) =>
            a.projectId === ctx.project.projectId &&
            a.name === ParsedArgs.requiredPositional(args, 0) &&
            Address.selfLink(a).includes(`/${LbScope.toPath(scope)}/addresses/`),
        );
        if (a === undefined) {
          return Result.err(CommandFailure.notFound("addresses"));
        }
        if (
          a.status === "IN_USE" ||
          ctx.world.forwardingRules.some(
            (r) => r.projectId === a.projectId && r.ipAddress === a.address,
          )
        ) {
          return invalid("Address is still in use.");
        }
        return finish(World.withoutNamed(ctx.world, "addresses", a), { deleted: a.name });
      }),
  }),
  projectCommand({
    path: ["gcloud", "compute", "instance-groups", "managed", "delete"],
    summary: "Delete an unused MIG and only its own member VMs.",
    positionals: [nameArg],
    flags: [CommonFlags.zone, CommonFlags.region],
    destructive: true,
    permission: "compute.instanceGroupManagers.delete",
    requiredApis: [ComputeApi],
    run: (ctx, args) =>
      Result.flatMap(groupArg(ctx, args), (g) => {
        if (lbUsed(ctx.world, groupLink(g))) {
          return invalid("MIG is still a backend. Remove it or delete the backend first.");
        }
        const members = ctx.world.instances.filter(
          (v) =>
            v.projectId === g.projectId &&
            g.instanceNames.includes(v.name) &&
            v.zone === ManagedInstanceGroup.zoneFor(g.location, g.instanceNames.indexOf(v.name)),
        );
        if (
          ctx.world.lbResources.some(
            (r) =>
              r.kind === "networkEndpointGroups" &&
              r.projectId === g.projectId &&
              r.endpoints.some((e) =>
                members.some((v) => e.instance === v.name && `zones/${v.zone}` === r.location),
              ),
          )
        ) {
          return invalid("MIG member VM is still a NEG endpoint.");
        }
        const world = members.reduce(
          (w, v) => removeVmLab(World.withoutInstance(w, v), v),
          World.withoutNamed(ctx.world, "instanceGroups", g),
        );
        const cleaned = patchCompute(world, {
          migs: world.computeLab.migs.filter((m) => !sameRef(m, g)),
        });
        return finish(cleaned, { deleted: g.name, members: members.map((v) => v.name) });
      }),
  }),
  projectCommand({
    path: ["gcloud", "compute", "instance-templates", "delete"],
    summary: "Delete an unused instance template.",
    positionals: [nameArg],
    destructive: true,
    permission: "compute.instanceTemplates.delete",
    requiredApis: [ComputeApi],
    run: (ctx, args) => {
      const t = ctx.world.instanceTemplates.find(
        (t) =>
          t.projectId === ctx.project.projectId &&
          t.name === ParsedArgs.requiredPositional(args, 0),
      );
      if (t === undefined) {
        return Result.err(CommandFailure.notFound("instanceTemplates"));
      }
      if (
        ctx.world.instanceGroups.some(
          (g) => g.projectId === t.projectId && g.template === t.name,
        ) ||
        ctx.world.computeLab.migs.some(
          (m) =>
            m.projectId === t.projectId &&
            (m.desiredTemplate === t.name || Object.values(m.applied).includes(t.name)),
        )
      ) {
        return invalid("Template is still referenced by a MIG.");
      }
      return finish(World.withoutNamed(ctx.world, "instanceTemplates", t), { deleted: t.name });
    },
  }),
  projectCommand({
    path: ["gcloud", "compute", "networks", "subnets", "delete"],
    summary: "Delete an unused subnet after frontends, proxies and VMs.",
    positionals: [nameArg],
    flags: [CommonFlags.region],
    destructive: true,
    permission: "compute.subnetworks.delete",
    requiredApis: [ComputeApi],
    run: (ctx, args) =>
      Result.flatMap(
        CommandContext.resolveRegion(ctx, ParsedArgs.string(args, "region")),
        (region) => {
          const s = ctx.world.subnets.find(
            (s) =>
              s.projectId === ctx.project.projectId &&
              s.name === ParsedArgs.requiredPositional(args, 0) &&
              s.region === region,
          );
          if (s === undefined) {
            return Result.err(CommandFailure.notFound("subnetworks"));
          }
          if (
            ctx.world.dataProcessing.kafkaClusters.some(
              (c) => c.projectId === s.projectId && c.region === s.region && c.subnet === s.name,
            )
          ) {
            return invalid("Subnet is still in use by a Kafka cluster.");
          }
          const vms = ctx.world.instances.some(
            (v) =>
              v.projectId === s.projectId &&
              Zone.region(v.zone) === region &&
              v.networkInterfaces.some((n) => n.network === s.network && n.subnetwork === s.name),
          );
          const frontends = ctx.world.forwardingRules.some(
            (f) =>
              f.projectId === s.projectId &&
              f.scope.kind === "region" &&
              f.scope.region === region &&
              (f.subnet === s.name ||
                (s.purpose === "REGIONAL_MANAGED_PROXY" && f.network === s.network)),
          );
          const other =
            ctx.world.addresses.some(
              (a) =>
                a.projectId === s.projectId &&
                a.subnet === s.name &&
                Option.isSome(a.region) &&
                a.region.value === region,
            ) ||
            ctx.world.lbResources.some(
              (r) =>
                r.kind === "networkEndpointGroups" &&
                r.projectId === s.projectId &&
                r.subnet === s.name &&
                r.network === s.network,
            ) ||
            ctx.world.clusters.some(
              (c) =>
                c.projectId === s.projectId &&
                Option.isSome(c.controlPlane.privateNetwork) &&
                c.controlPlane.privateNetwork.value.subnetwork === s.name,
            );
          if (
            vms ||
            frontends ||
            other ||
            (s.role === "ACTIVE" &&
              ctx.world.subnets.some(
                (b) =>
                  b.projectId === s.projectId &&
                  b.network === s.network &&
                  b.region === region &&
                  b.role === "BACKUP",
              ))
          ) {
            return invalid(
              "Subnet is still in use by a VM, LB, NEG, address, cluster or backup proxy subnet.",
            );
          }
          return finish(World.withoutNamed(ctx.world, "subnets", s), { deleted: s.name });
        },
      ),
  }),
];
