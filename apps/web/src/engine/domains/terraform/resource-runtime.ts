import { BucketLocation, MachineType, StorageClass, Zone } from "@/engine/domains/catalog";
import { BootDiskType, ExternalIp, Instance } from "@/engine/domains/compute";
import { ServiceAccount } from "@/engine/domains/service-account";
import { Bucket } from "@/engine/domains/storage";
import { protectionFor, retentionAllows } from "@/engine/domains/storage-lab/model";
import type { TfChange } from "@/engine/domains/terraform";
import { TfAccess } from "@/engine/domains/terraform/access";
import {
  type TfBucket,
  type TfFirewall,
  type TfInstance,
  type TfResource,
  TfResources,
} from "@/engine/domains/terraform/resources";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const fail = (message: string): never => {
  throw new Error(message);
};
const unwrap = <T extends NonNullable<unknown>>(value: Option<T>, message: string): T =>
  Option.isSome(value) ? value.value : fail(message);
const result = <T>(value: Result<T, string>): T =>
  Result.isOk(value) ? value.value : fail(value.error);
const sorted = (items: readonly string[]): readonly string[] => [...new Set(items)].sort();
const same = TfResources.equal;
const rules = (items: TfFirewall["allowed"]) =>
  items
    .map((r) => ({ ...r, ports: sorted(r.ports) }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const read = (world: World, r: TfInstance | TfFirewall | TfBucket): TfResource | undefined => {
  const matches = (x: { projectId: string; name: string }) =>
    x.projectId === r.project && x.name === r.name;
  if (r.type === "google_storage_bucket") {
    const b = world.buckets.find((b) => b.name === r.name);
    if (b && !matches(b)) fail(`Bucket name is already in use in another project: ${r.name}`);
    return b
      ? {
          ...r,
          location: b.location,
          storageClass: b.storageClass,
          uniformAccess: b.uniformBucketLevelAccess,
          publicAccessPrevention: b.publicAccessPrevention,
          versioning: b.versioning,
        }
      : undefined;
  }
  if (r.type === "google_compute_firewall") {
    const f = world.firewallRules.find(matches);
    return f
      ? {
          ...r,
          network: f.network,
          direction: f.direction,
          priority: f.priority,
          sourceRanges: sorted(f.sourceRanges),
          destinationRanges: sorted(f.destinationRanges),
          targetTags: sorted(f.targetTags),
          allowed: rules(f.allowed),
          denied: rules(f.denied),
          disabled: f.disabled,
        }
      : undefined;
  }
  const vm = world.instances.find((i) => matches(i) && i.zone === r.zone);
  if (
    world.instanceGroups.some(
      (g) =>
        g.projectId === r.project &&
        g.instanceNames.includes(r.name) &&
        (g.location === r.zone || r.zone.startsWith(`${g.location}-`)),
    )
  )
    fail("MIG-managed instances cannot be managed by this Terraform subset.");
  if (!vm) return undefined;
  if (
    vm.disks.length !== 1 ||
    vm.networkInterfaces.length !== 1 ||
    vm.preemptible ||
    vm.provisioningModel !== "STANDARD"
  )
    fail("Only standard VMs with one boot disk and one NIC are supported.");
  const disk = vm.disks[0];
  const nic = vm.networkInterfaces[0];
  if (!disk?.boot || !nic) return fail("Unsupported VM disk or NIC.");
  return {
    ...r,
    machineType: vm.machineType,
    network: nic.network,
    subnet: nic.subnetwork,
    image: disk.sourceImage,
    diskSize: disk.sizeGb,
    diskType: disk.type,
    externalIp: nic.externalIP.kind !== "none",
    tags: sorted(vm.tags),
    metadata: Object.fromEntries(
      Object.entries(vm.metadata).sort(([a], [b]) => a.localeCompare(b)),
    ),
    serviceAccount: vm.serviceAccount,
    scopes: sorted(vm.scopes),
  };
};
const mutateBucket = (
  world: World,
  r: TfBucket,
  action: TfChange["action"],
  checkWrites: boolean,
  now: string,
): World => {
  const old = world.buckets.find((b) => b.name === r.name);
  if (old && old.projectId !== r.project) fail(`Bucket name already exists: ${r.name}`);
  if (action === "delete") {
    if (old?.objects.length && !r.forceDestroy)
      fail(
        `Bucket ${r.name} is not empty. Apply force_destroy = true before destroying, or remove its objects.`,
      );
    if (old?.objects.length && checkWrites)
      for (const permission of ["storage.objects.list", "storage.objects.delete"])
        TfAccess.check(world, r, permission);
    if (world.storageLab.transfers.some((t) => t.source === r.name || t.destination === r.name)) {
      fail("A transfer job references this bucket.");
    }
    const generations = world.storageLab.versions.filter(
      (v) => v.bucket === r.name && v.state !== "SOFT_DELETED",
    );
    if (generations.length > 0 && !r.forceDestroy) {
      fail("Bucket contains object generations. force_destroy is required.");
    }
    if (
      Number.isFinite(Date.parse(now)) &&
      protectionFor(world, r.name).retention > 0 &&
      (generations.some((v) => !retentionAllows(world, r.name, v.created, now)) ||
        old?.objects.some(
          (o) =>
            Date.parse(now) <
            Date.parse(o.created ?? o.updated) + protectionFor(world, r.name).retention * 1000,
        ))
    ) {
      fail("Object retention prevents bucket destruction.");
    }
    return World.withoutBucket(world, r.name);
  }
  if (action === "create" && old) fail(`Bucket already exists: ${r.name}. Use terraform import.`);
  const base =
    old ??
    result(
      Bucket.create({
        projectId: r.project,
        name: r.name,
        location: unwrap(BucketLocation.parse(r.location), "Unknown bucket location."),
        storageClass: unwrap(StorageClass.parse(r.storageClass), "Unknown storage class."),
        uniformBucketLevelAccess: r.uniformAccess,
        publicAccessPrevention: r.publicAccessPrevention,
        timeCreated: now,
      }),
    );
  const bucket = {
    ...base,
    storageClass: unwrap(StorageClass.parse(r.storageClass), "Unknown storage class."),
    uniformBucketLevelAccess: r.uniformAccess,
    publicAccessPrevention: r.publicAccessPrevention,
    versioning: r.versioning,
  };
  return { ...world, buckets: [...world.buckets.filter((b) => b.name !== r.name), bucket] };
};
const mutateFirewall = (world: World, r: TfFirewall, action: TfChange["action"]): World => {
  const matches = (f: { projectId: string; name: string }) =>
    f.projectId === r.project && f.name === r.name;
  const others = world.firewallRules.filter((f) => !matches(f));
  if (action === "delete") return { ...world, firewallRules: others };
  if (action === "create" && world.firewallRules.some(matches))
    fail(`Firewall already exists: ${r.name}. Use terraform import.`);
  if (!world.networks.some((n) => n.projectId === r.project && n.name === r.network))
    fail(`Network not found: ${r.network}`);
  return {
    ...world,
    firewallRules: [
      ...others,
      {
        projectId: r.project,
        name: r.name,
        network: r.network,
        direction: r.direction,
        priority: r.priority,
        sourceRanges: r.sourceRanges,
        destinationRanges: r.destinationRanges,
        targetTags: r.targetTags,
        allowed: r.allowed,
        denied: r.denied,
        disabled: r.disabled,
      },
    ],
  };
};
const mutateInstance = (
  world: World,
  r: TfInstance,
  action: TfChange["action"],
  checkWrites: boolean,
  now: string,
): World => {
  const matches = (i: Instance) =>
    i.projectId === r.project && i.name === r.name && i.zone === r.zone;
  const old = world.instances.find(matches);
  if (action === "delete")
    return { ...world, instances: world.instances.filter((i) => !matches(i)) };
  if (action === "create" && old) fail(`Instance already exists: ${r.name}. Use terraform import.`);
  const zone = unwrap(Zone.parse(r.zone), "Unknown zone.");
  const subnet = world.subnets.find(
    (s) =>
      s.projectId === r.project &&
      s.name === r.subnet &&
      s.network === r.network &&
      s.region === Zone.region(zone),
  );
  if (!subnet) return fail(`Subnetwork not found or network/region mismatch: ${r.subnet}`);
  if (checkWrites && action === "create") {
    TfAccess.check(world, r, "compute.subnetworks.use");
    TfAccess.check(world, r, "compute.disks.create");
    if (r.externalIp) TfAccess.check(world, r, "compute.subnetworks.useExternalIp");
  }
  if (r.serviceAccount) {
    const project = unwrap(World.findActiveProject(world, r.project), "Project not found.");
    const sa = World.findServiceAccount(world, r.serviceAccount);
    if (
      !Option.isSome(sa) &&
      r.serviceAccount !== ServiceAccount.defaultComputeEmail(project.projectNumber)
    )
      fail(`Service account not found: ${r.serviceAccount}`);
    if (
      checkWrites &&
      (!old || old.serviceAccount !== r.serviceAccount || !same(sorted(old.scopes), r.scopes))
    )
      TfAccess.check(
        world,
        r,
        "iam.serviceAccounts.actAs",
        Option.isSome(sa)
          ? { type: "service-account", id: r.serviceAccount }
          : { type: "project", id: r.project },
      );
  }
  const machine = unwrap(MachineType.parse(r.machineType), "Unknown machine type.");
  if (old) {
    const resize = old.machineType !== r.machineType;
    const account = old.serviceAccount !== r.serviceAccount || !same(sorted(old.scopes), r.scopes);
    if ((resize || account) && old.status !== "TERMINATED" && !r.allowStopping)
      fail(
        "Changing machine_type or service_account requires a stopped VM or allow_stopping_for_update = true.",
      );
    if ((resize || account) && old.status === "SUSPENDED")
      fail("Resume or stop the suspended VM before updating it.");
    if (checkWrites) {
      if (resize) TfAccess.check(world, r, "compute.instances.setMachineType");
      if (account) TfAccess.check(world, r, "compute.instances.setServiceAccount");
      if (!same(sorted(old.tags), r.tags)) TfAccess.check(world, r, "compute.instances.setTags");
      if (!same(old.metadata, r.metadata))
        TfAccess.check(world, r, "compute.instances.setMetadata");
      if ((resize || account) && old.status === "RUNNING")
        for (const permission of ["compute.instances.stop", "compute.instances.start"])
          TfAccess.check(world, r, permission);
    }
    return World.replaceInstance(world, {
      ...old,
      machineType: machine.name,
      tags: r.tags,
      metadata: r.metadata,
      serviceAccount: r.serviceAccount,
      scopes: r.scopes,
    });
  }
  const used = new Set(
    world.instances
      .filter((i) => i.projectId === r.project && Zone.region(i.zone) === Zone.region(zone))
      .flatMap((i) =>
        i.networkInterfaces.filter((n) => n.subnetwork === r.subnet).map((n) => n.networkIP),
      ),
  );
  const [base = "", prefix = "32"] = subnet.ipCidrRange.split("/");
  const start = base.split(".").reduce((a, b) => a * 256 + Number(b), 0);
  const capacity = 2 ** (32 - Number(prefix));
  const address = (ip: number) => [24, 16, 8, 0].map((shift) => (ip >>> shift) & 255).join(".");
  let host = 2;
  while (host < capacity - 2 && used.has(address(start + host))) host++;
  if (host >= capacity - 2) fail(`Subnetwork has no free addresses: ${r.subnet}`);
  const numbered = World.nextNumber(world);
  const instance = result(
    Instance.create({
      projectId: r.project,
      name: r.name,
      zone,
      machineType: machine.name,
      networkInterface: {
        network: r.network,
        subnetwork: r.subnet,
        networkIP: address(start + host),
        externalIP: r.externalIp
          ? ExternalIp.ephemeral(`34.84.${(numbered.number >> 8) % 256}.${numbered.number % 256}`)
          : ExternalIp.None,
      },
      image: TfResources.image(r.image),
      bootDisk: {
        sizeGb: r.diskSize,
        type: unwrap(BootDiskType.parse(r.diskType), "Unknown disk type."),
      },
      tags: r.tags,
      metadata: r.metadata,
      serviceAccount: r.serviceAccount,
      scopes: r.scopes,
      preemptible: false,
      provisioningModel: "STANDARD",
      creationTimestamp: now,
      sequence: numbered.number,
    }),
  );
  return { ...numbered.world, instances: [...numbered.world.instances, instance] };
};
export const TfResourceRuntime = {
  read,
  mutate(
    world: World,
    r: TfInstance | TfFirewall | TfBucket,
    action: TfChange["action"],
    checkWrites: boolean,
    now: string,
  ): World {
    if (checkWrites && !(r.type === "google_compute_instance" && action === "update"))
      TfAccess.resource(world, r, action);
    if (r.type === "google_storage_bucket") return mutateBucket(world, r, action, checkWrites, now);
    if (r.type === "google_compute_firewall") return mutateFirewall(world, r, action);
    return mutateInstance(world, r, action, checkWrites, now);
  },
} as const;
