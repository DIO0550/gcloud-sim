import { CommandFailure } from "@/engine/cli/command-failure";
import {
  Column,
  CommandContext,
  CommandOutput,
  type CommandResult,
  type CommandSpec,
  Flag,
  type FlagSpec,
  type JsonRecord,
  OutputMessage,
  ParsedArgs,
  Positional,
  type ProjectContext,
} from "@/engine/cli/command-spec";
import {
  alreadyExists,
  CommonFlags,
  projectCommand,
  recordOperation,
} from "@/engine/commands/shared";
import {
  DefaultImage,
  DefaultMachineType,
  MachineType,
  PublicImage,
  Region,
  Zone,
} from "@/engine/domains/catalog";
import {
  BootDiskType,
  BootDiskTypes,
  DefaultScopes,
  Direction,
  Directions,
  DiskSizeGb,
  DiskSnapshot,
  ExternalIp,
  FirewallAction,
  FirewallActions,
  FirewallRule,
  Instance,
  type InstanceTransition,
  InstanceTransitions,
  Network,
  type NetworkInterface,
  ProtocolRule,
  ProvisioningModel,
  ProvisioningModels,
  Scope,
  Subnet,
  SubnetModes,
} from "@/engine/domains/compute";
import { Operation, OperationTypes } from "@/engine/domains/operation";
import { ServiceAccount } from "@/engine/domains/service-account";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const ComputeApi = "compute.googleapis.com" as const;

const InstanceColumns = [
  Column.create("NAME", "name"),
  Column.create("ZONE", "zone", "basename"),
  Column.create("MACHINE_TYPE", "machineType", "basename"),
  Column.create("PREEMPTIBLE", "scheduling.preemptible", "flag"),
  Column.create("INTERNAL_IP", "networkInterfaces[0].networkIP"),
  Column.create("EXTERNAL_IP", "networkInterfaces[0].accessConfigs[0].natIP"),
  Column.create("STATUS", "status"),
];

const invalidName = (message: string): CommandFailure =>
  CommandFailure.invalidValue("NAME", message);

const externalIp = (sequence: number): string => `34.84.${(sequence >> 8) % 256}.${sequence % 256}`;

const resolveImage = (args: ParsedArgs): Result<PublicImage, CommandFailure> => {
  const family = ParsedArgs.string(args, "image-family");
  const project = Option.unwrapOr(ParsedArgs.string(args, "image-project"), DefaultImage.project);
  if (!Option.isSome(family)) return Result.ok(DefaultImage);
  return Option.toResult(PublicImage.parseFamily(family.value, project), () =>
    CommandFailure.notFound(`projects/${project}/global/images/family/${family.value}`),
  );
};

const resolveBootDisk = (
  args: ParsedArgs,
): Result<Readonly<{ sizeGb: number; type: BootDiskType }>, CommandFailure> => {
  const size = Result.mapErr(
    DiskSizeGb.parse(Option.unwrapOr(ParsedArgs.string(args, "boot-disk-size"), "10GB")),
    (m) => CommandFailure.invalidValue("--boot-disk-size", m),
  );
  if (!Result.isOk(size)) return size;
  const rawType = Option.unwrapOr(
    ParsedArgs.string(args, "boot-disk-type"),
    BootDiskTypes.Balanced,
  );
  return Result.map(
    Option.toResult(BootDiskType.parse(rawType), () =>
      CommandFailure.invalidChoice("--boot-disk-type", rawType, Object.values(BootDiskTypes)),
    ),
    (type) => ({ sizeGb: size.value, type }),
  );
};

