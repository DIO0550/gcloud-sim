import { CommandFailure } from "@/engine/cli/command-error";
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
import { alreadyExists, CommonFlags, recordOperation } from "@/engine/commands/shared";
import {
  DefaultImage,
  DefaultMachineType,
  MachineType,
  PublicImage,
  Region,
  Zone,
} from "@/engine/domains/catalog";
import {
  type AttachedDisk,
  DefaultScopes,
  Directions,
  ExternalIp,
  FirewallRule,
  Instance,
  InstanceStatuses,
  Network,
  type NetworkInterface,
  ProtocolRule,
  ProvisioningModels,
  ResourceName,
  Scope,
  Snapshot,
  Subnet,
  SubnetModes,
} from "@/engine/domains/compute";
import { Operation } from "@/engine/domains/operation";
import { ServiceAccount } from "@/engine/domains/service-account";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const ComputeApi = "compute.googleapis.com" as const;

const InstanceColumns = [
  Column.of("NAME", "name"),
  Column.of("ZONE", "zone", "basename"),
  Column.of("MACHINE_TYPE", "machineType", "basename"),
  Column.of("PREEMPTIBLE", "scheduling.preemptibleFlag"),
  Column.of("INTERNAL_IP", "networkInterfaces[0].networkIP"),
  Column.of("EXTERNAL_IP", "networkInterfaces[0].accessConfigs[0].natIP"),
  Column.of("STATUS", "status"),
];

/** table の PREEMPTIBLE 列は真のときだけ `true` を出す（本物と同じ）。 */
const instanceRecord = (instance: Instance): JsonRecord => {
  const record = Instance.toRecord(instance);
  const scheduling = record.scheduling as Readonly<Record<string, unknown>>;
  return {
    ...record,
    scheduling: { ...scheduling, preemptibleFlag: instance.preemptible ? "true" : "" },
  } as JsonRecord;
};

const invalidName = (message: string): CommandFailure =>
  CommandFailure.invalidValue("NAME", message);

const externalIp = (sequence: number): string => `34.84.${(sequence >> 8) % 256}.${sequence % 256}`;

const bootDisk = (name: string, args: ParsedArgs, image: PublicImage): AttachedDisk => {
  const rawSize = Option.unwrapOr(ParsedArgs.string(args, "boot-disk-size"), "10GB");
  const size = Number.parseInt(rawSize, 10);
  return {
    deviceName: name,
    boot: true,
    sizeGb: Number.isNaN(size) ? 10 : size,
    type: Option.unwrapOr(ParsedArgs.string(args, "boot-disk-type"), "pd-balanced"),
    sourceImage: `projects/${image.project}/global/images/${image.name}`,
  };
};

const resolveImage = (args: ParsedArgs): Result<PublicImage, CommandFailure> => {
  const family = ParsedArgs.string(args, "image-family");
  const project = Option.unwrapOr(ParsedArgs.string(args, "image-project"), DefaultImage.project);
  if (!Option.isSome(family)) return Result.ok(DefaultImage);
  const image = PublicImage.parseFamily(family.value, project);
  return Option.isSome(image)
    ? Result.ok(image.value)
    : Result.err(
        CommandFailure.notFound(`projects/${project}/global/images/family/${family.value}`),
      );
};

const resolveNetworkInterface = (
  ctx: ProjectContext,
  args: ParsedArgs,
  zone: Zone,
): Result<NetworkInterface, CommandFailure> => {
  const projectId = ctx.project.projectId;
  const networkName = Option.unwrapOr(ParsedArgs.string(args, "network"), "default");
  const region = Zone.regionOf(zone);
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
      (nic) => nic.subnetwork === subnetName && Zone.regionOf(i.zone) === region,
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
      `Instance ${verb} in progress for [${name}]: https://www.googleapis.com/compute/v1/projects/${operation.projectId}/zones/${operation.zone}/operations/${operation.name}`,
    ),
    OutputMessage.plain(
      "Use [gcloud compute operations describe URI] command to check the status of the operation(s).",
    ),
  );

