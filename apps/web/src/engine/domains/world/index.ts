import type { Budget } from "@/engine/domains/billing-budget";
import { type ApiName, type Zone, Zone as ZoneCatalog } from "@/engine/domains/catalog";
import type {
  Disk,
  DiskSnapshot,
  FirewallRule,
  Instance,
  Network,
  ProjectMetadata,
  Subnet,
} from "@/engine/domains/compute";
import type { Address, NetworkPeering, Router } from "@/engine/domains/compute-networking";
import { ContainerLab } from "@/engine/domains/container-lab";
import type { OsLoginSshKey, ServiceAccountKey } from "@/engine/domains/credentials";
import type {
  PubsubSubscription,
  PubsubTopic,
  SqlBackup,
  SqlInstance,
} from "@/engine/domains/data";
import type { DmDeployment } from "@/engine/domains/deployment-manager";
import type { DnsManagedZone } from "@/engine/domains/dns";
import { GcloudConfig } from "@/engine/domains/gcloud-config";
import { IamPolicy, type RoleName } from "@/engine/domains/iam-policy";
import type { InstanceTemplate, ManagedInstanceGroup } from "@/engine/domains/instance-groups";
import type { KmsKeyRing } from "@/engine/domains/kms";
import { KubeConfig, KubeRuntime } from "@/engine/domains/kube-config";
import { KubeContainer } from "@/engine/domains/kube-container";
import { KubeContext } from "@/engine/domains/kube-context";
import { KubeHpa } from "@/engine/domains/kube-hpa";
import { KubeLabels } from "@/engine/domains/kube-labels";
import { KubeLiveness } from "@/engine/domains/kube-liveness";
import { KubeManifest } from "@/engine/domains/kube-manifest";
import { KubeNamespace } from "@/engine/domains/kube-namespace";
import { KubeNetworkPolicy } from "@/engine/domains/kube-network-policy";
import { KubeReadiness } from "@/engine/domains/kube-readiness";
import { KubeStartup } from "@/engine/domains/kube-startup";
import {
  type KubePv,
  type KubePvc,
  KubeStorage,
  type KubeStorageClass,
} from "@/engine/domains/kube-storage";
import { KubeDeployment, type KubeService } from "@/engine/domains/kubernetes";
import {
  type BackendService,
  type ForwardingRule,
  type HealthCheck,
  LbScope,
} from "@/engine/domains/load-balancing";
import { type CloudRunService, type GkeCluster, NodePool } from "@/engine/domains/managed-services";
import { MissionProgress } from "@/engine/domains/mission-progress";
import type { AlertPolicy, Dashboard, LogMetric, UptimeCheck } from "@/engine/domains/monitoring";
import type { LogSink } from "@/engine/domains/observability";
import { type Operation, OperationHistoryLimit } from "@/engine/domains/operation";
import { Principal } from "@/engine/domains/principal";
import {
  type BillingAccount,
  Folder,
  Organization,
  type ParentRef,
  PolicyTarget,
  Project,
} from "@/engine/domains/resource-hierarchy";
import { CustomRole, RoleCatalog } from "@/engine/domains/role-catalog";
import type { AppEngineApp, AppVersion, CloudFunction } from "@/engine/domains/serverless";
import { ServiceAccount } from "@/engine/domains/service-account";
import { Bucket } from "@/engine/domains/storage";
import type { TerraformState } from "@/engine/domains/terraform";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

/**
 * `gcloud auth login` で登録した疑似アカウント。今の主体は `core/account`（`World.currentPrincipal`）が正。
 * `adc` は `auth application-default login` で取った Application Default Credentials の主体。
 */
export type Session = Readonly<{
  accounts: readonly Principal[];
  adc: Option<Principal>;
  /** `components install` で入れたコンポーネントの id */
  components: readonly string[];
}>;

/**
 * エミュレータが保持する全リソースの集合（設計書 6.2 World）。
 * リソースはフラットな集合で持ち、階層は `projectId` / `parent` で結ぶ。
 * スキーマのバージョンは World ではなく Snapshot（`engine/snapshot`）が持つ。
 */
export type World = Readonly<{
  terraform: TerraformState;
  containerLab: ContainerLab;
  organization: Organization;
  folders: readonly Folder[];
  projects: readonly Project[];
  billingAccounts: readonly BillingAccount[];
  serviceAccounts: readonly ServiceAccount[];
  instances: readonly Instance[];
  networks: readonly Network[];
  subnets: readonly Subnet[];
  firewallRules: readonly FirewallRule[];
  diskSnapshots: readonly DiskSnapshot[];
  buckets: readonly Bucket[];
  clusters: readonly GkeCluster[];
  runServices: readonly CloudRunService[];
  disks: readonly Disk[];
  projectMetadata: readonly ProjectMetadata[];
  addresses: readonly Address[];
  routers: readonly Router[];
  peerings: readonly NetworkPeering[];
  healthChecks: readonly HealthCheck[];
  backendServices: readonly BackendService[];
  forwardingRules: readonly ForwardingRule[];
  instanceTemplates: readonly InstanceTemplate[];
  instanceGroups: readonly ManagedInstanceGroup[];
  nodePools: readonly NodePool[];
  kubeNamespaces: readonly KubeNamespace[];
  kubeContextNamespaces: Readonly<Record<string, string>>;
  kubeDeployments: readonly KubeDeployment[];
  kubeServices: readonly KubeService[];
  kubeHpas: readonly KubeHpa[];
  kubeConfigs: readonly KubeConfig[];
  kubeStorageClasses: readonly KubeStorageClass[];
  kubePvcs: readonly KubePvc[];
  kubePvs: readonly KubePv[];
  kubeNetworkPolicies: readonly KubeNetworkPolicy[];
  kubeFiles: Readonly<Record<string, string>>;
  functions: readonly CloudFunction[];
  appEngineApps: readonly AppEngineApp[];
  appVersions: readonly AppVersion[];
  sqlInstances: readonly SqlInstance[];
  sqlBackups: readonly SqlBackup[];
  pubsubTopics: readonly PubsubTopic[];
  pubsubSubscriptions: readonly PubsubSubscription[];
  logSinks: readonly LogSink[];
  logMetrics: readonly LogMetric[];
  uptimeChecks: readonly UptimeCheck[];
  alertPolicies: readonly AlertPolicy[];
  dashboards: readonly Dashboard[];
  serviceAccountKeys: readonly ServiceAccountKey[];
  osLoginKeys: readonly OsLoginSshKey[];
  kmsKeyRings: readonly KmsKeyRing[];
  dnsZones: readonly DnsManagedZone[];
  dmDeployments: readonly DmDeployment[];
  budgets: readonly Budget[];
  customRoles: readonly CustomRole[];
  config: GcloudConfig;
  session: Session;
  operations: readonly Operation[];
  missions: readonly MissionProgress[];
  /** id の採番に使う通し番号。時刻だけでは同じ ms に 2 つ作ると衝突する */
  sequence: number;
}>;

/** 採番の入口が返す「番号と、次の World」。 */
export type Numbered = Readonly<{ world: World; number: number }>;

/** 同じ名前のリソースが既にあるときの失敗。`resource` は E-008 に出す綴り。 */
export type AlreadyExists = Readonly<{ resource: string }>;

/** ポリシーの置き換えの失敗。対象が無いか、組織の最後の Owner を外そうとした。 */
export type PolicyRejected =
  | Readonly<{ kind: "not-found"; target: PolicyTarget }>
  | Readonly<{ kind: "last-owner" }>;

/** フォルダのネストの上限（設計書 6.3）。 */
const FolderNestLimit = 10;

const replaceBy = <T>(items: readonly T[], matches: (item: T) => boolean, next: T): readonly T[] =>
  items.map((item) => (matches(item) ? next : item));

