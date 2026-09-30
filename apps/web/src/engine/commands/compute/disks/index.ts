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
  attachedDiskRecord,
  ComputeApi,
  createdTable,
  diskNotFound,
  diskRecords,
  findZonedDisk,
  invalidName,
  listCommand,
  resolveDiskShape,
  resolveImage,
} from "@/engine/commands/compute/shared";
import {
  alreadyExists,
  Candidates,
  instanceOperation,
  projectCommand,
  recordOperation,
} from "@/engine/commands/shared";
import type { PublicImage, Zone } from "@/engine/domains/catalog";
import { Disk, DiskSizeGb, DiskSnapshot, Instance } from "@/engine/domains/compute";
import { OperationTypes } from "@/engine/domains/operation";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

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

/**
 * ディスクのスナップショットを作る。`snapshots create --source-disk` と `disks snapshot DISK` の
 * 両方がここへ来る。
 */
const snapshotDisk = (
  ctx: ProjectContext,
  seed: Readonly<{ snapshotName: string; diskName: string; zone: Zone }>,
): CommandResult => {
  const disk = findZonedDisk(ctx, seed.zone, seed.diskName);
  if (!Option.isSome(disk)) return Result.err(diskNotFound(ctx, seed.zone, seed.diskName));
  const sizeGb = disk.value.disk.sizeGb;
  const snapshot = Result.mapErr(
    DiskSnapshot.create({
      projectId: ctx.project.projectId,
      name: seed.snapshotName,
      sourceDisk: seed.diskName,
      sourceZone: seed.zone,
      diskSizeGb: sizeGb,
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
    targetName: seed.diskName,
    zone: Option.some(seed.zone),
    user: ctx.principal,
    now: ctx.now,
  });
  return Result.ok({
    world,
    output: createdTable(
      DiskSnapshot.selfLink(snapshot.value),
      DiskSnapshot.toRecord(snapshot.value),
      SnapshotColumns,
    ),
  });
};

const createDisk = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const zone = CommandContext.resolveZone(ctx, ParsedArgs.string(args, "zone"));
  if (!Result.isOk(zone)) return zone;
  const shape = resolveDiskShape(args, "size", "type", "500GB");
  if (!Result.isOk(shape)) return shape;
  const hasImage = ParsedArgs.has(args, "image-family") || ParsedArgs.has(args, "image");
  const image: Result<Option<PublicImage>, CommandFailure> = hasImage
    ? Result.map(resolveImage(args), (i) => Option.some(i))
    : Result.ok(Option.none);
  if (!Result.isOk(image)) return image;
  const numbered = World.nextNumber(ctx.world);
  const disk = Result.mapErr(
    Disk.create({
      projectId: ctx.project.projectId,
      name: ParsedArgs.requiredPositional(args, 0),
      zone: zone.value,
      sizeGb: shape.value.sizeGb,
      type: shape.value.type,
      image: image.value,
      creationTimestamp: ctx.now,
      sequence: numbered.number,
    }),
    invalidName,
  );
  if (!Result.isOk(disk)) return disk;
  const taken = Option.isSome(findZonedDisk(ctx, zone.value, disk.value.name));
  if (taken) {
    return Result.err(
      CommandFailure.alreadyExists(
        `projects/${ctx.project.projectId}/zones/${zone.value}/disks/${disk.value.name}`,
      ),
    );
  }
  return Result.map(
    Result.mapErr(World.withDisk(numbered.world, disk.value), alreadyExists),
    (world) => ({
      world,
      output: createdTable(Disk.selfLink(disk.value), Disk.toRecord(disk.value), DiskColumns),
    }),
  );
};

