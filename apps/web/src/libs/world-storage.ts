import type { World } from "@/engine/domains/world";
import { type ImportFailure, Snapshot } from "@/engine/snapshot";
import { describeError, parseJson } from "@/libs/json";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

/** 保存の失敗（E-010）。容量超過・プライベートモード・localStorage 無し。 */
export type SaveFailure = Readonly<{ reason: string }>;

/**
 * 読み込みの失敗。壊れた JSON は `malformed`、版違いと不変条件違反は Snapshot の判定をそのまま持つ。
 * 中身を `backupKey` に退避できていれば、初期状態で上書きしても失われない（退避先にも書けなければ `none`）。
 */
export type LoadFailure = Readonly<{ failure: ImportFailure; backupKey: Option<string> }>;

/**
 * 保存先のキー。版はキーではなく中身（`schemaVersion`）が持つので、版を上げても同じキーから読み、
 * 読めなければ退避してから初期状態で上書きする（UC-005）。
 */
export const StorageKey = "gcloud-sim:world";

/** 読めなかった保存の退避先。 */
const BackupKey = "gcloud-sim:world:unreadable";

/** localStorage の一般的な上限（設計書 11.1）。使用量バーの分母に使う。 */
export const StorageCapacityBytes = 5 * 1024 * 1024;

const storage = (): Result<Storage, SaveFailure> => {
  try {
    const value = globalThis.localStorage;
    return value === undefined
      ? Result.err({ reason: "localStorage is not available" })
      : Result.ok(value);
  } catch (error) {
    return Result.err({ reason: describeError(error) });
  }
};

const backUp = (store: Storage, raw: string): Option<string> => {
  try {
    store.setItem(BackupKey, raw);
    return Option.some(BackupKey);
  } catch {
    return Option.none;
  }
};

/** localStorage への World の読み書き。UI の feature はこれだけを通す。 */
export const WorldStorage = {
  /**
   * 保存済みの World を読む。
   *
   * @returns 保存があればその World。無ければ `none`。読めなければ退避してから理由
   */
  load(): Result<Option<World>, LoadFailure> {
    const store = storage();
    if (!Result.isOk(store)) return Result.ok(Option.none);
    const raw = store.value.getItem(StorageKey);
    if (raw === null) return Result.ok(Option.none);
    const parsed = Result.mapErr(
      parseJson(raw),
      (reason): ImportFailure => ({ kind: "malformed", reason }),
    );
    const world = Result.flatMap(parsed, Snapshot.fromUnknown);
    if (Result.isOk(world)) return Result.ok(Option.some(world.value));
    return Result.err({ failure: world.error, backupKey: backUp(store.value, raw) });
  },

  /**
   * World を保存する（UC-005 自動保存）。
   *
   * @param world 保存する World
   * @param now 保存時刻
   * @returns 書いたバイト数。書けなければ理由（E-010）
   */
  save(world: World, now: string): Result<number, SaveFailure> {
    const store = storage();
    if (!Result.isOk(store)) return store;
    const json = JSON.stringify(Snapshot.create(world, now));
    try {
      store.value.setItem(StorageKey, json);
      return Result.ok(new TextEncoder().encode(json).byteLength);
    } catch (error) {
      return Result.err({ reason: describeError(error) });
    }
  },
} as const;
