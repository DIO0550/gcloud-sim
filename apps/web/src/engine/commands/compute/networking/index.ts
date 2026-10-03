import { CommandFailure } from "@/engine/cli/command-failure";
import {
  Column,
  CommandContext,
  CommandOutput,
  type CommandResult,
  type CommandSpec,
  Flag,
  type JsonRecord,
  OutputMessage,
  ParsedArgs,
  Positional,
  type ProjectContext,
} from "@/engine/cli/command-spec";
import {
  ComputeApi,
  createdTable,
  invalidName,
  listCommand,
  parseProtocolRules,
  requireFirewallRule,
  requireNetwork,
} from "@/engine/commands/compute/shared";
import {
  alreadyExists,
  Candidates,
  CommonFlags,
  describeNamedCommand,
  projectCommand,
} from "@/engine/commands/shared";
import { Region } from "@/engine/domains/catalog";
import {
  Direction,
  Directions,
  FirewallAction,
  FirewallActions,
  FirewallRule,
  Network,
  ProtocolRule,
  Subnet,
  SubnetModes,
} from "@/engine/domains/compute";
import {
  Address,
  AddressType,
  AddressTypes,
  NetworkPeering,
  Router,
} from "@/engine/domains/compute-networking";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const NetworkColumns = [
  Column.create("NAME", "name"),
  Column.create("SUBNET_MODE", "subnetMode"),
  Column.create("BGP_ROUTING_MODE", "routingConfig.routingMode"),
  Column.create("IPV4_RANGE", "IPv4Range"),
  Column.create("GATEWAY_IPV4", "gatewayIPv4"),
];
const SubnetColumns = [
  Column.create("NAME", "name"),
  Column.create("REGION", "region", "basename"),
  Column.create("NETWORK", "network", "basename"),
  Column.create("RANGE", "ipCidrRange"),
];
const FirewallColumns = [
  Column.create("NAME", "name"),
  Column.create("NETWORK", "network", "basename"),
  Column.create("DIRECTION", "direction"),
  Column.create("PRIORITY", "priority"),
  Column.create("ALLOW", "allowText"),
  Column.create("DENY", "denyText"),
  Column.create("DISABLED", "disabled"),
];
const AddressColumns = [
  Column.create("NAME", "name"),
  Column.create("ADDRESS/RANGE", "address"),
  Column.create("TYPE", "addressType"),
  Column.create("PURPOSE", "purpose"),
  Column.create("NETWORK", "network"),
  Column.create("REGION", "region", "basename"),
  Column.create("SUBNET", "subnetwork"),
  Column.create("STATUS", "status"),
];
const RouterColumns = [
  Column.create("NAME", "name"),
  Column.create("REGION", "region", "basename"),
  Column.create("NETWORK", "network", "basename"),
];
const PeeringColumns = [
  Column.create("NAME", "name"),
  Column.create("NETWORK", "network", "basename"),
  Column.create("PEER_PROJECT", "peerProject"),
  Column.create("PEER_NETWORK", "peerNetwork", "basename"),
  Column.create("STATE", "state"),
];

const networkRecord = (network: Network): JsonRecord => ({
  ...Network.toRecord(network),
  subnetMode: network.subnetMode,
});

const firewallRecord = (rule: FirewallRule): JsonRecord => ({
  ...FirewallRule.toRecord(rule),
  allowText: rule.allowed.map(ProtocolRule.toText).join(","),
  denyText: rule.denied.map(ProtocolRule.toText).join(","),
});

