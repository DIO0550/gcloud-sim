import {
  type CommandResult,
  Flag,
  ParsedArgs,
  type ProjectContext,
} from "@/engine/cli/command-spec";
import { Region, Zone } from "@/engine/domains/catalog";
import { DiskSizeGb, DiskSnapshot, ResourceName } from "@/engine/domains/compute";
import {
  type BlockDisk,
  clock,
  diskData,
  diskExists,
  patchCompute,
  type Ref,
  sameRef,
  saveDiskData,
  validHyperdisk,
} from "@/engine/domains/compute-lab/model";
import { World } from "@/engine/domains/world";
import { Result } from "@/utils/Result";
import {
  command,
  finish,
  integer,
  invalid,
  list,
  missing,
  name,
  observed,
  ref,
  rf,
  sf,
  text,
  zf,
} from "./shared";

export const diskRecord = (d: BlockDisk) => ({
  ...d,
  zone: d.location,
  locationScope: Region.parse(d.location).some ? "region" : "zone",
  state: "READY",
  status: "READY",
});
export const labDiskArg = (c: ProjectContext, a: ParsedArgs) =>
  Result.flatMap(ref(c, a), (r) => {
    const disk = c.world.computeLab.disks.find((d) => sameRef(d, r));
    return disk ? Result.ok(disk) : missing("Compute lab disk not found in project / location.");
  });
export const diskInfo = (w: World, r: Ref): { sizeGb: number; data: string } | undefined => {
  const d = w.computeLab.disks.find((d) => sameRef(d, r));
  if (d) {
    return { sizeGb: d.sizeGb, data: diskData(w, r) };
  }
  const plain = w.disks.find(
    (d) => d.projectId === r.projectId && d.zone === r.location && d.name === r.name,
  );
  const boot = w.instances
    .find(
      (i) =>
        i.projectId === r.projectId &&
        i.zone === r.location &&
        i.disks.some((d) => d.deviceName === r.name),
    )
    ?.disks.find((d) => d.deviceName === r.name);
  const size = plain?.sizeGb ?? boot?.sizeGb;
  return size === undefined ? undefined : { sizeGb: size, data: diskData(w, r) };
};
export const extendedDiskCreate = (c: ProjectContext, a: ParsedArgs): CommandResult =>
  Result.flatMap(ref(c, a), (r) => {
    if (!ResourceName.parse(r.name).ok || diskExists(c.world, r)) {
      return invalid("Invalid or existing disk name.");
    }
    const type = text(a, "type", "pd-balanced") as BlockDisk["type"];
    if (!["pd-balanced", "pd-ssd", "hyperdisk-balanced"].includes(type)) {
      return invalid(
        "Only regional pd-balanced / pd-ssd and zonal hyperdisk-balanced are supported.",
      );
    }
    if (
      type !== "hyperdisk-balanced" &&
      (ParsedArgs.has(a, "provisioned-iops") || ParsedArgs.has(a, "provisioned-throughput"))
    ) {
      return invalid("Provisioned performance is only supported for Hyperdisk.");
    }
    if (ParsedArgs.has(a, "image-family") || ParsedArgs.has(a, "image-project")) {
      return invalid("Use --image=<custom image> or --source-snapshot with this disk model.");
    }
    const sourceSnapshot = text(a, "source-snapshot");
    const sourceImage = text(a, "image");
    if (sourceSnapshot && sourceImage) {
      return invalid("Choose exactly one source.");
    }
    const snapshot = c.world.diskSnapshots.find(
      (s) => s.projectId === r.projectId && s.name === sourceSnapshot,
    );
    const image = c.world.computeLab.images.find(
      (i) => i.projectId === r.projectId && i.name === sourceImage,
    );
    if ((sourceSnapshot && !snapshot) || (sourceImage && !image)) {
      return missing("Backup / custom image not found in selected project.");
    }
    const minimum = snapshot?.diskSizeGb ?? image?.sizeGb ?? 1;
    const size = DiskSizeGb.parse(text(a, "size", String(Math.max(minimum, 100))));
    if (!size.ok || size.value < minimum) {
      return invalid("Disk size must be valid and at least the source disk size.");
    }
    const d: BlockDisk = {
      ...r,
      type,
      sizeGb: size.value,
      replicaZones: ParsedArgs.list(a, "replica-zones"),
      iops: integer(a, "provisioned-iops", type === "hyperdisk-balanced" ? 3000 : 0),
      throughput: integer(a, "provisioned-throughput", type === "hyperdisk-balanced" ? 140 : 0),
      sourceSnapshot,
      sourceImage,
      users: [],
      schedule: "",
    };
    const data = sourceSnapshot
      ? (c.world.computeLab.copies.find(
          (s) => s.projectId === r.projectId && s.name === sourceSnapshot,
        )?.data ?? "")
      : (image?.data ?? "");
    return finish(
      saveDiskData(patchCompute(c.world, { disks: [...c.world.computeLab.disks, d] }), r, data),
      diskRecord(d),
    );
  });
