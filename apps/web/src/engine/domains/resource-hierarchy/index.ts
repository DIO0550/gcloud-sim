import type { ApiName } from "@/engine/domains/catalog";
import { IamPolicy } from "@/engine/domains/iam-policy";
import type { JsonRecord } from "@/types/Json";
import type { ValueOf } from "@/types/ValueOf";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

/** フォルダ・プロジェクトの親。組織かフォルダ。 */
export type ParentRef =
  | Readonly<{ type: "organization"; id: string }>
  | Readonly<{ type: "folder"; id: string }>;

/** IAM ポリシーを持てるリソースの指し方。継承の評価とコマンドの権限判定で使う。 */
export type PolicyTarget =
  | ParentRef
  | Readonly<{ type: "project"; id: string }>
  | Readonly<{ type: "bucket"; id: string }>;

export const PolicyTarget = {
  /**
   * E-006 のメッセージに出す綴り。
   *
   * @param target 対象
   * @returns `projects/ace-dev-01` / `folders/2841...` / `organizations/...` / `buckets/...`
   */
  toPath(target: PolicyTarget): string {
    switch (target.type) {
      case "organization":
        return `organizations/${target.id}`;
      case "folder":
        return `folders/${target.id}`;
      case "project":
        return `projects/${target.id}`;
      case "bucket":
        return `buckets/${target.id}`;
    }
  },

  /**
   * 2 つの対象が同じリソースを指しているか。
   *
   * @param a 片方
   * @param b もう片方
   * @returns 種類と id が同じなら真
   */
  equals(a: PolicyTarget, b: PolicyTarget): boolean {
    return a.type === b.type && a.id === b.id;
  },
} as const;

export type Organization = Readonly<{
  id: string;
  displayName: string;
  iamPolicy: IamPolicy;
}>;

export type Folder = Readonly<{
  id: string;
  displayName: string;
  parent: ParentRef;
  iamPolicy: IamPolicy;
}>;

export const ProjectStates = {
  Active: "ACTIVE",
  DeleteRequested: "DELETE_REQUESTED",
} as const;
export type ProjectState = ValueOf<typeof ProjectStates>;

export type Project = Readonly<{
  projectId: string;
  name: string;
  projectNumber: string;
  parent: ParentRef;
  lifecycleState: ProjectState;
  billingAccountId: Option<string>;
  enabledApis: readonly ApiName[];
  iamPolicy: IamPolicy;
  labels: Readonly<Record<string, string>>;
  createTime: string;
}>;

export type BillingAccount = Readonly<{
  id: string;
  displayName: string;
  open: boolean;
}>;

export const ProjectId = {
  /**
   * プロジェクト ID の形式を検証する（設計書 6.2 Project: 6〜30 文字、小文字英字始まり、
   * `[a-z0-9-]`、末尾ハイフン不可）。
   *
   * @param value ユーザーが打った綴り
   * @returns 形式を満たせばそのまま。満たさなければ理由
   */
  parse(value: string): Result<string, string> {
    const valid = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(value);
    return valid
      ? Result.ok(value)
      : Result.err(
          `Project ID [${value}] is invalid. It must be 6 to 30 lowercase letters, digits, or hyphens. It must start with a letter and cannot end with a hyphen.`,
        );
  },
} as const;

/** `Project.create` に渡す材料。 */
export type ProjectSeed = Readonly<{
  projectId: string;
  name: string;
  parent: ParentRef;
  projectNumber: string;
  createTime: string;
}>;

export const Project = {
  /**
   * 新しいプロジェクトを作る。projectId の形式はここで検証する。
   *
   * @param seed 材料。`name` が空なら projectId をそのまま表示名にする
   * @returns 形式を満たせば `ACTIVE` のプロジェクト。満たさなければ理由
   */
  create(seed: ProjectSeed): Result<Project, string> {
    return Result.map(ProjectId.parse(seed.projectId), (projectId) => ({
      projectId,
      name: seed.name === "" ? projectId : seed.name,
      projectNumber: seed.projectNumber,
      parent: seed.parent,
      lifecycleState: ProjectStates.Active,
      billingAccountId: Option.none,
      enabledApis: [],
      iamPolicy: IamPolicy.Empty,
      labels: {},
      createTime: seed.createTime,
    }));
  },

  isActive(project: Project): boolean {
    return project.lifecycleState === ProjectStates.Active;
  },

  hasApi(project: Project, api: ApiName): boolean {
    return project.enabledApis.includes(api);
  },

  withState(project: Project, lifecycleState: ProjectState): Project {
    return { ...project, lifecycleState };
  },

  withBilling(project: Project, billingAccountId: Option<string>): Project {
    return { ...project, billingAccountId };
  },

  withApi(project: Project, api: ApiName): Project {
    return Project.hasApi(project, api)
      ? project
      : { ...project, enabledApis: [...project.enabledApis, api] };
  },

  withoutApi(project: Project, api: ApiName): Project {
    return { ...project, enabledApis: project.enabledApis.filter((a) => a !== api) };
  },

  withPolicy(project: Project, iamPolicy: IamPolicy): Project {
    return { ...project, iamPolicy };
  },

  /** `--format=json` に出す API 表現。 */
  toRecord(project: Project): JsonRecord {
    return {
      projectId: project.projectId,
      name: project.name,
      projectNumber: project.projectNumber,
      lifecycleState: project.lifecycleState,
      parent: { type: project.parent.type, id: project.parent.id },
      createTime: project.createTime,
      labels: project.labels,
    };
  },
} as const;

export const Folder = {
  withPolicy(folder: Folder, iamPolicy: IamPolicy): Folder {
    return { ...folder, iamPolicy };
  },

  toRecord(folder: Folder): JsonRecord {
    const parent =
      folder.parent.type === "organization"
        ? `organizations/${folder.parent.id}`
        : `folders/${folder.parent.id}`;
    return {
      name: `folders/${folder.id}`,
      displayName: folder.displayName,
      parent,
      lifecycleState: "ACTIVE",
    };
  },
} as const;

export const Organization = {
  withPolicy(organization: Organization, iamPolicy: IamPolicy): Organization {
    return { ...organization, iamPolicy };
  },

  toRecord(organization: Organization): JsonRecord {
    return {
      name: `organizations/${organization.id}`,
      displayName: organization.displayName,
      lifecycleState: "ACTIVE",
    };
  },
} as const;

export const BillingAccount = {
  toRecord(account: BillingAccount): JsonRecord {
    return {
      name: `billingAccounts/${account.id}`,
      displayName: account.displayName,
      open: account.open,
      masterBillingAccount: "",
    };
  },
} as const;
