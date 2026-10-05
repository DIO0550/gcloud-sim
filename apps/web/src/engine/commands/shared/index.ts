import { CommandFailure } from "@/engine/cli/command-failure";
import {
  type AuthorizedContext,
  type CandidateSource,
  type CommandContext,
  CommandOutput,
  type CommandResult,
  type CommandSpec,
  Flag,
  type FlagSpec,
  type JsonRecord,
  OutputMessage,
  ParsedArgs,
  Positional,
  type PositionalSpec,
  type ProjectContext,
  type TargetContext,
  type TargetResolver,
} from "@/engine/cli/command-spec";
import { Budget } from "@/engine/domains/billing-budget";
import {
  type ApiName,
  ApiService,
  MachineType,
  PublicImage,
  Region,
  type Zone,
  Zone as ZoneCatalog,
} from "@/engine/domains/catalog";
import { Instance } from "@/engine/domains/compute";
import { ConfigProperty, GcloudConfig } from "@/engine/domains/gcloud-config";
import { IamMember, IamPolicy, RoleName } from "@/engine/domains/iam-policy";
import { KubeNamespace } from "@/engine/domains/kube-namespace";
import { KubeStorage } from "@/engine/domains/kube-storage";
import { Operation, type OperationType } from "@/engine/domains/operation";
import type { Principal } from "@/engine/domains/principal";
import { PolicyTarget } from "@/engine/domains/resource-hierarchy";
import { CustomRole, RoleCatalog } from "@/engine/domains/role-catalog";
import { ServiceAccount } from "@/engine/domains/service-account";
import {
  type AlreadyExists,
  type LocatedCollection,
  type NamedCollection,
  type NamedItem,
  type PolicyRejected,
  World,
} from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

/** プロジェクトが決まっているときだけ World の集合から引く候補。 */
const inProject =
  (pick: (world: World, projectId: string) => readonly string[]): CandidateSource =>
  (world, projectId) =>
    Option.isSome(projectId) ? pick(world, projectId.value) : [];

/** `(projectId, name)` で引ける集合の名前を候補にする。 */
const named = (key: NamedCollection): CandidateSource =>
  inProject((world, projectId) => World.namedOf(world, key, projectId).map((item) => item.name));

/**
 * Tab 補完の候補（TBD-009）。位置引数と `string` のフラグの定義に付ける。
 * World に依るものはプロジェクトの集合から、依らないものはカタログから引く。
 */
