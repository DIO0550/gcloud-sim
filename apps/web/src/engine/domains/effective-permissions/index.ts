import { type IamMember, IamPolicy, type RoleName } from "@/engine/domains/iam-policy";
import type { PolicyTarget } from "@/engine/domains/resource-hierarchy";
import { RoleCatalog } from "@/engine/domains/role-catalog";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

/** 主体に効いている 1 つのロールと、それがどのリソースに付いているか（継承元）。 */
export type EffectiveGrant = Readonly<{
  role: RoleName;
  grantedAt: PolicyTarget;
}>;

/**
 * 主体がある対象で持つ有効権限（設計書 4「有効権限」、DJ-006）。
 * 継承は評価時に階層を遡って合成し、ポリシーにはコピーしない。
 */
export type EffectivePermissions = Readonly<{
  subject: IamMember;
  target: PolicyTarget;
  grants: readonly EffectiveGrant[];
  permissions: ReadonlySet<string>;
}>;

/** 権限が足りないときの失敗。E-006 のメッセージとヒントに使う。 */
export type MissingPermission = Readonly<{
  permission: string;
  target: PolicyTarget;
  /** その権限を含むロール。ヒントに出す */
  rolesIncluding: readonly RoleName[];
}>;

export const EffectivePermissions = {
  /**
   * 対象から組織まで遡り、主体を含むバインディングをすべて集めて権限に展開する。
   *
   * @param world 元
   * @param subject 主体（`user:` / `serviceAccount:` 形式）
   * @param target 権限を評価するリソース
   * @returns 継承元付きのロールと、カタログで展開した権限の集合
   */
  resolve(world: World, subject: IamMember, target: PolicyTarget): EffectivePermissions {
    const grants = World.ancestry(world, target).flatMap((ancestor) => {
      const policy = World.policyOf(world, ancestor);
      const roles = Option.isSome(policy) ? IamPolicy.rolesOf(policy.value, subject) : [];
      return roles.map((role): EffectiveGrant => ({ role, grantedAt: ancestor }));
    });
    const permissions = new Set(
      grants.flatMap((grant) => {
        const role = RoleCatalog.find(grant.role);
        return Option.isSome(role) ? role.value.includedPermissions : [];
      }),
    );
    return { subject, target, grants, permissions };
  },

  /**
   * 権限を持っているか。カタログに無い権限は判定せず許可に倒す（DJ-006）。
   *
   * @param effective 評価済みの有効権限
   * @param permission 必要な権限
   * @returns 持っていれば真。カタログ外の権限も真
   */
  has(effective: EffectivePermissions, permission: string): boolean {
    return !RoleCatalog.isKnownPermission(permission) || effective.permissions.has(permission);
  },

  /**
   * 必要な権限をすべて持っているか確かめる。
   *
   * @param effective 評価済みの有効権限
   * @param required 必要な権限
   * @returns すべて持っていれば `ok`。足りなければ最初に足りなかった権限
   */
  require(
    effective: EffectivePermissions,
    required: readonly string[],
  ): Result<EffectivePermissions, MissingPermission> {
    const missing = required.find((permission) => !EffectivePermissions.has(effective, permission));
    if (missing === undefined) return Result.ok(effective);
    return Result.err({
      permission: missing,
      target: effective.target,
      rolesIncluding: RoleCatalog.rolesIncluding(missing),
    });
  },
} as const;
