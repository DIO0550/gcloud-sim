import { Zone } from "@/engine/domains/catalog";
import { FirewallRule, type Instance, ProtocolRule } from "@/engine/domains/compute";
import { Ipv4 } from "@/engine/domains/gke-control-plane";
import { IamPolicy } from "@/engine/domains/iam-policy";
import { ManagedInstanceGroup } from "@/engine/domains/instance-groups";
import { BackendService, type ForwardingRule, HealthCheck } from "@/engine/domains/load-balancing";
import type { World } from "@/engine/domains/world";
import type { JsonRecord } from "@/types/Json";
import { Option } from "@/utils/Option";

type Base = Readonly<{ projectId: string; name: string; location: string }>;
export type LbRoute = Readonly<{
  hosts: readonly string[];
  paths: readonly string[];
  service: string;
  matcher: string;
}>;
export type LbEndpoint = Readonly<{ instance: string; ipAddress: string; port: number }>;
export type LbResource = Base &
  (
    | Readonly<{ kind: "urlMaps"; defaultService: string; routes: readonly LbRoute[] }>
    | Readonly<{
        kind: "targetHttpProxies" | "targetHttpsProxies";
        urlMap: string;
        sslCertificates: readonly string[];
      }>
    | Readonly<{
        kind: "sslCertificates";
        domains: readonly string[];
        status: "PROVISIONING" | "ACTIVE";
      }>
    | Readonly<{
        kind: "networkEndpointGroups";
        network: string;
        subnet: string;
        defaultPort: number;
        endpoints: readonly LbEndpoint[];
      }>
    | Readonly<{
        kind: "backendBuckets";
        bucketName: string;
        enableCdn: boolean;
        cacheMode: CacheMode;
      }>
  );
export type CacheMode = "CACHE_ALL_STATIC" | "USE_ORIGIN_HEADERS" | "FORCE_CACHE_ALL";
export const CacheModes: readonly CacheMode[] = [
  "CACHE_ALL_STATIC",
  "USE_ORIGIN_HEADERS",
  "FORCE_CACHE_ALL",
];
export const LbKinds = [
  "urlMaps",
  "targetHttpProxies",
  "targetHttpsProxies",
  "sslCertificates",
  "networkEndpointGroups",
  "backendBuckets",
] as const;
export const lbLink = (r: Base & { kind: string }): string =>
  `https://www.googleapis.com/compute/v1/projects/${r.projectId}/${r.location}/${r.kind}/${r.name}`;
export const lbLocation = (r: LbResource): string => `${r.location}/${r.kind}`;
export const lbFind = (world: World, reference: string): LbResource | undefined =>
  world.lbResources.find((r) => lbLink(r) === reference);
export const lbBackend = (world: World, reference: string): BackendService | undefined =>
  world.backendServices.find((b) => BackendService.selfLink(b) === reference);
export const lbReferences = (r: LbResource): readonly string[] => {
  if (r.kind === "urlMaps") {
    return [r.defaultService, ...r.routes.map((p) => p.service)];
  }
  if (r.kind === "targetHttpProxies" || r.kind === "targetHttpsProxies") {
    return [r.urlMap, ...r.sslCertificates];
  }
  return [];
};
export const lbRecord = (r: LbResource): JsonRecord => ({ ...r, selfLink: lbLink(r) });
export const validLbPath = (p: string): boolean =>
  p.startsWith("/") && (!p.includes("*") || (p.endsWith("/*") && p.indexOf("*") === p.length - 1));
export const validPort = (n: number): boolean => Number.isInteger(n) && n >= 1 && n <= 65535;
export const groupLink = (g: ManagedInstanceGroup): string =>
  ManagedInstanceGroup.selfLink(g).replace("instanceGroupManagers/", "instanceGroups/");
export const groupRegion = (g: ManagedInstanceGroup): string => {
  const zone = Zone.parse(g.location);
  return Option.isSome(zone) ? Zone.region(zone.value) : g.location;
};

