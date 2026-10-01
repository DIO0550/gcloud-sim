import type { ReactElement } from "react";

import {
  Direction,
  Directions,
  FirewallAction,
  FirewallActions,
  ProtocolRule,
} from "@/engine/domains/compute";
import { World } from "@/engine/domains/world";
import {
  CreateFormSection,
  Field,
  InputClass,
  PrimaryButton,
  ResourceTable,
  ScreenTitle,
} from "@/features/simulator/features/console/components/ConsoleParts";
import { FirewallCreateForm } from "@/features/simulator/features/console/domains/equivalent-command";
import { useCreateForm } from "@/features/simulator/features/console/hooks/use-create-form";
import type { ScreenProps } from "@/features/simulator/features/console/types/screen-props";
import { Option } from "@/utils/Option";

const directionText = (direction: Direction): string => {
  switch (direction) {
    case "INGRESS":
      return "上り（内向き）";
    case "EGRESS":
      return "下り（外向き）";
  }
};

const actionText = (action: FirewallAction): string => {
  switch (action) {
    case "ALLOW":
      return "許可";
    case "DENY":
      return "拒否";
  }
};

/** VPC ネットワーク › ファイアウォール: 一覧と作成。 */
export const FirewallScreen = ({ world, project, handlers }: ScreenProps): ReactElement => {
  const projectId = project.projectId;
  const editor = useCreateForm(FirewallCreateForm, FirewallCreateForm.create);
  const form = Option.unwrapOr(editor.form, FirewallCreateForm.create());
  const create = (): void => {
    const valid = editor.submit();
    if (!Option.isSome(valid)) return;
    handlers.submit({
      line: FirewallCreateForm.toCommand(valid.value, projectId),
      note: `ファイアウォール ルールを作成 (${valid.value.name})`,
      next: Option.none,
    });
    editor.close();
  };
  /** 選択肢に無い値は無視して今の値を保つ（select は選択肢しか出さないので、届くのは選択肢だけ）。 */
  const setParsed = <K extends keyof FirewallCreateForm>(
    key: K,
    parsed: Option<FirewallCreateForm[K]>,
  ): void => {
    if (Option.isSome(parsed)) editor.set(key, parsed.value);
  };
  return (
    <div>
      <ScreenTitle
        eyebrow="VPC ネットワーク"
        title="ファイアウォール"
        trailing={
          <PrimaryButton onClick={editor.open}>ファイアウォール ルールを作成</PrimaryButton>
        }
      />
      {Option.isSome(editor.form) && (
        <CreateFormSection
          label="ファイアウォール ルールを作成"
          columns={3}
          command={FirewallCreateForm.toCommand(form, projectId)}
          onCopy={handlers.copy}
          onInsert={handlers.insert}
          onSubmit={create}
          onCancel={editor.close}
          submitLabel="作成"
        >
          <Field label="名前" error={editor.errors.name}>
            {(id) => (
              <input
                id={id}
                className={InputClass}
                value={form.name}
                onChange={(e) => editor.set("name", e.target.value)}
              />
            )}
          </Field>
          <Field label="ネットワーク">
            {(id) => (
              <select
                id={id}
                className={InputClass}
                value={form.network}
                onChange={(e) => editor.set("network", e.target.value)}
              >
                {World.networksOf(world, projectId).map((n) => (
                  <option key={n.name} value={n.name}>
                    {n.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="トラフィックの方向">
            {(id) => (
              <select
                id={id}
                className={InputClass}
                value={form.direction}
                onChange={(e) => setParsed("direction", Direction.parse(e.target.value))}
              >
                {Object.values(Directions).map((d) => (
                  <option key={d} value={d}>
                    {directionText(d)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="優先度" error={editor.errors.priority}>
            {(id) => (
              <input
                id={id}
                className={InputClass}
                value={form.priority}
                onChange={(e) => editor.set("priority", e.target.value)}
              />
            )}
          </Field>
          <Field label="ターゲットタグ" hint="空ならすべてのインスタンス">
            {(id) => (
              <input
                id={id}
                className={InputClass}
                value={form.targetTags}
                onChange={(e) => editor.set("targetTags", e.target.value)}
              />
            )}
          </Field>
          <Field label="送信元 IPv4 範囲">
            {(id) => (
              <input
                id={id}
                className={InputClass}
                value={form.sourceRanges}
                onChange={(e) => editor.set("sourceRanges", e.target.value)}
              />
            )}
          </Field>
          <Field
            label="プロトコルとポート"
            error={editor.errors.protocolsAndPorts}
            hint="tcp:80,tcp:443,icmp"
          >
            {(id) => (
              <input
                id={id}
                className={InputClass}
                value={form.protocolsAndPorts}
                onChange={(e) => editor.set("protocolsAndPorts", e.target.value)}
              />
            )}
          </Field>
          <Field label="一致したときのアクション">
            {(id) => (
              <select
                id={id}
                className={InputClass}
                value={form.action}
                onChange={(e) => setParsed("action", FirewallAction.parse(e.target.value))}
              >
                {Object.values(FirewallActions).map((a) => (
                  <option key={a} value={a}>
                    {actionText(a)}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </CreateFormSection>
      )}
      <ResourceTable
        label="ファイアウォール ルール"
        rows={World.firewallRulesOf(world, projectId)}
        keyOf={(r) => r.name}
        empty="ルールはありません。"
        columns={[
          { header: "名前", cell: (r) => <span className="font-mono">{r.name}</span> },
          { header: "ネットワーク", cell: (r) => r.network },
          { header: "方向", cell: (r) => r.direction },
          { header: "優先度", cell: (r) => String(r.priority) },
          {
            header: "ターゲット",
            cell: (r) => (r.targetTags.length === 0 ? "すべて" : r.targetTags.join(", ")),
          },
          { header: "送信元", cell: (r) => r.sourceRanges.join(", ") || "-" },
          {
            header: "プロトコル / ポート",
            cell: (r) =>
              r.allowed.length > 0
                ? `許可: ${r.allowed.map(ProtocolRule.toText).join(", ")}`
                : `拒否: ${r.denied.map(ProtocolRule.toText).join(", ")}`,
          },
        ]}
      />
    </div>
  );
};

/** VPC ネットワーク › サブネット: 一覧。 */
export const SubnetsScreen = ({ world, project }: ScreenProps): ReactElement => (
  <div>
    <ScreenTitle eyebrow="VPC ネットワーク" title="サブネット" />
    <ResourceTable
      label="サブネット"
      rows={World.subnetsOf(world, project.projectId)}
      keyOf={(s) => `${s.region}/${s.name}`}
      empty="サブネットはありません。"
      columns={[
        { header: "名前", cell: (s) => <span className="font-mono">{s.name}</span> },
        { header: "リージョン", cell: (s) => s.region },
        { header: "ネットワーク", cell: (s) => s.network },
        { header: "IP 範囲", cell: (s) => <span className="font-mono">{s.ipCidrRange}</span> },
        {
          header: "限定公開の Google アクセス",
          cell: (s) => (s.privateIpGoogleAccess ? "オン" : "オフ"),
        },
      ]}
    />
  </div>
);
