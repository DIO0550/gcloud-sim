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
  diskRecord,
  extendedDiskCreate,
  extendedDiskFlags,
  labDiskArg,
  needsExtendedCreate,
  snapshotWithData,
} from "@/engine/commands/compute-lab/disks";
import { location, rf } from "@/engine/commands/compute-lab/shared";
import {
  alreadyExists,
  Candidates,
  describeNamedCommand,
  instanceOperationSeed,
  projectCommand,
  recordOperation,
} from "@/engine/commands/shared";
import type { PublicImage, Zone } from "@/engine/domains/catalog";
import { Disk, DiskSizeGb, DiskSnapshot, Instance } from "@/engine/domains/compute";
import { patchCompute, sameRef } from "@/engine/domains/compute-lab/model";
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
  return snapshotWithData(
    ctx,
    { projectId: ctx.project.projectId, name: seed.diskName, location: seed.zone },
    seed.snapshotName,
  );
};

const createDisk = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  if (needsExtendedCreate(args)) {
    return extendedDiskCreate(ctx, args);
  }
  const zone = CommandContext.resolveZone(ctx, ParsedArgs.string(args, "zone"));
  if (!Result.isOk(zone)) return zone;
  const shape = resolveDiskShape(args, "size", "type", "500GB");
  if (!Result.isOk(shape)) return shape;
  const hasImage = ParsedArgs.has(args, "image-family") || ParsedArgs.has(args, "image");
  const image: Result<Option<PublicImage>, CommandFailure> = hasImage
    ? Result.map(resolveImage(args, ctx), (i) => Option.some(i))
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
  const loc = location(ctx, args);
  if (!loc.ok) {
    return loc;
  }
  const labDisk = ctx.world.computeLab.disks.find(
    (d) =>
      d.projectId === ctx.project.projectId &&
      d.location === loc.value &&
      d.name === ParsedArgs.requiredPositional(args, 0),
  );
  if (labDisk) {
    const size = DiskSizeGb.parse(ParsedArgs.requiredString(args, "size"));
    if (!size.ok || size.value <= labDisk.sizeGb) {
      return Result.err(CommandFailure.invalidArgumentWith("Disk size can only increase."));
    }
    const next = { ...labDisk, sizeGb: size.value };
    const checked = World.validate(
      patchCompute(ctx.world, {
        disks: ctx.world.computeLab.disks.map((d) => (sameRef(d, labDisk) ? next : d)),
      }),
    );
    return Result.map(Result.mapErr(checked, CommandFailure.invalidState), (world) => ({
      world,
      output: CommandOutput.yaml(diskRecord(next)),
    }));
  }
  if (ParsedArgs.has(args, "region")) {
    return Result.err(CommandFailure.notFoundWith("Disk not found in the selected region."));
  }
  const zone = CommandContext.resolveZone(ctx, ParsedArgs.string(args, "zone"));
  if (!Result.isOk(zone)) return zone;
  const size = Result.mapErr(DiskSizeGb.parse(ParsedArgs.requiredString(args, "size")), (m) =>
    CommandFailure.invalidValue("--size", m.replace("--boot-disk-size", "--size")),
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
              instanceOperationSeed(i, OperationTypes.Resize, ctx),
            ).world,
        );
  return Result.map(world, (w) => ({
    world: w,
    output: CommandOutput.messages(OutputMessage.plain(`Updated [${selfLink}].`)),
  }));
};

/** `disks describe`。独立ディスクはそのまま、インスタンスに繋がったディスクは `disks list` と同じ形で出す。 */
const describeDisk = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const loc = location(ctx, args);
  if (!loc.ok) {
    return loc;
  }
  if (
    ctx.world.computeLab.disks.some(
      (d) =>
        d.projectId === ctx.project.projectId &&
        d.location === loc.value &&
        d.name === ParsedArgs.requiredPositional(args, 0),
    )
  ) {
    return Result.map(labDiskArg(ctx, args), (d) => ({
      world: ctx.world,
      output: CommandOutput.yaml(diskRecord(d)),
    }));
  }
  if (ParsedArgs.has(args, "region")) {
    return Result.err(CommandFailure.notFoundWith("Disk not found in the selected region."));
  }
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
      ...extendedDiskFlags,
      DiskZoneFlag,
      Flag.string("size", "Size of the disk, e.g. 200GB (default: 500GB)."),
      Flag.enum("type", "Type of the disk (default: pd-balanced).", [
        "pd-standard",
        "pd-balanced",
        "pd-ssd",
        "hyperdisk-balanced",
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
    flags: [DiskZoneFlag, rf],
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
      rf,
      Flag.string("snapshot-names", "Name of the snapshot to create (one disk at a time).", {
        required: true,
      }),
    ],
    permission: "compute.disks.createSnapshot",
    requiredApis: [ComputeApi],
    run: (ctx, args) => {
      return Result.flatMap(location(ctx, args), (location) =>
        snapshotWithData(
          ctx,
          {
            projectId: ctx.project.projectId,
            name: ParsedArgs.requiredPositional(args, 0),
            location,
          },
          ParsedArgs.requiredString(args, "snapshot-names"),
        ),
      );
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
      rf,
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
        diskName: ParsedArgs.requiredString(args, "source-disk"),
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
  describeNamedCommand({
    path: ["gcloud", "compute", "snapshots", "describe"],
    summary: "Describe a Compute Engine snapshot.",
    positional: { name: "SNAPSHOT_NAME", description: "Name of the snapshot to describe." },
    collection: "diskSnapshots",
    permission: "compute.snapshots.get",
    requiredApis: [ComputeApi],
    resourcePath: (ref) => `projects/${ref.projectId}/global/snapshots/${ref.name}`,
    record: DiskSnapshot.toRecord,
  }),
];
