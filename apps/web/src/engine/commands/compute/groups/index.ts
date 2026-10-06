import { CommandFailure } from "@/engine/cli/command-failure";
import {
  Column,
  CommandContext,
  CommandOutput,
  type CommandResult,
  type CommandSpec,
  Flag,
  OutputMessage,
  ParsedArgs,
  Positional,
  type ProjectContext,
} from "@/engine/cli/command-spec";
import {
  ComputeApi,
  createdTable,
  externalIp,
  invalidName,
  listCommand,
  resolveBootDisk,
  resolveImage,
} from "@/engine/commands/compute/shared";
import {
  alreadyExists,
  Candidates,
  CommonFlags,
  describeNamedCommand,
  instanceOperationSeed,
  projectCommand,
  recordOperation,
} from "@/engine/commands/shared";
import { DefaultMachineType, MachineType, type Region, Zone } from "@/engine/domains/catalog";
import {
  BootDiskTypes,
  DefaultScopes,
  ExternalIp,
  Instance,
  type NetworkInterface,
  ProvisioningModel,
  ProvisioningModels,
  Scope,
  Subnet,
} from "@/engine/domains/compute";
import {
  Autoscaling,
  InstanceTemplate,
  ManagedInstanceGroup,
} from "@/engine/domains/instance-groups";
import { OperationTypes } from "@/engine/domains/operation";
import { ServiceAccount } from "@/engine/domains/service-account";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const TemplateColumns = [
  Column.create("NAME", "name"),
  Column.create("MACHINE_TYPE", "properties.machineType"),
  Column.create("PREEMPTIBLE", "properties.scheduling.preemptible", "flag"),
  Column.create("CREATION_TIMESTAMP", "creationTimestamp"),
];
const GroupColumns = [
  Column.create("NAME", "name"),
  Column.create("LOCATION", "location"),
  Column.create("SCOPE", "scope"),
  Column.create("BASE_INSTANCE_NAME", "baseInstanceName"),
  Column.create("SIZE", "targetSize"),
  Column.create("TARGET_SIZE", "targetSize"),
  Column.create("INSTANCE_TEMPLATE", "instanceTemplate", "basename"),
  Column.create("AUTOSCALED", "autoscaled"),
];

const createTemplate = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const machineTypeName = Option.unwrapOr(
    ParsedArgs.string(args, "machine-type"),
    DefaultMachineType,
  );
  const machineType = Option.toResult(MachineType.parse(machineTypeName), () =>
    CommandFailure.notFound(
      `projects/${ctx.project.projectId}/global/machineTypes/${machineTypeName}`,
    ),
  );
  if (!Result.isOk(machineType)) return machineType;
  const image = resolveImage(args);
  if (!Result.isOk(image)) return image;
  const bootDisk = resolveBootDisk(args);
  if (!Result.isOk(bootDisk)) return bootDisk;
  const networkName = Option.unwrapOr(ParsedArgs.string(args, "network"), "default");
  if (!Option.isSome(World.findNetwork(ctx.world, ctx.project.projectId, networkName))) {
    return Result.err(
      CommandFailure.notFound(`projects/${ctx.project.projectId}/global/networks/${networkName}`),
    );
  }
  const rawScopes = ParsedArgs.list(args, "scopes");
  const template = Result.mapErr(
    InstanceTemplate.create({
      projectId: ctx.project.projectId,
      name: ParsedArgs.requiredPositional(args, 0),
      machineType: machineType.value.name,
      image: image.value,
      bootDisk: bootDisk.value,
      tags: ParsedArgs.list(args, "tags"),
      network: networkName,
      subnet: ParsedArgs.string(args, "subnet"),
      externalIp: Option.unwrapOr(ParsedArgs.booleanChoice(args, "address"), true),
      serviceAccount: ParsedArgs.string(args, "service-account"),
      scopes: rawScopes.length === 0 ? DefaultScopes : rawScopes.flatMap(Scope.expand),
      preemptible: ParsedArgs.boolean(args, "preemptible"),
      provisioningModel: Option.unwrapOr(
        Option.flatMap(ParsedArgs.string(args, "provisioning-model"), ProvisioningModel.parse),
        ProvisioningModels.Standard,
      ),
      metadata: ParsedArgs.keyvalue(args, "metadata"),
      creationTimestamp: ctx.now,
    }),
    invalidName,
  );
  if (!Result.isOk(template)) return template;
  return Result.map(
    Result.mapErr(
      World.withNamed(
        ctx.world,
        "instanceTemplates",
        template.value,
        InstanceTemplate.selfLink(template.value),
      ),
      alreadyExists,
    ),
    (world) => ({
      world,
      output: createdTable(
        InstanceTemplate.selfLink(template.value),
        InstanceTemplate.toRecord(template.value),
        TemplateColumns,
      ),
    }),
  );
};

