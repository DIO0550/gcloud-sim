import { Budget } from "@/engine/domains/billing-budget";
import {
  type ApiName,
  BucketLocation,
  type MachineTypeName,
  StorageClass,
  type Zone,
} from "@/engine/domains/catalog";
import {
  type BootDiskType,
  BootDiskTypes,
  type Direction,
  Directions,
  DiskSizeGb,
  type FirewallAction,
  FirewallActions,
  FirewallRule,
  type Instance,
  ProtocolRule,
  type ProvisioningModel,
  ProvisioningModels,
  ResourceName,
} from "@/engine/domains/compute";
import { IamMember, RoleName } from "@/engine/domains/iam-policy";
import { CustomRole } from "@/engine/domains/role-catalog";
import { ServiceAccount } from "@/engine/domains/service-account";
import { BucketName } from "@/engine/domains/storage";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";
import { StringEx } from "@/utils/StringEx";

/**
 * Console のフォームの値を、同じ結果になる gcloud のコマンドラインにする（UC-008 / DJ-011）。
 * Console は World を直接触らず、ここで作った 1 行を CLI と同じ経路で流す。項目の検証は
 * ドメインの `parse*` を呼ぶだけで、規則をここに写さない（CLI と同じ答えになるのが DJ-011 の要求）。
 */

