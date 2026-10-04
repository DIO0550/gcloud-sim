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
  region(zone: Zone): Region {
    return zone.slice(0, zone.lastIndexOf("-")) as Region;
  },

  all(): readonly Zone[] {
    return AllZones;
  },
} as const;

/**
 * ゾーンの API パス（`.../projects/P/zones/Z`）。zone を持つリソースとオペレーションが共有する。
 *
 * @param projectId プロジェクト
 * @param zone ゾーン
 * @returns Compute API の selfLink の形
 */
export const ZoneLinkFor = (projectId: string, zone: Zone): string =>
  `https://www.googleapis.com/compute/v1/projects/${projectId}/zones/${zone}`;

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
  { name: "cloudbuild.googleapis.com", title: "Cloud Build API", billingRequired: true },
  {
    name: "artifactregistry.googleapis.com",
    title: "Artifact Registry API",
    billingRequired: true,
  },
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
  {
    name: "cloudkms.googleapis.com",
    title: "Cloud Key Management Service (KMS) API",
    billingRequired: true,
  },
  { name: "dns.googleapis.com", title: "Cloud DNS API", billingRequired: true },
  {
    name: "deploymentmanager.googleapis.com",
    title: "Cloud Deployment Manager V2 API",
    billingRequired: true,
  },
] as const;

export type ApiName = (typeof ApiServices)[number]["name"];

export type ApiService = Readonly<{
  name: ApiName;
  title: string;
  /** 有効化に請求アカウントのリンクが要るか（E-016）。 */
  billingRequired: boolean;
}>;

/** 名前で引く表。キーは `ApiServices` の全要素から作るので、`ApiName` のどれでも必ず引ける。 */
const ApiServiceByName = Object.fromEntries(ApiServices.map((api) => [api.name, api])) as Readonly<
  Record<ApiName, ApiService>
>;

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

  /**
   * 閉じた名前からその定義を引く。`ApiName` はカタログから導出した型なので、必ず見つかる。
   *
   * @param name カタログの API 名
   * @returns その API の定義
   */
  find(name: ApiName): ApiService {
    return ApiServiceByName[name];
  },

  all(): readonly ApiService[] {
    return ApiServices;
  },
} as const;

/** `gcloud compute images list` に出す公開イメージ。 */
export type PublicImage = Readonly<{ name: string; project: string; family: string }>;

/** `--image-family` / `--image-project` を省いたときの既定（本物の gcloud と同じ Debian）。 */
export const DefaultImage: PublicImage = {
  name: "debian-12-bookworm-v20260901",
  project: "debian-cloud",
  family: "debian-12",
};

const PublicImages: readonly PublicImage[] = [
  DefaultImage,
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

export const FunctionRuntimes = {
  Nodejs20: "nodejs20",
  Nodejs22: "nodejs22",
  Python312: "python312",
  Python313: "python313",
  Go122: "go122",
  Java21: "java21",
} as const;
export type FunctionRuntime = ValueOf<typeof FunctionRuntimes>;

export const FunctionRuntime = {
  /**
   * `--runtime` の綴りを閉じた型にする。
   *
   * @param value ユーザーが打った綴り
   * @returns 収録しているランタイムならそれ。無ければ `none`
   */
  parse(value: string): Option<FunctionRuntime> {
    return Option.fromNullable(Object.values(FunctionRuntimes).find((r) => r === value));
  },
} as const;

export const SqlDatabaseVersions = {
  Postgres15: "POSTGRES_15",
  Postgres16: "POSTGRES_16",
  Mysql80: "MYSQL_8_0",
  SqlServer2022Standard: "SQLSERVER_2022_STANDARD",
} as const;
export type SqlDatabaseVersion = ValueOf<typeof SqlDatabaseVersions>;

export const SqlDatabaseVersion = {
  /**
   * `--database-version` の綴りを閉じた型にする。
   *
   * @param value ユーザーが打った綴り
   * @returns 収録している版ならそれ。無ければ `none`
   */
  parse(value: string): Option<SqlDatabaseVersion> {
    return Option.fromNullable(Object.values(SqlDatabaseVersions).find((v) => v === value));
  },
} as const;

export const SqlTiers = {
  F1Micro: "db-f1-micro",
  G1Small: "db-g1-small",
  Custom1_3840: "db-custom-1-3840",
  Custom2_7680: "db-custom-2-7680",
} as const;
export type SqlTier = ValueOf<typeof SqlTiers>;

export const SqlTier = {
  /**
   * `--tier` の綴りを閉じた型にする。
   *
   * @param value ユーザーが打った綴り
   * @returns 収録しているティアならそれ。無ければ `none`
   */
  parse(value: string): Option<SqlTier> {
    return Option.fromNullable(Object.values(SqlTiers).find((t) => t === value));
  },
} as const;

/** `gcloud version` / `components list` が出す SDK の版と収録コンポーネント。 */
export const CliVersion = "540.0.0";

export const CliComponents = [
  { id: "gcloud", name: "Google Cloud CLI Core Libraries", status: "Installed", size: "20.5 MiB" },
  { id: "core", name: "Google Cloud CLI Core Libraries", status: "Installed", size: "20.5 MiB" },
  { id: "gsutil", name: "Cloud Storage Command Line Tool", status: "Installed", size: "11.3 MiB" },
  { id: "bq", name: "BigQuery Command Line Tool", status: "Installed", size: "1.7 MiB" },
  { id: "kubectl", name: "kubectl", status: "Not Installed", size: "< 1 MiB" },
  {
    id: "gke-gcloud-auth-plugin",
    name: "GKE gcloud auth plugin",
    status: "Not Installed",
    size: "8.6 MiB",
  },
  {
    id: "app-engine-python",
    name: "App Engine Python Extensions",
    status: "Not Installed",
    size: "4.8 MiB",
  },
  { id: "beta", name: "gcloud Beta Commands", status: "Not Installed", size: "< 1 MiB" },
  { id: "alpha", name: "gcloud Alpha Commands", status: "Not Installed", size: "< 1 MiB" },
] as const;

export type CliComponentId = (typeof CliComponents)[number]["id"];

export type CliComponent = Readonly<{
  id: CliComponentId;
  name: string;
  status: "Installed" | "Not Installed";
  size: string;
}>;

export const CliComponent = {
  /**
   * コンポーネント id の綴りを確かめる。
   *
   * @param value `kubectl` のような綴り
   * @returns 収録していればその定義。無ければ `none`
   */
  parse(value: string): Option<CliComponent> {
    return Option.fromNullable(CliComponents.find((c) => c.id === value));
  },

  all(): readonly CliComponent[] {
    return CliComponents;
  },
} as const;
