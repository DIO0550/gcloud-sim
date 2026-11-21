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
    const rangeFlag = form.direction === Directions.Egress ? "destination-ranges" : "source-ranges";
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
      ...(list(form.sourceRanges) === "" ? [] : [flag(rangeFlag, list(form.sourceRanges))]),
      ...(list(form.targetTags) === "" ? [] : [flag("target-tags", list(form.targetTags))]),
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
