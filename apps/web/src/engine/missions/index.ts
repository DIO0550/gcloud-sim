import type { Zone } from "@/engine/domains/catalog";
import { EffectivePermissions } from "@/engine/domains/effective-permissions";
import { GcloudConfig } from "@/engine/domains/gcloud-config";
import { type IamMember, IamPolicy, type RoleName } from "@/engine/domains/iam-policy";
import { MissionProgress, MissionStatuses } from "@/engine/domains/mission-progress";
import type { PolicyTarget } from "@/engine/domains/resource-hierarchy";
import { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { ValueOf } from "@/types/ValueOf";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

/** ACE の 5 ドメイン（設計書 6.2 Mission.domain）。 */
export const MissionDomains = {
  Setup: "環境セットアップ",
  Planning: "計画と構成",
  Deploy: "デプロイと実装",
  Operations: "運用の維持",
  Security: "アクセスとセキュリティ",
} as const;
export type MissionDomain = ValueOf<typeof MissionDomains>;

/** World に対する述語（DJ-010: コマンド文字列ではなく状態で判定する）。 */
export type MissionAssertion =
  | Readonly<{ kind: "billingLinked"; projectId: string }>
  | Readonly<{ kind: "apiEnabled"; projectId: string; api: string }>
  | Readonly<{
      kind: "configurationProperty";
      configuration: string;
      property: "core/project" | "compute/zone" | "compute/region";
      value: string;
    }>
  | Readonly<{
      kind: "networkExists";
      projectId: string;
      name: string;
      subnetMode: "AUTO" | "CUSTOM";
    }>
  | Readonly<{
      kind: "subnetExists";
      projectId: string;
      name: string;
      region: string;
      ipCidrRange: string;
    }>
  | Readonly<{ kind: "serviceAccountExists"; projectId: string; accountId: string }>
  | Readonly<{ kind: "bindingExists"; target: PolicyTarget; role: RoleName; member: IamMember }>
  | Readonly<{ kind: "bindingAbsent"; target: PolicyTarget; role: RoleName; member: IamMember }>
  | Readonly<{
      kind: "instanceExists";
      projectId: string;
      name: string;
      zone: Zone;
      machineType: Option<string>;
      tags: readonly string[];
      status: Option<"RUNNING" | "TERMINATED" | "SUSPENDED">;
    }>
  | Readonly<{
      kind: "firewallRuleExists";
      projectId: string;
      name: string;
      allow: string;
      targetTag: string;
    }>
  | Readonly<{ kind: "bucketExists"; name: string; location: string; storageClass: string }>
  | Readonly<{
      kind: "clusterExists";
      projectId: string;
      name: string;
      autopilot: boolean;
      location: string;
    }>
  | Readonly<{ kind: "snapshotExists"; projectId: string; name: string }>
  | Readonly<{
      kind: "runServiceExists";
      projectId: string;
      name: string;
      region: string;
      allowUnauthenticated: boolean;
    }>
  | Readonly<{
      kind: "effectivePermission";
      projectId: string;
      member: IamMember;
      permission: string;
    }>;

/** ミッション開始時に World へ当てる変更（設計書 6.2 Mission.setup）。 */
export type WorldPatch =
  | Readonly<{ kind: "setPrincipal"; principal: string }>
  | Readonly<{ kind: "setProject"; projectId: string }>
  | Readonly<{ kind: "removeBinding"; target: PolicyTarget; role: RoleName; member: IamMember }>
  | Readonly<{ kind: "ensureInstance"; projectId: string; name: string; zone: Zone }>;

export type Mission = Readonly<{
  id: string;
  domain: MissionDomain;
  title: string;
  description: string;
  hints: readonly string[];
  setup: readonly WorldPatch[];
  assertions: readonly MissionAssertion[];
}>;

/** setup が不変条件を壊した（E-015）。開発者向けの理由を持つ。 */
export type MissionSetupFailure = Readonly<{ missionId: string; reason: string }>;

const devProject: PolicyTarget = { type: "project", id: F.devProjectId };
const devFolder: PolicyTarget = { type: "folder", id: F.devFolderId };
const organization: PolicyTarget = { type: "organization", id: F.organizationId };

const Missions: readonly Mission[] = [
  {
    id: "m-setup-001",
    domain: MissionDomains.Setup,
    title: "ace-prod-01 で Compute Engine を使えるようにする",
    description:
      "プロジェクト ace-prod-01 に請求アカウントをリンクし、Compute Engine API を有効化してください。",
    hints: [
      "請求アカウントの ID は gcloud billing accounts list で確認できます。",
      "gcloud billing projects link ace-prod-01 --billing-account=ACCOUNT_ID でリンクします。",
      "API の有効化は gcloud services enable compute.googleapis.com --project=ace-prod-01 です。",
    ],
    setup: [],
    assertions: [
      { kind: "billingLinked", projectId: F.prodProjectId },
      { kind: "apiEnabled", projectId: F.prodProjectId, api: "compute.googleapis.com" },
    ],
  },
  {
    id: "m-setup-002",
    domain: MissionDomains.Setup,
    title: "本番用の configuration を用意する",
    description:
      "configuration `prod` を作り、その中で core/project を ace-prod-01、compute/zone を asia-northeast1-a に設定してください。",
    hints: [
      "gcloud config configurations create prod で作成と同時にアクティブになります。",
      "gcloud config set project ace-prod-01 / gcloud config set compute/zone asia-northeast1-a",
    ],
    setup: [],
    assertions: [
      {
        kind: "configurationProperty",
        configuration: "prod",
        property: "core/project",
        value: F.prodProjectId,
      },
      {
        kind: "configurationProperty",
        configuration: "prod",
        property: "compute/zone",
        value: "asia-northeast1-a",
      },
    ],
  },
  {
    id: "m-plan-001",
    domain: MissionDomains.Planning,
    title: "カスタムモードの VPC を設計する",
    description:
      "ace-dev-01 にカスタム サブネット モードの VPC `vpc-app` を作り、asia-northeast1 にサブネット `app-subnet`（10.10.0.0/24）を作ってください。",
    hints: [
      "gcloud compute networks create vpc-app --subnet-mode=custom",
      "gcloud compute networks subnets create app-subnet --network=vpc-app --region=asia-northeast1 --range=10.10.0.0/24",
    ],
    setup: [{ kind: "setProject", projectId: F.devProjectId }],
    assertions: [
      { kind: "networkExists", projectId: F.devProjectId, name: "vpc-app", subnetMode: "CUSTOM" },
      {
        kind: "subnetExists",
        projectId: F.devProjectId,
        name: "app-subnet",
        region: "asia-northeast1",
        ipCidrRange: "10.10.0.0/24",
      },
    ],
  },
  {
    id: "m-plan-002",
    domain: MissionDomains.Planning,
    title: "バッチ用のサービスアカウントを用意する",
    description:
      "ace-dev-01 にサービスアカウント `batch-sa` を作り、プロジェクトに roles/storage.objectAdmin を付与してください。",
    hints: [
      'gcloud iam service-accounts create batch-sa --display-name="Batch SA"',
      "メンバーは serviceAccount:batch-sa@ace-dev-01.iam.gserviceaccount.com の形で指定します。",
      "gcloud projects add-iam-policy-binding ace-dev-01 --member=serviceAccount:... --role=roles/storage.objectAdmin",
    ],
    setup: [{ kind: "setProject", projectId: F.devProjectId }],
    assertions: [
      { kind: "serviceAccountExists", projectId: F.devProjectId, accountId: "batch-sa" },
      {
        kind: "bindingExists",
        target: devProject,
        role: "roles/storage.objectAdmin",
        member: `serviceAccount:batch-sa@${F.devProjectId}.iam.gserviceaccount.com`,
      },
    ],
  },
  {
    id: "m-deploy-001",
    domain: MissionDomains.Deploy,
    title: "Web サーバーを公開する",
    description:
      "ace-dev-01 の asia-northeast1-a に e2-small の VM `web-1` をネットワークタグ http-server 付きで作り、そのタグ向けに tcp:80 を許可するファイアウォールルール `allow-http` を作ってください。",
    hints: [
      "gcloud compute instances create web-1 --zone=asia-northeast1-a --machine-type=e2-small --tags=http-server",
      "gcloud compute firewall-rules create allow-http --network=default --allow=tcp:80 --target-tags=http-server",
    ],
    setup: [{ kind: "setProject", projectId: F.devProjectId }],
    assertions: [
      {
        kind: "instanceExists",
        projectId: F.devProjectId,
        name: "web-1",
        zone: "asia-northeast1-a",
        machineType: Option.some("e2-small"),
        tags: ["http-server"],
        status: Option.none,
      },
      {
        kind: "firewallRuleExists",
        projectId: F.devProjectId,
        name: "allow-http",
        allow: "tcp:80",
        targetTag: "http-server",
      },
    ],
  },
  {
    id: "m-deploy-002",
    domain: MissionDomains.Deploy,
    title: "ログ保管用のバケットを作る",
    description:
      "東京リージョン（ASIA-NORTHEAST1）に、既定のストレージクラスが NEARLINE のバケット `ace-dev-01-logs` を作ってください。",
    hints: [
      "gcloud storage buckets create gs://ace-dev-01-logs --location=asia-northeast1 --default-storage-class=NEARLINE",
    ],
    setup: [{ kind: "setProject", projectId: F.devProjectId }],
    assertions: [
      {
        kind: "bucketExists",
        name: "ace-dev-01-logs",
        location: "ASIA-NORTHEAST1",
        storageClass: "NEARLINE",
      },
    ],
  },
  {
    id: "m-deploy-003",
    domain: MissionDomains.Deploy,
    title: "GKE Autopilot クラスタを作る",
    description:
      "ace-dev-01 に、asia-northeast1 リージョンの Autopilot クラスタ `app-cluster` を作ってください（Kubernetes Engine API の有効化から）。",
    hints: [
      "gcloud services enable container.googleapis.com",
      "Autopilot は create ではなく create-auto です: gcloud container clusters create-auto app-cluster --region=asia-northeast1",
    ],
    setup: [{ kind: "setProject", projectId: F.devProjectId }],
    assertions: [
      {
        kind: "clusterExists",
        projectId: F.devProjectId,
        name: "app-cluster",
        autopilot: true,
        location: "asia-northeast1",
      },
    ],
  },
  {
    id: "m-ops-001",
    domain: MissionDomains.Operations,
    title: "停止してからスナップショットを取る",
    description:
      "asia-northeast1-b で動いている VM `batch-1` を停止し、そのブートディスク（batch-1）のスナップショット `batch-1-snap` を作ってください。",
    hints: [
      "gcloud compute instances stop batch-1 --zone=asia-northeast1-b",
      "gcloud compute snapshots create batch-1-snap --source-disk=batch-1 --source-disk-zone=asia-northeast1-b",
    ],
    setup: [
      { kind: "setProject", projectId: F.devProjectId },
      {
        kind: "ensureInstance",
        projectId: F.devProjectId,
        name: "batch-1",
        zone: "asia-northeast1-b",
      },
    ],
    assertions: [
      {
        kind: "instanceExists",
        projectId: F.devProjectId,
        name: "batch-1",
        zone: "asia-northeast1-b",
        machineType: Option.none,
        tags: [],
        status: Option.some("TERMINATED"),
      },
      { kind: "snapshotExists", projectId: F.devProjectId, name: "batch-1-snap" },
    ],
  },
  {
    id: "m-ops-002",
    domain: MissionDomains.Operations,
    title: "Cloud Run にサービスを公開する",
    description:
      "ace-dev-01 の asia-northeast1 に、イメージ gcr.io/cloudrun/hello のサービス `hello` を未認証アクセス許可でデプロイしてください。",
    hints: [
      "gcloud services enable run.googleapis.com",
      "gcloud run deploy hello --image=gcr.io/cloudrun/hello --region=asia-northeast1 --allow-unauthenticated",
    ],
    setup: [{ kind: "setProject", projectId: F.devProjectId }],
    assertions: [
      {
        kind: "runServiceExists",
        projectId: F.devProjectId,
        name: "hello",
        region: "asia-northeast1",
        allowUnauthenticated: true,
      },
    ],
  },
  {
    id: "m-iam-001",
    domain: MissionDomains.Security,
    title: "dev に最小権限で VM を作らせる",
    description:
      "dev@example.com は ace-dev-01 で VM を作れません。フォルダ dev に roles/compute.instanceAdmin.v1 だけを付与して、dev@example.com として asia-northeast1-a に VM `web-2` を作ってください（プロジェクトに editor / owner を付けるのは不正解）。",
    hints: [
      "gcloud config set account dev@example.com で切り替えて gcloud compute instances create web-2 --zone=asia-northeast1-a を試すと PERMISSION_DENIED になります。",
      "owner@example.com に戻り、gcloud resource-manager folders add-iam-policy-binding 284100000001 --member=user:dev@example.com --role=roles/compute.instanceAdmin.v1",
      "もう一度 dev@example.com で create を実行します。",
    ],
    setup: [
      { kind: "setProject", projectId: F.devProjectId },
      { kind: "setPrincipal", principal: F.developer },
    ],
    assertions: [
      {
        kind: "bindingExists",
        target: devFolder,
        role: "roles/compute.instanceAdmin.v1",
        member: `user:${F.developer}`,
      },
      {
        kind: "bindingAbsent",
        target: devProject,
        role: "roles/editor",
        member: `user:${F.developer}`,
      },
      {
        kind: "bindingAbsent",
        target: devProject,
        role: "roles/owner",
        member: `user:${F.developer}`,
      },
      {
        kind: "effectivePermission",
        projectId: F.devProjectId,
        member: `user:${F.developer}`,
        permission: "compute.instances.create",
      },
      {
        kind: "instanceExists",
        projectId: F.devProjectId,
        name: "web-2",
        zone: "asia-northeast1-a",
        machineType: Option.none,
        tags: [],
        status: Option.none,
      },
    ],
  },
  {
    id: "m-iam-002",
    domain: MissionDomains.Security,
    title: "運用チームに組織全体の閲覧権限を付ける",
    description:
      "グループ ops@example.com が組織配下のすべてのプロジェクトを閲覧できるように、組織レベルで roles/viewer を付与してください。",
    hints: [
      "組織 ID は gcloud organizations list で確認できます。",
      "gcloud organizations add-iam-policy-binding 123456789012 --member=group:ops@example.com --role=roles/viewer",
    ],
    setup: [],
    assertions: [
      { kind: "bindingExists", target: organization, role: "roles/viewer", member: F.opsGroup },
    ],
  },
];

const isSatisfied = (world: World, assertion: MissionAssertion): boolean => {
  switch (assertion.kind) {
    case "billingLinked": {
      const project = World.findProject(world, assertion.projectId);
      return Option.isSome(project) && Option.isSome(project.value.billingAccountId);
    }
    case "apiEnabled": {
      const project = World.findProject(world, assertion.projectId);
      return (
        Option.isSome(project) && project.value.enabledApis.some((api) => api === assertion.api)
      );
    }
    case "configurationProperty":
      return (
        world.config.configurations[assertion.configuration]?.[assertion.property] ===
        assertion.value
      );
    case "networkExists": {
      const network = World.findNetwork(world, assertion.projectId, assertion.name);
      return Option.isSome(network) && network.value.subnetMode === assertion.subnetMode;
    }
    case "subnetExists": {
      const subnet = World.findSubnet(world, assertion.projectId, assertion.region, assertion.name);
      return Option.isSome(subnet) && subnet.value.ipCidrRange === assertion.ipCidrRange;
    }
    case "serviceAccountExists":
      return Option.isSome(
        World.findServiceAccount(
          world,
          `${assertion.accountId}@${assertion.projectId}.iam.gserviceaccount.com`,
        ),
      );
    case "bindingExists": {
      const policy = World.policyOf(world, assertion.target);
      return (
        Option.isSome(policy) &&
        IamPolicy.hasBinding(policy.value, assertion.role, assertion.member)
      );
    }
    case "bindingAbsent": {
      const policy = World.policyOf(world, assertion.target);
      return (
        Option.isSome(policy) &&
        !IamPolicy.hasBinding(policy.value, assertion.role, assertion.member)
      );
    }
    case "instanceExists": {
      const instance = World.findInstance(
        world,
        assertion.projectId,
        assertion.zone,
        assertion.name,
      );
      if (!Option.isSome(instance)) return false;
      const machineTypeOk =
        !Option.isSome(assertion.machineType) ||
        instance.value.machineType === assertion.machineType.value;
      const tagsOk = assertion.tags.every((tag) => instance.value.tags.includes(tag));
      const statusOk =
        !Option.isSome(assertion.status) || instance.value.status === assertion.status.value;
      return machineTypeOk && tagsOk && statusOk;
    }
    case "firewallRuleExists": {
      const rule = World.findFirewallRule(world, assertion.projectId, assertion.name);
      if (!Option.isSome(rule)) return false;
      const [protocol, port] = assertion.allow.split(":");
      const allowOk = rule.value.allowed.some(
        (a) => a.protocol === protocol && (port === undefined || a.ports.includes(port)),
      );
      return allowOk && rule.value.targetTags.includes(assertion.targetTag);
    }
    case "bucketExists": {
      const bucket = World.findBucket(world, assertion.name);
      return (
        Option.isSome(bucket) &&
        bucket.value.location === assertion.location &&
        bucket.value.storageClass === assertion.storageClass
      );
    }
    case "clusterExists": {
      const cluster = World.findCluster(world, assertion.projectId, assertion.name);
      return (
        Option.isSome(cluster) &&
        cluster.value.autopilot === assertion.autopilot &&
        cluster.value.location === assertion.location
      );
    }
    case "snapshotExists":
      return World.snapshotsOf(world, assertion.projectId).some((s) => s.name === assertion.name);
    case "runServiceExists": {
      const service = World.findRunService(world, assertion.projectId, assertion.name);
      return (
        Option.isSome(service) &&
        service.value.region === assertion.region &&
        service.value.allowUnauthenticated === assertion.allowUnauthenticated
      );
    }
    case "effectivePermission": {
      const effective = EffectivePermissions.resolve(world, assertion.member, {
        type: "project",
        id: assertion.projectId,
      });
      return effective.permissions.has(assertion.permission);
    }
  }
};

const applyPatch = (world: World, patch: WorldPatch): Result<World, string> => {
  switch (patch.kind) {
    case "setPrincipal":
      return Result.ok(World.withPrincipal(world, patch.principal));
    case "setProject":
      return Result.ok(
        World.withConfig(world, GcloudConfig.set(world.config, "core/project", patch.projectId)),
      );
    case "removeBinding": {
      const policy = World.policyOf(world, patch.target);
      if (!Option.isSome(policy))
        return Result.err(`target ${patch.target.type}/${patch.target.id} does not exist`);
      const removed = IamPolicy.removeBinding(policy.value, patch.role, patch.member);
      if (!Option.isSome(removed)) return Result.ok(world);
      const next = World.withPolicy(world, patch.target, removed.value);
      return Option.isSome(next)
        ? Result.ok(next.value)
        : Result.err("removing the binding would violate an invariant");
    }
    case "ensureInstance": {
      if (Option.isSome(World.findInstance(world, patch.projectId, patch.zone, patch.name)))
        return Result.ok(world);
      const project = World.findProject(world, patch.projectId);
      if (!Option.isSome(project)) return Result.err(`project ${patch.projectId} does not exist`);
      const subnet = World.subnetsOf(world, patch.projectId).find(
        (s) => s.network === "default" && patch.zone.startsWith(s.region),
      );
      if (subnet === undefined) return Result.err(`no default subnet for ${patch.zone}`);
      const numbered = World.nextNumber(world);
      const added = World.withInstance(numbered.world, {
        projectId: patch.projectId,
        name: patch.name,
        zone: patch.zone,
        machineType: "e2-medium",
        status: "RUNNING",
        networkInterfaces: [
          {
            network: "default",
            subnetwork: "default",
            networkIP: "10.146.0.3",
            externalIP: { kind: "none" },
          },
        ],
        disks: [
          {
            deviceName: patch.name,
            boot: true,
            sizeGb: 10,
            type: "pd-balanced",
            sourceImage: "projects/debian-cloud/global/images/debian-12-bookworm-v20260901",
          },
        ],
        tags: [],
        serviceAccount: `${project.value.projectNumber}-compute@developer.gserviceaccount.com`,
        scopes: [],
        preemptible: false,
        provisioningModel: "STANDARD",
        metadata: {},
        creationTimestamp: "2026-01-01T00:00:00.000Z",
        id: String(4812000000000000000n + BigInt(numbered.number)),
      });
      return Result.mapErr(added, (e) => `instance ${e.resource} already exists`);
    }
  }
};

export type MissionEvaluation = Readonly<{ world: World; completed: readonly Mission[] }>;

export const Mission = {
  all(): readonly Mission[] {
    return Missions;
  },

  find(id: string): Option<Mission> {
    return Option.fromNullable(Missions.find((m) => m.id === id));
  },

  /**
   * ミッションを始める（UC-006）。`setup` を当てて不変条件を確かめ、進捗を `in_progress` にする。
   *
   * @param world 元
   * @param mission 始めるミッション
   * @returns 始めた後の World。setup が不変条件を壊すなら E-015（World は変えない）
   */
  start(world: World, mission: Mission): Result<World, MissionSetupFailure> {
    const patched = mission.setup.reduce<Result<World, string>>(
      (acc, patch) => Result.flatMap(acc, (w) => applyPatch(w, patch)),
      Result.ok(world),
    );
    const validated = Result.flatMap(patched, World.validate);
    return Result.map(
      Result.mapErr(validated, (reason) => ({ missionId: mission.id, reason })),
      (w) => {
        const progress = Option.unwrapOr(
          World.findMission(w, mission.id),
          MissionProgress.create(mission.id),
        );
        return World.replaceMission(w, MissionProgress.start(progress));
      },
    );
  },

  /**
   * ミッションを中断する。World の変更は残す（自由操作優先）。
   *
   * @param world 元
   * @param id ミッション id
   * @returns `available` に戻した World。進行中でなければ変えない
   */
  abandon(world: World, id: string): World {
    const progress = World.findMission(world, id);
    return Option.isSome(progress)
      ? World.replaceMission(world, MissionProgress.abandon(progress.value))
      : world;
  },

  revealHint(world: World, mission: Mission): World {
    const progress = World.findMission(world, mission.id);
    return Option.isSome(progress)
      ? World.replaceMission(
          world,
          MissionProgress.revealHint(progress.value, mission.hints.length),
        )
      : world;
  },

  /**
   * 進行中のミッションをすべて評価し、全アサーションが真のものを `completed` にする（UC-006 ステップ 3）。
   *
   * @param world コマンド実行後の World
   * @returns 進捗を更新した World と、今回クリアしたミッション
   */
  evaluate(world: World): MissionEvaluation {
    return World.missionsInProgress(world).reduce<MissionEvaluation>(
      (acc, progress) => {
        const mission = Mission.find(progress.id);
        const cleared =
          Option.isSome(mission) &&
          mission.value.assertions.every((a) => isSatisfied(acc.world, a));
        if (!cleared || !Option.isSome(mission)) return acc;
        return {
          world: World.replaceMission(acc.world, MissionProgress.complete(progress)),
          completed: [...acc.completed, mission.value],
        };
      },
      { world, completed: [] },
    );
  },

  /**
   * 各アサーションの成否。ミッションパネルの進捗表示に使う。
   *
   * @param world 今の World
   * @param mission 見るミッション
   * @returns アサーションごとの真偽（定義と同じ並び）
   */
  progressOf(world: World, mission: Mission): readonly boolean[] {
    return mission.assertions.map((a) => isSatisfied(world, a));
  },

  isSatisfied,

  /** 進捗が無い id を `available` で足し、定義に無い id を落とす（import と定義の追加で揃える）。 */
  syncProgress(world: World): World {
    const known = new Set(Missions.map((m) => m.id));
    const kept = world.missions.filter((m) => known.has(m.id));
    const missing = Missions.filter((m) => !kept.some((k) => k.id === m.id)).map((m) =>
      MissionProgress.create(m.id),
    );
    return { ...world, missions: [...kept, ...missing] };
  },

  /** 進行中・完了の件数。ヘッダーの「ミッション 2/3」表示に使う。 */
  counts(world: World): Readonly<{ completed: number; total: number }> {
    return {
      completed: world.missions.filter((m) => m.status === MissionStatuses.Completed).length,
      total: Missions.length,
    };
  },
} as const;
