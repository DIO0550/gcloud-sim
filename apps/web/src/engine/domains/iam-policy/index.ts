import type { JsonRecord } from "@/types/Json";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

/** IAM のロール名。事前定義ロールかプロジェクトのカスタムロール。 */
export type RoleName = `roles/${string}` | `projects/${string}/roles/${string}`;

/** バインディングのメンバー。プレフィックスで主体の種類を表す（設計書 6.2 IamBinding）。 */
export type IamMember =
  | `user:${string}`
  | `serviceAccount:${string}`
  | `group:${string}`
  | `domain:${string}`
  | `principal://iam.googleapis.com/${string}`
  | `principalSet://iam.googleapis.com/${string}`
  | "allUsers"
  | "allAuthenticatedUsers";

export type IamBinding = Readonly<{
  role: RoleName;
  members: readonly IamMember[];
}>;

/** 1 つのリソースに付いたポリシー。継承分は含まない（評価時に階層を遡る）。 */
export type IamPolicy = Readonly<{
  bindings: readonly IamBinding[];
}>;

const MemberPrefixes = ["user:", "serviceAccount:", "group:", "domain:"] as const;

export const IamMember = {
  /**
   * ユーザーが打ったメンバーの綴りを検証する。
   *
   * @param value `user:alice@example.com` のような綴り
   * @returns プレフィックスが正しく本体が空でなければそのメンバー。それ以外は `err`（E-009）
   */
  parse(value: string): Result<IamMember, string> {
    if (value === "allUsers" || value === "allAuthenticatedUsers") return Result.ok(value);
    if (
      /^principal(?:Set)?:\/\/iam\.googleapis\.com\/(?:projects\/\d+\/locations\/global\/workloadIdentityPools\/[a-z0-9-]{4,32}|locations\/global\/workforcePools\/[a-z][a-z0-9-]{5,62})\/(?:subject\/[^\s/]+|group\/[^\s/]+|attribute\.[a-zA-Z0-9_]+\/[^\s/]+|\*)$/.test(
        value,
      )
    ) {
      const isSet = value.startsWith("principalSet:");
      if (isSet === value.includes("/subject/")) {
        return Result.err(
          "Use principal:// for a subject and principalSet:// for pool/group/attribute sets.",
        );
      }
      return Result.ok(value as IamMember);
    }
    const prefix = MemberPrefixes.find((p) => value.startsWith(p));
    const hasBody = prefix !== undefined && value.length > prefix.length;
    if (!hasBody) {
      return Result.err(
        `Invalid value for [member]: ${value}. Member must be of the form user:EMAIL, serviceAccount:EMAIL, group:EMAIL, domain:DOMAIN, allUsers or allAuthenticatedUsers.`,
      );
    }
    return Result.ok(value as IamMember);
  },

  /**
   * メンバーがある主体を指しているか。`allUsers` / `allAuthenticatedUsers` は誰にでも一致する。
   * グループ・ドメインのメンバーシップは持っていないので、その 2 種は完全一致だけを見る。
   *
   * @param member バインディングに書かれたメンバー
   * @param subject 判定したい主体（`user:` / `serviceAccount:` 形式）
   * @returns 一致すれば真
   */
  covers(member: IamMember, subject: IamMember): boolean {
    if (member === "allUsers" || member === "allAuthenticatedUsers") return true;
    if (
      member.startsWith("principalSet://") &&
      member.endsWith("/*") &&
      subject.startsWith("principal://")
    ) {
      return subject.replace("principal://", "principalSet://").startsWith(member.slice(0, -1));
    }
    return member === subject;
  },
} as const;

