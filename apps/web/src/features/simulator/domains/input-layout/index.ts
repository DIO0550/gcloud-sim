import { Option } from "@/utils/Option";

/** 端末に描いた入力行の大きさ。次に描き直すとき、カーソルが何行目にいるかをこれから求める。 */
export type DrawnInput = Readonly<{ length: number; cursor: number }>;

/** 描き直しの指示。`sequence` を端末に書き、`rendered` を次回の `previous` にする。 */
export type Redraw = Readonly<{ sequence: string; rendered: DrawnInput }>;

const PromptText = "$ ";
const PromptAnsi = "\x1b[34m$\x1b[0m ";
const PromptLength = PromptText.length;

const up = (rows: number): string => (rows > 0 ? `\x1b[${rows}A` : "");

/** 描いてあるプロンプトと入力行を消して、行頭に戻る。 */
const erase = (previous: Option<DrawnInput>, cols: number): string => {
  const cursorRow = Option.isSome(previous)
    ? Math.floor((PromptLength + previous.value.cursor) / cols)
    : 0;
  return `${up(cursorRow)}\r\x1b[J`;
};

/**
 * 入力行の描画（折り返しを含む）。xterm は行幅で折り返すので、消すときは前回のカーソルの行数だけ
 * 上に戻ってから画面末尾まで消し、書いた後は目的の行・列へ動かす。
 */
export const InputLayout = {
  Prompt: PromptText,

  /**
   * 前回の描画を消して、今の入力行を描くエスケープ列を作る。
   *
   * @param previous 前回描いた入力行。無ければ行頭にいる前提
   * @param editor 今のバッファとカーソル
   * @param cols 端末の列数（1 以上）
   * @returns 端末に書く列と、次回の `previous`
   */
  redraw(
    previous: Option<DrawnInput>,
    editor: Readonly<{ buffer: string; cursor: number }>,
    cols: number,
  ): Redraw {
    const width = Math.max(1, cols);
    const total = PromptLength + editor.buffer.length;
    const endRow = Math.floor(total / width);
    const endCol = total % width;
    // ちょうど右端で終わると xterm は折り返しを保留するので、空白で折り返させてから戻す。
    const settle = endCol === 0 && total > 0 ? " \x1b[D" : "";
    const targetRow = Math.floor((PromptLength + editor.cursor) / width);
    const targetCol = (PromptLength + editor.cursor) % width;
    const sequence = `${erase(previous, width)}${PromptAnsi}${editor.buffer}${settle}${up(endRow - targetRow)}\x1b[${targetCol + 1}G`;
    return { sequence, rendered: { length: editor.buffer.length, cursor: editor.cursor } };
  },

  /**
   * 描いてある入力行を消す（出力を書く前に呼ぶ）。
   *
   * @param previous 前回描いた入力行
   * @param cols 端末の列数
   * @returns 端末に書く列
   */
  erase(previous: Option<DrawnInput>, cols: number): string {
    return erase(previous, Math.max(1, cols));
  },
} as const;
