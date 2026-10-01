import { type ReactElement, useState } from "react";

import type { IamMember, RoleName } from "@/engine/domains/iam-policy";
import { CustomRole, RoleCatalog } from "@/engine/domains/role-catalog";
import { World } from "@/engine/domains/world";
import { type BindingOrigin, BindingRow } from "@/engine/resource-tree";
import {
  CreateFormSection,
  Field,
  InputClass,
  PrimaryButton,
  ResourceTable,
  ScreenTitle,
  SecondaryButton,
} from "@/features/simulator/features/console/components/ConsoleParts";
import {
  IamGrantForm,
  RoleCreateForm,
  ServiceAccountCreateForm,
} from "@/features/simulator/features/console/domains/equivalent-command";
import { useCreateForm } from "@/features/simulator/features/console/hooks/use-create-form";
import type { ScreenProps } from "@/features/simulator/features/console/types/screen-props";
import { Option } from "@/utils/Option";

/** 継承元の綴り（UI 案 s2: `組織 example.com` / `フォルダ dev`）。自分自身に付いたものは対象ごとの綴り。 */
export const originText = (origin: BindingOrigin): string => {
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

type SortKey = "member" | "role";

/** IAM と管理 › IAM（UI 案 s2）: 継承元付きの一覧、プリンシパル順 / ロール順、付与と削除。 */
export const IamScreen = ({ world, project, handlers }: ScreenProps): ReactElement => {
  const projectId = project.projectId;
  const [sortKey, setSortKey] = useState<SortKey>("member");
  const [includeInherited, setIncludeInherited] = useState(true);
  const editor = useCreateForm(IamGrantForm, IamGrantForm.create);
  const rows = BindingRow.fromWorld(world, { type: "project", id: projectId }).filter(
    (r) => includeInherited || !BindingRow.isInherited(r),
  );
  const sorted = rows.toSorted((a, b) => a[sortKey].localeCompare(b[sortKey]));
  const grant = (): void => {
    const valid = editor.submit();
    if (!Option.isSome(valid)) return;
    handlers.submit({
      line: IamGrantForm.toCommand(valid.value, projectId),
      note: `アクセス権を付与 (${valid.value.member})`,
      next: Option.none,
    });
    editor.close();
  };
  const remove = (member: IamMember, role: RoleName): void => {
    if (!handlers.confirm(`${member} から ${role} を削除しますか？`)) return;
    handlers.submit({
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
        trailing={<PrimaryButton onClick={editor.open}>アクセス権を付与</PrimaryButton>}
      />
      {Option.isSome(editor.form) && (
        <CreateFormSection
          label="アクセス権を付与"
          columns={2}
          command={IamGrantForm.toCommand(editor.form.value, projectId)}
          onCopy={handlers.copy}
          onInsert={handlers.insert}
          onSubmit={grant}
          onCancel={editor.close}
          submitLabel="保存"
        >
          <Field
            label="新しいプリンシパル"
            error={editor.errors.member}
            hint="user:alice@example.com / serviceAccount:... / group:..."
          >
            {(id) => (
              <input
                id={id}
                className={InputClass}
                value={Option.unwrapOr(editor.form, IamGrantForm.create()).member}
                onChange={(e) => editor.set("member", e.target.value)}
              />
            )}
          </Field>
          <Field label="ロール" error={editor.errors.role}>
            {(id) => (
              <input
                id={id}
                className={InputClass}
                list="console-roles"
                value={Option.unwrapOr(editor.form, IamGrantForm.create()).role}
                onChange={(e) => editor.set("role", e.target.value)}
              />
            )}
          </Field>
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
        </CreateFormSection>
      )}
      <div className="mb-3 flex items-center gap-4 text-sm">
        <fieldset className="flex items-center gap-2">
          <legend className="sr-only">並べ替え</legend>
          <span className="text-muted text-xs">並べ替え:</span>
          <span className="flex rounded-lg border border-line bg-canvas p-0.5">
            {(["member", "role"] as const).map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={sortKey === key}
                className={`rounded-md px-3 py-1 ${sortKey === key ? "bg-surface font-semibold shadow-sm" : "text-muted"}`}
                onClick={() => setSortKey(key)}
              >
                {key === "member" ? "プリンシパル" : "ロール"}
              </button>
            ))}
          </span>
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
      <ResourceTable
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
                {World.roleTitle(world, r.role)}
                <span className="block font-mono text-muted text-xs">{r.role}</span>
              </>
            ),
          },
          {
            header: "継承元",
            cell: (r) => (
              <span
                className={`text-xs ${BindingRow.isInherited(r) ? "text-warn-ink" : "text-muted"}`}
              >
                {originText(r.origin)}
              </span>
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
export const ServiceAccountsScreen = ({ world, project, handlers }: ScreenProps): ReactElement => {
  const projectId = project.projectId;
  const editor = useCreateForm(ServiceAccountCreateForm, ServiceAccountCreateForm.create);
  const create = (): void => {
    const valid = editor.submit();
    if (!Option.isSome(valid)) return;
    handlers.submit({
      line: ServiceAccountCreateForm.toCommand(valid.value, projectId),
      note: `サービスアカウントを作成 (${valid.value.accountId})`,
      next: Option.none,
    });
    editor.close();
  };
  const form = Option.unwrapOr(editor.form, ServiceAccountCreateForm.create());
  return (
    <div>
      <ScreenTitle
        eyebrow="IAM と管理"
        title="サービスアカウント"
        trailing={<PrimaryButton onClick={editor.open}>サービスアカウントを作成</PrimaryButton>}
      />
      {Option.isSome(editor.form) && (
        <CreateFormSection
          label="サービスアカウントを作成"
          columns={3}
          command={ServiceAccountCreateForm.toCommand(form, projectId)}
          onCopy={handlers.copy}
          onInsert={handlers.insert}
          onSubmit={create}
          onCancel={editor.close}
          submitLabel="作成"
        >
          <Field label="サービスアカウント ID" error={editor.errors.accountId}>
            {(id) => (
              <input
                id={id}
                className={InputClass}
                value={form.accountId}
                onChange={(e) => editor.set("accountId", e.target.value)}
              />
            )}
          </Field>
          <Field label="名前">
            {(id) => (
              <input
                id={id}
                className={InputClass}
                value={form.displayName}
                onChange={(e) => editor.set("displayName", e.target.value)}
              />
            )}
          </Field>
          <Field label="説明">
            {(id) => (
              <input
                id={id}
                className={InputClass}
                value={form.description}
                onChange={(e) => editor.set("description", e.target.value)}
              />
            )}
          </Field>
        </CreateFormSection>
      )}
      <ResourceTable
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
export const RolesScreen = ({ world, project, handlers }: ScreenProps): ReactElement => {
  const projectId = project.projectId;
  const editor = useCreateForm(RoleCreateForm, RoleCreateForm.create);
  const create = (): void => {
    const valid = editor.submit();
    if (!Option.isSome(valid)) return;
    handlers.submit({
      line: RoleCreateForm.toCommand(valid.value, projectId),
      note: `カスタムロールを作成 (${valid.value.roleId})`,
      next: Option.none,
    });
    editor.close();
  };
  const form = Option.unwrapOr(editor.form, RoleCreateForm.create());
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
        trailing={<PrimaryButton onClick={editor.open}>ロールを作成</PrimaryButton>}
      />
      {Option.isSome(editor.form) && (
        <CreateFormSection
          label="ロールを作成"
          columns={3}
          command={RoleCreateForm.toCommand(form, projectId)}
          onCopy={handlers.copy}
          onInsert={handlers.insert}
          onSubmit={create}
          onCancel={editor.close}
          submitLabel="作成"
        >
          <Field label="ID" error={editor.errors.roleId}>
            {(id) => (
              <input
                id={id}
                className={InputClass}
                value={form.roleId}
                onChange={(e) => editor.set("roleId", e.target.value)}
              />
            )}
          </Field>
          <Field label="タイトル">
            {(id) => (
              <input
                id={id}
                className={InputClass}
                value={form.title}
                onChange={(e) => editor.set("title", e.target.value)}
              />
            )}
          </Field>
          <Field label="権限" error={editor.errors.permissions} hint="カンマか空白で区切る">
            {(id) => (
              <input
                id={id}
                className={InputClass}
                value={form.permissions}
                onChange={(e) => editor.set("permissions", e.target.value)}
              />
            )}
          </Field>
        </CreateFormSection>
      )}
      <ResourceTable
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
