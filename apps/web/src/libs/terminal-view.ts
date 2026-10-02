import type { OutputLine } from "@/engine";
import { StringEx } from "@/utils/StringEx";

/**
 * xterm.js を包んだ最小の口。feature はここを通してだけ端末に触る。
 * 行編集・履歴・補完はここに置かず、feature の `LineEditor` が持つ。
 */
export type TerminalView = Readonly<{
  /** 生の文字列を書く。改行は `\r\n` */
  write(text: string): void;
  /** 1 行を調子に応じた色で書き、改行する */
  writeLine(line: OutputLine): void;
  /** キー入力（xterm の onData）を受ける。戻り値で購読を解除する */
  onData(handler: (data: string) => void): () => void;
  /** 器の大きさに合わせて列数・行数を計算し直す */
  fit(): void;
  /** 今の列数。入力行が折り返す位置の計算に使う */
  cols(): number;
  clear(): void;
  focus(): void;
  dispose(): void;
}>;

const Ansi = {
  reset: "\x1b[0m",
  error: "\x1b[31m",
  warning: "\x1b[33m",
  hint: "\x1b[33m",
  success: "\x1b[32m",
  muted: "\x1b[90m",
  plain: "",
} as const;

/**
 * 調子ごとの ANSI 色。`plain` は色を付けない。制御文字は書く前に落とす（コマンドの出力には
 * Snapshot 由来の文字列が混ざるので、エスケープ列を端末に解釈させない）。
 */
export const colorize = (line: OutputLine): string => {
  const text = StringEx.withoutControlChars(line.text);
  return line.tone === "plain" ? text : `${Ansi[line.tone]}${text}${Ansi.reset}`;
};

const FontSize = 14;

/** `TerminalView` を作る関数の型。テストではフェイクを注入する。 */
export type TerminalViewFactory = (container: HTMLElement) => Promise<TerminalView>;

/**
 * xterm.js で `TerminalView` を作る。xterm はブラウザでしか動かないので、ここで動的に読み込む
 * （static export の prerender でモジュールが評価されないようにする）。
 *
 * @param container 端末を差し込む要素
 * @returns 開いた端末
 */
export const createXtermView: TerminalViewFactory = async (container) => {
  const [{ Terminal }, { FitAddon }] = await Promise.all([
    import("@xterm/xterm"),
    import("@xterm/addon-fit"),
  ]);
  // 等幅は layout.tsx が next/font で読み込んだ IBM Plex Mono。xterm は開いた時点の書体で文字幅を
  // 測るので、読み込みを待ってから開く（待たないと代替書体の幅で測り、桁がずれる）。
  const mono = getComputedStyle(document.documentElement)
    .getPropertyValue("--font-plex-mono")
    .trim();
  if (mono !== "") await document.fonts.load(`${FontSize}px ${mono}`).catch(() => []);
  const terminal = new Terminal({
    cursorBlink: true,
    fontFamily: `${mono === "" ? "" : `${mono}, `}"SFMono-Regular", Menlo, Consolas, "Noto Sans Mono CJK JP", monospace`,
    fontSize: FontSize,
    lineHeight: 1.55,
    convertEol: true,
    scrollback: 5000,
    theme: {
      background: "#fafcfe",
      foreground: "#1d2126",
      cursor: "#1d2126",
      cursorAccent: "#fafcfe",
      selectionBackground: "#e2f1fb",
      red: "#b42318",
      green: "#1a7f37",
      yellow: "#9a6200",
      blue: "#0b6aa8",
      brightBlack: "#5f6570",
    },
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.open(container);
  fit.fit();
  return {
    write: (text) => terminal.write(text),
    writeLine: (line) => terminal.write(`${colorize(line)}\r\n`),
    onData: (handler) => {
      const subscription = terminal.onData(handler);
      return () => subscription.dispose();
    },
    fit: () => fit.fit(),
    cols: () => terminal.cols,
    clear: () => terminal.clear(),
    focus: () => terminal.focus(),
    dispose: () => terminal.dispose(),
  };
};
