import { Budget } from "@/engine/domains/billing-budget";
import { Instance } from "@/engine/domains/compute";
import { type IamMember, IamPolicy, type RoleName } from "@/engine/domains/iam-policy";
import { KubeStorage } from "@/engine/domains/kube-storage";
import type { GkeCluster } from "@/engine/domains/managed-services";
import { type ParentRef, PolicyTarget, type Project } from "@/engine/domains/resource-hierarchy";
import { World } from "@/engine/domains/world";
import { TreeSelection } from "@/engine/resource-tree/selection";
import type { ValueOf } from "@/types/ValueOf";
import { Option } from "@/utils/Option";

export { TreeSelection } from "@/engine/resource-tree/selection";

/** ノードの左に出す種別。綴り（`組織` / `PJ` 等）は表示側が決める。 */
export const TreeBadges = {
  Organization: "organization",
  Folder: "folder",
  Project: "project",
  Billing: "billing",
  None: "none",
} as const;
export type TreeBadge = ValueOf<typeof TreeBadges>;

/** プロジェクト直下でリソースを種別ごとに束ねるグループ。見出しの綴りは表示側が決める。 */
export const ResourceGroups = {
  Compute: "compute",
  Artifacts: "artifacts",
  Builds: "builds",
  LocalDocker: "local-docker",
  Disks: "disks",
  InstanceGroups: "instance-groups",
  LoadBalancing: "load-balancing",
  Vpc: "vpc",
  Storage: "storage",
  Gke: "gke",
  Run: "run",
  Functions: "functions",
  AppEngine: "app-engine",
  Sql: "sql",
  Pubsub: "pubsub",
  Logging: "logging",
  Monitoring: "monitoring",
  Kms: "kms",
  Dns: "dns",
  DeploymentManager: "deployment-manager",
  ServiceAccounts: "service-accounts",
  Roles: "roles",
  Iam: "iam",
} as const;
export type ResourceGroup = ValueOf<typeof ResourceGroups>;

/** ノードの見出し。リソース名はそのまま、グループは種別で持つ。 */
export type TreeLabel =
  | Readonly<{ kind: "text"; text: string }>
  | Readonly<{ kind: "group"; group: ResourceGroup }>;

export type TreeNode = Readonly<{
  key: string;
  badge: TreeBadge;
  label: TreeLabel;
  /** グループ行に出す件数 */
  count: Option<number>;
  selection: Option<TreeSelection>;
  children: readonly TreeNode[];
  /** インスタンスの状態など、ラベルの左に出す点の色 */
  status: "none" | "running" | "stopped";
}>;

const node = (
  key: string,
  label: TreeLabel,
  fields: Partial<Pick<TreeNode, "badge" | "count" | "selection" | "children" | "status">> = {},
): TreeNode => ({
  key,
  label,
  badge: fields.badge ?? TreeBadges.None,
  count: fields.count ?? Option.none,
  selection: fields.selection ?? Option.none,
  children: fields.children ?? [],
  status: fields.status ?? "none",
});

const text = (value: string): TreeLabel => ({ kind: "text", text: value });

/** 中身が無いグループは出さない（件数 0 の見出しが並ぶと本当にあるものが埋もれる）。 */
const group = (
  projectId: string,
  kind: ResourceGroup,
  children: readonly TreeNode[],
): readonly TreeNode[] =>
  children.length === 0
    ? []
    : [
        node(
          `${projectId}/${kind}`,
          { kind: "group", group: kind },
          { count: Option.some(children.length), children },
        ),
      ];

type LeafFields = Partial<Pick<TreeNode, "children" | "status">>;

const leaf = (selection: TreeSelection, label: string, fields: LeafFields = {}): TreeNode =>
  node(TreeSelection.key(selection), text(label), {
    selection: Option.some(selection),
    ...fields,
  });

