import type { OutputLine } from "@/engine";

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

/** 調子ごとの ANSI 色。`plain` は色を付けない。 */
export const colorize = (line: OutputLine): string =>
  line.tone === "plain" ? line.text : `${Ansi[line.tone]}${line.text}${Ansi.reset}`;

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
  const terminal = new Terminal({
    cursorBlink: true,
    fontFamily: '"SFMono-Regular", Menlo, Consolas, "Noto Sans Mono CJK JP", monospace',
    fontSize: 13,
    lineHeight: 1.4,
    convertEol: true,
    scrollback: 5000,
    theme: {
      background: "#ffffff",
      foreground: "#16181d",
      cursor: "#16181d",
      selectionBackground: "#cfe0f7",
      red: "#b42318",
      green: "#1a7f37",
      yellow: "#9a6700",
      brightBlack: "#6b7280",
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