/** テンプレートから 1 台作って World に足す。内部 IP はサブネット内の台数で採番する。 */
const addMember = (
  ctx: ProjectContext,
  world: World,
  template: InstanceTemplate,
  placement: Readonly<{ name: string; zone: Zone }>,
): Result<World, CommandFailure> => {
  const region = Zone.region(placement.zone);
  const subnetName = Option.unwrapOr(template.subnet, template.network);
  const subnet = World.findSubnet(world, ctx.project.projectId, region, subnetName);
  if (!Option.isSome(subnet)) {
    return Result.err(
      CommandFailure.notFound(
        `projects/${ctx.project.projectId}/regions/${region}/subnetworks/${subnetName}`,
      ),
    );
  }
  if (
    subnet.value.purpose === "REGIONAL_MANAGED_PROXY" ||
    subnet.value.network !== template.network
  ) {
    return Result.err(
      CommandFailure.invalidArgumentWith(
        "MIG members require a regular subnet in their template VPC.",
      ),
    );
  }
  const inSubnet = World.instancesOf(world, ctx.project.projectId).filter((i) =>
    i.networkInterfaces.some(
      (nic) => nic.subnetwork === subnetName && Zone.region(i.zone) === region,
    ),
  ).length;
  const numbered = World.nextNumber(world);
  const nic: NetworkInterface = {
    network: template.network,
    subnetwork: subnetName,
    networkIP: Subnet.hostAddress(subnet.value, inSubnet),
    externalIP: template.externalIp
      ? ExternalIp.ephemeral(externalIp(numbered.number))
      : ExternalIp.None,
  };
  const instance = Result.mapErr(
    Instance.create(
      InstanceTemplate.toInstanceSeed(template, {
        name: placement.name,
        zone: placement.zone,
        networkInterface: nic,
        serviceAccount: Option.unwrapOr(
          template.serviceAccount,
          ServiceAccount.defaultComputeEmail(ctx.project.projectNumber),
        ),
        creationTimestamp: ctx.now,
        sequence: numbered.number,
      }),
    ),
    invalidName,
  );
  if (!Result.isOk(instance)) return instance;
  const added = Result.mapErr(World.withInstance(numbered.world, instance.value), alreadyExists);
  return Result.map(
    added,
    (w) =>
      recordOperation(w, instanceOperationSeed(instance.value, OperationTypes.Insert, ctx)).world,
  );
};

const resolveLocation = (
  ctx: ProjectContext,
  args: ParsedArgs,
): Result<Zone | Region, CommandFailure> => {
  const region = ParsedArgs.string(args, "region");
  return Option.isSome(region)
    ? CommandContext.resolveRegion(ctx, region)
    : CommandContext.resolveZone(ctx, ParsedArgs.string(args, "zone"));
};

