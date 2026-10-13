import { Mission } from "@/engine/__tests__/fixture-missions";
import type { World } from "@/engine/domains/world";
import { Snapshot as PublicSnapshot } from "@/engine/snapshot";
import { Result } from "@/utils/Result";

export * from "@/engine/snapshot";

/**
 * 実際のSnapshot検証を通した後、内部モデルの継続テスト用に旧演習の状態だけ戻す。
 * 公開importは廃止した演習を落とす。その動作はofficial-cli.test.tsで別途検証する。
 */
export const Snapshot = {
  ...PublicSnapshot,
  fromUnknown(value: unknown) {
    const decoded = PublicSnapshot.fromUnknown(value);
    if (!decoded.ok || typeof value !== "object" || value === null || !("world" in value)) {
      return decoded;
    }
    const source = value.world as Partial<World> | undefined;
    if (!source || !Array.isArray(source.missions)) {
      return decoded;
    }
    const records = source.missions.filter((progress) => Mission.find(progress.id).some);
    const ids = new Set(records.map((progress) => progress.id));
    return Result.ok({
      ...decoded.value,
      aceSupport: source.aceSupport ?? decoded.value.aceSupport,
      missions: [...decoded.value.missions.filter((progress) => !ids.has(progress.id)), ...records],
    });
  },
} as const;
