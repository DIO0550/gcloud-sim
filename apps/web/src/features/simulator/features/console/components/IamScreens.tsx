import { type ReactElement, useId, useState } from "react";
import { Checkbox } from "@/components/Checkbox";
import { GhostButton } from "@/components/GhostButton";
import { SegmentedControl } from "@/components/SegmentedControl";
import { SuggestInput } from "@/components/SuggestInput";
import { TextButton } from "@/components/TextButton";
import type { IamMember, RoleName } from "@/engine/domains/iam-policy";
import type { PolicyTarget } from "@/engine/domains/resource-hierarchy";
import { CustomRole, RoleCatalog } from "@/engine/domains/role-catalog";
import { ServiceAccount } from "@/engine/domains/service-account";
import { World } from "@/engine/domains/world";
import { InitialWorldFixture } from "@/engine/initial-world";
import { type BindingOrigin, BindingRow } from "@/engine/resource-tree";
import {
  CopyButton,
  CreateFormSection,
  Field,
  PrimaryButton,
  ResourceTable,
  ScreenTitle,
  SecondaryButton,
  TextInput,
} from "@/features/simulator/features/console/components/ConsoleParts";
import {
  IamBindingEditForm,
  RoleEditForm,
  ServiceAccountEditForm,
  ServiceAccountKeyCreateForm,
} from "@/features/simulator/features/console/domains/edit-command/iam";
import {
  DeleteCommand,
  IamGrantForm,
  RoleCreateForm,
  ServiceAccountCreateForm,
} from "@/features/simulator/features/console/domains/equivalent-command";
import { roleTitleJa } from "@/features/simulator/features/console/domains/role-title";
import { useCreateForm } from "@/features/simulator/features/console/hooks/use-create-form";
import type { ScreenProps } from "@/features/simulator/features/console/types/screen-props";
import { Option } from "@/utils/Option";

/** 変更できない識別子（メール・ID・プリンシパル）の読み取り専用欄。 */
const ReadOnlyInput = ({ id, value }: Readonly<{ id: string; value: string }>): ReactElement => (
  <input
    id={id}
    type="text"
    value={value}
    disabled
    className="h-9 w-full cursor-not-allowed rounded-md border border-line bg-canvas px-3 font-mono text-[15px] text-muted"
  />
);

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
        case "artifact-repository":
          return "このリポジトリ";
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