const createInstance = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const rawName = Option.unwrapOr(ParsedArgs.positional(args, 0), "");
  const name = Result.mapErr(ResourceName.parse(rawName), invalidName);
  if (!Result.isOk(name)) return name;
  const zone = CommandContext.resolveZone(ctx, ParsedArgs.string(args, "zone"));
  if (!Result.isOk(zone)) return zone;
  const machineTypeName = Option.unwrapOr(
    ParsedArgs.string(args, "machine-type"),
    DefaultMachineType,
  );
  const machineType = MachineType.parse(machineTypeName);
  if (!Option.isSome(machineType)) {
    return Result.err(
      CommandFailure.notFound(
        `projects/${ctx.project.projectId}/zones/${zone.value}/machineTypes/${machineTypeName}`,
      ),
    );
  }
  const preemptible = ParsedArgs.boolean(args, "preemptible");
  const provisioningModel = Option.unwrapOr(
    ParsedArgs.string(args, "provisioning-model"),
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
  const nic = resolveNetworkInterface(ctx, args, zone.value);
  if (!Result.isOk(nic)) return nic;
  const serviceAccount = Option.unwrapOr(
    ParsedArgs.string(args, "service-account"),
    ServiceAccount.defaultComputeEmail(ctx.project.projectNumber),
  );
  const isCustomSa =
    serviceAccount !== ServiceAccount.defaultComputeEmail(ctx.project.projectNumber);
  if (isCustomSa && !Option.isSome(World.findServiceAccount(ctx.world, serviceAccount))) {
    return Result.err(
      CommandFailure.notFound(
        `projects/${ctx.project.projectId}/serviceAccounts/${serviceAccount}`,
      ),
    );
  }
  const rawScopes = ParsedArgs.list(args, "scopes");
  const scopes = rawScopes.length === 0 ? DefaultScopes : rawScopes.flatMap(Scope.expand);
  const numbered = World.nextNumber(ctx.world);
  const instance: Instance = {
    projectId: ctx.project.projectId,
    name: name.value,
    zone: zone.value,
    machineType: machineType.value.name,
    status: InstanceStatuses.Running,
    networkInterfaces: [nic.value],
    disks: [bootDisk(name.value, args, image.value)],
    tags: ParsedArgs.list(args, "tags"),
    serviceAccount,
    scopes,
    preemptible,
    provisioningModel:
      provisioningModel === ProvisioningModels.Spot
        ? ProvisioningModels.Spot
        : ProvisioningModels.Standard,
    metadata: ParsedArgs.keyvalue(args, "metadata"),
    creationTimestamp: ctx.now,
    id: String(4812000000000000000n + BigInt(numbered.number)),
  };
  const added = Result.mapErr(World.withInstance(numbered.world, instance), alreadyExists);
  if (!Result.isOk(added)) return added;
  const { world, operation } = recordOperation(added.value, {
    projectId: instance.projectId,
    operationType: "insert",
    targetLink: Instance.selfLink(instance),
    targetName: instance.name,
    zone: instance.zone,
    user: ctx.principal,
    now: ctx.now,
  });
  const output = ParsedArgs.boolean(args, "async")
    ? asyncOutput(operation, "creation", instance.name)
    : CommandOutput.table([instanceRecord(instance)], InstanceColumns, [
        OutputMessage.plain(`Created [${Instance.selfLink(instance)}].`),
      ]);
  return Result.ok({ world, output });
};

const instanceArg = (ctx: ProjectContext, args: ParsedArgs): Result<Instance, CommandFailure> => {
  const name = Option.unwrapOr(ParsedArgs.positional(args, 0), "");
  const zone = CommandContext.resolveZone(ctx, ParsedArgs.string(args, "zone"));
  if (!Result.isOk(zone)) return zone;
  const instance = World.findInstance(ctx.world, ctx.project.projectId, zone.value, name);
  return Option.isSome(instance)
    ? Result.ok(instance.value)
    : Result.err(
        CommandFailure.notFound(
          `projects/${ctx.project.projectId}/zones/${zone.value}/instances/${name}`,
        ),
      );
};