const resolveNetworkInterface = (
  ctx: ProjectContext,
  args: ParsedArgs,
  zone: Zone,
): Result<NetworkInterface, CommandFailure> => {
  const projectId = ctx.project.projectId;
  const networkName = Option.unwrapOr(ParsedArgs.string(args, "network"), "default");
  const region = Zone.region(zone);
  const network = World.findNetwork(ctx.world, projectId, networkName);
  if (!Option.isSome(network)) {
    return Result.err(
      CommandFailure.notFound(`projects/${projectId}/global/networks/${networkName}`),
    );
  }
  const subnetName = Option.unwrapOr(ParsedArgs.string(args, "subnet"), networkName);
  const subnet = World.findSubnet(ctx.world, projectId, region, subnetName);
  if (!Option.isSome(subnet)) {
    const elsewhere = World.subnetsOf(ctx.world, projectId).find(
      (s) => s.name === subnetName && s.network === networkName,
    );
    return elsewhere !== undefined
      ? Result.err(
          CommandFailure.invalidState(
            `Invalid value for field 'resource.networkInterfaces[0].subnetwork': 'projects/${projectId}/regions/${elsewhere.region}/subnetworks/${subnetName}'. The subnetwork is in region '${elsewhere.region}' but the instance zone '${zone}' is in region '${region}'.`,
          ),
        )
      : Result.err(
          CommandFailure.notFound(
            `projects/${projectId}/regions/${region}/subnetworks/${subnetName}`,
          ),
        );
  }
  const inSubnet = World.instancesOf(ctx.world, projectId).filter((i) =>
    i.networkInterfaces.some(
      (nic) => nic.subnetwork === subnetName && Zone.region(i.zone) === region,
    ),
  ).length;
  const wantsAddress = Option.unwrapOr(ParsedArgs.booleanChoice(args, "address"), true);
  return Result.ok({
    network: networkName,
    subnetwork: subnetName,
    networkIP: Subnet.hostAddress(subnet.value, inSubnet),
    externalIP: wantsAddress
      ? ExternalIp.ephemeral(externalIp(ctx.world.sequence))
      : ExternalIp.None,
  });
};

const asyncOutput = (operation: Operation, verb: string, name: string): CommandOutput =>
  CommandOutput.messages(
    OutputMessage.plain(
      `Instance ${verb} in progress for [${name}]: ${Operation.selfLink(operation)}`,
    ),
    OutputMessage.plain(
      "Use [gcloud compute operations describe URI] command to check the status of the operation(s).",
    ),
  );

const resolveServiceAccount = (
  ctx: ProjectContext,
  args: ParsedArgs,
): Result<string, CommandFailure> => {
  const defaultEmail = ServiceAccount.defaultComputeEmail(ctx.project.projectNumber);
  const chosen = Option.unwrapOr(ParsedArgs.string(args, "service-account"), defaultEmail);
  const isKnown =
    chosen === defaultEmail || Option.isSome(World.findServiceAccount(ctx.world, chosen));
  return isKnown
    ? Result.ok(chosen)
    : Result.err(
        CommandFailure.notFound(`projects/${ctx.project.projectId}/serviceAccounts/${chosen}`),
      );
};

const createInstance = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const zone = CommandContext.resolveZone(ctx, ParsedArgs.string(args, "zone"));
  if (!Result.isOk(zone)) return zone;
  const machineTypeName = Option.unwrapOr(
    ParsedArgs.string(args, "machine-type"),
    DefaultMachineType,
  );
  const machineType = Option.toResult(MachineType.parse(machineTypeName), () =>
    CommandFailure.notFound(
      `projects/${ctx.project.projectId}/zones/${zone.value}/machineTypes/${machineTypeName}`,
    ),
  );
  if (!Result.isOk(machineType)) return machineType;
  const preemptible = ParsedArgs.boolean(args, "preemptible");
  const provisioningModel = Option.unwrapOr(
    Option.flatMap(ParsedArgs.string(args, "provisioning-model"), ProvisioningModel.parse),
    ProvisioningModels.Standard,
  );
  if (preemptible && provisioningModel === ProvisioningModels.Spot) {
    return Result.err(
      CommandFailure.invalidValue(
        "--preemptible",
        "--preemptible cannot be combined with --provisioning-model=SPOT.",
      ),
    );
  }
  const image = resolveImage(args);
  if (!Result.isOk(image)) return image;
  const bootDisk = resolveBootDisk(args);
  if (!Result.isOk(bootDisk)) return bootDisk;
  const nic = resolveNetworkInterface(ctx, args, zone.value);
  if (!Result.isOk(nic)) return nic;
  const serviceAccount = resolveServiceAccount(ctx, args);
  if (!Result.isOk(serviceAccount)) return serviceAccount;
  const rawScopes = ParsedArgs.list(args, "scopes");
  const scopes = rawScopes.length === 0 ? DefaultScopes : rawScopes.flatMap(Scope.expand);
  const numbered = World.nextNumber(ctx.world);
  const instance = Result.mapErr(
    Instance.create({
      projectId: ctx.project.projectId,
      name: Option.unwrapOr(ParsedArgs.positional(args, 0), ""),
      zone: zone.value,
      machineType: machineType.value.name,
      networkInterface: nic.value,
      image: image.value,
      bootDisk: bootDisk.value,
      tags: ParsedArgs.list(args, "tags"),
      serviceAccount: serviceAccount.value,
      scopes,
      preemptible,
      provisioningModel,
      metadata: ParsedArgs.keyvalue(args, "metadata"),
      creationTimestamp: ctx.now,
      sequence: numbered.number,
    }),
    invalidName,
  );
  if (!Result.isOk(instance)) return instance;
  const added = Result.mapErr(World.withInstance(numbered.world, instance.value), alreadyExists);
  if (!Result.isOk(added)) return added;
  const { world, operation } = recordOperation(added.value, {
    projectId: instance.value.projectId,
    operationType: OperationTypes.Insert,
    targetLink: Instance.selfLink(instance.value),
    targetName: instance.value.name,
    zone: Option.some(instance.value.zone),
    user: ctx.principal,
    now: ctx.now,
  });
  const output = ParsedArgs.boolean(args, "async")
    ? asyncOutput(operation, "creation", instance.value.name)
    : CommandOutput.table([Instance.toRecord(instance.value)], InstanceColumns, [
        OutputMessage.plain(`Created [${Instance.selfLink(instance.value)}].`),
      ]);
  return Result.ok({ world, output });
};