const byName = <T extends { name: string }>(items: readonly T[]): readonly T[] =>
  items.toSorted((a, b) => a.name.localeCompare(b.name));

const computeNodes = (world: World, id: string): readonly TreeNode[] =>
  byName(World.instancesOf(world, id)).map((i) =>
    leaf({ kind: "instance", projectId: id, zone: i.zone, name: i.name }, i.name, {
      status: Instance.isRunning(i) ? "running" : "stopped",
    }),
  );

/** 独立ディスクとスナップショット。インスタンスのブートディスクはインスタンス側に出る。 */
const diskNodes = (world: World, id: string): readonly TreeNode[] => [
  ...World.disksOf(world, id).map((d) =>
    leaf({ kind: "disk", projectId: id, zone: d.zone, name: d.name }, d.name),
  ),
  ...World.diskSnapshotsOf(world, id).map((s) =>
    leaf({ kind: "snapshot", projectId: id, name: s.name }, `snapshot: ${s.name}`),
  ),
];

const instanceGroupNodes = (world: World, id: string): readonly TreeNode[] => [
  ...World.namedOf(world, "instanceTemplates", id).map((t) =>
    leaf({ kind: "instance-template", projectId: id, name: t.name }, `template: ${t.name}`),
  ),
  ...World.namedOf(world, "instanceGroups", id).map((g) =>
    leaf(
      { kind: "instance-group", projectId: id, location: g.location, name: g.name },
      `mig: ${g.name}`,
    ),
  ),
];

const loadBalancingNodes = (world: World, id: string): readonly TreeNode[] => [
  ...World.namedOf(world, "healthChecks", id).map((h) =>
    leaf({ kind: "health-check", projectId: id, name: h.name }, `hc: ${h.name}`),
  ),
  ...World.namedOf(world, "backendServices", id).map((b) =>
    leaf(
      { kind: "backend-service", projectId: id, scope: b.scope, name: b.name },
      `bes: ${b.name}`,
    ),
  ),
  ...World.namedOf(world, "forwardingRules", id).map((r) =>
    leaf({ kind: "forwarding-rule", projectId: id, scope: r.scope, name: r.name }, `fr: ${r.name}`),
  ),
  ...World.namedOf(world, "addresses", id).map((a) =>
    leaf({ kind: "address", projectId: id, region: a.region, name: a.name }, `ip: ${a.name}`),
  ),
];

/** ネットワークの下にファイアウォール・サブネット・ルータを束ねる（UI 案 2a の並び: fw が先）。 */
const networkNodes = (world: World, id: string): readonly TreeNode[] =>
  World.networksOf(world, id).map((n) => {
    const firewalls = World.firewallRulesOf(world, id)
      .filter((r) => r.network === n.name)
      .map((r) => leaf({ kind: "firewall", projectId: id, name: r.name }, `fw: ${r.name}`));
    const subnets = byName(World.subnetsOf(world, id).filter((s) => s.network === n.name)).map(
      (s) =>
        leaf(
          { kind: "subnet", projectId: id, region: s.region, name: s.name },
          `subnet: ${s.name} (${s.region})`,
        ),
    );
    const routers = World.namedOf(world, "routers", id)
      .filter((r) => r.network === n.name)
      .map((r) =>
        leaf(
          { kind: "router", projectId: id, region: r.region, name: r.name },
          `router: ${r.name}`,
        ),
      );
    return leaf({ kind: "network", projectId: id, name: n.name }, n.name, {
      children: [...firewalls, ...subnets, ...routers],
    });
  });

