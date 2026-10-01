import type { ReactElement } from "react";

import type { IamMember, RoleName } from "@/engine/domains/iam-policy";
import type { PolicyTarget } from "@/engine/domains/resource-hierarchy";
import { RoleCatalog } from "@/engine/domains/role-catalog";
import { World } from "@/engine/domains/world";
import { type BindingOrigin, BindingRow, type TreeSelection } from "@/engine/resource-tree";
import { Option } from "@/utils/Option";

/** プロパティパネルの本体が受け取るもの。選択の種類ごとに中身の型が絞られる。 */
export type SelectionProps<K extends TreeSelection["kind"]> = Readonly<{
  world: World;
  selection: Extract<TreeSelection, { kind: K }>;
}>;

export type Row = Readonly<{ label: string; value: string }>;

/** 無い・空のときの綴り。`-` は値が無いこと、`(none)` は集合が空なことを表す。 */
export const Absent = "-";
export const Empty = "(none)";

/** 並びを `, ` で繋ぐ。空なら `(none)`。 */
export const joined = (items: readonly string[]): string =>
  items.length === 0 ? Empty : items.join(", ");

export const Section = ({
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

export const NotFound = ({ what }: Readonly<{ what: string }>): ReactElement => (
  <p className="text-muted text-sm">{what} は見つかりません（削除されました）。</p>
);

/** ロールの表示名。カタログに無ければ World のカスタムロール、それも無ければ名前そのまま。 */
export const roleTitle = (world: World, role: RoleName): string =>
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

/** 見出し付きの IAM の表。対象が上位から継承するなら見出しにそう書く。 */
export const IamSection = ({
  world,
  target,
}: Readonly<{ world: World; target: PolicyTarget }>): ReactElement => (
  <>
    <h4 className="mb-1 font-semibold text-muted text-xs">
      {target.type === "organization" ? "IAM" : "IAM（継承を含む）"}
    </h4>
    <PolicyTable world={world} target={target} />
  </>
);

export { PolicyTable };
