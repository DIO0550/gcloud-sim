import { type ReactElement, useState } from "react";
import { SuggestInput } from "@/components/SuggestInput";
import { Switch } from "@/components/Switch";
import { Tab } from "@/components/Tab";
import { TextButton } from "@/components/TextButton";
import type { IamMember, RoleName } from "@/engine/domains/iam-policy";
import type { PolicyTarget } from "@/engine/domains/resource-hierarchy";
import { CustomRole, RoleCatalog } from "@/engine/domains/role-catalog";
import { World } from "@/engine/domains/world";
import { InitialWorldFixture } from "@/engine/initial-world";
import { type BindingOrigin, BindingRow } from "@/engine/resource-tree";
import {
  CreateFormSection,
  Field,
  PrimaryButton,
  ResourceTable,
  ScreenTitle,
  SecondaryButton,
  TextInput,
} from "@/features/simulator/features/console/components/ConsoleParts";
import {
  IamGrantForm,
  RoleCreateForm,
  ServiceAccountCreateForm,
} from "@/features/simulator/features/console/domains/equivalent-command";
import { roleTitleJa } from "@/features/simulator/features/console/domains/role-title";
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

type GroupKey = "member" | "role";

/** プリンシパルの綴り（UI 案 s2: `user:` と `serviceAccount:` は落とし、`group:` 等は残す）。 */
const memberText = (member: string): string => member.replace(/^(user|serviceAccount):/, "");

/** 名前の列（UI 案 s2）。サンプルの組織の人とグループは役割の名前、SA は表示名、それ以外は空。 */
const memberName = (world: World, member: IamMember): string => {
  switch (member) {
    case `user:${InitialWorldFixture.owner}`:
      return "組織管理者";
    case `user:${InitialWorldFixture.developer}`:
      return "開発者";
    case InitialWorldFixture.opsGroup:
      return "運用チーム";
  }
  if (!member.startsWith("serviceAccount:")) return "";
  return Option.unwrapOr(
    Option.map(World.findServiceAccount(world, memberText(member)), (a) => a.displayName),
    "",
  );
};

/** 階層の 1 段（組織 / フォルダ / プロジェクト）の綴り。 */
const levelText = (world: World, target: PolicyTarget): string => {
  switch (target.type) {
    case "organization":
      return "組織";
    case "folder":
      return `フォルダ ${Option.unwrapOr(
        Option.map(World.findFolder(world, target.id), (f) => f.displayName),
        target.id,
      )}`;
    default:
      return target.id;
  }
};

/** 継承元の列の綴り。継承したものは警告色、自分自身に付いたものは地の色。 */
const OriginCell = ({ row }: Readonly<{ row: BindingRow }>): ReactElement => (
  <span className={BindingRow.isInherited(row) ? "text-warn-ink" : ""}>
    {originText(row.origin)}
  </span>
);

type Group = Readonly<{ key: string; rows: readonly BindingRow[] }>;

/** 行をプリンシパルかロールでまとめる。まとまりの並びは綴り順。 */
const groupBy = (rows: readonly BindingRow[], key: GroupKey): readonly Group[] => {
  const groups = new Map<string, readonly BindingRow[]>();
  for (const row of rows) {
    const k = row[key];
    groups.set(k, [...(groups.get(k) ?? []), row]);
  }
  return [...groups.entries()]
    .map(([k, rs]) => ({ key: k, rows: rs }))
    .toSorted((a, b) => memberText(a.key).localeCompare(memberText(b.key)));
};

/** 鉛筆（編集）。 */
const PencilIcon = (): ReactElement => (
  <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4">
    <path d="M11.5 2.5l2 2L6 12l-3 1 1-3z" fill="currentColor" />
  </svg>
);

/** 語の並びを、継続記号付きの複数行にする（先頭 1 語、次はサブコマンドと対象、以降はフラグ）。 */
const removeLines = (words: readonly string[]): string => {
  const [head = "", sub = "", target = "", ...flags] = words;
  return [head, `  ${sub} ${target}`, ...flags.map((f) => `  ${f}`)].join(" \\\n");
};