/** クラスタの下にノードプールと、kubectl で作った Deployment / Service を束ねる。 */
const clusterChildren = (world: World, cluster: GkeCluster): readonly TreeNode[] => {
  const id = cluster.projectId;
  const pools = World.nodePoolsWithDefault(world, cluster).map((p) =>
    leaf(
      { kind: "node-pool", projectId: id, cluster: cluster.name, name: p.name },
      `pool: ${p.name}`,
    ),
  );
  const resources = (namespace: string): readonly TreeNode[] => {
    const deployments = World.kubeDeploymentsOf(world, cluster, namespace).map((d) =>
      leaf(
        {
          kind: "kube-deployment",
          projectId: id,
          cluster: cluster.name,
          ...(namespace !== "default" ? { namespace } : {}),
          name: d.name,
        },
        `deploy: ${d.name}`,
      ),
    );
    const services = World.kubeServicesOf(world, cluster, namespace).map((s) =>
      leaf(
        {
          kind: "kube-service",
          projectId: id,
          cluster: cluster.name,
          ...(namespace !== "default" ? { namespace } : {}),
          name: s.name,
        },
        `svc: ${s.name}`,
      ),
    );
    const configs = world.kubeConfigs
      .filter((c) => c.projectId === id && c.cluster === cluster.name && c.namespace === namespace)
      .map((c) =>
        leaf(
          {
            kind: "kube-config",
            resourceKind: c.kind,
            projectId: id,
            cluster: c.cluster,
            ...(namespace !== "default" ? { namespace } : {}),
            name: c.name,
          },
          `${c.kind}: ${c.name}`,
        ),
      );
    const hpas = world.kubeHpas
      .filter((h) => h.projectId === id && h.cluster === cluster.name && h.namespace === namespace)
      .map((h) =>
        leaf(
          {
            kind: "kube-hpa",
            projectId: id,
            cluster: cluster.name,
            ...(namespace !== "default" ? { namespace } : {}),
            name: h.name,
          },
          `hpa: ${h.name}`,
        ),
      );
    const claims = world.kubePvcs
      .filter((c) => c.projectId === id && c.cluster === cluster.name && c.namespace === namespace)
      .map((c) =>
        leaf(
          {
            kind: "kube-storage",
            resourceKind: "pvc",
            projectId: id,
            cluster: cluster.name,
            namespace,
            name: c.name,
          },
          `pvc: ${c.name}`,
        ),
      );
    const policies = world.kubeNetworkPolicies
      .filter((p) => p.projectId === id && p.cluster === cluster.name && p.namespace === namespace)
      .map((p) =>
        leaf(
          {
            kind: "kube-network-policy",
            projectId: id,
            cluster: cluster.name,
            namespace,
            name: p.name,
          },
          `netpol: ${p.name}`,
        ),
      );
    return [...deployments, ...services, ...configs, ...hpas, ...claims, ...policies];
  };
  const namespaces = world.kubeNamespaces
    .filter((n) => n.projectId === id && n.cluster === cluster.name)
    .map((n) =>
      leaf(
        { kind: "kube-namespace", projectId: id, cluster: cluster.name, name: n.name },
        `namespace: ${n.name}`,
        { children: resources(n.name) },
      ),
    );
  const systemNamespaces = ["kube-system", "kube-public", "kube-node-lease"].flatMap(
    (namespace) => {
      const children = resources(namespace);
      return children.length
        ? [
            leaf(
              { kind: "kube-namespace", projectId: id, cluster: cluster.name, name: namespace },
              `namespace: ${namespace}`,
              { children },
            ),
          ]
        : [];
    },
  );
  const classes = KubeStorage.classes(world, cluster).map((c) =>
    leaf(
      {
        kind: "kube-storage",
        resourceKind: "storageclass",
        projectId: id,
        cluster: cluster.name,
        name: c.name,
      },
      `sc: ${c.name}`,
    ),
  );
  const volumes = world.kubePvs
    .filter((p) => p.projectId === id && p.cluster === cluster.name)
    .map((p) =>
      leaf(
        {
          kind: "kube-storage",
          resourceKind: "pv",
          projectId: id,
          cluster: cluster.name,
          name: p.name,
        },
        `pv: ${p.name}`,
      ),
    );
  return [
    ...pools,
    ...classes,
    ...volumes,
    ...resources("default"),
    ...namespaces,
    ...systemNamespaces,
  ];
};

