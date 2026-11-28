import {
  Directions,
  type FirewallAction,
  FirewallActions,
  FirewallRule,
  type Network,
  ProtocolRule,
  ResourceName,
  type Subnet,
  SubnetModes,
} from "@/engine/domains/compute";
import { Ipv4 } from "@/engine/domains/gke-control-plane";
import {
  collect,
  errorOf,
  type FieldErrors,
  type FirewallProtocolsMode,
  type FirewallSourceFilter,
  type FirewallTargetType,
  flag,
  integerOf,
  quote,
} from "@/features/simulator/features/console/domains/equivalent-command";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";
import { StringEx } from "@/utils/StringEx";

/** VPC ネットワークのファイアウォール ポリシー適用順。 */
export type FirewallPolicyOrder = "BEFORE_CLASSIC_FIREWALL" | "AFTER_CLASSIC_FIREWALL";

/** 編集フォームの複数ステップ（1 コマンド = 1 ステップ）。 */
export type EditCommandStep = Readonly<{ line: string; note: string }>;

const splitList = (value: string): readonly string[] => StringEx.splitList(value);
const joinList = (values: readonly string[]): string => values.join(",");
const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

// --- ファイアウォール ルール編集 ---

export type FirewallEditForm = Readonly<{
  /** 編集対象の元のルール（差分判定用） */
  original: FirewallRule;
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

const inferTargetType = (rule: FirewallRule): FirewallTargetType => {
  if ((rule.targetServiceAccounts?.length ?? 0) > 0) return "service-accounts";
  if (rule.targetTags.length > 0) return "tags";
  return "all";
};

const inferSourceFilter = (rule: FirewallRule): FirewallSourceFilter => {
  if ((rule.sourceServiceAccounts?.length ?? 0) > 0) return "service-accounts";
  if ((rule.sourceTags?.length ?? 0) > 0) return "source-tags";
  return "ip-ranges";
};

export const FirewallEditForm = {
  fromRule(rule: FirewallRule): FirewallEditForm {
    const isAllow = rule.allowed.length > 0 || rule.denied.length === 0;
    const protocolList = isAllow ? rule.allowed : rule.denied;
    const isAll = protocolList.length === 1 && protocolList[0]?.protocol === "all";
    const ranges =
      rule.direction === Directions.Egress ? rule.destinationRanges : rule.sourceRanges;
    return {
      original: rule,
      priority: String(rule.priority),
      targetType: inferTargetType(rule),
      targetTags: rule.targetTags.join(", "),
      targetServiceAccounts: (rule.targetServiceAccounts ?? []).join(", "),
      sourceFilter: inferSourceFilter(rule),
      sourceRanges: ranges.join(", "),
      sourceTags: (rule.sourceTags ?? []).join(", "),
      sourceServiceAccounts: (rule.sourceServiceAccounts ?? []).join(", "),
      protocolsMode: isAll ? "all" : "specified",
      protocolsAndPorts: isAll ? "tcp:80" : protocolList.map(ProtocolRule.toText).join(", "),
      action: isAllow ? FirewallActions.Allow : FirewallActions.Deny,
      enableLogging: rule.logging ?? false,
      disabled: rule.disabled,
    };
  },

  collectErrors(form: FirewallEditForm): FieldErrors<FirewallEditForm> {
    const rules = form.protocolsMode === "all" ? ["all"] : splitList(form.protocolsAndPorts);
    const badRule = rules.map(ProtocolRule.parse).find((r) => !Result.isOk(r));
    const priority = Option.toResult(integerOf(form.priority), () => "整数にしてください。");
    const isEgress = form.original.direction === Directions.Egress;
    const usesIpRanges = isEgress || form.sourceFilter === "ip-ranges";
    const ranges = splitList(form.sourceRanges);
    const badRange = ranges.find((r) => !Option.isSome(Ipv4.range(r)));
    return collect<FirewallEditForm>([
      ["priority", errorOf(Result.flatMap(priority, FirewallRule.parsePriority))],
      [
        "targetServiceAccounts",
        form.targetType === "service-accounts" && splitList(form.targetServiceAccounts).length === 0
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
        !isEgress && form.sourceFilter === "source-tags" && splitList(form.sourceTags).length === 0
          ? Option.some("ソースタグを 1 つ以上入れてください。")
          : Option.none,
      ],
      [
        "sourceServiceAccounts",
        !isEgress &&
        form.sourceFilter === "service-accounts" &&
        splitList(form.sourceServiceAccounts).length === 0
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

  /** 元のルールから変わったフラグだけを並べる。 */
  changedFlags(form: FirewallEditForm): readonly string[] {
    const orig = form.original;
    const isEgress = orig.direction === Directions.Egress;
    const flags: string[] = [];

    if (form.priority !== String(orig.priority)) {
      flags.push(flag("priority", form.priority));
    }

    const nextTargetTags = form.targetType === "tags" ? splitList(form.targetTags) : [];
    const nextTargetSas =
      form.targetType === "service-accounts" ? splitList(form.targetServiceAccounts) : [];
    if (!sameList(nextTargetTags, orig.targetTags)) {
      flags.push(
        `--target-tags=${nextTargetTags.length === 0 ? '""' : quote(joinList(nextTargetTags))}`,
      );
    }
    if (!sameList(nextTargetSas, orig.targetServiceAccounts ?? [])) {
      flags.push(
        `--target-service-accounts=${nextTargetSas.length === 0 ? '""' : quote(joinList(nextTargetSas))}`,
      );
    }

    if (isEgress) {
      const nextDest = splitList(form.sourceRanges);
      if (!sameList(nextDest, orig.destinationRanges)) {
        flags.push(
          `--destination-ranges=${nextDest.length === 0 ? '""' : quote(joinList(nextDest))}`,
        );
      }
    } else {
      const nextSourceRanges =
        form.sourceFilter === "ip-ranges" ? splitList(form.sourceRanges) : [];
      const nextSourceTags = form.sourceFilter === "source-tags" ? splitList(form.sourceTags) : [];
      const nextSourceSas =
        form.sourceFilter === "service-accounts" ? splitList(form.sourceServiceAccounts) : [];
      if (!sameList(nextSourceRanges, orig.sourceRanges)) {
        flags.push(
          `--source-ranges=${nextSourceRanges.length === 0 ? '""' : quote(joinList(nextSourceRanges))}`,
        );
      }
      if (!sameList(nextSourceTags, orig.sourceTags ?? [])) {
        flags.push(
          `--source-tags=${nextSourceTags.length === 0 ? '""' : quote(joinList(nextSourceTags))}`,
        );
      }
      if (!sameList(nextSourceSas, orig.sourceServiceAccounts ?? [])) {
        flags.push(
          `--source-service-accounts=${nextSourceSas.length === 0 ? '""' : quote(joinList(nextSourceSas))}`,
        );
      }
    }

    const origAction =
      orig.allowed.length > 0 || orig.denied.length === 0
        ? FirewallActions.Allow
        : FirewallActions.Deny;
    const origRules = (origAction === FirewallActions.Allow ? orig.allowed : orig.denied).map(
      ProtocolRule.toText,
    );
    const nextRules = form.protocolsMode === "all" ? ["all"] : splitList(form.protocolsAndPorts);
    if (form.action !== origAction || !sameList(nextRules, origRules)) {
      flags.push(
        flag(form.action === FirewallActions.Allow ? "allow" : "deny", joinList(nextRules)),
      );
    }

    if (form.enableLogging !== (orig.logging ?? false)) {
      flags.push(form.enableLogging ? "--enable-logging" : "--no-enable-logging");
    }
    if (form.disabled !== orig.disabled) {
      flags.push(form.disabled ? "--disabled" : "--no-disabled");
    }

    return flags;
  },

  hasChanges(form: FirewallEditForm): boolean {
    return FirewallEditForm.changedFlags(form).length > 0;
  },

  toCommand(form: FirewallEditForm, projectId: string): string {
    const changed = FirewallEditForm.changedFlags(form);
    const effective = changed.length > 0 ? changed : [flag("priority", form.priority)];
    return [
      "gcloud compute firewall-rules update",
      quote(form.original.name),
      flag("project", projectId),
      ...effective,
    ].join(" ");
  },
} as const;

// --- VPC ネットワーク編集 ---

export type VpcNetworkEditForm = Readonly<{
  original: Network;
  /** 自動モードのネットワークをカスタムモードへ切り替えるか（一方向） */
  switchToCustom: boolean;
  firewallPolicyOrder: FirewallPolicyOrder;
}>;

export const VpcNetworkEditForm = {
  fromNetwork(network: Network): VpcNetworkEditForm {
    return {
      original: network,
      switchToCustom: false,
      firewallPolicyOrder: network.firewallPolicyOrder ?? "AFTER_CLASSIC_FIREWALL",
    };
  },

  collectErrors(_form: VpcNetworkEditForm): FieldErrors<VpcNetworkEditForm> {
    return {};
  },

  toSteps(form: VpcNetworkEditForm, projectId: string): readonly EditCommandStep[] {
    const steps: EditCommandStep[] = [];
    const base = `gcloud compute networks update ${quote(form.original.name)} ${flag("project", projectId)}`;
    if (form.original.subnetMode === SubnetModes.Auto && form.switchToCustom) {
      steps.push({
        line: `${base} --switch-to-custom-subnet-mode`,
        note: `VPC ネットワークをカスタムモードへ切り替え (${form.original.name})`,
      });
    }
    const origOrder = form.original.firewallPolicyOrder ?? "AFTER_CLASSIC_FIREWALL";
    if (form.firewallPolicyOrder !== origOrder) {
      steps.push({
        line: `${base} ${flag("network-firewall-policy-enforcement-order", form.firewallPolicyOrder)}`,
        note: `VPC ネットワークのポリシー評価順を更新 (${form.original.name})`,
      });
    }
    return steps;
  },

  hasChanges(form: VpcNetworkEditForm, projectId: string): boolean {
    return VpcNetworkEditForm.toSteps(form, projectId).length > 0;
  },

  toCommand(form: VpcNetworkEditForm, projectId: string): string {
    const steps = VpcNetworkEditForm.toSteps(form, projectId);
    if (steps.length > 0) return steps.map((s) => s.line).join("\n");
    return `gcloud compute networks update ${quote(form.original.name)} ${flag("project", projectId)} ${flag("network-firewall-policy-enforcement-order", form.firewallPolicyOrder)}`;
  },
} as const;

// --- サブネット編集 ---

export type SubnetEditForm = Readonly<{
  original: Subnet;
  privateIpGoogleAccess: boolean;
  enableFlowLogs: boolean;
}>;

export const SubnetEditForm = {
  fromSubnet(subnet: Subnet): SubnetEditForm {
    return {
      original: subnet,
      privateIpGoogleAccess: subnet.privateIpGoogleAccess,
      enableFlowLogs: subnet.flowLogs ?? false,
    };
  },

  collectErrors(_form: SubnetEditForm): FieldErrors<SubnetEditForm> {
    return {};
  },

  toCommand(form: SubnetEditForm, projectId: string): string {
    return [
      "gcloud compute networks subnets update",
      quote(form.original.name),
      flag("region", form.original.region),
      flag("project", projectId),
      form.privateIpGoogleAccess
        ? "--enable-private-ip-google-access"
        : "--no-enable-private-ip-google-access",
      form.enableFlowLogs ? "--enable-flow-logs" : "--no-enable-flow-logs",
    ].join(" ");
  },
} as const;

// --- 静的 IP アドレス ---

export type AddressCreateForm = Readonly<{
  name: string;
  scope: "regional" | "global";
  region: string;
  addressType: "EXTERNAL" | "INTERNAL";
  networkTier: "PREMIUM" | "STANDARD";
  subnet: string;
}>;

export const AddressCreateForm = {
  create(region: string): AddressCreateForm {
    return {
      name: "",
      scope: "regional",
      region,
      addressType: "EXTERNAL",
      networkTier: "PREMIUM",
      subnet: "",
    };
  },

  collectErrors(form: AddressCreateForm): FieldErrors<AddressCreateForm> {
    return collect<AddressCreateForm>([
      ["name", errorOf(ResourceName.parse(form.name))],
      [
        "subnet",
        form.addressType === "INTERNAL" && form.subnet.trim() === ""
          ? Option.some("内部静的 IP を予約するにはサブネットを指定してください。")
          : Option.none,
      ],
    ]);
  },

  toCommand(form: AddressCreateForm, projectId: string): string {
    const isGlobal = form.scope === "global" && form.addressType === "EXTERNAL";
    const parts = [
      "gcloud compute addresses create",
      quote(form.name),
      flag("project", projectId),
      isGlobal ? "--global" : flag("region", form.region),
      flag("address-type", form.addressType),
      ...(form.addressType === "EXTERNAL" ? [flag("network-tier", form.networkTier)] : []),
      ...(form.addressType === "INTERNAL" && form.subnet.trim() !== ""
        ? [flag("subnet", form.subnet.trim())]
        : []),
    ];
    return parts.join(" ");
  },
} as const;

export const deleteAddressCommand = (
  address: Readonly<{
    name: string;
    scope: Readonly<{ kind: "global" } | { kind: "region"; region: string }>;
  }>,
  projectId: string,
): string => {
  const scopeFlag =
    address.scope.kind === "global" ? "--global" : flag("region", address.scope.region);
  return `gcloud compute addresses delete ${quote(address.name)} ${scopeFlag} ${flag("project", projectId)} --quiet`;
};

// --- VPC ネットワーク ピアリング ---

export type PeeringCreateForm = Readonly<{
  name: string;
  network: string;
  peerProject: string;
  peerNetwork: string;
  exportCustomRoutes: boolean;
  importCustomRoutes: boolean;
}>;

export const PeeringCreateForm = {
  create(
    seed: Readonly<{ network: string; peerProject: string; peerNetwork: string }>,
  ): PeeringCreateForm {
    return {
      name: "",
      network: seed.network,
      peerProject: seed.peerProject,
      peerNetwork: seed.peerNetwork,
      exportCustomRoutes: false,
      importCustomRoutes: false,
    };
  },

  collectErrors(form: PeeringCreateForm): FieldErrors<PeeringCreateForm> {
    return collect<PeeringCreateForm>([
      ["name", errorOf(ResourceName.parse(form.name))],
      [
        "network",
        form.network.trim() === ""
          ? Option.some("VPC ネットワークを選んでください。")
          : Option.none,
      ],
      [
        "peerNetwork",
        form.peerNetwork.trim() === ""
          ? Option.some("ピアリング先の VPC ネットワークを入れてください。")
          : Option.none,
      ],
    ]);
  },

  toCommand(form: PeeringCreateForm, projectId: string): string {
    const parts = [
      "gcloud compute networks peerings create",
      quote(form.name),
      flag("project", projectId),
      flag("network", form.network),
      flag("peer-network", form.peerNetwork.trim()),
      ...(form.peerProject.trim() !== "" && form.peerProject.trim() !== projectId
        ? [flag("peer-project", form.peerProject.trim())]
        : []),
      ...(form.exportCustomRoutes ? ["--export-custom-routes"] : []),
      ...(form.importCustomRoutes ? ["--import-custom-routes"] : []),
    ];
    return parts.join(" ");
  },
} as const;

export const deletePeeringCommand = (
  peering: Readonly<{ name: string; network: string }>,
  projectId: string,
): string =>
  `gcloud compute networks peerings delete ${quote(peering.name)} ${flag("network", peering.network)} ${flag("project", projectId)} --quiet`;
