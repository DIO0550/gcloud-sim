import { Budget } from "@/engine/domains/billing-budget";
import {
  type ApiName,
  BucketLocation,
  type MachineTypeName,
  type Region,
  StorageClass,
  Zone,
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
import { Ipv4 } from "@/engine/domains/gke-control-plane";
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
export const quote = (value: string): string =>
  /[\s"'\\]/.test(value) ? `"${value.replace(/(["\\])/g, "\\$1")}"` : value;

export const flag = (name: string, value: string): string => `--${name}=${quote(value)}`;

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
export const errorOf = <T>(result: Result<T, string>): Option<string> =>
  Result.isOk(result) ? Option.none : Option.some(result.error);

/** 項目ごとの検証結果から、エラーのある項目だけを集める。 */
export const collect = <F extends object>(
  entries: readonly (readonly [keyof F, Option<string>])[],
): FieldErrors<F> => {
  const errors: Partial<Record<keyof F, string>> = {};
  for (const [key, error] of entries) {
    if (Option.isSome(error)) errors[key] = error.value;
  }
  return errors;
};

/** 同等のコマンドラインの値に付ける印。changed = 既定から変えた、invalid = 送信できない綴り。 */
export type CommandMark = "plain" | "changed" | "invalid";

/** 同等のコマンドラインの 1 語。`lead`（`--zone=` の部分）と値に分け、値にだけ印を付ける。 */
export type CommandPart = Readonly<{ lead: string; value: string; mark: CommandMark }>;

export const CommandPart = {
  /** 語を空白でつないで 1 行にする（流すのも、コピーするのもこの 1 行）。 */
  join(parts: readonly CommandPart[]): string {
    return parts.map((p) => `${p.lead}${p.value}`).join(" ");
  },
} as const;

const flagPart = (name: string, value: string, mark: CommandMark): CommandPart => ({
  lead: `--${name}=`,
  value: quote(value),
  mark,
});

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
  /** VPC ネットワーク。`default` 以外のときだけコマンドに出す */
  network: string;
  /** ネットワークのサブネットのうちゾーンのリージョンにあるもの。空なら指定しない */
  subnet: string;
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
      network: "default",
      subnet: "",
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
    return CommandPart.join(VmCreateForm.toParts(form, projectId));
  },

  /**
   * 同等のコマンドラインを語ごとに分けたもの（UI 案 s1: 1 フラグ 1 行で並べ、既定から変えた値と
   * 不正な値に印を付ける）。つなげると `toCommand` と同じ 1 行になる。
   *
   * @param form フォームの値
   * @param projectId 対象プロジェクト
   * @returns 先頭の `gcloud compute instances create NAME` と、続くフラグ
   */
  toParts(form: VmCreateForm, projectId: string): readonly CommandPart[] {
    const defaults = VmCreateForm.create({ zone: form.zone, serviceAccount: form.serviceAccount });
    const changed = (key: keyof VmCreateForm): CommandMark =>
      form[key] === defaults[key] ? "plain" : "changed";
    const tags = StringEx.splitList(form.tags);
    const defaultSubnet =
      form.network === "default" && (form.subnet === "" || form.subnet === "default");
    return [
      {
        lead: "gcloud compute instances create ",
        value: quote(form.name),
        mark: Option.isSome(errorOf(ResourceName.parse(form.name))) ? "invalid" : "plain",
      },
      flagPart("project", projectId, "plain"),
      flagPart("zone", form.zone, "plain"),
      flagPart("machine-type", form.machineType, changed("machineType")),
      flagPart("provisioning-model", form.provisioningModel, changed("provisioningModel")),
      flagPart("service-account", form.serviceAccount, "plain"),
      flagPart("scopes", form.scopes, changed("scopes")),
      ...(tags.length === 0 ? [] : [flagPart("tags", tags.join(","), "changed")]),
      ...(form.network === "default"
        ? defaultSubnet
          ? []
          : [flagPart("subnet", form.subnet, "changed")]
        : [
            flagPart("network", form.network, "changed"),
            ...(form.subnet === "" ? [] : [flagPart("subnet", form.subnet, "changed")]),
          ]),
      flagPart("image-family", form.imageFamily, changed("imageFamily")),
      flagPart("image-project", form.imageProject, changed("imageProject")),
      flagPart(
        "boot-disk-size",
        form.bootDiskSize,
        Option.isSome(errorOf(DiskSizeGb.parse(form.bootDiskSize)))
          ? "invalid"
          : changed("bootDiskSize"),
      ),
      flagPart("boot-disk-type", form.bootDiskType, changed("bootDiskType")),
      ...(form.externalIp ? [] : [{ lead: "", value: "--no-address", mark: "changed" as const }]),
    ];
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
   * 外部 IP が無い VM の SSH は本物 Console と同様に `--tunnel-through-iap` を付ける。
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
      case "ssh": {
        const nic = instance.networkInterfaces[0];
        const hasExternal = nic !== undefined && nic.externalIP.kind !== "none";
        return hasExternal
          ? `gcloud compute ssh ${target}`
          : `gcloud compute ssh ${target} --tunnel-through-iap`;
      }
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

/** 本物の Console 同様、メールアドレスそのままの入力にも user: / serviceAccount: を補う。 */
const normalizeIamMember = (raw: string): string => {
  const trimmed = raw.trim();
  if (
    trimmed === "" ||
    trimmed === "allUsers" ||
    trimmed === "allAuthenticatedUsers" ||
    /^(user|serviceAccount|group|domain):/.test(trimmed)
  ) {
    return trimmed;
  }
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
    return trimmed.endsWith(".gserviceaccount.com")
      ? `serviceAccount:${trimmed}`
      : `user:${trimmed}`;
  }
  return trimmed;
};

export const IamGrantForm = {
  create(): IamGrantForm {
    return { member: "", role: "roles/viewer" };
  },

  normalizeMember: normalizeIamMember,

  collectErrors(form: IamGrantForm): FieldErrors<IamGrantForm> {
    const normalized = normalizeIamMember(form.member);
    return collect<IamGrantForm>([
      ["member", errorOf(IamMember.parse(normalized))],
      [
        "role",
        Option.isSome(RoleName.parse(form.role))
          ? Option.none
          : Option.some(
              `ロールは roles/... または projects/P/roles/... の形式で指定してください: ${form.role}`,
            ),
      ],
    ]);
  },

  toCommand(form: IamGrantForm, projectId: string): string {
    return `gcloud projects add-iam-policy-binding ${projectId} ${flag("member", normalizeIamMember(form.member))} ${flag("role", form.role)}`;
  },

  /** 一覧の行の「削除」（継承していない行だけに出す）。 */
  removeCommand(binding: Readonly<{ member: string; role: string }>, projectId: string): string {
    return `gcloud projects remove-iam-policy-binding ${projectId} ${flag("member", binding.member)} ${flag("role", binding.role)}`;
  },

  /**
   * 組織・フォルダ・プロジェクトに付いたバインディングを外すコマンド（UI 案 s2: 継承されたロールは
   * 継承元のポリシーを変える）。語ごとに分けて返す（1 語 1 行で見せるため）。
   *
   * @param binding 外すメンバーとロール
   * @param target バインディングが付いている所
   * @returns `gcloud ... remove-iam-policy-binding ...` の語の並び
   */
  removeCommandAt(
    binding: Readonly<{ member: string; role: string }>,
    target: Readonly<{ type: "organization" | "folder" | "project"; id: string }>,
  ): readonly string[] {
    const head = (() => {
      switch (target.type) {
        case "organization":
          return ["gcloud organizations", "remove-iam-policy-binding", target.id];
        case "folder":
          return ["gcloud resource-manager folders", "remove-iam-policy-binding", target.id];
        case "project":
          return ["gcloud projects", "remove-iam-policy-binding", target.id];
      }
    })();
    return [...head, flag("member", binding.member), flag("role", binding.role)];
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
      [
        "thresholds",
        form.thresholds.length === 0
          ? Option.some("しきい値を 1 つ以上選んでください。")
          : Option.none,
      ],
    ]);
  },

  toCommand(form: BudgetCreateForm, billingAccountId: string): string {
    const parts = [
      "gcloud billing budgets create",
      flag("billing-account", billingAccountId),
      flag("display-name", form.displayName),
      flag("budget-amount", `${form.amount}JPY`),
      ...form.thresholds.map((t) => flag("threshold-rule", `percent=${t}`)),
      ...(form.projectIds.length === 0
        ? []
        : [flag("filter-projects", form.projectIds.map((id) => `projects/${id}`).join(","))]),
    ];
    return parts.join(" ");
  },
} as const;

// --- ファイアウォール ---

/** ファイアウォール ルールのターゲット種別（本物 Console の「ターゲット」）。 */
export type FirewallTargetType = "all" | "tags" | "service-accounts";

/** ファイアウォール ルールの送信元フィルタ種別（本物 Console の「送信元フィルタ」）。 */
export type FirewallSourceFilter = "ip-ranges" | "source-tags" | "service-accounts";

/** プロトコルとポートの指定方法（すべて許可/拒否 か、指定したプロトコルとポートか）。 */
export type FirewallProtocolsMode = "all" | "specified";

export type FirewallCreateForm = Readonly<{
  name: string;
  network: string;
  direction: Direction;
  priority: string;
  targetType: FirewallTargetType;
  targetTags: string;
  targetServiceAccounts: string;
  sourceFilter: FirewallSourceFilter;
  sourceRanges: string;
  sourceTags: string;
  sourceServiceAccounts: string;
  protocolsMode: FirewallProtocolsMode;
  protocolsAndPorts: string;
  action: FirewallAction;
  enableLogging: boolean;
  disabled: boolean;
}>;

/** 入力欄の整数。数字だけの綴りを数にし、それ以外は `none`。 */
export const integerOf = (value: string): Option<number> =>
  /^\d+$/.test(value) ? Option.some(Number(value)) : Option.none;

export const FirewallCreateForm = {
  create(): FirewallCreateForm {
    return {
      name: "",
      network: "default",
      direction: Directions.Ingress,
      priority: "1000",
      targetType: "tags",
      targetTags: "",
      targetServiceAccounts: "",
      sourceFilter: "ip-ranges",
      sourceRanges: "0.0.0.0/0",
      sourceTags: "",
      sourceServiceAccounts: "",
      protocolsMode: "specified",
      protocolsAndPorts: "tcp:80",
      action: FirewallActions.Allow,
      enableLogging: false,
      disabled: false,
    };
  },

  collectErrors(form: FirewallCreateForm): FieldErrors<FirewallCreateForm> {
    const rules =
      form.protocolsMode === "all" ? ["all"] : StringEx.splitList(form.protocolsAndPorts);
    const badRule = rules.map(ProtocolRule.parse).find((r) => !Result.isOk(r));
    const priority = Option.toResult(integerOf(form.priority), () => "整数にしてください。");
    const hasTargetSa = StringEx.splitList(form.targetServiceAccounts).length > 0;
    const hasSourceTags = StringEx.splitList(form.sourceTags).length > 0;
    const hasSourceSa = StringEx.splitList(form.sourceServiceAccounts).length > 0;
    const ranges = StringEx.splitList(form.sourceRanges);
    const badRange = ranges.find((r) => !Option.isSome(Ipv4.range(r)));
    const usesIpRanges = form.direction === Directions.Egress || form.sourceFilter === "ip-ranges";
    return collect<FirewallCreateForm>([
      ["name", errorOf(ResourceName.parse(form.name))],
      ["priority", errorOf(Result.flatMap(priority, FirewallRule.parsePriority))],
      [
        "targetServiceAccounts",
        form.targetType === "service-accounts" && !hasTargetSa
          ? Option.some("ターゲット サービス アカウントを 1 つ以上入れてください。")
          : Option.none,
      ],
      [
        "sourceRanges",
        usesIpRanges && badRange !== undefined
          ? Option.some(`IPv4 CIDR 範囲の形式が正しくありません: ${badRange}`)
          : Option.none,
      ],
      [
        "sourceTags",
        form.direction === Directions.Ingress &&
        form.sourceFilter === "source-tags" &&
        !hasSourceTags
          ? Option.some("ソースタグを 1 つ以上入れてください。")
          : Option.none,
      ],
      [
        "sourceServiceAccounts",
        form.direction === Directions.Ingress &&
        form.sourceFilter === "service-accounts" &&
        !hasSourceSa
          ? Option.some("送信元サービス アカウントを 1 つ以上入れてください。")
          : Option.none,
      ],
      [
        "protocolsAndPorts",
        form.protocolsMode === "all"
          ? Option.none
          : rules.length === 0
            ? Option.some("tcp:80 のように 1 つ以上入れてください。")
            : badRule !== undefined && !Result.isOk(badRule)
              ? Option.some(badRule.error)
              : Option.none,
      ],
    ]);
  },

  toCommand(form: FirewallCreateForm, projectId: string): string {
    const list = (value: string) => StringEx.splitList(value).join(",");
    const rules = form.protocolsMode === "all" ? "all" : list(form.protocolsAndPorts);
    const isEgress = form.direction === Directions.Egress;
    const rangeFlag = isEgress ? "destination-ranges" : "source-ranges";
    const sourceFlags = (): readonly string[] => {
      if (isEgress || form.sourceFilter === "ip-ranges") {
        const value = list(form.sourceRanges);
        return value === "" ? [] : [flag(rangeFlag, value)];
      }
      if (form.sourceFilter === "source-tags") {
        const value = list(form.sourceTags);
        return value === "" ? [] : [flag("source-tags", value)];
      }
      const value = list(form.sourceServiceAccounts);
      return value === "" ? [] : [flag("source-service-accounts", value)];
    };
    const targetFlags = (): readonly string[] => {
      if (form.targetType === "tags") {
        const value = list(form.targetTags);
        return value === "" ? [] : [flag("target-tags", value)];
      }
      if (form.targetType === "service-accounts") {
        const value = list(form.targetServiceAccounts);
        return value === "" ? [] : [flag("target-service-accounts", value)];
      }
      return [];
    };
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
      ...sourceFlags(),
      ...targetFlags(),
      ...(form.enableLogging ? ["--enable-logging"] : []),
      ...(form.disabled ? ["--disabled"] : []),
    ];
    return parts.join(" ");
  },
} as const;

// --- VPC ネットワーク ---

/** Console の作成画面のサブネット作成モード。自動はリージョンごとに 1 つずつ作られる。 */
export type NetworkSubnetMode = "auto" | "custom";

export type NetworkCreateForm = Readonly<{
  name: string;
  subnetMode: NetworkSubnetMode;
  /** カスタムのときだけ使う、最初の 1 つのサブネット */
  subnetName: string;
  subnetRegion: Region;
  subnetRange: string;
  allowIcmp: boolean;
  allowCustom: boolean;
  allowRdp: boolean;
  allowSsh: boolean;
}>;

/** 自動モードのサブネットがすべて収まる範囲（`-allow-custom` の既定の送信元）。 */
export const AutoModeRange = "10.128.0.0/9";

type FirewallPreset = Readonly<{
  key: "allowIcmp" | "allowCustom" | "allowRdp" | "allowSsh";
  suffix: string;
  allow: string;
  label: string;
}>;

/**
 * 作成画面の「ファイアウォール ルール」で選べる 4 つ（default ネットワークの標準のルールと同じ）。
 * どれも優先度 65534 で、暗黙の deny-all-ingress / allow-all-egress（65535）より先に評価される。
 */
export const NetworkFirewallPresets: readonly FirewallPreset[] = [
  { key: "allowIcmp", suffix: "allow-icmp", allow: "icmp", label: "ICMP（ping など）" },
  { key: "allowCustom", suffix: "allow-custom", allow: "all", label: "ネットワーク内のすべて" },
  { key: "allowRdp", suffix: "allow-rdp", allow: "tcp:3389", label: "RDP（tcp:3389）" },
  { key: "allowSsh", suffix: "allow-ssh", allow: "tcp:22", label: "SSH（tcp:22）" },
];

/** プリセットのルールの送信元。`-allow-custom` だけはネットワークの内側から。 */
export const presetSourceRange = (preset: FirewallPreset, form: NetworkCreateForm): string => {
  if (preset.key !== "allowCustom") return "0.0.0.0/0";
  return form.subnetMode === "auto" ? AutoModeRange : form.subnetRange;
};

export const NetworkCreateForm = {
  create(): NetworkCreateForm {
    return {
      name: "",
      subnetMode: "auto",
      subnetName: "",
      subnetRegion: "us-central1",
      subnetRange: "",
      allowIcmp: false,
      allowCustom: false,
      allowRdp: false,
      allowSsh: false,
    };
  },

  /** 名前は RFC1035。カスタムならサブネットの名前と CIDR も見る。 */
  collectErrors(form: NetworkCreateForm): FieldErrors<NetworkCreateForm> {
    const custom = form.subnetMode === "custom";
    return collect<NetworkCreateForm>([
      ["name", errorOf(ResourceName.parse(form.name))],
      ["subnetName", custom ? errorOf(ResourceName.parse(form.subnetName)) : Option.none],
      [
        "subnetRange",
        custom && !Option.isSome(Ipv4.range(form.subnetRange))
          ? Option.some("10.0.0.0/24 のような CIDR にしてください。")
          : Option.none,
      ],
    ]);
  },

  /**
   * 「作成」が順に流すコマンド。ネットワーク → （カスタムなら）サブネット → 選んだファイアウォール ルール。
   *
   * @param form フォームの値
   * @param projectId 対象プロジェクト
   * @returns 1 行ずつのコマンドと、端末に出す説明
   */
  toSteps(
    form: NetworkCreateForm,
    projectId: string,
  ): readonly Readonly<{ line: string; note: string }>[] {
    const network = {
      line: `gcloud compute networks create ${quote(form.name)} ${flag("project", projectId)} ${flag("subnet-mode", form.subnetMode)}`,
      note: `VPC ネットワークを作成 (${form.name})`,
    };
    const subnet =
      form.subnetMode === "custom"
        ? [
            {
              line: `gcloud compute networks subnets create ${quote(form.subnetName)} ${flag("project", projectId)} ${flag("network", form.name)} ${flag("region", form.subnetRegion)} ${flag("range", form.subnetRange)}`,
              note: `サブネットを作成 (${form.subnetName})`,
            },
          ]
        : [];
    const rules = NetworkFirewallPresets.filter((p) => form[p.key]).map((p) => {
      const name = `${form.name}-${p.suffix}`;
      const sourceRange = presetSourceRange(p, form) || "10.0.0.0/8";
      return {
        line: `gcloud compute firewall-rules create ${quote(name)} ${flag("project", projectId)} ${flag("network", form.name)} --direction=INGRESS --priority=65534 ${flag("allow", p.allow)} ${flag("source-ranges", sourceRange)}`,
        note: `ファイアウォール ルールを作成 (${name})`,
      };
    });
    return [network, ...subnet, ...rules];
  },

  /** 同等のコマンドライン（1 行に 1 コマンド）。 */
  toCommand(form: NetworkCreateForm, projectId: string): string {
    return NetworkCreateForm.toSteps(form, projectId)
      .map((s) => s.line)
      .join("\n");
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
          : Option.some(`未対応のロケーションです: ${form.location}`),
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

// --- 削除（一覧の行の「削除」） ---

/**
 * 一覧の行から消すときのコマンドライン。Console は確認ダイアログで確かめてから流すので、
 * どれも `--quiet` を付ける（shell の Y/n に落ちない: VM の削除と同じ）。
 */
export const DeleteCommand = {
  /** 中身（現行・非現行世代）があれば `storage rm --recursive`（本物の Console もオブジェクトごと消す）、空なら `buckets delete`。 */
  bucket(
    bucket: Readonly<{ name: string; objectCount: number; noncurrentCount?: number }>,
    projectId: string,
  ): string {
    return bucket.objectCount > 0 || (bucket.noncurrentCount ?? 0) > 0
      ? `gcloud storage rm --recursive gs://${bucket.name} ${flag("project", projectId)} --quiet`
      : `gcloud storage buckets delete gs://${bucket.name} ${flag("project", projectId)} --quiet`;
  },

  network(name: string, projectId: string): string {
    return `gcloud compute networks delete ${quote(name)} ${flag("project", projectId)} --quiet`;
  },

  firewallRule(name: string, projectId: string): string {
    return `gcloud compute firewall-rules delete ${quote(name)} ${flag("project", projectId)} --quiet`;
  },

  subnet(subnet: Readonly<{ name: string; region: string }>, projectId: string): string {
    return `gcloud compute networks subnets delete ${quote(subnet.name)} ${flag("region", subnet.region)} ${flag("project", projectId)} --quiet`;
  },

  serviceAccount(email: string, projectId: string): string {
    return `gcloud iam service-accounts delete ${quote(email)} ${flag("project", projectId)} --quiet`;
  },

  customRole(roleId: string, projectId: string): string {
    return `gcloud iam roles delete ${quote(roleId)} ${flag("project", projectId)} --quiet`;
  },

  budget(budgetId: string, billingAccountId: string, projectId: string): string {
    return `gcloud billing budgets delete ${quote(budgetId)} ${flag("billing-account", billingAccountId)} ${flag("project", projectId)} --quiet`;
  },

  /** クラスタの置き場がゾーンなら `--zone`、リージョンなら `--region`。 */
  cluster(cluster: Readonly<{ name: string; location: string }>, projectId: string): string {
    const scope = Option.isSome(Zone.parse(cluster.location)) ? "zone" : "region";
    return `gcloud container clusters delete ${quote(cluster.name)} ${flag(scope, cluster.location)} ${flag("project", projectId)} --quiet`;
  },

  runService(service: Readonly<{ name: string; region: string }>, projectId: string): string {
    return `gcloud run services delete ${quote(service.name)} ${flag("region", service.region)} ${flag("project", projectId)} --quiet`;
  },

  /** Marketplace のデプロイ。作った VM とファイアウォール ルールも一緒に消える。 */
  infraDeployment(
    deployment: Readonly<{ name: string; location: string }>,
    projectId: string,
  ): string {
    return `gcloud infra-manager deployments delete ${quote(deployment.name)} ${flag("location", deployment.location)} ${flag("project", projectId)} --quiet`;
  },

  snapshot(name: string, projectId: string): string {
    return `gcloud compute snapshots delete ${quote(name)} ${flag("project", projectId)} --quiet`;
  },

  image(name: string, projectId: string): string {
    return `gcloud compute images delete ${quote(name)} ${flag("project", projectId)} --quiet`;
  },
} as const;

// --- GKE クラスタ ---

export type ClusterMode = "autopilot" | "standard";
export type ClusterReleaseChannel = "regular" | "rapid" | "stable" | "None";

export type ClusterCreateForm = Readonly<{
  mode: ClusterMode;
  name: string;
  locationType: "zone" | "region";
  zone: Zone;
  region: Region;
  numNodes: string;
  machineType: MachineTypeName;
  releaseChannel: ClusterReleaseChannel;
  network: string;
  enableNetworkPolicy: boolean;
  enableWorkloadIdentity: boolean;
}>;

const positiveIntError = (raw: string, max: number): Option<string> => {
  const n = Number(raw.trim());
  return Number.isInteger(n) && n >= 1 && n <= max
    ? Option.none
    : Option.some(`1〜${max} の整数で指定してください`);
};

export const clusterCredentialsCommand = (
  cluster: Readonly<{ name: string; location: string }>,
  projectId: string,
): string => {
  const scope = Option.isSome(Zone.parse(cluster.location)) ? "zone" : "region";
  return `gcloud container clusters get-credentials ${quote(cluster.name)} ${flag(scope, cluster.location)} ${flag("project", projectId)}`;
};

export const ClusterCreateForm = {
  create(seed: Readonly<{ zone: Zone; region: Region }>): ClusterCreateForm {
    return {
      mode: "autopilot",
      name: "",
      locationType: "zone",
      zone: seed.zone,
      region: seed.region,
      numNodes: "3",
      machineType: "e2-medium",
      releaseChannel: "regular",
      network: "default",
      enableNetworkPolicy: false,
      enableWorkloadIdentity: false,
    };
  },

  collectErrors(form: ClusterCreateForm): FieldErrors<ClusterCreateForm> {
    return collect<ClusterCreateForm>([
      ["name", errorOf(ResourceName.parse(form.name))],
      ...(form.mode === "standard"
        ? ([["numNodes", positiveIntError(form.numNodes, 100)]] as const)
        : []),
    ]);
  },

  toCommand(form: ClusterCreateForm, projectId: string): string {
    if (form.mode === "autopilot") {
      return [
        `gcloud container clusters create-auto ${quote(form.name)}`,
        flag("project", projectId),
        flag("region", form.region),
        flag("release-channel", form.releaseChannel),
        ...(form.network !== "default" && form.network !== ""
          ? [flag("network", form.network)]
          : []),
      ].join(" ");
    }
    const locationFlag =
      form.locationType === "region" ? flag("region", form.region) : flag("zone", form.zone);
    return [
      `gcloud container clusters create ${quote(form.name)}`,
      flag("project", projectId),
      locationFlag,
      flag("num-nodes", form.numNodes.trim() || "3"),
      flag("machine-type", form.machineType),
      flag("release-channel", form.releaseChannel),
      ...(form.network !== "default" && form.network !== "" ? [flag("network", form.network)] : []),
      ...(form.enableNetworkPolicy ? ["--enable-network-policy"] : []),
      ...(form.enableWorkloadIdentity ? [flag("workload-pool", `${projectId}.svc.id.goog`)] : []),
    ].join(" ");
  },
} as const;

// --- Cloud Run サービス ---

export type RunServiceCreateForm = Readonly<{
  name: string;
  image: string;
  region: Region;
  allowUnauthenticated: boolean;
}>;

export const RunServiceCreateForm = {
  create(region: Region): RunServiceCreateForm {
    return {
      name: "",
      image: "us-docker.pkg.dev/cloudrun/container/hello",
      region,
      allowUnauthenticated: true,
    };
  },

  collectErrors(form: RunServiceCreateForm): FieldErrors<RunServiceCreateForm> {
    return collect<RunServiceCreateForm>([
      ["name", errorOf(ResourceName.parse(form.name))],
      [
        "image",
        form.image.trim() === ""
          ? Option.some("コンテナ イメージの URL を入力してください")
          : Option.none,
      ],
    ]);
  },

  toCommand(form: RunServiceCreateForm, projectId: string): string {
    return [
      `gcloud run deploy ${quote(form.name)}`,
      flag("project", projectId),
      flag("image", form.image.trim()),
      flag("region", form.region),
      form.allowUnauthenticated ? "--allow-unauthenticated" : "--no-allow-unauthenticated",
    ].join(" ");
  },
} as const;

// --- VPC サブネット ---

export type SubnetCreateForm = Readonly<{
  name: string;
  network: string;
  region: Region;
  range: string;
  privateIpGoogleAccess: boolean;
  enableFlowLogs: boolean;
}>;

export const SubnetCreateForm = {
  create(seed: Readonly<{ network: string; region: Region }>): SubnetCreateForm {
    return {
      name: "",
      network: seed.network,
      region: seed.region,
      range: "10.130.0.0/20",
      privateIpGoogleAccess: false,
      enableFlowLogs: false,
    };
  },

  collectErrors(form: SubnetCreateForm): FieldErrors<SubnetCreateForm> {
    return collect<SubnetCreateForm>([
      ["name", errorOf(ResourceName.parse(form.name))],
      [
        "network",
        form.network.trim() === "" ? Option.some("ネットワークを選んでください") : Option.none,
      ],
      [
        "range",
        Option.isSome(Ipv4.range(form.range.trim()))
          ? Option.none
          : Option.some("IPv4 CIDR 形式で指定してください（例: 10.130.0.0/20）"),
      ],
    ]);
  },

  toCommand(form: SubnetCreateForm, projectId: string): string {
    return [
      `gcloud compute networks subnets create ${quote(form.name)}`,
      flag("project", projectId),
      flag("network", form.network),
      flag("region", form.region),
      flag("range", form.range.trim()),
      ...(form.privateIpGoogleAccess ? ["--enable-private-ip-google-access"] : []),
      ...(form.enableFlowLogs ? ["--enable-flow-logs"] : []),
    ].join(" ");
  },
} as const;

// --- インスタンス テンプレート ---

export type MetadataEntry = Readonly<{ key: string; value: string }>;
export type TemplateImageKind = "public" | "custom";

export type InstanceTemplateCreateForm = Readonly<{
  name: string;
  machineType: MachineTypeName;
  provisioningModel: ProvisioningModel;
  imageKind: TemplateImageKind;
  imageFamily: string;
  imageProject: string;
  customImage: string;
  bootDiskSize: string;
  bootDiskType: BootDiskType;
  serviceAccount: string;
  scopes: "default" | "cloud-platform";
  network: string;
  subnet: string;
  tags: string;
  externalIp: boolean;
  startupScript: string;
  metadata: readonly MetadataEntry[];
}>;

const ForbiddenMetadataKeys = new Set(["__proto__", "constructor", "prototype"]);

const metadataEntriesOf = (form: InstanceTemplateCreateForm): readonly MetadataEntry[] => [
  ...(form.startupScript.trim() !== ""
    ? [{ key: "startup-script", value: form.startupScript.trim() }]
    : []),
  ...form.metadata
    .map((m) => ({ key: m.key.trim(), value: m.value.trim() }))
    .filter((m) => m.key !== "" || m.value !== ""),
];

const metadataErrorOf = (entries: readonly MetadataEntry[]): Option<string> => {
  for (const entry of entries) {
    if (entry.key === "") {
      return Option.some("メタデータのキーを入力してください");
    }
    if (ForbiddenMetadataKeys.has(entry.key)) {
      return Option.some(`キー名 "${entry.key}" は使用できません`);
    }
    if (/[,=\s]/.test(entry.key)) {
      return Option.some("メタデータのキーに空白・カンマ・= は含められません");
    }
    if (entry.value.includes(",")) {
      return Option.some("このシミュレータの --metadata では値にカンマ (,) を含められません");
    }
  }
  return Option.none;
};

export const InstanceTemplateCreateForm = {
  create(seed?: Readonly<{ serviceAccount?: string }>): InstanceTemplateCreateForm {
    return {
      name: "",
      machineType: "e2-medium",
      provisioningModel: ProvisioningModels.Standard,
      imageKind: "public",
      imageFamily: "debian-12",
      imageProject: "debian-cloud",
      customImage: "",
      bootDiskSize: "10GB",
      bootDiskType: BootDiskTypes.Balanced,
      serviceAccount: seed?.serviceAccount ?? "",
      scopes: "default",
      network: "default",
      subnet: "",
      tags: "",
      externalIp: true,
      startupScript: "",
      metadata: [],
    };
  },

  collectErrors(form: InstanceTemplateCreateForm): FieldErrors<InstanceTemplateCreateForm> {
    const customEntries = form.metadata
      .map((m) => ({ key: m.key.trim(), value: m.value.trim() }))
      .filter((m) => m.key !== "" || m.value !== "");
    return collect<InstanceTemplateCreateForm>([
      ["name", errorOf(ResourceName.parse(form.name))],
      ["bootDiskSize", errorOf(DiskSizeGb.parse(form.bootDiskSize))],
      ...(form.imageKind === "custom"
        ? ([
            [
              "customImage",
              form.customImage.trim() === ""
                ? Option.some("カスタム イメージを選んでください")
                : Option.none,
            ],
          ] as const)
        : []),
      [
        "startupScript",
        form.startupScript.includes(",")
          ? Option.some("このシミュレータの --metadata ではカンマ (,) を含められません")
          : Option.none,
      ],
      ["metadata", metadataErrorOf(customEntries)],
    ]);
  },

  toCommand(form: InstanceTemplateCreateForm, projectId: string): string {
    return CommandPart.join(InstanceTemplateCreateForm.toParts(form, projectId));
  },

  toParts(form: InstanceTemplateCreateForm, projectId: string): readonly CommandPart[] {
    const defaults = InstanceTemplateCreateForm.create({ serviceAccount: form.serviceAccount });
    const changed = (key: keyof InstanceTemplateCreateForm): CommandMark =>
      form[key] === defaults[key] ? "plain" : "changed";
    const tags = StringEx.splitList(form.tags);
    const metaEntries = metadataEntriesOf(form);
    const metaInvalid =
      form.startupScript.includes(",") || Option.isSome(metadataErrorOf(metaEntries));
    const metaValue = metaEntries.map((m) => `${m.key}=${m.value}`).join(",");

    return [
      {
        lead: "gcloud compute instance-templates create ",
        value: quote(form.name),
        mark: Option.isSome(errorOf(ResourceName.parse(form.name))) ? "invalid" : "plain",
      },
      flagPart("project", projectId, "plain"),
      flagPart("machine-type", form.machineType, changed("machineType")),
      ...(form.provisioningModel !== ProvisioningModels.Standard
        ? [flagPart("provisioning-model", form.provisioningModel, "changed")]
        : []),
      ...(form.serviceAccount !== ""
        ? [flagPart("service-account", form.serviceAccount, "plain")]
        : []),
      ...(form.scopes !== "default" ? [flagPart("scopes", form.scopes, "changed")] : []),
      ...(form.network !== "default" && form.network !== ""
        ? [flagPart("network", form.network, "changed")]
        : []),
      ...(form.subnet !== "" ? [flagPart("subnet", form.subnet, "changed")] : []),
      ...(tags.length > 0 ? [flagPart("tags", tags.join(","), "changed")] : []),
      ...(form.externalIp ? [] : [{ lead: "", value: "--no-address", mark: "changed" as const }]),
      ...(form.imageKind === "custom"
        ? [
            flagPart(
              "image",
              form.customImage,
              form.customImage.trim() === "" ? "invalid" : "changed",
            ),
          ]
        : [
            flagPart("image-family", form.imageFamily, changed("imageFamily")),
            flagPart("image-project", form.imageProject, changed("imageProject")),
          ]),
      flagPart(
        "boot-disk-size",
        form.bootDiskSize,
        Option.isSome(errorOf(DiskSizeGb.parse(form.bootDiskSize)))
          ? "invalid"
          : changed("bootDiskSize"),
      ),
      flagPart("boot-disk-type", form.bootDiskType, changed("bootDiskType")),
      ...(metaEntries.length > 0
        ? [flagPart("metadata", metaValue, metaInvalid ? "invalid" : "changed")]
        : []),
    ];
  },
} as const;

// --- インスタンス グループ (MIG) ---

export type InstanceGroupCreateForm = Readonly<{
  name: string;
  locationType: "zone" | "region";
  zone: Zone;
  region: Region;
  template: string;
  size: string;
  baseInstanceName: string;
}>;

export const InstanceGroupCreateForm = {
  create(
    seed: Readonly<{ zone: Zone; region: Region; template: string }>,
  ): InstanceGroupCreateForm {
    return {
      name: "",
      locationType: "zone",
      zone: seed.zone,
      region: seed.region,
      template: seed.template,
      size: "2",
      baseInstanceName: "",
    };
  },

  collectErrors(form: InstanceGroupCreateForm): FieldErrors<InstanceGroupCreateForm> {
    return collect<InstanceGroupCreateForm>([
      ["name", errorOf(ResourceName.parse(form.name))],
      [
        "template",
        form.template.trim() === ""
          ? Option.some("インスタンス テンプレートを先に作成してください")
          : Option.none,
      ],
      ["size", positiveIntError(form.size, 1000)],
      ...(form.baseInstanceName.trim() !== ""
        ? ([
            ["baseInstanceName", errorOf(ResourceName.parse(form.baseInstanceName.trim()))],
          ] as const)
        : []),
    ]);
  },

  toCommand(form: InstanceGroupCreateForm, projectId: string): string {
    const locationFlag =
      form.locationType === "region" ? flag("region", form.region) : flag("zone", form.zone);
    return [
      `gcloud compute instance-groups managed create ${quote(form.name)}`,
      flag("project", projectId),
      locationFlag,
      flag("template", form.template),
      flag("size", form.size.trim() || "2"),
      ...(form.baseInstanceName.trim() !== ""
        ? [flag("base-instance-name", form.baseInstanceName.trim())]
        : []),
    ].join(" ");
  },
} as const;

// --- ディスク ---

export type DiskCreateType = "pd-balanced" | "pd-ssd" | "pd-standard" | "hyperdisk-balanced";

export type DiskCreateForm = Readonly<{
  name: string;
  zone: Zone;
  type: DiskCreateType;
  size: string;
  sourceSnapshot: string;
}>;

export const DiskCreateForm = {
  create(zone: Zone): DiskCreateForm {
    return {
      name: "",
      zone,
      type: "pd-balanced",
      size: "100GB",
      sourceSnapshot: "",
    };
  },

  collectErrors(form: DiskCreateForm): FieldErrors<DiskCreateForm> {
    return collect<DiskCreateForm>([
      ["name", errorOf(ResourceName.parse(form.name))],
      ["size", errorOf(DiskSizeGb.parse(form.size))],
    ]);
  },

  toCommand(form: DiskCreateForm, projectId: string): string {
    return [
      `gcloud compute disks create ${quote(form.name)}`,
      flag("project", projectId),
      flag("zone", form.zone),
      flag("type", form.type),
      flag("size", form.size),
      ...(form.sourceSnapshot !== "" ? [flag("source-snapshot", form.sourceSnapshot)] : []),
    ].join(" ");
  },
} as const;

// --- スナップショット ---

export type SnapshotCreateForm = Readonly<{
  name: string;
  /** `zone/diskName` の形式 */
  sourceDisk: string;
}>;

const splitDiskRef = (ref: string): Readonly<{ zone: string; name: string }> => {
  const idx = ref.indexOf("/");
  if (idx === -1) return { zone: "", name: ref };
  return { zone: ref.slice(0, idx), name: ref.slice(idx + 1) };
};

export const SnapshotCreateForm = {
  create(sourceDisk: string): SnapshotCreateForm {
    return { name: "", sourceDisk };
  },

  collectErrors(form: SnapshotCreateForm): FieldErrors<SnapshotCreateForm> {
    return collect<SnapshotCreateForm>([
      ["name", errorOf(ResourceName.parse(form.name))],
      [
        "sourceDisk",
        form.sourceDisk.trim() === ""
          ? Option.some("ソース ディスクを先に作成してください")
          : Option.none,
      ],
    ]);
  },

  toCommand(form: SnapshotCreateForm, projectId: string): string {
    const ref = splitDiskRef(form.sourceDisk);
    return [
      `gcloud compute snapshots create ${quote(form.name)}`,
      flag("project", projectId),
      flag("source-disk", ref.name),
      ...(ref.zone !== "" ? [flag("source-disk-zone", ref.zone)] : []),
    ].join(" ");
  },
} as const;

// --- カスタム イメージ ---

export type ImageSourceKind = "disk" | "snapshot";

export type ImageCreateForm = Readonly<{
  name: string;
  sourceKind: ImageSourceKind;
  /** `zone/diskName` の形式 */
  sourceDisk: string;
  sourceSnapshot: string;
  family: string;
}>;

export const ImageCreateForm = {
  create(seed: Readonly<{ sourceDisk: string; sourceSnapshot: string }>): ImageCreateForm {
    return {
      name: "",
      sourceKind: seed.sourceSnapshot !== "" ? "snapshot" : "disk",
      sourceDisk: seed.sourceDisk,
      sourceSnapshot: seed.sourceSnapshot,
      family: "",
    };
  },

  collectErrors(form: ImageCreateForm): FieldErrors<ImageCreateForm> {
    return collect<ImageCreateForm>([
      ["name", errorOf(ResourceName.parse(form.name))],
      ...(form.sourceKind === "disk"
        ? ([
            [
              "sourceDisk",
              form.sourceDisk.trim() === ""
                ? Option.some("ソース ディスクを選んでください")
                : Option.none,
            ],
          ] as const)
        : ([
            [
              "sourceSnapshot",
              form.sourceSnapshot.trim() === ""
                ? Option.some("ソース スナップショットを選んでください")
                : Option.none,
            ],
          ] as const)),
      ...(form.family.trim() !== ""
        ? ([["family", errorOf(ResourceName.parse(form.family.trim()))]] as const)
        : []),
    ]);
  },

  toCommand(form: ImageCreateForm, projectId: string): string {
    const sourceFlags =
      form.sourceKind === "disk"
        ? (() => {
            const ref = splitDiskRef(form.sourceDisk);
            return [
              flag("source-disk", ref.name),
              ...(ref.zone !== "" ? [flag("source-disk-zone", ref.zone)] : []),
            ];
          })()
        : [flag("source-snapshot", form.sourceSnapshot)];
    return [
      `gcloud compute images create ${quote(form.name)}`,
      flag("project", projectId),
      ...sourceFlags,
      ...(form.family.trim() !== "" ? [flag("family", form.family.trim())] : []),
    ].join(" ");
  },
} as const;

// --- Cloud Marketplace のデプロイ ---

/** 複数の API をまとめて有効にする 1 行（Marketplace の「有効にする」）。 */
export const enableApisCommand = (apis: readonly ApiName[], projectId: string): string =>
  `gcloud services enable ${apis.join(" ")} ${flag("project", projectId)}`;

/** Marketplace のデプロイ設定（Click to Deploy のフォーム）。 */
export type MarketplaceDeployForm = Readonly<{
  /** デプロイ名。VM は `{名前}-vm`、ルールは `{名前}-tcp-80` になる */
  name: string;
  zone: Zone;
  machineType: MachineTypeName;
  /** VM を動かす（デプロイを実行する）サービスアカウントのメール */
  serviceAccount: string;
  http: boolean;
  https: boolean;
}>;

export const MarketplaceDeployForm = {
  /** 既定値（デプロイ名 lamp-1・e2-small・HTTP と HTTPS を許可）。 */
  create(seed: Readonly<{ zone: Zone; serviceAccount: string }>): MarketplaceDeployForm {
    return {
      name: "lamp-1",
      zone: seed.zone,
      machineType: "e2-small",
      serviceAccount: seed.serviceAccount,
      http: true,
      https: true,
    };
  },

  collectErrors(form: MarketplaceDeployForm): FieldErrors<MarketplaceDeployForm> {
    return collect<MarketplaceDeployForm>([["name", errorOf(ResourceName.parse(form.name))]]);
  },

  /**
   * 同等のコマンドライン。デプロイメントの置き場はゾーンのリージョン。
   *
   * @param source 製品のブループリントの置き場（`--gcs-source`）
   */
  toCommand(form: MarketplaceDeployForm, projectId: string, source: string): string {
    const location = Zone.region(form.zone);
    const inputs = [
      `zone=${form.zone}`,
      `machine_type=${form.machineType}`,
      `enable_tcp_80=${form.http}`,
      `enable_tcp_443=${form.https}`,
    ].join(",");
    return [
      `gcloud infra-manager deployments apply ${quote(`projects/${projectId}/locations/${location}/deployments/${form.name}`)}`,
      flag("project", projectId),
      flag("service-account", `projects/${projectId}/serviceAccounts/${form.serviceAccount}`),
      flag("gcs-source", source),
      flag("input-values", inputs),
    ].join(" ");
  },
} as const;
