import { Logger } from "@/libs/logger";

/** クリップボードへ書く（UC-008 代替フロー「コピー」）。失敗はログに残すだけで、UI は止めない。 */
export const Clipboard = {
  copy(text: string): void {
    const clipboard = navigator.clipboard;
    if (clipboard === undefined) {
      Logger.error("clipboard is not available", text);
      return;
    }
    clipboard.writeText(text).catch((error: unknown) => {
      Logger.error("clipboard write failed", error);
    });
  },
} as const;