const createFirewallRule = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const networkName = Option.unwrapOr(ParsedArgs.string(args, "network"), "default");
  const network = requireNetwork(ctx, networkName);
  if (!Result.isOk(network)) return network;
  const allowFlag = ParsedArgs.list(args, "allow");
  const action = Option.flatMap(ParsedArgs.string(args, "action"), FirewallAction.parse);
  const hasAllow = allowFlag.length > 0;
  if (hasAllow === Option.isSome(action)) {
    return Result.err(CommandFailure.mustBeSpecified("(--action --rules | --allow)"));
  }
  const rules = parseProtocolRules(
    hasAllow ? "--allow" : "--rules",
    hasAllow ? allowFlag : ParsedArgs.list(args, "rules"),
  );
  if (!Result.isOk(rules)) return rules;
  const rule = Result.mapErr(
    FirewallRule.create({
      projectId: ctx.project.projectId,
      name: ParsedArgs.requiredPositional(args, 0),
      network: networkName,
      direction: Option.unwrapOr(
        Option.flatMap(ParsedArgs.string(args, "direction"), Direction.parse),
        Directions.Ingress,
      ),
      priority: ParsedArgs.integer(args, "priority"),
      sourceRanges: ParsedArgs.list(args, "source-ranges"),
      destinationRanges: ParsedArgs.list(args, "destination-ranges"),
      targetTags: ParsedArgs.list(args, "target-tags"),
      rules: rules.value,
      action: Option.unwrapOr(action, FirewallActions.Allow),
      disabled: ParsedArgs.boolean(args, "disabled"),
    }),
    invalidName,
  );
  if (!Result.isOk(rule)) return rule;
  return Result.map(
    Result.mapErr(World.withFirewallRule(ctx.world, rule.value), alreadyExists),
    (world) => ({
      world,
      output: CommandOutput.table([firewallRecord(rule.value)], FirewallColumns, [
        OutputMessage.plain("Creating firewall...done."),
        OutputMessage.plain(`Created [${FirewallRule.selfLink(rule.value)}].`),
      ]),
    }),
  );
};

const createNetwork = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const mode = Option.unwrapOr(ParsedArgs.string(args, "subnet-mode"), "auto");
  const network = Result.mapErr(
    Network.create({
      projectId: ctx.project.projectId,
      name: ParsedArgs.requiredPositional(args, 0),
      subnetMode: mode === "custom" ? SubnetModes.Custom : SubnetModes.Auto,
    }),
    invalidName,
  );
  if (!Result.isOk(network)) return network;
  const created = network.value;
  const subnets =
    created.subnetMode === SubnetModes.Auto
      ? Subnet.autoRange(created.projectId, created.name, Region.all())
      : [];
  return Result.map(
    Result.mapErr(World.withNetwork(ctx.world, created, subnets), alreadyExists),
    (world) => ({
      world,
      output: CommandOutput.withTrailing(
        createdTable(Network.selfLink(created), networkRecord(created), NetworkColumns),
        OutputMessage.plain(""),
        OutputMessage.plain("Instances on this network will not be reachable until firewall rules"),
        OutputMessage.plain(
          "are created. As an example, you can allow all internal traffic between",
        ),
        OutputMessage.plain("instances as well as SSH, RDP, and ICMP by running:"),
        OutputMessage.plain(""),
        OutputMessage.plain(
          `$ gcloud compute firewall-rules create <FIREWALL_NAME> --network ${created.name} --allow tcp,udp,icmp --source-ranges <IP_RANGE>`,
        ),
        OutputMessage.plain(
          `$ gcloud compute firewall-rules create <FIREWALL_NAME> --network ${created.name} --allow tcp:22,tcp:3389,icmp`,
        ),
      ),
    }),
  );
};

const createSubnet = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const region = CommandContext.resolveRegion(ctx, ParsedArgs.string(args, "region"));
  if (!Result.isOk(region)) return region;
  const networkName = ParsedArgs.requiredString(args, "network");
  const network = requireNetwork(ctx, networkName);
  if (!Result.isOk(network)) return network;
  const subnet = Result.mapErr(
    Subnet.create({
      projectId: ctx.project.projectId,
      name: ParsedArgs.requiredPositional(args, 0),
      region: region.value,
      network: networkName,
      ipCidrRange: ParsedArgs.requiredString(args, "range"),
      privateIpGoogleAccess: ParsedArgs.boolean(args, "enable-private-ip-google-access"),
    }),
    (m) => CommandFailure.invalidValue(m.includes("ipCidrRange") ? "--range" : "NAME", m),
  );
  if (!Result.isOk(subnet)) return subnet;
  return Result.map(
    Result.mapErr(World.withSubnet(ctx.world, subnet.value), alreadyExists),
    (world) => ({
      world,
      output: createdTable(
        Subnet.selfLink(subnet.value),
        Subnet.toRecord(subnet.value),
        SubnetColumns,
      ),
    }),
  );
};

