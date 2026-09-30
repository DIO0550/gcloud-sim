import type { ReactElement } from "react";

import {
  DefaultScopes,
  ExternalIp,
  FirewallRule,
  Instance,
  ProtocolRule,
} from "@/engine/domains/compute";
import { GcloudConfig } from "@/engine/domains/gcloud-config";
import type { IamMember, RoleName } from "@/engine/domains/iam-policy";
import { CloudRunService } from "@/engine/domains/managed-services";
import type { PolicyTarget } from "@/engine/domains/resource-hierarchy";
import { RoleCatalog } from "@/engine/domains/role-catalog";
import { World } from "@/engine/domains/world";
import { type BindingOrigin, BindingRow, Selection } from "@/engine/resource-tree";
import { Option } from "@/utils/Option";

type PropertiesPanelProps = Readonly<{
  world: World;
  selection: Option<Selection>;
  onInsert: (command: string) => void;
}>;

type Row = Readonly<{ label: string; value: string }>;

const Section = ({
  title,
  rows,
}: Readonly<{ title: string; rows: readonly Row[] }>): ReactElement => (
  <section className="mb-4">
    <h4 className="mb-1 font-semibold text-muted text-xs">{title}</h4>
    <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1 text-sm">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-muted">{row.label}</dt>
          <dd className="break-all font-mono">{row.value}</dd>
        </div>
      ))}
    </dl>
  </section>
);

/** ロールの表示名。カタログに無ければ World のカスタムロール、それも無ければ名前そのまま。 */
const roleTitle = (world: World, role: RoleName): string =>
  Option.unwrapOr(
    Option.or(
      Option.map(RoleCatalog.find(role), (r) => r.title),
      Option.map(World.findCustomRole(world, role), (r) => r.title),
    ),
    role,
  );

const memberLabel = (member: IamMember): string => member.replace(/^user:/, "");

/** 継承元の綴り（モック s2: `組織 example.com` / `フォルダ dev` / `このプロジェクト`）。 */
const originText = (origin: BindingOrigin): string => {
  switch (origin.kind) {
    case "self":
      switch (origin.target.type) {
        case "organization":
          return "この組織";
        case "folder":
          return "このフォルダ";
        case "project":
          return "このプロジェクト";
        case "bucket":
          return "このバケット";
        case "service-account":
          return "このサービスアカウント";
      }
      break;
    case "organization":
      return `組織 ${origin.displayName}`;
    case "folder":
      return `フォルダ ${origin.displayName}`;
    case "project":
      return `プロジェクト ${origin.projectId}`;
    case "bucket":
      return `バケット ${origin.name}`;
    case "service-account":
      return `サービスアカウント ${origin.email}`;
  }
};

const protocolText = (rules: readonly ProtocolRule[]): string =>
  rules.map(ProtocolRule.toText).join(", ") || "-";