const createGroup = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const location = resolveLocation(ctx, args);
  if (!Result.isOk(location)) return location;
  const templateName = ParsedArgs.requiredString(args, "template");
  const template = Option.toResult(
    World.findNamed(ctx.world, "instanceTemplates", {
      projectId: ctx.project.projectId,
      name: templateName,
    }),
    () =>
      CommandFailure.notFound(
        `projects/${ctx.project.projectId}/global/instanceTemplates/${templateName}`,
      ),
  );
  if (!Result.isOk(template)) return template;
  const size = Option.unwrapOr(ParsedArgs.integer(args, "size"), 0);
  if (size < 0)
    return Result.err(
      CommandFailure.invalidValue("--size", `Value [${size}] must be non-negative.`),
    );
  const name = ParsedArgs.requiredPositional(args, 0);
  const baseName = ParsedArgs.string(args, "base-instance-name");
  const members = ManagedInstanceGroup.memberNames(
    Option.unwrapOr(baseName, name),
    ctx.world.sequence,
    size,
  );
  const group = Result.mapErr(
    ManagedInstanceGroup.create({
      projectId: ctx.project.projectId,
      name,
      location: location.value,
      template: templateName,
      targetSize: size,
      baseInstanceName: baseName,
      instanceNames: members,
      creationTimestamp: ctx.now,
    }),
    invalidName,
  );
  if (!Result.isOk(group)) return group;
  const withGroup = Result.mapErr(
    World.withNamed(
      ctx.world,
      "instanceGroups",
      group.value,
      ManagedInstanceGroup.selfLink(group.value),
    ),
    alreadyExists,
  );
  if (!Result.isOk(withGroup)) return withGroup;
  const populated = members.reduce<Result<World, CommandFailure>>(
    (acc, member, index) =>
      Result.flatMap(acc, (w) =>
        addMember(ctx, w, template.value, {
          name: member,
          zone: ManagedInstanceGroup.zoneFor(location.value, index),
        }),
      ),
    withGroup,
  );
  return Result.map(populated, (world) => ({
    world,
    output: createdTable(
      ManagedInstanceGroup.selfLink(group.value),
      groupRecord(group.value),
      GroupColumns,
    ),
  }));
};

const groupRecord = (group: ManagedInstanceGroup) => ({
  ...ManagedInstanceGroup.toRecord(group),
  location: group.location,
  scope: Option.isSome(Zone.parse(group.location)) ? "zone" : "region",
});

const setAutoscaling = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const location = resolveLocation(ctx, args);
  if (!Result.isOk(location)) return location;
  const name = ParsedArgs.requiredPositional(args, 0);
  const group = World.findLocated(ctx.world, "instanceGroups", {
    projectId: ctx.project.projectId,
    name,
    location: location.value,
  });
  if (!Option.isSome(group)) {
    return Result.err(
      CommandFailure.notFound(
        `projects/${ctx.project.projectId}/${Option.isSome(Zone.parse(location.value)) ? "zones" : "regions"}/${location.value}/instanceGroupManagers/${name}`,
      ),
    );
  }
  const max = ParsedArgs.integer(args, "max-num-replicas");
  if (!Option.isSome(max)) return Result.err(CommandFailure.mustBeSpecified("--max-num-replicas"));
  const target = Option.map(ParsedArgs.string(args, "target-cpu-utilization"), Number);
  const autoscaling = Result.mapErr(
    Autoscaling.create({
      maxReplicas: max.value,
      minReplicas: ParsedArgs.integer(args, "min-num-replicas"),
      targetCpuUtilization: target,
      coolDownPeriodSec: ParsedArgs.integer(args, "cool-down-period"),
    }),
    (m) => CommandFailure.invalidValue("--max-num-replicas", m),
  );
  if (!Result.isOk(autoscaling)) return autoscaling;
  const next = ManagedInstanceGroup.withAutoscaling(group.value, autoscaling.value);
  return Result.ok({
    world: World.replaceNamed(ctx.world, "instanceGroups", next),
    output: CommandOutput.table([groupRecord(next)], GroupColumns, [
      OutputMessage.plain(
        `Created [https://www.googleapis.com/compute/v1/projects/${ctx.project.projectId}/${Option.isSome(Zone.parse(next.location)) ? "zones" : "regions"}/${next.location}/autoscalers/${next.name}].`,
      ),
    ]),
  });
};

