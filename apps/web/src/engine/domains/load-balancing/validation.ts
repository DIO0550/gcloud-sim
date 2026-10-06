import { Region, Zone } from "@/engine/domains/catalog";
import { ResourceName } from "@/engine/domains/compute";
import { Ipv4 } from "@/engine/domains/gke-control-plane";
import { HealthCheck, LbScope } from "@/engine/domains/load-balancing";
import {
  groupLink,
  groupRegion,
  type LbResource,
  lbBackend,
  lbFind,
  lbReferences,
  validLbPath,
  validPort,
} from "@/engine/domains/load-balancing/graph";
import type { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const local = (ref: string, projectId: string): boolean =>
  ref.startsWith(`https://www.googleapis.com/compute/v1/projects/${projectId}/`);
export const backendNetwork = (world: World, ref: string): string | undefined => {
  const group = world.instanceGroups.find((g) => groupLink(g) === ref);
  if (group !== undefined) {
    return world.instanceTemplates.find(
      (t) => t.projectId === group.projectId && t.name === group.template,
    )?.network;
  }
  const neg = lbFind(world, ref);
  return neg?.kind === "networkEndpointGroups" ? neg.network : undefined;
};
const backendTarget = (world: World, r: LbResource, ref: string): boolean => {
  if (!local(ref, r.projectId)) {
    return false;
  }
  const b = lbBackend(world, ref);
  if (b !== undefined) {
    const scheme = r.location === "global" ? "EXTERNAL_MANAGED" : "INTERNAL_MANAGED";
    return (
      LbScope.toPath(b.scope) === r.location &&
      b.loadBalancingScheme === scheme &&
      ["HTTP", "HTTPS"].includes(b.protocol)
    );
  }
  const bucket = lbFind(world, ref);
  return (
    r.location === "global" && bucket?.kind === "backendBuckets" && bucket.location === "global"
  );
};
const resourceError = (world: World, r: LbResource): string | undefined => {
  const parts = r.location.split("/");
  const located =
    r.location === "global" ||
    (parts.length === 2 && parts[0] === "regions" && Option.isSome(Region.parse(parts[1] ?? ""))) ||
    (parts.length === 2 && parts[0] === "zones" && Option.isSome(Zone.parse(parts[1] ?? "")));
  if (!located || !Result.isOk(ResourceName.parse(r.name))) {
    return `Invalid LB name/location: ${r.name}`;
  }
  if (r.kind === "urlMaps") {
    if (
      r.location.startsWith("zones/") ||
      !lbReferences(r).every((ref) => backendTarget(world, r, ref))
    ) {
      return `Invalid URL map backend kind/project/scope/scheme: ${r.name}`;
    }
    if (
      r.routes.some(
        (route) =>
          route.hosts.length === 0 ||
          new Set(route.hosts).size !== route.hosts.length ||
          route.hosts.some((h) => h !== "*" && !/^[a-z0-9.-]+$/.test(h)) ||
          !Result.isOk(ResourceName.parse(route.matcher)) ||
          new Set(route.paths).size !== route.paths.length ||
          route.paths.some((p) => !validLbPath(p)),
      )
    ) {
      return `Invalid URL map route: ${r.name}`;
    }
    for (const route of r.routes) {
      if (
        r.routes.some(
          (other) =>
            other !== route &&
            ((other.matcher !== route.matcher &&
              other.hosts.some((h) => route.hosts.includes(h))) ||
              (other.matcher === route.matcher &&
                (other.hosts.join("/") !== route.hosts.join("/") ||
                  (other.paths.length === 0 && route.paths.length === 0) ||
                  other.paths.some((p) => route.paths.includes(p))))),
        )
      ) {
        return `Duplicate/inconsistent URL map matcher: ${r.name}`;
      }
    }
  }
  if (r.kind === "targetHttpProxies" || r.kind === "targetHttpsProxies") {
    const map = lbFind(world, r.urlMap);
    if (map?.kind !== "urlMaps" || map.projectId !== r.projectId || map.location !== r.location) {
      return `Invalid proxy URL map: ${r.name}`;
    }
    if (r.kind === "targetHttpProxies" && r.sslCertificates.length > 0) {
      return `HTTP proxy cannot use SSL certificates: ${r.name}`;
    }
    if (
      r.kind === "targetHttpsProxies" &&
      (r.location !== "global" ||
        r.sslCertificates.length < 1 ||
        r.sslCertificates.length > 15 ||
        r.sslCertificates.some((ref) => {
          const c = lbFind(world, ref);
          return (
            c?.kind !== "sslCertificates" ||
            c.projectId !== r.projectId ||
            c.location !== r.location
          );
        }))
    ) {
      return `Invalid HTTPS certificates: ${r.name}`;
    }
  }
  if (
    r.kind === "sslCertificates" &&
    (r.location !== "global" ||
      r.domains.length === 0 ||
      new Set(r.domains).size !== r.domains.length ||
      r.domains.some(
        (d) => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(d),
      ))
  ) {
    return `Invalid managed certificate: ${r.name}`;
  }
  if (
    r.kind === "backendBuckets" &&
    (r.location !== "global" ||
      !world.buckets.some((b) => b.projectId === r.projectId && b.name === r.bucketName))
  ) {
    return `Invalid backend bucket: ${r.name}`;
  }
  if (r.kind === "networkEndpointGroups") {
    const zone = Zone.parse(parts[1] ?? "");
    const subnet = world.subnets.find(
      (s) =>
        s.projectId === r.projectId &&
        s.name === r.subnet &&
        s.network === r.network &&
        Option.isSome(zone) &&
        s.region === Zone.region(zone.value) &&
        s.purpose !== "REGIONAL_MANAGED_PROXY",
    );
    if (
      !r.location.startsWith("zones/") ||
      subnet === undefined ||
      !validPort(r.defaultPort) ||
      new Set(r.endpoints.map((e) => `${e.ipAddress}:${e.port}`)).size !== r.endpoints.length
    ) {
      return `Invalid zonal NEG: ${r.name}`;
    }
    if (
      r.endpoints.some(
        (e) =>
          !validPort(e.port) ||
          !world.instances.some(
            (v) =>
              v.projectId === r.projectId &&
              `zones/${v.zone}` === r.location &&
              v.name === e.instance &&
              v.networkInterfaces.some(
                (n) =>
                  n.network === r.network &&
                  n.subnetwork === r.subnet &&
                  n.networkIP === e.ipAddress,
              ),
          ),
      )
    ) {
      return `Invalid NEG endpoint reference: ${r.name}`;
    }
  }
  return undefined;
};
export const validateLbGraph = (world: World): string | undefined => {
  for (const r of world.lbResources) {
    const error = resourceError(world, r);
    if (error !== undefined) {
      return error;
    }
  }
  for (const h of world.healthChecks) {
    if (
      !validPort(h.port) ||
      !Number.isInteger(h.timeoutSec) ||
      !Number.isInteger(h.checkIntervalSec) ||
      h.timeoutSec <= 0 ||
      h.checkIntervalSec < h.timeoutSec ||
      !(h.requestPath ?? "/").startsWith("/")
    ) {
      return `Invalid health check: ${h.name}`;
    }
  }
  for (const g of world.instanceGroups) {
    const ports = g.namedPorts ?? [];
    if (
      new Set(ports.map((p) => p.name)).size !== ports.length ||
      ports.some((p) => !validPort(p.port) || !/^[a-z][a-z0-9-]{0,62}$/.test(p.name))
    ) {
      return `Invalid MIG named ports: ${g.name}`;
    }
  }
  for (const b of world.backendServices) {
    const checks = b.healthChecks.map((ref) =>
      world.healthChecks.find(
        (h) =>
          h.projectId === b.projectId &&
          (HealthCheck.selfLink(h) === ref ||
            (h.name === ref && LbScope.toPath(h.scope ?? LbScope.Global) === "global")),
      ),
    );
    if (
      checks.some((h) => h === undefined) ||
      b.backends.some(
        (ref) =>
          !local(ref, b.projectId) ||
          (!world.instanceGroups.some((g) => groupLink(g) === ref) &&
            lbFind(world, ref)?.kind !== "networkEndpointGroups"),
      )
    ) {
      return `Invalid backend reference: ${b.name}`;
    }
    if (b.portName === undefined) {
      continue; // v1-v30 saved standalone components remain inspectable; probes explain legacy limits.
    }
    const application = ["HTTP", "HTTPS"].includes(b.protocol);
    const allowed =
      (b.scope.kind === "global" && b.loadBalancingScheme === "EXTERNAL_MANAGED" && application) ||
      (b.scope.kind === "region" && b.loadBalancingScheme === "INTERNAL_MANAGED" && application) ||
      (b.scope.kind === "region" && b.loadBalancingScheme === "EXTERNAL" && b.protocol === "TCP");
    if (
      !allowed ||
      checks.length !== 1 ||
      checks.some((h) => h === undefined || !LbScope.equals(h.scope ?? LbScope.Global, b.scope)) ||
      !Number.isInteger(b.timeoutSec) ||
      b.timeoutSec < 1 ||
      b.timeoutSec > 86400 ||
      !/^[a-z][a-z0-9-]{0,62}$/.test(b.portName) ||
      (b.enableCdn && b.loadBalancingScheme !== "EXTERNAL_MANAGED")
    ) {
      return `Invalid backend mode/health-check scope/configuration: ${b.name}`;
    }
    for (const ref of b.backends) {
      const g = world.instanceGroups.find((g) => groupLink(g) === ref);
      const neg = lbFind(world, ref);
      const region =
        g === undefined ? neg?.location.slice(6).replace(/-[a-z]$/, "") : groupRegion(g);
      if (
        (b.scope.kind === "region" && b.scope.region !== region) ||
        (neg !== undefined && b.loadBalancingScheme === "EXTERNAL")
      ) {
        return `Invalid backend location/type: ${b.name}`;
      }
    }
    const types = new Set(b.backends.map((ref) => lbFind(world, ref)?.kind ?? "instanceGroups"));
    if (types.size > 1) {
      return `Cannot mix instance groups and NEGs in one backend service: ${b.name}`;
    }
    if (
      (b.backendOptions ?? []).some(
        (o) =>
          !b.backends.includes(o.group) ||
          (o.balancingMode === "RATE" &&
            (o.maxRatePerEndpoint === undefined || o.maxRatePerEndpoint < 1)),
      )
    ) {
      return `Invalid backend capacity configuration: ${b.name}`;
    }
  }
  for (const f of world.forwardingRules) {
    if (f.target === undefined) {
      if (
        !world.backendServices.some(
          (b) =>
            b.projectId === f.projectId &&
            b.name === f.backendService &&
            LbScope.equals(b.scope, f.scope),
        )
      ) {
        return `Missing legacy forwarding backend: ${f.name}`;
      }
      continue;
    }
    const b = lbBackend(world, f.target);
    const proxy = lbFind(world, f.target);
    const direct =
      b !== undefined &&
      b.projectId === f.projectId &&
      LbScope.equals(b.scope, f.scope) &&
      b.loadBalancingScheme === "EXTERNAL" &&
      f.scope.kind === "region" &&
      f.loadBalancingScheme === "EXTERNAL" &&
      f.ipProtocol === b.protocol &&
      f.backendService === b.name;
    const application =
      proxy !== undefined &&
      ["targetHttpProxies", "targetHttpsProxies"].includes(proxy.kind) &&
      proxy.projectId === f.projectId &&
      proxy.location === LbScope.toPath(f.scope) &&
      f.ipProtocol === "TCP" &&
      f.backendService === "" &&
      ((f.scope.kind === "global" && f.loadBalancingScheme === "EXTERNAL_MANAGED") ||
        (f.scope.kind === "region" && f.loadBalancingScheme === "INTERNAL_MANAGED"));
    if (!direct && !application) {
      return `Invalid forwarding target kind/scope/scheme: ${f.name}`;
    }
    if (
      !Option.isSome(Ipv4.address(f.ipAddress)) ||
      f.portRange.split(",").some(
        (p) =>
          !/^\d+(?:-\d+)?$/.test(p) ||
          p
            .split("-")
            .map(Number)
            .some((n) => !validPort(n)) ||
          (p.includes("-") && Number(p.split("-")[0]) > Number(p.split("-")[1])),
      ) ||
      (application && (f.portRange.includes(",") || f.portRange.includes("-"))) ||
      (!direct && f.networkTier !== "PREMIUM")
    ) {
      return `Invalid frontend IP/ports/tier: ${f.name}`;
    }
    if (f.loadBalancingScheme === "INTERNAL_MANAGED") {
      const data = world.subnets.find(
        (s) =>
          s.projectId === f.projectId &&
          s.network === f.network &&
          s.name === f.subnet &&
          f.scope.kind === "region" &&
          s.region === f.scope.region &&
          s.purpose !== "REGIONAL_MANAGED_PROXY" &&
          Ipv4.contains(s.ipCidrRange, f.ipAddress),
      );
      const proxySubnet = world.subnets.find(
        (s) =>
          s.projectId === f.projectId &&
          s.network === f.network &&
          f.scope.kind === "region" &&
          s.region === f.scope.region &&
          s.purpose === "REGIONAL_MANAGED_PROXY" &&
          s.role === "ACTIVE",
      );
      if (data === undefined || proxySubnet === undefined) {
        return `Invalid internal frontend/proxy-only subnet: ${f.name}`;
      }
      if (proxy?.kind === "targetHttpProxies" || proxy?.kind === "targetHttpsProxies") {
        const map = lbFind(world, proxy.urlMap);
        if (
          map?.kind === "urlMaps" &&
          lbReferences(map).some((ref) =>
            lbBackend(world, ref)?.backends.some(
              (group) => backendNetwork(world, group) !== f.network,
            ),
          )
        ) {
          return `Internal backend VPC must match frontend: ${f.name}`;
        }
      }
    }
    if (f.addressName !== undefined) {
      const address = world.addresses.find(
        (a) =>
          a.projectId === f.projectId &&
          a.name === f.addressName &&
          (Option.isSome(a.region) ? `regions/${a.region.value}` : "global") ===
            LbScope.toPath(f.scope),
      );
      const type = f.loadBalancingScheme === "INTERNAL_MANAGED" ? "INTERNAL" : "EXTERNAL";
      if (
        address === undefined ||
        address.status !== "IN_USE" ||
        address.address !== f.ipAddress ||
        address.addressType !== type ||
        (address.networkTier ?? "PREMIUM") !== f.networkTier ||
        (type === "INTERNAL" && address.subnet !== f.subnet)
      ) {
        return `Invalid reserved frontend address: ${f.name}`;
      }
    }
  }
  for (const s of world.subnets.filter((s) => s.purpose === "REGIONAL_MANAGED_PROXY")) {
    const range = Ipv4.range(s.ipCidrRange);
    if (
      !Option.isSome(range) ||
      range.value.prefix > 26 ||
      s.role === undefined ||
      world.subnets.some(
        (other) =>
          other !== s &&
          other.projectId === s.projectId &&
          other.network === s.network &&
          other.region === s.region &&
          other.purpose === s.purpose &&
          other.role === s.role,
      ) ||
      world.instances.some(
        (v) =>
          v.projectId === s.projectId &&
          Zone.region(v.zone) === s.region &&
          v.networkInterfaces.some((n) => n.network === s.network && n.subnetwork === s.name),
      )
    ) {
      return `Invalid proxy-only subnet or VM placement: ${s.name}`;
    }
  }
  return undefined;
};