const instanceArg = (ctx: ProjectContext, args: ParsedArgs): Result<Instance, CommandFailure> => {
  const name = Option.unwrapOr(ParsedArgs.positional(args, 0), "");
  const zone = CommandContext.resolveZone(ctx, ParsedArgs.string(args, "zone"));
  if (!Result.isOk(zone)) return zone;
  return Option.toResult(
    World.findInstance(ctx.world, ctx.project.projectId, zone.value, name),
    () =>
      CommandFailure.notFound(
        `projects/${ctx.project.projectId}/zones/${zone.value}/instances/${name}`,
      ),
  );
};

/** 遷移コマンドの綴り。規則そのものは `Instance.transition` が持ち、ここは動詞の活用だけ。 */
const TransitionVerbs: Readonly<
  Record<InstanceTransition, Readonly<{ progressive: string; past: string }>>
> = {
  start: { progressive: "Starting", past: "started" },
  stop: { progressive: "Stopping", past: "stopped" },
  suspend: { progressive: "Suspending", past: "suspended" },
  resume: { progressive: "Resuming", past: "resumed" },
};

const transitionCommand = (transition: InstanceTransition): CommandSpec => {
  const verbs = TransitionVerbs[transition];
  return {
    kind: "project",
    path: ["gcloud", "compute", "instances", transition],
    summary: `${verbs.progressive.replace(/ing$/, "")} a virtual machine instance.`,
    positionals: [Positional.required("INSTANCE_NAME", "Name of the instance to operate on.")],
    flags: [CommonFlags.zone, CommonFlags.async],
    destructive: false,
    requiredPermissions: [`compute.instances.${transition}`],
    requiredApis: [ComputeApi],
    run: (ctx, args) => {
      const instance = instanceArg(ctx, args);
      if (!Result.isOk(instance)) return instance;
      const transitioned = Result.mapErr(
        Instance.transition(instance.value, transition, externalIp(ctx.world.sequence)),
        (status) =>
          CommandFailure.invalidState(
            `Invalid resource state for "${Instance.selfLink(instance.value)}": instance is in status ${status} and cannot be ${verbs.past}.`,
          ),
      );
      if (!Result.isOk(transitioned)) return transitioned;
      const next = transitioned.value.instance;
      const done = [
        OutputMessage.plain(`${verbs.progressive} instance(s) ${next.name}...done.`),
        OutputMessage.plain(`Updated [${Instance.selfLink(next)}].`),
      ];
      if (transitioned.value.kind === "unchanged") {
        return Result.ok({ world: ctx.world, output: CommandOutput.messages(...done) });
      }
      const { world, operation } = recordOperation(World.replaceInstance(ctx.world, next), {
        projectId: next.projectId,
        operationType: transition,
        targetLink: Instance.selfLink(next),
        targetName: next.name,
        zone: Option.some(next.zone),
        user: ctx.principal,
        now: ctx.now,
      });
      const output = ParsedArgs.boolean(args, "async")
        ? asyncOutput(operation, transition, next.name)
        : CommandOutput.messages(...done);
      return Result.ok({ world, output });
    },
  };
};