/** IAM の表（モック s2: プリンシパル・ロール・継承元）。 */
const PolicyTable = ({
  world,
  target,
}: Readonly<{ world: World; target: PolicyTarget }>): ReactElement => {
  const rows = BindingRow.fromWorld(world, target);
  return (
    <table className="w-full table-fixed text-sm" aria-label="IAM ポリシー">
      <colgroup>
        <col className="w-[38%]" />
        <col className="w-[38%]" />
        <col className="w-[24%]" />
      </colgroup>
      <thead className="text-left text-muted text-xs">
        <tr>
          <th className="py-1 pr-2 font-medium">プリンシパル</th>
          <th className="py-1 pr-2 font-medium">ロール</th>
          <th className="py-1 font-medium">継承元</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <td colSpan={3} className="py-2 text-muted">
              バインディングはありません
            </td>
          </tr>
        )}
        {rows.map((row) => {
          const origin = originText(row.origin);
          return (
            <tr key={`${row.member}/${row.role}/${origin}`} className="border-line border-t">
              <td className="break-all py-1.5 pr-2 font-mono text-xs">{memberLabel(row.member)}</td>
              <td className="py-1.5 pr-2">
                {roleTitle(world, row.role)}
                <span className="block font-mono text-muted text-xs">{row.role}</span>
              </td>
              <td
                className={`py-1.5 text-xs ${BindingRow.isInherited(row) ? "text-warn-ink" : "text-muted"}`}
              >
                {origin}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};

const NotFound = ({ what }: Readonly<{ what: string }>): ReactElement => (
  <p className="text-muted text-sm">{what} は見つかりません（削除されました）。</p>
);

const Body = ({
  world,
  selection,
}: Readonly<{ world: World; selection: Selection }>): ReactElement => {
  switch (selection.kind) {
    case "organization":
      return (
        <>
          <Section
            title="基本"
            rows={[
              { label: "id", value: world.organization.id },
              { label: "displayName", value: world.organization.displayName },
            ]}
          />
          <h4 className="mb-1 font-semibold text-muted text-xs">IAM</h4>
          <PolicyTable world={world} target={{ type: "organization", id: world.organization.id }} />
        </>
      );
    case "folder": {
      const folder = World.findFolder(world, selection.id);
      if (!Option.isSome(folder)) return <NotFound what="フォルダ" />;
      return (
        <>
          <Section
            title="基本"
            rows={[
              { label: "id", value: folder.value.id },
              { label: "displayName", value: folder.value.displayName },
              { label: "parent", value: `${folder.value.parent.type}/${folder.value.parent.id}` },
            ]}
          />
          <h4 className="mb-1 font-semibold text-muted text-xs">IAM（継承を含む）</h4>
          <PolicyTable world={world} target={{ type: "folder", id: folder.value.id }} />
        </>
      );
    }
    case "project": {
      const project = World.findProject(world, selection.projectId);
      if (!Option.isSome(project)) return <NotFound what="プロジェクト" />;
      const p = project.value;
      return (
        <>
          <Section
            title="基本"
            rows={[
              { label: "projectId", value: p.projectId },
              { label: "name", value: p.name },
              { label: "projectNumber", value: p.projectNumber },
              { label: "lifecycleState", value: p.lifecycleState },
              { label: "parent", value: `${p.parent.type}/${p.parent.id}` },
              { label: "createTime", value: p.createTime },
            ]}
          />
          <Section
            title="請求"
            rows={[
              { label: "billingAccount", value: Option.unwrapOr(p.billingAccountId, "未リンク") },
            ]}
          />
          <Section
            title="有効な API"
            rows={
              p.enabledApis.length === 0
                ? [{ label: "(none)", value: "gcloud services enable で有効化" }]
                : p.enabledApis.map((api) => ({ label: api.split(".")[0] ?? api, value: api }))
            }
          />
        </>
      );
    }
    case "billing": {
      const account = World.findBillingAccount(world, selection.id);
      if (!Option.isSome(account)) return <NotFound what="請求アカウント" />;
      const linked = world.projects
        .filter(
          (p) => Option.isSome(p.billingAccountId) && p.billingAccountId.value === selection.id,
        )
        .map((p) => p.projectId);
      return (
        <Section
          title="基本"
          rows={[
            { label: "id", value: account.value.id },
            { label: "displayName", value: account.value.displayName },
            { label: "open", value: String(account.value.open) },
            { label: "linked projects", value: linked.length === 0 ? "(none)" : linked.join(", ") },
          ]}
        />
      );
    }
    case "instance": {
      const instance = World.findInstance(
        world,
        selection.projectId,
        selection.zone,
        selection.name,
      );
      if (!Option.isSome(instance)) return <NotFound what="インスタンス" />;
      const i = instance.value;
      const nic = i.networkInterfaces[0];
      const boot = i.disks.find((d) => d.boot);
      const rules = World.firewallRulesOf(world, i.projectId).filter(
        (r) => FirewallRule.appliesTo(r, i) && r.targetTags.length > 0,
      );
      const operations = world.operations.filter((o) => o.targetLink === Instance.selfLink(i));
      return (
        <>
          <Section
            title="基本"
            rows={[
              { label: "machineType", value: i.machineType },
              { label: "zone", value: i.zone },
              {
                label: "scheduling",
                value: `${i.provisioningModel}${i.preemptible ? " · preemptible" : ""}`,
              },
              { label: "creationTimestamp", value: i.creationTimestamp },
            ]}
          />
          <Section
            title="ネットワーク"
            rows={[
              {
                label: "network / subnet",
                value: nic === undefined ? "-" : `${nic.network} / ${nic.subnetwork}`,
              },
              { label: "internal IP", value: nic?.networkIP ?? "-" },
              {
                label: "external IP",
                value:
                  nic === undefined
                    ? "-"
                    : nic.externalIP.kind === "none"
                      ? "なし"
                      : `${Option.unwrapOr(ExternalIp.address(nic.externalIP), "(解放中)")} エフェメラル`,
              },
              { label: "tags", value: i.tags.length === 0 ? "(none)" : i.tags.join(", ") },
            ]}
          />
          {rules.length > 0 && (
            <p className="mb-4 rounded bg-ok-soft px-3 py-2 text-sm">
              ↳ 適用されるファイアウォール:{" "}
              {rules.map((r) => `${r.name}（${protocolText(r.allowed)} · タグ一致）`).join(" / ")}
            </p>
          )}
          <Section
            title="ディスク"
            rows={[
              {
                label: "boot",
                value:
                  boot === undefined ? "-" : `${boot.deviceName} · ${boot.type} · ${boot.sizeGb}GB`,
              },
              { label: "image", value: boot?.sourceImage.split("/").at(-1) ?? "-" },
            ]}
          />
          <Section
            title="ID とアクセス"
            rows={[
              { label: "serviceAccount", value: i.serviceAccount },
              {
                label: "scopes",
                value:
                  i.scopes.length === DefaultScopes.length &&
                  DefaultScopes.every((s) => i.scopes.includes(s))
                    ? `デフォルト（${DefaultScopes.length} 件）`
                    : `${i.scopes.length} 件`,
              },
            ]}
          />
          <Section
            title="オペレーション"
            rows={operations.map((o) => ({
              label: o.operationType,
              value: `${o.status} ${o.insertTime}`,
            }))}
          />
        </>
      );
    }
    case "network": {
      const network = World.findNetwork(world, selection.projectId, selection.name);
      if (!Option.isSome(network)) return <NotFound what="ネットワーク" />;
      const subnets = World.subnetsOf(world, selection.projectId).filter(
        (s) => s.network === selection.name,
      );
      return (
        <>
          <Section
            title="基本"
            rows={[
              { label: "name", value: network.value.name },
              { label: "subnetMode", value: network.value.subnetMode },
            ]}
          />
          <Section
            title="サブネット"
            rows={subnets.map((s) => ({ label: s.region, value: `${s.name} ${s.ipCidrRange}` }))}
          />
        </>
      );
    }
    case "firewall": {
      const rule = World.findFirewallRule(world, selection.projectId, selection.name);
      if (!Option.isSome(rule)) return <NotFound what="ファイアウォールルール" />;
      const r = rule.value;
      return (
        <Section
          title="基本"
          rows={[
            { label: "network", value: r.network },
            { label: "direction", value: r.direction },
            { label: "priority", value: String(r.priority) },
            { label: "sourceRanges", value: r.sourceRanges.join(", ") || "-" },
            { label: "targetTags", value: r.targetTags.join(", ") || "(すべてのインスタンス)" },
            { label: "allow", value: protocolText(r.allowed) },
            { label: "deny", value: protocolText(r.denied) },
          ]}
        />
      );
    }
    case "bucket": {
      const bucket = World.findBucket(world, selection.name);
      if (!Option.isSome(bucket)) return <NotFound what="バケット" />;
      const b = bucket.value;
      return (
        <>
          <Section
            title="基本"
            rows={[
              { label: "location", value: b.location },
              { label: "storageClass", value: b.storageClass },
              { label: "uniformBucketLevelAccess", value: String(b.uniformBucketLevelAccess) },
              { label: "objects", value: String(b.objects.length) },
            ]}
          />
          <h4 className="mb-1 font-semibold text-muted text-xs">IAM（継承を含む）</h4>
          <PolicyTable world={world} target={{ type: "bucket", id: b.name }} />
        </>
      );
    }
    case "cluster": {
      const cluster = World.findCluster(world, selection.projectId, selection.name);
      if (!Option.isSome(cluster)) return <NotFound what="クラスタ" />;
      const c = cluster.value;
      return (
        <Section
          title="基本"
          rows={[
            { label: "location", value: c.location },
            { label: "mode", value: c.autopilot ? "Autopilot" : "Standard" },
            { label: "nodeCount", value: String(c.nodeCount) },
            { label: "machineType", value: c.machineType },
            { label: "status", value: c.status },
          ]}
        />
      );
    }
    case "run-service": {
      const service = World.findRunService(world, selection.projectId, selection.name);
      if (!Option.isSome(service)) return <NotFound what="サービス" />;
      const s = service.value;
      return (
        <Section
          title="基本"
          rows={[
            { label: "region", value: s.region },
            { label: "image", value: s.image },
            { label: "url", value: CloudRunService.url(s) },
            { label: "unauthenticated", value: s.allowUnauthenticated ? "許可" : "拒否" },
          ]}
        />
      );
    }
    case "service-account": {
      const account = World.findServiceAccount(world, selection.email);
      if (!Option.isSome(account)) return <NotFound what="サービスアカウント" />;
      return (
        <Section
          title="基本"
          rows={[
            { label: "email", value: account.value.email },
            { label: "displayName", value: account.value.displayName },
            { label: "uniqueId", value: account.value.uniqueId },
          ]}
        />
      );
    }
    case "iam":
      return <PolicyTable world={world} target={selection.target} />;
  }
};

const titleOf = (selection: Selection): string => {
  switch (selection.kind) {
    case "organization":
      return "組織";
    case "folder":
      return `フォルダ ${selection.id}`;
    case "project":
      return selection.projectId;
    case "billing":
      return selection.id;
    case "instance":
      return selection.name;
    case "network":
    case "firewall":
    case "cluster":
    case "run-service":
      return selection.name;
    case "bucket":
      return `gs://${selection.name}`;
    case "service-account":
      return selection.email;
    case "iam":
      return `IAM: ${selection.target.type}/${selection.target.id}`;
  }
};

const kindLabel = (selection: Selection): string => {
  switch (selection.kind) {
    case "organization":
      return "cloudresourcemanager#organization";
    case "folder":
      return "cloudresourcemanager#folder";
    case "project":
      return "cloudresourcemanager#project";
    case "billing":
      return "cloudbilling#billingAccount";
    case "instance":
      return `compute#instance · projects/${selection.projectId}/zones/${selection.zone}`;
    case "network":
      return "compute#network";
    case "firewall":
      return "compute#firewall";
    case "bucket":
      return "storage#bucket";
    case "cluster":
      return "container#cluster";
    case "run-service":
      return "run#service";
    case "service-account":
      return "iam#serviceAccount";
    case "iam":
      return "iam#policy";
  }
};

const statusOf = (world: World, selection: Selection): Option<string> => {
  if (selection.kind !== "instance") return Option.none;
  return Option.map(
    World.findInstance(world, selection.projectId, selection.zone, selection.name),
    (i) => i.status,
  );
};

/** 右ペイン「プロパティ」: 選択したリソースの中身と IAM の継承元（UC-007）。 */
export const PropertiesPanel = ({
  world,
  selection,
  onInsert,
}: PropertiesPanelProps): ReactElement => {
  if (!Option.isSome(selection)) {
    return (
      <div className="p-5 text-muted text-sm">
        <p>左のリソース階層から項目を選ぶと、ここにプロパティと IAM の継承元が出ます。</p>
        <p className="mt-3">
          現在の configuration:{" "}
          <span className="font-mono">{world.config.activeConfiguration}</span>
          {Option.isSome(GcloudConfig.get(world.config, "compute/zone")) && (
            <>
              {" "}
              · compute/zone:{" "}
              <span className="font-mono">
                {Option.unwrapOr(GcloudConfig.get(world.config, "compute/zone"), "")}
              </span>
            </>
          )}
        </p>
      </div>
    );
  }
  const describe = Selection.describeCommand(selection.value);
  const status = statusOf(world, selection.value);
  return (
    <div className="p-5">
      <div className="mb-1 flex items-center gap-2">
        <h3 className="font-bold font-mono text-lg">{titleOf(selection.value)}</h3>
        {Option.isSome(status) && (
          <span
            className={`rounded px-1.5 py-0.5 font-mono text-xs ${status.value === "RUNNING" ? "bg-ok-soft text-ok-ink" : "bg-canvas text-muted"}`}
          >
            {status.value}
          </span>
        )}
      </div>
      <p className="mb-3 break-all font-mono text-muted text-xs">{kindLabel(selection.value)}</p>
      {Option.isSome(describe) && (
        <div className="mb-4 flex gap-2">
          <button
            type="button"
            className="rounded border border-line px-3 py-1 text-sm hover:bg-canvas"
            onClick={() => onInsert(describe.value)}
          >
            describe を挿入
          </button>
          <button
            type="button"
            className="rounded border border-line px-3 py-1 text-sm hover:bg-canvas"
            onClick={() => onInsert(`${describe.value} --format=json`)}
          >
            JSON
          </button>
        </div>
      )}
      <Body world={world} selection={selection.value} />
    </div>
  );
};
