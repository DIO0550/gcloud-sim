import { MachineType, Region, Zone } from "@/engine/domains/catalog";
import { type Instance, ResourceName } from "@/engine/domains/compute";
import type { World } from "@/engine/domains/world";
import { Decoder as D } from "@/utils/Decoder";
import { Result } from "@/utils/Result";

export type Ref = Readonly<{ projectId: string; name: string; location: string }>;
export type VmConfig = Ref &
  Readonly<{
    maintenance: "MIGRATE" | "TERMINATE";
    automaticRestart: boolean;
    terminationAction: "STOP" | "DELETE";
    gpuType: string;
    gpuCount: number;
  }>;
export type BlockDisk = Ref &
  Readonly<{
    type: "pd-balanced" | "pd-ssd" | "hyperdisk-balanced";
    sizeGb: number;
    replicaZones: readonly string[];
    iops: number;
    throughput: number;
    sourceSnapshot: string;
    sourceImage: string;
    users: readonly string[];
    schedule: string;
  }>;
export type DiskData = Ref & Readonly<{ data: string }>;
export type DiskCopy = Readonly<{
  projectId: string;
  name: string;
  data: string;
  source: string;
  sizeGb: number;
  schedule: string;
  createdAt: number;
}>;
export type CustomImage = Readonly<{
  projectId: string;
  name: string;
  family: string;
  sizeGb: number;
  data: string;
  source: string;
}>;
export type Schedule = Ref & Readonly<{ hours: number; retentionDays: number; startTime: string }>;
export type TpuVm = Ref &
  Readonly<{
    type: "v2-8" | "v3-8";
    version: "tpu-vm-base";
    network: string;
    serviceAccount: string;
    preemptible: boolean;
    state: "READY" | "STOPPED";
  }>;
export type OsPolicy = Ref &
  Readonly<{
    instance: string;
    policy: "security-updates";
    state: "PENDING" | "SUCCEEDED";
  }>;
export type MigConfig = Ref &
  Readonly<{
    desiredTemplate: string;
    applied: Readonly<Record<string, string>>;
    pending: readonly string[];
    maxSurge: number;
    maxUnavailable: number;
    healthCheck: string;
    initialDelay: number;
    failed: readonly string[];
    failedAt: number;
    repairs: number;
  }>;
export type Observation = Ref & Readonly<{ operation: string; result: string }>;
export type ComputeLab = Readonly<{
  configs: readonly VmConfig[];
  disks: readonly BlockDisk[];
  diskData: readonly DiskData[];
  copies: readonly DiskCopy[];
  images: readonly CustomImage[];
  schedules: readonly Schedule[];
  tpus: readonly TpuVm[];
  osPolicies: readonly OsPolicy[];
  migs: readonly MigConfig[];
  observations: readonly Observation[];
}>;
export const emptyComputeLab = (): ComputeLab => ({
  configs: [],
  disks: [],
  diskData: [],
  copies: [],
  images: [],
  schedules: [],
  tpus: [],
  osPolicies: [],
  migs: [],
  observations: [],
});
export const sameRef = (a: Ref, b: Ref) =>
  a.projectId === b.projectId && a.name === b.name && a.location === b.location;
export const patchCompute = (w: World, change: Partial<ComputeLab>): World => ({
  ...w,
  computeLab: { ...w.computeLab, ...change },
});
export const vmRef = (i: Instance): Ref => ({
  projectId: i.projectId,
  name: i.name,
  location: i.zone,
});
export const vmConfig = (w: World, i: Instance): VmConfig =>
  w.computeLab.configs.find((c) => sameRef(c, vmRef(i))) ?? {
    ...vmRef(i),
    maintenance: i.preemptible || i.provisioningModel === "SPOT" ? "TERMINATE" : "MIGRATE",
    automaticRestart: !i.preemptible && i.provisioningModel === "STANDARD",
    terminationAction: "STOP",
    gpuType: "",
    gpuCount: 0,
  };