const ZoneColumns = [
  Column.create("NAME", "name"),
  Column.create("REGION", "region", "basename"),
  Column.create("STATUS", "status"),
  Column.create("NEXT_MAINTENANCE", "nextMaintenance"),
  Column.create("TURNDOWN_DATE", "turndownDate"),
];
const RegionColumns = [
  Column.create("NAME", "name"),
  Column.create("CPUS", "quotas[0].usage"),
  Column.create("STATUS", "status"),
];
const MachineTypeColumns = [
  Column.create("NAME", "name"),
  Column.create("ZONE", "zone"),
  Column.create("CPUS", "guestCpus"),
  Column.create("MEMORY_GB", "memoryGb"),
  Column.create("DEPRECATED", "deprecated"),
];
const ImageColumns = [
  Column.create("NAME", "name"),
  Column.create("PROJECT", "project"),
  Column.create("FAMILY", "family"),
  Column.create("DEPRECATED", "deprecated"),
  Column.create("STATUS", "status"),
];
const DiskColumns = [
  Column.create("NAME", "name"),
  Column.create("LOCATION", "zone", "basename"),
  Column.create("LOCATION_SCOPE", "locationScope"),
  Column.create("SIZE_GB", "sizeGb"),
  Column.create("TYPE", "type"),
  Column.create("STATUS", "status"),
];
const SnapshotColumns = [
  Column.create("NAME", "name"),
  Column.create("DISK_SIZE_GB", "diskSizeGb"),
  Column.create("SRC_DISK", "sourceDisk", "basename"),
  Column.create("STATUS", "status"),
];
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
const OperationColumns = [
  Column.create("NAME", "name"),
  Column.create("TYPE", "operationType"),
  Column.create("TARGET", "targetLink", "basename"),
  Column.create("HTTP_STATUS", "httpStatus"),
  Column.create("STATUS", "status"),
  Column.create("TIMESTAMP", "insertTime"),
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

const diskRecords = (ctx: ProjectContext): readonly JsonRecord[] =>
  World.instancesOf(ctx.world, ctx.project.projectId).flatMap((instance) =>
    instance.disks.map((disk) => ({
      name: disk.deviceName,
      zone: `https://www.googleapis.com/compute/v1/projects/${instance.projectId}/zones/${instance.zone}`,
      locationScope: "zone",
      sizeGb: String(disk.sizeGb),
      type: disk.type,
      status: "READY",
      sourceImage: disk.sourceImage,
      users: [Instance.selfLink(instance)],
    })),
  );

type ListCommandSeed = Readonly<{
  path: readonly string[];
  summary: string;
  permission: string;
  columns: readonly Column[];
  records: (ctx: ProjectContext, args: ParsedArgs) => readonly JsonRecord[];
  flags?: readonly FlagSpec[];
}>;

const listCommand = (seed: ListCommandSeed): CommandSpec =>
  projectCommand({
    path: seed.path,
    summary: seed.summary,
    flags: seed.flags,
    permission: seed.permission,
    requiredApis: [ComputeApi],
    run: (ctx, args) =>
      Result.ok({
        world: ctx.world,
        output: CommandOutput.table(seed.records(ctx, args), seed.columns),
      }),
  });

const parseProtocolRules = (
  flag: string,
  values: readonly string[],
): Result<readonly ProtocolRule[], CommandFailure> =>
  Result.all(
    values.map((v) =>
      Result.mapErr(ProtocolRule.parse(v), (m) => CommandFailure.invalidValue(flag, m)),
    ),
  );

const requireNetwork = (ctx: ProjectContext, name: string): Result<Network, CommandFailure> =>
  Option.toResult(World.findNetwork(ctx.world, ctx.project.projectId, name), () =>
    CommandFailure.notFound(`projects/${ctx.project.projectId}/global/networks/${name}`),
  );

const requireFirewallRule = (
  ctx: ProjectContext,
  name: string,
): Result<FirewallRule, CommandFailure> =>
  Option.toResult(World.findFirewallRule(ctx.world, ctx.project.projectId, name), () =>
    CommandFailure.notFound(`projects/${ctx.project.projectId}/global/firewalls/${name}`),
  );

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
      name: Option.unwrapOr(ParsedArgs.positional(args, 0), ""),
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
      name: Option.unwrapOr(ParsedArgs.positional(args, 0), ""),
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
        CommandOutput.table([networkRecord(created)], NetworkColumns, [
          OutputMessage.plain(`Created [${Network.selfLink(created)}].`),
        ]),
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
  const networkName = Option.unwrapOr(ParsedArgs.string(args, "network"), "");
  const network = requireNetwork(ctx, networkName);
  if (!Result.isOk(network)) return network;
  const subnet = Result.mapErr(
    Subnet.create({
      projectId: ctx.project.projectId,
      name: Option.unwrapOr(ParsedArgs.positional(args, 0), ""),
      region: region.value,
      network: networkName,
      ipCidrRange: Option.unwrapOr(ParsedArgs.string(args, "range"), ""),
      privateIpGoogleAccess: ParsedArgs.boolean(args, "enable-private-ip-google-access"),
    }),
    (m) => CommandFailure.invalidValue(m.includes("ipCidrRange") ? "--range" : "NAME", m),
  );
  if (!Result.isOk(subnet)) return subnet;
  return Result.map(
    Result.mapErr(World.withSubnet(ctx.world, subnet.value), alreadyExists),
    (world) => ({
      world,
      output: CommandOutput.table([Subnet.toRecord(subnet.value)], SubnetColumns, [
        OutputMessage.plain(`Created [${Subnet.selfLink(subnet.value)}].`),
      ]),
    }),
  );
};

