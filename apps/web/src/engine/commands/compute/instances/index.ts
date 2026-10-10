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
  asyncOutput,
  ComputeApi,
  externalIp,
  findZonedDisk,
  InstanceColumns,
  instanceArg,
  invalidName,
  listCommand,
  resolveBootDisk,
  resolveImage,
  resolveNetworkInterface,
  resolveServiceAccount,
} from "@/engine/commands/compute/shared";
import { text } from "@/engine/commands/compute-lab/shared";
import {
  CustomFlags,
  checkActAs,
  configFromArgs,
  removeVmLab,
  resolveCustomMachine,
  SchedulingFlags,
} from "@/engine/commands/compute-lab/vms";
import {
  alreadyExists,
  Candidates,
  CommonFlags,
  instanceOperationSeed,
  projectCommand,
  recordOperation,
} from "@/engine/commands/shared";
import {
  DefaultMachineType,
  MachineType,
  PublicImage,
  Region,
  Zone,
} from "@/engine/domains/catalog";
import {
  BootDiskTypes,
  DefaultScopes,
  ExternalIp,
  Instance,
  type InstanceTransition,
  InstanceTransitions,
  ProjectMetadata,
  ProvisioningModel,
  ProvisioningModels,
  Scope,
} from "@/engine/domains/compute";
import {
  patchCompute,
  sameRef,
  saveConfig,
  saveDiskData,
  vmConfig,
  vmRef,
} from "@/engine/domains/compute-lab/model";
import { OsLoginSshKey } from "@/engine/domains/credentials";
import { firewallDecision } from "@/engine/domains/network-lab/model";
import { Operation, OperationTypes } from "@/engine/domains/operation";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const createInstance = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const zone = CommandContext.resolveZone(ctx, ParsedArgs.string(args, "zone"));
  if (!Result.isOk(zone)) return zone;
  const machineType = resolveMachineType(ctx, args, zone.value);
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
  const image = resolveImage(args, ctx);
  if (!Result.isOk(image)) return image;
  const bootDisk = resolveBootDisk(args);
  if (!Result.isOk(bootDisk)) return bootDisk;
  const nic = resolveNetworkInterface(ctx, args, zone.value);
  if (!Result.isOk(nic)) return nic;
  const serviceAccount = resolveServiceAccount(ctx, args);
  if (!Result.isOk(serviceAccount)) return serviceAccount;
  if (ParsedArgs.has(args, "service-account")) {
    const actAs = checkActAs(ctx, serviceAccount.value);
    if (!actAs.ok) {
      return actAs;
    }
  }
  const rawScopes = ParsedArgs.list(args, "scopes");
  const scopes = rawScopes.length === 0 ? DefaultScopes : rawScopes.flatMap(Scope.expand);
  const numbered = World.nextNumber(ctx.world);
  const instance = Result.mapErr(
    Instance.create({
      projectId: ctx.project.projectId,
      name: ParsedArgs.requiredPositional(args, 0),
      zone: zone.value,
      machineType: machineType.value,
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
  const configuration = configFromArgs(instance.value, args, vmConfig(ctx.world, instance.value));
  if (!configuration.ok) {
    return configuration;
  }
  const customImage = ctx.world.computeLab.images.find(
    (i) => i.projectId === ctx.project.projectId && i.name === image.value.name,
  );
  if (customImage && instance.value.disks.some((d) => d.boot && d.sizeGb < customImage.sizeGb)) {
    return Result.err(
      CommandFailure.invalidArgumentWith("Boot disk is smaller than source image."),
    );
  }
  let configuredWorld = saveConfig(numbered.world, configuration.value);
  if (customImage) {
    configuredWorld = saveDiskData(configuredWorld, vmRef(instance.value), customImage.data);
  }
  const added = Result.mapErr(World.withInstance(configuredWorld, instance.value), alreadyExists);
  if (!Result.isOk(added)) return added;
  const { world, operation } = recordOperation(
    added.value,
    instanceOperationSeed(instance.value, OperationTypes.Insert, ctx),
  );
  const output = ParsedArgs.boolean(args, "async")
    ? asyncOutput(operation, "creation", instance.value.name)
    : CommandOutput.table([Instance.toRecord(instance.value)], InstanceColumns, [
        OutputMessage.plain(`Created [${Instance.selfLink(instance.value)}].`),
      ]);
  return Result.ok({ world, output });
};

/** `--machine-type`。無指定は e2-medium、カタログに無ければ E-005。 */
const resolveMachineType = (ctx: ProjectContext, args: ParsedArgs, zone: Zone) => {
  if (["custom-cpu", "custom-memory", "custom-vm-type"].some((k) => ParsedArgs.has(args, k))) {
    return resolveCustomMachine(args, DefaultMachineType);
  }
  const name = Option.unwrapOr(ParsedArgs.string(args, "machine-type"), DefaultMachineType);
  return Result.map(
    Option.toResult(MachineType.parse(name), () =>
      CommandFailure.notFound(
        `projects/${ctx.project.projectId}/zones/${zone}/machineTypes/${name}`,
      ),
    ),
    (type) => type.name,
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
  return projectCommand({
    path: ["gcloud", "compute", "instances", transition],
    summary: `${verbs.progressive.replace(/ing$/, "")} a virtual machine instance.`,
    positionals: [
      Positional.required(
        "INSTANCE_NAME",
        "Name of the instance to operate on.",
        Candidates.instances,
      ),
    ],
    flags: [CommonFlags.zone, CommonFlags.async],
    permission: `compute.instances.${transition}`,
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
      const { world, operation } = recordOperation(
        World.replaceInstance(ctx.world, next),
        instanceOperationSeed(next, transition, ctx),
      );
      const output = ParsedArgs.boolean(args, "async")
        ? asyncOutput(operation, transition, next.name)
        : CommandOutput.messages(...done);
      return Result.ok({ world, output });
    },
  });
};

/**
 * インスタンスを置き換えてオペレーションを記録し、`Updated [...]` を出す。
 * `add-tags` / `add-metadata` / `set-machine-type` / `attach-disk` が同じ形。
 */
const updated = (
  ctx: ProjectContext,
  instance: Instance,
  operationType: (typeof OperationTypes)[keyof typeof OperationTypes],
): CommandResult => {
  const { world } = recordOperation(
    World.replaceInstance(ctx.world, instance),
    instanceOperationSeed(instance, operationType, ctx),
  );
  return Result.ok({
    world,
    output: CommandOutput.messages(
      OutputMessage.plain(`Updated [${Instance.selfLink(instance)}].`),
    ),
  });
};

/** `compute ssh` / `scp` の接続の前提。どれか欠けると本物と同じ `Connection timed out`。 */
const SshPort = 22;

type SshTarget = Readonly<{ instance: Instance; viaExternalIp: boolean }>;

const resolveSshTarget = (
  ctx: ProjectContext,
  args: ParsedArgs,
  name: string,
): Result<SshTarget, CommandFailure> => {
  const zone = CommandContext.resolveZone(ctx, ParsedArgs.string(args, "zone"));
  if (!Result.isOk(zone)) return zone;
  const instance = Option.toResult(
    World.findInstance(ctx.world, ctx.project.projectId, zone.value, name),
    () =>
      CommandFailure.notFound(
        `projects/${ctx.project.projectId}/zones/${zone.value}/instances/${name}`,
      ),
  );
  if (!Result.isOk(instance)) return instance;
  const viaExternalIp =
    !ParsedArgs.boolean(args, "internal-ip") && !ParsedArgs.boolean(args, "tunnel-through-iap");
  return Result.ok({ instance: instance.value, viaExternalIp });
};

/**
 * 接続できるかを確かめる。RUNNING でない・外部 IP が無い（内部経路でない）・tcp:22 を許す
 * ファイアウォールが無い、のどれかなら本物と同じ timed out。
 *
 * @returns 接続に使うアドレス
 */
const checkReachable = (ctx: ProjectContext, target: SshTarget): Result<string, CommandFailure> => {
  const { instance } = target;
  const nic = instance.networkInterfaces[0];
  const address = target.viaExternalIp
    ? Option.unwrapOr(nic === undefined ? Option.none : ExternalIp.address(nic.externalIP), "")
    : (nic?.networkIP ?? "");
  const timedOut = (reason: string) =>
    CommandFailure.notFoundWith(
      `ssh: connect to host ${address === "" ? instance.name : address} port ${SshPort}: Connection timed out\nERROR: (gcloud.compute.ssh) [/usr/bin/ssh] exited with return code [255].\ngcloud-sim: ${reason}`,
    );
  if (!Instance.isRunning(instance)) {
    return Result.err(
      timedOut(`インスタンスが ${instance.status} です。RUNNING のときだけ接続できます。`),
    );
  }
  if (address === "") {
    return Result.err(
      timedOut(
        "外部 IP がありません。--internal-ip か --tunnel-through-iap で内部経路を使うか、外部 IP を付けてください。",
      ),
    );
  }
  const originIp = target.viaExternalIp ? "203.0.113.10" : (nic?.networkIP ?? "");
  const { allowed } = firewallDecision(ctx.world, instance, "INGRESS", originIp, "tcp", SshPort);
  if (!allowed) {
    return Result.err(
      timedOut(
        `tcp:${SshPort} を許可するファイアウォールルールがこのインスタンスに当たっていません（ネットワークとターゲットタグを確認してください）。`,
      ),
    );
  }
  return Result.ok(address);
};

const knownHostsWarning = (instance: Instance): OutputMessage =>
  OutputMessage.warning(
    `Warning: Permanently added 'compute.${instance.id}' (ED25519) to the list of known hosts.`,
  );

const ssh = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const raw = ParsedArgs.requiredPositional(args, 0);
  const name = raw.includes("@") ? (raw.split("@")[1] ?? raw) : raw;
  const target = resolveSshTarget(ctx, args, name);
  if (!Result.isOk(target)) return target;
  const address = checkReachable(ctx, target.value);
  if (!Result.isOk(address)) return address;
  const command = ParsedArgs.string(args, "command");
  const tail = Option.isSome(command)
    ? [
        OutputMessage.hint(
          `gcloud-sim: リモートコマンド [${command.value}] は実行しません（対話シェルもコマンドの実行も再現しません）。`,
        ),
      ]
    : [
        OutputMessage.hint(
          "gcloud-sim: 接続の前提（RUNNING・到達できる IP・tcp:22 を許すファイアウォール・OS Login の権限）を満たしました。対話シェルは再現しません。",
        ),
      ];
  return Result.ok({
    world: ctx.world,
    output: CommandOutput.messages(
      OutputMessage.plain(`Connecting to ${address.value} (${target.value.instance.name})...`),
      knownHostsWarning(target.value.instance),
      ...tail,
    ),
  });
};

/** `scp` の `INSTANCE:PATH` / `user@INSTANCE:PATH` を分解する。 */
const remotePath = (value: string): Option<Readonly<{ instance: string; path: string }>> => {
  const colon = value.indexOf(":");
  if (colon <= 0) return Option.none;
  const host = value.slice(0, colon);
  const instance = host.includes("@") ? (host.split("@")[1] ?? host) : host;
  return Option.some({ instance, path: value.slice(colon + 1) });
};

const scp = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const source = ParsedArgs.requiredPositional(args, 0);
  const destination = ParsedArgs.requiredPositional(args, 1);
  const remote = Option.or(remotePath(destination), remotePath(source));
  if (!Option.isSome(remote)) {
    return Result.err(
      CommandFailure.invalidValue(
        "[[USER@]INSTANCE:]DEST",
        "Source(s) must be remote when destination is local. Specify one side as INSTANCE:PATH.",
      ),
    );
  }
  const target = resolveSshTarget(ctx, args, remote.value.instance);
  if (!Result.isOk(target)) return target;
  const address = checkReachable(ctx, target.value);
  if (!Result.isOk(address)) return address;
  const fileName =
    (Option.isSome(remotePath(source)) ? remote.value.path : source)
      .split("/")
      .filter((s) => s !== "")
      .at(-1) ?? "file";
  return Result.ok({
    world: ctx.world,
    output: CommandOutput.messages(
      knownHostsWarning(target.value.instance),
      OutputMessage.plain(`${fileName.padEnd(32)} 100% 1024     1.0KB/s   00:00`),
      OutputMessage.hint(
        "gcloud-sim: ファイルの中身は転送しません（接続の前提だけを確かめました）。",
      ),
    ),
  });
};