export const Candidates = {
  zones: (): readonly string[] => ZoneCatalog.all(),
  regions: (): readonly string[] => Region.all(),
  machineTypes: (): readonly string[] => MachineType.all().map((m) => m.name),
  imageFamilies: (): readonly string[] => [...new Set(PublicImage.all().map((i) => i.family))],
  apis: (): readonly string[] => ApiService.all().map((a) => a.name),
  configProperties: (): readonly string[] => ConfigProperty.all(),
  projects: ((world) =>
    World.activeProjects(world).map((p) => p.projectId)) satisfies CandidateSource,
  accounts: ((world) => world.session.accounts) satisfies CandidateSource,
  billingAccounts: ((world) => world.billingAccounts.map((b) => b.id)) satisfies CandidateSource,
  folders: ((world) => world.folders.map((f) => f.id)) satisfies CandidateSource,
  instances: inProject((world, projectId) =>
    World.instancesOf(world, projectId).map((i) => i.name),
  ),
  networks: inProject((world, projectId) => World.networksOf(world, projectId).map((n) => n.name)),
  subnets: inProject((world, projectId) => World.subnetsOf(world, projectId).map((s) => s.name)),
  firewallRules: inProject((world, projectId) =>
    World.firewallRulesOf(world, projectId).map((r) => r.name),
  ),
  disks: inProject((world, projectId) => [
    ...World.disksOf(world, projectId).map((d) => d.name),
    ...World.instancesOf(world, projectId).flatMap((i) => i.disks.map((d) => d.deviceName)),
  ]),
  /** `gs://` 付きで返す（打ちかけの語が `gs://b` の形なので） */
  buckets: inProject((world, projectId) =>
    World.bucketsOf(world, projectId).map((b) => `gs://${b.name}`),
  ),
  clusters: inProject((world, projectId) => World.clustersOf(world, projectId).map((c) => c.name)),
  runServices: inProject((world, projectId) =>
    World.runServicesOf(world, projectId).map((s) => s.name),
  ),
  serviceAccounts: inProject((world, projectId) => {
    const project = World.findProject(world, projectId);
    const own = World.serviceAccountsOf(world, projectId).map((s) => s.email);
    return Option.isSome(project)
      ? [ServiceAccount.defaultComputeEmail(project.value.projectNumber), ...own]
      : own;
  }),
  /** `user:` / `serviceAccount:` を付けたメンバー。ログイン済みのアカウントと SA から */
  members: inProject((world, projectId) => [
    ...world.session.accounts.map((a) => `user:${a}`),
    ...World.serviceAccountsOf(world, projectId).map((s) => `serviceAccount:${s.email}`),
    "allUsers",
    "allAuthenticatedUsers",
  ]),
  /** カタログのロールと、そのプロジェクトのカスタムロール */
  roles: ((world, projectId) => [
    ...RoleCatalog.all().map((r) => r.name),
    ...(Option.isSome(projectId)
      ? World.customRolesOf(world, projectId.value).map(CustomRole.name)
      : []),
  ]) satisfies CandidateSource,
  named,
  instanceTemplates: named("instanceTemplates"),
  instanceGroups: named("instanceGroups"),
  healthChecks: named("healthChecks"),
  backendServices: named("backendServices"),
  addresses: named("addresses"),
  functions: named("functions"),
  sqlInstances: named("sqlInstances"),
  pubsubTopics: named("pubsubTopics"),
  pubsubSubscriptions: named("pubsubSubscriptions"),
  forwardingRules: named("forwardingRules"),
  routers: named("routers"),
  logSinks: named("logSinks"),
  kmsKeyRings: named("kmsKeyRings"),
  dnsZones: named("dnsZones"),
  dmDeployments: named("dmDeployments"),
  diskSnapshots: named("diskSnapshots"),
  /** kubectl が扱うのは `container/cluster` のクラスタだけなので、候補もそのクラスタのもの */
  kubeNamespaces: inProject((world, projectId) => {
    const cluster = Option.flatMap(GcloudConfig.get(world.config, "container/cluster"), (name) =>
      World.findCluster(world, projectId, name),
    );
    return Option.isSome(cluster) ? KubeNamespace.of(world, cluster.value).map((n) => n.name) : [];
  }),
  kubeDeployments: inProject((world, projectId) => {
    const cluster = Option.flatMap(GcloudConfig.get(world.config, "container/cluster"), (name) =>
      World.findCluster(world, projectId, name),
    );
    return Option.isSome(cluster)
      ? Array.from(
          new Set(
            world.kubeDeployments
              .filter((d) => d.projectId === projectId && d.cluster === cluster.value.name)
              .map((d) => d.name),
          ),
        )
      : [];
  }),
  kubeStorage: ((world, projectId, positionals = []) => {
    if (!Option.isSome(projectId)) return [];
    const cluster = GcloudConfig.get(world.config, "container/cluster");
    if (!Option.isSome(cluster)) return [];
    const type = (positionals[0] ?? "").split("/")[0]?.toLowerCase() ?? "";
    const items = [
      "sc",
      "storageclass",
      "storageclasses",
      "storageclasses.storage.k8s.io",
    ].includes(type)
      ? KubeStorage.classes(world, { projectId: projectId.value, name: cluster.value })
      : ["pv", "persistentvolume", "persistentvolumes"].includes(type)
        ? world.kubePvs
        : world.kubePvcs;
    return items
      .filter((r) => r.projectId === projectId.value && r.cluster === cluster.value)
      .map((r) => r.name);
  }) satisfies CandidateSource,
  kubeIngresses: inProject((world, projectId) => {
    const cluster = GcloudConfig.get(world.config, "container/cluster");
    if (!Option.isSome(cluster)) return [];
    return world.kubeIngresses
      .filter((p) => p.projectId === projectId && p.cluster === cluster.value)
      .map((p) => p.name);
  }),
  kubeNetworkPolicies: inProject((world, projectId) => {
    const cluster = GcloudConfig.get(world.config, "container/cluster");
    if (!Option.isSome(cluster)) return [];
    return world.kubeNetworkPolicies
      .filter((p) => p.projectId === projectId && p.cluster === cluster.value)
      .map((p) => p.name);
  }),
  kubeHpas: inProject((world, projectId) => {
    const cluster = GcloudConfig.get(world.config, "container/cluster");
    if (!Option.isSome(cluster)) return [];
    return world.kubeHpas
      .filter((h) => h.projectId === projectId && h.cluster === cluster.value)
      .map((h) => h.name);
  }),
  kubeConfigs: inProject((world, projectId) => {
    const cluster = GcloudConfig.get(world.config, "container/cluster");
    if (!Option.isSome(cluster)) return [];
    return world.kubeConfigs
      .filter((c) => c.projectId === projectId && c.cluster === cluster.value)
      .map((c) => `${c.kind}/${c.name}`);
  }),
  budgets: ((world) => world.budgets.map(Budget.id)) satisfies CandidateSource,
} as const;

