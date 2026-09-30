import { type ReactElement, useState } from "react";

import type { IamMember, RoleName } from "@/engine/domains/iam-policy";
import { CustomRole, RoleCatalog } from "@/engine/domains/role-catalog";
import { World } from "@/engine/domains/world";
import { type BindingOrigin, BindingRow } from "@/engine/resource-tree";
import {
  DataTable,
  EquivalentCommandPanel,
  Field,
  inputClass,
  OutcomeBanner,
  PrimaryButton,
  ScreenTitle,
  SecondaryButton,
} from "@/features/simulator/features/console/components/parts";
import {
  IamGrantForm,
  RoleCreateForm,
  ServiceAccountCreateForm,
} from "@/features/simulator/features/console/domains/equivalent-command";
import type { ScreenProps } from "@/features/simulator/features/console/types/screen-props";
import { Option } from "@/utils/Option";

/** 継承元の綴り（UI 案 2d / s2）。 */
const originText = (origin: BindingOrigin): string => {
  switch (origin.kind) {
    case "self":
      return "";
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

const roleTitle = (world: World, role: RoleName): string =>
  Option.unwrapOr(
    Option.or(
      Option.map(RoleCatalog.find(role), (r) => r.title),
      Option.map(World.findCustomRole(world, role), (r) => r.title),
    ),
    role,
  );

type ViewBy = "principal" | "role";

/** IAM と管理 › IAM（UI 案 2d / s2）: プリンシパル別 / ロール別、継承の表示、付与と削除。 */
export const IamScreen = (props: ScreenProps): ReactElement => {
  const { world, projectId, actions } = props;
  const [viewBy, setViewBy] = useState<ViewBy>("principal");
  const [includeInherited, setIncludeInherited] = useState(true);
  const [granting, setGranting] = useState(false);
  const [form, setForm] = useState<IamGrantForm>(IamGrantForm.initial);
  const [submitted, setSubmitted] = useState(false);
  const rows = BindingRow.fromWorld(world, { type: "project", id: projectId }).filter(
    (r) => includeInherited || !BindingRow.isInherited(r),
  );
  const sorted = rows.toSorted((a, b) =>
    viewBy === "principal" ? a.member.localeCompare(b.member) : a.role.localeCompare(b.role),
  );
  const errors = submitted ? IamGrantForm.validate(form) : {};
  const command = IamGrantForm.toCommand(form, projectId);
  const grant = (): void => {
    setSubmitted(true);
    if (!IamGrantForm.isValid(form)) return;
    actions.submit({ line: command, note: `アクセス権を付与 (${form.member})`, next: Option.none });
    setGranting(false);
    setSubmitted(false);
    setForm(IamGrantForm.initial());
  };
  const remove = (member: IamMember, role: RoleName): void => {
    if (!actions.confirm(`${member} から ${role} を削除しますか？`)) return;
    actions.submit({
      line: IamGrantForm.removeCommand({ member, role }, projectId),
      note: `アクセス権を削除 (${member})`,
      next: Option.none,
    });
  };
  return (
    <div>
      <ScreenTitle
        eyebrow="IAM と管理"
        title="IAM"
        actions={<PrimaryButton onClick={() => setGranting(true)}>アクセス権を付与</PrimaryButton>}
      />
      <OutcomeBanner
        outcome={props.outcome}
        onEnableApi={() => {}}
        onDismiss={props.onOutcomeDismiss}
      />
      {granting && (
        <section
          className="mb-4 rounded-lg border border-line bg-surface p-4"
          aria-label="アクセス権を付与"
        >
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="新しいプリンシパル"
              error={errors.member}
              hint="user:alice@example.com / serviceAccount:... / group:..."
            >
              {(id) => (
                <input
                  id={id}
                  className={inputClass}
                  value={form.member}
                  onChange={(e) => setForm((f) => ({ ...f, member: e.target.value }))}
                />
              )}
            </Field>
            <Field label="ロール" error={errors.role}>
              {(id) => (
                <input
                  id={id}
                  className={inputClass}
                  list="console-roles"
                  value={form.role}
                  onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                />
              )}
            </Field>
          </div>
          <datalist id="console-roles">
            {RoleCatalog.all().map((r) => (
              <option key={r.name} value={r.name}>
                {r.title}
              </option>
            ))}
            {World.customRolesOf(world, projectId).map((r) => (
              <option key={r.roleId} value={CustomRole.name(r)}>
                {r.title}
              </option>
            ))}
          </datalist>
          <EquivalentCommandPanel
            command={command}
            onCopy={actions.copy}
            onInsert={actions.insert}
          />
          <div className="mt-3 flex gap-2">
            <PrimaryButton onClick={grant}>保存</PrimaryButton>
            <SecondaryButton onClick={() => setGranting(false)}>キャンセル</SecondaryButton>
          </div>
        </section>
      )}
      <div className="mb-3 flex items-center gap-4 text-sm">
        <fieldset className="flex rounded-lg border border-line bg-canvas p-0.5">
          <legend className="sr-only">表示</legend>
          {(["principal", "role"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={viewBy === v}
              className={`rounded-md px-3 py-1 ${viewBy === v ? "bg-surface font-semibold shadow-sm" : "text-muted"}`}
              onClick={() => setViewBy(v)}
            >
              {v === "principal" ? "プリンシパル別" : "ロール別"}
            </button>
          ))}
        </fieldset>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={includeInherited}
            onChange={(e) => setIncludeInherited(e.target.checked)}
          />
          継承されたロールを含める
        </label>
      </div>
      <DataTable
        label="IAM ポリシー"
        rows={sorted}
        keyOf={(r) => `${r.member}/${r.role}/${originText(r.origin)}`}
        empty="バインディングはありません。"
        columns={[
          {
            header: "プリンシパル",
            cell: (r) => <span className="font-mono text-xs">{r.member}</span>,
          },
          {
            header: "ロール",
            cell: (r) => (
              <>
                {roleTitle(world, r.role)}
                <span className="block font-mono text-muted text-xs">{r.role}</span>
              </>
            ),
          },
          {
            header: "継承",
            cell: (r) =>
              BindingRow.isInherited(r) ? (
                <span className="text-warn-ink text-xs">{originText(r.origin)}</span>
              ) : (
                <span className="text-muted text-xs">このプロジェクト</span>
              ),
          },
          {
            header: "",
            className: "w-28 text-right",
            cell: (r) =>
              BindingRow.isInherited(r) ? (
                <span className="text-muted text-xs" title="継承元で削除してください">
                  継承元で編集
                </span>
              ) : (
                <SecondaryButton onClick={() => remove(r.member, r.role)}>削除</SecondaryButton>
              ),
          },
        ]}
      />
    </div>
  );
};

/** IAM と管理 › サービスアカウント: 一覧と作成。 */
export const ServiceAccountsScreen = (props: ScreenProps): ReactElement => {
  const { world, projectId, actions } = props;
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<ServiceAccountCreateForm>(ServiceAccountCreateForm.initial);
  const [submitted, setSubmitted] = useState(false);
  const errors = submitted ? ServiceAccountCreateForm.validate(form) : {};
  const command = ServiceAccountCreateForm.toCommand(form, projectId);
  const create = (): void => {
    setSubmitted(true);
    if (!ServiceAccountCreateForm.isValid(form)) return;
    actions.submit({
      line: command,
      note: `サービスアカウントを作成 (${form.accountId})`,
      next: Option.none,
    });
    setCreating(false);
    setSubmitted(false);
    setForm(ServiceAccountCreateForm.initial());
  };
  const set = <K extends keyof ServiceAccountCreateForm>(key: K, value: string): void =>
    setForm((f) => ({ ...f, [key]: value }));
  return (
    <div>
      <ScreenTitle
        eyebrow="IAM と管理"
        title="サービスアカウント"
        actions={
          <PrimaryButton onClick={() => setCreating(true)}>サービスアカウントを作成</PrimaryButton>
        }
      />
      <OutcomeBanner
        outcome={props.outcome}
        onEnableApi={() => {}}
        onDismiss={props.onOutcomeDismiss}
      />
      {creating && (
        <section
          className="mb-4 rounded-lg border border-line bg-surface p-4"
          aria-label="サービスアカウントを作成"
        >
          <div className="grid grid-cols-3 gap-4">
            <Field label="サービスアカウント ID" error={errors.accountId}>
              {(id) => (
                <input
                  id={id}
                  className={inputClass}
                  value={form.accountId}
                  onChange={(e) => set("accountId", e.target.value)}
                />
              )}
            </Field>
            <Field label="名前">
              {(id) => (
                <input
                  id={id}
                  className={inputClass}
                  value={form.displayName}
                  onChange={(e) => set("displayName", e.target.value)}
                />
              )}
            </Field>
            <Field label="説明">
              {(id) => (
                <input
                  id={id}
                  className={inputClass}
                  value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                />
              )}
            </Field>
          </div>
          <EquivalentCommandPanel
            command={command}
            onCopy={actions.copy}
            onInsert={actions.insert}
          />
          <div className="mt-3 flex gap-2">
            <PrimaryButton onClick={create}>作成</PrimaryButton>
            <SecondaryButton onClick={() => setCreating(false)}>キャンセル</SecondaryButton>
          </div>
        </section>
      )}
      <DataTable
        label="サービスアカウント"
        rows={World.serviceAccountsOf(world, projectId)}
        keyOf={(s) => s.email}
        empty="サービスアカウントはまだありません。"
        columns={[
          { header: "メール", cell: (s) => <span className="font-mono text-xs">{s.email}</span> },
          { header: "名前", cell: (s) => s.displayName },
          { header: "説明", cell: (s) => <span className="text-muted">{s.description}</span> },
          { header: "鍵", cell: (s) => String(World.keysOf(world, s.email).length) },
        ]}
      />
    </div>
  );
};

/** IAM と管理 › ロール: カタログとカスタムロールの一覧、カスタムロールの作成。 */
export const RolesScreen = (props: ScreenProps): ReactElement => {
  const { world, projectId, actions } = props;
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<RoleCreateForm>(RoleCreateForm.initial);
  const [submitted, setSubmitted] = useState(false);
  const errors = submitted ? RoleCreateForm.validate(form) : {};
  const command = RoleCreateForm.toCommand(form, projectId);
  const create = (): void => {
    setSubmitted(true);
    if (!RoleCreateForm.isValid(form)) return;
    actions.submit({
      line: command,
      note: `カスタムロールを作成 (${form.roleId})`,
      next: Option.none,
    });
    setCreating(false);
    setSubmitted(false);
    setForm(RoleCreateForm.initial());
  };
  const rows = [
    ...World.customRolesOf(world, projectId).map((r) => ({
      name: CustomRole.name(r),
      title: r.title,
      permissions: r.includedPermissions.length,
      kind: "カスタム",
    })),
    ...RoleCatalog.all().map((r) => ({
      name: r.name,
      title: r.title,
      permissions: r.includedPermissions.length,
      kind: "事前定義",
    })),
  ];
  return (
    <div>
      <ScreenTitle
        eyebrow="IAM と管理"
        title="ロール"
        actions={<PrimaryButton onClick={() => setCreating(true)}>ロールを作成</PrimaryButton>}
      />
      <OutcomeBanner
        outcome={props.outcome}
        onEnableApi={() => {}}
        onDismiss={props.onOutcomeDismiss}
      />
      {creating && (
        <section
          className="mb-4 rounded-lg border border-line bg-surface p-4"
          aria-label="ロールを作成"
        >
          <div className="grid grid-cols-3 gap-4">
            <Field label="ID" error={errors.roleId}>
              {(id) => (
                <input
                  id={id}
                  className={inputClass}
                  value={form.roleId}
                  onChange={(e) => setForm((f) => ({ ...f, roleId: e.target.value }))}
                />
              )}
            </Field>
            <Field label="タイトル">
              {(id) => (
                <input
                  id={id}
                  className={inputClass}
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                />
              )}
            </Field>
            <Field label="権限" error={errors.permissions} hint="カンマか空白で区切る">
              {(id) => (
                <input
                  id={id}
                  className={inputClass}
                  value={form.permissions}
                  onChange={(e) => setForm((f) => ({ ...f, permissions: e.target.value }))}
                />
              )}
            </Field>
          </div>
          <EquivalentCommandPanel
            command={command}
            onCopy={actions.copy}
            onInsert={actions.insert}
          />
          <div className="mt-3 flex gap-2">
            <PrimaryButton onClick={create}>作成</PrimaryButton>
            <SecondaryButton onClick={() => setCreating(false)}>キャンセル</SecondaryButton>
          </div>
        </section>
      )}
      <DataTable
        label="ロール"
        rows={rows}
        keyOf={(r) => r.name}
        empty="ロールはありません。"
        columns={[
          { header: "種類", cell: (r) => <span className="text-muted text-xs">{r.kind}</span> },
          { header: "タイトル", cell: (r) => r.title },
          { header: "名前", cell: (r) => <span className="font-mono text-xs">{r.name}</span> },
          { header: "権限数", cell: (r) => String(r.permissions) },
        ]}
      />
    </div>
  );
};
