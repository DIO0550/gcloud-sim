import { MachineType, type Region, Zone } from "@/engine/domains/catalog";
import { ResourceName } from "@/engine/domains/compute";
import type { TfFirewall, TfInstance } from "@/engine/domains/terraform/resources";
import type { JsonRecord } from "@/types/Json";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

/**
 * Cloud Marketplace と Infrastructure Manager。Marketplace の「デプロイ」は、製品の Terraform
 * ブループリントを Infrastructure Manager のデプロイメントとして適用する（本物と同じ仕組み）。
 * 教材では製品カタログを固定し、ブループリントが作るリソースも決め打ちにする。
 */

/** 製品の構成要素（概要ページの表）。 */
export type SolutionComponent = Readonly<{ name: string; role: string }>;

/** Marketplace の製品。`blueprint` が `none` の製品は一覧と概要だけで、デプロイはできない。 */
export type MarketplaceSolution = Readonly<{
  id: string;
  title: string;
  provider: string;
  summary: string;
  /** 検索で当たる語（小文字） */
  keywords: readonly string[];
  components: readonly SolutionComponent[];
  blueprint: Option<
    Readonly<{
      /** `--gcs-source` に渡すブループリントの置き場 */
      source: string;
      /** VM のブートイメージ（Terraform の `image` と同じ綴り） */
      image: string;
      /** 概要ページに出す OS の名前 */
      os: string;
    }>
  >;
}>;

const LampComponents: readonly SolutionComponent[] = [
  { name: "Linux", role: "オペレーティング システム" },
  { name: "Apache HTTP サーバー", role: "ウェブサーバー" },
  { name: "MySQL", role: "リレーショナル データベース" },
  { name: "PHP", role: "ウェブ アプリケーション フレームワーク" },
  { name: "phpMyAdmin", role: "PHP 管理ツール" },
];

/** 教材の製品カタログ。似た名前の LAMP を並べ、正しい 1 つを選ぶ練習にする。 */
const Solutions: readonly MarketplaceSolution[] = [
  {
    id: "lamp-stack-ubuntu",
    title: "LAMP Stack Server on Ubuntu",
    provider: "Cloud Infrastructure Services",
    summary:
      "Apache・MySQL・PHP・phpMyAdmin を入れた Ubuntu の VM を 1 台作る。HTTP / HTTPS のファイアウォール ルールも一緒に作れる。",
    keywords: ["lamp", "apache", "mysql", "php", "ubuntu", "linux", "web"],
    components: LampComponents,
    blueprint: Option.some({
      source: "gs://gcloud-sim-marketplace/lamp-stack-ubuntu/blueprint.tar.gz",
      image: "ubuntu-os-cloud/ubuntu-2404-lts-amd64",
      os: "Ubuntu 24.04 LTS",
    }),
  },
  {
    id: "lamp-stack-debian",
    title: "LAMP Stack on Debian",
    provider: "Sample Solutions",
    summary: "Debian ベースの LAMP。このシミュレータではデプロイできない（一覧と概要だけ）。",
    keywords: ["lamp", "apache", "mysql", "php", "debian", "linux", "web"],
    components: LampComponents,
    blueprint: Option.none,
  },
  {
    id: "lamp-stack-bundle",
    title: "LAMP Certified Bundle",
    provider: "Sample Solutions",
    summary: "LAMP に監視エージェントを足した構成。このシミュレータではデプロイできない。",
    keywords: ["lamp", "apache", "mysql", "php", "linux", "web"],
    components: LampComponents,
    blueprint: Option.none,
  },
  {
    id: "wordpress",
    title: "WordPress",
    provider: "Sample Solutions",
    summary: "WordPress を入れた VM。このシミュレータではデプロイできない。",
    keywords: ["wordpress", "cms", "php", "mysql", "web", "blog"],
    components: [
      { name: "WordPress", role: "CMS" },
      { name: "MySQL", role: "リレーショナル データベース" },
    ],
    blueprint: Option.none,
  },
  {
    id: "nginx",
    title: "Nginx Web Server",
    provider: "Sample Solutions",
    summary: "Nginx だけを入れた VM。このシミュレータではデプロイできない。",
    keywords: ["nginx", "web", "proxy", "linux"],
    components: [{ name: "Nginx", role: "ウェブサーバー" }],
    blueprint: Option.none,
  },
];