/** 複数のサービスが同じ綴りで受けるフラグ。 */
export const CommonFlags = {
  zone: Flag.string("zone", "Zone of the resource. Overrides the default compute/zone property.", {
    candidates: Candidates.zones,
  }),
  region: Flag.string(
    "region",
    "Region of the resource. Overrides the default compute/region property.",
    { candidates: Candidates.regions },
  ),
  async: Flag.boolean(
    "async",
    "Return immediately, without waiting for the operation in progress to complete.",
  ),
  member: Flag.string(
    "member",
    "The principal to add the binding for. Should be of the form user|group|serviceAccount:email or domain:domain.",
    { required: true, candidates: Candidates.members },
  ),
  role: Flag.string("role", "The role name to assign to the principal (e.g. roles/viewer).", {
    required: true,
    candidates: Candidates.roles,
  }),
} as const;

/** `AlreadyExists` を E-008 に写す。 */
export const alreadyExists = (failure: AlreadyExists): CommandFailure =>
  CommandFailure.alreadyExists(failure.resource);

/** `PolicyRejected` を E-005 / E-012 に写す。 */
const policyRejected = (rejected: PolicyRejected): CommandFailure => {
  switch (rejected.kind) {
    case "not-found":
      return CommandFailure.notFound(PolicyTarget.toPath(rejected.target));
    case "last-owner":
      return CommandFailure.lastOwner();
  }
};

/** `recordOperation` に渡す材料。通し番号は中で払い出す。 */
export type OperationRecordSeed = Readonly<{
  projectId: string;
  operationType: OperationType;
  targetLink: string;
  targetName: string;
  zone: Option<Zone>;
  user: Principal;
  now: string;
}>;

/**
 * オペレーションを履歴に足す（DJ-008: 即座に `DONE`）。
 *
 * @param world 元
 * @param seed 対象・種類・実行者・時刻
 * @returns 足した後の World と、作ったオペレーション
 */
export const recordOperation = (
  world: World,
  seed: OperationRecordSeed,
): Readonly<{ world: World; operation: Operation }> => {
  const numbered = World.nextNumber(world);
  const operation = Operation.create({ ...seed, sequence: numbered.number });
  return { world: World.withOperation(numbered.world, operation), operation };
};

/**
 * インスタンスを対象にしたオペレーションの材料。compute の各コマンドが同じ形で組む。
 *
 * @param instance 対象
 * @param operationType 種類
 * @param ctx 実行者と時刻を持つ文脈
 * @returns `recordOperation` に渡す材料
 */
export const instanceOperationSeed = (
  instance: Instance,
  operationType: OperationType,
  ctx: AuthorizedContext,
): OperationRecordSeed => ({
  projectId: instance.projectId,
  operationType,
  targetLink: Instance.selfLink(instance),
  targetName: instance.name,
  zone: Option.some(instance.zone),
  user: ctx.principal,
  now: ctx.now,
});

/**
 * `--member` / `--role` を検証する。ロールはカタログか World のカスタムロールにあるものだけ。
 *
 * @param world カスタムロールを引く World
 * @param args 引数
 * @returns メンバーとロール。形式不正・未知のロールは E-009
 */
export const parseBinding = (
  world: World,
  args: ParsedArgs,
): Result<Readonly<{ member: IamMember; role: RoleName }>, CommandFailure> => {
  const rawRole = ParsedArgs.requiredString(args, "role");
  const member = Result.mapErr(
    IamMember.parse(ParsedArgs.requiredString(args, "member")),
    CommandFailure.invalidIamArgument,
  );
  if (!Result.isOk(member)) return member;
  const role = Option.filter(RoleName.parse(rawRole), (name) => World.isKnownRole(world, name));
  if (!Option.isSome(role)) {
    return Result.err(
      CommandFailure.invalidIamArgument(
        `INVALID_ARGUMENT: Role ${rawRole} is not supported for this resource.`,
      ),
    );
  }
  return Result.ok({ member: member.value, role: role.value });
};

type BindingCommandSeed = Readonly<{
  /** `["gcloud", "projects"]` のようなグループ */
  group: readonly string[];
  positional: PositionalSpec;
  /** `project [ace-dev-01]` のような、メッセージに出す綴り */
  label: (target: PolicyTarget) => string;
  resolveTarget: TargetResolver;
  permissions: Readonly<{ get: string; set: string }>;
}>;