const addUnique = (
  exists: boolean,
  resource: string,
  patch: () => World,
): Result<World, AlreadyExists> => (exists ? Result.err({ resource }) : Result.ok(patch()));

const sameInstance = (a: Instance, b: Instance): boolean =>
  a.projectId === b.projectId && a.zone === b.zone && a.name === b.name;

const sameInProject =
  <T extends { projectId: string; name: string }>(projectId: string, name: string) =>
  (item: T): boolean =>
    item.projectId === projectId && item.name === name;

/** クラスタに属するもの（ノードプール・kubectl のリソース）の所属判定。 */
type InCluster = Readonly<{ projectId: string; cluster: string; name: string }>;

const inCluster =
  (cluster: GkeCluster) =>
  (item: InCluster): boolean =>
    item.projectId === cluster.projectId && item.cluster === cluster.name;

const sameInCluster =
  (target: InCluster) =>
  (item: InCluster): boolean =>
    item.projectId === target.projectId &&
    item.cluster === target.cluster &&
    item.name === target.name;

const sameKubeResource =
  (target: InCluster & { namespace: string }) =>
  (item: InCluster & { namespace: string }): boolean =>
    sameInCluster(target)(item) && item.namespace === target.namespace;

/**
 * `(projectId, name)` で一意に引ける集合のキー。`World` のうち要素がその形を持つ配列だけ。
 * `projects` は `name` が表示名で同一性は `projectId`、`operations` はリソースではなく履歴なので外す。
 */
export type NamedCollection = Exclude<
  {
    [K in keyof World]: World[K] extends readonly (infer T)[]
      ? T extends { projectId: string; name: string }
        ? K
        : never
      : never;
  }[keyof World],
  "projects" | "operations"
>;

/** `NamedCollection` の要素の型。 */
export type NamedItem<K extends NamedCollection> = World[K][number];

const items = <K extends NamedCollection>(world: World, key: K): readonly NamedItem<K>[] =>
  world[key] as readonly NamedItem<K>[];

/** 名前に加えて置き場（ゾーン・リージョン・global）が同一性に入る集合。 */
export type LocatedCollection =
  | "disks"
  | "subnets"
  | "addresses"
  | "routers"
  | "backendServices"
  | "forwardingRules"
  | "instanceGroups"
  | "functions"
  | "kmsKeyRings";

/** 置き場の綴り（`asia-northeast1-a` / `regions/asia-northeast1` / `global`）。E-005 の綴りにもそのまま使う。 */
const LocationOf: { readonly [K in LocatedCollection]: (item: NamedItem<K>) => string } = {
  disks: (d) => d.zone,
  subnets: (s) => s.region,
  addresses: (a) => Option.unwrapOr(a.region, "global"),
  routers: (r) => r.region,
  backendServices: (b) => LbScope.toPath(b.scope),
  forwardingRules: (r) => LbScope.toPath(r.scope),
  instanceGroups: (g) => g.location,
  functions: (f) => f.region,
  kmsKeyRings: (r) => r.location,
};

const isLocated = (key: NamedCollection): key is LocatedCollection => key in LocationOf;

/** 置き場の綴り。型引数を 1 つに保つのは、`K & LocatedCollection` のまま表を引くと TS が集合ごとの関数の union にして呼べなくなるため。 */
const locationOf = <K extends LocatedCollection>(key: K, item: NamedItem<K>): string =>
  LocationOf[key](item);

/**
 * 集合の中で 1 件を指す綴り。置き場を持つ集合は置き場を含む（同名のディスクが別ゾーンにあってよい）。
 * `withNamed` の一意性・`replaceNamed` / `withoutNamed` の対象・`validate` の重複検査がこれで揃う。
 * `isLocated` が狭めるのは `key` だけで `item` は付いてこないので、ここ 1 箇所で結ぶ。
 */
const identityOf = <K extends NamedCollection>(key: K, item: NamedItem<K>): string => {
  if ("cluster" in item) {
    const kind = "kind" in item ? `${item.kind}/` : "";
    const namespace = "namespace" in item ? `${item.namespace}/` : "";
    return `${item.projectId}/${item.cluster}/${namespace}${kind}${item.name}`;
  }
  if (isLocated(key))
    return `${item.projectId}/${locationOf<LocatedCollection>(key, item as NamedItem<LocatedCollection>)}/${item.name}`;
  return `${item.projectId}/${item.name}`;
};

/** 実行時に全集合を回すための一覧。型 `NamedCollection` と食い違うと下の型検査で落ちる。 */
const NamedCollectionKeys = [
  "instances",
  "networks",
  "subnets",
  "firewallRules",
  "diskSnapshots",
  "buckets",
  "clusters",
  "runServices",
  "disks",
  "addresses",
  "routers",
  "peerings",
  "healthChecks",
  "backendServices",
  "forwardingRules",
  "instanceTemplates",
  "instanceGroups",
  "nodePools",
  "kubeNamespaces",
  "kubeDeployments",
  "kubeServices",
  "kubeHpas",
  "kubeConfigs",
  "kubeStorageClasses",
  "kubePvcs",
  "kubePvs",
  "kubeNetworkPolicies",
  "functions",
  "sqlInstances",
  "pubsubTopics",
  "pubsubSubscriptions",
  "logSinks",
  "logMetrics",
  "uptimeChecks",
  "alertPolicies",
  "dashboards",
  "kmsKeyRings",
  "dnsZones",
  "dmDeployments",
] as const satisfies readonly NamedCollection[];
type UnlistedCollection = Exclude<NamedCollection, (typeof NamedCollectionKeys)[number]>;
const _everyNamedCollectionIsListed: UnlistedCollection extends never ? true : never = true;

/**
 * 親を辿って組織まで届くか。同じフォルダに 2 度来たら循環、フォルダの数が上限を超えたら深すぎる。
 *
 * @param parent 起点の親
 * @param folderLimit 辿ってよいフォルダの数。フォルダ自身を数えるなら上限 - 1、プロジェクトなら上限
 * @returns 届けば辿ったフォルダの数。循環・上限超え・親の欠落は `none`
 */
const foldersToOrganization = (
  world: World,
  parent: ParentRef,
  folderLimit: number,
): Option<number> => {
  const visited = new Set<string>();
  let current = parent;
  let folders = 0;
  while (current.type === "folder") {
    if (visited.has(current.id) || folders >= folderLimit) return Option.none;
    visited.add(current.id);
    folders += 1;
    const folder = World.findFolder(world, current.id);
    if (!Option.isSome(folder)) return Option.none;
    current = folder.value.parent;
  }
  return current.id === world.organization.id ? Option.some(folders) : Option.none;
};

