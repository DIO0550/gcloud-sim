import type { ApiName, Zone } from "@/engine/domains/catalog";
import type {
  DiskSnapshot,
  FirewallRule,
  Instance,
  Network,
  Subnet,
} from "@/engine/domains/compute";
import { GcloudConfig } from "@/engine/domains/gcloud-config";
import { IamPolicy } from "@/engine/domains/iam-policy";
import type { CloudRunService, GkeCluster } from "@/engine/domains/managed-services";
import { MissionProgress } from "@/engine/domains/mission-progress";
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
import type { ServiceAccount } from "@/engine/domains/service-account";
import { Bucket } from "@/engine/domains/storage";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

/** `gcloud auth login` で登録した疑似アカウント。今の主体は `core/account`（`World.currentPrincipal`）が正。 */
export type Session = Readonly<{
  accounts: readonly Principal[];
}>;

/**
 * エミュレータが保持する全リソースの集合（設計書 6.2 World）。
 * リソースはフラットな集合で持ち、階層は `projectId` / `parent` で結ぶ。
 * スキーマのバージョンは World ではなく Snapshot（`engine/snapshot`）が持つ。
 */
export type World = Readonly<{
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
      case "bucket": {
        const bucket = World.findBucket(world, target.id);
        return Option.isSome(bucket)
          ? [target, ...World.ancestry(world, { type: "project", id: bucket.value.projectId })]
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
      case "bucket":
        return Option.map(World.findBucket(world, target.id), (b) => b.iamPolicy);
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
      case "bucket":
        return Option.toResult(
          Option.map(World.findBucket(world, target.id), (b) =>
            World.replaceBucket(world, Bucket.withPolicy(b, policy)),
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

  withoutServiceAccount(world: World, email: string): World {
    return { ...world, serviceAccounts: world.serviceAccounts.filter((s) => s.email !== email) };
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
    return world.networks.filter((n) => n.projectId === projectId);
  },

  findNetwork(world: World, projectId: string, name: string): Option<Network> {
    return Option.fromNullable(world.networks.find(sameInProject(projectId, name)));
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
    return Option.fromNullable(
      world.subnets.find(
        (s) => s.projectId === projectId && s.region === region && s.name === name,
      ),
    );
  },

  withSubnet(world: World, subnet: Subnet): Result<World, AlreadyExists> {
    return addUnique(
      Option.isSome(World.findSubnet(world, subnet.projectId, subnet.region, subnet.name)),
      `projects/${subnet.projectId}/regions/${subnet.region}/subnetworks/${subnet.name}`,
      () => ({ ...world, subnets: [...world.subnets, subnet] }),
    );
  },

  firewallRulesOf(world: World, projectId: string): readonly FirewallRule[] {
    return world.firewallRules.filter((r) => r.projectId === projectId);
  },

  findFirewallRule(world: World, projectId: string, name: string): Option<FirewallRule> {
    return Option.fromNullable(world.firewallRules.find(sameInProject(projectId, name)));
  },

  withFirewallRule(world: World, rule: FirewallRule): Result<World, AlreadyExists> {
    return addUnique(
      Option.isSome(World.findFirewallRule(world, rule.projectId, rule.name)),
      `projects/${rule.projectId}/global/firewalls/${rule.name}`,
      () => ({ ...world, firewallRules: [...world.firewallRules, rule] }),
    );
  },

  withoutFirewallRule(world: World, rule: FirewallRule): World {
    return {
      ...world,
      firewallRules: world.firewallRules.filter(
        (r) => !sameInProject(rule.projectId, rule.name)(r),
      ),
    };
  },

  diskSnapshotsOf(world: World, projectId: string): readonly DiskSnapshot[] {
    return world.diskSnapshots.filter((s) => s.projectId === projectId);
  },

  withDiskSnapshot(world: World, snapshot: DiskSnapshot): Result<World, AlreadyExists> {
    return addUnique(
      world.diskSnapshots.some(sameInProject(snapshot.projectId, snapshot.name)),
      `projects/${snapshot.projectId}/global/snapshots/${snapshot.name}`,
      () => ({ ...world, diskSnapshots: [...world.diskSnapshots, snapshot] }),
    );
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
    return world.clusters.filter((c) => c.projectId === projectId);
  },

  findCluster(world: World, projectId: string, name: string): Option<GkeCluster> {
    return Option.fromNullable(world.clusters.find(sameInProject(projectId, name)));
  },

  withCluster(world: World, cluster: GkeCluster): Result<World, AlreadyExists> {
    return addUnique(
      Option.isSome(World.findCluster(world, cluster.projectId, cluster.name)),
      `projects/${cluster.projectId}/locations/${cluster.location}/clusters/${cluster.name}`,
      () => ({ ...world, clusters: [...world.clusters, cluster] }),
    );
  },

  withoutCluster(world: World, cluster: GkeCluster): World {
    return {
      ...world,
      clusters: world.clusters.filter((c) => !sameInProject(cluster.projectId, cluster.name)(c)),
    };
  },

  runServicesOf(world: World, projectId: string): readonly CloudRunService[] {
    return world.runServices.filter((s) => s.projectId === projectId);
  },

  findRunService(world: World, projectId: string, name: string): Option<CloudRunService> {
    return Option.fromNullable(world.runServices.find(sameInProject(projectId, name)));
  },

  /** `run deploy` は同名なら新しいリビジョンとして置き換えるので、重複を弾かず上書きする。 */
  withRunServiceReplaced(world: World, service: CloudRunService): World {
    const others = world.runServices.filter(
      (s) => !sameInProject(service.projectId, service.name)(s),
    );
    return { ...world, runServices: [...others, service] };
  },

  withoutRunService(world: World, service: CloudRunService): World {
    return {
      ...world,
      runServices: world.runServices.filter(
        (s) => !sameInProject(service.projectId, service.name)(s),
      ),
    };
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
      session: { accounts },
      config: GcloudConfig.set(world.config, "core/account", principal),
    };
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
    const orphanInstance = world.instances.find((i) => !World.hasProjectId(world, i.projectId));
    if (orphanInstance !== undefined) {
      return Result.err(`instance [${orphanInstance.name}] belongs to a missing project`);
    }
    return Result.ok(world);
  },
} as const;
