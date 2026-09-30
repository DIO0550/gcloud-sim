import type { Zone } from "@/engine/domains/catalog";
import { type IamMember, IamPolicy, type RoleName } from "@/engine/domains/iam-policy";
import type { PolicyTarget, Project } from "@/engine/domains/resource-hierarchy";
import { World } from "@/engine/domains/world";
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
   * @returns そのリソースを describe するコマンド。無いもの（グループ等）は `none`
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

export type TreeNode = Readonly<{
  key: string;
  /** 左に出す種別ラベル（`組織` `フォルダ` `PJ` `請求`）。リソース種別のグループは空 */
  badge: string;
  label: string;
  /** グループ行に出す件数 */
  count: Option<number>;
  selection: Option<Selection>;
  children: readonly TreeNode[];
  /** インスタンスの状態など、ラベルの左に出す点の色 */
  status: "none" | "running" | "stopped";
}>;

const node = (
  key: string,
  label: string,
  fields: Partial<Pick<TreeNode, "badge" | "count" | "selection" | "children" | "status">> = {},
): TreeNode => ({
  key,
  label,
  badge: fields.badge ?? "",
  count: fields.count ?? Option.none,
  selection: fields.selection ?? Option.none,
  children: fields.children ?? [],
  status: fields.status ?? "none",
});

const group = (key: string, label: string, children: readonly TreeNode[]): readonly TreeNode[] =>
  children.length === 0
    ? []
    : [node(key, label, { count: Option.some(children.length), children })];

const leaf = (selection: Selection, label: string, status: TreeNode["status"] = "none"): TreeNode =>
  node(Selection.key(selection), label, { selection: Option.some(selection), status });

const byName = <T extends { name: string }>(items: readonly T[]): readonly T[] =>
  items.toSorted((a, b) => a.name.localeCompare(b.name));

const projectNode = (world: World, project: Project): TreeNode => {
  const id = project.projectId;
  const instances = byName(World.instancesOf(world, id)).map((i) =>
    leaf(
      { kind: "instance", projectId: id, zone: i.zone, name: i.name },
      i.name,
      i.status === "RUNNING" ? "running" : "stopped",
    ),
  );
  const networks = byName(World.networksOf(world, id)).map((n) =>
    node(Selection.key({ kind: "network", projectId: id, name: n.name }), n.name, {
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
  const iam = node(Selection.key({ kind: "iam", target: { type: "project", id } }), "IAM", {
    count: Option.some(bindingCount),
    selection: Option.some({ kind: "iam", target: { type: "project", id } }),
  });
  return node(Selection.key({ kind: "project", projectId: id }), id, {
    badge: "PJ",
    selection: Option.some({ kind: "project", projectId: id }),
    children: [
      ...group(`${id}/compute`, "Compute Engine", instances),
      ...group(`${id}/vpc`, "VPC ネットワーク", networks),
      ...group(`${id}/storage`, "Cloud Storage", buckets),
      ...group(`${id}/gke`, "Kubernetes Engine", clusters),
      ...group(`${id}/run`, "Cloud Run", services),
      ...group(`${id}/sa`, "サービスアカウント", accounts),
      iam,
    ],
  });
};

const folderNode = (world: World, folderId: string): readonly TreeNode[] =>
  world.folders
    .filter((f) => f.parent.type === "folder" && f.parent.id === folderId)
    .toSorted((a, b) => a.displayName.localeCompare(b.displayName))
    .map((f) => folderSubtree(world, f.id, f.displayName));

const folderSubtree = (world: World, folderId: string, label: string): TreeNode =>
  node(Selection.key({ kind: "folder", id: folderId }), label, {
    badge: "フォルダ",
    selection: Option.some({ kind: "folder", id: folderId }),
    children: [
      ...folderNode(world, folderId),
      ...World.activeProjects(world)
        .filter((p) => p.parent.type === "folder" && p.parent.id === folderId)
        .toSorted((a, b) => a.projectId.localeCompare(b.projectId))
        .map((p) => projectNode(world, p)),
    ],
  });

export const ResourceTree = {
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
      world.organization.displayName,
      {
        badge: "組織",
        selection: Option.some({ kind: "organization" }),
        children: [
          ...world.folders
            .filter((f) => f.parent.type === "organization")
            .toSorted((a, b) => a.displayName.localeCompare(b.displayName))
            .map((f) => folderSubtree(world, f.id, f.displayName)),
          ...World.activeProjects(world)
            .filter((p) => p.parent.type === "organization")
            .toSorted((a, b) => a.projectId.localeCompare(b.projectId))
            .map((p) => projectNode(world, p)),
        ],
      },
    );
    const billing = world.billingAccounts.map((b) =>
      node(Selection.key({ kind: "billing", id: b.id }), b.id, {
        badge: "請求",
        selection: Option.some({ kind: "billing", id: b.id }),
      }),
    );
    return [organization, ...billing];
  },
} as const;

/** 継承元を明示したバインディングの 1 行（UC-007: どこから継承されたか）。 */
export type InheritedBinding = Readonly<{
  member: IamMember;
  role: RoleName;
  grantedAt: PolicyTarget;
  inherited: boolean;
}>;

export const InheritedPolicy = {
  /**
   * 対象に直接付いたバインディングと、上位から継承されるバインディングを近い順に並べる。
   *
   * @param world 元
   * @param target 対象
   * @returns 行の並び。先頭が対象自身、後ろほど上位
   */
  of(world: World, target: PolicyTarget): readonly InheritedBinding[] {
    return World.ancestry(world, target).flatMap((ancestor) => {
      const policy = Option.unwrapOr(World.policyOf(world, ancestor), IamPolicy.Empty);
      return policy.bindings.flatMap((b) =>
        b.members.map(
          (member): InheritedBinding => ({
            member,
            role: b.role,
            grantedAt: ancestor,
            inherited: ancestor.type !== target.type || ancestor.id !== target.id,
          }),
        ),
      );
    });
  },

  /** 継承元の表示ラベル（`組織 example.com` / `フォルダ dev` / `このプロジェクト`）。 */
  label(world: World, target: PolicyTarget, grantedAt: PolicyTarget): string {
    const isSelf = grantedAt.type === target.type && grantedAt.id === target.id;
    switch (grantedAt.type) {
      case "organization":
        return isSelf ? "この組織" : `組織 ${world.organization.displayName}`;
      case "folder": {
        const folder = World.findFolder(world, grantedAt.id);
        const name = Option.isSome(folder) ? folder.value.displayName : grantedAt.id;
        return isSelf ? "このフォルダ" : `フォルダ ${name}`;
      }
      case "project":
        return isSelf ? "このプロジェクト" : `プロジェクト ${grantedAt.id}`;
      case "bucket":
        return isSelf ? "このバケット" : `バケット ${grantedAt.id}`;
    }
  },
} as const;
