import type { ValueOf } from "@/types/ValueOf";
import { Option } from "@/utils/Option";

/**
 * エミュレータが知っているリージョン・ゾーン・マシンタイプ・ロケーション・API・イメージの語彙。
 * 本物の一部だけを収録する（DJ-005: 収録外は「存在しない」として E-005 にする）。
 * どの型も `parse(綴り)` で「カタログにあるか」を確かめて閉じた型にする。
 */

export const Regions = {
  AsiaNortheast1: "asia-northeast1",
  AsiaNortheast2: "asia-northeast2",
  UsCentral1: "us-central1",
  UsEast1: "us-east1",
  EuropeWest1: "europe-west1",
} as const;
export type Region = ValueOf<typeof Regions>;

const ZoneSuffixes = ["a", "b", "c"] as const;

export type Zone = `${Region}-${(typeof ZoneSuffixes)[number]}`;

const AllRegions: readonly Region[] = Object.values(Regions);
const AllZones: readonly Zone[] = AllRegions.flatMap((region) =>
  ZoneSuffixes.map((suffix): Zone => `${region}-${suffix}`),
);

export const Zone = {
  /**
   * 綴りがゾーンカタログにあるか確かめる。
   *
   * @param value ユーザーが打った綴り
   * @returns カタログにあればそのゾーン。無ければ `none`
   */
  parse(value: string): Option<Zone> {
    return Option.fromNullable(AllZones.find((zone) => zone === value));
  },

  /**
   * ゾーンが属するリージョン。
   * `Zone` はテンプレートリテラル型で `Region` を含んでいるが TS は切り出せないので、
   * 末尾の `-a` 等を落とした綴りを `Region` として返す（`as` はここ 1 箇所）。
   *
   * @param zone カタログにあるゾーン
   * @returns 末尾の `-a` 等を落としたリージョン
   */
  regionOf(zone: Zone): Region {
    return zone.slice(0, zone.lastIndexOf("-")) as Region;
  },

  all(): readonly Zone[] {
    return AllZones;
  },
} as const;

export const Region = {
  /**
   * 綴りがリージョンカタログにあるか確かめる。
   *
   * @param value ユーザーが打った綴り
   * @returns カタログにあればそのリージョン。無ければ `none`
   */
  parse(value: string): Option<Region> {
    return Option.fromNullable(AllRegions.find((region) => region === value));
  },

  all(): readonly Region[] {
    return AllRegions;
  },
} as const;

const MachineTypes = [
  {
    name: "e2-micro",
    guestCpus: 2,
    memoryMb: 1024,
    description: "Efficient Instance, 2 vCPUs, 1 GB RAM",
  },
  {
    name: "e2-small",
    guestCpus: 2,
    memoryMb: 2048,
    description: "Efficient Instance, 2 vCPUs, 2 GB RAM",
  },
  {
    name: "e2-medium",
    guestCpus: 2,
    memoryMb: 4096,
    description: "Efficient Instance, 2 vCPUs, 4 GB RAM",
  },
  {
    name: "e2-standard-2",
    guestCpus: 2,
    memoryMb: 8192,
    description: "Efficient Instance, 2 vCPUs, 8 GB RAM",
  },
  {
    name: "e2-standard-4",
    guestCpus: 4,
    memoryMb: 16384,
    description: "Efficient Instance, 4 vCPUs, 16 GB RAM",
  },
  { name: "n2-standard-2", guestCpus: 2, memoryMb: 8192, description: "2 vCPUs, 8 GB RAM" },
  { name: "n2-standard-4", guestCpus: 4, memoryMb: 16384, description: "4 vCPUs, 16 GB RAM" },
  { name: "n2d-standard-2", guestCpus: 2, memoryMb: 8192, description: "2 vCPUs, 8 GB RAM" },
  { name: "c3-standard-4", guestCpus: 4, memoryMb: 16384, description: "4 vCPUs, 16 GB RAM" },
  { name: "n1-standard-1", guestCpus: 1, memoryMb: 3840, description: "1 vCPU, 3.75 GB RAM" },
] as const;

export type MachineTypeName = (typeof MachineTypes)[number]["name"];

export type MachineType = Readonly<{
  name: MachineTypeName;
  guestCpus: number;
  memoryMb: number;
  description: string;
}>;

/** `--machine-type` を省いたときの既定（UC-003）。 */
export const DefaultMachineType: MachineTypeName = "e2-medium";

export const MachineType = {
  /**
   * 綴りがマシンタイプカタログにあるか確かめる。
   *
   * @param value ユーザーが打った綴り
   * @returns カタログにあればその定義。無ければ `none`
   */
  parse(value: string): Option<MachineType> {
    return Option.fromNullable(MachineTypes.find((type) => type.name === value));
  },

  all(): readonly MachineType[] {
    return MachineTypes;
  },
} as const;

export const StorageClasses = {
  Standard: "STANDARD",
  Nearline: "NEARLINE",
  Coldline: "COLDLINE",
  Archive: "ARCHIVE",
} as const;
export type StorageClass = ValueOf<typeof StorageClasses>;