export const World = {
  /**
   * 通し番号を 1 つ払い出す。id・projectNumber・オペレーション名の採番に使う。
   *
   * @param world 元
   * @returns 払い出した番号と、次の番号を持つ World
   */
  nextNumber(world: World): Numbered {
    return { world: { ...world, sequence: world.sequence + 1 }, number: world.sequence };
  },

  // --- (projectId, name) で引く集合の共通の入口 ---

  /**
   * ある集合のうち、そのプロジェクトのもの（名前順）。
   *
   * @param world 元
   * @param key 集合（`disks` / `addresses` / …）
   * @param projectId プロジェクト
   * @returns 名前順の並び
   */
  namedOf<K extends NamedCollection>(
    world: World,
    key: K,
    projectId: string,
  ): readonly NamedItem<K>[] {
    return items(world, key)
      .filter((item) => item.projectId === projectId)
      .toSorted((a, b) => a.name.localeCompare(b.name));
  },

  /**
   * 名前で 1 件を引く。置き場を持つ集合（`LocatedCollection`）では同名が複数ありうるので、
   * そちらは `findLocated` で引く（ここは置き場を問わない最初の 1 件）。
   *
   * @param world 元
   * @param key 集合
   * @param ref プロジェクトと名前
   * @returns 見つかれば要素。無ければ `none`
   */
  findNamed<K extends NamedCollection>(
    world: World,
    key: K,
    ref: Readonly<{ projectId: string; name: string }>,
  ): Option<NamedItem<K>> {
    return Option.fromNullable(items(world, key).find(sameInProject(ref.projectId, ref.name)));
  },

  /**
   * 置き場を含めて 1 件を引く。
   *
   * @param world 元
   * @param key 置き場を持つ集合
   * @param ref プロジェクト・置き場（`LocationOf` と同じ綴り）・名前
   * @returns 見つかれば要素。無ければ `none`
   */
  findLocated<K extends LocatedCollection>(
    world: World,
    key: K,
    ref: Readonly<{ projectId: string; location: string; name: string }>,
  ): Option<NamedItem<K>> {
    const identity = `${ref.projectId}/${ref.location}/${ref.name}`;
    return Option.fromNullable(
      items(world, key).find((item) => identityOf(key, item) === identity),
    );
  },

  /** 置き場を持つ集合の要素の置き場の綴り（`findLocated` の `location` と同じ）。 */
  locationOf<K extends LocatedCollection>(key: K, item: NamedItem<K>): string {
    return locationOf(key, item);
  },

  /**
   * ある集合に足す。同じ同一性（名前。置き場を持つ集合は置き場 + 名前）が既にあれば E-008 の材料を返す。
   *
   * @param world 元
   * @param key 集合
   * @param item 足す要素
   * @param resource E-008 に出す綴り
   * @returns 足した World。同じものがあれば `err`
   */
  withNamed<K extends NamedCollection>(
    world: World,
    key: K,
    item: NamedItem<K>,
    resource: string,
  ): Result<World, AlreadyExists> {
    const identity = identityOf(key, item);
    const exists = items(world, key).some((existing) => identityOf(key, existing) === identity);
    return addUnique(exists, resource, () => ({ ...world, [key]: [...items(world, key), item] }));
  },

  replaceNamed<K extends NamedCollection>(world: World, key: K, item: NamedItem<K>): World {
    const identity = identityOf(key, item);
    return {
      ...world,
      [key]: replaceBy(
        items(world, key),
        (existing) => identityOf(key, existing) === identity,
        item,
      ),
    };
  },

  withoutNamed<K extends NamedCollection>(world: World, key: K, item: NamedItem<K>): World {
    const identity = identityOf(key, item);
    return {
      ...world,
      [key]: items(world, key).filter((existing) => identityOf(key, existing) !== identity),
    };
  },

  // --- 階層 ---

  findProject(world: World, projectId: string): Option<Project> {
    return Option.fromNullable(world.projects.find((p) => p.projectId === projectId));
  },

  /** `DELETE_REQUESTED` を除いた、操作できるプロジェクト。 */
  findActiveProject(world: World, projectId: string): Option<Project> {
    const project = World.findProject(world, projectId);
    return Option.isSome(project) && Project.isActive(project.value) ? project : Option.none;
  },

  activeProjects(world: World): readonly Project[] {
    return world.projects.filter(Project.isActive);
  },

  /** 削除要求済みも含めて、その ID が使われているか。`config set project` の警告に使う。 */
  hasProjectId(world: World, projectId: string): boolean {
    return Option.isSome(World.findProject(world, projectId));
  },

  findFolder(world: World, folderId: string): Option<Folder> {
    return Option.fromNullable(world.folders.find((f) => f.id === folderId));
  },

  findBillingAccount(world: World, id: string): Option<BillingAccount> {
    return Option.fromNullable(world.billingAccounts.find((b) => b.id === id));
  },

  /** 親の直下にあるフォルダ（表示名順）。 */
  foldersUnder(world: World, parent: ParentRef): readonly Folder[] {
    return world.folders
      .filter((f) => PolicyTarget.equals(f.parent, parent))
      .toSorted((a, b) => a.displayName.localeCompare(b.displayName));
  },

  /** 親の直下にある操作できるプロジェクト（ID 順）。 */
  projectsUnder(world: World, parent: ParentRef): readonly Project[] {
    return World.activeProjects(world)
      .filter((p) => PolicyTarget.equals(p.parent, parent))
      .toSorted((a, b) => a.projectId.localeCompare(b.projectId));
  },

  /**
   * プロジェクトを足す。projectId は削除要求後も再利用できない（設計書 6.2）。
   *
   * @param world 元
   * @param project 足すプロジェクト
   * @returns 足した World。同じ projectId があれば `err`
   */
  withProject(world: World, project: Project): Result<World, AlreadyExists> {
    return addUnique(
      World.hasProjectId(world, project.projectId),
      PolicyTarget.toPath({ type: "project", id: project.projectId }),
      () => ({ ...world, projects: [...world.projects, project] }),
    );
  },

  replaceProject(world: World, project: Project): World {
    return {
      ...world,
      projects: replaceBy(world.projects, (p) => p.projectId === project.projectId, project),
    };
  },

  withFolder(world: World, folder: Folder): Result<World, AlreadyExists> {
    return addUnique(
      Option.isSome(World.findFolder(world, folder.id)),
      PolicyTarget.toPath({ type: "folder", id: folder.id }),
      () => ({ ...world, folders: [...world.folders, folder] }),
    );
  },

  replaceFolder(world: World, folder: Folder): World {
    return { ...world, folders: replaceBy(world.folders, (f) => f.id === folder.id, folder) };
  },

  /**
   * 親が存在するか。組織は 1 つしか無いので id が一致するかを見る。
   *
   * @param world 元
   * @param parent 親の指定
   * @returns 存在すれば真
   */
  hasParent(world: World, parent: ParentRef): boolean {
    return parent.type === "organization"
      ? world.organization.id === parent.id
      : Option.isSome(World.findFolder(world, parent.id));
  },

  /**
   * あるリソースから組織までの祖先を近い順に並べる（自身を含む）。
   * IAM の継承評価とリソースツリーの継承元表示で使う。
   *
   * @param world 元
   * @param target 起点
   * @returns 起点 → 親 → … → 組織。親が欠けていれば辿れたところまで。同じフォルダには 2 度入らない
   */
  ancestry(world: World, target: PolicyTarget): readonly PolicyTarget[] {
    const climb = (ref: ParentRef, acc: readonly PolicyTarget[]): readonly PolicyTarget[] => {
      const seen = acc.some((a) => PolicyTarget.equals(a, ref));
      if (ref.type === "organization" || seen) return [...acc, ref];
      const folder = World.findFolder(world, ref.id);
      return Option.isSome(folder) ? climb(folder.value.parent, [...acc, ref]) : [...acc, ref];
    };
    switch (target.type) {
      case "organization":
        return [target];
      case "folder": {
        const folder = World.findFolder(world, target.id);
        return Option.isSome(folder) ? climb(folder.value.parent, [target]) : [target];
      }
      case "project": {
        const project = World.findProject(world, target.id);
        return Option.isSome(project) ? climb(project.value.parent, [target]) : [target];
      }
      case "artifact-repository": {
        const repo = world.containerLab.repositories.find((r) => r.id === target.id);
        return repo
          ? [target, ...World.ancestry(world, { type: "project", id: repo.projectId })]
          : [target];
      }
      case "bucket": {
        const bucket = World.findBucket(world, target.id);
        return Option.isSome(bucket)
          ? [target, ...World.ancestry(world, { type: "project", id: bucket.value.projectId })]
          : [target];
      }
      case "service-account": {
        const account = World.findServiceAccount(world, target.id);
        return Option.isSome(account)
          ? [target, ...World.ancestry(world, { type: "project", id: account.value.projectId })]
          : [target];
      }
    }
  },

  /**
   * 対象のポリシーを読む。
   *
   * @param world 元
   * @param target 対象
   * @returns そのリソースに直接付いたポリシー。リソースが無ければ `none`
   */
  findPolicy(world: World, target: PolicyTarget): Option<IamPolicy> {
    switch (target.type) {
      case "organization":
        return world.organization.id === target.id
          ? Option.some(world.organization.iamPolicy)
          : Option.none;
      case "folder":
        return Option.map(World.findFolder(world, target.id), (f) => f.iamPolicy);
      case "project":
        return Option.map(World.findProject(world, target.id), (p) => p.iamPolicy);
      case "artifact-repository":
        return Option.fromNullable(
          world.containerLab.repositories.find((r) => r.id === target.id)?.iamPolicy,
        );
      case "bucket":
        return Option.map(World.findBucket(world, target.id), (b) => b.iamPolicy);
      case "service-account":
        return Option.map(World.findServiceAccount(world, target.id), (s) => s.iamPolicy);
    }
  },

  /**
   * 対象のポリシーを置き換える。整合性の入口はここ 1 つ（部分更新の関数は公開しない）。
   * 組織のポリシーは `roles/owner` が 1 人以上残るものだけ受け付ける（E-012）。
   *
   * @param world 元
   * @param target 対象
   * @param policy 新しいポリシー
   * @returns 置き換えた World。リソースが無い・組織の最後の Owner を外す、はそれぞれの理由で `err`
   */
  withPolicy(world: World, target: PolicyTarget, policy: IamPolicy): Result<World, PolicyRejected> {
    const notFound: PolicyRejected = { kind: "not-found", target };
    switch (target.type) {
      case "organization": {
        if (world.organization.id !== target.id) return Result.err(notFound);
        if (!World.keepsOrganizationOwner(policy)) return Result.err({ kind: "last-owner" });
        return Result.ok({
          ...world,
          organization: Organization.withPolicy(world.organization, policy),
        });
      }
      case "folder":
        return Option.toResult(
          Option.map(World.findFolder(world, target.id), (f) =>
            World.replaceFolder(world, Folder.withPolicy(f, policy)),
          ),
          () => notFound,
        );
      case "project":
        return Option.toResult(
          Option.map(World.findProject(world, target.id), (p) =>
            World.replaceProject(world, Project.withPolicy(p, policy)),
          ),
          () => notFound,
        );
      case "artifact-repository": {
        if (!world.containerLab.repositories.some((r) => r.id === target.id))
          return Result.err(notFound);
        return Result.ok({
          ...world,
          containerLab: {
            ...world.containerLab,
            repositories: world.containerLab.repositories.map((r) =>
              r.id === target.id ? { ...r, iamPolicy: policy } : r,
            ),
          },
        });
      }
      case "bucket":
        return Option.toResult(
          Option.map(World.findBucket(world, target.id), (b) =>
            World.replaceBucket(world, Bucket.withPolicy(b, policy)),
          ),
          () => notFound,
        );
      case "service-account":
        return Option.toResult(
          Option.map(World.findServiceAccount(world, target.id), (s) =>
            World.replaceServiceAccount(world, ServiceAccount.withPolicy(s, policy)),
          ),
          () => notFound,
        );
    }
  },

  /**
   * 組織の `roles/owner` を持つメンバーが 1 人以上残るか（設計書 6.2 IamPolicy の不変条件）。
   *
   * @param policy 組織に適用しようとしているポリシー
   * @returns 残るなら真
   */
  keepsOrganizationOwner(policy: IamPolicy): boolean {
    return IamPolicy.membersOf(policy, "roles/owner").length > 0;
  },

  /** 主体が組織の `roles/owner` を直接持っているか。ヘッダーの「Owner 以外で操作中」の判定に使う。 */
  isOrganizationOwner(world: World, principal: Principal): boolean {
    return IamPolicy.hasBinding(
      world.organization.iamPolicy,
      "roles/owner",
      Principal.toMember(principal),
    );
  },

  // --- サービスアカウント ---

  serviceAccountsOf(world: World, projectId: string): readonly ServiceAccount[] {
    return world.serviceAccounts.filter((s) => s.projectId === projectId);
  },

  findServiceAccount(world: World, email: string): Option<ServiceAccount> {
    return Option.fromNullable(world.serviceAccounts.find((s) => s.email === email));
  },

  withServiceAccount(world: World, account: ServiceAccount): Result<World, AlreadyExists> {
    return addUnique(
      Option.isSome(World.findServiceAccount(world, account.email)),
      `projects/${account.projectId}/serviceAccounts/${account.email}`,
      () => ({ ...world, serviceAccounts: [...world.serviceAccounts, account] }),
    );
  },

  replaceServiceAccount(world: World, account: ServiceAccount): World {
    return {
      ...world,
      serviceAccounts: replaceBy(world.serviceAccounts, (s) => s.email === account.email, account),
    };
  },

  withoutServiceAccount(world: World, email: string): World {
    return { ...world, serviceAccounts: world.serviceAccounts.filter((s) => s.email !== email) };
  },

  keysOf(world: World, serviceAccountEmail: string): readonly ServiceAccountKey[] {
    return world.serviceAccountKeys.filter((k) => k.serviceAccountEmail === serviceAccountEmail);
  },

  withServiceAccountKey(world: World, key: ServiceAccountKey): World {
    return { ...world, serviceAccountKeys: [...world.serviceAccountKeys, key] };
  },

  /** `--key-file` の名前で書き出した鍵を引く。同じ名前で何度も書き出したら最後のもの。 */
  findKeyByFile(world: World, file: string): Option<ServiceAccountKey> {
    return Option.fromNullable(world.serviceAccountKeys.findLast((k) => k.file === file));
  },

  // --- カスタムロール ---

  customRolesOf(world: World, projectId: string): readonly CustomRole[] {
    return world.customRoles
      .filter((r) => r.projectId === projectId)
      .toSorted((a, b) => a.roleId.localeCompare(b.roleId));
  },

  findCustomRole(world: World, name: RoleName): Option<CustomRole> {
    return Option.fromNullable(world.customRoles.find((r) => CustomRole.name(r) === name));
  },

  findCustomRoleById(world: World, projectId: string, roleId: string): Option<CustomRole> {
    return Option.fromNullable(
      world.customRoles.find((r) => r.projectId === projectId && r.roleId === roleId),
    );
  },

  /**
   * ロールの表示名。カタログの事前定義ロールか World のカスタムロール、どちらにも無ければ名前そのまま
   * （バインディングには存在しないロールの綴りも入りうる）。
   */
  roleTitle(world: World, name: RoleName): string {
    return Option.unwrapOr(
      Option.or(
        Option.map(RoleCatalog.find(name), (r) => r.title),
        Option.map(World.findCustomRole(world, name), (r) => r.title),
      ),
      name,
    );
  },

  /** カタログにもカスタムロールにもあるか（バインディングに入れてよいロールか）。 */
  isKnownRole(world: World, name: RoleName): boolean {
    return (
      Option.isSome(RoleCatalog.find(name)) || Option.isSome(World.findCustomRole(world, name))
    );
  },

  withCustomRole(world: World, role: CustomRole): Result<World, AlreadyExists> {
    return addUnique(
      Option.isSome(World.findCustomRole(world, CustomRole.name(role))),
      CustomRole.name(role),
      () => ({ ...world, customRoles: [...world.customRoles, role] }),
    );
  },

  // --- Compute ---

  instancesOf(world: World, projectId: string): readonly Instance[] {
    return world.instances.filter((i) => i.projectId === projectId);
  },

  findInstance(world: World, projectId: string, zone: Zone, name: string): Option<Instance> {
    return Option.fromNullable(
      world.instances.find((i) => i.projectId === projectId && i.zone === zone && i.name === name),
    );
  },

  /**
   * インスタンスを足す。`(zone, name)` はプロジェクト内でユニーク（設計書 6.2 Instance）。
   *
   * @param world 元
   * @param instance 足すインスタンス
   * @returns 足した World。同じゾーンに同名があれば `err`
   */
  withInstance(world: World, instance: Instance): Result<World, AlreadyExists> {
    return addUnique(
      world.instances.some((i) => sameInstance(i, instance)),
      `projects/${instance.projectId}/zones/${instance.zone}/instances/${instance.name}`,
      () => ({ ...world, instances: [...world.instances, instance] }),
    );
  },

  replaceInstance(world: World, instance: Instance): World {
    return {
      ...world,
      instances: replaceBy(world.instances, (i) => sameInstance(i, instance), instance),
    };
  },

  withoutInstance(world: World, instance: Instance): World {
    return { ...world, instances: world.instances.filter((i) => !sameInstance(i, instance)) };
  },

  networksOf(world: World, projectId: string): readonly Network[] {
    return World.namedOf(world, "networks", projectId);
  },

  findNetwork(world: World, projectId: string, name: string): Option<Network> {
    return World.findNamed(world, "networks", { projectId, name });
  },

  withNetwork(
    world: World,
    network: Network,
    subnets: readonly Subnet[],
  ): Result<World, AlreadyExists> {
    return addUnique(
      Option.isSome(World.findNetwork(world, network.projectId, network.name)),
      `projects/${network.projectId}/global/networks/${network.name}`,
      () => ({
        ...world,
        networks: [...world.networks, network],
        subnets: [...world.subnets, ...subnets],
      }),
    );
  },

  /**
   * ネットワークを消す。サブネットが残っていれば消せない（設計書 6.3）。
   *
   * @param world 元
   * @param network 消すネットワーク
   * @returns 消した World。サブネットが残っていれば、削除を妨げている最初のサブネット
   */
  withoutNetwork(world: World, network: Network): Result<World, Subnet> {
    const blocking = world.subnets.find(
      (s) => s.projectId === network.projectId && s.network === network.name,
    );
    if (blocking !== undefined) return Result.err(blocking);
    return Result.ok({
      ...world,
      networks: world.networks.filter((n) => !sameInProject(network.projectId, network.name)(n)),
    });
  },

  subnetsOf(world: World, projectId: string): readonly Subnet[] {
    return world.subnets.filter((s) => s.projectId === projectId);
  },

  findSubnet(world: World, projectId: string, region: string, name: string): Option<Subnet> {
    return World.findLocated(world, "subnets", { projectId, location: region, name });
  },

  withSubnet(world: World, subnet: Subnet): Result<World, AlreadyExists> {
    return World.withNamed(
      world,
      "subnets",
      subnet,
      `projects/${subnet.projectId}/regions/${subnet.region}/subnetworks/${subnet.name}`,
    );
  },

  firewallRulesOf(world: World, projectId: string): readonly FirewallRule[] {
    return World.namedOf(world, "firewallRules", projectId);
  },

  findFirewallRule(world: World, projectId: string, name: string): Option<FirewallRule> {
    return World.findNamed(world, "firewallRules", { projectId, name });
  },

  withFirewallRule(world: World, rule: FirewallRule): Result<World, AlreadyExists> {
    return World.withNamed(
      world,
      "firewallRules",
      rule,
      `projects/${rule.projectId}/global/firewalls/${rule.name}`,
    );
  },

  withoutFirewallRule(world: World, rule: FirewallRule): World {
    return World.withoutNamed(world, "firewallRules", rule);
  },

  diskSnapshotsOf(world: World, projectId: string): readonly DiskSnapshot[] {
    return World.namedOf(world, "diskSnapshots", projectId);
  },

  withDiskSnapshot(world: World, snapshot: DiskSnapshot): Result<World, AlreadyExists> {
    return World.withNamed(
      world,
      "diskSnapshots",
      snapshot,
      `projects/${snapshot.projectId}/global/snapshots/${snapshot.name}`,
    );
  },

  disksOf(world: World, projectId: string): readonly Disk[] {
    return World.namedOf(world, "disks", projectId);
  },

  /** サブネットに NIC を持つインスタンス（ゾーンがそのサブネットのリージョンにあるもの）。 */
  instancesInSubnet(world: World, subnet: Subnet): readonly Instance[] {
    return World.instancesOf(world, subnet.projectId).filter(
      (i) =>
        ZoneCatalog.region(i.zone) === subnet.region &&
        i.networkInterfaces.some((nic) => nic.subnetwork === subnet.name),
    );
  },

  /** 対象の selfLink に対するオペレーションの履歴（古い順）。 */
  operationsOfTarget(world: World, targetLink: string): readonly Operation[] {
    return world.operations.filter((o) => o.targetLink === targetLink);
  },

  findDisk(world: World, projectId: string, zone: Zone, name: string): Option<Disk> {
    return World.findLocated(world, "disks", { projectId, location: zone, name });
  },

  /**
   * 独立ディスクを足す。`(zone, name)` はプロジェクト内でユニーク。
   *
   * @param world 元
   * @param disk 足すディスク
   * @returns 足した World。同じゾーンに同名があれば `err`
   */
  withDisk(world: World, disk: Disk): Result<World, AlreadyExists> {
    return World.withNamed(
      world,
      "disks",
      disk,
      `projects/${disk.projectId}/zones/${disk.zone}/disks/${disk.name}`,
    );
  },

  replaceDisk(world: World, disk: Disk): World {
    return World.replaceNamed(world, "disks", disk);
  },

  /** プロジェクト全体のメタデータ。無ければ空。 */
  projectMetadataOf(world: World, projectId: string): ProjectMetadata {
    return world.projectMetadata.find((m) => m.projectId === projectId) ?? { projectId, items: {} };
  },

  withProjectMetadata(world: World, metadata: ProjectMetadata): World {
    const others = world.projectMetadata.filter((m) => m.projectId !== metadata.projectId);
    return { ...world, projectMetadata: [...others, metadata] };
  },

  osLoginKeysOf(world: World, account: string): readonly OsLoginSshKey[] {
    return world.osLoginKeys.filter((k) => k.account === account);
  },

  /** 同じ指紋の鍵は重ねない（本物と同じく冪等）。 */
  withOsLoginKey(world: World, key: OsLoginSshKey): World {
    const exists = world.osLoginKeys.some(
      (k) => k.account === key.account && k.fingerprint === key.fingerprint,
    );
    return exists ? world : { ...world, osLoginKeys: [...world.osLoginKeys, key] };
  },

  // --- Storage ---

  bucketsOf(world: World, projectId: string): readonly Bucket[] {
    return world.buckets.filter((b) => b.projectId === projectId);
  },

  /** バケット名は全プロジェクト横断でユニークなので projectId を取らない。 */
  findBucket(world: World, name: string): Option<Bucket> {
    return Option.fromNullable(world.buckets.find((b) => b.name === name));
  },

  /**
   * バケットを足す。名前は World 全体（全プロジェクト横断）でユニーク（設計書 6.2 Bucket）。
   *
   * @param world 元
   * @param bucket 足すバケット
   * @returns 足した World。同名があれば `err`
   */
  withBucket(world: World, bucket: Bucket): Result<World, AlreadyExists> {
    return addUnique(
      Option.isSome(World.findBucket(world, bucket.name)),
      PolicyTarget.toPath({ type: "bucket", id: bucket.name }),
      () => ({ ...world, buckets: [...world.buckets, bucket] }),
    );
  },

  replaceBucket(world: World, bucket: Bucket): World {
    return { ...world, buckets: replaceBy(world.buckets, (b) => b.name === bucket.name, bucket) };
  },

  withoutBucket(world: World, name: string): World {
    return { ...world, buckets: world.buckets.filter((b) => b.name !== name) };
  },

  // --- GKE / Cloud Run ---

  clustersOf(world: World, projectId: string): readonly GkeCluster[] {
    return World.namedOf(world, "clusters", projectId);
  },

  findCluster(world: World, projectId: string, name: string): Option<GkeCluster> {
    return World.findNamed(world, "clusters", { projectId, name });
  },

  withCluster(world: World, cluster: GkeCluster): Result<World, AlreadyExists> {
    return World.withNamed(
      world,
      "clusters",
      cluster,
      `projects/${cluster.projectId}/locations/${cluster.location}/clusters/${cluster.name}`,
    );
  },

  /** クラスタを消す。ノードプールと Kubernetes リソースも一緒に消える。 */
  withoutCluster(world: World, cluster: GkeCluster): World {
    const belongs = (item: Readonly<{ projectId: string; cluster: string }>) =>
      item.projectId === cluster.projectId && item.cluster === cluster.name;
    return {
      ...World.withoutNamed(world, "clusters", cluster),
      nodePools: world.nodePools.filter((p) => !belongs(p)),
      kubeNamespaces: world.kubeNamespaces.filter((n) => !belongs(n)),
      kubeContextNamespaces: Object.fromEntries(
        Object.entries(world.kubeContextNamespaces).filter(
          ([key]) => key !== KubeContext.name(cluster),
        ),
      ),
      kubeDeployments: world.kubeDeployments.filter((d) => !belongs(d)),
      kubeServices: world.kubeServices.filter((s) => !belongs(s)),
      kubeHpas: world.kubeHpas.filter((h) => !belongs(h)),
      kubeConfigs: world.kubeConfigs.filter((s) => !belongs(s)),
      kubeStorageClasses: world.kubeStorageClasses.filter((s) => !belongs(s)),
      kubePvcs: world.kubePvcs.filter((s) => !belongs(s)),
      kubePvs: world.kubePvs.filter((s) => !belongs(s)),
      kubeNetworkPolicies: world.kubeNetworkPolicies.filter((s) => !belongs(s)),
    };
  },

  replaceCluster(world: World, cluster: GkeCluster): World {
    return World.replaceNamed(world, "clusters", cluster);
  },

  nodePoolsOf(world: World, cluster: GkeCluster): readonly NodePool[] {
    return world.nodePools.filter(inCluster(cluster));
  },

  /** クラスタのノードプール。Standard は `default-pool` を先頭に持ち、Autopilot は 1 つも持たない。 */
  nodePoolsWithDefault(world: World, cluster: GkeCluster): readonly NodePool[] {
    return cluster.autopilot
      ? []
      : [NodePool.defaultPool(cluster), ...World.nodePoolsOf(world, cluster)];
  },

  withNodePool(world: World, pool: NodePool): Result<World, AlreadyExists> {
    const exists = world.nodePools.some(sameInCluster(pool));
    return addUnique(
      exists || pool.name === "default-pool",
      `projects/${pool.projectId}/locations/-/clusters/${pool.cluster}/nodePools/${pool.name}`,
      () => ({ ...world, nodePools: [...world.nodePools, pool] }),
    );
  },

  /** クラスタの Kubernetes リソース（Deployment）。名前順。 */
  kubeDeploymentsOf(
    world: World,
    cluster: GkeCluster,
    namespace = "default",
  ): readonly KubeDeployment[] {
    return world.kubeDeployments
      .filter((r) => inCluster(cluster)(r) && r.namespace === namespace)
      .toSorted((a, b) => a.name.localeCompare(b.name));
  },

  findKubeDeployment(
    world: World,
    cluster: GkeCluster,
    name: string,
    namespace = "default",
  ): Option<KubeDeployment> {
    return Option.fromNullable(
      World.kubeDeploymentsOf(world, cluster, namespace).find((d) => d.name === name),
    );
  },

  withKubeDeployment(world: World, deployment: KubeDeployment): Result<World, AlreadyExists> {
    const used = new Set(
      world.kubeDeployments
        .filter((d) => d.projectId === deployment.projectId && d.cluster === deployment.cluster)
        .map((d) => d.podNetwork),
    );
    let podNetwork = 0;
    while (used.has(podNetwork)) podNetwork += 1;
    if (podNetwork >= 16384)
      return Result.err({ resource: "all simulated Pod networks (16384 per cluster)" });
    return addUnique(
      world.kubeDeployments.some(sameKubeResource(deployment)),
      `deployments.apps "${deployment.name}"`,
      () =>
        World.reconcileKubeStorage({
          ...world,
          kubeDeployments: [
            ...world.kubeDeployments,
            KubeReadiness.reconcile(
              KubeLiveness.reconcile(
                KubeStartup.reconcile(
                  KubeContainer.reconcile(
                    KubeRuntime.reconcile(world, { ...deployment, podNetwork }),
                  ),
                ),
              ),
            ),
          ],
        }),
    );
  },

  replaceKubeDeployment(world: World, deployment: KubeDeployment): World {
    return World.reconcileKubeStorage({
      ...world,
      kubeDeployments: replaceBy(
        world.kubeDeployments,
        sameKubeResource(deployment),
        KubeReadiness.reconcile(
          KubeLiveness.reconcile(
            KubeStartup.reconcile(
              KubeContainer.reconcile(KubeRuntime.reconcile(world, deployment)),
            ),
          ),
        ),
      ),
    });
  },

  withoutKubeDeployment(world: World, deployment: KubeDeployment): World {
    const same = sameKubeResource(deployment);
    return World.reconcileKubeStorage({
      ...world,
      kubeDeployments: world.kubeDeployments.filter((d) => !same(d)),
    });
  },

  withKubeConfigs(world: World, kubeConfigs: readonly KubeConfig[]): World {
    return World.reconcileKubeStorage({ ...world, kubeConfigs });
  },

  reconcileKubeStorage(world: World): World {
    const next = KubeStorage.reconcile(world);
    return {
      ...next,
      kubeDeployments: next.kubeDeployments.map((d) => KubeRuntime.reconcile(next, d)),
    };
  },

  kubeServicesOf(world: World, cluster: GkeCluster, namespace = "default"): readonly KubeService[] {
    return world.kubeServices
      .filter((r) => inCluster(cluster)(r) && r.namespace === namespace)
      .toSorted((a, b) => a.name.localeCompare(b.name));
  },

  findKubeService(
    world: World,
    cluster: GkeCluster,
    name: string,
    namespace = "default",
  ): Option<KubeService> {
    return Option.fromNullable(
      World.kubeServicesOf(world, cluster, namespace).find((s) => s.name === name),
    );
  },

  withKubeService(world: World, service: KubeService): Result<World, AlreadyExists> {
    return addUnique(
      world.kubeServices.some(sameKubeResource(service)),
      `services "${service.name}"`,
      () => ({ ...world, kubeServices: [...world.kubeServices, service] }),
    );
  },

  withoutKubeService(world: World, service: KubeService): World {
    const same = sameKubeResource(service);
    return { ...world, kubeServices: world.kubeServices.filter((s) => !same(s)) };
  },

  runServicesOf(world: World, projectId: string): readonly CloudRunService[] {
    return World.namedOf(world, "runServices", projectId);
  },

  findRunService(world: World, projectId: string, name: string): Option<CloudRunService> {
    return World.findNamed(world, "runServices", { projectId, name });
  },

  /** `run deploy` は同名なら新しいリビジョンとして置き換えるので、重複を弾かず上書きする。 */
  withRunServiceReplaced(world: World, service: CloudRunService): World {
    const others = world.runServices.filter(
      (s) => !sameInProject(service.projectId, service.name)(s),
    );
    return { ...world, runServices: [...others, service] };
  },

  withoutRunService(world: World, service: CloudRunService): World {
    return World.withoutNamed(world, "runServices", service);
  },

  // --- App Engine / Cloud SQL / 予算 ---

  findAppEngineApp(world: World, projectId: string): Option<AppEngineApp> {
    return Option.fromNullable(world.appEngineApps.find((a) => a.projectId === projectId));
  },

  withAppEngineApp(world: World, app: AppEngineApp): World {
    return { ...world, appEngineApps: [...world.appEngineApps, app] };
  },

  /** サービスのバージョン（古い順）。 */
  appVersionsOf(world: World, projectId: string, service: string): readonly AppVersion[] {
    return world.appVersions.filter((v) => v.projectId === projectId && v.service === service);
  },

  /**
   * バージョンを足す。同じサービスの既存バージョンはトラフィックを 0 にし、新しいものが 100% を受ける
   * （`app deploy` の既定 `--promote`）。
   *
   * @param world 元
   * @param version 足すバージョン（`trafficSplit` は 1 で渡す）
   * @returns 足した World
   */
  withAppVersionPromoted(world: World, version: AppVersion): World {
    const demoted = world.appVersions.map((v) =>
      v.projectId === version.projectId && v.service === version.service
        ? { ...v, trafficSplit: 0 }
        : v,
    );
    return { ...world, appVersions: [...demoted, version] };
  },

  /**
   * サービスのトラフィック配分を置き換える（`services set-traffic`）。
   *
   * @param world 元
   * @param service 対象のプロジェクトとサービス
   * @param splits バージョン id → 割合。列挙されなかったバージョンは 0 になる
   * @returns 置き換えた World
   */
  withTrafficSplits(
    world: World,
    service: Readonly<{ projectId: string; service: string }>,
    splits: Readonly<Record<string, number>>,
  ): World {
    return {
      ...world,
      appVersions: world.appVersions.map((v) =>
        v.projectId === service.projectId && v.service === service.service
          ? { ...v, trafficSplit: splits[v.id] ?? 0 }
          : v,
      ),
    };
  },

  sqlBackupsOf(world: World, projectId: string, instance: string): readonly SqlBackup[] {
    return world.sqlBackups.filter((b) => b.projectId === projectId && b.instance === instance);
  },

  withSqlBackup(world: World, backup: SqlBackup): World {
    return { ...world, sqlBackups: [...world.sqlBackups, backup] };
  },

  /** インスタンスを消すときはそのバックアップも消える（本物と同じ）。 */
  withoutSqlInstance(world: World, instance: SqlInstance): World {
    return {
      ...World.withoutNamed(world, "sqlInstances", instance),
      sqlBackups: world.sqlBackups.filter(
        (b) => !(b.projectId === instance.projectId && b.instance === instance.name),
      ),
    };
  },

  budgetsOf(world: World, billingAccountId: string): readonly Budget[] {
    return world.budgets.filter((b) => b.billingAccountId === billingAccountId);
  },

  withBudget(world: World, budget: Budget): World {
    return { ...world, budgets: [...world.budgets, budget] };
  },

  // --- config / session ---

  withConfig(world: World, config: GcloudConfig): World {
    return { ...world, config };
  },

  /** アクティブな configuration の `core/project`。 */
  currentProjectId(world: World): Option<string> {
    return GcloudConfig.get(world.config, "core/project");
  },

  /**
   * 今コマンドを実行している主体。アクティブな configuration の `core/account` が正で、
   * 未設定なら `none`（本物と同じく「アカウントが選ばれていない」状態）。
   */
  currentPrincipal(world: World): Option<Principal> {
    const account = GcloudConfig.get(world.config, "core/account");
    return Option.flatMap(account, (value) => {
      const parsed = Principal.parse(value);
      return Result.isOk(parsed) ? Option.some(parsed.value) : Option.none;
    });
  },

  /**
   * 主体を切り替える。`core/account` を書き、疑似ログイン済みの一覧にも足す
   * （`config set account` と `auth login` の両方の入口）。
   *
   * @param world 元
   * @param principal 次の主体。未知のメールでも受け付ける（11.2: 認証は疑似）
   * @returns `core/account` とアカウント一覧を更新した World
   */
  withPrincipal(world: World, principal: Principal): World {
    const accounts = world.session.accounts.includes(principal)
      ? world.session.accounts
      : [...world.session.accounts, principal];
    return {
      ...world,
      session: { ...world.session, accounts },
      config: GcloudConfig.set(world.config, "core/account", principal),
    };
  },

  /** Application Default Credentials の主体を記録する（`auth application-default login`）。 */
  withAdc(world: World, principal: Principal): World {
    return { ...world, session: { ...world.session, adc: Option.some(principal) } };
  },

  withComponent(world: World, componentId: string): World {
    const components = world.session.components.includes(componentId)
      ? world.session.components
      : [...world.session.components, componentId];
    return { ...world, session: { ...world.session, components } };
  },

  /** プロジェクトが API を有効化しているか。 */
  hasApi(world: World, projectId: string, api: ApiName): boolean {
    const project = World.findProject(world, projectId);
    return Option.isSome(project) && Project.hasApi(project.value, api);
  },

  // --- operations ---

  /**
   * オペレーションを履歴に足す。上限（500）を超えたら古いものから捨てる。
   *
   * @param world 元
   * @param operation 足すオペレーション
   * @returns 足した後の World
   */
  withOperation(world: World, operation: Operation): World {
    const operations = [...world.operations, operation].slice(-OperationHistoryLimit);
    return { ...world, operations };
  },

  operationsOf(world: World, projectId: string): readonly Operation[] {
    return world.operations.filter((o) => o.projectId === projectId);
  },

  // --- missions ---

  findMissionProgress(world: World, id: string): Option<MissionProgress> {
    return Option.fromNullable(world.missions.find((m) => m.id === id));
  },

  replaceMissionProgress(world: World, progress: MissionProgress): World {
    return { ...world, missions: replaceBy(world.missions, (m) => m.id === progress.id, progress) };
  },

  missionsInProgress(world: World): readonly MissionProgress[] {
    return world.missions.filter(MissionProgress.isInProgress);
  },

  // --- 不変条件 ---

  /**
   * 設計書 6.2 / 6.3 の不変条件を確かめる。import とミッションの setup の後に通す。
   *
   * @param world 確かめる World
   * @returns 満たしていれば同じ World。満たさなければ最初に見つけた違反
   */
  validate(world: World): Result<World, string> {
    for (const [name, namespace] of Object.entries(world.kubeContextNamespaces)) {
      if (
        !KubeNamespace.valid(namespace) ||
        !world.clusters.some((c) => KubeContext.name(c) === name)
      )
        return Result.err("Invalid Kubernetes context namespace.");
    }
    if (!KubeManifest.validFiles(world.kubeFiles))
      return Result.err("Invalid Kubernetes virtual files.");
    for (const n of world.kubeNamespaces) {
      if (
        !KubeNamespace.valid(n.name) ||
        KubeNamespace.builtin(n.name) ||
        !Number.isFinite(Date.parse(n.createdAt))
      )
        return Result.err("Invalid custom Kubernetes namespace.");
    }
    for (const r of [
      ...world.kubeDeployments,
      ...world.kubeServices,
      ...world.kubeConfigs,
      ...world.kubeHpas,
      ...world.kubePvcs,
      ...world.kubeNetworkPolicies,
    ]) {
      const cluster = World.findCluster(world, r.projectId, r.cluster);
      if (
        !KubeNamespace.valid(r.namespace) ||
        (Option.isSome(cluster) && !KubeNamespace.exists(world, cluster.value, r.namespace))
      )
        return Result.err("Kubernetes resource belongs to a missing or invalid namespace.");
    }
    if (
      world.clusters.some(
        (c) =>
          typeof c.networkPolicyEnabled !== "boolean" || (c.autopilot && !c.networkPolicyEnabled),
      )
    )
      return Result.err("Invalid cluster NetworkPolicy enforcement configuration.");
    if (world.kubeNetworkPolicies.some((p) => !KubeNetworkPolicy.valid(p)))
      return Result.err("Invalid Kubernetes NetworkPolicy.");
    for (const deployment of world.kubeDeployments) {
      const checked = KubeDeployment.validate(deployment);
      if (!Result.isOk(checked)) return Result.err(checked.error);
    }
    const networks = world.kubeDeployments.map(
      (d) => `${d.projectId}/${d.cluster}/${d.podNetwork}`,
    );
    if (new Set(networks).size !== networks.length)
      return Result.err("Duplicate Kubernetes Pod network.");
    const hpaTargets = world.kubeHpas.map(
      (h) => `${h.projectId}/${h.cluster}/${h.namespace}/${h.target}`,
    );
    if (new Set(hpaTargets).size !== hpaTargets.length)
      return Result.err("Only one HPA per Deployment is supported.");
    for (const h of world.kubeHpas) {
      const checked = KubeHpa.validate(h);
      if (!Result.isOk(checked)) return Result.err(checked.error);
    }
    for (const service of world.kubeServices) {
      if (
        !Result.isOk(KubeLabels.parse(service.labels)) ||
        !Result.isOk(KubeLabels.parse(service.selector, true))
      )
        return Result.err("Invalid Service labels or selector.");
    }
    const configIds = world.kubeConfigs.map(
      (c) => `${c.projectId}/${c.cluster}/${c.namespace}/${c.kind}/${c.name}`,
    );
    if (new Set(configIds).size !== configIds.length)
      return Result.err("Duplicate Kubernetes configuration.");
    for (const c of world.kubeConfigs) {
      const checked = KubeConfig.validate(c);
      if (!Result.isOk(checked)) return Result.err(checked.error);
    }
    if (!KubeStorage.valid(world))
      return Result.err("Invalid Kubernetes persistent storage state.");
    const lab = ContainerLab.validate(world.containerLab);
    if (!Result.isOk(lab)) return lab;
    if (
      [...lab.value.repositories, ...lab.value.builds].some(
        (r) => !world.projects.some((p) => p.projectId === r.projectId),
      )
    )
      return Result.err("Repository or build project is missing.");
    const activeExists = GcloudConfig.hasConfiguration(
      world.config,
      world.config.activeConfiguration,
    );
    if (!activeExists) {
      return Result.err(
        `active configuration [${world.config.activeConfiguration}] does not exist`,
      );
    }
    if (!World.keepsOrganizationOwner(world.organization.iamPolicy)) {
      return Result.err("the organization has no roles/owner member");
    }
    const projectIds = world.projects.map((p) => p.projectId);
    if (new Set(projectIds).size !== projectIds.length) {
      return Result.err("project IDs are not unique");
    }
    const bucketNames = world.buckets.map((b) => b.name);
    if (new Set(bucketNames).size !== bucketNames.length) {
      return Result.err("bucket names are not unique");
    }
    const folderIds = world.folders.map((f) => f.id);
    if (new Set(folderIds).size !== folderIds.length) {
      return Result.err("folder IDs are not unique");
    }
    const unreachableFolder = world.folders.find(
      (f) => !Option.isSome(foldersToOrganization(world, f.parent, FolderNestLimit - 1)),
    );
    if (unreachableFolder !== undefined) {
      return Result.err(
        `folder [${unreachableFolder.id}] does not reach the organization (missing parent, cycle, or nested deeper than ${FolderNestLimit})`,
      );
    }
    const unreachableProject = world.projects.find(
      (p) => !Option.isSome(foldersToOrganization(world, p.parent, FolderNestLimit)),
    );
    if (unreachableProject !== undefined) {
      return Result.err(
        `project [${unreachableProject.projectId}] does not reach the organization`,
      );
    }
    const brokenBilling = world.projects.find(
      (p) =>
        Option.isSome(p.billingAccountId) &&
        !Option.isSome(World.findBillingAccount(world, p.billingAccountId.value)),
    );
    if (brokenBilling !== undefined) {
      return Result.err(`project [${brokenBilling.projectId}] links a missing billing account`);
    }
    const collections = NamedCollectionKeys.reduce<Result<World, string>>(
      (acc, key) => Result.flatMap(acc, (w) => validateCollection(w, key)),
      Result.ok(world),
    );
    if (!Result.isOk(collections)) return collections;
    const danglingUser = world.disks.find((d) =>
      d.users.some((u) => !Option.isSome(World.findInstance(world, d.projectId, d.zone, u))),
    );
    if (danglingUser !== undefined) {
      return Result.err(`disk [${danglingUser.name}] is attached to a missing instance`);
    }
    return validateReferences(world);
  },
} as const;

