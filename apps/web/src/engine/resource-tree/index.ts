import type { Zone } from "@/engine/domains/catalog";
import { Instance } from "@/engine/domains/compute";
import { type IamMember, IamPolicy, type RoleName } from "@/engine/domains/iam-policy";
import { type ParentRef, PolicyTarget, type Project } from "@/engine/domains/resource-hierarchy";
import { World } from "@/engine/domains/world";
import type { ValueOf } from "@/types/ValueOf";
import { Option } from "@/utils/Option";

/** ツリーで選べるもの。プロパティパネルはこれを見て World から中身を引く。 */
export type Selection =
  | Readonly<{ kind: "organization" }>
  | Readonly<{ kind: "folder"; id: string }>
  | Readonly<{ kind: "project"; projectId: string }>
  | Readonly<{ kind: "billing"; id: string }>
  | Readonly<{ kind: "instance"; projectId: string; zone: Zone; name: string }>
  | Readonly<{ kind: "network"; projectId: string; name: string }>
  | Readonly<{ kind: "firewall"; projectId: string; name: string }>
  | Readonly<{ kind: "bucket"; name: string }>
  | Readonly<{ kind: "cluster"; projectId: string; name: string }>
  | Readonly<{ kind: "run-service"; projectId: string; name: string }>
  | Readonly<{ kind: "service-account"; email: string }>
  | Readonly<{ kind: "iam"; target: PolicyTarget }>;

export const Selection = {
  /**
   * 2 つの選択が同じものを指しているか。
   *
   * @param a 片方
   * @param b もう片方
   * @returns 種類とキーが同じなら真
   */
  equals(a: Selection, b: Selection): boolean {
    return Selection.key(a) === Selection.key(b);
  },

  /** ツリーのノード id にもなる一意なキー。 */
  key(selection: Selection): string {
    switch (selection.kind) {
      case "organization":
        return "organization";
      case "folder":
        return `folder:${selection.id}`;
      case "project":
        return `project:${selection.projectId}`;
      case "billing":
        return `billing:${selection.id}`;
      case "instance":
        return `instance:${selection.projectId}/${selection.zone}/${selection.name}`;
      case "network":
        return `network:${selection.projectId}/${selection.name}`;
      case "firewall":
        return `firewall:${selection.projectId}/${selection.name}`;
      case "bucket":
        return `bucket:${selection.name}`;
      case "cluster":
        return `cluster:${selection.projectId}/${selection.name}`;
      case "run-service":
        return `run:${selection.projectId}/${selection.name}`;
      case "service-account":
        return `sa:${selection.email}`;
      case "iam":
        return `iam:${selection.target.type}/${selection.target.id}`;
    }
  },

  /**
   * ダブルクリックで入力行に挿入する describe コマンド（UC-007）。
   *
   * @param selection 選択
   * @returns そのリソースを describe するコマンド。無いもの（組織）は `none`
   */
  describeCommand(selection: Selection): Option<string> {
    switch (selection.kind) {
      case "organization":
        return Option.none;
      case "folder":
        return Option.some(`gcloud resource-manager folders describe ${selection.id}`);
      case "project":
        return Option.some(`gcloud projects describe ${selection.projectId}`);
      case "billing":
        return Option.some(`gcloud billing accounts describe ${selection.id}`);
      case "instance":
        return Option.some(
          `gcloud compute instances describe ${selection.name} --zone=${selection.zone}`,
        );
      case "network":
        return Option.some(`gcloud compute networks describe ${selection.name}`);
      case "firewall":
        return Option.some(`gcloud compute firewall-rules describe ${selection.name}`);
      case "bucket":
        return Option.some(`gcloud storage buckets describe gs://${selection.name}`);
      case "cluster":
        return Option.some(`gcloud container clusters describe ${selection.name}`);
      case "run-service":
        return Option.some(`gcloud run services describe ${selection.name}`);
      case "service-account":
        return Option.some(`gcloud iam service-accounts describe ${selection.email}`);
      case "iam": {
        const t = selection.target;
        switch (t.type) {
          case "organization":
            return Option.some(`gcloud organizations get-iam-policy ${t.id}`);
          case "folder":
            return Option.some(`gcloud resource-manager folders get-iam-policy ${t.id}`);
          case "project":
            return Option.some(`gcloud projects get-iam-policy ${t.id}`);
          case "bucket":
            return Option.some(`gcloud storage buckets get-iam-policy gs://${t.id}`);
        }
      }
    }
  },
} as const;

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
  Vpc: "vpc",
  Storage: "storage",
  Gke: "gke",
  Run: "run",
  ServiceAccounts: "service-accounts",
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
  selection: Option<Selection>;
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