export const extendedDiskFlags = [
  rf,
  Flag.list("replica-zones", "Two distinct zones in the regional disk region."),
  sf("source-snapshot"),
  Flag.integer("provisioned-iops", "Hyperdisk provisioned IOPS."),
  Flag.integer("provisioned-throughput", "Hyperdisk provisioned throughput MiB/s."),
];
export const needsExtendedCreate = (a: ParsedArgs) =>
  ParsedArgs.has(a, "region") ||
  ParsedArgs.has(a, "source-snapshot") ||
  text(a, "type") === "hyperdisk-balanced" ||
  ["replica-zones", "provisioned-iops", "provisioned-throughput", "image"].some((k) =>
    ParsedArgs.has(a, k),
  );
export const snapshotWithData = (
  c: ProjectContext,
  source: Ref,
  snapshotName: string,
  schedule = "",
): CommandResult => {
  const info = diskInfo(c.world, source);
  if (!info) {
    return missing("Snapshot source disk not found in selected project / location.");
  }
  const loc = Region.parse(source.location).some
    ? Region.parse(source.location)
    : Zone.parse(source.location);
  if (!loc.some) {
    return invalid("Unsupported source location.");
  }
  const made = DiskSnapshot.create({
    projectId: source.projectId,
    name: snapshotName,
    sourceDisk: source.name,
    sourceZone: loc.value,
    diskSizeGb: info.sizeGb,
    creationTimestamp: c.now,
  });
  if (!made.ok) {
    return invalid(made.error);
  }
  const added = World.withDiskSnapshot(c.world, made.value);
  if (!added.ok) {
    return invalid("Snapshot already exists.");
  }
  const copy = {
    projectId: source.projectId,
    name: snapshotName,
    data: info.data,
    source: `${source.location}/${source.name}`,
    sizeGb: info.sizeGb,
    schedule,
    createdAt: clock(c.world),
  };
  return finish(
    patchCompute(added.value, { copies: [...added.value.computeLab.copies, copy] }),
    DiskSnapshot.toRecord(made.value),
  );
};
export const DiskLabCommands = [
  command(
    ["gcloud", "compute", "disks", "delete"],
    "compute.disks.delete",
    (c, a) =>
      Result.flatMap(ref(c, a), (r) => {
        const d = c.world.computeLab.disks.find((v) => sameRef(v, r));
        if (d) {
          if (d.users.length || d.schedule) {
            return invalid("Detach disk and snapshot schedule before deletion.");
          }
          return finish(
            patchCompute(c.world, {
              disks: c.world.computeLab.disks.filter((v) => !sameRef(v, r)),
              diskData: c.world.computeLab.diskData.filter((v) => !sameRef(v, r)),
            }),
            { deleted: d.name },
          );
        }
        const disk = c.world.disks.find(
          (v) => v.projectId === r.projectId && v.zone === r.location && v.name === r.name,
        );
        if (!disk) {
          return missing("Standalone disk missing; VM boot disks must be deleted with VM.");
        }
        if (disk.users.length) {
          return invalid("Disk is attached.");
        }
        return finish(
          patchCompute(
            { ...c.world, disks: c.world.disks.filter((v) => v !== disk) },
            { diskData: c.world.computeLab.diskData.filter((v) => !sameRef(v, r)) },
          ),
          { deleted: r.name },
        );
      }),
    [zf, rf],
    true,
    "compute.googleapis.com",
    true,
  ),
  command(
    ["gcloud", "compute", "disks", "update"],
    "compute.disks.update",
    (c, a) =>
      Result.flatMap(labDiskArg(c, a), (d) => {
        if (d.type !== "hyperdisk-balanced") {
          return invalid("Only Hyperdisk performance updates are supported here.");
        }
        const next = {
          ...d,
          iops: integer(a, "provisioned-iops", d.iops),
          throughput: integer(a, "provisioned-throughput", d.throughput),
        };
        if (!validHyperdisk(next)) {
          return invalid(
            "Provisioned performance exceeds Hyperdisk size / IOPS / throughput limits.",
          );
        }
        return finish(
          patchCompute(c.world, {
            disks: c.world.computeLab.disks.map((v) => (sameRef(v, d) ? next : v)),
          }),
          diskRecord(next),
        );
      }),
    [
      zf,
      rf,
      Flag.integer("provisioned-iops", "IOPS."),
      Flag.integer("provisioned-throughput", "MiB/s."),
    ],
  ),
  ...(["write", "read"] as const).map((op) =>
    command(
      ["sim", "compute", "disks", op],
      op === "write" ? "compute.disks.update" : "compute.disks.get",
      (c, a) =>
        Result.flatMap(ref(c, a), (r) => {
          if (!diskExists(c.world, r)) {
            return missing("Disk not found.");
          }
          const data = text(a, "data");
          if (op === "write" && data.length > 4096) {
            return invalid("Virtual data is limited to 4096 characters.");
          }
          const w = op === "write" ? saveDiskData(c.world, r, data) : c.world;
          return observed(w, r, op, { data: diskData(w, r) });
        }),
      [zf, rf, ...(op === "write" ? [sf("data", true)] : [])],
    ),
  ),
  command(
    ["gcloud", "compute", "snapshots", "delete"],
    "compute.snapshots.delete",
    (c, a) => {
      if (
        !c.world.diskSnapshots.some(
          (s) => s.projectId === c.project.projectId && s.name === name(a),
        )
      ) {
        return missing("Snapshot missing in selected project.");
      }
      return finish(
        patchCompute(
          {
            ...c.world,
            diskSnapshots: c.world.diskSnapshots.filter(
              (s) => !(s.projectId === c.project.projectId && s.name === name(a)),
            ),
          },
          {
            copies: c.world.computeLab.copies.filter(
              (s) => !(s.projectId === c.project.projectId && s.name === name(a)),
            ),
          },
        ),
        { deleted: name(a) },
      );
    },
    [],
    true,
    "compute.googleapis.com",
    true,
  ),
  command(
    ["gcloud", "compute", "images", "create"],
    "compute.images.create",
    (c, a) => {
      const sourceDisk = text(a, "source-disk");
      const sourceSnapshot = text(a, "source-snapshot");
      if (
        Boolean(sourceDisk) === Boolean(sourceSnapshot) ||
        !ResourceName.parse(name(a)).ok ||
        c.world.computeLab.images.some(
          (i) => i.projectId === c.project.projectId && i.name === name(a),
        )
      ) {
        return invalid(
          "New image name and exactly one --source-disk / --source-snapshot required.",
        );
      }
      let data = "";
      let sizeGb = 0;
      let source = sourceSnapshot;
      if (sourceDisk) {
        const loc = text(a, "source-disk-zone", text(a, "source-disk-region"));
        const info = diskInfo(c.world, {
          projectId: c.project.projectId,
          name: sourceDisk,
          location: loc,
        });
        if (!info) {
          return missing("Image source disk missing in explicit location.");
        }
        const boot = c.world.instances.find(
          (i) =>
            i.projectId === c.project.projectId &&
            i.zone === loc &&
            i.disks.some((d) => d.boot && d.deviceName === sourceDisk),
        );
        if (boot && boot.status !== "TERMINATED") {
          return invalid("Stop the source VM before imaging its boot disk.");
        }
        data = info.data;
        sizeGb = info.sizeGb;
        source = `${loc}/${sourceDisk}`;
      }
      if (sourceSnapshot) {
        const snapshot = c.world.diskSnapshots.find(
          (s) => s.projectId === c.project.projectId && s.name === sourceSnapshot,
        );
        if (!snapshot) {
          return missing("Image source snapshot missing.");
        }
        sizeGb = snapshot.diskSizeGb;
        data =
          c.world.computeLab.copies.find(
            (s) => s.projectId === c.project.projectId && s.name === sourceSnapshot,
          )?.data ?? "";
      }
      const image = {
        projectId: c.project.projectId,
        name: name(a),
        family: text(a, "family"),
        source,
        data,
        sizeGb,
      };
      return finish(patchCompute(c.world, { images: [...c.world.computeLab.images, image] }), {
        ...image,
        status: "READY",
      });
    },
    [
      sf("source-disk"),
      sf("source-disk-zone"),
      sf("source-disk-region"),
      sf("source-snapshot"),
      sf("family"),
    ],
  ),
  ...(["describe", "delete"] as const).map((op) =>
    command(
      ["gcloud", "compute", "images", op],
      `compute.images.${op === "describe" ? "get" : "delete"}`,
      (c, a) => {
        const i = c.world.computeLab.images.find(
          (v) => v.projectId === c.project.projectId && v.name === name(a),
        );
        if (!i) {
          return missing("Custom image missing in selected project.");
        }
        if (op === "describe") {
          return finish(c.world, { ...i });
        }
        return finish(
          patchCompute(c.world, { images: c.world.computeLab.images.filter((v) => v !== i) }),
          { deleted: i.name },
        );
      },
      [],
      true,
      "compute.googleapis.com",
      op === "delete",
    ),
  ),
  command(
    ["gcloud", "compute", "resource-policies", "create", "snapshot-schedule"],
    "compute.resourcePolicies.create",
    (c, a) =>
      Result.flatMap(ref(c, a), (r) => {
        if (
          !Region.parse(r.location).some ||
          c.world.computeLab.schedules.some((s) => sameRef(s, r))
        ) {
          return invalid("Schedule must be new and regional.");
        }
        const schedule = {
          ...r,
          hours: integer(a, "hourly-schedule", 0),
          retentionDays: integer(a, "max-retention-days", 0),
          startTime: text(a, "start-time", "00:00"),
        };
        return finish(
          patchCompute(c.world, { schedules: [...c.world.computeLab.schedules, schedule] }),
          { ...schedule },
        );
      }),
    [
      rf,
      Flag.integer("hourly-schedule", "Interval 1..24 hours.", { required: true }),
      Flag.integer("max-retention-days", "1..365 days.", { required: true }),
      sf("start-time"),
    ],
  ),
  ...(["describe", "delete"] as const).map((op) =>
    command(
      ["gcloud", "compute", "resource-policies", op],
      `compute.resourcePolicies.${op === "describe" ? "get" : "delete"}`,
      (c, a) =>
        Result.flatMap(ref(c, a), (r) => {
          const s = c.world.computeLab.schedules.find((v) => sameRef(v, r));
          if (!s) {
            return missing("Snapshot schedule missing.");
          }
          if (op === "describe") {
            return finish(c.world, { ...s });
          }
          if (
            c.world.computeLab.disks.some(
              (d) => d.projectId === r.projectId && d.schedule === r.name,
            )
          ) {
            return invalid("Detach policy from disks before deletion.");
          }
          return finish(
            patchCompute(c.world, {
              schedules: c.world.computeLab.schedules.filter((v) => !sameRef(v, r)),
            }),
            { deleted: r.name },
          );
        }),
      [rf],
      true,
      "compute.googleapis.com",
      op === "delete",
    ),
  ),
  command(
    ["gcloud", "compute", "resource-policies", "list"],
    "compute.resourcePolicies.list",
    (c) =>
      list(
        c.world,
        c.world.computeLab.schedules
          .filter((s) => s.projectId === c.project.projectId)
          .map((s) => ({ ...s })),
      ),
    [],
    false,
  ),
  ...(["add", "remove"] as const).map((op) =>
    command(
      ["gcloud", "compute", "disks", `${op}-resource-policies`],
      `compute.disks.${op}ResourcePolicies`,
      (c, a) =>
        Result.flatMap(labDiskArg(c, a), (d) => {
          const policy = text(a, "resource-policies");
          const region = Region.parse(d.location).some ? d.location : d.location.slice(0, -2);
          if (
            !c.world.computeLab.schedules.some(
              (s) => s.projectId === d.projectId && s.location === region && s.name === policy,
            ) ||
            (op === "remove" && d.schedule !== policy)
          ) {
            return missing("Schedule missing, region mismatch, or policy not attached.");
          }
          const next = { ...d, schedule: op === "add" ? policy : "" };
          return finish(
            patchCompute(c.world, {
              disks: c.world.computeLab.disks.map((v) => (sameRef(v, d) ? next : v)),
            }),
            diskRecord(next),
          );
        }),
      [zf, rf, sf("resource-policies", true)],
    ),
  ),
  command(
    ["sim", "compute", "snapshot-schedules", "run"],
    ["compute.disks.createSnapshot", "compute.snapshots.create"],
    (c, a) =>
      Result.flatMap(ref(c, a), (r) => {
        const s = c.world.computeLab.schedules.find((v) => sameRef(v, r));
        if (!s) {
          return missing("Schedule missing in region.");
        }
        const disks = c.world.computeLab.disks.filter(
          (d) =>
            d.projectId === s.projectId &&
            d.schedule === s.name &&
            (d.location === s.location || d.location.startsWith(`${s.location}-`)),
        );
        if (!disks.length) {
          return invalid("Attach schedule to at least one disk first.");
        }
        const now = clock(c.world);
        const recent = c.world.computeLab.copies.filter(
          (v) => v.projectId === s.projectId && v.schedule === s.name,
        );
        if (recent.some((v) => now - v.createdAt < s.hours * 3600)) {
          return invalid("Next snapshot interval has not elapsed in virtual time.");
        }
        const expired = recent
          .filter((v) => now - v.createdAt > s.retentionDays * 86400)
          .map((v) => v.name);
        let world = patchCompute(
          {
            ...c.world,
            diskSnapshots: c.world.diskSnapshots.filter(
              (v) => !(v.projectId === s.projectId && expired.includes(v.name)),
            ),
          },
          {
            copies: c.world.computeLab.copies.filter(
              (v) => !(v.projectId === s.projectId && expired.includes(v.name)),
            ),
          },
        );
        for (const d of disks) {
          const made = snapshotWithData({ ...c, world }, d, `${d.name}-scheduled-${now}`, s.name);
          if (!made.ok) {
            return made;
          }
          world = made.value.world;
        }
        return observed(world, r, "scheduled-backup", {
          created: disks.length,
          expired: expired.length,
          clock: now,
        });
      }),
    [rf],
  ),
];