export const StorageClass = {
  /**
   * 綴りがストレージクラスか確かめる。大文字小文字は区別しない。
   *
   * @param value ユーザーが打った綴り
   * @returns 一致すればそのクラス。無ければ `none`
   */
  parse(value: string): Option<StorageClass> {
    const upper = value.toUpperCase();
    return Option.fromNullable(Object.values(StorageClasses).find((c) => c === upper));
  },
} as const;

const MultiRegionLocations = ["ASIA", "US", "EU", "ASIA1", "NAM4", "EUR4"] as const;

/** バケットのロケーション。リージョン（大文字）と、マルチリージョン・デュアルリージョン。 */
export type BucketLocation = Uppercase<Region> | (typeof MultiRegionLocations)[number];

const BucketLocations: readonly BucketLocation[] = [
  ...AllRegions.map((region): BucketLocation => region.toUpperCase() as Uppercase<Region>),
  ...MultiRegionLocations,
];

export const BucketLocation = {
  /**
   * 綴りがロケーションカタログにあるか確かめる。大文字小文字は区別しない。
   *
   * @param value ユーザーが打った綴り
   * @returns カタログにあれば大文字に正規化したロケーション。無ければ `none`
   */
  parse(value: string): Option<BucketLocation> {
    const upper = value.toUpperCase();
    return Option.fromNullable(BucketLocations.find((location) => location === upper));
  },
} as const;

const ApiServices = [
  { name: "compute.googleapis.com", title: "Compute Engine API", billingRequired: true },
  { name: "container.googleapis.com", title: "Kubernetes Engine API", billingRequired: true },
  { name: "run.googleapis.com", title: "Cloud Run Admin API", billingRequired: true },
  { name: "storage.googleapis.com", title: "Cloud Storage API", billingRequired: false },
  {
    name: "iam.googleapis.com",
    title: "Identity and Access Management (IAM) API",
    billingRequired: false,
  },
  {
    name: "cloudresourcemanager.googleapis.com",
    title: "Cloud Resource Manager API",
    billingRequired: false,
  },
  { name: "cloudbilling.googleapis.com", title: "Cloud Billing API", billingRequired: false },
  { name: "logging.googleapis.com", title: "Cloud Logging API", billingRequired: false },
  { name: "monitoring.googleapis.com", title: "Cloud Monitoring API", billingRequired: false },
  { name: "sqladmin.googleapis.com", title: "Cloud SQL Admin API", billingRequired: true },
  { name: "cloudfunctions.googleapis.com", title: "Cloud Functions API", billingRequired: true },
  { name: "appengine.googleapis.com", title: "App Engine Admin API", billingRequired: true },
  { name: "pubsub.googleapis.com", title: "Cloud Pub/Sub API", billingRequired: false },
  { name: "bigquery.googleapis.com", title: "BigQuery API", billingRequired: false },
] as const;

export type ApiName = (typeof ApiServices)[number]["name"];

export type ApiService = Readonly<{
  name: ApiName;
  title: string;
  /** 有効化に請求アカウントのリンクが要るか（E-016）。 */
  billingRequired: boolean;
}>;

export const ApiService = {
  /**
   * 綴りが API カタログにあるか確かめる。
   *
   * @param value `compute.googleapis.com` のような綴り
   * @returns カタログにあればその定義。無ければ `none`
   */
  parse(value: string): Option<ApiService> {
    return Option.fromNullable(ApiServices.find((api) => api.name === value));
  },

  all(): readonly ApiService[] {
    return ApiServices;
  },
} as const;

/** `gcloud compute images list` に出す公開イメージ。 */
export type PublicImage = Readonly<{ name: string; project: string; family: string }>;

const PublicImages: readonly PublicImage[] = [
  { name: "debian-12-bookworm-v20260901", project: "debian-cloud", family: "debian-12" },
  { name: "debian-11-bullseye-v20260901", project: "debian-cloud", family: "debian-11" },
  {
    name: "ubuntu-2404-noble-amd64-v20260901",
    project: "ubuntu-os-cloud",
    family: "ubuntu-2404-lts-amd64",
  },
  { name: "ubuntu-2204-jammy-v20260901", project: "ubuntu-os-cloud", family: "ubuntu-2204-lts" },
  { name: "cos-117-18613-0-0", project: "cos-cloud", family: "cos-117-lts" },
  { name: "rocky-linux-9-v20260901", project: "rocky-linux-cloud", family: "rocky-linux-9" },
  { name: "windows-server-2022-dc-v20260901", project: "windows-cloud", family: "windows-2022" },
];

/** `--image-family` / `--image-project` を省いたときの既定（本物の gcloud と同じ Debian）。 */
export const DefaultImage: PublicImage = PublicImages[0] as PublicImage;

export const PublicImage = {
  /**
   * ファミリーとプロジェクトからイメージを引く。
   *
   * @param family `debian-12` のようなイメージファミリー
   * @param project `debian-cloud` のようなイメージプロジェクト
   * @returns 一致するイメージ。無ければ `none`
   */
  parseFamily(family: string, project: string): Option<PublicImage> {
    return Option.fromNullable(
      PublicImages.find((image) => image.family === family && image.project === project),
    );
  },

  all(): readonly PublicImage[] {
    return PublicImages;
  },
} as const;