/** IAM 一覧（UI 案 2d）。編集を選ぶと、継承元の詳細（s2）を開く。 */
export const IamScreen = ({ world, project, handlers, outcome }: ScreenProps): ReactElement => {
  const projectId = project.projectId;
  const projectTarget: PolicyTarget = { type: "project", id: projectId };
  const [filter, setFilter] = useState("");
  const filterId = useId();
  const [groupKey, setGroupKey] = useState<GroupKey>("member");
  const [includeInherited, setIncludeInherited] = useState(true);
  const [picked, setPicked] = useState<Option<IamMember>>(Option.none);
  const editor = useCreateForm(IamGrantForm, IamGrantForm.create, false, outcome);
  const roleUpdater = useCreateForm(IamBindingEditForm, IamBindingEditForm.create, false, outcome);
  const allRows = BindingRow.fromWorld(world, projectTarget);
  const needle = filter.trim().toLowerCase();
  const rows = allRows.filter((row) => {
    if (!includeInherited && BindingRow.isInherited(row)) return false;
    return [
      memberText(row.member),
      memberName(world, row.member),
      row.role,
      roleTitleJa(world, row.role),
      originText(row.origin),
    ]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });
  const groups = groupBy(rows, groupKey);
  const selected = Option.filter(picked, (member) => allRows.some((row) => row.member === member));
  const roleSuggestions = [
    ...RoleCatalog.all().map((r) => {
      const ja = roleTitleJa(world, r.name);
      return {
        value: r.name,
        description: ja === r.title ? r.title : `${ja} (${r.title})`,
      };
    }),
    ...World.customRolesOf(world, projectId).map((r) => ({
      value: CustomRole.name(r),
      description: r.title,
    })),
  ];
  const grant = (): void => {
    const valid = editor.submit();
    if (!Option.isSome(valid)) return;
    handlers.submit({
      line: IamGrantForm.toCommand(valid.value, projectId),
      note: `アクセス権を付与 (${valid.value.member})`,
      next: Option.none,
    });
    editor.awaitClose();
  };
  const updateRole = (): void => {
    const valid = roleUpdater.submit();
    if (!Option.isSome(valid)) return;
    const [first, ...rest] = IamBindingEditForm.toSteps(valid.value, projectId);
    if (first === undefined) return;
    handlers.submit({ ...first, next: Option.none, rest });
    roleUpdater.awaitClose();
  };
  const startEditRole = (member: IamMember, role: RoleName): void => {
    editor.close();
    roleUpdater.openWith(IamBindingEditForm.fromBinding(member, role));
  };
  const remove = (member: IamMember, role: RoleName): void => {
    if (!handlers.confirm(`${member} から ${role} を削除しますか？`)) return;
    handlers.submit({
      line: IamGrantForm.removeCommand({ member, role }, projectId),
      note: `アクセス権を削除 (${member})`,
      next: Option.none,
    });
  };
  const editRoleForm = Option.unwrapOr(roleUpdater.form, IamBindingEditForm.create());
  const editRoleSteps = IamBindingEditForm.toSteps(editRoleForm, projectId);
  return (
    <div>
      <ScreenTitle
        eyebrow="IAM と管理"
        title="IAM"
        trailing={
          <GhostButton
            tone="accent"
            onClick={() => {
              roleUpdater.close();
              editor.open();
            }}
          >
            <span aria-hidden="true">＋ </span>アクセス権を付与
          </GhostButton>
        }
      />
      <h3 className="mb-2 font-medium text-lg">プロジェクト「{projectId}」の権限</h3>
      <p className="mb-5 text-muted text-sm">
        このプロジェクトと、組織・フォルダから継承されたロールを表示します。
      </p>
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
            hint="例: alice@example.com（自動で user: を補完）/ serviceAccount:... / group:..."
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
                suggestions={roleSuggestions}
                onChange={(role) => editor.set("role", role)}
              />
            )}
          </Field>
        </CreateFormSection>
      )}
      {Option.isSome(roleUpdater.form) && (
        <CreateFormSection
          label="ロールを変更"
          columns={2}
          command={IamBindingEditForm.toCommand(editRoleForm, projectId)}
          onCopy={handlers.copy}
          onInsert={() => handlers.insert(editRoleSteps[0]?.line ?? "")}
          onSubmit={updateRole}
          onCancel={roleUpdater.close}
          submitLabel="保存"
        >
          <Field label="プリンシパル">
            {(id) => <ReadOnlyInput id={id} value={editRoleForm.member} />}
          </Field>
          <Field label="ロール" error={roleUpdater.errors.role}>
            {(id) => (
              <SuggestInput
                id={id}
                value={editRoleForm.role}
                suggestions={roleSuggestions}
                onChange={(role) => roleUpdater.set("role", role)}
              />
            )}
          </Field>
        </CreateFormSection>
      )}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-line border-b">
        <SegmentedControl
          label="表示の単位"
          value={groupKey}
          options={[
            { value: "member", label: "プリンシパル別に表示" },
            { value: "role", label: "ロール別に表示" },
          ]}
          onChange={setGroupKey}
          variant="tabs"
        />
        <div className="pb-2 text-[15px]">
          <Checkbox checked={includeInherited} onChange={setIncludeInherited}>
            継承されたロールを表示
          </Checkbox>
        </div>
      </div>
      <label
        htmlFor={filterId}
        className="mb-4 flex h-11 items-center gap-3 rounded-lg border border-line px-4"
      >
        <span className="text-sm">フィルタ</span>
        <TextInput
          id={filterId}
          variant="bare"
          font="sans"
          className="min-w-0 flex-1"
          placeholder="プリンシパル、ロール、継承元を検索"
          value={filter}
          onChange={setFilter}
        />
      </label>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[760px] table-fixed text-sm" aria-label="IAM ポリシー">
          <colgroup>
            <col className="w-[4%]" />
            <col className="w-[25%]" />
            <col className="w-[20%]" />
            <col className="w-[25%]" />
            <col className="w-[20%]" />
            <col className="w-[6%]" />
          </colgroup>
          <thead className="bg-canvas text-left text-muted">
            <tr>
              <th>
                <span className="sr-only">選択</span>
              </th>
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
                <td colSpan={6} className="px-6 py-6 text-center text-muted">
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
                  className={`border-line border-t align-top ${isPicked ? "bg-accent-soft" : ""}`}
                >
                  <td className="py-4 pl-3">
                    {groupKey === "member" && first !== undefined && (
                      <Checkbox
                        ariaLabel={`${memberText(group.key)} を選択`}
                        checked={isPicked}
                        onChange={(checked) =>
                          setPicked(checked ? Option.some(first.member) : Option.none)
                        }
                      />
                    )}
                  </td>
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
          onEdit={startEditRole}
          onRemove={remove}
          onCopy={handlers.copy}
          onInsert={handlers.insert}
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
  onEdit,
  onRemove,
  onCopy,
  onInsert,
}: Readonly<{
  world: World;
  member: IamMember;
  projectTarget: PolicyTarget;
  onEdit: (member: IamMember, role: RoleName) => void;
  onRemove: (member: IamMember, role: RoleName) => void;
  onCopy: (text: string) => void;
  onInsert: (line: string) => void;
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
  const inheritedItems = levels
    .slice(0, -1)
    .toReversed()
    .flatMap((level) => {
      const target = level.target;
      if (target.type !== "organization" && target.type !== "folder") return [];
      return level.roles.map((role) => ({
        target,
        role,
        words: IamGrantForm.removeCommandAt({ member, role }, target),
      }));
    });
  return (
    <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
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
                  <div className="flex shrink-0 items-center gap-1.5">
                    <SecondaryButton onClick={() => onEdit(member, role)}>編集</SecondaryButton>
                    <SecondaryButton onClick={() => onRemove(member, role)}>削除</SecondaryButton>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        {inheritedItems.length > 0 && (
          <>
            <h3 className="mb-3 font-medium text-muted">継承されたロールは編集できません</h3>
            <p className="mb-4 text-sm leading-relaxed">
              上位の階層から継承したロールを外すには、該当する組織またはフォルダのポリシーを変更します。
            </p>
            <ul className="flex flex-col gap-4">
              {inheritedItems.map(({ target, role, words }) => {
                const oneLine = words.join(" ");
                return (
                  <li key={`${target.type}/${target.id}/${role}`}>
                    <p className="mb-1.5 text-muted text-xs">
                      {levelText(world, target)} · {roleTitleJa(world, role)} ({role})
                    </p>
                    <pre className="overflow-x-auto rounded-md bg-code px-4 py-3 font-mono text-xs leading-relaxed">
                      {removeLines(words)}
                    </pre>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <CopyButton text={oneLine} onCopy={onCopy} />
                      <SecondaryButton onClick={() => onInsert(oneLine)}>
                        ターミナルに貼り付け
                      </SecondaryButton>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {own.length === 0 && inheritedItems.length === 0 && (
          <p className="text-muted">
            このプロジェクトとその上位に、このプリンシパルのロールはありません。
          </p>
        )}
      </section>
    </div>
  );
};

/** Google 管理またはプロジェクト既定のサービスアカウントか（編集・削除不可）。 */
const isDefaultServiceAccount = (
  email: string,
  projectId: string,
  defaultComputeEmail: string,
): boolean =>
  email === defaultComputeEmail ||
  email === `${projectId}@appspot.gserviceaccount.com` ||
  email.endsWith("@developer.gserviceaccount.com") ||
  email.endsWith("@appspot.gserviceaccount.com");

/** IAM と管理 › サービスアカウント: 一覧・作成・編集・キー管理。 */
export const ServiceAccountsScreen = ({
  world,
  project,
  handlers,
  outcome,
}: ScreenProps): ReactElement => {
  const projectId = project.projectId;
  const editor = useCreateForm(
    ServiceAccountCreateForm,
    ServiceAccountCreateForm.create,
    false,
    outcome,
  );
  const updater = useCreateForm(
    ServiceAccountEditForm,
    ServiceAccountEditForm.create,
    false,
    outcome,
  );
  const keyCreator = useCreateForm(
    ServiceAccountKeyCreateForm,
    ServiceAccountKeyCreateForm.create,
    false,
    outcome,
  );
  const [keysEmail, setKeysEmail] = useState<Option<string>>(Option.none);
  const create = (): void => {
    const valid = editor.submit();
    if (!Option.isSome(valid)) return;
    handlers.submit({
      line: ServiceAccountCreateForm.toCommand(valid.value, projectId),
      note: `サービスアカウントを作成 (${valid.value.accountId})`,
      next: Option.none,
    });
    editor.awaitClose();
  };
  const update = (): void => {
    const valid = updater.submit();
    if (!Option.isSome(valid)) return;
    handlers.submit({
      line: ServiceAccountEditForm.toCommand(valid.value, projectId),
      note: `サービスアカウントを編集 (${valid.value.email})`,
      next: Option.none,
    });
    updater.awaitClose();
  };
  const remove = (email: string): void => {
    if (!handlers.confirm(`サービスアカウント ${email} を削除しますか？`)) return;
    handlers.submit({
      line: DeleteCommand.serviceAccount(email, projectId),
      note: `サービスアカウントを削除 (${email})`,
      next: Option.none,
    });
  };
  const createKey = (): void => {
    const valid = keyCreator.submit();
    if (!Option.isSome(valid)) return;
    handlers.submit({
      line: ServiceAccountKeyCreateForm.toCommand(valid.value, projectId),
      note: `サービスアカウントのキーを作成 (${valid.value.email})`,
      next: Option.none,
    });
    keyCreator.awaitClose();
  };
  const removeKey = (email: string, keyId: string): void => {
    if (!handlers.confirm(`キー ${keyId} を削除しますか？`)) return;
    handlers.submit({
      line: ServiceAccountKeyCreateForm.deleteCommand(keyId, email, projectId),
      note: `サービスアカウントのキーを削除 (${keyId})`,
      next: Option.none,
    });
  };
  const form = Option.unwrapOr(editor.form, ServiceAccountCreateForm.create());
  const editForm = Option.unwrapOr(updater.form, ServiceAccountEditForm.create());
  const keyForm = Option.unwrapOr(keyCreator.form, ServiceAccountKeyCreateForm.create());
  const defaultComputeEmail = ServiceAccount.defaultComputeEmail(project.projectNumber);
  const userAccounts = World.serviceAccountsOf(world, projectId).map((s) => ({
    email: s.email,
    displayName: s.displayName,
    description: s.description,
    isDefault: isDefaultServiceAccount(s.email, projectId, defaultComputeEmail),
  }));
  const activeKeysEmail = Option.filter(keysEmail, (email) =>
    userAccounts.some((a) => a.email === email),
  );
  const rows = [
    ...(userAccounts.some((a) => a.email === defaultComputeEmail)
      ? []
      : [
          {
            email: defaultComputeEmail,
            displayName: "Compute Engine default service account",
            description: "Compute Engine の既定のサービスアカウント（削除不可）",
            isDefault: true,
          },
        ]),
    ...userAccounts,
  ];
  return (
    <div>
      <ScreenTitle
        eyebrow="IAM と管理"
        title="サービスアカウント"
        trailing={
          <PrimaryButton
            onClick={() => {
              updater.close();
              keyCreator.close();
              editor.open();
            }}
          >
            サービスアカウントを作成
          </PrimaryButton>
        }
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
      {Option.isSome(updater.form) && (
        <CreateFormSection
          label="サービスアカウントを編集"
          columns={3}
          command={ServiceAccountEditForm.toCommand(editForm, projectId)}
          onCopy={handlers.copy}
          onInsert={handlers.insert}
          onSubmit={update}
          onCancel={updater.close}
          submitLabel="保存"
        >
          <Field label="メール">{(id) => <ReadOnlyInput id={id} value={editForm.email} />}</Field>
          <Field label="名前">
            {(id) => (
              <TextInput
                id={id}
                value={editForm.displayName}
                onChange={(v) => updater.set("displayName", v)}
              />
            )}
          </Field>
          <Field label="説明">
            {(id) => (
              <TextInput
                id={id}
                value={editForm.description}
                onChange={(v) => updater.set("description", v)}
              />
            )}
          </Field>
        </CreateFormSection>
      )}
      <ResourceTable
        label="サービスアカウント"
        rows={rows}
        keyOf={(s) => s.email}
        empty="サービスアカウントはまだありません。"
        rowActions={(s) =>
          !s.isDefault && (
            <SecondaryButton
              ariaLabel={`${s.email} のキーを管理`}
              onClick={() => {
                editor.close();
                updater.close();
                keyCreator.close();
                setKeysEmail(Option.some(s.email));
              }}
            >
              キー
            </SecondaryButton>
          )
        }
        editable={(s) => !s.isDefault}
        onEdit={(s) => {
          editor.close();
          keyCreator.close();
          updater.openWith(ServiceAccountEditForm.fromServiceAccount(s));
        }}
        deletable={(s) => !s.isDefault}
        onDelete={(s) => remove(s.email)}
        columns={[
          { header: "メール", cell: (s) => <span className="font-mono text-xs">{s.email}</span> },
          { header: "名前", cell: (s) => s.displayName },
          { header: "説明", cell: (s) => <span className="text-muted">{s.description}</span> },
          { header: "鍵", cell: (s) => String(World.keysOf(world, s.email).length) },
        ]}
      />
      {Option.isSome(activeKeysEmail) && (
        <section
          className="mt-6 rounded-lg border border-line bg-surface p-5"
          aria-label={`${activeKeysEmail.value} のキー`}
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-medium text-base text-ink">キー管理</h3>
              <p className="font-mono text-muted text-xs">{activeKeysEmail.value}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <PrimaryButton
                onClick={() => {
                  editor.close();
                  updater.close();
                  keyCreator.openWith(
                    ServiceAccountKeyCreateForm.forServiceAccount(activeKeysEmail.value),
                  );
                }}
              >
                新しいキーを作成
              </PrimaryButton>
              <SecondaryButton
                onClick={() => {
                  keyCreator.close();
                  setKeysEmail(Option.none);
                }}
              >
                閉じる
              </SecondaryButton>
            </div>
          </div>
          {Option.isSome(keyCreator.form) && (
            <CreateFormSection
              label="新しいキーを作成"
              columns={2}
              command={ServiceAccountKeyCreateForm.toCommand(keyForm, projectId)}
              onCopy={handlers.copy}
              onInsert={handlers.insert}
              onSubmit={createKey}
              onCancel={keyCreator.close}
              submitLabel="作成"
            >
              <Field label="サービスアカウント">
                {(id) => <ReadOnlyInput id={id} value={keyForm.email} />}
              </Field>
              <Field
                label="出力ファイル"
                error={keyCreator.errors.outputFile}
                hint="例: ./key.json（秘密鍵は書き出されず、シミュレータ内に記録されます）"
              >
                {(id) => (
                  <TextInput
                    id={id}
                    value={keyForm.outputFile}
                    onChange={(v) => keyCreator.set("outputFile", v)}
                  />
                )}
              </Field>
            </CreateFormSection>
          )}
          <ResourceTable
            label={`${activeKeysEmail.value} のキー`}
            rows={World.keysOf(world, activeKeysEmail.value)}
            keyOf={(k) => k.keyId}
            empty="このサービスアカウントにはキーがありません。"
            onDelete={(k) => removeKey(activeKeysEmail.value, k.keyId)}
            columns={[
              {
                header: "キー ID",
                cell: (k) => <span className="font-mono text-xs">{k.keyId}</span>,
              },
              {
                header: "種類",
                cell: (k) => <span className="text-muted text-xs">{k.keyType}</span>,
              },
              {
                header: "ファイル",
                cell: (k) => <span className="font-mono text-xs">{k.file}</span>,
              },
              {
                header: "作成日時",
                cell: (k) => (
                  <span className="font-mono text-muted text-xs">{k.validAfterTime}</span>
                ),
              },
            ]}
          />
        </section>
      )}
    </div>
  );
};

/** IAM と管理 › ロール: カタログとカスタムロールの一覧、カスタムロールの作成・編集。 */
export const RolesScreen = ({ world, project, handlers, outcome }: ScreenProps): ReactElement => {
  const projectId = project.projectId;
  const editor = useCreateForm(RoleCreateForm, RoleCreateForm.create, false, outcome);
  const updater = useCreateForm(RoleEditForm, RoleEditForm.create, false, outcome);
  const create = (): void => {
    const valid = editor.submit();
    if (!Option.isSome(valid)) return;
    handlers.submit({
      line: RoleCreateForm.toCommand(valid.value, projectId),
      note: `カスタムロールを作成 (${valid.value.roleId})`,
      next: Option.none,
    });
    editor.awaitClose();
  };
  const update = (): void => {
    const valid = updater.submit();
    if (!Option.isSome(valid)) return;
    handlers.submit({
      line: RoleEditForm.toCommand(valid.value, projectId),
      note: `カスタムロールを編集 (${valid.value.roleId})`,
      next: Option.none,
    });
    updater.awaitClose();
  };
  const remove = (roleId: string): void => {
    if (!handlers.confirm(`カスタムロール ${roleId} を削除しますか？`)) return;
    handlers.submit({
      line: DeleteCommand.customRole(roleId, projectId),
      note: `カスタムロールを削除 (${roleId})`,
      next: Option.none,
    });
  };
  const form = Option.unwrapOr(editor.form, RoleCreateForm.create());
  const editForm = Option.unwrapOr(updater.form, RoleEditForm.create());
  const rows = [
    ...World.customRolesOf(world, projectId).map((r) => ({
      customRole: Option.some(r),
      name: CustomRole.name(r),
      title: r.title,
      subtitle: "",
      permissions: r.includedPermissions.length,
      kind: "カスタム",
    })),
    ...RoleCatalog.all().map((r) => {
      const ja = roleTitleJa(world, r.name);
      return {
        customRole: Option.none as Option<CustomRole>,
        name: r.name,
        title: ja,
        subtitle: ja === r.title ? "" : r.title,
        permissions: r.includedPermissions.length,
        kind: RoleCatalog.isBasic(r.name) ? "基本" : "事前定義",
      };
    }),
  ];
  return (
    <div>
      <ScreenTitle
        eyebrow="IAM と管理"
        title="ロール"
        trailing={
          <PrimaryButton
            onClick={() => {
              updater.close();
              editor.open();
            }}
          >
            ロールを作成
          </PrimaryButton>
        }
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
      {Option.isSome(updater.form) && (
        <CreateFormSection
          label="ロールを編集"
          columns={2}
          command={RoleEditForm.toCommand(editForm, projectId)}
          onCopy={handlers.copy}
          onInsert={handlers.insert}
          onSubmit={update}
          onCancel={updater.close}
          submitLabel="保存"
        >
          <Field label="ID">{(id) => <ReadOnlyInput id={id} value={editForm.roleId} />}</Field>
          <Field label="タイトル">
            {(id) => (
              <TextInput id={id} value={editForm.title} onChange={(v) => updater.set("title", v)} />
            )}
          </Field>
          <Field label="説明">
            {(id) => (
              <TextInput
                id={id}
                value={editForm.description}
                onChange={(v) => updater.set("description", v)}
              />
            )}
          </Field>
          <Field label="権限" error={updater.errors.permissions} hint="カンマか空白で区切る">
            {(id) => (
              <TextInput
                id={id}
                value={editForm.permissions}
                onChange={(v) => updater.set("permissions", v)}
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
        editable={(r) => Option.isSome(r.customRole)}
        onEdit={(r) => {
          if (Option.isSome(r.customRole)) {
            editor.close();
            updater.openWith(RoleEditForm.fromCustomRole(r.customRole.value));
          }
        }}
        deletable={(r) => Option.isSome(r.customRole)}
        onDelete={(r) => {
          if (Option.isSome(r.customRole)) remove(r.customRole.value.roleId);
        }}
        columns={[
          { header: "種類", cell: (r) => <span className="text-muted text-xs">{r.kind}</span> },
          {
            header: "タイトル",
            cell: (r) => (
              <span>
                {r.title}
                {r.subtitle !== "" && (
                  <span className="ml-1.5 text-muted text-xs">({r.subtitle})</span>
                )}
              </span>
            ),
          },
          { header: "名前", cell: (r) => <span className="font-mono text-xs">{r.name}</span> },
          { header: "権限数", cell: (r) => String(r.permissions) },
        ]}
      />
    </div>
  );
};
