import { World } from "@/engine/domains/world";
import { Mission } from "@/engine/missions";
import type { JsonValue } from "@/types/Json";
import { Result } from "@/utils/Result";

/** Snapshot の互換性のためのバージョン。World の形を変えたら上げてマイグレーションを足す（DJ-007）。 */
export const SchemaVersion = 1;

/** export / import で扱う JSON の形（UC-005）。 */
export type Snapshot = Readonly<{
  schemaVersion: typeof SchemaVersion;
  exportedAt: string;
  world: World;
}>;

/** import の失敗（E-011）。既存の状態は変えない。 */
export type ImportFailure =
  | Readonly<{ kind: "malformed"; reason: string }>
  | Readonly<{ kind: "unsupportedVersion"; version: string }>
  | Readonly<{ kind: "invariant"; reason: string }>;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const RequiredArrays = [
  "folders",
  "projects",
  "billingAccounts",
  "serviceAccounts",
  "instances",
  "networks",
  "subnets",
  "firewallRules",
  "snapshots",
  "buckets",
  "clusters",
  "runServices",
  "operations",
  "missions",
] as const;

const RequiredObjects = ["organization", "config", "session"] as const;

/**
 * 形の検査。各フィールドの中身までは型で保証できないので、構造（必須キーと配列・オブジェクトの別）を
 * 見てから `World.validate` の不変条件に通す。
 */
const checkShape = (value: Readonly<Record<string, unknown>>): Result<World, ImportFailure> => {
  const missingArray = RequiredArrays.find((key) => !Array.isArray(value[key]));
  if (missingArray !== undefined)
    return Result.err({ kind: "malformed", reason: `world.${missingArray} must be an array` });
  const missingObject = RequiredObjects.find((key) => !isRecord(value[key]));
  if (missingObject !== undefined)
    return Result.err({ kind: "malformed", reason: `world.${missingObject} must be an object` });
  if (typeof value.sequence !== "number")
    return Result.err({ kind: "malformed", reason: "world.sequence must be a number" });
  const config = value.config as Readonly<Record<string, unknown>>;
  if (!isRecord(config.configurations) || typeof config.activeConfiguration !== "string") {
    return Result.err({
      kind: "malformed",
      reason: "world.config must have configurations and activeConfiguration",
    });
  }
  const session = value.session as Readonly<Record<string, unknown>>;
  if (typeof session.principal !== "string" || !Array.isArray(session.accounts)) {
    return Result.err({
      kind: "malformed",
      reason: "world.session must have principal and accounts",
    });
  }
  // 形の検査を通ったものを World として扱う（`as` は実行時に検査した戻り値のこの 1 箇所）。
  return Result.ok(value as unknown as World);
};

export const Snapshot = {
  /**
   * 今の World から Snapshot を作る。
   *
   * @param world 書き出す World
   * @param now 書き出し時刻
   * @returns 現行 schemaVersion の Snapshot
   */
  create(world: World, now: string): Snapshot {
    return { schemaVersion: SchemaVersion, exportedAt: now, world };
  },

  /**
   * ファイル名 `gcloud-sim-snapshot-{YYYYMMDD-HHmm}.json`（UC-005）。
   *
   * @param now 書き出し時刻（ISO）
   * @returns ファイル名
   */
  fileName(now: string): string {
    const d = new Date(now);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `gcloud-sim-snapshot-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
  },

  /**
   * JSON を解釈した値から World を取り出す（UC-005 Import）。
   * schemaVersion を見てから形を検査し、不変条件に通す。旧バージョンはまだ無い。
   *
   * @param value `JSON.parse` の結果
   * @returns 取り込める World。不正なら理由（E-011）
   */
  fromUnknown(value: JsonValue | unknown): Result<World, ImportFailure> {
    if (!isRecord(value))
      return Result.err({ kind: "malformed", reason: "snapshot must be a JSON object" });
    const version = value.schemaVersion;
    if (version !== SchemaVersion)
      return Result.err({ kind: "unsupportedVersion", version: String(version) });
    if (!isRecord(value.world))
      return Result.err({ kind: "malformed", reason: "snapshot.world must be an object" });
    const shaped = checkShape(value.world);
    if (!Result.isOk(shaped)) return shaped;
    const validated = Result.mapErr(
      World.validate(shaped.value),
      (reason): ImportFailure => ({ kind: "invariant", reason }),
    );
    return Result.map(validated, Mission.syncProgress);
  },

  /** E-011 のダイアログに出す文言。 */
  describeFailure(failure: ImportFailure): string {
    switch (failure.kind) {
      case "malformed":
        return `JSON の形が不正です（${failure.reason}）。現在の状態は変更していません。`;
      case "unsupportedVersion":
        return `schemaVersion ${failure.version} は未対応です。現在の状態は変更していません。`;
      case "invariant":
        return `不変条件に違反しています（${failure.reason}）。現在の状態は変更していません。`;
    }
  },
} as const;