const requirePolicy = (ctx: TargetContext): Result<IamPolicy, CommandFailure> =>
  Option.toResult(World.findPolicy(ctx.world, ctx.target), () =>
    CommandFailure.notFound(PolicyTarget.toPath(ctx.target)),
  );

const bindingRun =
  (seed: BindingCommandSeed, direction: "add" | "remove") =>
  (ctx: TargetContext, args: ParsedArgs): CommandResult => {
    const binding = parseBinding(ctx.world, args);
    if (!Result.isOk(binding)) return binding;
    const current = requirePolicy(ctx);
    if (!Result.isOk(current)) return current;
    const { member, role } = binding.value;
    const next =
      direction === "add"
        ? Option.some(IamPolicy.addBinding(current.value, role, member))
        : IamPolicy.removeBinding(current.value, role, member);
    if (!Option.isSome(next)) {
      return Result.err(
        CommandFailure.notFoundWith(
          "Policy binding with the specified principal, role, and condition not found!",
        ),
      );
    }
    const world = Result.mapErr(
      World.withPolicy(ctx.world, ctx.target, next.value),
      policyRejected,
    );
    return Result.map(world, (w) => ({
      world: w,
      output: CommandOutput.yaml(IamPolicy.toRecord(next.value), [
        OutputMessage.plain(`Updated IAM policy for ${seed.label(ctx.target)}.`),
      ]),
    }));
  };

/**
 * `get-iam-policy` / `add-iam-policy-binding` / `remove-iam-policy-binding` の 3 つを、
 * 対象（組織・フォルダ・プロジェクト・バケット）ごとに同じ形で作る。
 *
 * @param seed 対象の解決と権限
 * @returns 3 つのコマンド定義
 */
export const iamBindingCommands = (seed: BindingCommandSeed): readonly CommandSpec[] => [
  targetCommand({
    path: [...seed.group, "get-iam-policy"],
    summary: "Get the IAM policy for a resource.",
    positionals: [seed.positional],
    permission: seed.permissions.get,
    resolveTarget: seed.resolveTarget,
    run: (ctx) =>
      Result.map(requirePolicy(ctx), (policy) => ({
        world: ctx.world,
        output: CommandOutput.yaml(IamPolicy.toRecord(policy)),
      })),
  }),
  targetCommand({
    path: [...seed.group, "add-iam-policy-binding"],
    summary: "Add an IAM policy binding to a resource.",
    positionals: [seed.positional],
    flags: [CommonFlags.member, CommonFlags.role],
    permission: seed.permissions.set,
    resolveTarget: seed.resolveTarget,
    run: bindingRun(seed, "add"),
  }),
  targetCommand({
    path: [...seed.group, "remove-iam-policy-binding"],
    summary: "Remove an IAM policy binding from a resource.",
    positionals: [seed.positional],
    flags: [CommonFlags.member, CommonFlags.role],
    permission: seed.permissions.set,
    resolveTarget: seed.resolveTarget,
    run: bindingRun(seed, "remove"),
  }),
];

/** `describe` が引く 1 件の指し方。置き場を持たない集合は `location` が `none`。 */
export type NamedRef = Readonly<{ projectId: string; name: string; location: Option<string> }>;

type DescribeNamedCommandBase<K extends NamedCollection> = Readonly<{
  path: readonly string[];
  summary: string;
  /** 位置引数の名前と説明。候補は集合から導く */
  positional: Readonly<{ name: string; description: string }>;
  collection: K;
  permission: string;
  requiredApis?: readonly ApiName[];
  /** E-005 に出す綴り */
  resourcePath: (ref: NamedRef) => string;
  record: (item: NamedItem<K>) => JsonRecord;
}>;

/**
 * `describeNamedCommand` の材料。置き場を持つ集合（`LocatedCollection`）は、`--zone` / `--region` /
 * `--global` から置き場を解決する `locate` を持ち、違う置き場の同名は見つからない（本物と同じ）。
 */
export type DescribeNamedCommandSeed<K extends NamedCollection> = DescribeNamedCommandBase<K> &
  (
    | Readonly<{ flags?: readonly FlagSpec[]; locate?: never }>
    | Readonly<{
        collection: K & LocatedCollection;
        flags: readonly FlagSpec[];
        locate: (ctx: ProjectContext, args: ParsedArgs) => Result<string, CommandFailure>;
      }>
  );