const createDiskSnapshot = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const zone = CommandContext.resolveZone(
    ctx,
    Option.or(ParsedArgs.string(args, "source-disk-zone"), ParsedArgs.string(args, "zone")),
  );
  if (!Result.isOk(zone)) return zone;
  const diskName = Option.unwrapOr(ParsedArgs.string(args, "source-disk"), "");
  const owner = World.instancesOf(ctx.world, ctx.project.projectId).find(
    (i) => i.zone === zone.value && i.disks.some((d) => d.deviceName === diskName),
  );
  const disk = owner?.disks.find((d) => d.deviceName === diskName);
  if (disk === undefined) {
    return Result.err(
      CommandFailure.notFound(
        `projects/${ctx.project.projectId}/zones/${zone.value}/disks/${diskName}`,
      ),
    );
  }
  const snapshot = Result.mapErr(
    DiskSnapshot.create({
      projectId: ctx.project.projectId,
      name: Option.unwrapOr(ParsedArgs.positional(args, 0), ""),
      sourceDisk: diskName,
      sourceZone: zone.value,
      diskSizeGb: disk.sizeGb,
      creationTimestamp: ctx.now,
    }),
    invalidName,
  );
  if (!Result.isOk(snapshot)) return snapshot;
  const added = Result.mapErr(World.withDiskSnapshot(ctx.world, snapshot.value), alreadyExists);
  if (!Result.isOk(added)) return added;
  const { world } = recordOperation(added.value, {
    projectId: snapshot.value.projectId,
    operationType: OperationTypes.CreateSnapshot,
    targetLink: DiskSnapshot.sourceDiskLink(snapshot.value),
    targetName: diskName,
    zone: Option.some(zone.value),
    user: ctx.principal,
    now: ctx.now,
  });
  return Result.ok({
    world,
    output: CommandOutput.table([DiskSnapshot.toRecord(snapshot.value)], SnapshotColumns, [
      OutputMessage.plain(`Created [${DiskSnapshot.selfLink(snapshot.value)}].`),
    ]),
  });
};