const gkeNodes = (world: World, id: string): readonly TreeNode[] =>
  World.clustersOf(world, id).map((c) =>
    leaf({ kind: "cluster", projectId: id, name: c.name }, c.name, {
      children: clusterChildren(world, c),
    }),
  );

/** App Engine のアプリ 1 つと、その下のバージョン（サービス/ID）。 */
const appEngineNodes = (world: World, id: string): readonly TreeNode[] =>
  Option.unwrapOr(
    Option.map(World.findAppEngineApp(world, id), (app) => {
      const versions = world.appVersions
        .filter((v) => v.projectId === id)
        .map((v) =>
          leaf(
            { kind: "app-version", projectId: id, service: v.service, id: v.id },
            `${v.service}/${v.id}`,
          ),
        );
      return [
        leaf({ kind: "app-engine", projectId: id }, `${id} (${app.region})`, {
          children: versions,
        }),
      ];
    }),
    [],
  );

const pubsubNodes = (world: World, id: string): readonly TreeNode[] =>
  World.namedOf(world, "pubsubTopics", id).map((t) =>
    leaf({ kind: "topic", projectId: id, name: t.name }, t.name, {
      children: World.namedOf(world, "pubsubSubscriptions", id)
        .filter((s) => s.topic === t.name)
        .map((s) => leaf({ kind: "subscription", projectId: id, name: s.name }, `sub: ${s.name}`)),
    }),
  );

