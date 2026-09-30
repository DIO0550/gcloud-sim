import type { World } from "@/engine/domains/world";
import { SchemaVersion, Snapshot } from "@/engine/snapshot";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

/** 保存の失敗（E-010）。容量超過・プライベートモード・localStorage 無し。 */
export type StorageFailure = Readonly<{ reason: string }>;

/** 読み込みの失敗。壊れた JSON や未対応の版はここで捨て、初期状態から始める側に知らせる。 */
export type LoadFailure = Readonly<{ reason: string }>;

/** 保存先のキー。版を含めるので、版を上げると古いキーは読まれずに残る（UC-005）。 */
export const StorageKey = `gcloud-sim:world:v${SchemaVersion}`;

/** localStorage の一般的な上限（設計書 11.1）。使用量バーの分母に使う。 */
export const StorageCapacityBytes = 5 * 1024 * 1024;

const storage = (): Result<Storage, StorageFailure> => {
  try {
    const value = globalThis.localStorage;
    return value === undefined
      ? Result.err({ reason: "localStorage is not available" })
      : Result.ok(value);
  } catch (error) {
    return Result.err({ reason: error instanceof Error ? error.message : String(error) });
  }
};

/** localStorage への World の読み書き。UI の feature はこれだけを通す。 */
export const WorldStorage = {
  /**
   * 保存済みの World を読む。
   *
   * @returns 保存があればその World。無ければ `none`。壊れていれば理由
   */
  load(): Result<Option<World>, LoadFailure> {
    const store = storage();
    if (!Result.isOk(store)) return Result.err(store.error);
    const raw = store.value.getItem(StorageKey);
    if (raw === null) return Result.ok(Option.none);
    try {
      const parsed: unknown = JSON.parse(raw);
      const world = Snapshot.fromUnknown(parsed);
      return Result.isOk(world)
        ? Result.ok(Option.some(world.value))
        : Result.err({ reason: Snapshot.describeFailure(world.error) });
    } catch (error) {
      return Result.err({ reason: error instanceof Error ? error.message : String(error) });
    }
  },

  /**
   * World を保存する（UC-005 自動保存）。
   *
   * @param world 保存する World
   * @param now 保存時刻
   * @returns 書けなければ理由（E-010）
   */
  save(world: World, now: string): Result<number, StorageFailure> {
    const store = storage();
    if (!Result.isOk(store)) return store;
    const json = JSON.stringify(Snapshot.create(world, now));
    try {
      store.value.setItem(StorageKey, json);
      return Result.ok(json.length);
    } catch (error) {
      return Result.err({ reason: error instanceof Error ? error.message : String(error) });
    }
  },

  clear(): void {
    const store = storage();
    if (Result.isOk(store)) store.value.removeItem(StorageKey);
  },
} as const;