const findForDescribe = <K extends NamedCollection>(
  ctx: ProjectContext,
  args: ParsedArgs,
  seed: DescribeNamedCommandSeed<K>,
): Result<NamedItem<K>, CommandFailure> => {
  const projectId = ctx.project.projectId;
  const name = ParsedArgs.requiredPositional(args, 0);
  if (seed.locate === undefined) {
    return Option.toResult(World.findNamed(ctx.world, seed.collection, { projectId, name }), () =>
      CommandFailure.notFound(seed.resourcePath({ projectId, name, location: Option.none })),
    );
  }
  return Result.flatMap(seed.locate(ctx, args), (location) =>
    Option.toResult(
      World.findLocated(ctx.world, seed.collection, { projectId, location, name }),
      () =>
        CommandFailure.notFound(
          seed.resourcePath({ projectId, name, location: Option.some(location) }),
        ),
    ),
  );
};

/**
 * 名前で引ける集合の 1 件を YAML で出す `describe` を組む。
 *
 * @param seed 集合と、出す形
 * @returns コマンド定義。無ければ E-005
 */
export const describeNamedCommand = <K extends NamedCollection>(
  seed: DescribeNamedCommandSeed<K>,
): CommandSpec =>
  projectCommand({
    path: seed.path,
    summary: seed.summary,
    positionals: [
      Positional.required(
        seed.positional.name,
        seed.positional.description,
        Candidates.named(seed.collection),
      ),
    ],
    flags: seed.flags,
    permission: seed.permission,
    requiredApis: seed.requiredApis,
    run: (ctx, args) =>
      Result.map(findForDescribe(ctx, args, seed), (item) => ({
        world: ctx.world,
        output: CommandOutput.yaml(seed.record(item)),
      })),
  });

/** 未対応コマンドの定義（DJ-005）。 */
export const notImplemented = (path: readonly string[], summary: string): CommandSpec => ({
  kind: "not-implemented",
  path,
  summary,
});

/** 3 種の定義に共通の材料。省いた項目は「引数なし・フラグなし・確認なし」。 */
type SeedBase = Readonly<{
  path: readonly string[];
  summary: string;
  positionals?: readonly PositionalSpec[];
  flags?: readonly FlagSpec[];
  destructive?: boolean;
}>;

/** 要求する権限。ほとんどのコマンドは 1 つなので `permission`、複数なら `permissions`。 */
type Permissioned =
  | Readonly<{ permission: string; permissions?: never }>
  | Readonly<{ permissions: readonly string[]; permission?: never }>;

const permissionsOf = (seed: Permissioned): readonly string[] =>
  seed.permissions === undefined ? [seed.permission] : seed.permissions;

/** `kind: "project"` の定義の材料。API 検証は省ける。 */
export type ProjectCommandSeed = SeedBase &
  Permissioned &
  Readonly<{
    requiredApis?: readonly ApiName[];
    run: (ctx: ProjectContext, args: ParsedArgs) => CommandResult;
  }>;

/** `kind: "target"` の定義の材料。 */
export type TargetCommandSeed = SeedBase &
  Permissioned &
  Readonly<{
    resolveTarget: TargetResolver;
    run: (ctx: TargetContext, args: ParsedArgs) => CommandResult;
  }>;

/** `kind: "plain"` の定義の材料。 */
export type PlainCommandSeed = SeedBase &
  Readonly<{ run: (ctx: CommandContext, args: ParsedArgs) => CommandResult }>;

const base = (seed: SeedBase) => ({
  path: seed.path,
  summary: seed.summary,
  positionals: seed.positionals ?? [],
  flags: seed.flags ?? [],
  destructive: seed.destructive ?? false,
});

/**
 * `kind: "project"` の定義を材料から組む。
 *
 * @param seed 材料
 * @returns コマンド定義
 */
export const projectCommand = (seed: ProjectCommandSeed): CommandSpec => ({
  kind: "project",
  ...base(seed),
  requiredPermissions: permissionsOf(seed),
  requiredApis: seed.requiredApis ?? [],
  run: seed.run,
});

/**
 * `kind: "target"` の定義を材料から組む。
 *
 * @param seed 材料
 * @returns コマンド定義
 */
export const targetCommand = (seed: TargetCommandSeed): CommandSpec => ({
  kind: "target",
  ...base(seed),
  requiredPermissions: permissionsOf(seed),
  resolveTarget: seed.resolveTarget,
  run: seed.run,
});

/**
 * `kind: "plain"` の定義を材料から組む。
 *
 * @param seed 材料
 * @returns コマンド定義
 */
export const plainCommand = (seed: PlainCommandSeed): CommandSpec => ({
  kind: "plain",
  ...base(seed),
  run: seed.run,
});
