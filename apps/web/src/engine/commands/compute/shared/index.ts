import { CommandFailure } from "@/engine/cli/command-failure";
import {
  Column,
  CommandContext,
  CommandOutput,
  type CommandSpec,
  type FlagSpec,
  type JsonRecord,
  OutputMessage,
  ParsedArgs,
  type ProjectContext,
} from "@/engine/cli/command-spec";
import { projectCommand } from "@/engine/commands/shared";
import { DefaultImage, PublicImage, Zone } from "@/engine/domains/catalog";
import {
  BootDiskType,
  BootDiskTypes,
  Disk,
  DiskSizeGb,
  ExternalIp,
  type FirewallRule,
  Instance,
  type Network,
  type NetworkInterface,
  ProtocolRule,
  Subnet,
} from "@/engine/domains/compute";
import { Operation } from "@/engine/domains/operation";
import { ServiceAccount } from "@/engine/domains/service-account";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

/** compute のサブモジュールが共有する解決・列・出力の部品。 */

export const ComputeApi = "compute.googleapis.com" as const;

export const InstanceColumns = [
  Column.create("NAME", "name"),
  Column.create("ZONE", "zone", "basename"),
  Column.create("MACHINE_TYPE", "machineType", "basename"),
  Column.create("PREEMPTIBLE", "scheduling.preemptible", "flag"),
  Column.create("INTERNAL_IP", "networkInterfaces[0].networkIP"),
  Column.create("EXTERNAL_IP", "networkInterfaces[0].accessConfigs[0].natIP"),
  Column.create("STATUS", "status"),
];

export const invalidName = (message: string): CommandFailure =>
  CommandFailure.invalidValue("NAME", message);

/** 外部 IP の採番。通し番号から決めるので同じ World なら同じ値になる。 */
export const externalIp = (sequence: number): string =>
  `34.84.${(sequence >> 8) % 256}.${sequence % 256}`;

/** `--image-family` / `--image-project` からイメージを引く。無指定なら Debian 12。 */
export const resolveImage = (args: ParsedArgs): Result<PublicImage, CommandFailure> => {
  const family = ParsedArgs.string(args, "image-family");
  const project = Option.unwrapOr(ParsedArgs.string(args, "image-project"), DefaultImage.project);
  if (!Option.isSome(family)) return Result.ok(DefaultImage);
  return Option.toResult(PublicImage.parseFamily(family.value, project), () =>
    CommandFailure.notFound(`projects/${project}/global/images/family/${family.value}`),
  );
};

/** ブートディスクの大きさと種類（`--boot-disk-size` / `--boot-disk-type`）。 */
export const resolveBootDisk = (
  args: ParsedArgs,
): Result<Readonly<{ sizeGb: number; type: BootDiskType }>, CommandFailure> =>
  resolveDiskShape(args, "boot-disk-size", "boot-disk-type", "10GB");

/**
 * ディスクの大きさと種類をフラグから読む。`disks create` と `instances create` でフラグ名が違う。
 *
 * @param args 引数
 * @param sizeFlag 大きさのフラグ名
 * @param typeFlag 種類のフラグ名
 * @param defaultSize 無指定の大きさ
 * @returns 大きさ（GB）と種類。綴りが悪ければ E-003
 */
export const resolveDiskShape = (
  args: ParsedArgs,
  sizeFlag: string,
  typeFlag: string,
  defaultSize: string,
): Result<Readonly<{ sizeGb: number; type: BootDiskType }>, CommandFailure> => {
  const size = Result.mapErr(
    DiskSizeGb.parse(Option.unwrapOr(ParsedArgs.string(args, sizeFlag), defaultSize)),
    (m) =>
      CommandFailure.invalidValue(`--${sizeFlag}`, m.replace("--boot-disk-size", `--${sizeFlag}`)),
  );
  if (!Result.isOk(size)) return size;
  const rawType = Option.unwrapOr(ParsedArgs.string(args, typeFlag), BootDiskTypes.Balanced);
  return Result.map(
    Option.toResult(BootDiskType.parse(rawType), () =>
      CommandFailure.invalidChoice(`--${typeFlag}`, rawType, Object.values(BootDiskTypes)),
    ),
    (type) => ({ sizeGb: size.value, type }),
  );
};