const leaf = (selection: Selection, label: string, status: TreeNode["status"] = "none"): TreeNode =>
  node(Selection.key(selection), text(label), { selection: Option.some(selection), status });

const byName = <T extends { name: string }>(items: readonly T[]): readonly T[] =>
  items.toSorted((a, b) => a.name.localeCompare(b.name));

const projectNode = (world: World, project: Project): TreeNode => {
  const id = project.projectId;
  const instances = byName(World.instancesOf(world, id)).map((i) =>
    leaf(
      { kind: "instance", projectId: id, zone: i.zone, name: i.name },
      i.name,
      Instance.isRunning(i) ? "running" : "stopped",
    ),
  );
  const networks = byName(World.networksOf(world, id)).map((n) =>
    node(Selection.key({ kind: "network", projectId: id, name: n.name }), text(n.name), {
      selection: Option.some({ kind: "network", projectId: id, name: n.name }),
      children: byName(World.firewallRulesOf(world, id).filter((r) => r.network === n.name)).map(
        (r) => leaf({ kind: "firewall", projectId: id, name: r.name }, `fw: ${r.name}`),
      ),
    }),
  );
  const buckets = byName(World.bucketsOf(world, id)).map((b) =>
    leaf({ kind: "bucket", name: b.name }, b.name),
  );
  const clusters = byName(World.clustersOf(world, id)).map((c) =>
    leaf({ kind: "cluster", projectId: id, name: c.name }, c.name),
  );
  const services = byName(World.runServicesOf(world, id)).map((s) =>
    leaf({ kind: "run-service", projectId: id, name: s.name }, s.name),
  );
  const accounts = World.serviceAccountsOf(world, id)
    .toSorted((a, b) => a.email.localeCompare(b.email))
    .map((s) =>
      leaf({ kind: "service-account", email: s.email }, s.email.split("@")[0] ?? s.email),
    );
  const bindingCount = project.iamPolicy.bindings.reduce((sum, b) => sum + b.members.length, 0);
  const iamSelection: Selection = { kind: "iam", target: { type: "project", id } };
  const iam = node(
    Selection.key(iamSelection),
    { kind: "group", group: ResourceGroups.Iam },
    { count: Option.some(bindingCount), selection: Option.some(iamSelection) },
  );
  return node(Selection.key({ kind: "project", projectId: id }), text(id), {
    badge: TreeBadges.Project,
    selection: Option.some({ kind: "project", projectId: id }),
    children: [
      ...group(id, ResourceGroups.Compute, instances),
      ...group(id, ResourceGroups.Vpc, networks),
      ...group(id, ResourceGroups.Storage, buckets),
      ...group(id, ResourceGroups.Gke, clusters),
      ...group(id, ResourceGroups.Run, services),
      ...group(id, ResourceGroups.ServiceAccounts, accounts),
      iam,
    ],
  });
};

/** 親の直下にあるフォルダとプロジェクト（フォルダが先、それぞれ名前順）。 */
const childrenUnder = (world: World, parent: ParentRef): readonly TreeNode[] => [
  ...World.foldersUnder(world, parent).map((f) =>
    node(Selection.key({ kind: "folder", id: f.id }), text(f.displayName), {
      badge: TreeBadges.Folder,
      selection: Option.some({ kind: "folder", id: f.id }),
      children: childrenUnder(world, { type: "folder", id: f.id }),
    }),
  ),
  ...World.projectsUnder(world, parent).map((p) => projectNode(world, p)),
];

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
      Selection.key({ kind: "organization" }),
      text(world.organization.displayName),
      {
        badge: TreeBadges.Organization,
        selection: Option.some({ kind: "organization" }),
        children: childrenUnder(world, { type: "organization", id: world.organization.id }),
      },
    );
    const billing = world.billingAccounts.map((b) =>
      node(Selection.key({ kind: "billing", id: b.id }), text(b.id), {
        badge: TreeBadges.Billing,
        selection: Option.some({ kind: "billing", id: b.id }),
      }),
    );
    return [organization, ...billing];
  },
} as const;

/** バインディングがどこに付いているか。表示の綴り（`組織 example.com` 等）は表示側が決める。 */
export type BindingOrigin =
  | Readonly<{ kind: "self"; target: PolicyTarget }>
  | Readonly<{ kind: "organization"; displayName: string }>
  | Readonly<{ kind: "folder"; displayName: string }>
  | Readonly<{ kind: "project"; projectId: string }>
  | Readonly<{ kind: "bucket"; name: string }>;

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
    case "bucket":
      return { kind: "bucket", name: grantedAt.id };
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