/** 1 つの集合の不変条件: 同一性（名前、置き場を持つなら置き場 + 名前）が重複せず、所属プロジェクトがある。 */
const validateCollection = <K extends NamedCollection>(
  world: World,
  key: K,
): Result<World, string> => {
  const seen = new Set<string>();
  for (const item of items(world, key)) {
    const identity = identityOf(key, item);
    if (seen.has(identity)) return Result.err(`${key} [${identity}] is duplicated`);
    seen.add(identity);
    if (!World.hasProjectId(world, item.projectId)) {
      return Result.err(`${key} [${item.name}] belongs to a missing project [${item.projectId}]`);
    }
  }
  return Result.ok(world);
};

/** 集合をまたぐ参照: 購読 → トピック、ノードプールと kubectl のリソース → クラスタ、バックアップ → SQL、予算 → 請求。 */
const validateReferences = (world: World): Result<World, string> => {
  const orphanSubscription = world.pubsubSubscriptions.find(
    (s) =>
      !Option.isSome(
        World.findNamed(world, "pubsubTopics", { projectId: s.projectId, name: s.topic }),
      ),
  );
  if (orphanSubscription !== undefined) {
    return Result.err(`subscription [${orphanSubscription.name}] refers to a missing topic`);
  }
  const clusterless = [
    ...world.nodePools,
    ...world.kubeNamespaces,
    ...world.kubeDeployments,
    ...world.kubeServices,
    ...world.kubeHpas,
    ...world.kubeConfigs,
    ...world.kubeStorageClasses,
    ...world.kubePvcs,
    ...world.kubePvs,
    ...world.kubeNetworkPolicies,
  ].find((r) => !Option.isSome(World.findCluster(world, r.projectId, r.cluster)));
  if (clusterless !== undefined) {
    return Result.err(
      `[${clusterless.name}] belongs to a missing cluster [${clusterless.cluster}]`,
    );
  }
  const orphanBackup = world.sqlBackups.find(
    (b) =>
      !Option.isSome(
        World.findNamed(world, "sqlInstances", { projectId: b.projectId, name: b.instance }),
      ),
  );
  if (orphanBackup !== undefined) {
    return Result.err(`backup [${orphanBackup.id}] belongs to a missing Cloud SQL instance`);
  }
  const orphanBudget = world.budgets.find(
    (b) => !Option.isSome(World.findBillingAccount(world, b.billingAccountId)),
  );
  if (orphanBudget !== undefined) {
    return Result.err(`budget [${orphanBudget.displayName}] belongs to a missing billing account`);
  }
  return Result.ok(world);
};