const describeSubnet = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const region = CommandContext.resolveRegion(ctx, ParsedArgs.string(args, "region"));
  if (!Result.isOk(region)) return region;
  const name = ParsedArgs.requiredPositional(args, 0);
  const subnet = Option.toResult(
    World.findSubnet(ctx.world, ctx.project.projectId, region.value, name),
    () =>
      CommandFailure.notFound(
        `projects/${ctx.project.projectId}/regions/${region.value}/subnetworks/${name}`,
      ),
  );
  return Result.map(subnet, (s) => ({
    world: ctx.world,
    output: CommandOutput.yaml(Subnet.toRecord(s)),
  }));
};

/** 予約アドレスの採番。外部はグローバル / リージョンで系統を分け、内部はサブネット風の値。 */
const reservedAddress = (sequence: number, type: string, global: boolean): string =>
  type === AddressTypes.Internal
    ? `10.146.15.${200 + (sequence % 50)}`
    : global
      ? `34.120.${(sequence >> 8) % 256}.${sequence % 256}`
      : `35.200.${(sequence >> 8) % 256}.${sequence % 256}`;

const createAddress = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const global = ParsedArgs.boolean(args, "global");
  const region: Result<Option<Region>, CommandFailure> = global
    ? Result.ok(Option.none)
    : Result.map(CommandContext.resolveRegion(ctx, ParsedArgs.string(args, "region")), (r) =>
        Option.some(r),
      );
  if (!Result.isOk(region)) return region;
  const rawType = Option.unwrapOr(ParsedArgs.string(args, "address-type"), AddressTypes.External);
  const addressType = Option.toResult(AddressType.parse(rawType), () =>
    CommandFailure.invalidChoice("--address-type", rawType, Object.values(AddressTypes)),
  );
  if (!Result.isOk(addressType)) return addressType;
  const explicit = ParsedArgs.string(args, "addresses");
  const address = Result.mapErr(
    Address.create({
      projectId: ctx.project.projectId,
      name: ParsedArgs.requiredPositional(args, 0),
      region: region.value,
      addressType: addressType.value,
      address: Option.unwrapOr(
        explicit,
        reservedAddress(ctx.world.sequence, addressType.value, global),
      ),
      creationTimestamp: ctx.now,
    }),
    invalidName,
  );
  if (!Result.isOk(address)) return address;
  const numbered = World.nextNumber(ctx.world);
  return Result.map(
    Result.mapErr(
      World.withNamed(numbered.world, "addresses", address.value, Address.selfLink(address.value)),
      alreadyExists,
    ),
    (world) => ({
      world,
      output: createdTable(
        Address.selfLink(address.value),
        Address.toRecord(address.value),
        AddressColumns,
      ),
    }),
  );
};

const createRouter = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const region = CommandContext.resolveRegion(ctx, ParsedArgs.string(args, "region"));
  if (!Result.isOk(region)) return region;
  const networkName = ParsedArgs.requiredString(args, "network");
  const network = requireNetwork(ctx, networkName);
  if (!Result.isOk(network)) return network;
  const router = Result.mapErr(
    Router.create({
      projectId: ctx.project.projectId,
      name: ParsedArgs.requiredPositional(args, 0),
      region: region.value,
      network: networkName,
      asn: ParsedArgs.integer(args, "asn"),
    }),
    invalidName,
  );
  if (!Result.isOk(router)) return router;
  return Result.map(
    Result.mapErr(
      World.withNamed(ctx.world, "routers", router.value, Router.selfLink(router.value)),
      alreadyExists,
    ),
    (world) => ({
      world,
      output: createdTable(
        Router.selfLink(router.value),
        Router.toRecord(router.value),
        RouterColumns,
      ),
    }),
  );
};