/** IAM と管理 › IAM（UI 案 s2）: 継承元付きの一覧（プリンシパル別 / ロール別）と、選んだ人の階層。 */
export const IamScreen = ({ world, project, handlers }: ScreenProps): ReactElement => {
  const projectId = project.projectId;
  const projectTarget: PolicyTarget = { type: "project", id: projectId };
  const [groupKey, setGroupKey] = useState<GroupKey>("member");
  const [includeInherited, setIncludeInherited] = useState(true);
  const [picked, setPicked] = useState<Option<IamMember>>(Option.none);
  const editor = useCreateForm(IamGrantForm, IamGrantForm.create);
  const allRows = BindingRow.fromWorld(world, projectTarget);
  const rows = allRows.filter((r) => includeInherited || !BindingRow.isInherited(r));
  const groups = groupBy(rows, groupKey);
  // 既定で選ぶのは、継承したロールと自分に付いたロールの両方を持つ人（継承の見本になる）。
  const byMember = groupBy(allRows, "member");
  const sample =
    byMember.find(
      (g) => g.rows.some(BindingRow.isInherited) && g.rows.some((r) => !BindingRow.isInherited(r)),
    ) ?? byMember[0];
  const fallback = Option.fromNullable(sample?.rows[0]?.member);
  const selected = Option.filter(Option.or(picked, fallback), (m) =>
    allRows.some((r) => r.member === m),
  );
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
        eyebrow={`プロジェクト「${projectId}」の権限`}
        title="IAM"
        trailing={
          <PrimaryButton onClick={editor.open}>
            <span aria-hidden="true">＋ </span>アクセス権を付与
          </PrimaryButton>
        }
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
              <TextInput
                id={id}
                value={Option.unwrapOr(editor.form, IamGrantForm.create()).member}
                onChange={(v) => editor.set("member", v)}
              />
            )}
          </Field>
          <Field label="ロール" error={editor.errors.role}>
            {(id) => (
              <SuggestInput
                id={id}
                value={Option.unwrapOr(editor.form, IamGrantForm.create()).role}
                suggestions={[
                  ...RoleCatalog.all().map((r) => ({ value: r.name, description: r.title })),
                  ...World.customRolesOf(world, projectId).map((r) => ({
                    value: CustomRole.name(r),
                    description: r.title,
                  })),
                ]}
                onChange={(role) => editor.set("role", role)}
              />
            )}
          </Field>
        </CreateFormSection>
      )}
      <div className="mb-6 flex items-end justify-between">
        <div className="flex border-line border-b" role="tablist" aria-label="表示の単位">
          {(["member", "role"] as const).map((key) => (
            <Tab
              key={key}
              selected={groupKey === key}
              className="px-5 py-2.5 text-[15px]"
              onClick={() => setGroupKey(key)}
            >
              {key === "member" ? "プリンシパル別" : "ロール別"}
            </Tab>
          ))}
        </div>
        <div className="flex items-center gap-2.5 text-[15px]">
          <Switch
            checked={includeInherited}
            ariaLabel="継承されたロールを表示"
            onChange={setIncludeInherited}
          />
          <span aria-hidden="true">継承されたロールを表示</span>
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <table className="w-full table-fixed text-[15px]" aria-label="IAM ポリシー">
          <colgroup>
            <col className="w-[25%]" />
            <col className="w-[20%]" />
            <col className="w-[28%]" />
            <col className="w-[20%]" />
            <col className="w-[7%]" />
          </colgroup>
          <thead className="bg-canvas text-left text-muted">
            <tr>
              <th className="px-6 py-3 font-medium">
                {groupKey === "member" ? "プリンシパル" : "ロール"}
              </th>
              <th className="px-3 py-3 font-medium">
                {groupKey === "member" ? "名前" : "プリンシパル"}
              </th>
              <th className="px-3 py-3 font-medium">{groupKey === "member" ? "ロール" : "名前"}</th>
              <th className="px-3 py-3 font-medium">継承元</th>
              <th className="px-3 py-3">
                <span className="sr-only">編集</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-6 text-center text-muted">
                  バインディングはありません。
                </td>
              </tr>
            )}
            {groups.map((group) => {
              const first = group.rows[0];
              const isPicked =
                groupKey === "member" &&
                Option.isSome(selected) &&
                first !== undefined &&
                selected.value === first.member;
              const editable = group.rows.some((r) => !BindingRow.isInherited(r));
              return (
                <tr
                  key={group.key}
                  className={`border-line border-t align-top ${isPicked ? "bg-[#fffaf0]" : ""}`}
                >
                  {groupKey === "member" ? (
                    <>
                      <td className="break-all px-6 py-4 font-mono text-sm">
                        {memberText(group.key)}
                      </td>
                      <td className="px-3 py-4">
                        {first === undefined ? "" : memberName(world, first.member)}
                      </td>
                      <td className="px-3 py-4">
                        <ul className="flex flex-col gap-1.5">
                          {group.rows.map((r) => (
                            <li key={`${r.role}/${originText(r.origin)}`} title={r.role}>
                              {roleTitleJa(world, r.role)}
                            </li>
                          ))}
                        </ul>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-6 py-4" title={group.key}>
                        {first === undefined ? "" : roleTitleJa(world, first.role)}
                      </td>
                      <td className="break-all px-3 py-4 font-mono text-sm">
                        <ul className="flex flex-col gap-1.5">
                          {group.rows.map((r) => (
                            <li key={`${r.member}/${originText(r.origin)}`}>
                              {memberText(r.member)}
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td className="px-3 py-4">
                        <ul className="flex flex-col gap-1.5">
                          {group.rows.map((r) => (
                            <li key={`${r.member}/${originText(r.origin)}`}>
                              {memberName(world, r.member) || "—"}
                            </li>
                          ))}
                        </ul>
                      </td>
                    </>
                  )}
                  <td className="px-3 py-4">
                    <ul className="flex flex-col gap-1.5">
                      {group.rows.map((r) => (
                        <li key={`${r.member}/${r.role}/${originText(r.origin)}`}>
                          <OriginCell row={r} />
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="px-3 py-4 text-right">
                    {groupKey === "member" && first !== undefined && (
                      <TextButton
                        tone={editable ? "accent" : "inherit"}
                        ariaLabel={`${memberText(group.key)} を編集`}
                        className={editable ? "" : "text-line"}
                        onClick={() => setPicked(Option.some(first.member))}
                      >
                        <PencilIcon />
                      </TextButton>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {Option.isSome(selected) && (
        <MemberDetail
          world={world}
          member={selected.value}
          projectTarget={projectTarget}
          onRemove={remove}
        />
      )}
    </div>
  );
};

/** 選んだ人の階層ごとのロールと、そのロールを外す手立て（UI 案 s2 の下の 2 枚）。 */
const MemberDetail = ({
  world,
  member,
  projectTarget,
  onRemove,
}: Readonly<{
  world: World;
  member: IamMember;
  projectTarget: PolicyTarget;
  onRemove: (member: IamMember, role: RoleName) => void;
}>): ReactElement => {
  // 組織 → フォルダ → プロジェクトの順（上から）。
  const levels = World.ancestry(world, projectTarget)
    .toReversed()
    .map((target) => ({
      target,
      roles: Option.unwrapOr(
        Option.map(World.findPolicy(world, target), (p) =>
          p.bindings.filter((b) => b.members.includes(member)).map((b) => b.role),
        ),
        [],
      ),
    }));
  const own = levels.at(-1)?.roles ?? [];
  // 外し方を示すのは、プロジェクトにいちばん近い上位のもの。
  const inherited = levels
    .slice(0, -1)
    .toReversed()
    .find((l) => l.roles.length > 0);
  const inheritedTarget = inherited?.target;
  const inheritedRole = inherited?.roles[0];
  return (
    <div className="mt-6 grid grid-cols-2 gap-6">
      <section
        className="rounded-lg border border-line bg-surface px-6 py-5"
        aria-label={`${memberText(member)} に効いているロール`}
      >
        <h3 className="mb-4 font-medium text-muted">
          {memberText(member)} に効いているロール（階層）
        </h3>
        <ol>
          {levels.map((level, depth) => (
            <li
              key={`${level.target.type}/${level.target.id}`}
              className={`grid grid-cols-[6rem_1fr] gap-x-4 py-1.5 ${depth === 0 ? "" : "border-line border-l-2 pl-5"}`}
              style={{ marginLeft: `${Math.max(depth - 1, 0) * 1.25}rem` }}
            >
              <span className="text-muted">{levelText(world, level.target)}</span>
              <span className="flex flex-col font-mono text-sm leading-6">
                {level.roles.length === 0 ? (
                  <span className="font-sans text-muted">—</span>
                ) : (
                  level.roles.map((role) => <span key={role}>{role}</span>)
                )}
              </span>
            </li>
          ))}
        </ol>
      </section>
      <section
        className="rounded-lg border border-line bg-surface px-6 py-5"
        aria-label="ロールの変更"
      >
        {own.length > 0 && (
          <>
            <h3 className="mb-3 font-medium text-muted">このプロジェクトで付いているロール</h3>
            <ul className="mb-5 flex flex-col gap-2">
              {own.map((role) => (
                <li key={role} className="flex items-center justify-between gap-3">
                  <span>
                    {roleTitleJa(world, role)}
                    <span className="block font-mono text-muted text-xs">{role}</span>
                  </span>
                  <SecondaryButton onClick={() => onRemove(member, role)}>削除</SecondaryButton>
                </li>
              ))}
            </ul>
          </>
        )}
        {inheritedTarget !== undefined &&
          inheritedRole !== undefined &&
          (inheritedTarget.type === "organization" || inheritedTarget.type === "folder") && (
            <>
              <h3 className="mb-3 font-medium text-muted">継承されたロールは編集できません</h3>
              <p className="mb-4 leading-relaxed">
                {levelText(world, inheritedTarget)} から継承したロールを外すには、
                {inheritedTarget.type === "organization" ? "組織" : "フォルダ"}
                のポリシーを変更します。
              </p>
              <pre className="overflow-x-auto rounded-md bg-code px-4 py-3 font-mono text-sm leading-relaxed">
                {removeLines(
                  IamGrantForm.removeCommandAt({ member, role: inheritedRole }, inheritedTarget),
                )}
              </pre>
            </>
          )}
        {own.length === 0 && inherited === undefined && (
          <p className="text-muted">
            このプロジェクトとその上位に、このプリンシパルのロールはありません。
          </p>
        )}
      </section>
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
              <TextInput
                id={id}
                value={form.accountId}
                onChange={(v) => editor.set("accountId", v)}
              />
            )}
          </Field>
          <Field label="名前">
            {(id) => (
              <TextInput
                id={id}
                value={form.displayName}
                onChange={(v) => editor.set("displayName", v)}
              />
            )}
          </Field>
          <Field label="説明">
            {(id) => (
              <TextInput
                id={id}
                value={form.description}
                onChange={(v) => editor.set("description", v)}
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
              <TextInput id={id} value={form.roleId} onChange={(v) => editor.set("roleId", v)} />
            )}
          </Field>
          <Field label="タイトル">
            {(id) => (
              <TextInput id={id} value={form.title} onChange={(v) => editor.set("title", v)} />
            )}
          </Field>
          <Field label="権限" error={editor.errors.permissions} hint="カンマか空白で区切る">
            {(id) => (
              <TextInput
                id={id}
                value={form.permissions}
                onChange={(v) => editor.set("permissions", v)}
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
