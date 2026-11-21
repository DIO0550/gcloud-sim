import type { ReactElement } from "react";
import { Checkbox } from "@/components/Checkbox";
import { Select } from "@/components/Select";
import { Regions } from "@/engine/domains/catalog";

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
import {
  DeleteCommand,
  FirewallCreateForm,
  NetworkCreateForm,
  NetworkFirewallPresets,
  type NetworkSubnetMode,
  presetSourceRange,
} from "@/features/simulator/features/console/domains/equivalent-command";
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

const subnetModeText = (mode: NetworkSubnetMode): string => {
  switch (mode) {
    case "auto":
      return "自動";
    case "custom":
      return "カスタム";
  }
};

/** VPC ネットワーク › VPC ネットワーク: 一覧と作成（サブネット作成モードと標準のファイアウォール ルール）。 */
export const VpcNetworksScreen = ({
  world,
  project,
  handlers,
  outcome,
}: ScreenProps): ReactElement => {
  const projectId = project.projectId;
  const editor = useCreateForm(NetworkCreateForm, NetworkCreateForm.create, false, outcome);
  const form = Option.unwrapOr(editor.form, NetworkCreateForm.create());
  const subnets = World.subnetsOf(world, projectId);
  const create = (): void => {
    const valid = editor.submit();
    if (!Option.isSome(valid)) return;
    const [first, ...rest] = NetworkCreateForm.toSteps(valid.value, projectId);
    if (first === undefined) return;
    handlers.submit({ ...first, next: Option.none, rest });
    editor.awaitClose();
  };
  const remove = (name: string): void => {
    if (!handlers.confirm(`VPC ネットワーク ${name} を削除しますか？`)) return;
    handlers.submit({
      line: DeleteCommand.network(name, projectId),
      note: `VPC ネットワークを削除 (${name})`,
      next: Option.none,
    });
  };
  const steps = NetworkCreateForm.toSteps(form, projectId);
  return (
    <div>
      <ScreenTitle
        eyebrow="VPC ネットワーク"
        title="VPC ネットワーク"
        trailing={<PrimaryButton onClick={editor.open}>VPC ネットワークを作成</PrimaryButton>}
      />
      {Option.isSome(editor.form) && (
        <CreateFormSection
          label="VPC ネットワークを作成"
          columns={2}
          command={NetworkCreateForm.toCommand(form, projectId)}
          onCopy={handlers.copy}
          onInsert={() => handlers.insert(steps[0]?.line ?? "")}
          onSubmit={create}
          onCancel={editor.close}
          submitLabel="作成"
        >
          <Field label="名前" error={editor.errors.name}>
            {(id) => (
              <TextInput id={id} value={form.name} onChange={(v) => editor.set("name", v)} />
            )}
          </Field>
          <Field
            label="サブネット作成モード"
            hint={
              form.subnetMode === "auto"
                ? "各リージョンに 1 つずつ、10.128.0.0/9 の中からサブネットを作ります"
                : "サブネットを自分で決めます（ここでは 1 つ目だけ作り、追加は CLI の gcloud compute networks subnets create で作成）"
            }
          >
            {(id) => (
              <Select<NetworkSubnetMode>
                id={id}
                value={form.subnetMode}
                onChange={(m) => editor.set("subnetMode", m)}
                options={(["auto", "custom"] as const).map((m) => ({
                  value: m,
                  label: subnetModeText(m),
                }))}
              />
            )}
          </Field>
          {form.subnetMode === "custom" && (
            <>
              <Field label="サブネットの名前" error={editor.errors.subnetName}>
                {(id) => (
                  <TextInput
                    id={id}
                    value={form.subnetName}
                    onChange={(v) => editor.set("subnetName", v)}
                  />
                )}
              </Field>
              <Field label="リージョン">
                {(id) => (
                  <Select
                    id={id}
                    value={form.subnetRegion}
                    onChange={(r) => editor.set("subnetRegion", r)}
                    options={Object.values(Regions).map((r) => ({ value: r, label: r }))}
                  />
                )}
              </Field>
              <Field label="IPv4 範囲" error={editor.errors.subnetRange} hint="10.130.0.0/20">
                {(id) => (
                  <TextInput
                    id={id}
                    value={form.subnetRange}
                    onChange={(v) => editor.set("subnetRange", v)}
                  />
                )}
              </Field>
            </>
          )}
          <fieldset className="sm:col-span-2">
            <legend className="mb-2 font-bold text-sm">ファイアウォール ルール</legend>
            <div className="grid gap-2 text-sm">
              {NetworkFirewallPresets.map((p) => (
                <Checkbox key={p.key} checked={form[p.key]} onChange={(v) => editor.set(p.key, v)}>
                  <span className="font-mono">
                    {form.name || "NAME"}-{p.suffix}
                  </span>
                  {` ${p.label} / 送信元 ${presetSourceRange(p, form) || "（サブネットの範囲）"} / 優先度 65534`}
                </Checkbox>
              ))}
              <p className="text-muted text-xs">
                deny-all-ingress と allow-all-egress（優先度
                65535）は暗黙のルールのため、選択も無効化もできません。
              </p>
            </div>
          </fieldset>
        </CreateFormSection>
      )}
      <ResourceTable
        label="VPC ネットワーク"
        rows={World.networksOf(world, projectId)}
        keyOf={(n) => n.name}
        empty="VPC ネットワークはありません。"
        onDelete={(n) => remove(n.name)}
        columns={[
          { header: "名前", cell: (n) => <span className="font-mono">{n.name}</span> },
          {
            header: "サブネット作成モード",
            cell: (n) => (n.subnetMode === "AUTO" ? "自動" : "カスタム"),
          },
          {
            header: "サブネット",
            cell: (n) => String(subnets.filter((s) => s.network === n.name).length),
          },
        ]}
      />
    </div>
  );
};

