/**
 * 現在時刻の境界。エンジンは時刻を引数で受け取り、ここでしか `Date` を読まない
 * （VRT は `Date` を固定して撮るので、時刻の読み取りを 1 箇所に閉じる）。
 */
export const Clock = {
  /** 今の時刻を ISO 8601 で返す。 */
  now(): string {
    return new Date().toISOString();
  },
} as const;