/** 空白や引用符を含む値をシェルの 1 語にする（Tokenizer が読める形）。 */
const quote = (value: string): string =>
  /[\s"'\\]/.test(value) ? `"${value.replace(/(["\\])/g, "\\$1")}"` : value;

const flag = (name: string, value: string): string => `--${name}=${quote(value)}`;

/** フォームの項目ごとの入力エラー（UC-008 例外フロー: 項目の直下に出し、送信しない）。 */
export type FieldErrors<F extends object> = Readonly<Partial<Record<keyof F, string>>>;

/** 作成フォームのコンパニオンが揃えて持つ形。`useCreateForm` がこれを受ける。 */
export type CreateFormOps<F extends object> = Readonly<{
  collectErrors: (form: F) => FieldErrors<F>;
}>;

export const FieldErrors = {
  /** エラーの無い状態（送信を試みる前）。 */
  none<F extends object>(): FieldErrors<F> {
    const empty: Partial<Record<keyof F, string>> = {};
    return empty;
  },

  isEmpty<F extends object>(errors: FieldErrors<F>): boolean {
    return Object.keys(errors).length === 0;
  },
} as const;

/** `Result<_, string>` を項目のエラーにする。 */
const errorOf = <T>(result: Result<T, string>): Option<string> =>
  Result.isOk(result) ? Option.none : Option.some(result.error);

/** 項目ごとの検証結果から、エラーのある項目だけを集める。 */
const collect = <F extends object>(
  entries: readonly (readonly [keyof F, Option<string>])[],
): FieldErrors<F> => {
  const errors: Partial<Record<keyof F, string>> = {};
  for (const [key, error] of entries) {
    if (Option.isSome(error)) errors[key] = error.value;
  }
  return errors;
};

// --- VM ---

export type VmCreateForm = Readonly<{
  name: string;
  zone: Zone;
  machineType: MachineTypeName;
  provisioningModel: ProvisioningModel;
  imageFamily: string;
  imageProject: string;
  bootDiskSize: string;
  bootDiskType: BootDiskType;
  serviceAccount: string;
  scopes: "default" | "cloud-platform";
  tags: string;
  externalIp: boolean;
}>;

export const VmCreateForm = {
  /**
   * 既定値（UI 案 2c: e2-small / Debian 12 / 10GB pd-balanced / 既定のスコープ / 外部 IP あり）。
   *
   * @param seed ゾーンと既定のサービスアカウント（プロジェクトごとに違う）
   * @returns 既定値で埋めたフォーム
   */
  create(seed: Readonly<{ zone: Zone; serviceAccount: string }>): VmCreateForm {
    return {
      name: "",
      zone: seed.zone,
      machineType: "e2-small",
      provisioningModel: ProvisioningModels.Standard,
      imageFamily: "debian-12",
      imageProject: "debian-cloud",
      bootDiskSize: "10GB",
      bootDiskType: BootDiskTypes.Balanced,
      serviceAccount: seed.serviceAccount,
      scopes: "default",
      tags: "",
      externalIp: true,
    };
  },

  /** 項目ごとの入力エラー。名前は RFC1035、ディスクは `10GB` の形。 */
  collectErrors(form: VmCreateForm): FieldErrors<VmCreateForm> {
    return collect<VmCreateForm>([
      ["name", errorOf(ResourceName.parse(form.name))],
      ["bootDiskSize", errorOf(DiskSizeGb.parse(form.bootDiskSize))],
    ]);
  },

  /**
   * 同等のコマンドライン（UI 案 2c / s1 の「同等のコード」）。
   *
   * @param form フォームの値
   * @param projectId 対象プロジェクト（`--project` で明示する）
   * @returns `gcloud compute instances create ...` の 1 行
   */
  toCommand(form: VmCreateForm, projectId: string): string {
    const tags = StringEx.splitList(form.tags);
    const parts = [
      "gcloud compute instances create",
      quote(form.name),
      flag("project", projectId),
      flag("zone", form.zone),
      flag("machine-type", form.machineType),
      flag("provisioning-model", form.provisioningModel),
      flag("service-account", form.serviceAccount),
      flag("scopes", form.scopes),
      flag("image-family", form.imageFamily),
      flag("image-project", form.imageProject),
      flag("boot-disk-size", form.bootDiskSize),
      flag("boot-disk-type", form.bootDiskType),
      ...(tags.length === 0 ? [] : [flag("tags", tags.join(","))]),
      ...(form.externalIp ? [] : ["--no-address"]),
    ];
    return parts.join(" ");
  },
} as const;

/** VM 一覧の操作（UI 案 2b: 開始 / 再開 / 停止 / 一時停止 / 削除 / SSH）。 */
export const VmActions = {
  Start: "start",
  Stop: "stop",
  Suspend: "suspend",
  Resume: "resume",
  Delete: "delete",
  Ssh: "ssh",
} as const;
export type VmAction = (typeof VmActions)[keyof typeof VmActions];

export const VmAction = {
  /**
   * 操作のコマンドライン。削除は Console が確認済みなので `--quiet` を付ける（shell の Y/n に落ちない）。
   *
   * @param action 操作
   * @param instance 対象
   * @returns `gcloud compute instances stop NAME --zone=Z --project=P` 等
   */
  toCommand(action: VmAction, instance: Instance): string {
    const target = `${quote(instance.name)} ${flag("zone", instance.zone)} ${flag("project", instance.projectId)}`;
    switch (action) {
      case "start":
      case "stop":
      case "suspend":
      case "resume":
        return `gcloud compute instances ${action} ${target}`;
      case "delete":
        return `gcloud compute instances delete ${target} --quiet`;
      case "ssh":
        return `gcloud compute ssh ${target}`;
    }
  },

  /** その状態の VM に出す操作（UI 案 2b: 実行中なら停止 / 一時停止、停止中なら開始）。 */
  availableFor(instance: Instance): readonly VmAction[] {
    switch (instance.status) {
      case "RUNNING":
        return ["stop", "suspend", "ssh", "delete"];
      case "TERMINATED":
        return ["start", "delete"];
      case "SUSPENDED":
        return ["resume", "delete"];
    }
  },
} as const;

// --- IAM ---

export type IamGrantForm = Readonly<{ member: string; role: string }>;

export const IamGrantForm = {
  create(): IamGrantForm {
    return { member: "", role: "roles/viewer" };
  },

  collectErrors(form: IamGrantForm): FieldErrors<IamGrantForm> {
    return collect<IamGrantForm>([
      ["member", errorOf(IamMember.parse(form.member))],
      [
        "role",
        Option.isSome(RoleName.parse(form.role))
          ? Option.none
          : Option.some(`Role must be roles/... or projects/P/roles/...: ${form.role}`),
      ],
    ]);
  },

  toCommand(form: IamGrantForm, projectId: string): string {
    return `gcloud projects add-iam-policy-binding ${projectId} ${flag("member", form.member)} ${flag("role", form.role)}`;
  },

  /** 一覧の行の「削除」（継承していない行だけに出す）。 */
  removeCommand(binding: Readonly<{ member: string; role: string }>, projectId: string): string {
    return `gcloud projects remove-iam-policy-binding ${projectId} ${flag("member", binding.member)} ${flag("role", binding.role)}`;
  },
} as const;

export type ServiceAccountCreateForm = Readonly<{
  accountId: string;
  displayName: string;
  description: string;
}>;

export const ServiceAccountCreateForm = {
  create(): ServiceAccountCreateForm {
    return { accountId: "", displayName: "", description: "" };
  },

  collectErrors(form: ServiceAccountCreateForm): FieldErrors<ServiceAccountCreateForm> {
    return collect<ServiceAccountCreateForm>([
      ["accountId", errorOf(ServiceAccount.parseAccountId(form.accountId))],
    ]);
  },

  toCommand(form: ServiceAccountCreateForm, projectId: string): string {
    const parts = [
      "gcloud iam service-accounts create",
      quote(form.accountId),
      flag("project", projectId),
      ...(form.displayName === "" ? [] : [flag("display-name", form.displayName)]),
      ...(form.description === "" ? [] : [flag("description", form.description)]),
    ];
    return parts.join(" ");
  },
} as const;

export type RoleCreateForm = Readonly<{ roleId: string; title: string; permissions: string }>;

export const RoleCreateForm = {
  create(): RoleCreateForm {
    return { roleId: "", title: "", permissions: "" };
  },

  collectErrors(form: RoleCreateForm): FieldErrors<RoleCreateForm> {
    return collect<RoleCreateForm>([
      ["roleId", errorOf(CustomRole.parseRoleId(form.roleId))],
      [
        "permissions",
        StringEx.splitList(form.permissions).length === 0
          ? Option.some("権限を 1 つ以上入れてください。")
          : Option.none,
      ],
    ]);
  },

  toCommand(form: RoleCreateForm, projectId: string): string {
    const parts = [
      "gcloud iam roles create",
      quote(form.roleId),
      flag("project", projectId),
      flag("permissions", StringEx.splitList(form.permissions).join(",")),
      ...(form.title === "" ? [] : [flag("title", form.title)]),
    ];
    return parts.join(" ");
  },
} as const;

// --- 予算 ---

export type BudgetCreateForm = Readonly<{
  displayName: string;
  amount: string;
  thresholds: readonly number[];
  projectIds: readonly string[];
}>;

export const BudgetCreateForm = {
  create(): BudgetCreateForm {
    return { displayName: "", amount: "100000", thresholds: [0.5, 0.9, 1], projectIds: [] };
  },

  collectErrors(form: BudgetCreateForm): FieldErrors<BudgetCreateForm> {
    return collect<BudgetCreateForm>([
      [
        "displayName",
        form.displayName.trim() === "" ? Option.some("名前を入れてください。") : Option.none,
      ],
      ["amount", errorOf(Budget.parseAmount(form.amount))],
    ]);
  },

  toCommand(form: BudgetCreateForm, billingAccountId: string): string {
    const parts = [
      "gcloud billing budgets create",
      flag("billing-account", billingAccountId),
      flag("display-name", form.displayName),
      flag("budget-amount", `${form.amount}JPY`),
      ...form.thresholds.map((t) => flag("threshold-rule", `percent=${t}`)),
      ...(form.projectIds.length === 0 ? [] : [flag("filter-projects", form.projectIds.join(","))]),
    ];
    return parts.join(" ");
  },
} as const;

// --- ファイアウォール ---

export type FirewallCreateForm = Readonly<{
  name: string;
  network: string;
  direction: Direction;
  priority: string;
  targetTags: string;
  sourceRanges: string;
  protocolsAndPorts: string;
  action: FirewallAction;
}>;

/** 入力欄の整数。数字だけの綴りを数にし、それ以外は `none`。 */
const integerOf = (value: string): Option<number> =>
  /^\d+$/.test(value) ? Option.some(Number(value)) : Option.none;

export const FirewallCreateForm = {
  create(): FirewallCreateForm {
    return {
      name: "",
      network: "default",
      direction: Directions.Ingress,
      priority: "1000",
      targetTags: "",
      sourceRanges: "0.0.0.0/0",
      protocolsAndPorts: "tcp:80",
      action: FirewallActions.Allow,
    };
  },

  collectErrors(form: FirewallCreateForm): FieldErrors<FirewallCreateForm> {
    const rules = StringEx.splitList(form.protocolsAndPorts);
    const badRule = rules.map(ProtocolRule.parse).find((r) => !Result.isOk(r));
    const priority = Option.toResult(integerOf(form.priority), () => "整数にしてください。");
    return collect<FirewallCreateForm>([
      ["name", errorOf(ResourceName.parse(form.name))],
      ["priority", errorOf(Result.flatMap(priority, FirewallRule.parsePriority))],
      [
        "protocolsAndPorts",
        rules.length === 0
          ? Option.some("tcp:80 のように 1 つ以上入れてください。")
          : badRule !== undefined && !Result.isOk(badRule)
            ? Option.some(badRule.error)
            : Option.none,
      ],
    ]);
  },

  toCommand(form: FirewallCreateForm, projectId: string): string {
    const list = (value: string) => StringEx.splitList(value).join(",");
    const rules = list(form.protocolsAndPorts);
    const parts = [
      "gcloud compute firewall-rules create",
      quote(form.name),
      flag("project", projectId),
      flag("network", form.network),
      flag("direction", form.direction),
      flag("priority", form.priority),
      ...(form.action === FirewallActions.Allow
        ? [flag("allow", rules)]
        : ["--action=DENY", flag("rules", rules)]),
      ...(list(form.sourceRanges) === "" ? [] : [flag("source-ranges", list(form.sourceRanges))]),
      ...(list(form.targetTags) === "" ? [] : [flag("target-tags", list(form.targetTags))]),
    ];
    return parts.join(" ");
  },
} as const;

// --- バケット ---

export type BucketCreateForm = Readonly<{
  name: string;
  /** 入力欄は自由記述なので、綴りの検証は `collectErrors` が `BucketLocation.parse` で行う */
  location: string;
  storageClass: StorageClass;
  uniformAccess: boolean;
  publicAccessPrevention: boolean;
}>;

export const BucketCreateForm = {
  create(): BucketCreateForm {
    return {
      name: "",
      location: "ASIA-NORTHEAST1",
      storageClass: "STANDARD",
      uniformAccess: true,
      publicAccessPrevention: true,
    };
  },

  collectErrors(form: BucketCreateForm): FieldErrors<BucketCreateForm> {
    return collect<BucketCreateForm>([
      ["name", errorOf(BucketName.parse(form.name))],
      [
        "location",
        Option.isSome(BucketLocation.parse(form.location))
          ? Option.none
          : Option.some(`Unknown location: ${form.location}`),
      ],
    ]);
  },

  toCommand(form: BucketCreateForm, projectId: string): string {
    const parts = [
      "gcloud storage buckets create",
      `gs://${form.name}`,
      flag("project", projectId),
      flag("location", form.location),
      flag("default-storage-class", form.storageClass),
      ...(form.uniformAccess ? ["--uniform-bucket-level-access"] : []),
      ...(form.publicAccessPrevention ? ["--public-access-prevention"] : []),
    ];
    return parts.join(" ");
  },
} as const;

/** `services enable` の 1 行（「API を有効にする」ボタン）。 */
export const enableApiCommand = (api: ApiName, projectId: string): string =>
  `gcloud services enable ${api} ${flag("project", projectId)}`;

export { StorageClass };
