import { Result } from "@/utils/Result";

/** クリップボードへ書く（UC-008 代替フロー「コピー」）。 */
export const Clipboard = {
  /**
   * @param text 書く文字列
   * @returns 書けなければその理由（クリップボード API が無い、ブラウザが拒んだ）
   */
  async copy(text: string): Promise<Result<void, string>> {
    const clipboard = navigator.clipboard;
    if (clipboard === undefined) return Result.err("clipboard is not available");
    return clipboard.writeText(text).then(
      () => Result.ok(undefined),
      (error: unknown) => Result.err(`clipboard write failed: ${String(error)}`),
    );
  },
} as const;
