import type { ReactElement } from "react";
import { Checkbox } from "@/components/Checkbox";
import { Select } from "@/components/Select";
import { Region, Regions, Zone } from "@/engine/domains/catalog";

import {
  type Direction,
  Directions,
  type FirewallAction,
  FirewallActions,
  type FirewallRule,
  ProtocolRule,
  SubnetModes,
} from "@/engine/domains/compute";
import { GcloudConfig } from "@/engine/domains/gcloud-config";
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
  FirewallEditForm,
  type FirewallPolicyOrder,
  SubnetEditForm,
  VpcNetworkEditForm,
} from "@/features/simulator/features/console/domains/edit-command/vpc";
import {
  DeleteCommand,
  FirewallCreateForm,
  type FirewallProtocolsMode,
  type FirewallSourceFilter,
  type FirewallTargetType,
  NetworkCreateForm,
  NetworkFirewallPresets,
  type NetworkSubnetMode,
  presetSourceRange,
  SubnetCreateForm,
} from "@/features/simulator/features/console/domains/equivalent-command";
import { useCreateForm } from "@/features/simulator/features/console/hooks/use-create-form";
import type { ScreenProps } from "@/features/simulator/features/console/types/screen-props";
import { Option } from "@/utils/Option";

const directionText = (direction: Direction): string => {
  switch (direction) {
    case "INGRESS":
      return "Ingress（内向き）";
    case "EGRESS":
      return "Egress（外向き）";
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

const targetTypeText = (type: FirewallTargetType): string => {
  switch (type) {
    case "all":
      return "ネットワーク上のすべてのインスタンス";
    case "tags":
      return "指定されたターゲットタグ";
    case "service-accounts":
      return "指定されたサービスアカウント";
  }
};

const sourceFilterText = (filter: FirewallSourceFilter): string => {
  switch (filter) {
    case "ip-ranges":
      return "IPv4 範囲";
    case "source-tags":
      return "ソースタグ";
    case "service-accounts":
      return "サービスアカウント";
  }
};

const protocolsModeText = (mode: FirewallProtocolsMode, action: FirewallAction): string => {
  if (mode === "all") return action === FirewallActions.Allow ? "すべて許可" : "すべて拒否";
  return "指定したプロトコルとポート";
};

const policyOrderText = (order: FirewallPolicyOrder): string => {
  switch (order) {
    case "BEFORE_CLASSIC_FIREWALL":
      return "従来のファイアウォールより前に評価 (BEFORE_CLASSIC_FIREWALL)";
    case "AFTER_CLASSIC_FIREWALL":
      return "従来のファイアウォールより後に評価 (AFTER_CLASSIC_FIREWALL)";
  }
};

const firewallTargetSummary = (r: FirewallRule): string => {
  if ((r.targetServiceAccounts?.length ?? 0) > 0) {
    return `SA: ${r.targetServiceAccounts?.join(", ")}`;
  }
  if (r.targetTags.length > 0) return r.targetTags.join(", ");
  return "すべて";
};

const firewallFilterSummary = (r: FirewallRule): string => {
  if (r.direction === Directions.Egress) {
    return r.destinationRanges.join(", ") || "-";
  }
  const parts: string[] = [];
  if (r.sourceRanges.length > 0) parts.push(r.sourceRanges.join(", "));
  if ((r.sourceTags?.length ?? 0) > 0) parts.push(`タグ: ${r.sourceTags?.join(", ")}`);
  if ((r.sourceServiceAccounts?.length ?? 0) > 0) {
    parts.push(`SA: ${r.sourceServiceAccounts?.join(", ")}`);
  }
  return parts.join(" / ") || "-";
};

const readOnlyClass =
  "w-full rounded border border-line bg-canvas px-2.5 py-1.5 font-mono text-muted text-xs";

/** VPC ネットワーク › VPC ネットワーク: 一覧・作成・編集・削除。 */
export const VpcNetworksScreen = ({
  world,
  project,
  handlers,
  outcome,
}: ScreenProps): ReactElement => {
  const projectId = project.projectId;
  const networks = World.networksOf(world, projectId);
  const editor = useCreateForm(NetworkCreateForm, NetworkCreateForm.create, false, outcome);
  const editSeed = (): VpcNetworkEditForm =>
    VpcNetworkEditForm.fromNetwork(
      networks[0] ?? { projectId, name: "", subnetMode: SubnetModes.Custom },
    );
  const editEditor = useCreateForm(VpcNetworkEditForm, editSeed, false, outcome);
  const editForm = Option.unwrapOr(editEditor.form, editSeed());
  const form = Option.unwrapOr(editor.form, NetworkCreateForm.create());
  const subnets = World.subnetsOf(world, projectId);

  const openCreate = (): void => {
    editEditor.close();
    editor.open();
  };

  const openEdit = (network: (typeof networks)[number]): void => {
    editor.close();
    editEditor.openWith(VpcNetworkEditForm.fromNetwork(network));
  };

  const create = (): void => {
    const valid = editor.submit();
    if (!Option.isSome(valid)) return;
    const [first, ...rest] = NetworkCreateForm.toSteps(valid.value, projectId);
    if (first === undefined) return;
    handlers.submit({ ...first, next: Option.none, rest });
    editor.awaitClose();
  };

  const saveEdit = (): void => {
    const valid = editEditor.submit();
    if (!Option.isSome(valid)) return;
    const [first, ...rest] = VpcNetworkEditForm.toSteps(valid.value, projectId);
    if (first === undefined) {
      editEditor.close();
      return;
    }
    handlers.submit({ ...first, next: Option.none, rest });
    editEditor.awaitClose();
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
        trailing={<PrimaryButton onClick={openCreate}>VPC ネットワークを作成</PrimaryButton>}
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
      {Option.isSome(editEditor.form) && (
        <CreateFormSection
          label={`VPC ネットワークを編集 (${editForm.original.name})`}
          columns={2}
          command={VpcNetworkEditForm.toCommand(editForm, projectId)}
          onCopy={handlers.copy}
          onInsert={() =>
            handlers.insert(
              VpcNetworkEditForm.toSteps(editForm, projectId)[0]?.line ??
                VpcNetworkEditForm.toCommand(editForm, projectId),
            )
          }
          onSubmit={saveEdit}
          onCancel={editEditor.close}
          submitLabel="保存"
        >
          <Field label="名前（変更不可）">
            {(id) => (
              <div id={id} className={readOnlyClass}>
                {editForm.original.name}
              </div>
            )}
          </Field>
          <Field label="現在のサブネット作成モード">
            {(id) => (
              <div id={id} className={readOnlyClass}>
                {editForm.original.subnetMode === SubnetModes.Auto ? "自動" : "カスタム"}
              </div>
            )}
          </Field>
          <Field label="ファイアウォール ポリシーの評価順">
            {(id) => (
              <Select<FirewallPolicyOrder>
                id={id}
                value={editForm.firewallPolicyOrder}
                onChange={(order) => editEditor.set("firewallPolicyOrder", order)}
                options={(["AFTER_CLASSIC_FIREWALL", "BEFORE_CLASSIC_FIREWALL"] as const).map(
                  (o) => ({ value: o, label: policyOrderText(o) }),
                )}
              />
            )}
          </Field>
          {editForm.original.subnetMode === SubnetModes.Auto && (
            <div className="flex items-end pb-1">
              <Checkbox
                checked={editForm.switchToCustom}
                onChange={(v) => editEditor.set("switchToCustom", v)}
              >
                カスタムモードへ切り替える（元に戻せません）
              </Checkbox>
            </div>
          )}
        </CreateFormSection>
      )}
      <ResourceTable
        label="VPC ネットワーク"
        rows={networks}
        keyOf={(n) => n.name}
        empty="VPC ネットワークはありません。"
        onEdit={openEdit}
        editable={(n) => n.name !== "default"}
        onDelete={(n) => remove(n.name)}
        deletable={(n) => n.name !== "default"}
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

/** VPC ネットワーク › ファイアウォール: 一覧・作成・編集・削除。 */
export const FirewallScreen = ({
  world,
  project,
  handlers,
  outcome,
}: ScreenProps): ReactElement => {
  const projectId = project.projectId;
  const rules = World.firewallRulesOf(world, projectId);
  const editor = useCreateForm(FirewallCreateForm, FirewallCreateForm.create, false, outcome);
  const editSeed = (): FirewallEditForm =>
    FirewallEditForm.fromRule(
      rules[0] ?? {
        projectId,
        name: "",
        network: "default",
        direction: Directions.Ingress,
        priority: 1000,
        sourceRanges: ["0.0.0.0/0"],
        destinationRanges: [],
        targetTags: [],
        allowed: [{ protocol: "tcp", ports: ["80"] }],
        denied: [],
        disabled: false,
      },
    );
  const editEditor = useCreateForm(FirewallEditForm, editSeed, false, outcome);
  const editForm = Option.unwrapOr(editEditor.form, editSeed());
  const form = Option.unwrapOr(editor.form, FirewallCreateForm.create());

  const openCreate = (): void => {
    editEditor.close();
    editor.open();
  };

  const openEdit = (rule: FirewallRule): void => {
    editor.close();
    editEditor.openWith(FirewallEditForm.fromRule(rule));
  };

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

  const saveEdit = (): void => {
    const valid = editEditor.submit();
    if (!Option.isSome(valid)) return;
    if (!FirewallEditForm.hasChanges(valid.value)) {
      editEditor.close();
      return;
    }
    handlers.submit({
      line: FirewallEditForm.toCommand(valid.value, projectId),
      note: `ファイアウォール ルールを更新 (${valid.value.original.name})`,
      next: Option.none,
    });
    editEditor.awaitClose();
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
        trailing={<PrimaryButton onClick={openCreate}>ファイアウォール ルールを作成</PrimaryButton>}
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
          <Field label="名前" required error={editor.errors.name}>
            {(id) => (
              <TextInput
                id={id}
                value={form.name}
                placeholder="allow-iap-ssh"
                onChange={(v) => editor.set("name", v)}
              />
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
          <Field label="優先度" error={editor.errors.priority} hint="0〜65535（小さいほど優先）">
            {(id) => (
              <TextInput
                id={id}
                value={form.priority}
                onChange={(v) => editor.set("priority", v)}
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
          <Field label="ターゲット">
            {(id) => (
              <Select<FirewallTargetType>
                id={id}
                value={form.targetType}
                onChange={(t) => editor.set("targetType", t)}
                options={(["all", "tags", "service-accounts"] as const).map((t) => ({
                  value: t,
                  label: targetTypeText(t),
                }))}
              />
            )}
          </Field>
          {form.targetType === "tags" && (
            <Field label="ターゲットタグ" hint="カンマ区切り（空ならすべてのインスタンス）">
              {(id) => (
                <TextInput
                  id={id}
                  value={form.targetTags}
                  placeholder="iap-gce"
                  onChange={(v) => editor.set("targetTags", v)}
                />
              )}
            </Field>
          )}
          {form.targetType === "service-accounts" && (
            <Field
              label="ターゲット サービス アカウント"
              error={editor.errors.targetServiceAccounts}
              hint="カンマ区切りでメールアドレスを指定"
            >
              {(id) => (
                <TextInput
                  id={id}
                  value={form.targetServiceAccounts}
                  onChange={(v) => editor.set("targetServiceAccounts", v)}
                />
              )}
            </Field>
          )}
          {form.direction === Directions.Ingress ? (
            <>
              <Field label="送信元フィルタ">
                {(id) => (
                  <Select<FirewallSourceFilter>
                    id={id}
                    value={form.sourceFilter}
                    onChange={(f) => editor.set("sourceFilter", f)}
                    options={(["ip-ranges", "source-tags", "service-accounts"] as const).map(
                      (f) => ({
                        value: f,
                        label: sourceFilterText(f),
                      }),
                    )}
                  />
                )}
              </Field>
              {form.sourceFilter === "ip-ranges" && (
                <Field
                  label="送信元 IPv4 範囲"
                  error={editor.errors.sourceRanges}
                  hint="例: 35.235.240.0/20, 0.0.0.0/0"
                >
                  {(id) => (
                    <TextInput
                      id={id}
                      value={form.sourceRanges}
                      onChange={(v) => editor.set("sourceRanges", v)}
                    />
                  )}
                </Field>
              )}
              {form.sourceFilter === "source-tags" && (
                <Field label="ソースタグ" error={editor.errors.sourceTags} hint="カンマ区切り">
                  {(id) => (
                    <TextInput
                      id={id}
                      value={form.sourceTags}
                      placeholder="web-tier"
                      onChange={(v) => editor.set("sourceTags", v)}
                    />
                  )}
                </Field>
              )}
              {form.sourceFilter === "service-accounts" && (
                <Field
                  label="送信元サービス アカウント"
                  error={editor.errors.sourceServiceAccounts}
                  hint="カンマ区切りでメールアドレスを指定"
                >
                  {(id) => (
                    <TextInput
                      id={id}
                      value={form.sourceServiceAccounts}
                      onChange={(v) => editor.set("sourceServiceAccounts", v)}
                    />
                  )}
                </Field>
              )}
            </>
          ) : (
            <Field label="宛先 IPv4 範囲" error={editor.errors.sourceRanges} hint="例: 0.0.0.0/0">
              {(id) => (
                <TextInput
                  id={id}
                  value={form.sourceRanges}
                  onChange={(v) => editor.set("sourceRanges", v)}
                />
              )}
            </Field>
          )}
          <Field label="プロトコルとポート">
            {(id) => (
              <Select<FirewallProtocolsMode>
                id={id}
                value={form.protocolsMode}
                onChange={(m) => editor.set("protocolsMode", m)}
                options={(["specified", "all"] as const).map((m) => ({
                  value: m,
                  label: protocolsModeText(m, form.action),
                }))}
              />
            )}
          </Field>
          {form.protocolsMode === "specified" && (
            <Field
              label="指定するプロトコルとポート"
              error={editor.errors.protocolsAndPorts}
              hint="tcp:22, tcp:80, tcp:443, icmp"
            >
              {(id) => (
                <TextInput
                  id={id}
                  value={form.protocolsAndPorts}
                  onChange={(v) => editor.set("protocolsAndPorts", v)}
                />
              )}
            </Field>
          )}
          <div className="flex flex-wrap gap-5 pt-1 sm:col-span-3">
            <Checkbox checked={form.enableLogging} onChange={(v) => editor.set("enableLogging", v)}>
              ファイアウォール ルールのログを有効にする（--enable-logging）
            </Checkbox>
            <Checkbox checked={form.disabled} onChange={(v) => editor.set("disabled", v)}>
              ルールを無効にして作成（--disabled）
            </Checkbox>
          </div>
        </CreateFormSection>
      )}
      {Option.isSome(editEditor.form) && (
        <CreateFormSection
          label={`ファイアウォール ルールを編集 (${editForm.original.name})`}
          columns={3}
          command={FirewallEditForm.toCommand(editForm, projectId)}
          onCopy={handlers.copy}
          onInsert={handlers.insert}
          onSubmit={saveEdit}
          onCancel={editEditor.close}
          submitLabel="保存"
        >
          <Field label="名前（変更不可）">
            {(id) => (
              <div id={id} className={readOnlyClass}>
                {editForm.original.name}
              </div>
            )}
          </Field>
          <Field label="ネットワーク（変更不可）">
            {(id) => (
              <div id={id} className={readOnlyClass}>
                {editForm.original.network}
              </div>
            )}
          </Field>
          <Field label="トラフィックの方向（変更不可）">
            {(id) => (
              <div id={id} className={readOnlyClass}>
                {directionText(editForm.original.direction)}
              </div>
            )}
          </Field>
          <Field
            label="優先度"
            error={editEditor.errors.priority}
            hint="0〜65535（小さいほど優先）"
          >
            {(id) => (
              <TextInput
                id={id}
                value={editForm.priority}
                onChange={(v) => editEditor.set("priority", v)}
              />
            )}
          </Field>
          <Field label="一致したときのアクション">
            {(id) => (
              <Select
                id={id}
                value={editForm.action}
                onChange={(a) => editEditor.set("action", a)}
                options={Object.values(FirewallActions).map((a) => ({
                  value: a,
                  label: actionText(a),
                }))}
              />
            )}
          </Field>
          <Field label="ターゲット">
            {(id) => (
              <Select<FirewallTargetType>
                id={id}
                value={editForm.targetType}
                onChange={(t) => editEditor.set("targetType", t)}
                options={(["all", "tags", "service-accounts"] as const).map((t) => ({
                  value: t,
                  label: targetTypeText(t),
                }))}
              />
            )}
          </Field>
          {editForm.targetType === "tags" && (
            <Field label="ターゲットタグ" hint="カンマ区切り">
              {(id) => (
                <TextInput
                  id={id}
                  value={editForm.targetTags}
                  onChange={(v) => editEditor.set("targetTags", v)}
                />
              )}
            </Field>
          )}
          {editForm.targetType === "service-accounts" && (
            <Field
              label="ターゲット サービス アカウント"
              error={editEditor.errors.targetServiceAccounts}
            >
              {(id) => (
                <TextInput
                  id={id}
                  value={editForm.targetServiceAccounts}
                  onChange={(v) => editEditor.set("targetServiceAccounts", v)}
                />
              )}
            </Field>
          )}
          {editForm.original.direction === Directions.Ingress ? (
            <>
              <Field label="送信元フィルタ">
                {(id) => (
                  <Select<FirewallSourceFilter>
                    id={id}
                    value={editForm.sourceFilter}
                    onChange={(f) => editEditor.set("sourceFilter", f)}
                    options={(["ip-ranges", "source-tags", "service-accounts"] as const).map(
                      (f) => ({
                        value: f,
                        label: sourceFilterText(f),
                      }),
                    )}
                  />
                )}
              </Field>
              {editForm.sourceFilter === "ip-ranges" && (
                <Field label="送信元 IPv4 範囲" error={editEditor.errors.sourceRanges}>
                  {(id) => (
                    <TextInput
                      id={id}
                      value={editForm.sourceRanges}
                      onChange={(v) => editEditor.set("sourceRanges", v)}
                    />
                  )}
                </Field>
              )}
              {editForm.sourceFilter === "source-tags" && (
                <Field label="ソースタグ" error={editEditor.errors.sourceTags}>
                  {(id) => (
                    <TextInput
                      id={id}
                      value={editForm.sourceTags}
                      onChange={(v) => editEditor.set("sourceTags", v)}
                    />
                  )}
                </Field>
              )}
              {editForm.sourceFilter === "service-accounts" && (
                <Field
                  label="送信元サービス アカウント"
                  error={editEditor.errors.sourceServiceAccounts}
                >
                  {(id) => (
                    <TextInput
                      id={id}
                      value={editForm.sourceServiceAccounts}
                      onChange={(v) => editEditor.set("sourceServiceAccounts", v)}
                    />
                  )}
                </Field>
              )}
            </>
          ) : (
            <Field label="宛先 IPv4 範囲" error={editEditor.errors.sourceRanges}>
              {(id) => (
                <TextInput
                  id={id}
                  value={editForm.sourceRanges}
                  onChange={(v) => editEditor.set("sourceRanges", v)}
                />
              )}
            </Field>
          )}
          <Field label="プロトコルとポート">
            {(id) => (
              <Select<FirewallProtocolsMode>
                id={id}
                value={editForm.protocolsMode}
                onChange={(m) => editEditor.set("protocolsMode", m)}
                options={(["specified", "all"] as const).map((m) => ({
                  value: m,
                  label: protocolsModeText(m, editForm.action),
                }))}
              />
            )}
          </Field>
          {editForm.protocolsMode === "specified" && (
            <Field
              label="指定するプロトコルとポート"
              error={editEditor.errors.protocolsAndPorts}
              hint="tcp:22, tcp:80, tcp:443, icmp"
            >
              {(id) => (
                <TextInput
                  id={id}
                  value={editForm.protocolsAndPorts}
                  onChange={(v) => editEditor.set("protocolsAndPorts", v)}
                />
              )}
            </Field>
          )}
          <div className="flex flex-wrap gap-5 pt-1 sm:col-span-3">
            <Checkbox
              checked={editForm.enableLogging}
              onChange={(v) => editEditor.set("enableLogging", v)}
            >
              ファイアウォール ルールのログを有効にする
            </Checkbox>
            <Checkbox checked={editForm.disabled} onChange={(v) => editEditor.set("disabled", v)}>
              ルールを無効にする
            </Checkbox>
          </div>
        </CreateFormSection>
      )}
      <ResourceTable
        label="ファイアウォール ルール"
        rows={rules}
        keyOf={(r) => r.name}
        empty="ルールはありません。"
        onEdit={openEdit}
        editable={(r) => !r.name.startsWith("default-")}
        onDelete={(r) => remove(r.name)}
        deletable={(r) => !r.name.startsWith("default-")}
        columns={[
          {
            header: "名前",
            cell: (r) => (
              <span className="font-mono">
                {r.name}
                {r.disabled && <span className="ml-1.5 text-muted text-xs">(無効)</span>}
              </span>
            ),
          },
          { header: "ネットワーク", cell: (r) => r.network },
          { header: "方向", cell: (r) => directionText(r.direction) },
          { header: "優先度", cell: (r) => String(r.priority) },
          {
            header: "ターゲット",
            cell: (r) => firewallTargetSummary(r),
          },
          {
            header: "フィルタ",
            cell: (r) => firewallFilterSummary(r),
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

/** VPC ネットワーク › サブネット: 一覧・作成・編集・削除。 */
export const SubnetsScreen = ({ world, project, handlers, outcome }: ScreenProps): ReactElement => {
  const projectId = project.projectId;
  const networks = World.networksOf(world, projectId);
  const subnets = World.subnetsOf(world, projectId);
  const defaultRegion: Region = Option.unwrapOr(
    Option.flatMap(GcloudConfig.get(world.config, "compute/region"), Region.parse),
    Option.unwrapOr(
      Option.map(
        Option.flatMap(GcloudConfig.get(world.config, "compute/zone"), Zone.parse),
        Zone.region,
      ),
      "asia-northeast1",
    ),
  );
  const customNetwork = networks.find((n) => n.subnetMode === "CUSTOM")?.name;
  const seed = (): SubnetCreateForm =>
    SubnetCreateForm.create({
      network: customNetwork ?? networks[0]?.name ?? "default",
      region: defaultRegion,
    });
  const editor = useCreateForm(SubnetCreateForm, seed, false, outcome);
  const editSeed = (): SubnetEditForm =>
    SubnetEditForm.fromSubnet(
      subnets[0] ?? {
        projectId,
        name: "",
        region: defaultRegion,
        network: "default",
        ipCidrRange: "10.128.0.0/20",
        privateIpGoogleAccess: false,
      },
    );
  const editEditor = useCreateForm(SubnetEditForm, editSeed, false, outcome);
  const editForm = Option.unwrapOr(editEditor.form, editSeed());
  const form = Option.unwrapOr(editor.form, seed());

  const openCreate = (): void => {
    editEditor.close();
    editor.open();
  };

  const openEdit = (subnet: (typeof subnets)[number]): void => {
    editor.close();
    editEditor.openWith(SubnetEditForm.fromSubnet(subnet));
  };

  const create = (): void => {
    const valid = editor.submit();
    if (!Option.isSome(valid)) return;
    handlers.submit({
      line: SubnetCreateForm.toCommand(valid.value, projectId),
      note: `サブネットを作成 (${valid.value.name})`,
      next: Option.none,
    });
    editor.awaitClose();
  };

  const saveEdit = (): void => {
    const valid = editEditor.submit();
    if (!Option.isSome(valid)) return;
    handlers.submit({
      line: SubnetEditForm.toCommand(valid.value, projectId),
      note: `サブネットを更新 (${valid.value.original.name})`,
      next: Option.none,
    });
    editEditor.awaitClose();
  };

  const remove = (subnet: Readonly<{ name: string; region: string }>): void => {
    if (!handlers.confirm(`サブネット ${subnet.name}（${subnet.region}）を削除しますか？`)) return;
    handlers.submit({
      line: DeleteCommand.subnet(subnet, projectId),
      note: `サブネットを削除 (${subnet.name})`,
      next: Option.none,
    });
  };

  return (
    <div>
      <ScreenTitle
        eyebrow="VPC ネットワーク"
        title="サブネット"
        trailing={<PrimaryButton onClick={openCreate}>＋ サブネットを作成</PrimaryButton>}
      />
      {Option.isSome(editor.form) && (
        <CreateFormSection
          label="サブネットを作成"
          columns={2}
          command={SubnetCreateForm.toCommand(form, projectId)}
          onCopy={handlers.copy}
          onInsert={handlers.insert}
          onSubmit={create}
          onCancel={editor.close}
          submitLabel="作成"
        >
          <Field label="名前" required error={editor.errors.name}>
            {(id) => (
              <TextInput
                id={id}
                value={form.name}
                placeholder="app-subnet"
                onChange={(v) => editor.set("name", v)}
              />
            )}
          </Field>
          <Field
            label="ネットワーク"
            error={editor.errors.network}
            hint="カスタムモードの VPC ネットワークを指定します"
          >
            {(id) => (
              <Select
                id={id}
                value={form.network}
                onChange={(v) => editor.set("network", v)}
                options={networks.map((n) => ({
                  value: n.name,
                  label: `${n.name} (${n.subnetMode === "AUTO" ? "自動" : "カスタム"})`,
                }))}
              />
            )}
          </Field>
          <Field label="リージョン">
            {(id) => (
              <Select
                id={id}
                value={form.region}
                onChange={(r) => editor.set("region", r)}
                options={Object.values(Regions).map((r) => ({ value: r, label: r }))}
              />
            )}
          </Field>
          <Field label="IPv4 範囲" required error={editor.errors.range} hint="例: 10.130.0.0/20">
            {(id) => (
              <TextInput id={id} value={form.range} onChange={(v) => editor.set("range", v)} />
            )}
          </Field>
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Checkbox
              checked={form.privateIpGoogleAccess}
              onChange={(v) => editor.set("privateIpGoogleAccess", v)}
            >
              限定公開の Google アクセスを有効にする（--enable-private-ip-google-access）
            </Checkbox>
            <Checkbox
              checked={form.enableFlowLogs}
              onChange={(v) => editor.set("enableFlowLogs", v)}
            >
              VPC フローログを有効にする（--enable-flow-logs）
            </Checkbox>
          </div>
        </CreateFormSection>
      )}
      {Option.isSome(editEditor.form) && (
        <CreateFormSection
          label={`サブネットを編集 (${editForm.original.name})`}
          columns={2}
          command={SubnetEditForm.toCommand(editForm, projectId)}
          onCopy={handlers.copy}
          onInsert={handlers.insert}
          onSubmit={saveEdit}
          onCancel={editEditor.close}
          submitLabel="保存"
        >
          <Field label="名前（変更不可）">
            {(id) => (
              <div id={id} className={readOnlyClass}>
                {editForm.original.name}
              </div>
            )}
          </Field>
          <Field label="リージョン（変更不可）">
            {(id) => (
              <div id={id} className={readOnlyClass}>
                {editForm.original.region}
              </div>
            )}
          </Field>
          <Field label="ネットワーク（変更不可）">
            {(id) => (
              <div id={id} className={readOnlyClass}>
                {editForm.original.network}
              </div>
            )}
          </Field>
          <Field label="IPv4 範囲（変更不可）">
            {(id) => (
              <div id={id} className={readOnlyClass}>
                {editForm.original.ipCidrRange}
              </div>
            )}
          </Field>
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Checkbox
              checked={editForm.privateIpGoogleAccess}
              onChange={(v) => editEditor.set("privateIpGoogleAccess", v)}
            >
              限定公開の Google アクセスを有効にする
            </Checkbox>
            <Checkbox
              checked={editForm.enableFlowLogs}
              onChange={(v) => editEditor.set("enableFlowLogs", v)}
            >
              VPC フローログを有効にする
            </Checkbox>
          </div>
        </CreateFormSection>
      )}
      <ResourceTable
        label="サブネット"
        rows={subnets}
        keyOf={(s) => `${s.region}/${s.name}`}
        nameOf={(s) => `${s.name}（${s.region}）`}
        empty="サブネットはありません。上の「サブネットを作成」または gcloud compute networks subnets create で作成できます。"
        onEdit={openEdit}
        editable={(s) => s.network !== "default"}
        onDelete={remove}
        deletable={(s) => s.network !== "default"}
        columns={[
          {
            header: "名前",
            cell: (s) => <span className="font-medium font-mono text-accent">{s.name}</span>,
          },
          { header: "リージョン", cell: (s) => s.region },
          { header: "ネットワーク", cell: (s) => s.network },
          { header: "IP 範囲", cell: (s) => <span className="font-mono">{s.ipCidrRange}</span> },
          {
            header: "限定公開の Google アクセス",
            cell: (s) => (s.privateIpGoogleAccess ? "オン" : "オフ"),
          },
          {
            header: "フローログ",
            cell: (s) => (s.flowLogs ? "オン" : "オフ"),
          },
        ]}
      />
    </div>
  );
};