export const RoleName = {
  /**
   * ロール名の形を検証する。カタログにあるかはここでは見ない。
   *
   * @param value `roles/viewer` のような綴り
   * @returns 形が合えばロール名。それ以外は `none`
   */
  parse(value: string): Option<RoleName> {
    const isPredefined = /^roles\/[A-Za-z0-9.]+$/.test(value);
    const isCustom = /^projects\/[a-z][a-z0-9-]*\/roles\/[A-Za-z0-9_.]+$/.test(value);
    return isPredefined || isCustom ? Option.some(value as RoleName) : Option.none;
  },

  /** プロジェクトのカスタムロールか（カタログには無いが受け付ける）。 */
  isCustom(name: RoleName): boolean {
    return name.startsWith("projects/");
  },
} as const;

const Empty: IamPolicy = Object.freeze({ bindings: [] });

export const IamPolicy = {
  Empty,

  /**
   * バインディングの並びからポリシーを作る。同じロールは 1 つに統合する。
   *
   * @param bindings ロールとメンバーの組
   * @returns ロールごとにメンバーを合わせたポリシー
   */
  create(bindings: readonly IamBinding[]): IamPolicy {
    return bindings.reduce<IamPolicy>(
      (policy, binding) =>
        binding.members.reduce(
          (acc, member) => IamPolicy.addBinding(acc, binding.role, member),
          policy,
        ),
      Empty,
    );
  },

  /**
   * メンバーをロールに加える。既に同じロールがあればそのメンバーに追記する。
   *
   * @param policy 元のポリシー
   * @param role 付けるロール
   * @param member 加えるメンバー
   * @returns 加えた後のポリシー。既に入っていれば同じ内容
   */
  addBinding(policy: IamPolicy, role: RoleName, member: IamMember): IamPolicy {
    const existing = policy.bindings.find((b) => b.role === role);
    if (existing === undefined) {
      return { bindings: [...policy.bindings, { role, members: [member] }] };
    }
    if (existing.members.includes(member)) return policy;
    return {
      bindings: policy.bindings.map((b) =>
        b.role === role ? { role, members: [...b.members, member] } : b,
      ),
    };
  },

  /**
   * メンバーをロールから外す。メンバーが空になったバインディングは消す。
   *
   * @param policy 元のポリシー
   * @param role 外すロール
   * @param member 外すメンバー
   * @returns 外した後のポリシー。そのバインディングが無ければ `none`
   */
  removeBinding(policy: IamPolicy, role: RoleName, member: IamMember): Option<IamPolicy> {
    if (!IamPolicy.hasBinding(policy, role, member)) return Option.none;
    const bindings = policy.bindings
      .map((b) => (b.role === role ? { role, members: b.members.filter((m) => m !== member) } : b))
      .filter((b) => b.members.length > 0);
    return Option.some({ bindings });
  },

  /**
   * そのロールにそのメンバーが直接入っているか。
   *
   * @param policy 見るポリシー
   * @param role ロール
   * @param member メンバー
   * @returns 入っていれば真
   */
  hasBinding(policy: IamPolicy, role: RoleName, member: IamMember): boolean {
    return IamPolicy.membersOf(policy, role).includes(member);
  },

  /**
   * 主体に効いているロール。`allUsers` 等の全員向けバインディングも含める。
   *
   * @param policy 見るポリシー
   * @param subject 主体
   * @returns その主体を含むバインディングのロール
   */
  rolesOf(policy: IamPolicy, subject: IamMember): readonly RoleName[] {
    return policy.bindings
      .filter((b) => b.members.some((member) => IamMember.covers(member, subject)))
      .map((b) => b.role);
  },

  /**
   * そのロールを直接持つメンバー。
   *
   * @param policy 見るポリシー
   * @param role ロール
   * @returns バインディングのメンバー。無ければ空
   */
  membersOf(policy: IamPolicy, role: RoleName): readonly IamMember[] {
    return policy.bindings.find((b) => b.role === role)?.members ?? [];
  },

  /** `get-iam-policy` / `add-iam-policy-binding` が出す API 表現。 */
  toRecord(policy: IamPolicy): JsonRecord {
    return {
      bindings: policy.bindings.map((b) => ({ members: [...b.members], role: b.role })),
      etag: "BwYEp2z-Xd0=",
      version: 1,
    };
  },
} as const;
