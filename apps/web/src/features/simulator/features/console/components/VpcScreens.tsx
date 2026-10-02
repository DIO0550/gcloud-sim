import type { ReactElement } from "react";
import { Select } from "@/components/Select";

import {
  type Direction,
  Directions,
  type FirewallAction,
  FirewallActions,
  ProtocolRule,
} from "@/engine/domains/compute";
import { World } from "@/engine/domains/world";
import {
  CreateFormSection,
  Field,
  PrimaryButton,
  ResourceTable,
  ScreenTitle,
  TextInput,
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
              <TextInput id={id} value={form.name} onChange={(v) => editor.set("name", v)} />
            )}
          </Field>
          <Field label="ネットワーク">
            {(id) => (
              <Select
                id={id}
                value={form.network}
                onChange={(network) => editor.set("network", network)}
                options={World.networksOf(world, projectId).map((n) => ({
                  value: n.name,
                  label: n.name,
                }))}
              />
            )}
          </Field>
          <Field label="トラフィックの方向">
            {(id) => (
              <Select
                id={id}
                value={form.direction}
                onChange={(d) => editor.set("direction", d)}
                options={Object.values(Directions).map((d) => ({
                  value: d,
                  label: directionText(d),
                }))}
              />
            )}
          </Field>
          <Field label="優先度" error={editor.errors.priority}>
            {(id) => (
              <TextInput
                id={id}
                value={form.priority}
                onChange={(v) => editor.set("priority", v)}
              />
            )}
          </Field>
          <Field label="ターゲットタグ" hint="空ならすべてのインスタンス">
            {(id) => (
              <TextInput
                id={id}
                value={form.targetTags}
                onChange={(v) => editor.set("targetTags", v)}
              />
            )}
          </Field>
          <Field label="送信元 IPv4 範囲">
            {(id) => (
              <TextInput
                id={id}
                value={form.sourceRanges}
                onChange={(v) => editor.set("sourceRanges", v)}
              />
            )}
          </Field>
          <Field
            label="プロトコルとポート"
            error={editor.errors.protocolsAndPorts}
            hint="tcp:80,tcp:443,icmp"
          >
            {(id) => (
              <TextInput
                id={id}
                value={form.protocolsAndPorts}
                onChange={(v) => editor.set("protocolsAndPorts", v)}
              />
            )}
          </Field>
          <Field label="一致したときのアクション">
            {(id) => (
              <Select
                id={id}
                value={form.action}
                onChange={(a) => editor.set("action", a)}
                options={Object.values(FirewallActions).map((a) => ({
                  value: a,
                  label: actionText(a),
                }))}
              />
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