/** VPC ネットワーク › ファイアウォール: 一覧と作成。 */
export const FirewallScreen = ({
  world,
  project,
  handlers,
  outcome,
}: ScreenProps): ReactElement => {
  const projectId = project.projectId;
  const editor = useCreateForm(FirewallCreateForm, FirewallCreateForm.create, false, outcome);
  const form = Option.unwrapOr(editor.form, FirewallCreateForm.create());
  const create = (): void => {
    const valid = editor.submit();
    if (!Option.isSome(valid)) return;
    handlers.submit({
      line: FirewallCreateForm.toCommand(valid.value, projectId),
      note: `ファイアウォール ルールを作成 (${valid.value.name})`,
      next: Option.none,
    });
    editor.awaitClose();
  };
  const remove = (name: string): void => {
    if (!handlers.confirm(`ファイアウォール ルール ${name} を削除しますか？`)) return;
    handlers.submit({
      line: DeleteCommand.firewallRule(name, projectId),
      note: `ファイアウォール ルールを削除 (${name})`,
      next: Option.none,
    });
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
          <Field
            label={form.direction === Directions.Egress ? "宛先 IPv4 範囲" : "送信元 IPv4 範囲"}
          >
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
        onDelete={(r) => remove(r.name)}
        columns={[
          { header: "名前", cell: (r) => <span className="font-mono">{r.name}</span> },
          { header: "ネットワーク", cell: (r) => r.network },
          { header: "方向", cell: (r) => directionText(r.direction) },
          { header: "優先度", cell: (r) => String(r.priority) },
          {
            header: "ターゲット",
            cell: (r) => (r.targetTags.length === 0 ? "すべて" : r.targetTags.join(", ")),
          },
          {
            header: "送信元 / 宛先",
            cell: (r) =>
              r.direction === Directions.Egress
                ? r.destinationRanges.join(", ") || "-"
                : r.sourceRanges.join(", ") || "-",
          },
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
export const SubnetsScreen = ({ world, project, handlers }: ScreenProps): ReactElement => {
  const remove = (subnet: Readonly<{ name: string; region: string }>): void => {
    if (!handlers.confirm(`サブネット ${subnet.name}（${subnet.region}）を削除しますか？`)) return;
    handlers.submit({
      line: DeleteCommand.subnet(subnet, project.projectId),
      note: `サブネットを削除 (${subnet.name})`,
      next: Option.none,
    });
  };
  return (
    <div>
      <ScreenTitle eyebrow="VPC ネットワーク" title="サブネット" />
      <ResourceTable
        label="サブネット"
        rows={World.subnetsOf(world, project.projectId)}
        keyOf={(s) => `${s.region}/${s.name}`}
        nameOf={(s) => `${s.name}（${s.region}）`}
        empty="サブネットはありません。gcloud compute networks subnets create で作成できます。"
        onDelete={remove}
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
};