type Transition = Readonly<{
  verb: string;
  operationType: "start" | "stop" | "suspend" | "resume";
  permission: string;
  from: readonly Instance["status"][];
  to: Instance["status"];
  /** `from` 以外のうち、冪等に成功扱いする状態（設計書 8「不正な遷移」） */
  idempotentFrom: readonly Instance["status"][];
}>;

const Transitions: Readonly<Record<"start" | "stop" | "suspend" | "resume", Transition>> = {
  start: {
    verb: "Starting",
    operationType: "start",
    permission: "compute.instances.start",
    from: [InstanceStatuses.Terminated],
    to: InstanceStatuses.Running,
    idempotentFrom: [InstanceStatuses.Running],
  },
  stop: {
    verb: "Stopping",
    operationType: "stop",
    permission: "compute.instances.stop",
    from: [InstanceStatuses.Running],
    to: InstanceStatuses.Terminated,
    idempotentFrom: [InstanceStatuses.Terminated],
  },
  suspend: {
    verb: "Suspending",
    operationType: "suspend",
    permission: "compute.instances.suspend",
    from: [InstanceStatuses.Running],
    to: InstanceStatuses.Suspended,
    idempotentFrom: [InstanceStatuses.Suspended],
  },
  resume: {
    verb: "Resuming",
    operationType: "resume",
    permission: "compute.instances.resume",
    from: [InstanceStatuses.Suspended],
    to: InstanceStatuses.Running,
    idempotentFrom: [InstanceStatuses.Running],
  },
};

const transitionCommand = (name: keyof typeof Transitions): CommandSpec => {
  const t = Transitions[name];
  return {
    kind: "project",
    path: ["gcloud", "compute", "instances", name],
    summary: `${t.verb.replace(/ing$/, "")} a virtual machine instance.`,
    positionals: [Positional.required("INSTANCE_NAME", "Name of the instance to operate on.")],
    flags: [CommonFlags.zone, CommonFlags.async],
    destructive: false,
    requiredPermissions: [t.permission],
    requiredApis: [ComputeApi],
    run: (ctx, args) => {
      const instance = instanceArg(ctx, args);
      if (!Result.isOk(instance)) return instance;
      const current = instance.value;
      const done = OutputMessage.plain(`${t.verb} instance(s) ${current.name}...done.`);
      if (t.idempotentFrom.includes(current.status)) {
        return Result.ok({
          world: ctx.world,
          output: CommandOutput.messages(
            done,
            OutputMessage.plain(`Updated [${Instance.selfLink(current)}].`),
          ),
        });
      }
      if (!t.from.includes(current.status)) {
        return Result.err(
          CommandFailure.invalidState(
            `Invalid resource state for "${Instance.selfLink(current)}": instance is in status ${current.status} and cannot be ${name === "stop" ? "stopped" : `${name}d`}.`,
          ),
        );
      }
      const next = Instance.withStatus(current, t.to, externalIp(ctx.world.sequence));
      const { world, operation } = recordOperation(World.replaceInstance(ctx.world, next), {
        projectId: next.projectId,
        operationType: t.operationType,
        targetLink: Instance.selfLink(next),
        targetName: next.name,
        zone: next.zone,
        user: ctx.principal,
        now: ctx.now,
      });
      const output = ParsedArgs.boolean(args, "async")
        ? asyncOutput(operation, name, next.name)
        : CommandOutput.messages(
            done,
            OutputMessage.plain(`Updated [${Instance.selfLink(next)}].`),
          );
      return Result.ok({ world, output });
    },
  };
};