export const MarketplaceSolution = {
  all(): readonly MarketplaceSolution[] {
    return Solutions;
  },

  find(id: string): Option<MarketplaceSolution> {
    return Option.fromNullable(Solutions.find((s) => s.id === id));
  },

  /** `--gcs-source` の綴りからデプロイできる製品を引く。 */
  findBySource(source: string): Option<MarketplaceSolution> {
    return Option.fromNullable(
      Solutions.find((s) => Option.isSome(s.blueprint) && s.blueprint.value.source === source),
    );
  },

  /** デプロイできる製品のブループリントの置き場（エラーの案内に使う）。 */
  sources(): readonly string[] {
    return Solutions.flatMap((s) => (Option.isSome(s.blueprint) ? [s.blueprint.value.source] : []));
  },

  /**
   * 検索。語を空白で区切り、すべての語が名前・提供元・キーワードのどれかに含まれる製品を返す。
   * 空の検索語なら全件。
   */
  search(query: string): readonly MarketplaceSolution[] {
    const words = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w !== "");
    return Solutions.filter((s) => {
      const haystack = [s.title.toLowerCase(), s.provider.toLowerCase(), ...s.keywords];
      return words.every((w) => haystack.some((h) => h.includes(w)));
    });
  },
} as const;

/** ブループリントの入力（`--input-values`）。キーは本物の Click to Deploy と同じ綴り。 */
export const BlueprintInputs = {
  Zone: "zone",
  MachineType: "machine_type",
  Http: "enable_tcp_80",
  Https: "enable_tcp_443",
} as const;

const KnownInputs: readonly string[] = Object.values(BlueprintInputs);

/** デプロイメントが作ったリソース（describe と削除に使う）。 */
export type DeployedResource = Readonly<{
  type: "google_compute_instance" | "google_compute_firewall";
  name: string;
  /** VM のゾーン。ファイアウォールは `none` */
  zone: Option<string>;
}>;

/** Infrastructure Manager のデプロイメント。 */
export type InfraDeployment = Readonly<{
  projectId: string;
  name: string;
  location: Region;
  solution: string;
  source: string;
  /** `projects/PROJECT/serviceAccounts/EMAIL` */
  serviceAccount: string;
  inputs: Readonly<Record<string, string>>;
  resources: readonly DeployedResource[];
  createTime: string;
}>;

/** ブループリントを解いた結果。適用する Terraform リソースと、記録するリソース。 */
export type BlueprintPlan = Readonly<{
  instance: TfInstance;
  firewalls: readonly TfFirewall[];
  resources: readonly DeployedResource[];
}>;

const truthy = (value: string | undefined, fallback: boolean): Result<boolean, string> => {
  if (value === undefined) return Result.ok(fallback);
  if (value === "true") return Result.ok(true);
  if (value === "false") return Result.ok(false);
  return Result.err(`Input value must be true or false: ${value}`);
};