export const saveConfig = (w: World, c: VmConfig) =>
  patchCompute(w, { configs: [...w.computeLab.configs.filter((v) => !sameRef(v, c)), c] });
export const observeCompute = (w: World, r: Ref, operation: string, result: string) =>
  patchCompute(w, {
    observations: [
      ...w.computeLab.observations,
      { projectId: r.projectId, name: r.name, location: r.location, operation, result },
    ].slice(-100),
  });
export const diskData = (w: World, r: Ref) =>
  w.computeLab.diskData.find((v) => sameRef(v, r))?.data ?? "";
export const saveDiskData = (w: World, r: Ref, data: string) =>
  patchCompute(w, {
    diskData: [...w.computeLab.diskData.filter((v) => !sameRef(v, r)), { ...r, data }],
  });
export const saveMig = (w: World, r: MigConfig) =>
  patchCompute(w, { migs: [...w.computeLab.migs.filter((v) => !sameRef(v, r)), r] });
export const clock = (w: World) => w.dataProcessing.clock;
export const TpuZones: Readonly<Record<TpuVm["type"], readonly string[]>> = {
  "v2-8": ["us-central1-b", "us-central1-c"],
  "v3-8": ["us-central1-a", "us-central1-b"],
};
export const validHyperdisk = (d: BlockDisk) => {
  const minIops = d.sizeGb <= 5 ? d.sizeGb * 500 : 3000;
  const maxIops = d.sizeGb <= 5 ? minIops : Math.min(d.sizeGb * 500, 160000);
  return (
    d.sizeGb >= 4 &&
    d.sizeGb <= 65536 &&
    d.iops >= minIops &&
    d.iops <= maxIops &&
    d.throughput >= Math.max(140, d.iops / 256) &&
    d.throughput <= Math.min(2400, d.iops / 4)
  );
};
export const validVmConfig = (i: Instance, c: VmConfig) => {
  const interruptible = i.preemptible || i.provisioningModel === "SPOT";
  if (interruptible && (c.maintenance !== "TERMINATE" || c.automaticRestart)) {
    return false;
  }
  if (!c.gpuType) {
    return c.gpuCount === 0;
  }
  return (
    c.gpuType === "nvidia-tesla-t4" &&
    c.gpuCount === 1 &&
    i.machineType.startsWith("n1-") &&
    ["us-central1-a", "us-central1-b", "us-central1-c"].includes(i.zone) &&
    c.maintenance === "TERMINATE"
  );
};
export const diskExists = (w: World, r: Ref) =>
  w.computeLab.disks.some((d) => sameRef(d, r)) ||
  w.disks.some((d) => d.projectId === r.projectId && d.name === r.name && d.zone === r.location) ||
  w.instances.some(
    (i) =>
      i.projectId === r.projectId &&
      i.zone === r.location &&
      i.disks.some((d) => d.deviceName === r.name),
  );

