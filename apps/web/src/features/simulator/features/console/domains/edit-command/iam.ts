import { RoleName } from "@/engine/domains/iam-policy";
import type { CustomRole } from "@/engine/domains/role-catalog";
import {
  collect,
  FieldErrors,
  flag,
  IamGrantForm,
  quote,
} from "@/features/simulator/features/console/domains/equivalent-command";
import { Option } from "@/utils/Option";
import { StringEx } from "@/utils/StringEx";

/** 2 段階以上で実行する編集コマンドの 1 ステップ。 */
export type IamEditStep = Readonly<{ line: string; note: string }>;

// --- サービスアカウント編集 ---

export type ServiceAccountEditForm = Readonly<{
  email: string;
  displayName: string;
  description: string;
}>;

export const ServiceAccountEditForm = {
  create(): ServiceAccountEditForm {
    return { email: "", displayName: "", description: "" };
  },

  /** 既存のサービスアカウントから編集フォームの初期値を作る。 */
  fromServiceAccount(
    account: Readonly<{ email: string; displayName: string; description: string }>,
  ): ServiceAccountEditForm {
    return {
      email: account.email,
      displayName: account.displayName,
      description: account.description,
    };
  },

  collectErrors(_form: ServiceAccountEditForm): FieldErrors<ServiceAccountEditForm> {
    return FieldErrors.none<ServiceAccountEditForm>();
  },

  /** `gcloud iam service-accounts update EMAIL --project=P --display-name=... --description=...` */
  toCommand(form: ServiceAccountEditForm, projectId: string): string {
    return [
      "gcloud iam service-accounts update",
      quote(form.email),
      flag("project", projectId),
      flag("display-name", form.displayName),
      flag("description", form.description),
    ].join(" ");
  },
} as const;

// --- カスタムロール編集 ---

export type RoleEditForm = Readonly<{
  roleId: string;
  title: string;
  description: string;
  permissions: string;
}>;

export const RoleEditForm = {
  create(): RoleEditForm {
    return { roleId: "", title: "", description: "", permissions: "" };
  },

  /** 既存のカスタムロールから編集フォームの初期値を作る。 */
  fromCustomRole(role: CustomRole): RoleEditForm {
    return {
      roleId: role.roleId,
      title: role.title,
      description: role.description,
      permissions: role.includedPermissions.join(", "),
    };
  },

  collectErrors(form: RoleEditForm): FieldErrors<RoleEditForm> {
    return collect<RoleEditForm>([
      [
        "permissions",
        StringEx.splitList(form.permissions).length === 0
          ? Option.some("権限を 1 つ以上入れてください。")
          : Option.none,
      ],
    ]);
  },

  /** `gcloud iam roles update ROLE_ID --project=P --permissions=... --title=... --description=...` */
  toCommand(form: RoleEditForm, projectId: string): string {
    const parts = [
      "gcloud iam roles update",
      quote(form.roleId),
      flag("project", projectId),
      flag("permissions", StringEx.splitList(form.permissions).join(",")),
      ...(form.title === "" ? [] : [flag("title", form.title)]),
      flag("description", form.description),
    ];
    return parts.join(" ");
  },
} as const;

// --- IAM バインディングのロール変更 ---

export type IamBindingEditForm = Readonly<{
  member: string;
  originalRole: string;
  role: string;
}>;

export const IamBindingEditForm = {
  create(): IamBindingEditForm {
    return { member: "", originalRole: "", role: "" };
  },

  /** 既存の直接バインディングからロール変更フォームの初期値を作る。 */
  fromBinding(member: string, role: string): IamBindingEditForm {
    return { member, originalRole: role, role };
  },

  collectErrors(form: IamBindingEditForm): FieldErrors<IamBindingEditForm> {
    const roleError = !Option.isSome(RoleName.parse(form.role))
      ? Option.some(
          `ロールは roles/... または projects/P/roles/... の形式で指定してください: ${form.role}`,
        )
      : form.role === form.originalRole
        ? Option.some("変更前と同じロールです。別のロールを選んでください。")
        : Option.none;
    return collect<IamBindingEditForm>([["role", roleError]]);
  },

  /** 旧ロールを削除して新ロールを付与する 2 段階のコマンド。 */
  toSteps(form: IamBindingEditForm, projectId: string): readonly IamEditStep[] {
    return [
      {
        line: IamGrantForm.removeCommand(
          { member: form.member, role: form.originalRole },
          projectId,
        ),
        note: `アクセス権を削除 (${form.member}: ${form.originalRole})`,
      },
      {
        line: IamGrantForm.toCommand({ member: form.member, role: form.role }, projectId),
        note: `アクセス権を付与 (${form.member}: ${form.role})`,
      },
    ];
  },

  /** 「同等のコマンドライン」表示用の複数行コマンド。 */
  toCommand(form: IamBindingEditForm, projectId: string): string {
    return IamBindingEditForm.toSteps(form, projectId)
      .map((s) => s.line)
      .join("\n");
  },
} as const;

// --- サービスアカウントのキー作成・削除 ---

export type ServiceAccountKeyCreateForm = Readonly<{
  email: string;
  outputFile: string;
}>;

export const ServiceAccountKeyCreateForm = {
  create(): ServiceAccountKeyCreateForm {
    return { email: "", outputFile: "" };
  },

  /** 対象のサービスアカウントからキー作成フォームの初期値を作る。 */
  forServiceAccount(email: string): ServiceAccountKeyCreateForm {
    const localPart = email.split("@")[0] ?? "service-account";
    return { email, outputFile: `./${localPart}-key.json` };
  },

  collectErrors(form: ServiceAccountKeyCreateForm): FieldErrors<ServiceAccountKeyCreateForm> {
    const trimmed = form.outputFile.trim();
    return collect<ServiceAccountKeyCreateForm>([
      [
        "outputFile",
        trimmed === ""
          ? Option.some("出力ファイル名を入力してください（例: ./key.json）。")
          : /\s/.test(trimmed)
            ? Option.some("出力ファイル名に空白は含められません。")
            : Option.none,
      ],
    ]);
  },

  /** `gcloud iam service-accounts keys create OUTPUT_FILE --iam-account=EMAIL --project=P` */
  toCommand(form: ServiceAccountKeyCreateForm, projectId: string): string {
    return [
      "gcloud iam service-accounts keys create",
      quote(form.outputFile.trim()),
      flag("iam-account", form.email),
      flag("project", projectId),
    ].join(" ");
  },

  /** `gcloud iam service-accounts keys delete KEY_ID --iam-account=EMAIL --project=P --quiet` */
  deleteCommand(keyId: string, email: string, projectId: string): string {
    return [
      "gcloud iam service-accounts keys delete",
      quote(keyId),
      flag("iam-account", email),
      flag("project", projectId),
      "--quiet",
    ].join(" ");
  },
} as const;