/** `--network` / `--subnet` / `--address` から NIC を組む。内部 IP はサブネット内の台数で採番する。 */
export const resolveNetworkInterface = (
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

/** `--service-account`。無指定はプロジェクトの Compute 既定 SA。知らないメールは E-005。 */
export const resolveServiceAccount = (
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

export const asyncOutput = (operation: Operation, verb: string, name: string): CommandOutput =>
  CommandOutput.messages(
    OutputMessage.plain(
      `Instance ${verb} in progress for [${name}]: ${Operation.selfLink(operation)}`,
    ),
    OutputMessage.plain(
      "Use [gcloud compute operations describe URI] command to check the status of the operation(s).",
    ),
  );

/** 位置引数の名前と `--zone` / `compute/zone` でインスタンスを引く。 */
export const instanceArg = (
  ctx: ProjectContext,
  args: ParsedArgs,
): Result<Instance, CommandFailure> => {
  const name = ParsedArgs.requiredPositional(args, 0);
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

/** ゾーン内のディスク。独立ディスクか、どれかのインスタンスのブートディスク。 */
export type ZonedDisk =
  | Readonly<{ kind: "standalone"; disk: Disk }>
  | Readonly<{ kind: "attached"; instance: Instance; deviceName: string; sizeGb: number }>;

export const findZonedDisk = (ctx: ProjectContext, zone: Zone, name: string): Option<ZonedDisk> => {
  const standalone = World.findDisk(ctx.world, ctx.project.projectId, zone, name);
  if (Option.isSome(standalone)) return Option.some({ kind: "standalone", disk: standalone.value });
  const owner = World.instancesOf(ctx.world, ctx.project.projectId).find(
    (i) => i.zone === zone && i.disks.some((d) => d.deviceName === name),
  );
  const disk = owner?.disks.find((d) => d.deviceName === name);
  return owner !== undefined && disk !== undefined
    ? Option.some({ kind: "attached", instance: owner, deviceName: name, sizeGb: disk.sizeGb })
    : Option.none;
};

export const diskNotFound = (ctx: ProjectContext, zone: Zone, name: string): CommandFailure =>
  CommandFailure.notFound(`projects/${ctx.project.projectId}/zones/${zone}/disks/${name}`);

/** `disks list` の行。インスタンスのブートディスクと独立ディスクを合わせる。 */
export const diskRecords = (ctx: ProjectContext): readonly JsonRecord[] => {
  const boot = World.instancesOf(ctx.world, ctx.project.projectId).flatMap((instance) =>
    instance.disks
      .filter((d) => d.boot)
      .map((disk) => ({
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
  const standalone = World.disksOf(ctx.world, ctx.project.projectId).map(Disk.toRecord);
  return [...boot, ...standalone].toSorted((a, b) => String(a.name).localeCompare(String(b.name)));
};

export type ListCommandSeed = Readonly<{
  path: readonly string[];
  summary: string;
  permission: string;
  columns: readonly Column[];
  records: (ctx: ProjectContext, args: ParsedArgs) => readonly JsonRecord[];
  flags?: readonly FlagSpec[];
}>;

/** table を出すだけの `list` を同じ形で作る。 */
export const listCommand = (seed: ListCommandSeed): CommandSpec =>
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

export const requireNetwork = (
  ctx: ProjectContext,
  name: string,
): Result<Network, CommandFailure> =>
  Option.toResult(World.findNetwork(ctx.world, ctx.project.projectId, name), () =>
    CommandFailure.notFound(`projects/${ctx.project.projectId}/global/networks/${name}`),
  );

export const requireFirewallRule = (
  ctx: ProjectContext,
  name: string,
): Result<FirewallRule, CommandFailure> =>
  Option.toResult(World.findFirewallRule(ctx.world, ctx.project.projectId, name), () =>
    CommandFailure.notFound(`projects/${ctx.project.projectId}/global/firewalls/${name}`),
  );

export const parseProtocolRules = (
  flag: string,
  values: readonly string[],
): Result<readonly ProtocolRule[], CommandFailure> =>
  Result.all(
    values.map((v) =>
      Result.mapErr(ProtocolRule.parse(v), (m) => CommandFailure.invalidValue(flag, m)),
    ),
  );

/** `Created [selfLink].` に続けて 1 行の table を出す、作成コマンドの定型。 */
export const createdTable = (
  selfLink: string,
  record: JsonRecord,
  columns: readonly Column[],
): CommandOutput =>
  CommandOutput.table([record], columns, [OutputMessage.plain(`Created [${selfLink}].`)]);