const resizeDisk = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const zone = CommandContext.resolveZone(ctx, ParsedArgs.string(args, "zone"));
  if (!Result.isOk(zone)) return zone;
  const size = Result.mapErr(
    DiskSizeGb.parse(Option.unwrapOr(ParsedArgs.string(args, "size"), "")),
    (m) => CommandFailure.invalidValue("--size", m.replace("--boot-disk-size", "--size")),
  );
  if (!Result.isOk(size)) return size;
  const name = ParsedArgs.requiredPositional(args, 0);
  const found = findZonedDisk(ctx, zone.value, name);
  if (!Option.isSome(found)) return Result.err(diskNotFound(ctx, zone.value, name));
  const selfLink = `https://www.googleapis.com/compute/v1/projects/${ctx.project.projectId}/zones/${zone.value}/disks/${name}`;
  const invalid = (m: string) => CommandFailure.invalidValue("--size", m);
  const target = found.value;
  const world =
    target.kind === "standalone"
      ? Result.map(Result.mapErr(Disk.resize(target.disk, size.value), invalid), (d) =>
          World.replaceDisk(ctx.world, d),
        )
      : Result.map(
          Result.mapErr(
            Instance.withDiskSize(target.instance, target.disk.deviceName, size.value),
            invalid,
          ),
          (i) =>
            recordOperation(
              World.replaceInstance(ctx.world, i),
              instanceOperation(i, OperationTypes.Resize, ctx),
            ).world,
        );
  return Result.map(world, (w) => ({
    world: w,
    output: CommandOutput.messages(OutputMessage.plain(`Updated [${selfLink}].`)),
  }));
};

/** `disks describe`。独立ディスクはそのまま、インスタンスに繋がったディスクは `disks list` と同じ形で出す。 */
const describeDisk = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const zone = CommandContext.resolveZone(ctx, ParsedArgs.string(args, "zone"));
  if (!Result.isOk(zone)) return zone;
  const name = ParsedArgs.requiredPositional(args, 0);
  const found = findZonedDisk(ctx, zone.value, name);
  if (!Option.isSome(found)) return Result.err(diskNotFound(ctx, zone.value, name));
  const target = found.value;
  const record =
    target.kind === "standalone"
      ? Disk.toRecord(target.disk)
      : attachedDiskRecord(target.instance, target.disk);
  return Result.ok({ world: ctx.world, output: CommandOutput.yaml(record) });
};

const describeSnapshot = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const name = ParsedArgs.requiredPositional(args, 0);
  const snapshot = Option.toResult(
    Option.fromNullable(
      World.diskSnapshotsOf(ctx.world, ctx.project.projectId).find((s) => s.name === name),
    ),
    () => CommandFailure.notFound(`projects/${ctx.project.projectId}/global/snapshots/${name}`),
  );
  return Result.map(snapshot, (s) => ({
    world: ctx.world,
    output: CommandOutput.yaml(DiskSnapshot.toRecord(s)),
  }));
};

const DiskZoneFlag = Flag.string(
  "zone",
  "Zone of the disk. Overrides the default compute/zone property.",
  { candidates: Candidates.zones },
);

