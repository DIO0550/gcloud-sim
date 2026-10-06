import { CommandFailure } from "@/engine/cli/command-failure";
import {
  Column,
  CommandOutput,
  type CommandResult,
  type CommandSpec,
  Flag,
  ParsedArgs,
  Positional,
  type ProjectContext,
} from "@/engine/cli/command-spec";
import { ComputeApi } from "@/engine/commands/compute/shared";
import { alreadyExists, Candidates, projectCommand } from "@/engine/commands/shared";
import { Subnet } from "@/engine/domains/compute";
import { Address } from "@/engine/domains/compute-networking";
import { Ipv4 } from "@/engine/domains/gke-control-plane";
import {
  type BackendService,
  ForwardingRule,
  LbScope,
  LoadBalancingSchemes,
} from "@/engine/domains/load-balancing";
import {
  lbBackend,
  lbFind,
  lbLink,
  lbReferences,
  validPort,
} from "@/engine/domains/load-balancing/graph";
import { backendNetwork } from "@/engine/domains/load-balancing/validation";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";
import { resourcePermission } from "./resources";
import {
  findResource,
  finish,
  invalid,
  ListScopeFlags,
  listScopeAccess,
  refFor,
  requireLb,
  resolveScope,
  resourceCandidates,
  ScopeFlags,
  value,
} from "./shared";

export const forwardingArg = (
  ctx: ProjectContext,
  args: ParsedArgs,
): Result<ForwardingRule, CommandFailure> =>
  Result.flatMap(resolveScope(ctx, args), (scope) =>
    Option.toResult(
      World.findLocated(ctx.world, "forwardingRules", {
        projectId: ctx.project.projectId,
        name: ParsedArgs.requiredPositional(args, 0),
        location: LbScope.toPath(scope),
      }),
      () => CommandFailure.notFound(`forwardingRules/${ParsedArgs.requiredPositional(args, 0)}`),
    ),
  );