const projectNode = (world: World, project: Project): TreeNode => {
  const id = project.projectId;
  const buckets = byName(World.bucketsOf(world, id)).map((b) =>
    leaf({ kind: "bucket", name: b.name }, b.name),
  );
  const runServices = World.runServicesOf(world, id).map((s) =>
    leaf({ kind: "run-service", projectId: id, name: s.name }, s.name),
  );
  const functions = World.namedOf(world, "functions", id).map((f) =>
    leaf({ kind: "function", projectId: id, region: f.region, name: f.name }, f.name),
  );
  const sqlInstances = World.namedOf(world, "sqlInstances", id).map((i) =>
    leaf({ kind: "sql-instance", projectId: id, name: i.name }, i.name),
  );
  const sinks = World.namedOf(world, "logSinks", id).map((s) =>
    leaf({ kind: "log-sink", projectId: id, name: s.name }, s.name),
  );
  const observability = (
    ["logMetrics", "dashboards", "alertPolicies", "uptimeChecks"] as const
  ).flatMap((collection) =>
    World.namedOf(world, collection, id).map((resource) =>
      leaf(
        { kind: "observability", projectId: id, name: resource.name, collection },
        "displayName" in resource ? resource.displayName : resource.name,
      ),
    ),
  );
  const keyRings = World.namedOf(world, "kmsKeyRings", id).map((r) =>
    leaf(
      { kind: "key-ring", projectId: id, location: r.location, name: r.name },
      `${r.location}/${r.name}`,
    ),
  );
  const dnsZones = World.namedOf(world, "dnsZones", id).map((z) =>
    leaf({ kind: "dns-zone", projectId: id, name: z.name }, z.name),
  );
  const deployments = World.namedOf(world, "dmDeployments", id).map((d) =>
    leaf({ kind: "dm-deployment", projectId: id, name: d.name }, d.name),
  );
  const accounts = World.serviceAccountsOf(world, id)
    .toSorted((a, b) => a.email.localeCompare(b.email))
    .map((s) =>
      leaf({ kind: "service-account", email: s.email }, s.email.split("@")[0] ?? s.email),
    );
  const roles = World.customRolesOf(world, id).map((r) =>
    leaf({ kind: "custom-role", projectId: id, roleId: r.roleId }, r.roleId),
  );
  const bindingCount = project.iamPolicy.bindings.reduce((sum, b) => sum + b.members.length, 0);
  const iamSelection: TreeSelection = { kind: "iam", target: { type: "project", id } };
  const iam = node(
    TreeSelection.key(iamSelection),
    { kind: "group", group: ResourceGroups.Iam },
    { count: Option.some(bindingCount), selection: Option.some(iamSelection) },
  );
  return node(TreeSelection.key({ kind: "project", projectId: id }), text(id), {
    badge: TreeBadges.Project,
    selection: Option.some({ kind: "project", projectId: id }),
    children: [
      ...group(
        id,
        ResourceGroups.Builds,
        world.containerLab.builds
          .filter((b) => b.projectId === id)
          .map((b) =>
            leaf(
              { kind: "container-lab", collection: "builds", id: b.id },
              `${b.id} (${b.status})`,
            ),
          ),
      ),
      ...group(
        id,
        ResourceGroups.Artifacts,
        world.containerLab.repositories
          .filter((r) => r.projectId === id)
          .map((r) =>
            leaf(
              { kind: "container-lab", collection: "repositories", id: r.id },
              `${r.name} (${r.location})`,
              {
                children: world.containerLab.registryImages
                  .filter((i) => i.repositoryId === r.id)
                  .map((i) =>
                    node(
                      `${r.id}/${i.name}@${i.digest}`,
                      text(`${i.name}: ${i.tags.join(", ") || "タグなし"} (${i.recipe})`),
                    ),
                  ),
              },
            ),
          ),
      ),
      ...group(id, ResourceGroups.Compute, computeNodes(world, id)),
      ...group(id, ResourceGroups.Disks, diskNodes(world, id)),
      ...group(id, ResourceGroups.InstanceGroups, instanceGroupNodes(world, id)),
      ...group(id, ResourceGroups.LoadBalancing, loadBalancingNodes(world, id)),
      ...group(id, ResourceGroups.Vpc, networkNodes(world, id)),
      ...group(id, ResourceGroups.Storage, buckets),
      ...group(id, ResourceGroups.Gke, gkeNodes(world, id)),
      ...group(id, ResourceGroups.Run, runServices),
      ...group(id, ResourceGroups.Functions, functions),
      ...group(id, ResourceGroups.AppEngine, appEngineNodes(world, id)),
      ...group(id, ResourceGroups.Sql, sqlInstances),
      ...group(id, ResourceGroups.Pubsub, pubsubNodes(world, id)),
      ...group(id, ResourceGroups.Logging, sinks),
      ...group(id, ResourceGroups.Monitoring, observability),
      ...group(id, ResourceGroups.Kms, keyRings),
      ...group(id, ResourceGroups.Dns, dnsZones),
      ...group(id, ResourceGroups.DeploymentManager, deployments),
      ...group(id, ResourceGroups.ServiceAccounts, accounts),
      ...group(id, ResourceGroups.Roles, roles),
      iam,
    ],
  });
};

/** 親の直下にあるフォルダとプロジェクト（フォルダが先、それぞれ名前順）。 */
const childrenUnder = (world: World, parent: ParentRef): readonly TreeNode[] => [
  ...World.foldersUnder(world, parent).map((f) =>
    node(TreeSelection.key({ kind: "folder", id: f.id }), text(f.displayName), {
      badge: TreeBadges.Folder,
      selection: Option.some({ kind: "folder", id: f.id }),
      children: childrenUnder(world, { type: "folder", id: f.id }),
    }),
  ),
  ...World.projectsUnder(world, parent).map((p) => projectNode(world, p)),
];

/** 請求アカウントと、その下の予算。 */
const billingNode = (world: World, id: string): TreeNode =>
  node(TreeSelection.key({ kind: "billing", id }), text(id), {
    badge: TreeBadges.Billing,
    selection: Option.some({ kind: "billing", id }),
    children: World.budgetsOf(world, id).map((b) =>
      leaf({ kind: "budget", billingAccountId: id, id: Budget.id(b) }, `budget: ${b.displayName}`),
    ),
  });