export const DiskCommands: readonly CommandSpec[] = [
  listCommand({
    path: ["gcloud", "compute", "disks", "list"],
    summary: "List Compute Engine disks.",
    permission: "compute.disks.list",
    columns: DiskColumns,
    records: diskRecords,
  }),
  projectCommand({
    path: ["gcloud", "compute", "disks", "create"],
    summary: "Create Compute Engine persistent disks.",
    positionals: [Positional.required("DISK_NAME", "Name of the disk to create.")],
    flags: [
      DiskZoneFlag,
      Flag.string("size", "Size of the disk, e.g. 200GB (default: 500GB)."),
      Flag.enum("type", "Type of the disk (default: pd-balanced).", [
        "pd-standard",
        "pd-balanced",
        "pd-ssd",
      ]),
      Flag.string(
        "image-family",
        "Image family to initialize the disk from (empty disk if omitted).",
      ),
      Flag.string("image-project", "Project of the image family."),
      Flag.string("image", "Alias of --image-family for the images gcloud-sim knows."),
    ],
    permission: "compute.disks.create",
    requiredApis: [ComputeApi],
    run: createDisk,
  }),
  projectCommand({
    path: ["gcloud", "compute", "disks", "describe"],
    summary: "Describe a Compute Engine disk.",
    positionals: [
      Positional.required("DISK_NAME", "Name of the disk to describe.", Candidates.disks),
    ],
    flags: [DiskZoneFlag],
    permission: "compute.disks.get",
    requiredApis: [ComputeApi],
    run: describeDisk,
  }),
  projectCommand({
    path: ["gcloud", "compute", "disks", "snapshot"],
    summary: "Create snapshots of Compute Engine persistent disks.",
    positionals: [
      Positional.required("DISK_NAME", "Name of the disk to snapshot.", Candidates.disks),
    ],
    flags: [
      DiskZoneFlag,
      Flag.string("snapshot-names", "Name of the snapshot to create (one disk at a time).", {
        required: true,
      }),
    ],
    permission: "compute.disks.createSnapshot",
    requiredApis: [ComputeApi],
    run: (ctx, args) => {
      const zone = CommandContext.resolveZone(ctx, ParsedArgs.string(args, "zone"));
      if (!Result.isOk(zone)) return zone;
      return snapshotDisk(ctx, {
        snapshotName: Option.unwrapOr(ParsedArgs.string(args, "snapshot-names"), ""),
        diskName: ParsedArgs.requiredPositional(args, 0),
        zone: zone.value,
      });
    },
  }),
  projectCommand({
    path: ["gcloud", "compute", "disks", "resize"],
    summary: "Resize a disk or disks (larger only).",
    positionals: [
      Positional.required("DISK_NAME", "Name of the disk to resize.", Candidates.disks),
    ],
    flags: [
      DiskZoneFlag,
      Flag.string("size", "New size of the disk, e.g. 100GB.", { required: true }),
    ],
    permission: "compute.disks.update",
    requiredApis: [ComputeApi],
    run: resizeDisk,
  }),
  projectCommand({
    path: ["gcloud", "compute", "snapshots", "create"],
    summary: "Create a Compute Engine snapshot from a disk.",
    positionals: [Positional.required("SNAPSHOT_NAME", "Name of the snapshot to create.")],
    flags: [
      Flag.string("source-disk", "Source disk used to create the snapshot.", {
        required: true,
        candidates: Candidates.disks,
      }),
      Flag.string("source-disk-zone", "Zone of the source disk."),
      DiskZoneFlag,
    ],
    permission: "compute.disks.createSnapshot",
    requiredApis: [ComputeApi],
    run: (ctx, args) => {
      const zone = CommandContext.resolveZone(
        ctx,
        Option.or(ParsedArgs.string(args, "source-disk-zone"), ParsedArgs.string(args, "zone")),
      );
      if (!Result.isOk(zone)) return zone;
      return snapshotDisk(ctx, {
        snapshotName: ParsedArgs.requiredPositional(args, 0),
        diskName: Option.unwrapOr(ParsedArgs.string(args, "source-disk"), ""),
        zone: zone.value,
      });
    },
  }),
  listCommand({
    path: ["gcloud", "compute", "snapshots", "list"],
    summary: "List Compute Engine snapshots.",
    permission: "compute.snapshots.list",
    columns: SnapshotColumns,
    records: (ctx) =>
      World.diskSnapshotsOf(ctx.world, ctx.project.projectId).map(DiskSnapshot.toRecord),
  }),
  projectCommand({
    path: ["gcloud", "compute", "snapshots", "describe"],
    summary: "Describe a Compute Engine snapshot.",
    positionals: [
      Positional.required(
        "SNAPSHOT_NAME",
        "Name of the snapshot to describe.",
        Candidates.snapshots,
      ),
    ],
    permission: "compute.snapshots.get",
    requiredApis: [ComputeApi],
    run: describeSnapshot,
  }),
];