const create = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const scope = resolveScope(ctx, args);
  if (!Result.isOk(scope)) {
    return scope;
  }
  const location = LbScope.toPath(scope.value);
  const targets = ["backend-service", "target-http-proxy", "target-https-proxy"].filter((flag) =>
    Option.isSome(ParsedArgs.string(args, flag)),
  );
  const selected = targets[0];
  if (targets.length !== 1 || selected === undefined) {
    return invalid("Specify one backend-service, target-http-proxy or target-https-proxy.");
  }
  const isDirect = selected === "backend-service";
  const scheme = value(
    args,
    "load-balancing-scheme",
    isDirect ? "EXTERNAL" : "EXTERNAL_MANAGED",
  ) as ForwardingRule["loadBalancingScheme"];
  const nlb = isDirect && scope.value.kind === "region" && scheme === "EXTERNAL";
  const external = !isDirect && scope.value.kind === "global" && scheme === "EXTERNAL_MANAGED";
  const internal = !isDirect && scope.value.kind === "region" && scheme === "INTERNAL_MANAGED";
  if (![nlb, external, internal].some(Boolean)) {
    return invalid(
      "Forwarding rule target/scope/scheme must match one of the three supported LB modes.",
    );
  }
  let target = "";
  let backendName = "";
  let services: readonly BackendService[] = [];
  if (isDirect) {
    const ref = refFor(ctx, location, "backendServices", ParsedArgs.requiredString(args, selected));
    const b = lbBackend(ctx.world, ref);
    if (
      b === undefined ||
      b.projectId !== ctx.project.projectId ||
      LbScope.toPath(b.scope) !== location ||
      b.loadBalancingScheme !== scheme
    ) {
      return Result.err(CommandFailure.notFound(ref));
    }
    target = ref;
    backendName = b.name;
    services = [b];
    const use = requireLb(ctx, ["compute.regionBackendServices.use"]);
    if (!Result.isOk(use)) {
      return use;
    }
  }
  if (!isDirect) {
    const kind = selected === "target-http-proxy" ? "targetHttpProxies" : "targetHttpsProxies";
    const area = ParsedArgs.string(args, `${selected}-region`);
    if (Option.isSome(area) && `regions/${area.value}` !== location) {
      return invalid("Target proxy region must match forwarding rule.");
    }
    const proxy = findResource(ctx, location, kind, ParsedArgs.requiredString(args, selected));
    if (!Result.isOk(proxy)) {
      return proxy;
    }
    const p = proxy.value;
    if (p.kind !== "targetHttpProxies" && p.kind !== "targetHttpsProxies") {
      return invalid("Expected an HTTP/HTTPS proxy.");
    }
    const use = requireLb(ctx, [resourcePermission(kind, location, "use")]);
    if (!Result.isOk(use)) {
      return use;
    }
    const map = lbFind(ctx.world, p.urlMap);
    if (map?.kind !== "urlMaps") {
      return invalid("URL map is missing.");
    }
    const refs = lbReferences(map);
    services = refs.flatMap((ref) => {
      const b = lbBackend(ctx.world, ref);
      return b === undefined ? [] : [b];
    });
    if (
      services.some(
        (b) => b.loadBalancingScheme !== scheme || LbScope.toPath(b.scope) !== location,
      ) ||
      (internal && refs.some((r) => lbFind(ctx.world, r)?.kind === "backendBuckets"))
    ) {
      return invalid("All URL map backends must match the forwarding rule scheme and scope.");
    }
    target = lbLink(p);
  }
  const portRange = value(args, "ports", "80");
  const pieces = portRange.split(",");
  const validPorts = pieces.every(
    (piece) =>
      /^\d+(?:-\d+)?$/.test(piece) &&
      piece.split("-").map(Number).every(validPort) &&
      (piece.split("-").length === 1 || Number(piece.split("-")[0]) <= Number(piece.split("-")[1])),
  );
  if (
    !validPorts ||
    pieces.length > 5 ||
    (!isDirect && (pieces.length !== 1 || portRange.includes("-")))
  ) {
    return invalid(
      "Application frontends require one port; passthrough permits up to five ports/ranges.",
    );
  }
  const protocol = value(args, "ip-protocol", services[0]?.protocol === "UDP" ? "UDP" : "TCP") as
    | "TCP"
    | "UDP";
  if ((!isDirect && protocol !== "TCP") || (isDirect && protocol !== services[0]?.protocol)) {
    return invalid("IP protocol must match the backend/frontend mode.");
  }
  const network = value(args, "network", "");
  const subnetName = value(args, "subnet", "");
  const subnet = ctx.world.subnets.find(
    (s) =>
      s.projectId === ctx.project.projectId &&
      s.network === network &&
      s.name === subnetName &&
      scope.value.kind === "region" &&
      s.region === scope.value.region &&
      s.purpose !== "REGIONAL_MANAGED_PROXY",
  );
  if (!internal && (network !== "" || subnetName !== "")) {
    return invalid("External frontends do not use --network/--subnet in this lesson.");
  }
  if (internal) {
    const proxySubnet = ctx.world.subnets.find(
      (s) =>
        s.projectId === ctx.project.projectId &&
        s.network === network &&
        scope.value.kind === "region" &&
        s.region === scope.value.region &&
        s.purpose === "REGIONAL_MANAGED_PROXY" &&
        s.role === "ACTIVE",
    );
    const networks = services.flatMap((b) =>
      b.backends.map((ref) => backendNetwork(ctx.world, ref)),
    );
    if (subnet === undefined || proxySubnet === undefined || networks.some((n) => n !== network)) {
      return invalid(
        "Internal LB requires a regular frontend subnet, ACTIVE proxy-only subnet and backends in the same VPC/region.",
      );
    }
    const use = requireLb(ctx, ["compute.subnetworks.use"]);
    if (!Result.isOk(use)) {
      return use;
    }
  }
  const tier = value(args, "network-tier", "PREMIUM") as "PREMIUM" | "STANDARD";
  if (!nlb && tier !== "PREMIUM") {
    return invalid("Global external and internal Application LBs require PREMIUM in this lesson.");
  }
  const addressName = ParsedArgs.string(args, "address");
  const address = Option.isSome(addressName)
    ? ctx.world.addresses.find(
        (a) =>
          a.projectId === ctx.project.projectId &&
          a.name === addressName.value &&
          Address.selfLink(a).includes(`/${location}/addresses/`),
      )
    : undefined;
  if (Option.isSome(addressName) && address === undefined) {
    return Result.err(
      CommandFailure.notFound(refFor(ctx, location, "addresses", addressName.value)),
    );
  }
  if (
    address !== undefined &&
    (address.status !== "RESERVED" ||
      (address.networkTier ?? "PREMIUM") !== tier ||
      address.addressType !== (internal ? "INTERNAL" : "EXTERNAL") ||
      (internal &&
        (address.subnet !== subnetName ||
          subnet === undefined ||
          !Ipv4.contains(subnet.ipCidrRange, address.address))))
  ) {
    return invalid("Reserved address is in use or has incompatible type, scope, tier or subnet.");
  }
  if (address !== undefined) {
    const use = requireLb(ctx, [
      scope.value.kind === "global" ? "compute.globalAddresses.use" : "compute.addresses.use",
    ]);
    if (!Result.isOk(use)) {
      return use;
    }
  }
  const numbered = World.nextNumber(ctx.world);
  const ip =
    address?.address ??
    (subnet === undefined
      ? `34.110.${Math.floor(numbered.number / 256) % 256}.${numbered.number % 256}`
      : Subnet.hostAddress(subnet, 100 + numbered.number));
  if (internal && (subnet === undefined || !Ipv4.contains(subnet.ipCidrRange, ip))) {
    return invalid("No available internal frontend address in subnet.");
  }
  if (
    ctx.world.forwardingRules.some(
      (r) => r.projectId === ctx.project.projectId && r.ipAddress === ip,
    )
  ) {
    return invalid("Frontend IP already used by a forwarding rule in this lesson.");
  }
  const built = ForwardingRule.create({
    projectId: ctx.project.projectId,
    name: ParsedArgs.requiredPositional(args, 0),
    scope: scope.value,
    ipAddress: ip,
    ipProtocol: protocol,
    portRange,
    loadBalancingScheme: scheme,
    backendService: backendName,
    creationTimestamp: ctx.now,
  });
  if (!Result.isOk(built)) {
    return invalid(built.error);
  }
  const rule = {
    ...built.value,
    target,
    network: internal ? network : undefined,
    subnet: internal ? subnetName : undefined,
    networkTier: tier,
    addressName: address?.name,
  };
  const world =
    address === undefined
      ? numbered.world
      : World.replaceNamed(numbered.world, "addresses", { ...address, status: "IN_USE" });
  return Result.flatMap(
    Result.mapErr(
      World.withNamed(world, "forwardingRules", rule, ForwardingRule.selfLink(rule)),
      alreadyExists,
    ),
    (w) => finish(w, ForwardingRule.toRecord(rule)),
  );
};
export const ForwardingCommands: readonly CommandSpec[] = [
  projectCommand({
    path: ["gcloud", "compute", "forwarding-rules", "create"],
    summary: "Connect a passthrough backend or Application proxy frontend.",
    positionals: [Positional.required("NAME", "Forwarding rule.")],
    flags: [
      ...ScopeFlags,
      Flag.string("backend-service", "Passthrough backend.", {
        candidates: Candidates.backendServices,
      }),
      Flag.string("target-http-proxy", "HTTP proxy.", {
        candidates: resourceCandidates("targetHttpProxies"),
      }),
      Flag.string("target-https-proxy", "HTTPS proxy.", {
        candidates: resourceCandidates("targetHttpsProxies"),
      }),
      Flag.string("target-http-proxy-region", "HTTP proxy region."),
      Flag.string("target-https-proxy-region", "HTTPS proxy region."),
      Flag.string("address", "Reserved address name.", { candidates: Candidates.addresses }),
      Flag.string("ports", "Frontend ports/range."),
      Flag.enum("ip-protocol", "Frontend protocol.", ["TCP", "UDP"]),
      Flag.enum("load-balancing-scheme", "Scheme.", Object.values(LoadBalancingSchemes)),
      Flag.enum("network-tier", "Tier.", ["PREMIUM", "STANDARD"]),
      Flag.string("network", "Internal VPC.", { candidates: Candidates.networks }),
      Flag.string("subnet", "Internal frontend subnet."),
    ],
    permission: "compute.forwardingRules.create",
    requiredApis: [ComputeApi],
    run: create,
  }),
  projectCommand({
    path: ["gcloud", "compute", "forwarding-rules", "describe"],
    summary: "Describe a scoped forwarding rule.",
    positionals: [
      Positional.required("NAME", "Forwarding rule.", Candidates.named("forwardingRules")),
    ],
    flags: ScopeFlags,
    permission: "compute.forwardingRules.get",
    requiredApis: [ComputeApi],
    run: (ctx, args) =>
      Result.flatMap(forwardingArg(ctx, args), (rule) =>
        finish(ctx.world, ForwardingRule.toRecord(rule)),
      ),
  }),
  projectCommand({
    path: ["gcloud", "compute", "forwarding-rules", "list"],
    summary: "List scoped frontends.",
    flags: ListScopeFlags,
    permissions: [],
    requiredApis: [ComputeApi],
    run: (ctx, args) =>
      Result.flatMap(
        listScopeAccess(
          ctx,
          args,
          "compute.globalForwardingRules.list",
          "compute.forwardingRules.list",
        ),
        (includes) =>
          Result.ok({
            world: ctx.world,
            output: CommandOutput.table(
              ctx.world.forwardingRules
                .filter(
                  (r) => r.projectId === ctx.project.projectId && includes(LbScope.toPath(r.scope)),
                )
                .map(ForwardingRule.toRecord),
              [
                Column.create("NAME", "name"),
                Column.create("IP_ADDRESS", "IPAddress"),
                Column.create("IP_PROTOCOL", "IPProtocol"),
                Column.create("TARGET", "target", "basename"),
              ],
            ),
          }),
      ),
  }),
];
