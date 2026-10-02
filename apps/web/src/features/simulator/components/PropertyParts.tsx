import type { ReactElement, ReactNode } from "react";

import { SectionHeading } from "@/components/SectionHeading";
import type { IamMember } from "@/engine/domains/iam-policy";
import type { PolicyTarget } from "@/engine/domains/resource-hierarchy";
import { World } from "@/engine/domains/world";
import { BindingRow, type TreeSelection } from "@/engine/resource-tree";
import { originText } from "@/features/simulator/features/console";

/** プロパティパネルの本体が受け取るもの。選択の種類ごとに中身の型が絞られる。 */
export type SelectionProps<K extends TreeSelection["kind"]> = Readonly<{
  world: World;
  selection: Extract<TreeSelection, { kind: K }>;
}>;

/** 1 行。値はふつう文字列で、札や色付きの綴りを置きたいときだけ要素を渡す。 */
export type Row = Readonly<{ label: string; value: ReactNode }>;

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
  <section className="mb-5">
    <SectionHeading className="mb-2">{title}</SectionHeading>
    <dl className="grid grid-cols-[8.5rem_1fr] gap-x-2 gap-y-1.5 text-[14.5px]">
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

const memberLabel = (member: IamMember): string => member.replace(/^user:/, "");

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
                {World.roleTitle(world, row.role)}
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
    <SectionHeading>{target.type === "organization" ? "IAM" : "IAM（継承を含む）"}</SectionHeading>
    <PolicyTable world={world} target={target} />
  </>
);

export { PolicyTable };