export const TreeNode = {
  /**
   * World を組織 → フォルダ → プロジェクト → リソース種別 → リソースのツリーにする（UC-007）。
   * 削除要求済みのプロジェクトは出さない。並びは名前順。
   *
   * @param world 元
   * @returns ルート（組織と請求アカウント）
   */
  fromWorld(world: World): readonly TreeNode[] {
    const organization = node(
      TreeSelection.key({ kind: "organization" }),
      text(world.organization.displayName),
      {
        badge: TreeBadges.Organization,
        selection: Option.some({ kind: "organization" }),
        children: childrenUnder(world, { type: "organization", id: world.organization.id }),
      },
    );
    const billing = world.billingAccounts.map((b) => billingNode(world, b.id));
    const localDocker = group("local", ResourceGroups.LocalDocker, [
      ...world.containerLab.images.map((i) =>
        leaf(
          { kind: "container-lab", collection: "images", id: i.id },
          `Image: ${i.tags.join(", ") || i.id}`,
        ),
      ),
      ...world.containerLab.containers.map((c) =>
        leaf(
          { kind: "container-lab", collection: "containers", id: c.id },
          `Container: ${c.name}`,
          { status: c.status === "RUNNING" ? "running" : "stopped" },
        ),
      ),
    ]);
    return [organization, ...billing, ...localDocker];
  },
} as const;

/** バインディングがどこに付いているか。表示の綴り（`組織 example.com` 等）は表示側が決める。 */
export type BindingOrigin =
  | Readonly<{ kind: "self"; target: PolicyTarget }>
  | Readonly<{ kind: "organization"; displayName: string }>
  | Readonly<{ kind: "folder"; displayName: string }>
  | Readonly<{ kind: "project"; projectId: string }>
  | Readonly<{ kind: "bucket"; name: string }>
  | Readonly<{ kind: "service-account"; email: string }>;

/** 継承元を明示したバインディングの 1 行（UC-007: どこから継承されたか）。 */
export type BindingRow = Readonly<{
  member: IamMember;
  role: RoleName;
  origin: BindingOrigin;
}>;

const originOf = (world: World, target: PolicyTarget, grantedAt: PolicyTarget): BindingOrigin => {
  if (PolicyTarget.equals(grantedAt, target)) return { kind: "self", target };
  switch (grantedAt.type) {
    case "organization":
      return { kind: "organization", displayName: world.organization.displayName };
    case "folder": {
      const folder = World.findFolder(world, grantedAt.id);
      return {
        kind: "folder",
        displayName: Option.isSome(folder) ? folder.value.displayName : grantedAt.id,
      };
    }
    case "project":
      return { kind: "project", projectId: grantedAt.id };
    case "artifact-repository":
      return { kind: "self", target: grantedAt };
    case "bucket":
      return { kind: "bucket", name: grantedAt.id };
    case "service-account":
      return { kind: "service-account", email: grantedAt.id };
  }
};

export const BindingRow = {
  /**
   * 対象に直接付いたバインディングと、上位から継承されるバインディングを近い順に並べる。
   *
   * @param world 元
   * @param target 対象
   * @returns 行の並び。先頭が対象自身、後ろほど上位
   */
  fromWorld(world: World, target: PolicyTarget): readonly BindingRow[] {
    return World.ancestry(world, target).flatMap((ancestor) => {
      const policy = Option.unwrapOr(World.findPolicy(world, ancestor), IamPolicy.Empty);
      const origin = originOf(world, target, ancestor);
      return policy.bindings.flatMap((b) =>
        b.members.map((member): BindingRow => ({ member, role: b.role, origin })),
      );
    });
  },

  isInherited(row: BindingRow): boolean {
    return row.origin.kind !== "self";
  },
} as const;
