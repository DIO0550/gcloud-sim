import { Result } from "@/utils/Result";

/** クォートが閉じていない入力行（E-003）。 */
export type UnclosedQuote = Readonly<{ quote: '"' | "'" }>;

type Scan = Readonly<{
  tokens: readonly string[];
  current: string;
  inToken: boolean;
  quote: '"' | "'" | null;
  escaped: boolean;
}>;

const Start: Scan = { tokens: [], current: "", inToken: false, quote: null, escaped: false };

const flush = (scan: Scan): Scan =>
  scan.inToken
    ? { ...scan, tokens: [...scan.tokens, scan.current], current: "", inToken: false }
    : scan;

const step = (scan: Scan, char: string): Scan => {
  if (scan.escaped) return { ...scan, current: scan.current + char, inToken: true, escaped: false };
  if (scan.quote !== null) {
    if (char === scan.quote) return { ...scan, quote: null };
    const escapes = char === "\\" && scan.quote === '"';
    return escapes ? { ...scan, escaped: true } : { ...scan, current: scan.current + char };
  }
  if (char === "\\") return { ...scan, escaped: true, inToken: true };
  if (char === '"' || char === "'") return { ...scan, quote: char, inToken: true };
  if (/\s/.test(char)) return flush(scan);
  return { ...scan, current: scan.current + char, inToken: true };
};

export const Tokenizer = {
  /**
   * 入力行を空白で区切る。`"..."` / `'...'` の中の空白は区切らず、`\` は次の 1 文字を
   * そのまま入れる（行末の `\` は行の継続として無視する）。
   *
   * @param line ターミナルの 1 行
   * @returns トークンの並び。クォートが閉じていなければ `err`
   */
  tokenize(line: string): Result<readonly string[], UnclosedQuote> {
    const scanned = [...line].reduce(step, Start);
    if (scanned.quote !== null) return Result.err({ quote: scanned.quote });
    return Result.ok(flush(scanned).tokens);
  },
} as const;