const attachDisk = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const instance = instanceArg(ctx, args);
  if (!Result.isOk(instance)) return instance;
  const diskName = ParsedArgs.requiredString(args, "disk");
  const scope = text(args, "disk-scope", "zonal");
  const loc = scope === "regional" ? Zone.region(instance.value.zone) : instance.value.zone;
  const labDisk = ctx.world.computeLab.disks.find(
    (d) => d.projectId === ctx.project.projectId && d.location === loc && d.name === diskName,
  );
  if (labDisk) {
    if (
      ParsedArgs.has(args, "device-name") ||
      text(args, "mode", "rw") !== "rw" ||
      labDisk.users.length
    ) {
      return Result.err(
        CommandFailure.invalidArgumentWith(
          "This disk model supports one rw attachment with its own device name.",
        ),
      );
    }
    const next = { ...labDisk, users: [`${instance.value.zone}/${instance.value.name}`] };
    const world = patchCompute(ctx.world, {
      disks: ctx.world.computeLab.disks.map((d) => (sameRef(d, labDisk) ? next : d)),
    });
    const checked = World.validate(world);
    return Result.map(Result.mapErr(checked, CommandFailure.invalidState), (world) => ({
      world,
      output: CommandOutput.yaml({ ...next }),
    }));
  }
  const found = findZonedDisk(ctx, instance.value.zone, diskName);
  const standalone = Option.flatMap(found, (d) =>
    d.kind === "standalone" ? Option.some(d.disk) : Option.none,
  );
  if (!Option.isSome(standalone)) {
    return Result.err(
      CommandFailure.notFound(
        `projects/${ctx.project.projectId}/zones/${instance.value.zone}/disks/${diskName}`,
      ),
    );
  }
  const attached = Result.mapErr(
    Instance.withAttachedDisk(
      instance.value,
      standalone.value,
      ParsedArgs.string(args, "device-name"),
    ),
    CommandFailure.invalidState,
  );
  if (!Result.isOk(attached)) return attached;
  const world = World.replaceDisk(ctx.world, {
    ...standalone.value,
    users: [...standalone.value.users, instance.value.name],
  });
  return updated({ ...ctx, world }, attached.value, OperationTypes.AttachDisk);
};