export const ComputeCommands: readonly CommandSpec[] = [
  {
    kind: "project",
    path: ["gcloud", "compute", "instances", "create"],
    summary: "Create Compute Engine virtual machine instances.",
    positionals: [Positional.required("INSTANCE_NAME", "Name of the instance to create.")],
    flags: [
      CommonFlags.zone,
      Flag.string(
        "machine-type",
        "Specifies the machine type used for the instances (default: e2-medium).",
      ),
      Flag.string(
        "image-family",
        "The image family for the operating system that the boot disk will be initialized with.",
      ),
      Flag.string(
        "image-project",
        "The Google Cloud project against which all image and image family references will be resolved.",
      ),
      Flag.string(
        "network",
        "Specifies the network that the VM instances are a part of (default: default).",
      ),
      Flag.string("subnet", "Specifies the subnet that the VM instances are a part of."),
      Flag.list(
        "tags",
        "Specifies a list of tags to apply to the instance, used by firewall rules.",
      ),
      Flag.string("service-account", "A service account email address to attach to the instance."),
      Flag.list(
        "scopes",
        "Access scopes for the service account (aliases such as cloud-platform, storage-ro, or 'default').",
      ),
      Flag.boolean("preemptible", "If provided, instances will be preemptible and time-limited."),
      Flag.enum(
        "provisioning-model",
        "Specifies the provisioning model for the instance.",
        Object.values(ProvisioningModels),
      ),
      Flag.keyvalue(
        "metadata",
        "Metadata to be made available to the guest operating system running on the instances.",
      ),
      Flag.string("boot-disk-size", "The size of the boot disk, e.g. 10GB (default: 10GB)."),
      Flag.enum(
        "boot-disk-type",
        "The type of the boot disk (default: pd-balanced).",
        Object.values(BootDiskTypes),
      ),
      Flag.boolean(
        "address",
        "Assigns an ephemeral external IP address. Use --no-address for no external IP.",
      ),
      CommonFlags.async,
    ],
    destructive: false,
    requiredPermissions: ["compute.instances.create"],
    requiredApis: [ComputeApi],
    run: createInstance,
  },
  listCommand({
    path: ["gcloud", "compute", "instances", "list"],
    summary: "List Compute Engine virtual machine instances.",
    permission: "compute.instances.list",
    columns: InstanceColumns,
    records: (ctx) =>
      World.instancesOf(ctx.world, ctx.project.projectId)
        .toSorted((a, b) => a.name.localeCompare(b.name))
        .map(Instance.toRecord),
  }),
  {
    kind: "project",
    path: ["gcloud", "compute", "instances", "describe"],
    summary: "Describe a virtual machine instance.",
    positionals: [Positional.required("INSTANCE_NAME", "Name of the instance to describe.")],
    flags: [CommonFlags.zone],
    destructive: false,
    requiredPermissions: ["compute.instances.get"],
    requiredApis: [ComputeApi],
    run: (ctx, args) =>
      Result.map(instanceArg(ctx, args), (instance) => ({
        world: ctx.world,
        output: CommandOutput.yaml(Instance.toRecord(instance)),
      })),
  },
  ...Object.values(InstanceTransitions).map(transitionCommand),
  {
    kind: "project",
    path: ["gcloud", "compute", "instances", "delete"],
    summary: "Delete Compute Engine virtual machine instances.",
    positionals: [Positional.required("INSTANCE_NAME", "Name of the instance to delete.")],
    flags: [
      CommonFlags.zone,
      Flag.enum("keep-disks", "Disks to keep after deletion.", ["all", "boot", "data"]),
      Flag.enum("delete-disks", "Disks to delete.", ["all", "boot", "data"]),
      CommonFlags.async,
    ],
    destructive: true,
    requiredPermissions: ["compute.instances.delete"],
    requiredApis: [ComputeApi],
    run: (ctx, args) => {
      const instance = instanceArg(ctx, args);
      if (!Result.isOk(instance)) return instance;
      const { world, operation } = recordOperation(
        World.withoutInstance(ctx.world, instance.value),
        {
          projectId: instance.value.projectId,
          operationType: OperationTypes.Delete,
          targetLink: Instance.selfLink(instance.value),
          targetName: instance.value.name,
          zone: Option.some(instance.value.zone),
          user: ctx.principal,
          now: ctx.now,
        },
      );
      const output = ParsedArgs.boolean(args, "async")
        ? asyncOutput(operation, "deletion", instance.value.name)
        : CommandOutput.messages(
            OutputMessage.plain(`Deleted [${Instance.selfLink(instance.value)}].`),
          );
      return Result.ok({ world, output });
    },
  },
  listCommand({
    path: ["gcloud", "compute", "zones", "list"],
    summary: "List Compute Engine zones.",
    permission: "compute.zones.list",
    columns: ZoneColumns,
    records: (ctx) =>
      Zone.all().map((zone) => ({
        name: zone,
        region: `https://www.googleapis.com/compute/v1/projects/${ctx.project.projectId}/regions/${Zone.region(zone)}`,
        status: "UP",
        nextMaintenance: "",
        turndownDate: "",
      })),
  }),
  listCommand({
    path: ["gcloud", "compute", "regions", "list"],
    summary: "List Compute Engine regions.",
    permission: "compute.regions.list",
    columns: RegionColumns,
    records: () =>
      Region.all().map((region) => ({
        name: region,
        status: "UP",
        quotas: [{ metric: "CPUS", usage: 0, limit: 24 }],
      })),
  }),
  listCommand({
    path: ["gcloud", "compute", "machine-types", "list"],
    summary: "List Compute Engine machine types.",
    permission: "compute.machineTypes.list",
    columns: MachineTypeColumns,
    flags: [Flag.list("zones", "If provided, only resources from the given zones are queried.")],
    records: (_ctx, args) => {
      const zones = ParsedArgs.list(args, "zones");
      const chosen = zones.length === 0 ? Zone.all() : Zone.all().filter((z) => zones.includes(z));
      return chosen.flatMap((zone) =>
        MachineType.all().map((type) => ({
          name: type.name,
          zone,
          guestCpus: type.guestCpus,
          memoryGb: type.memoryMb / 1024,
          deprecated: "",
          description: type.description,
        })),
      );
    },
  }),
  listCommand({
    path: ["gcloud", "compute", "images", "list"],
    summary: "List Compute Engine images.",
    permission: "compute.images.list",
    columns: ImageColumns,
    records: () =>
      PublicImage.all().map((image) => ({ ...image, deprecated: "", status: "READY" })),
  }),
  listCommand({
    path: ["gcloud", "compute", "disks", "list"],
    summary: "List Compute Engine disks.",
    permission: "compute.disks.list",
    columns: DiskColumns,
    records: diskRecords,
  }),
  {
    kind: "project",
    path: ["gcloud", "compute", "snapshots", "create"],
    summary: "Create a Compute Engine snapshot from a disk.",
    positionals: [Positional.required("SNAPSHOT_NAME", "Name of the snapshot to create.")],
    flags: [
      Flag.string("source-disk", "Source disk used to create the snapshot.", { required: true }),
      Flag.string("source-disk-zone", "Zone of the source disk."),
      CommonFlags.zone,
    ],
    destructive: false,
    requiredPermissions: ["compute.disks.createSnapshot"],
    requiredApis: [ComputeApi],
    run: createDiskSnapshot,
  },
  listCommand({
    path: ["gcloud", "compute", "snapshots", "list"],
    summary: "List Compute Engine snapshots.",
    permission: "compute.snapshots.list",
    columns: SnapshotColumns,
    records: (ctx) =>
      World.diskSnapshotsOf(ctx.world, ctx.project.projectId).map(DiskSnapshot.toRecord),
  }),
  {
    kind: "project",
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
    destructive: false,
    requiredPermissions: ["compute.networks.create"],
    requiredApis: [ComputeApi],
    run: createNetwork,
  },
  listCommand({
    path: ["gcloud", "compute", "networks", "list"],
    summary: "List Compute Engine networks.",
    permission: "compute.networks.list",
    columns: NetworkColumns,
    records: (ctx) => World.networksOf(ctx.world, ctx.project.projectId).map(networkRecord),
  }),
  {
    kind: "project",
    path: ["gcloud", "compute", "networks", "describe"],
    summary: "Describe a Compute Engine network.",
    positionals: [Positional.required("NAME", "Name of the network to describe.")],
    flags: [],
    destructive: false,
    requiredPermissions: ["compute.networks.get"],
    requiredApis: [ComputeApi],
    run: (ctx, args) =>
      Result.map(
        requireNetwork(ctx, Option.unwrapOr(ParsedArgs.positional(args, 0), "")),
        (network) => ({ world: ctx.world, output: CommandOutput.yaml(networkRecord(network)) }),
      ),
  },
  {
    kind: "project",
    path: ["gcloud", "compute", "networks", "delete"],
    summary: "Delete a Compute Engine network.",
    positionals: [Positional.required("NAME", "Name of the network to delete.")],
    flags: [],
    destructive: true,
    requiredPermissions: ["compute.networks.delete"],
    requiredApis: [ComputeApi],
    run: (ctx, args) => {
      const network = requireNetwork(ctx, Option.unwrapOr(ParsedArgs.positional(args, 0), ""));
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
  },
  {
    kind: "project",
    path: ["gcloud", "compute", "networks", "subnets", "create"],
    summary: "Define a subnet for a network in custom subnet mode.",
    positionals: [Positional.required("NAME", "Name of the subnetwork to create.")],
    flags: [
      Flag.string("network", "The network to which the subnetwork belongs.", { required: true }),
      Flag.string("range", "The IP space allocated to this subnetwork in CIDR format.", {
        required: true,
      }),
      CommonFlags.region,
      Flag.boolean(
        "enable-private-ip-google-access",
        "Enable/disable access to Google Cloud APIs from this subnet for instances without a public ip address.",
      ),
    ],
    destructive: false,
    requiredPermissions: ["compute.subnetworks.create"],
    requiredApis: [ComputeApi],
    run: createSubnet,
  },
  listCommand({
    path: ["gcloud", "compute", "networks", "subnets", "list"],
    summary: "List Compute Engine subnetworks.",
    permission: "compute.subnetworks.list",
    columns: SubnetColumns,
    records: (ctx) => World.subnetsOf(ctx.world, ctx.project.projectId).map(Subnet.toRecord),
  }),
  {
    kind: "project",
    path: ["gcloud", "compute", "firewall-rules", "create"],
    summary: "Create a Compute Engine firewall rule.",
    positionals: [Positional.required("NAME", "Name of the firewall rule to create.")],
    flags: [
      Flag.string("network", "The network to which this rule is attached (default: default)."),
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
    destructive: false,
    requiredPermissions: ["compute.firewalls.create"],
    requiredApis: [ComputeApi],
    run: createFirewallRule,
  },
  listCommand({
    path: ["gcloud", "compute", "firewall-rules", "list"],
    summary: "List Compute Engine firewall rules.",
    permission: "compute.firewalls.list",
    columns: FirewallColumns,
    records: (ctx) => World.firewallRulesOf(ctx.world, ctx.project.projectId).map(firewallRecord),
  }),
  {
    kind: "project",
    path: ["gcloud", "compute", "firewall-rules", "describe"],
    summary: "Describe a Compute Engine firewall rule.",
    positionals: [Positional.required("NAME", "Name of the firewall rule to describe.")],
    flags: [],
    destructive: false,
    requiredPermissions: ["compute.firewalls.get"],
    requiredApis: [ComputeApi],
    run: (ctx, args) =>
      Result.map(
        requireFirewallRule(ctx, Option.unwrapOr(ParsedArgs.positional(args, 0), "")),
        (rule) => ({ world: ctx.world, output: CommandOutput.yaml(FirewallRule.toRecord(rule)) }),
      ),
  },
  {
    kind: "project",
    path: ["gcloud", "compute", "firewall-rules", "delete"],
    summary: "Delete Compute Engine firewall rules.",
    positionals: [Positional.required("NAME", "Name of the firewall rule to delete.")],
    flags: [],
    destructive: true,
    requiredPermissions: ["compute.firewalls.delete"],
    requiredApis: [ComputeApi],
    run: (ctx, args) =>
      Result.map(
        requireFirewallRule(ctx, Option.unwrapOr(ParsedArgs.positional(args, 0), "")),
        (rule) => ({
          world: World.withoutFirewallRule(ctx.world, rule),
          output: CommandOutput.messages(
            OutputMessage.plain(`Deleted [${FirewallRule.selfLink(rule)}].`),
          ),
        }),
      ),
  },
  listCommand({
    path: ["gcloud", "compute", "operations", "list"],
    summary: "List Compute Engine operations.",
    permission: "compute.zoneOperations.list",
    columns: OperationColumns,
    records: (ctx) =>
      World.operationsOf(ctx.world, ctx.project.projectId).map((o) => ({
        ...Operation.toRecord(o),
        httpStatus: 200,
      })),
  }),
];
