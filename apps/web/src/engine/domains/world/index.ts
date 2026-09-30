import type { ApiName, Zone } from "@/engine/domains/catalog";
import type { FirewallRule, Instance, Network, Snapshot, Subnet } from "@/engine/domains/compute";
import { GcloudConfig } from "@/engine/domains/gcloud-config";
import { IamPolicy } from "@/engine/domains/iam-policy";
import type { CloudRunService, GkeCluster } from "@/engine/domains/managed-services";
import { type MissionProgress, MissionStatuses } from "@/engine/domains/mission-progress";
import { type Operation, OperationHistoryLimit } from "@/engine/domains/operation";
import type { Principal } from "@/engine/domains/principal";
import {
  type BillingAccount,
  type Folder,
  type Organization,
  type ParentRef,
  type PolicyTarget,
  Project,
} from "@/engine/domains/resource-hierarchy";
import type { ServiceAccount } from "@/engine/domains/service-account";
import type { Bucket } from "@/engine/domains/storage";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

export type Session = Readonly<{
  principal: Principal;
  /** `gcloud auth login` で登録した疑似アカウント。`auth list` に出す */
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
  snapshots: readonly Snapshot[];
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

const replaceBy = <T>(items: readonly T[], matches: (item: T) => boolean, next: T): readonly T[] =>
  items.map((item) => (matches(item) ? next : item));

const addUnique = (
  exists: boolean,
  resource: string,
  patch: () => World,
): Result<World, AlreadyExists> => (exists ? Result.err({ resource }) : Result.ok(patch()));

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
    return world.projects.some((p) => p.projectId === projectId);
  },

  findFolder(world: World, folderId: string): Option<Folder> {
    return Option.fromNullable(world.folders.find((f) => f.id === folderId));
  },

  findBillingAccount(world: World, id: string): Option<BillingAccount> {
    return Option.fromNullable(world.billingAccounts.find((b) => b.id === id));
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
      world.projects.some((p) => p.projectId === project.projectId),
      `projects/${project.projectId}`,
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
      world.folders.some((f) => f.id === folder.id),
      `folders/${folder.id}`,
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
   * @returns 起点 → 親 → … → 組織。起点が見つからなければ起点だけ
   */
  ancestry(world: World, target: PolicyTarget): readonly PolicyTarget[] {
    const climb = (ref: ParentRef, acc: readonly PolicyTarget[]): readonly PolicyTarget[] => {
      if (ref.type === "organization") return [...acc, ref];
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
  policyOf(world: World, target: PolicyTarget): Option<IamPolicy> {
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
   * @returns 置き換えた World。リソースが無ければ `none`、組織の最後の Owner を外すなら `none`
   */
  withPolicy(world: World, target: PolicyTarget, policy: IamPolicy): Option<World> {
    switch (target.type) {
      case "organization": {
        const accepted =
          world.organization.id === target.id && World.keepsOrganizationOwner(policy);
        return accepted
          ? Option.some({ ...world, organization: { ...world.organization, iamPolicy: policy } })
          : Option.none;
      }
      case "folder":
        return Option.map(World.findFolder(world, target.id), (f) =>
          World.replaceFolder(world, { ...f, iamPolicy: policy }),
        );
      case "project":
        return Option.map(World.findProject(world, target.id), (p) =>
          World.replaceProject(world, Project.withPolicy(p, policy)),
        );
      case "bucket":
        return Option.map(World.findBucket(world, target.id), (b) =>
          World.replaceBucket(world, { ...b, iamPolicy: policy }),
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

  // --- サービスアカウント ---

  serviceAccountsOf(world: World, projectId: string): readonly ServiceAccount[] {
    return world.serviceAccounts.filter((s) => s.projectId === projectId);
  },

  findServiceAccount(world: World, email: string): Option<ServiceAccount> {
    return Option.fromNullable(world.serviceAccounts.find((s) => s.email === email));
  },

  withServiceAccount(world: World, account: ServiceAccount): Result<World, AlreadyExists> {
    return addUnique(
      world.serviceAccounts.some((s) => s.email === account.email),
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
      Option.isSome(World.findInstance(world, instance.projectId, instance.zone, instance.name)),
      `projects/${instance.projectId}/zones/${instance.zone}/instances/${instance.name}`,
      () => ({ ...world, instances: [...world.instances, instance] }),
    );
  },

  replaceInstance(world: World, instance: Instance): World {
    const same = (i: Instance) =>
      i.projectId === instance.projectId && i.zone === instance.zone && i.name === instance.name;
    return { ...world, instances: replaceBy(world.instances, same, instance) };
  },

  withoutInstance(world: World, instance: Instance): World {
    return { ...world, instances: world.instances.filter((i) => i !== instance) };
  },

  networksOf(world: World, projectId: string): readonly Network[] {
    return world.networks.filter((n) => n.projectId === projectId);
  },

  findNetwork(world: World, projectId: string, name: string): Option<Network> {
    return Option.fromNullable(
      world.networks.find((n) => n.projectId === projectId && n.name === name),
    );
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
   * @param projectId 所有プロジェクト
   * @param name ネットワーク名
   * @returns 消した World。サブネットが残っていれば `none`
   */
  withoutNetwork(world: World, projectId: string, name: string): Option<World> {
    const hasSubnets = world.subnets.some((s) => s.projectId === projectId && s.network === name);
    if (hasSubnets) return Option.none;
    return Option.some({
      ...world,
      networks: world.networks.filter((n) => !(n.projectId === projectId && n.name === name)),
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

  withoutSubnet(world: World, subnet: Subnet): World {
    return { ...world, subnets: world.subnets.filter((s) => s !== subnet) };
  },

  firewallRulesOf(world: World, projectId: string): readonly FirewallRule[] {
    return world.firewallRules.filter((r) => r.projectId === projectId);
  },

  findFirewallRule(world: World, projectId: string, name: string): Option<FirewallRule> {
    return Option.fromNullable(
      world.firewallRules.find((r) => r.projectId === projectId && r.name === name),
    );
  },

  withFirewallRule(world: World, rule: FirewallRule): Result<World, AlreadyExists> {
    return addUnique(
      Option.isSome(World.findFirewallRule(world, rule.projectId, rule.name)),
      `projects/${rule.projectId}/global/firewalls/${rule.name}`,
      () => ({ ...world, firewallRules: [...world.firewallRules, rule] }),
    );
  },

  withoutFirewallRule(world: World, projectId: string, name: string): World {
    return {
      ...world,
      firewallRules: world.firewallRules.filter(
        (r) => !(r.projectId === projectId && r.name === name),
      ),
    };
  },

  snapshotsOf(world: World, projectId: string): readonly Snapshot[] {
    return world.snapshots.filter((s) => s.projectId === projectId);
  },

  withSnapshot(world: World, snapshot: Snapshot): Result<World, AlreadyExists> {
    return addUnique(
      world.snapshots.some((s) => s.projectId === snapshot.projectId && s.name === snapshot.name),
      `projects/${snapshot.projectId}/global/snapshots/${snapshot.name}`,
      () => ({ ...world, snapshots: [...world.snapshots, snapshot] }),
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
      `buckets/${bucket.name}`,
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
    return Option.fromNullable(
      world.clusters.find((c) => c.projectId === projectId && c.name === name),
    );
  },

  withCluster(world: World, cluster: GkeCluster): Result<World, AlreadyExists> {
    return addUnique(
      Option.isSome(World.findCluster(world, cluster.projectId, cluster.name)),
      `projects/${cluster.projectId}/locations/${cluster.location}/clusters/${cluster.name}`,
      () => ({ ...world, clusters: [...world.clusters, cluster] }),
    );
  },

  withoutCluster(world: World, projectId: string, name: string): World {
    return {
      ...world,
      clusters: world.clusters.filter((c) => !(c.projectId === projectId && c.name === name)),
    };
  },

  runServicesOf(world: World, projectId: string): readonly CloudRunService[] {
    return world.runServices.filter((s) => s.projectId === projectId);
  },

  findRunService(world: World, projectId: string, name: string): Option<CloudRunService> {
    return Option.fromNullable(
      world.runServices.find((s) => s.projectId === projectId && s.name === name),
    );
  },

  /** `run deploy` は同名なら新しいリビジョンとして置き換えるので、重複を弾かない。 */
  withRunService(world: World, service: CloudRunService): World {
    const others = world.runServices.filter(
      (s) => !(s.projectId === service.projectId && s.name === service.name),
    );
    return { ...world, runServices: [...others, service] };
  },

  withoutRunService(world: World, projectId: string, name: string): World {
    return {
      ...world,
      runServices: world.runServices.filter((s) => !(s.projectId === projectId && s.name === name)),
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
   * プリンシパルを切り替える。`core/account` も揃える（`config set account` と `auth login` の両方の入口）。
   *
   * @param world 元
   * @param principal 次の主体。未知のメールでも受け付ける（11.2: 認証は疑似）
   * @returns 主体・アカウント一覧・`core/account` を更新した World
   */
  withPrincipal(world: World, principal: Principal): World {
    const accounts = world.session.accounts.includes(principal)
      ? world.session.accounts
      : [...world.session.accounts, principal];
    return {
      ...world,
      session: { principal, accounts },
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

  findMission(world: World, id: string): Option<MissionProgress> {
    return Option.fromNullable(world.missions.find((m) => m.id === id));
  },

  replaceMission(world: World, progress: MissionProgress): World {
    return { ...world, missions: replaceBy(world.missions, (m) => m.id === progress.id, progress) };
  },

  missionsInProgress(world: World): readonly MissionProgress[] {
    return world.missions.filter((m) => m.status === MissionStatuses.InProgress);
  },

  // --- 不変条件 ---

  /**
   * 設計書 6.2 の不変条件を確かめる。import とミッションの setup の後に通す。
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
    const orphanProject = world.projects.find((p) => !World.hasParent(world, p.parent));
    if (orphanProject !== undefined) {
      return Result.err(`project [${orphanProject.projectId}] has a missing parent`);
    }
    const orphanFolder = world.folders.find((f) => !World.hasParent(world, f.parent));
    if (orphanFolder !== undefined) {
      return Result.err(`folder [${orphanFolder.id}] has a missing parent`);
    }
    const brokenBilling = world.projects.find(
      (p) =>
        Option.isSome(p.billingAccountId) &&
        !Option.isSome(World.findBillingAccount(world, p.billingAccountId.value)),
    );
    if (brokenBilling !== undefined) {
      return Result.err(`project [${brokenBilling.projectId}] links a missing billing account`);
    }
    return Result.ok(world);
  },
} as const;