export const InfraDeployment = {
  /** デプロイメントの完全な名前。 */
  path(projectId: string, location: string, name: string): string {
    return `projects/${projectId}/locations/${location}/deployments/${name}`;
  },

  /** `projects/P/locations/L/deployments/D` を分解する。短い ID ならそのまま `none`。 */
  parsePath(
    value: string,
  ): Option<Readonly<{ projectId: string; location: string; name: string }>> {
    const match = /^projects\/([^/]+)\/locations\/([^/]+)\/deployments\/([^/]+)$/.exec(value);
    if (match === null) return Option.none;
    const [, projectId = "", location = "", name = ""] = match;
    return Option.some({ projectId, location, name });
  },

  /** `--service-account` の `projects/P/serviceAccounts/EMAIL` からメールを取り出す。 */
  serviceAccountEmail(value: string): Option<string> {
    const match = /^projects\/[^/]+\/serviceAccounts\/([^/]+@[^/]+)$/.exec(value);
    return match?.[1] === undefined ? Option.none : Option.some(match[1]);
  },

  /** VM の名前（本物の Click to Deploy と同じく `{デプロイメント名}-vm`）。 */
  vmName(deployment: string): string {
    return `${deployment}-vm`;
  },

  /** VM に付けるネットワーク タグ。ファイアウォール ルールはこのタグを対象にする。 */
  tag(deployment: string): string {
    return `${deployment}-deployment`;
  },

  /**
   * ブループリントと入力から、作るリソースを決める。
   *
   * @returns VM 1 台と、有効にしたポートのファイアウォール ルール。入力が不正なら理由
   */
  plan(
    seed: Readonly<{
      projectId: string;
      name: string;
      location: Region;
      solution: MarketplaceSolution;
      inputs: Readonly<Record<string, string>>;
      vmServiceAccount: string;
    }>,
  ): Result<BlueprintPlan, string> {
    if (!Option.isSome(seed.solution.blueprint)) {
      return Result.err(`Solution ${seed.solution.title} has no deployable blueprint.`);
    }
    const unknown = Object.keys(seed.inputs).filter((k) => !KnownInputs.includes(k));
    if (unknown.length > 0) {
      return Result.err(
        `Unsupported input variable(s): ${unknown.join(", ")}. Expected: ${KnownInputs.join(", ")}.`,
      );
    }
    const name = ResourceName.parse(seed.name);
    if (!Result.isOk(name)) return name;
    const rawZone = seed.inputs[BlueprintInputs.Zone];
    if (rawZone === undefined) return Result.err("Input value 'zone' is required.");
    const zone = Zone.parse(rawZone);
    if (!Option.isSome(zone)) return Result.err(`Unknown zone: ${rawZone}`);
    if (Zone.region(zone.value) !== seed.location) {
      return Result.err(
        `Zone ${zone.value} is not in the deployment location ${seed.location}. Choose a zone in ${seed.location}.`,
      );
    }
    const machine = seed.inputs[BlueprintInputs.MachineType] ?? "e2-medium";
    if (!Option.isSome(MachineType.parse(machine))) {
      return Result.err(`Unknown machine type: ${machine}`);
    }
    const http = truthy(seed.inputs[BlueprintInputs.Http], true);
    if (!Result.isOk(http)) return http;
    const https = truthy(seed.inputs[BlueprintInputs.Https], true);
    if (!Result.isOk(https)) return https;
    const tag = InfraDeployment.tag(seed.name);
    const vm = InfraDeployment.vmName(seed.name);
    const instance: TfInstance = {
      type: "google_compute_instance",
      address: "google_compute_instance.instance",
      project: seed.projectId,
      name: vm,
      zone: zone.value,
      machineType: machine,
      network: "default",
      subnet: "default",
      image: seed.solution.blueprint.value.image,
      diskSize: 10,
      diskType: "pd-balanced",
      externalIp: true,
      tags: [tag],
      metadata: { "google-monitoring-enable": "0", "google-logging-enable": "0" },
      serviceAccount: seed.vmServiceAccount,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
      allowStopping: false,
    };
    const firewall = (port: number): TfFirewall => ({
      type: "google_compute_firewall",
      address: `google_compute_firewall.tcp_${port}[0]`,
      project: seed.projectId,
      name: `${seed.name}-tcp-${port}`,
      network: "default",
      direction: "INGRESS",
      priority: 1000,
      sourceRanges: ["0.0.0.0/0"],
      destinationRanges: [],
      targetTags: [tag],
      allowed: [{ protocol: "tcp", ports: [String(port)] }],
      denied: [],
      disabled: false,
    });
    const firewalls = [
      ...(http.value ? [firewall(80)] : []),
      ...(https.value ? [firewall(443)] : []),
    ];
    return Result.ok({
      instance,
      firewalls,
      resources: [
        { type: "google_compute_instance", name: vm, zone: Option.some(zone.value) },
        ...firewalls.map((f) => ({
          type: "google_compute_firewall" as const,
          name: f.name,
          zone: Option.none,
        })),
      ],
    });
  },

  /** `describe` / `--format=json` に出す API 表現。 */
  toRecord(deployment: InfraDeployment): JsonRecord {
    const path = InfraDeployment.path(deployment.projectId, deployment.location, deployment.name);
    return {
      name: path,
      createTime: deployment.createTime,
      updateTime: deployment.createTime,
      state: "ACTIVE",
      latestRevision: `${path}/revisions/r-0`,
      serviceAccount: deployment.serviceAccount,
      labels: { "goog-solutions-console-deployment-name": deployment.name },
      terraformBlueprint: {
        gcsSource: deployment.source,
        inputValues: Object.fromEntries(
          Object.entries(deployment.inputs).map(([k, v]) => [k, { inputValue: v }]),
        ),
      },
    };
  },
} as const;