/** Evaluate the entire source CIDR, including narrower deny rules and allow/deny priority ties. */
export const lbFirewallAllows = (
  world: World,
  vm: Instance,
  source: string,
  protocol: string,
  port: number,
): boolean => {
  const range = Ipv4.range(source);
  if (!Option.isSome(range)) {
    return false;
  }
  const rules = world.firewallRules.filter(
    (r) =>
      r.projectId === vm.projectId &&
      !r.disabled &&
      r.direction === "INGRESS" &&
      FirewallRule.appliesTo(r, vm) &&
      (r.destinationRanges.length === 0 ||
        vm.networkInterfaces.some(
          (n) =>
            n.network === r.network &&
            r.destinationRanges.some((c) => Ipv4.contains(c, n.networkIP)),
        )),
  );
  const boundaries = new Set([range.value.start, range.value.start + range.value.size]);
  for (const rule of rules) {
    for (const cidr of rule.sourceRanges) {
      const part = Ipv4.range(cidr);
      if (Option.isSome(part)) {
        boundaries.add(
          Math.max(
            range.value.start,
            Math.min(range.value.start + range.value.size, part.value.start),
          ),
        );
        boundaries.add(
          Math.max(
            range.value.start,
            Math.min(range.value.start + range.value.size, part.value.start + part.value.size),
          ),
        );
      }
    }
  }
  const points = [...boundaries].sort((a, b) => a - b).slice(0, -1);
  return points.every((point) => {
    const ip = Ipv4.format(point);
    const matching = rules.filter((r) => r.sourceRanges.some((c) => Ipv4.contains(c, ip)));
    const allows = matching.filter((r) =>
      r.allowed.some((p) => ProtocolRule.covers(p, protocol, port)),
    );
    const denies = matching.filter((r) =>
      r.denied.some((p) => ProtocolRule.covers(p, protocol, port)),
    );
    const allowPriority = Math.min(65535, ...allows.map((r) => r.priority));
    const denyPriority = Math.min(65535, ...denies.map((r) => r.priority));
    return allowPriority < denyPriority;
  });
};
export type BackendHealth = Readonly<{
  instance: string;
  ipAddress: string;
  port: number;
  healthState: "HEALTHY" | "UNHEALTHY";
  reasons: readonly string[];
  healthReasons: readonly string[];
  trafficReasons: readonly string[];
  trafficReady: boolean;
}>;
const checksOf = (world: World, service: BackendService) =>
  world.healthChecks.filter(
    (h) =>
      service.healthChecks.includes(HealthCheck.selfLink(h)) ||
      (h.projectId === service.projectId &&
        service.healthChecks.includes(h.name) &&
        (h.scope?.kind ?? "global") === "global"),
  );