export const validateComputeLab = (w: World): Result<World, string> => {
  const lab = w.computeLab;
  for (const collection of [
    lab.configs,
    lab.disks,
    lab.diskData,
    lab.schedules,
    lab.tpus,
    lab.osPolicies,
    lab.migs,
  ]) {
    const keys = new Set<string>();
    for (const r of collection) {
      const key = `${r.projectId}/${r.location}/${r.name}`;
      if (
        keys.has(key) ||
        !ResourceName.parse(r.name).ok ||
        !w.projects.some((p) => p.projectId === r.projectId) ||
        !(Region.parse(r.location).some || Zone.parse(r.location).some)
      ) {
        return Result.err("Invalid or duplicate Compute resource reference.");
      }
      keys.add(key);
    }
  }
  for (const c of lab.configs) {
    const i = w.instances.find((v) => sameRef(vmRef(v), c));
    if (!i || !validVmConfig(i, c)) {
      return Result.err("Invalid VM scheduling / accelerator or missing VM.");
    }
  }
  for (const d of lab.disks) {
    const regional = Region.parse(d.location).some;
    if (
      !Number.isInteger(d.sizeGb) ||
      d.sizeGb < 1 ||
      (d.type === "hyperdisk-balanced" && (!validHyperdisk(d) || regional)) ||
      (regional &&
        (d.replicaZones.length !== 2 ||
          new Set(d.replicaZones).size !== 2 ||
          d.replicaZones.some((z) => !Zone.parse(z).some || !z.startsWith(`${d.location}-`)))) ||
      (!regional && d.replicaZones.length !== 0) ||
      (d.schedule &&
        !lab.schedules.some(
          (s) =>
            s.projectId === d.projectId &&
            s.name === d.schedule &&
            s.location === (regional ? d.location : d.location.slice(0, -2)),
        )) ||
      d.users.length > 1 ||
      d.users.some(
        (key) =>
          !w.instances.some(
            (i) =>
              i.projectId === d.projectId &&
              `${i.zone}/${i.name}` === key &&
              (regional ? d.replicaZones.includes(i.zone) : i.zone === d.location) &&
              (d.type !== "hyperdisk-balanced" || i.machineType === "c3-standard-4"),
          ),
      )
    ) {
      return Result.err("Invalid Compute disk placement, performance, schedule or attachment.");
    }
    if (
      w.disks.some((v) => v.projectId === d.projectId && v.zone === d.location && v.name === d.name)
    ) {
      return Result.err("Duplicate Compute disk.");
    }
  }
  for (const d of lab.diskData) {
    if (!diskExists(w, d) || d.data.length > 4096) {
      return Result.err("Invalid virtual disk data.");
    }
  }
  for (const t of lab.tpus) {
    if (
      !TpuZones[t.type].includes(t.location) ||
      !w.networks.some((n) => n.projectId === t.projectId && n.name === t.network) ||
      !w.serviceAccounts.some((s) => s.projectId === t.projectId && s.email === t.serviceAccount)
    ) {
      return Result.err("Invalid TPU placement, network or service account.");
    }
  }
  for (const s of lab.schedules) {
    if (
      !Region.parse(s.location).some ||
      !Number.isInteger(s.hours) ||
      s.hours < 1 ||
      s.hours > 24 ||
      !Number.isInteger(s.retentionDays) ||
      s.retentionDays < 1 ||
      s.retentionDays > 365 ||
      !/^(?:[01]\d|2[0-3]):00$/.test(s.startTime)
    ) {
      return Result.err("Invalid snapshot schedule.");
    }
  }
  for (const c of [lab.copies, lab.images]) {
    if (
      new Set(c.map((r) => `${r.projectId}/${r.name}`)).size !== c.length ||
      c.some(
        (r) =>
          !ResourceName.parse(r.name).ok ||
          !w.projects.some((p) => p.projectId === r.projectId) ||
          !Number.isInteger(r.sizeGb) ||
          r.sizeGb < 1 ||
          r.data.length > 4096,
      )
    ) {
      return Result.err("Invalid Compute backup / image.");
    }
  }
  if (
    lab.copies.some(
      (c) =>
        !w.diskSnapshots.some((s) => s.projectId === c.projectId && s.name === c.name) ||
        !Number.isFinite(c.createdAt) ||
        c.createdAt < 0,
    )
  ) {
    return Result.err("Invalid snapshot data reference.");
  }
  for (const p of lab.osPolicies) {
    if (
      !Zone.parse(p.location).some ||
      !w.instances.some(
        (i) => i.projectId === p.projectId && i.zone === p.location && i.name === p.instance,
      )
    ) {
      return Result.err("Invalid OS policy target.");
    }
  }
  for (const m of lab.migs) {
    const g = w.instanceGroups.find((g) => sameRef({ ...g, location: g.location }, m));
    if (
      !g ||
      !w.instanceTemplates.some(
        (t) => t.projectId === m.projectId && t.name === m.desiredTemplate,
      ) ||
      m.pending.some((n) => !g.instanceNames.includes(n)) ||
      new Set(m.pending).size !== m.pending.length ||
      m.failed.some((n) => !g.instanceNames.includes(n)) ||
      !Number.isInteger(m.failedAt) ||
      m.failedAt < -1 ||
      m.failedAt > clock(w) ||
      g.instanceNames.some((n) => !Object.hasOwn(m.applied, n)) ||
      Object.entries(m.applied).some(
        ([n, t]) =>
          !g.instanceNames.includes(n) ||
          !w.instanceTemplates.some((v) => v.projectId === m.projectId && v.name === t),
      ) ||
      !Number.isInteger(m.maxSurge) ||
      m.maxSurge < 0 ||
      m.maxSurge > 100 ||
      !Number.isInteger(m.maxUnavailable) ||
      m.maxUnavailable < 0 ||
      m.maxUnavailable > 100 ||
      m.maxSurge + m.maxUnavailable < 1 ||
      !Number.isInteger(m.initialDelay) ||
      m.initialDelay < 0 ||
      !Number.isInteger(m.repairs) ||
      m.repairs < 0 ||
      (m.healthCheck &&
        !w.healthChecks.some((h) => h.projectId === m.projectId && h.name === m.healthCheck))
    ) {
      return Result.err("Invalid MIG update / autohealing state.");
    }
  }
  if (
    w.instances.some((i) => !MachineType.parse(i.machineType).some) ||
    lab.observations.length > 100
  ) {
    return Result.err("Invalid Compute catalog / observations.");
  }
  return Result.ok(w);
};
const ref = { projectId: D.string, name: D.string, location: D.string };
const strings = D.array(D.string);
export const computeLabDecoder = D.object<ComputeLab>({
  configs: D.array(
    D.object<VmConfig>({
      ...ref,
      maintenance: D.literal(["MIGRATE", "TERMINATE"]),
      automaticRestart: D.boolean,
      terminationAction: D.literal(["STOP", "DELETE"]),
      gpuType: D.string,
      gpuCount: D.number,
    }),
  ),
  disks: D.array(
    D.object<BlockDisk>({
      ...ref,
      type: D.literal(["pd-balanced", "pd-ssd", "hyperdisk-balanced"]),
      sizeGb: D.number,
      replicaZones: strings,
      iops: D.number,
      throughput: D.number,
      sourceSnapshot: D.string,
      sourceImage: D.string,
      users: strings,
      schedule: D.string,
    }),
  ),
  diskData: D.array(D.object<DiskData>({ ...ref, data: D.string })),
  copies: D.array(
    D.object<DiskCopy>({
      projectId: D.string,
      name: D.string,
      data: D.string,
      source: D.string,
      sizeGb: D.number,
      schedule: D.string,
      createdAt: D.number,
    }),
  ),
  images: D.array(
    D.object<CustomImage>({
      projectId: D.string,
      name: D.string,
      family: D.string,
      sizeGb: D.number,
      data: D.string,
      source: D.string,
    }),
  ),
  schedules: D.array(
    D.object<Schedule>({ ...ref, hours: D.number, retentionDays: D.number, startTime: D.string }),
  ),
  tpus: D.array(
    D.object<TpuVm>({
      ...ref,
      type: D.literal(["v2-8", "v3-8"]),
      version: D.literal(["tpu-vm-base"]),
      network: D.string,
      serviceAccount: D.string,
      preemptible: D.boolean,
      state: D.literal(["READY", "STOPPED"]),
    }),
  ),
  osPolicies: D.array(
    D.object<OsPolicy>({
      ...ref,
      instance: D.string,
      policy: D.literal(["security-updates"]),
      state: D.literal(["PENDING", "SUCCEEDED"]),
    }),
  ),
  migs: D.array(
    D.object<MigConfig>({
      ...ref,
      desiredTemplate: D.string,
      applied: D.record(D.string),
      pending: strings,
      maxSurge: D.number,
      maxUnavailable: D.number,
      healthCheck: D.string,
      initialDelay: D.number,
      failed: strings,
      failedAt: D.number,
      repairs: D.number,
    }),
  ),
  observations: D.array(D.object<Observation>({ ...ref, operation: D.string, result: D.string })),
});