const ZoneColumns = [
  Column.of("NAME", "name"),
  Column.of("REGION", "region", "basename"),
  Column.of("STATUS", "status"),
  Column.of("NEXT_MAINTENANCE", "nextMaintenance"),
  Column.of("TURNDOWN_DATE", "turndownDate"),
];
const RegionColumns = [
  Column.of("NAME", "name"),
  Column.of("CPUS", "quotas[0].usage"),
  Column.of("STATUS", "status"),
];
const MachineTypeColumns = [
  Column.of("NAME", "name"),
  Column.of("ZONE", "zone"),
  Column.of("CPUS", "guestCpus"),
  Column.of("MEMORY_GB", "memoryGb"),
  Column.of("DEPRECATED", "deprecated"),
];
const ImageColumns = [
  Column.of("NAME", "name"),
  Column.of("PROJECT", "project"),
  Column.of("FAMILY", "family"),
  Column.of("DEPRECATED", "deprecated"),
  Column.of("STATUS", "status"),
];
const DiskColumns = [
  Column.of("NAME", "name"),
  Column.of("LOCATION", "zone", "basename"),
  Column.of("LOCATION_SCOPE", "locationScope"),
  Column.of("SIZE_GB", "sizeGb"),
  Column.of("TYPE", "type"),
  Column.of("STATUS", "status"),
];
const SnapshotColumns = [
  Column.of("NAME", "name"),
  Column.of("DISK_SIZE_GB", "diskSizeGb"),
  Column.of("SRC_DISK", "sourceDisk", "basename"),
  Column.of("STATUS", "status"),
];
const NetworkColumns = [
  Column.of("NAME", "name"),
  Column.of("SUBNET_MODE", "subnetMode"),
  Column.of("BGP_ROUTING_MODE", "routingConfig.routingMode"),
  Column.of("IPV4_RANGE", "IPv4Range"),
  Column.of("GATEWAY_IPV4", "gatewayIPv4"),
];
const SubnetColumns = [
  Column.of("NAME", "name"),
  Column.of("REGION", "region", "basename"),
  Column.of("NETWORK", "network", "basename"),
  Column.of("RANGE", "ipCidrRange"),
];
const FirewallColumns = [
  Column.of("NAME", "name"),
  Column.of("NETWORK", "network", "basename"),
  Column.of("DIRECTION", "direction"),
  Column.of("PRIORITY", "priority"),
  Column.of("ALLOW", "allowText"),
  Column.of("DENY", "denyText"),
  Column.of("DISABLED", "disabled"),
];
const OperationColumns = [
  Column.of("NAME", "name"),
  Column.of("TYPE", "operationType"),
  Column.of("TARGET", "targetLink", "basename"),
  Column.of("HTTP_STATUS", "httpStatus"),
  Column.of("STATUS", "status"),
  Column.of("TIMESTAMP", "insertTime"),
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

const listCommand = (
  path: readonly string[],
  summary: string,
  permission: string,
  columns: readonly Column[],
  records: (ctx: ProjectContext, args: ParsedArgs) => readonly JsonRecord[],
  flags: readonly ReturnType<typeof Flag.string>[] = [],
): CommandSpec => ({
  kind: "project",
  path,
  summary,
  positionals: [],
  flags,
  destructive: false,
  requiredPermissions: [permission],
  requiredApis: [ComputeApi],
  run: (ctx, args) =>
    Result.ok({ world: ctx.world, output: CommandOutput.table(records(ctx, args), columns) }),
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
      Flag.enum("provisioning-model", "Specifies the provisioning model for the instance.", [
        "STANDARD",
        "SPOT",
      ]),
      Flag.keyvalue(
        "metadata",
        "Metadata to be made available to the guest operating system running on the instances.",
      ),
      Flag.keyvalue("labels", "List of label KEY=VALUE pairs to add."),
      Flag.string("boot-disk-size", "The size of the boot disk, e.g. 10GB."),
      Flag.string(
        "boot-disk-type",
        "The type of the boot disk (pd-standard, pd-balanced, pd-ssd).",
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
  listCommand(
    ["gcloud", "compute", "instances", "list"],
    "List Compute Engine virtual machine instances.",
    "compute.instances.list",
    InstanceColumns,
    (ctx) =>
      World.instancesOf(ctx.world, ctx.project.projectId)
        .toSorted((a, b) => a.name.localeCompare(b.name))
        .map(instanceRecord),
  ),
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
  transitionCommand("start"),
  transitionCommand("stop"),
  transitionCommand("suspend"),
  transitionCommand("resume"),
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
          operationType: "delete",
          targetLink: Instance.selfLink(instance.value),
          targetName: instance.value.name,
          zone: instance.value.zone,
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
  listCommand(
    ["gcloud", "compute", "zones", "list"],
    "List Compute Engine zones.",
    "compute.zones.list",
    ZoneColumns,
    (ctx) =>
      Zone.all().map((zone) => ({
        name: zone,
        region: `https://www.googleapis.com/compute/v1/projects/${ctx.project.projectId}/regions/${Zone.regionOf(zone)}`,
        status: "UP",
        nextMaintenance: "",
        turndownDate: "",
      })),
  ),
  listCommand(
    ["gcloud", "compute", "regions", "list"],
    "List Compute Engine regions.",
    "compute.regions.list",
    RegionColumns,
    () =>
      Region.all().map((region) => ({
        name: region,
        status: "UP",
        quotas: [{ metric: "CPUS", usage: 0, limit: 24 }],
      })),
  ),
  listCommand(
    ["gcloud", "compute", "machine-types", "list"],
    "List Compute Engine machine types.",
    "compute.machineTypes.list",
    MachineTypeColumns,
    (_ctx, args) => {
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
    [Flag.list("zones", "If provided, only resources from the given zones are queried.")],
  ),
  listCommand(
    ["gcloud", "compute", "images", "list"],
    "List Compute Engine images.",
    "compute.images.list",
    ImageColumns,
    () => PublicImage.all().map((image) => ({ ...image, deprecated: "", status: "READY" })),
  ),
  listCommand(
    ["gcloud", "compute", "disks", "list"],
    "List Compute Engine disks.",
    "compute.disks.list",
    DiskColumns,
    diskRecords,
  ),
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
    run: (ctx, args) => {
      const rawName = Option.unwrapOr(ParsedArgs.positional(args, 0), "");
      const name = Result.mapErr(ResourceName.parse(rawName), invalidName);
      if (!Result.isOk(name)) return name;
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
      const snapshot: Snapshot = {
        projectId: ctx.project.projectId,
        name: name.value,
        sourceDisk: diskName,
        sourceZone: zone.value,
        diskSizeGb: disk.sizeGb,
        creationTimestamp: ctx.now,
      };
      const added = Result.mapErr(World.withSnapshot(ctx.world, snapshot), alreadyExists);
      if (!Result.isOk(added)) return added;
      const { world } = recordOperation(added.value, {
        projectId: snapshot.projectId,
        operationType: "createSnapshot",
        targetLink: `https://www.googleapis.com/compute/v1/projects/${snapshot.projectId}/zones/${zone.value}/disks/${diskName}`,
        targetName: diskName,
        zone: zone.value,
        user: ctx.principal,
        now: ctx.now,
      });
      return Result.ok({
        world,
        output: CommandOutput.table([Snapshot.toRecord(snapshot)], SnapshotColumns, [
          OutputMessage.plain(
            `Created [https://www.googleapis.com/compute/v1/projects/${snapshot.projectId}/global/snapshots/${snapshot.name}].`,
          ),
        ]),
      });
    },
  },
  listCommand(
    ["gcloud", "compute", "snapshots", "list"],
    "List Compute Engine snapshots.",
    "compute.snapshots.list",
    SnapshotColumns,
    (ctx) => World.snapshotsOf(ctx.world, ctx.project.projectId).map(Snapshot.toRecord),
  ),
  {
    kind: "project",
    path: ["gcloud", "compute", "networks", "create"],
    summary: "Create a Compute Engine network.",
    positionals: [Positional.required("NAME", "Name of the network to create.")],
    flags: [
      Flag.enum("subnet-mode", "The subnet mode of the network.", ["auto", "custom", "legacy"]),
      Flag.enum("bgp-routing-mode", "The BGP routing mode for this network.", [
        "global",
        "regional",
      ]),
    ],
    destructive: false,
    requiredPermissions: ["compute.networks.create"],
    requiredApis: [ComputeApi],
    run: (ctx, args) => {
      const rawName = Option.unwrapOr(ParsedArgs.positional(args, 0), "");
      const name = Result.mapErr(ResourceName.parse(rawName), invalidName);
      if (!Result.isOk(name)) return name;
      const mode = Option.unwrapOr(ParsedArgs.string(args, "subnet-mode"), "auto");
      const network: Network = {
        projectId: ctx.project.projectId,
        name: name.value,
        subnetMode: mode === "custom" ? SubnetModes.Custom : SubnetModes.Auto,
      };
      const subnets =
        network.subnetMode === SubnetModes.Auto
          ? Subnet.autoRange(network.projectId, network.name, Region.all())
          : [];
      return Result.map(
        Result.mapErr(World.withNetwork(ctx.world, network, subnets), alreadyExists),
        (world) => ({
          world,
          output: CommandOutput.withTrailing(
            CommandOutput.table([networkRecord(network)], NetworkColumns, [
              OutputMessage.plain(
                `Created [https://www.googleapis.com/compute/v1/projects/${network.projectId}/global/networks/${network.name}].`,
              ),
            ]),
            OutputMessage.plain(""),
            OutputMessage.plain(
              "Instances on this network will not be reachable until firewall rules",
            ),
            OutputMessage.plain(
              "are created. As an example, you can allow all internal traffic between",
            ),
            OutputMessage.plain("instances as well as SSH, RDP, and ICMP by running:"),
            OutputMessage.plain(""),
            OutputMessage.plain(
              `$ gcloud compute firewall-rules create <FIREWALL_NAME> --network ${network.name} --allow tcp,udp,icmp --source-ranges <IP_RANGE>`,
            ),
            OutputMessage.plain(
              `$ gcloud compute firewall-rules create <FIREWALL_NAME> --network ${network.name} --allow tcp:22,tcp:3389,icmp`,
            ),
          ),
        }),
      );
    },
  },
  listCommand(
    ["gcloud", "compute", "networks", "list"],
    "List Compute Engine networks.",
    "compute.networks.list",
    NetworkColumns,
    (ctx) => World.networksOf(ctx.world, ctx.project.projectId).map(networkRecord),
  ),
  {
    kind: "project",
    path: ["gcloud", "compute", "networks", "describe"],
    summary: "Describe a Compute Engine network.",
    positionals: [Positional.required("NAME", "Name of the network to describe.")],
    flags: [],
    destructive: false,
    requiredPermissions: ["compute.networks.get"],
    requiredApis: [ComputeApi],
    run: (ctx, args) => {
      const name = Option.unwrapOr(ParsedArgs.positional(args, 0), "");
      const network = World.findNetwork(ctx.world, ctx.project.projectId, name);
      return Option.isSome(network)
        ? Result.ok({ world: ctx.world, output: CommandOutput.yaml(networkRecord(network.value)) })
        : Result.err(
            CommandFailure.notFound(`projects/${ctx.project.projectId}/global/networks/${name}`),
          );
    },
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
      const name = Option.unwrapOr(ParsedArgs.positional(args, 0), "");
      const link = `projects/${ctx.project.projectId}/global/networks/${name}`;
      if (!Option.isSome(World.findNetwork(ctx.world, ctx.project.projectId, name)))
        return Result.err(CommandFailure.notFound(link));
      const world = World.withoutNetwork(ctx.world, ctx.project.projectId, name);
      if (!Option.isSome(world)) {
        const subnet = World.subnetsOf(ctx.world, ctx.project.projectId).find(
          (s) => s.network === name,
        );
        return Result.err(
          CommandFailure.invalidState(
            `The network resource '${link}' is already being used by 'projects/${ctx.project.projectId}/regions/${subnet?.region}/subnetworks/${subnet?.name}'`,
          ),
        );
      }
      return Result.ok({
        world: world.value,
        output: CommandOutput.messages(
          OutputMessage.plain(`Deleted [https://www.googleapis.com/compute/v1/${link}].`),
        ),
      });
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
    run: (ctx, args) => {
      const rawName = Option.unwrapOr(ParsedArgs.positional(args, 0), "");
      const name = Result.mapErr(ResourceName.parse(rawName), invalidName);
      if (!Result.isOk(name)) return name;
      const rawRegion = Option.or(
        ParsedArgs.string(args, "region"),
        Option.fromNullable(
          ctx.world.config.configurations[ctx.world.config.activeConfiguration]?.["compute/region"],
        ),
      );
      if (!Option.isSome(rawRegion)) return Result.err(CommandFailure.mustBeSpecified("--region"));
      const region = Region.parse(rawRegion.value);
      if (!Option.isSome(region))
        return Result.err(
          CommandFailure.notFound(`projects/${ctx.project.projectId}/regions/${rawRegion.value}`),
        );
      const networkName = Option.unwrapOr(ParsedArgs.string(args, "network"), "");
      if (!Option.isSome(World.findNetwork(ctx.world, ctx.project.projectId, networkName))) {
        return Result.err(
          CommandFailure.notFound(
            `projects/${ctx.project.projectId}/global/networks/${networkName}`,
          ),
        );
      }
      const subnet = Result.mapErr(
        Subnet.create({
          projectId: ctx.project.projectId,
          name: name.value,
          region: region.value,
          network: networkName,
          ipCidrRange: Option.unwrapOr(ParsedArgs.string(args, "range"), ""),
          privateIpGoogleAccess: ParsedArgs.boolean(args, "enable-private-ip-google-access"),
        }),
        (m) => CommandFailure.invalidValue("--range", m),
      );
      if (!Result.isOk(subnet)) return subnet;
      return Result.map(
        Result.mapErr(World.withSubnet(ctx.world, subnet.value), alreadyExists),
        (world) => ({
          world,
          output: CommandOutput.table([Subnet.toRecord(subnet.value)], SubnetColumns, [
            OutputMessage.plain(
              `Created [https://www.googleapis.com/compute/v1/projects/${ctx.project.projectId}/regions/${region.value}/subnetworks/${name.value}].`,
            ),
          ]),
        }),
      );
    },
  },
  listCommand(
    ["gcloud", "compute", "networks", "subnets", "list"],
    "List Compute Engine subnetworks.",
    "compute.subnetworks.list",
    SubnetColumns,
    (ctx) => World.subnetsOf(ctx.world, ctx.project.projectId).map(Subnet.toRecord),
  ),
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
      Flag.enum("action", "The action for the firewall rule.", ["ALLOW", "DENY"]),
      Flag.list(
        "rules",
        "A list of protocols and ports to which the firewall rule will apply (used with --action).",
      ),
      Flag.enum("direction", "Direction of the traffic the rule applies to.", [
        "INGRESS",
        "EGRESS",
      ]),
      Flag.integer("priority", "Priority of the rule (0-65535, default 1000)."),
      Flag.list(
        "source-ranges",
        "A list of IP address blocks that are allowed to make inbound connections (default: 0.0.0.0/0).",
      ),
      Flag.list(
        "target-tags",
        "A list of instance tags indicating the set of instances on the network which may accept connections.",
      ),
      Flag.list("destination-ranges", "A list of IP address blocks for outbound connections."),
      Flag.boolean("disabled", "Disable the firewall rule."),
    ],
    destructive: false,
    requiredPermissions: ["compute.firewalls.create"],
    requiredApis: [ComputeApi],
    run: (ctx, args) => {
      const rawName = Option.unwrapOr(ParsedArgs.positional(args, 0), "");
      const name = Result.mapErr(ResourceName.parse(rawName), invalidName);
      if (!Result.isOk(name)) return name;
      const networkName = Option.unwrapOr(ParsedArgs.string(args, "network"), "default");
      if (!Option.isSome(World.findNetwork(ctx.world, ctx.project.projectId, networkName))) {
        return Result.err(
          CommandFailure.notFound(
            `projects/${ctx.project.projectId}/global/networks/${networkName}`,
          ),
        );
      }
      const allowFlag = ParsedArgs.list(args, "allow");
      const action = ParsedArgs.string(args, "action");
      const rules = ParsedArgs.list(args, "rules");
      const hasAllow = allowFlag.length > 0;
      const hasAction = Option.isSome(action);
      if (hasAllow === hasAction) {
        return Result.err(CommandFailure.mustBeSpecified("(--action --rules | --allow)"));
      }
      const parsed = parseProtocolRules(
        hasAllow ? "--allow" : "--rules",
        hasAllow ? allowFlag : rules,
      );
      if (!Result.isOk(parsed)) return parsed;
      const denies = hasAction && action.value === "DENY";
      const direction =
        Option.unwrapOr(ParsedArgs.string(args, "direction"), Directions.Ingress) ===
        Directions.Egress
          ? Directions.Egress
          : Directions.Ingress;
      const rule: FirewallRule = {
        projectId: ctx.project.projectId,
        name: name.value,
        network: networkName,
        direction,
        priority: Option.unwrapOr(ParsedArgs.integer(args, "priority"), 1000),
        sourceRanges:
          direction === Directions.Ingress
            ? ParsedArgs.list(args, "source-ranges").length === 0
              ? ["0.0.0.0/0"]
              : ParsedArgs.list(args, "source-ranges")
            : [],
        targetTags: ParsedArgs.list(args, "target-tags"),
        allowed: denies ? [] : parsed.value,
        denied: denies ? parsed.value : [],
        disabled: ParsedArgs.boolean(args, "disabled"),
      };
      return Result.map(
        Result.mapErr(World.withFirewallRule(ctx.world, rule), alreadyExists),
        (world) => ({
          world,
          output: CommandOutput.table([firewallRecord(rule)], FirewallColumns, [
            OutputMessage.plain("Creating firewall...done."),
            OutputMessage.plain(
              `Created [https://www.googleapis.com/compute/v1/projects/${rule.projectId}/global/firewalls/${rule.name}].`,
            ),
          ]),
        }),
      );
    },
  },
  listCommand(
    ["gcloud", "compute", "firewall-rules", "list"],
    "List Compute Engine firewall rules.",
    "compute.firewalls.list",
    FirewallColumns,
    (ctx) => World.firewallRulesOf(ctx.world, ctx.project.projectId).map(firewallRecord),
  ),
  {
    kind: "project",
    path: ["gcloud", "compute", "firewall-rules", "describe"],
    summary: "Describe a Compute Engine firewall rule.",
    positionals: [Positional.required("NAME", "Name of the firewall rule to describe.")],
    flags: [],
    destructive: false,
    requiredPermissions: ["compute.firewalls.get"],
    requiredApis: [ComputeApi],
    run: (ctx, args) => {
      const name = Option.unwrapOr(ParsedArgs.positional(args, 0), "");
      const rule = World.findFirewallRule(ctx.world, ctx.project.projectId, name);
      return Option.isSome(rule)
        ? Result.ok({
            world: ctx.world,
            output: CommandOutput.yaml(FirewallRule.toRecord(rule.value)),
          })
        : Result.err(
            CommandFailure.notFound(`projects/${ctx.project.projectId}/global/firewalls/${name}`),
          );
    },
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
    run: (ctx, args) => {
      const name = Option.unwrapOr(ParsedArgs.positional(args, 0), "");
      const link = `projects/${ctx.project.projectId}/global/firewalls/${name}`;
      if (!Option.isSome(World.findFirewallRule(ctx.world, ctx.project.projectId, name)))
        return Result.err(CommandFailure.notFound(link));
      return Result.ok({
        world: World.withoutFirewallRule(ctx.world, ctx.project.projectId, name),
        output: CommandOutput.messages(
          OutputMessage.plain(`Deleted [https://www.googleapis.com/compute/v1/${link}].`),
        ),
      });
    },
  },
  listCommand(
    ["gcloud", "compute", "operations", "list"],
    "List Compute Engine operations.",
    "compute.zoneOperations.list",
    OperationColumns,
    (ctx) =>
      World.operationsOf(ctx.world, ctx.project.projectId).map((o) => ({
        ...Operation.toRecord(o),
        httpStatus: 200,
      })),
  ),
];