/** `--peer-network` の相手。`--peer-project` が無ければ同じプロジェクト。相手のネットワークが無ければ E-005。 */
const createPeering = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const networkName = ParsedArgs.requiredString(args, "network");
  const network = requireNetwork(ctx, networkName);
  if (!Result.isOk(network)) return network;
  const peerProjectId = Option.unwrapOr(
    ParsedArgs.string(args, "peer-project"),
    ctx.project.projectId,
  );
  const peerNetwork = ParsedArgs.requiredString(args, "peer-network");
  if (!Option.isSome(World.findNetwork(ctx.world, peerProjectId, peerNetwork))) {
    return Result.err(
      CommandFailure.notFound(`projects/${peerProjectId}/global/networks/${peerNetwork}`),
    );
  }
  if (peerProjectId === ctx.project.projectId && peerNetwork === networkName) {
    return Result.err(
      CommandFailure.invalidValue("--peer-network", "A network cannot peer with itself."),
    );
  }
  const peerSide = World.namedOf(ctx.world, "peerings", peerProjectId).find(
    (p) => p.network === peerNetwork && NetworkPeering.faces(p, ctx.project.projectId, networkName),
  );
  const peering = Result.mapErr(
    NetworkPeering.create({
      projectId: ctx.project.projectId,
      name: ParsedArgs.requiredPositional(args, 0),
      network: networkName,
      peerProjectId,
      peerNetwork,
      peerSideExists: peerSide !== undefined,
      exportCustomRoutes: ParsedArgs.boolean(args, "export-custom-routes"),
      importCustomRoutes: ParsedArgs.boolean(args, "import-custom-routes"),
    }),
    invalidName,
  );
  if (!Result.isOk(peering)) return peering;
  const added = Result.mapErr(
    World.withNamed(
      ctx.world,
      "peerings",
      peering.value,
      `projects/${ctx.project.projectId}/global/networks/${networkName}/peerings/${peering.value.name}`,
    ),
    alreadyExists,
  );
  if (!Result.isOk(added)) return added;
  const world =
    peerSide === undefined
      ? added.value
      : World.replaceNamed(added.value, "peerings", NetworkPeering.withState(peerSide, "ACTIVE"));
  return Result.ok({
    world,
    output: CommandOutput.table([peeringRecord(peering.value)], PeeringColumns, [
      OutputMessage.plain(`Updated [${Network.selfLink(network.value)}].`),
    ]),
  });
};

const peeringRecord = (peering: NetworkPeering): JsonRecord => ({
  ...NetworkPeering.toRecord(peering),
  peerProject: peering.peerProjectId,
});

