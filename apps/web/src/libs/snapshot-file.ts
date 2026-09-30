import type { World } from "@/engine/domains/world";
import { type ImportFailure, Snapshot } from "@/engine/snapshot";
import { Result } from "@/utils/Result";

/** Snapshot JSON のダウンロードと読み込み（UC-005 Export / Import）。ブラウザの API はここに閉じる。 */
export const SnapshotFile = {
  /**
   * Snapshot を JSON ファイルとしてダウンロードさせる。
   *
   * @param world 書き出す World
   * @param now 書き出し時刻（ファイル名にも使う）
   */
  download(world: World, now: string): void {
    const json = JSON.stringify(Snapshot.create(world, now), null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = Snapshot.fileName(now);
    anchor.click();
    URL.revokeObjectURL(url);
  },

  /**
   * ファイルを読んで World にする。
   *
   * @param file ユーザーが選んだファイル
   * @returns 取り込める World。JSON でない・版が違う・不変条件違反なら理由（E-011）
   */
  async read(file: File): Promise<Result<World, ImportFailure>> {
    const text = await file.text();
    try {
      const parsed: unknown = JSON.parse(text);
      return Snapshot.fromUnknown(parsed);
    } catch (error) {
      return Result.err({
        kind: "malformed",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  },
} as const;
