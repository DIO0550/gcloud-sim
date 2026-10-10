import {
  BucketLocation,
  MachineType,
  PublicImage,
  StorageClass,
  Zone,
} from "@/engine/domains/catalog";
import { BootDiskType, type ProtocolRule, ResourceName } from "@/engine/domains/compute";
import { BucketName } from "@/engine/domains/storage";
import { Decoder as D, type Decoder } from "@/utils/Decoder";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

type Identity = Readonly<{ address: string; project: string; name: string }>;
export type TfNetwork = Identity &
  Readonly<{
    region: string;
    network: string;
    cidr: string;
    privateAccess: boolean;
    autoMode?: boolean;
  }> &
  (Readonly<{ type: "google_compute_network" }> | Readonly<{ type: "google_compute_subnetwork" }>);
export type TfInstance = Identity &
  Readonly<{
    type: "google_compute_instance";
    zone: string;
    machineType: string;
    network: string;
    subnet: string;
    image: string;
    diskSize: number;
    diskType: string;
    externalIp: boolean;
    tags: readonly string[];
    metadata: Readonly<Record<string, string>>;
    serviceAccount: string;
    scopes: readonly string[];
    allowStopping: boolean;
  }>;
export type TfFirewall = Identity &
  Readonly<{
    type: "google_compute_firewall";
    network: string;
    direction: "INGRESS" | "EGRESS";
    priority: number;
    sourceRanges: readonly string[];
    destinationRanges: readonly string[];
    targetTags: readonly string[];
    allowed: readonly ProtocolRule[];
    denied: readonly ProtocolRule[];
    disabled: boolean;
  }>;
export type TfBucket = Identity &
  Readonly<{
    type: "google_storage_bucket";
    location: string;
    storageClass: string;
    uniformAccess: boolean;
    publicAccessPrevention: boolean;
    versioning: boolean;
    forceDestroy: boolean;
  }>;
export type TfResource = TfNetwork | TfInstance | TfFirewall | TfBucket;
const identity = { address: D.string, project: D.string, name: D.string };
const networkBase = D.object<
  Identity &
    Readonly<{
      type: "google_compute_network" | "google_compute_subnetwork";
      region: string;
      network: string;
      cidr: string;
      privateAccess: boolean;
    }>
>({
  ...identity,
  type: D.literal(["google_compute_network", "google_compute_subnetwork"]),
  region: D.string,
  network: D.string,
  cidr: D.string,
  privateAccess: D.boolean,
});
const network: Decoder<TfNetwork> = (value, path) =>
  Result.flatMap(networkBase(value, path), (resource) => {
    if (typeof value !== "object" || value === null || !("autoMode" in value)) {
      return Result.ok(resource);
    }
    return Result.flatMap(D.boolean(value.autoMode, `${path}.autoMode`), (autoMode) => {
      if (resource.type !== "google_compute_network" && autoMode) {
        return Result.err("Only networks can use auto subnet mode.");
      }
      if (autoMode) {
        return Result.ok({ ...resource, autoMode });
      }
      return Result.ok(resource);
    });
  });