const healthSources = (service: BackendService): readonly string[] => {
  if (service.loadBalancingScheme === "INTERNAL_MANAGED") {
    return ["35.191.0.0/16"];
  }
  if (service.loadBalancingScheme === "EXTERNAL" && service.scope.kind === "region") {
    return ["35.191.0.0/16", "209.85.204.0/22"];
  }
  return ["35.191.0.0/16", "130.211.0.0/22"];
};
const applicationResponds = (
  vm: Instance,
  service: BackendService,
  port: number,
  passthrough: boolean,
): boolean => {
  if (Number(vm.metadata["sim-lb-port"]) !== port || Number(vm.metadata["sim-lb-status"]) === 0) {
    return false;
  }
  if (passthrough) {
    if (service.protocol === "UDP") {
      return vm.metadata["sim-lb-protocol"] === "UDP";
    }
    return ["HTTP", "HTTPS", "TCP"].includes(vm.metadata["sim-lb-protocol"] ?? "");
  }
  return (
    vm.metadata["sim-lb-protocol"] === service.protocol &&
    Number(vm.metadata["sim-lb-status"]) === 200
  );
};
export const lbHealth = (world: World, service: BackendService): readonly BackendHealth[] => {
  const checks = checksOf(world, service);
  const sources = healthSources(service);
  const targets = service.backends.flatMap((ref) => {
    const group = world.instanceGroups.find((g) => groupLink(g) === ref);
    if (group !== undefined) {
      const port =
        (group.namedPorts ?? []).find((p) => p.name === (service.portName ?? "http"))?.port ?? 0;
      return world.instances
        .filter(
          (vm) =>
            vm.projectId === group.projectId &&
            group.instanceNames.includes(vm.name) &&
            vm.zone ===
              ManagedInstanceGroup.zoneFor(group.location, group.instanceNames.indexOf(vm.name)),
        )
        .map((vm) => ({ vm, port }));
    }
    const neg = lbFind(world, ref);
    if (neg?.kind !== "networkEndpointGroups") {
      return [];
    }
    return neg.endpoints.flatMap((e) => {
      const vm = world.instances.find(
        (v) =>
          v.projectId === neg.projectId &&
          `zones/${v.zone}` === neg.location &&
          v.name === e.instance,
      );
      return vm === undefined ? [] : [{ vm, port: e.port }];
    });
  });
  return targets.map(({ vm, port }) => {
    const passthrough =
      service.loadBalancingScheme === "EXTERNAL" && service.scope.kind === "region";
    const servingPort = passthrough ? Number(vm.metadata["sim-lb-port"] ?? 0) : port;
    const reasons: string[] = [];
    const trafficReasons: string[] = [];
    if (vm.status !== "RUNNING") {
      reasons.push("VM_NOT_RUNNING");
      trafficReasons.push("VM_NOT_RUNNING");
    }
    if (!validPort(servingPort)) {
      trafficReasons.push("NAMED_PORT_MISSING");
    }
    if (!applicationResponds(vm, service, servingPort, passthrough)) {
      trafficReasons.push("APPLICATION_NOT_RESPONDING");
    }
    if (checks.length === 0) {
      reasons.push("HEALTH_CHECK_MISSING");
    }
    for (const check of checks) {
      if (Number(vm.metadata["sim-lb-status"] ?? 0) === 0) {
        reasons.push("HEALTH_CHECK_CONNECTION_FAILED");
      }
      if (
        Number(vm.metadata["sim-lb-port"]) !== check.port ||
        (check.protocol === "TCP" && vm.metadata["sim-lb-protocol"] === "UDP")
      ) {
        reasons.push("HEALTH_CHECK_PORT_MISMATCH");
      }
      if (
        check.protocol !== "TCP" &&
        (vm.metadata["sim-lb-protocol"] !== check.protocol ||
          vm.metadata["sim-lb-path"] !== (check.requestPath ?? "/") ||
          Number(vm.metadata["sim-lb-status"]) !== 200)
      ) {
        reasons.push("HEALTH_CHECK_RESPONSE_MISMATCH");
      }
      if (!sources.every((source) => lbFirewallAllows(world, vm, source, "tcp", check.port))) {
        reasons.push("HEALTH_CHECK_FIREWALL_BLOCKED");
      }
    }
    return {
      instance: vm.name,
      ipAddress: vm.networkInterfaces[0]?.networkIP ?? "",
      port: servingPort,
      healthState: reasons.length === 0 ? "HEALTHY" : "UNHEALTHY",
      reasons: [...new Set([...reasons, ...trafficReasons])],
      healthReasons: [...new Set(reasons)],
      trafficReasons,
      trafficReady: trafficReasons.length === 0,
    };
  });
};
export type LbRequest = Readonly<{
  host: string;
  path: string;
  port: number;
  sourceIp: string;
  network: string;
  region: string;
  minHealthy: number;
}>;
export type LbProbe = Readonly<{
  success: boolean;
  reason: string;
  chain: readonly string[];
  healthy: number;
  serving: number;
  selected: string;
  cdn: boolean;
}>;
export const lbProbe = (world: World, rule: ForwardingRule, request: LbRequest): LbProbe => {
  const chain: string[] = [rule.name];
  const fail = (reason: string, healthy = 0, serving = 0): LbProbe => ({
    success: false,
    reason,
    chain,
    healthy,
    serving,
    selected: "",
    cdn: false,
  });
  const portMatches = rule.portRange.split(",").some((p) => {
    const [start, end] = p.split("-").map(Number);
    return request.port >= (start ?? 0) && request.port <= (end ?? start ?? 0);
  });
  if (!portMatches) {
    return fail("FRONTEND_PORT_MISMATCH");
  }
  if (
    rule.loadBalancingScheme === "INTERNAL_MANAGED" &&
    (request.network !== rule.network ||
      rule.scope.kind !== "region" ||
      request.region !== rule.scope.region ||
      !world.subnets.some(
        (s) =>
          s.projectId === rule.projectId &&
          s.network === rule.network &&
          s.region === request.region &&
          s.purpose !== "REGIONAL_MANAGED_PROXY" &&
          Ipv4.contains(s.ipCidrRange, request.sourceIp),
      ))
  ) {
    return fail("INTERNAL_CLIENT_LOCATION_MISMATCH");
  }
  let reference = rule.target ?? "";
  if (reference === "") {
    return fail("LEGACY_UNCONNECTED_FORWARDING_RULE");
  }
  const proxy = lbFind(world, reference);
  if (proxy?.kind === "targetHttpProxies" || proxy?.kind === "targetHttpsProxies") {
    chain.push(proxy.name);
    if (
      proxy.kind === "targetHttpsProxies" &&
      !proxy.sslCertificates.some((ref) => {
        const cert = lbFind(world, ref);
        return (
          cert?.kind === "sslCertificates" &&
          cert.status === "ACTIVE" &&
          cert.domains.includes(request.host)
        );
      })
    ) {
      return fail("TLS_CERTIFICATE_NOT_ACTIVE_OR_HOST_MISMATCH");
    }
    const map = lbFind(world, proxy.urlMap);
    if (map?.kind !== "urlMaps") {
      return fail("URL_MAP_MISSING");
    }
    chain.push(map.name);
    const exactHost = map.routes.some((r) => r.hosts.includes(request.host));
    const routes = map.routes.filter((r) => r.hosts.includes(exactHost ? request.host : "*"));
    const matched = routes
      .flatMap((r) =>
        r.paths
          .filter(
            (p) =>
              p === request.path || (p.endsWith("/*") && request.path.startsWith(p.slice(0, -1))),
          )
          .map((p) => ({ r, length: p.length })),
      )
      .sort((a, b) => b.length - a.length)[0];
    reference =
      matched?.r.service ?? routes.find((r) => r.paths.length === 0)?.service ?? map.defaultService;
  }
  const bucket = lbFind(world, reference);
  if (bucket?.kind === "backendBuckets") {
    chain.push(bucket.name);
    const storage = world.buckets.find(
      (b) => b.projectId === bucket.projectId && b.name === bucket.bucketName,
    );
    if (storage === undefined) {
      return fail("BUCKET_MISSING");
    }
    if (
      storage.publicAccessPrevention ||
      !IamPolicy.hasBinding(storage.iamPolicy, "roles/storage.objectViewer", "allUsers")
    ) {
      return fail("BUCKET_PUBLIC_ACCESS_DENIED");
    }
    return {
      success: true,
      reason: "SIMULATED_BUCKET_ROUTE",
      chain,
      healthy: 0,
      serving: 0,
      selected: storage.name,
      cdn: bucket.enableCdn,
    };
  }
  const backend = lbBackend(world, reference);
  if (backend === undefined) {
    return fail("BACKEND_MISSING");
  }
  chain.push(backend.name);
  const healthy = lbHealth(world, backend).filter((h) => h.healthState === "HEALTHY");
  if (healthy.length < request.minHealthy) {
    return fail("INSUFFICIENT_HEALTHY_BACKENDS", healthy.length);
  }
  const responding = healthy.filter((h) => h.trafficReady);
  if (responding.length < request.minHealthy) {
    return fail("BACKEND_APPLICATION_NOT_RESPONDING", healthy.length, responding.length);
  }
  const source =
    backend.loadBalancingScheme === "INTERNAL_MANAGED"
      ? (world.subnets.find(
          (s) =>
            s.projectId === rule.projectId &&
            s.network === rule.network &&
            rule.scope.kind === "region" &&
            s.region === rule.scope.region &&
            s.purpose === "REGIONAL_MANAGED_PROXY" &&
            s.role === "ACTIVE",
        )?.ipCidrRange ?? "")
      : `${request.sourceIp}/32`;
  const usable = responding.filter((h) => {
    const vm = world.instances.find(
      (v) =>
        v.projectId === backend.projectId &&
        v.name === h.instance &&
        v.networkInterfaces.some((n) => n.networkIP === h.ipAddress),
    );
    if (vm === undefined) {
      return false;
    }
    if (backend.loadBalancingScheme === "EXTERNAL_MANAGED") {
      return ["35.191.0.0/16", "130.211.0.0/22"].every((s) =>
        lbFirewallAllows(world, vm, s, "tcp", h.port),
      );
    }
    return (
      lbFirewallAllows(
        world,
        vm,
        source,
        backend.protocol === "UDP" ? "udp" : "tcp",
        backend.loadBalancingScheme === "EXTERNAL" ? request.port : h.port,
      ) &&
      (backend.loadBalancingScheme !== "EXTERNAL" || h.port === request.port)
    );
  });
  if (usable.length < request.minHealthy) {
    return fail("BACKEND_TRAFFIC_FIREWALL_OR_PORT_BLOCKED", healthy.length, usable.length);
  }
  return {
    success: true,
    reason: "SIMULATED_RESPONSE",
    chain,
    healthy: healthy.length,
    serving: usable.length,
    selected: usable[0]?.instance ?? "",
    cdn: backend.enableCdn ?? false,
  };
};
