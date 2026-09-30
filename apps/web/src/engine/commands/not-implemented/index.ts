import type { CommandSpec } from "@/engine/cli/command-spec";

/**
 * 解決はできるが未実装のコマンド（DJ-005: それっぽく成功させず E-002 で返す）。
 * 設計書 3.1 の範囲はすべて実装したので今は空。次に足すコマンドは、実装するまでここに
 * `notImplemented(path, summary)`（`commands/shared`）で並べる。
 */
export const NotImplementedCommands: readonly CommandSpec[] = [];