export const GroupCommands: readonly CommandSpec[] = [
  projectCommand({
    path: ["gcloud", "compute", "instance-templates", "create"],
    summary: "Create a Compute Engine virtual machine instance template.",
    positionals: [Positional.required("NAME", "Name of the instance template to create.")],
    flags: [
      Flag.string(
        "machine-type",
        "Specifies the machine type used for the instances (default: e2-medium).",
      ),
      Flag.string("image-family", "The image family for the boot disk."),
      Flag.string("image-project", "The project of the image family."),
      Flag.string("network", "Specifies the network (default: default)."),
      Flag.string("subnet", "Specifies the subnet."),
      Flag.list("tags", "Specifies a list of tags to apply to the instances."),
      Flag.string("service-account", "A service account email address to attach to the instances."),
      Flag.list("scopes", "Access scopes for the service account."),
      Flag.boolean("preemptible", "If provided, instances will be preemptible."),
      Flag.enum(
        "provisioning-model",
        "Specifies the provisioning model for the instances.",
        Object.values(ProvisioningModels),
      ),
      Flag.keyvalue("metadata", "Metadata for the instances."),
      Flag.string("boot-disk-size", "The size of the boot disk (default: 10GB)."),
      Flag.enum("boot-disk-type", "The type of the boot disk.", Object.values(BootDiskTypes)),
      Flag.boolean("address", "Assigns an ephemeral external IP. Use --no-address for none."),
    ],
    permission: "compute.instanceTemplates.create",
    requiredApis: [ComputeApi],
    run: createTemplate,
  }),
  listCommand({
    path: ["gcloud", "compute", "instance-templates", "list"],
    summary: "List Compute Engine virtual machine instance templates.",
    permission: "compute.instanceTemplates.list",
    columns: TemplateColumns,
    records: (ctx) =>
      World.namedOf(ctx.world, "instanceTemplates", ctx.project.projectId).map(
        InstanceTemplate.toRecord,
      ),
  }),
  describeNamedCommand({
    path: ["gcloud", "compute", "instance-templates", "describe"],
    summary: "Describe a virtual machine instance template.",
    positional: { name: "NAME", description: "Name of the instance template." },
    collection: "instanceTemplates",
    permission: "compute.instanceTemplates.get",
    requiredApis: [ComputeApi],
    resourcePath: (ref) => `projects/${ref.projectId}/global/instanceTemplates/${ref.name}`,
    record: InstanceTemplate.toRecord,
  }),
  projectCommand({
    path: ["gcloud", "compute", "instance-groups", "managed", "create"],
    summary: "Create a Compute Engine managed instance group.",
    positionals: [Positional.required("NAME", "Name of the managed instance group to create.")],
    flags: [
      CommonFlags.zone,
      CommonFlags.region,
      Flag.string("template", "Specifies the instance template to use.", {
        required: true,
        candidates: Candidates.instanceTemplates,
      }),
      Flag.integer("size", "The initial number of instances in the group.", { required: true }),
      Flag.string(
        "base-instance-name",
        "The base name to use for the instances (default: group name).",
      ),
    ],
    permission: "compute.instanceGroupManagers.create",
    requiredApis: [ComputeApi],
    run: createGroup,
  }),
  listCommand({
    path: ["gcloud", "compute", "instance-groups", "managed", "list"],
    summary: "List Compute Engine managed instance groups.",
    permission: "compute.instanceGroupManagers.list",
    columns: GroupColumns,
    records: (ctx) =>
      World.namedOf(ctx.world, "instanceGroups", ctx.project.projectId).map(groupRecord),
  }),
  describeNamedCommand({
    path: ["gcloud", "compute", "instance-groups", "managed", "describe"],
    summary: "Describe a managed instance group.",
    positional: { name: "NAME", description: "Name of the managed instance group." },
    flags: [CommonFlags.zone, CommonFlags.region],
    locate: resolveLocation,
    collection: "instanceGroups",
    permission: "compute.instanceGroupManagers.get",
    requiredApis: [ComputeApi],
    resourcePath: (ref) =>
      `projects/${ref.projectId}/${Option.unwrapOr(ref.location, "-")}/instanceGroupManagers/${ref.name}`,
    record: groupRecord,
  }),
  projectCommand({
    path: ["gcloud", "compute", "instance-groups", "managed", "set-autoscaling"],
    summary: "Set autoscaling parameters of a managed instance group.",
    positionals: [
      Positional.required("NAME", "Name of the managed instance group.", Candidates.instanceGroups),
    ],
    flags: [
      CommonFlags.zone,
      CommonFlags.region,
      Flag.integer("max-num-replicas", "Maximum number of replicas the autoscaler will maintain.", {
        required: true,
      }),
      Flag.integer("min-num-replicas", "Minimum number of replicas (default 1)."),
      Flag.string("target-cpu-utilization", "Target CPU utilization as a fraction, e.g. 0.6."),
      Flag.integer("cool-down-period", "Number of seconds to wait after a VM starts (default 60)."),
    ],
    permission: "compute.autoscalers.create",
    requiredApis: [ComputeApi],
    run: setAutoscaling,
  }),
];