const projectInfoRecord = (ctx: ProjectContext) =>
  ProjectMetadata.toRecord(World.projectMetadataOf(ctx.world, ctx.project.projectId));

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
const OperationColumns = [
  Column.create("NAME", "name"),
  Column.create("TYPE", "operationType"),
  Column.create("TARGET", "targetLink", "basename"),
  Column.create("HTTP_STATUS", "httpStatus"),
  Column.create("STATUS", "status"),
  Column.create("TIMESTAMP", "insertTime"),
];

const SshFlags = [
  CommonFlags.zone,
  Flag.boolean("internal-ip", "Connect to instances using their internal IP addresses."),
  Flag.boolean(
    "tunnel-through-iap",
    "Tunnel the SSH connection through Cloud Identity-Aware Proxy.",
  ),
  Flag.boolean("plain", "Suppress the automatic addition of ssh flags."),
];

export const InstanceCommands: readonly CommandSpec[] = [
  projectCommand({
    path: ["gcloud", "compute", "instances", "create"],
    summary: "Create Compute Engine virtual machine instances.",
    positionals: [Positional.required("INSTANCE_NAME", "Name of the instance to create.")],
    flags: [
      ...CustomFlags,
      ...SchedulingFlags,
      Flag.string("image", "Custom image in the selected project."),
      CommonFlags.zone,
      Flag.string(
        "machine-type",
        "Specifies the machine type used for the instances (default: e2-medium).",
        { candidates: Candidates.machineTypes },
      ),
      Flag.string(
        "image-family",
        "The image family for the operating system that the boot disk will be initialized with.",
        { candidates: Candidates.imageFamilies },
      ),
      Flag.string(
        "image-project",
        "The Google Cloud project against which all image and image family references will be resolved.",
      ),
      Flag.string(
        "network",
        "Specifies the network that the VM instances are a part of (default: default).",
        { candidates: Candidates.networks },
      ),
      Flag.string("subnet", "Specifies the subnet that the VM instances are a part of.", {
        candidates: Candidates.subnets,
      }),
      Flag.list(
        "tags",
        "Specifies a list of tags to apply to the instance, used by firewall rules.",
      ),
      Flag.string("service-account", "A service account email address to attach to the instance.", {
        candidates: Candidates.serviceAccounts,
      }),
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
    permission: "compute.instances.create",
    requiredApis: [ComputeApi],
    run: createInstance,
  }),
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
  projectCommand({
    path: ["gcloud", "compute", "instances", "describe"],
    summary: "Describe a virtual machine instance.",
    positionals: [
      Positional.required(
        "INSTANCE_NAME",
        "Name of the instance to describe.",
        Candidates.instances,
      ),
    ],
    flags: [CommonFlags.zone],
    permission: "compute.instances.get",
    requiredApis: [ComputeApi],
    run: (ctx, args) =>
      Result.map(instanceArg(ctx, args), (instance) => ({
        world: ctx.world,
        output: CommandOutput.yaml({
          ...Instance.toRecord(instance),
          scheduling: {
            ...vmConfig(ctx.world, instance),
            provisioningModel: instance.provisioningModel,
            preemptible: instance.preemptible,
          },
        }),
      })),
  }),
  ...Object.values(InstanceTransitions).map(transitionCommand),
  projectCommand({
    path: ["gcloud", "compute", "instances", "delete"],
    summary: "Delete Compute Engine virtual machine instances.",
    positionals: [
      Positional.required("INSTANCE_NAME", "Name of the instance to delete.", Candidates.instances),
    ],
    flags: [
      CommonFlags.zone,
      Flag.enum("keep-disks", "Disks to keep after deletion.", ["all", "boot", "data"]),
      Flag.enum("delete-disks", "Disks to delete.", ["all", "boot", "data"]),
      CommonFlags.async,
    ],
    destructive: true,
    permission: "compute.instances.delete",
    requiredApis: [ComputeApi],
    run: (ctx, args) => {
      const instance = instanceArg(ctx, args);
      if (!Result.isOk(instance)) return instance;
      if (
        ctx.world.lbResources.some(
          (r) =>
            r.kind === "networkEndpointGroups" &&
            r.projectId === instance.value.projectId &&
            r.location === `zones/${instance.value.zone}` &&
            r.endpoints.some((e) => e.instance === instance.value.name),
        )
      ) {
        return Result.err(
          CommandFailure.invalidState("VM is still a NEG endpoint. Remove the endpoint first."),
        );
      }
      if (
        ctx.world.instanceGroups.some(
          (g) =>
            g.projectId === instance.value.projectId &&
            g.instanceNames.includes(instance.value.name),
        )
      ) {
        return Result.err(
          CommandFailure.invalidArgumentWith(
            "Resize or delete the owning MIG instead of deleting its member VM.",
          ),
        );
      }
      const detached = World.disksOf(ctx.world, ctx.project.projectId)
        .filter((d) => d.zone === instance.value.zone && d.users.includes(instance.value.name))
        .reduce(
          (w, d) =>
            World.replaceDisk(w, { ...d, users: d.users.filter((u) => u !== instance.value.name) }),
          World.withoutInstance(ctx.world, instance.value),
        );
      const { world, operation } = recordOperation(
        removeVmLab(detached, instance.value),
        instanceOperationSeed(instance.value, OperationTypes.Delete, ctx),
      );
      const output = ParsedArgs.boolean(args, "async")
        ? asyncOutput(operation, "deletion", instance.value.name)
        : CommandOutput.messages(
            OutputMessage.plain(`Deleted [${Instance.selfLink(instance.value)}].`),
          );
      return Result.ok({ world, output });
    },
  }),
  projectCommand({
    path: ["gcloud", "compute", "instances", "add-tags"],
    summary: "Add tags to Compute Engine virtual machine instances.",
    positionals: [
      Positional.required(
        "INSTANCE_NAME",
        "Name of the instance to operate on.",
        Candidates.instances,
      ),
    ],
    flags: [
      CommonFlags.zone,
      Flag.list("tags", "Specifies strings to be attached to the instance.", { required: true }),
    ],
    permission: "compute.instances.setTags",
    requiredApis: [ComputeApi],
    run: (ctx, args) =>
      Result.flatMap(instanceArg(ctx, args), (instance) =>
        updated(
          ctx,
          Instance.withTags(instance, ParsedArgs.list(args, "tags")),
          OperationTypes.SetTags,
        ),
      ),
  }),
  projectCommand({
    path: ["gcloud", "compute", "instances", "add-metadata"],
    summary: "Add or update instance metadata.",
    positionals: [
      Positional.required(
        "INSTANCE_NAME",
        "Name of the instance to operate on.",
        Candidates.instances,
      ),
    ],
    flags: [
      CommonFlags.zone,
      Flag.keyvalue("metadata", "The metadata key/value pairs to add, e.g. enable-oslogin=TRUE.", {
        required: true,
      }),
    ],
    permission: "compute.instances.setMetadata",
    requiredApis: [ComputeApi],
    run: (ctx, args) =>
      Result.flatMap(instanceArg(ctx, args), (instance) =>
        updated(
          ctx,
          Instance.withMetadata(instance, ParsedArgs.keyvalue(args, "metadata")),
          OperationTypes.SetMetadata,
        ),
      ),
  }),
  projectCommand({
    path: ["gcloud", "compute", "instances", "set-machine-type"],
    summary: "Set machine type for Compute Engine virtual machines (the instance must be stopped).",
    positionals: [
      Positional.required(
        "INSTANCE_NAME",
        "Name of the instance to operate on.",
        Candidates.instances,
      ),
    ],
    flags: [
      CommonFlags.zone,
      Flag.string("machine-type", "Specifies the machine type used for the instance.", {
        required: true,
        candidates: Candidates.machineTypes,
      }),
    ],
    permission: "compute.instances.setMachineType",
    requiredApis: [ComputeApi],
    run: (ctx, args) => {
      const instance = instanceArg(ctx, args);
      if (!Result.isOk(instance)) return instance;
      const machineType = resolveMachineType(ctx, args, instance.value.zone);
      if (!Result.isOk(machineType)) return machineType;
      const compatible = configFromArgs(
        { ...instance.value, machineType: machineType.value },
        args,
        vmConfig(ctx.world, instance.value),
      );
      if (!compatible.ok) {
        return compatible;
      }
      const changed = Result.mapErr(
        Instance.withMachineType(instance.value, machineType.value),
        (status) =>
          CommandFailure.invalidState(
            `Invalid resource state for "${Instance.selfLink(instance.value)}": instance is in status ${status}. Stop the instance before changing its machine type.`,
          ),
      );
      return Result.flatMap(changed, (next) => updated(ctx, next, OperationTypes.SetMachineType));
    },
  }),
  projectCommand({
    path: ["gcloud", "compute", "instances", "attach-disk"],
    summary: "Attach a disk to an instance.",
    positionals: [
      Positional.required(
        "INSTANCE_NAME",
        "Name of the instance to operate on.",
        Candidates.instances,
      ),
    ],
    flags: [
      Flag.enum("disk-scope", "Zonal or regional disk.", ["zonal", "regional"]),
      CommonFlags.zone,
      Flag.string("disk", "The name of the disk to attach to the instance.", {
        required: true,
        candidates: Candidates.disks,
      }),
      Flag.string("device-name", "An optional name to display the disk name in the guest OS."),
      Flag.enum("mode", "Specifies the mode of the disk.", ["ro", "rw"]),
    ],
    permission: "compute.instances.attachDisk",
    requiredApis: [ComputeApi],
    run: attachDisk,
  }),
  projectCommand({
    path: ["gcloud", "compute", "ssh"],
    summary: "SSH into a virtual machine instance (checks the connection prerequisites only).",
    positionals: [
      Positional.required(
        "[USER@]INSTANCE",
        "Specifies the instance to SSH into.",
        Candidates.instances,
      ),
    ],
    flags: [
      ...SshFlags,
      Flag.string("command", "A command to run on the virtual machine."),
      Flag.boolean("dry-run", "Print the equivalent scp/ssh command that would be run."),
    ],
    permissions: ["compute.instances.get", "compute.instances.osLogin"],
    requiredApis: [ComputeApi],
    run: ssh,
  }),
  projectCommand({
    path: ["gcloud", "compute", "scp"],
    summary:
      "Copy files to and from Google Compute Engine virtual machines via scp (checks the connection prerequisites only).",
    positionals: [
      Positional.required("[[USER@]INSTANCE:]SRC", "Specifies the files to copy."),
      Positional.required(
        "[[USER@]INSTANCE:]DEST",
        "Specifies a destination for the source files.",
      ),
    ],
    flags: [...SshFlags, Flag.boolean("recurse", "Upload directories recursively.")],
    permissions: ["compute.instances.get", "compute.instances.osLogin"],
    requiredApis: [ComputeApi],
    run: scp,
  }),
  projectCommand({
    path: ["gcloud", "compute", "project-info", "describe"],
    summary: "Describe the Compute Engine project resource.",
    permission: "compute.projects.get",
    requiredApis: [ComputeApi],
    run: (ctx) =>
      Result.ok({ world: ctx.world, output: CommandOutput.yaml(projectInfoRecord(ctx)) }),
  }),
  projectCommand({
    path: ["gcloud", "compute", "project-info", "add-metadata"],
    summary: "Add or update project-wide metadata.",
    flags: [
      Flag.keyvalue("metadata", "The metadata key/value pairs to add, e.g. enable-oslogin=TRUE.", {
        required: true,
      }),
    ],
    permission: "compute.projects.setCommonInstanceMetadata",
    requiredApis: [ComputeApi],
    run: (ctx, args) => {
      const metadata = ProjectMetadata.withItems(
        World.projectMetadataOf(ctx.world, ctx.project.projectId),
        ParsedArgs.keyvalue(args, "metadata"),
      );
      return Result.ok({
        world: World.withProjectMetadata(ctx.world, metadata),
        output: CommandOutput.messages(
          OutputMessage.plain(
            `Updated [https://www.googleapis.com/compute/v1/projects/${ctx.project.projectId}].`,
          ),
        ),
      });
    },
  }),
  projectCommand({
    path: ["gcloud", "compute", "os-login", "ssh-keys", "add"],
    summary: "Add an SSH public key to an OS Login profile.",
    flags: [
      Flag.string("key", "The SSH public key to add to the OS Login profile.", { required: true }),
      Flag.string(
        "ttl",
        "The amount of time before the SSH key expires, e.g. 30m, 1d (accepted, not simulated).",
      ),
    ],
    permission: "compute.instances.osLogin",
    requiredApis: [ComputeApi],
    run: (ctx, args) => {
      const key = Result.mapErr(
        OsLoginSshKey.create({
          account: ctx.principal,
          key: ParsedArgs.requiredString(args, "key"),
          expireTime: Option.none,
        }),
        (m) => CommandFailure.invalidValue("--key", m),
      );
      return Result.map(key, (k) => ({
        world: World.withOsLoginKey(ctx.world, k),
        output: CommandOutput.yaml({
          loginProfile: {
            name: ctx.principal,
            posixAccounts: [{ username: `sa_${ctx.principal.split("@")[0]}`, primary: true }],
            sshPublicKeys: Object.fromEntries(
              World.osLoginKeysOf(World.withOsLoginKey(ctx.world, k), ctx.principal).map((e) => [
                e.fingerprint,
                OsLoginSshKey.toRecord(e),
              ]),
            ),
          },
        }),
      }));
    },
  }),
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
    records: (ctx) => [
      ...PublicImage.all().map((image) => ({ ...image, deprecated: "", status: "READY" })),
      ...ctx.world.computeLab.images
        .filter((i) => i.projectId === ctx.project.projectId)
        .map((i) => ({ ...i, project: i.projectId, status: "READY" })),
    ],
  }),
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