export const NetworkingCommands: readonly CommandSpec[] = [
  projectCommand({
    path: ["gcloud", "compute", "networks", "subnets", "update"],
    summary: "Update Private Google Access on a subnetwork.",
    positionals: [Positional.required("NAME", "Subnetwork name.", Candidates.subnets)],
    flags: [
      CommonFlags.region,
      Flag.boolean("enable-private-ip-google-access", "Enable or disable Private Google Access.", {
        required: true,
      }),
    ],
    permission: "compute.subnetworks.setPrivateIpGoogleAccess",
    requiredApis: [ComputeApi],
    run: (ctx, args) => {
      const region = CommandContext.resolveRegion(ctx, ParsedArgs.string(args, "region"));
      if (!Result.isOk(region)) return region;
      const subnet = World.findSubnet(
        ctx.world,
        ctx.project.projectId,
        region.value,
        ParsedArgs.requiredPositional(args, 0),
      );
      if (!Option.isSome(subnet)) return Result.err(CommandFailure.notFound("subnetwork"));
      const updated = {
        ...subnet.value,
        privateIpGoogleAccess: ParsedArgs.boolean(args, "enable-private-ip-google-access"),
      };
      return Result.ok({
        world: {
          ...ctx.world,
          subnets: ctx.world.subnets.map((s) => (s === subnet.value ? updated : s)),
        },
        output: CommandOutput.yaml(Subnet.toRecord(updated)),
      });
    },
  }),
  projectCommand({
    path: ["gcloud", "compute", "networks", "create"],
    summary: "Create a Compute Engine network.",
    positionals: [Positional.required("NAME", "Name of the network to create.")],
    flags: [
      Flag.enum("subnet-mode", "The subnet mode of the network.", ["auto", "custom"]),
      Flag.enum("bgp-routing-mode", "The BGP routing mode for this network.", [
        "global",
        "regional",
      ]),
    ],
    permission: "compute.networks.create",
    requiredApis: [ComputeApi],
    run: createNetwork,
  }),
  listCommand({
    path: ["gcloud", "compute", "networks", "list"],
    summary: "List Compute Engine networks.",
    permission: "compute.networks.list",
    columns: NetworkColumns,
    records: (ctx) => World.networksOf(ctx.world, ctx.project.projectId).map(networkRecord),
  }),
  projectCommand({
    path: ["gcloud", "compute", "networks", "describe"],
    summary: "Describe a Compute Engine network.",
    positionals: [
      Positional.required("NAME", "Name of the network to describe.", Candidates.networks),
    ],
    permission: "compute.networks.get",
    requiredApis: [ComputeApi],
    run: (ctx, args) =>
      Result.map(requireNetwork(ctx, ParsedArgs.requiredPositional(args, 0)), (network) => ({
        world: ctx.world,
        output: CommandOutput.yaml(networkRecord(network)),
      })),
  }),
  projectCommand({
    path: ["gcloud", "compute", "networks", "delete"],
    summary: "Delete a Compute Engine network.",
    positionals: [
      Positional.required("NAME", "Name of the network to delete.", Candidates.networks),
    ],
    destructive: true,
    permission: "compute.networks.delete",
    requiredApis: [ComputeApi],
    run: (ctx, args) => {
      const network = requireNetwork(ctx, ParsedArgs.requiredPositional(args, 0));
      if (!Result.isOk(network)) return network;
      const world = Result.mapErr(World.withoutNetwork(ctx.world, network.value), (subnet) =>
        CommandFailure.invalidState(
          `The network resource '${Network.selfLink(network.value)}' is already being used by '${Subnet.selfLink(subnet)}'`,
        ),
      );
      return Result.map(world, (w) => ({
        world: w,
        output: CommandOutput.messages(
          OutputMessage.plain(`Deleted [${Network.selfLink(network.value)}].`),
        ),
      }));
    },
  }),
  projectCommand({
    path: ["gcloud", "compute", "networks", "subnets", "create"],
    summary: "Define a subnet for a network in custom subnet mode.",
    positionals: [Positional.required("NAME", "Name of the subnetwork to create.")],
    flags: [
      Flag.string("network", "The network to which the subnetwork belongs.", {
        required: true,
        candidates: Candidates.networks,
      }),
      Flag.string("range", "The IP space allocated to this subnetwork in CIDR format.", {
        required: true,
      }),
      CommonFlags.region,
      Flag.boolean(
        "enable-private-ip-google-access",
        "Enable/disable access to Google Cloud APIs from this subnet for instances without a public ip address.",
      ),
    ],
    permission: "compute.subnetworks.create",
    requiredApis: [ComputeApi],
    run: createSubnet,
  }),
  listCommand({
    path: ["gcloud", "compute", "networks", "subnets", "list"],
    summary: "List Compute Engine subnetworks.",
    permission: "compute.subnetworks.list",
    columns: SubnetColumns,
    records: (ctx) => World.subnetsOf(ctx.world, ctx.project.projectId).map(Subnet.toRecord),
  }),
  projectCommand({
    path: ["gcloud", "compute", "networks", "subnets", "describe"],
    summary: "Describe a Compute Engine subnetwork.",
    positionals: [
      Positional.required("NAME", "Name of the subnetwork to describe.", Candidates.subnets),
    ],
    flags: [CommonFlags.region],
    permission: "compute.subnetworks.get",
    requiredApis: [ComputeApi],
    run: describeSubnet,
  }),
  projectCommand({
    path: ["gcloud", "compute", "networks", "peerings", "create"],
    summary: "Create a Compute Engine network peering.",
    positionals: [Positional.required("NAME", "Name of the peering to create.")],
    flags: [
      Flag.string("network", "The name of the network in the current project to be peered.", {
        required: true,
        candidates: Candidates.networks,
      }),
      Flag.string("peer-network", "The name of the network to be peered with.", {
        required: true,
        candidates: Candidates.networks,
      }),
      Flag.string("peer-project", "The project of the peer network (default: current project).", {
        candidates: Candidates.projects,
      }),
      Flag.boolean("export-custom-routes", "Export custom routes to the peer network."),
      Flag.boolean("import-custom-routes", "Import custom routes from the peer network."),
    ],
    permission: "compute.networks.addPeering",
    requiredApis: [ComputeApi],
    run: createPeering,
  }),
  projectCommand({
    path: ["gcloud", "compute", "firewall-rules", "create"],
    summary: "Create a Compute Engine firewall rule.",
    positionals: [Positional.required("NAME", "Name of the firewall rule to create.")],
    flags: [
      Flag.string("network", "The network to which this rule is attached (default: default).", {
        candidates: Candidates.networks,
      }),
      Flag.list(
        "allow",
        "A list of protocols and ports whose traffic will be allowed, e.g. tcp:80,tcp:443,icmp.",
      ),
      Flag.enum("action", "The action for the firewall rule.", Object.values(FirewallActions)),
      Flag.list(
        "rules",
        "A list of protocols and ports to which the firewall rule will apply (used with --action).",
      ),
      Flag.enum(
        "direction",
        "Direction of the traffic the rule applies to.",
        Object.values(Directions),
      ),
      Flag.integer("priority", "Priority of the rule (0-65535, default 1000)."),
      Flag.list(
        "source-ranges",
        "A list of IP address blocks that are allowed to make inbound connections (default: 0.0.0.0/0).",
      ),
      Flag.list(
        "target-tags",
        "A list of instance tags indicating the set of instances on the network which may accept connections.",
      ),
      Flag.list(
        "destination-ranges",
        "A list of IP address blocks for outbound connections (EGRESS only).",
      ),
      Flag.boolean("disabled", "Disable the firewall rule."),
    ],
    permission: "compute.firewalls.create",
    requiredApis: [ComputeApi],
    run: createFirewallRule,
  }),
  listCommand({
    path: ["gcloud", "compute", "firewall-rules", "list"],
    summary: "List Compute Engine firewall rules.",
    permission: "compute.firewalls.list",
    columns: FirewallColumns,
    records: (ctx) => World.firewallRulesOf(ctx.world, ctx.project.projectId).map(firewallRecord),
  }),
  projectCommand({
    path: ["gcloud", "compute", "firewall-rules", "describe"],
    summary: "Describe a Compute Engine firewall rule.",
    positionals: [
      Positional.required(
        "NAME",
        "Name of the firewall rule to describe.",
        Candidates.firewallRules,
      ),
    ],
    permission: "compute.firewalls.get",
    requiredApis: [ComputeApi],
    run: (ctx, args) =>
      Result.map(requireFirewallRule(ctx, ParsedArgs.requiredPositional(args, 0)), (rule) => ({
        world: ctx.world,
        output: CommandOutput.yaml(FirewallRule.toRecord(rule)),
      })),
  }),
  projectCommand({
    path: ["gcloud", "compute", "firewall-rules", "delete"],
    summary: "Delete Compute Engine firewall rules.",
    positionals: [
      Positional.required("NAME", "Name of the firewall rule to delete.", Candidates.firewallRules),
    ],
    destructive: true,
    permission: "compute.firewalls.delete",
    requiredApis: [ComputeApi],
    run: (ctx, args) =>
      Result.map(requireFirewallRule(ctx, ParsedArgs.requiredPositional(args, 0)), (rule) => ({
        world: World.withoutFirewallRule(ctx.world, rule),
        output: CommandOutput.messages(
          OutputMessage.plain(`Deleted [${FirewallRule.selfLink(rule)}].`),
        ),
      })),
  }),
  projectCommand({
    path: ["gcloud", "compute", "addresses", "create"],
    summary: "Reserve IP addresses.",
    positionals: [Positional.required("NAME", "Name of the address to create.")],
    flags: [
      CommonFlags.region,
      Flag.boolean("global", "If provided, it is assumed the addresses are global."),
      Flag.enum("address-type", "The type of address to reserve.", Object.values(AddressTypes)),
      Flag.string(
        "addresses",
        "Ephemeral IP address to promote to a static one (accepted as the reserved value).",
      ),
      Flag.enum("network-tier", "The network tier to assign.", ["PREMIUM", "STANDARD"]),
    ],
    permission: "compute.addresses.create",
    requiredApis: [ComputeApi],
    run: createAddress,
  }),
  listCommand({
    path: ["gcloud", "compute", "addresses", "list"],
    summary: "List addresses.",
    permission: "compute.addresses.list",
    columns: AddressColumns,
    records: (ctx) =>
      World.namedOf(ctx.world, "addresses", ctx.project.projectId).map(Address.toRecord),
  }),
  describeNamedCommand({
    path: ["gcloud", "compute", "addresses", "describe"],
    summary: "Display detailed information about an address.",
    positional: { name: "NAME", description: "Name of the address." },
    flags: [
      CommonFlags.region,
      Flag.boolean("global", "If provided, it is assumed the address is global."),
    ],
    locate: (ctx, args) =>
      ParsedArgs.boolean(args, "global")
        ? Result.ok("global")
        : CommandContext.resolveRegion(ctx, ParsedArgs.string(args, "region")),
    collection: "addresses",
    permission: "compute.addresses.get",
    requiredApis: [ComputeApi],
    resourcePath: (ref) => {
      const location = Option.unwrapOr(ref.location, "-");
      const scope = location === "global" ? "global" : `regions/${location}`;
      return `projects/${ref.projectId}/${scope}/addresses/${ref.name}`;
    },
    record: Address.toRecord,
  }),
  projectCommand({
    path: ["gcloud", "compute", "routers", "create"],
    summary: "Create a Compute Engine router.",
    positionals: [Positional.required("NAME", "Name of the router to create.")],
    flags: [
      Flag.string("network", "The network for this router.", {
        required: true,
        candidates: Candidates.networks,
      }),
      CommonFlags.region,
      Flag.integer("asn", "The BGP autonomous system number (default 64512)."),
    ],
    permission: "compute.routers.create",
    requiredApis: [ComputeApi],
    run: createRouter,
  }),
  listCommand({
    path: ["gcloud", "compute", "routers", "list"],
    summary: "List Compute Engine routers.",
    permission: "compute.routers.list",
    columns: RouterColumns,
    records: (ctx) =>
      World.namedOf(ctx.world, "routers", ctx.project.projectId).map(Router.toRecord),
  }),
  describeNamedCommand({
    path: ["gcloud", "compute", "routers", "describe"],
    summary: "Describe a Compute Engine router.",
    positional: { name: "NAME", description: "Name of the router." },
    flags: [CommonFlags.region],
    locate: (ctx, args) => CommandContext.resolveRegion(ctx, ParsedArgs.string(args, "region")),
    collection: "routers",
    permission: "compute.routers.get",
    requiredApis: [ComputeApi],
    resourcePath: (ref) =>
      `projects/${ref.projectId}/regions/${Option.unwrapOr(ref.location, "-")}/routers/${ref.name}`,
    record: Router.toRecord,
  }),
];