const instance = D.object<TfInstance>({
  ...identity,
  type: D.literal(["google_compute_instance"]),
  zone: D.string,
  machineType: D.string,
  network: D.string,
  subnet: D.string,
  image: D.string,
  diskSize: D.number,
  diskType: D.string,
  externalIp: D.boolean,
  tags: D.array(D.string),
  metadata: D.record(D.string),
  serviceAccount: D.string,
  scopes: D.array(D.string),
  allowStopping: D.boolean,
});
const rule = D.object<ProtocolRule>({ protocol: D.string, ports: D.array(D.string) });
const firewall = D.object<TfFirewall>({
  ...identity,
  type: D.literal(["google_compute_firewall"]),
  network: D.string,
  direction: D.literal(["INGRESS", "EGRESS"]),
  priority: D.number,
  sourceRanges: D.array(D.string),
  destinationRanges: D.array(D.string),
  targetTags: D.array(D.string),
  allowed: D.array(rule),
  denied: D.array(rule),
  disabled: D.boolean,
});
const bucket = D.object<TfBucket>({
  ...identity,
  type: D.literal(["google_storage_bucket"]),
  location: D.string,
  storageClass: D.string,
  uniformAccess: D.boolean,
  publicAccessPrevention: D.boolean,
  versioning: D.boolean,
  forceDestroy: D.boolean,
});
const decoder: Decoder<TfResource> = (value, path) => {
  if (typeof value !== "object" || value === null || !("type" in value))
    return Result.err(`${path}: resource type required.`);
  if (value.type === "google_compute_instance") return instance(value, path);
  if (value.type === "google_compute_firewall") return firewall(value, path);
  if (value.type === "google_storage_bucket") return bucket(value, path);
  return network(value, path);
};
const fail = (message: string): never => {
  throw new Error(message);
};
const ipv4 = (cidr: string): boolean => {
  if (!/^\d+\.\d+\.\d+\.\d+\/\d+$/.test(cidr)) return false;
  const [ip = "", prefix = ""] = cidr.split("/");
  return Number(prefix) <= 32 && ip.split(".").every((v) => Number(v) <= 255);
};
export const TfResources = {
  decoder,
  equal(a: unknown, b: unknown): boolean {
    const stable = (value: unknown): string | undefined =>
      JSON.stringify(value, (_key, item: unknown) =>
        item !== null && typeof item === "object" && !Array.isArray(item)
          ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
          : item,
      );
    return stable(a) === stable(b);
  },
  image(value: string): PublicImage {
    const path = value.replace("https://www.googleapis.com/compute/v1/", "");
    return (
      PublicImage.all().find((i) =>
        [
          `${i.project}/${i.family}`,
          `${i.project}/${i.name}`,
          `projects/${i.project}/global/images/${i.name}`,
          `projects/${i.project}/global/images/family/${i.family}`,
        ].includes(path),
      ) ?? fail(`Unknown public image: ${value}`)
    );
  },
  validate(r: TfResource): void {
    const name =
      r.type === "google_storage_bucket" ? BucketName.parse(r.name) : ResourceName.parse(r.name);
    if (!Result.isOk(name)) fail(name.error);
    if (!/^[a-z][a-z0-9-]+$/.test(r.project)) fail(`Invalid project: ${r.project}`);
    if (r.type === "google_compute_instance") {
      if (!Option.isSome(Zone.parse(r.zone))) fail(`Unknown zone: ${r.zone}`);
      if (!Option.isSome(MachineType.parse(r.machineType)))
        fail(`Unknown machine type: ${r.machineType}`);
      TfResources.image(r.image);
      if (!Number.isInteger(r.diskSize) || r.diskSize < 10 || r.diskSize > 65536)
        fail("Disk size must be an integer from 10 to 65536 GB.");
      if (!Option.isSome(BootDiskType.parse(r.diskType))) fail(`Unknown disk type: ${r.diskType}`);
      if (r.tags.length > 64 || r.tags.some((t) => !Result.isOk(ResourceName.parse(t))))
        fail("Invalid instance tags.");
      if (Object.keys(r.metadata).length > 64) fail("At most 64 metadata entries are supported.");
      if (r.serviceAccount && !/^[^@\s]+@[^@\s]+\.gserviceaccount\.com$/.test(r.serviceAccount))
        fail("Invalid service account email.");
      if (
        r.scopes.length > 32 ||
        r.scopes.some((s) => !s.startsWith("https://www.googleapis.com/auth/"))
      )
        fail("Invalid service account scopes.");
      for (const n of [r.network, r.subnet])
        if (!Result.isOk(ResourceName.parse(n))) fail(`Invalid network or subnet: ${n}`);
      return;
    }
    if (r.type === "google_storage_bucket") {
      if (!Option.isSome(BucketLocation.parse(r.location)))
        fail(`Unknown bucket location: ${r.location}`);
      if (!Option.isSome(StorageClass.parse(r.storageClass)))
        fail(`Unknown storage class: ${r.storageClass}`);
      return;
    }
    if (r.type !== "google_compute_firewall") return;
    if (!Result.isOk(ResourceName.parse(r.network))) fail("Invalid firewall network.");
    if (!Number.isInteger(r.priority) || r.priority < 0 || r.priority > 65535)
      fail("Invalid firewall priority.");
    if (r.allowed.length > 0 === r.denied.length > 0)
      fail("Exactly one of allow or deny is required.");
    if (r.direction === "INGRESS" && (!r.sourceRanges.length || r.destinationRanges.length))
      fail("INGRESS requires source_ranges; destination_ranges is unsupported in this subset.");
    if (r.direction === "EGRESS" && r.sourceRanges.length) fail("EGRESS cannot use source_ranges.");
    if (
      [...r.sourceRanges, ...r.destinationRanges].length > 64 ||
      [...r.sourceRanges, ...r.destinationRanges].some((v) => !ipv4(v))
    )
      fail("Invalid firewall IPv4 CIDR.");
    if (r.targetTags.length > 64 || r.targetTags.some((t) => !Result.isOk(ResourceName.parse(t))))
      fail("Invalid target_tags.");
    if (r.allowed.length + r.denied.length > 64) fail("Too many firewall rules.");
    for (const rule of [...r.allowed, ...r.denied]) {
      if (!/^(tcp|udp|icmp|esp|ah|sctp|ipip|all)$/.test(rule.protocol))
        fail("Unsupported firewall protocol.");
      if (rule.ports.length && !["tcp", "udp"].includes(rule.protocol))
        fail("Ports require tcp or udp.");
      if (
        rule.ports.length > 64 ||
        rule.ports.some((p) => {
          if (!/^\d+(-\d+)?$/.test(p)) return true;
          const [from = 0, to = from] = p.split("-").map(Number);
          return from < 0 || to > 65535 || from > to;
        })
      )
        fail("Invalid firewall port range.");
    }
  },
  id(r: TfResource): string {
    if (r.type === "google_storage_bucket") return r.name;
    if (r.type === "google_compute_instance")
      return `projects/${r.project}/zones/${r.zone}/instances/${r.name}`;
    if (r.type === "google_compute_firewall")
      return `projects/${r.project}/global/firewalls/${r.name}`;
    if (r.type === "google_compute_network")
      return `projects/${r.project}/global/networks/${r.name}`;
    return `projects/${r.project}/regions/${r.region}/subnetworks/${r.name}`;
  },
  record(r: TfResource) {
    const base = { address: r.address, id: TfResources.id(r), project: r.project, name: r.name };
    if (r.type === "google_storage_bucket")
      return {
        ...base,
        location: r.location,
        storage_class: r.storageClass,
        uniform_bucket_level_access: r.uniformAccess,
        public_access_prevention: r.publicAccessPrevention ? "enforced" : "inherited",
        versioning: { enabled: r.versioning },
        force_destroy: r.forceDestroy,
        url: `gs://${r.name}`,
      };
    if (r.type === "google_compute_firewall")
      return {
        ...base,
        network: r.network,
        direction: r.direction,
        priority: r.priority,
        source_ranges: r.sourceRanges,
        destination_ranges: r.destinationRanges,
        target_tags: r.targetTags,
        allow: r.allowed,
        deny: r.denied,
        disabled: r.disabled,
      };
    if (r.type === "google_compute_instance")
      return {
        ...base,
        zone: r.zone,
        machine_type: r.machineType,
        tags: r.tags,
        metadata: r.metadata,
        boot_disk: { initialize_params: { image: r.image, size: r.diskSize, type: r.diskType } },
        network_interface: {
          network: r.network,
          subnetwork: r.subnet,
          access_config: r.externalIp ? [{}] : [],
        },
        service_account: { email: r.serviceAccount, scopes: r.scopes },
        allow_stopping_for_update: r.allowStopping,
      };
    if (r.type === "google_compute_network")
      return { ...base, auto_create_subnetworks: r.autoMode === true };
    return {
      ...base,
      region: r.region,
      network: r.network,
      ip_cidr_range: r.cidr,
      private_ip_google_access: r.privateAccess,
    };
  },
} as const;
