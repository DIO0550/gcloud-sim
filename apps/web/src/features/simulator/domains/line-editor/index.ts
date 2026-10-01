import { Option } from "@/utils/Option";
import { StringEx } from "@/utils/StringEx";

/** 入力行の状態。バッファとカーソル、↑↓で辿る履歴。 */
export type LineEditor = Readonly<{
  buffer: string;
  cursor: number;
  history: readonly string[];
  /** 履歴を辿っている位置。辿っていなければ `none` */
  historyIndex: Option<number>;
  /** 履歴を辿り始める前に打ちかけていた行 */
  draft: string;
}>;

/** キー入力を適用した結果、コンポーネントが端末に対して行うこと。 */
export type EditorEffect =
  | Readonly<{ kind: "draw" }>
  | Readonly<{ kind: "submit"; line: string }>
  | Readonly<{ kind: "complete" }>
  | Readonly<{ kind: "clear" }>
  | Readonly<{ kind: "interrupt" }>;

export type EditorStep = Readonly<{ editor: LineEditor; effects: readonly EditorEffect[] }>;

export const Keys = {
  Enter: "\r",
  Newline: "\n",
  Backspace: "\x7f",
  BackspaceCtrlH: "\b",
  Tab: "\t",
  CtrlC: "\x03",
  CtrlL: "\x0c",
  CtrlA: "\x01",
  CtrlE: "\x05",
  CtrlU: "\x15",
  CtrlK: "\x0b",
  Up: "\x1b[A",
  Down: "\x1b[B",
  Right: "\x1b[C",
  Left: "\x1b[D",
  Home: "\x1b[H",
  End: "\x1b[F",
  HomeAlt: "\x1b[1~",
  EndAlt: "\x1b[4~",
  Delete: "\x1b[3~",
} as const;

const step = (editor: LineEditor, ...effects: readonly EditorEffect[]): EditorStep => ({
  editor,
  effects,
});
const draw = (editor: LineEditor): EditorStep => step(editor, { kind: "draw" });

const withBuffer = (editor: LineEditor, buffer: string, cursor: number): LineEditor => ({
  ...editor,
  buffer,
  cursor: Math.max(0, Math.min(buffer.length, cursor)),
});

/**
 * 文字を入力行に入れる。キーとして意味を持つ制御文字は `single` が先に拾うので、ここに来た
 * 制御文字は端末のエスケープ列として書き戻されないように落とす。
 */
const insert = (editor: LineEditor, text: string): LineEditor => {
  const printable = StringEx.withoutControlChars(text);
  return withBuffer(
    editor,
    editor.buffer.slice(0, editor.cursor) + printable + editor.buffer.slice(editor.cursor),
    editor.cursor + printable.length,
  );
};

const backspace = (editor: LineEditor): LineEditor =>
  editor.cursor === 0
    ? editor
    : withBuffer(
        editor,
        editor.buffer.slice(0, editor.cursor - 1) + editor.buffer.slice(editor.cursor),
        editor.cursor - 1,
      );

const deleteForward = (editor: LineEditor): LineEditor =>
  withBuffer(
    editor,
    editor.buffer.slice(0, editor.cursor) + editor.buffer.slice(editor.cursor + 1),
    editor.cursor,
  );

const historyUp = (editor: LineEditor): LineEditor => {
  if (editor.history.length === 0) return editor;
  const current = Option.unwrapOr(editor.historyIndex, editor.history.length);
  const next = Math.max(0, current - 1);
  const draft = Option.isSome(editor.historyIndex) ? editor.draft : editor.buffer;
  const line = editor.history[next] ?? "";
  return { ...withBuffer(editor, line, line.length), historyIndex: Option.some(next), draft };
};

const historyDown = (editor: LineEditor): LineEditor => {
  if (!Option.isSome(editor.historyIndex)) return editor;
  const next = editor.historyIndex.value + 1;
  if (next >= editor.history.length) {
    return {
      ...withBuffer(editor, editor.draft, editor.draft.length),
      historyIndex: Option.none,
      draft: "",
    };
  }
  const line = editor.history[next] ?? "";
  return { ...withBuffer(editor, line, line.length), historyIndex: Option.some(next) };
};

const submit = (editor: LineEditor): EditorStep => {
  const line = editor.buffer;
  const trimmed = line.trim();
  const history =
    trimmed === "" || editor.history.at(-1) === trimmed
      ? editor.history
      : [...editor.history, trimmed];
  return step(
    { ...editor, buffer: "", cursor: 0, history, historyIndex: Option.none, draft: "" },
    { kind: "submit", line },
  );
};

const single = (editor: LineEditor, key: string): EditorStep => {
  switch (key) {
    case Keys.Enter:
    case Keys.Newline:
      return submit(editor);
    case Keys.Backspace:
    case Keys.BackspaceCtrlH:
      return draw(backspace(editor));
    case Keys.Delete:
      return draw(deleteForward(editor));
    case Keys.Tab:
      return step(editor, { kind: "complete" });
    case Keys.CtrlC:
      return step(
        { ...editor, buffer: "", cursor: 0, historyIndex: Option.none, draft: "" },
        { kind: "interrupt" },
      );
    case Keys.CtrlL:
      return step(editor, { kind: "clear" });
    case Keys.CtrlA:
    case Keys.Home:
    case Keys.HomeAlt:
      return draw({ ...editor, cursor: 0 });
    case Keys.CtrlE:
    case Keys.End:
    case Keys.EndAlt:
      return draw({ ...editor, cursor: editor.buffer.length });
    case Keys.CtrlU:
      return draw(withBuffer(editor, editor.buffer.slice(editor.cursor), 0));
    case Keys.CtrlK:
      return draw(withBuffer(editor, editor.buffer.slice(0, editor.cursor), editor.cursor));
    case Keys.Left:
      return draw({ ...editor, cursor: Math.max(0, editor.cursor - 1) });
    case Keys.Right:
      return draw({ ...editor, cursor: Math.min(editor.buffer.length, editor.cursor + 1) });
    case Keys.Up:
      return draw(historyUp(editor));
    case Keys.Down:
      return draw(historyDown(editor));
    default:
      return key.startsWith("\x1b") ? step(editor) : draw(insert(editor, key));
  }
};

/** 単語の区切り。補完で置き換える「最後の語」を切り出す。 */
const lastWordStart = (buffer: string): number => {
  const index = buffer.lastIndexOf(" ");
  return index === -1 ? 0 : index + 1;
};

const commonPrefix = (words: readonly string[]): string =>
  words.reduce((prefix, word) => {
    let i = 0;
    while (i < prefix.length && i < word.length && prefix[i] === word[i]) i += 1;
    return prefix.slice(0, i);
  }, words[0] ?? "");

export const LineEditor = {
  /**
   * 空の入力行。
   *
   * @param history 復元する履歴（保存した transcript の入力から作る）
   * @returns 何も打っていない状態
   */
  create(history: readonly string[] = []): LineEditor {
    return { buffer: "", cursor: 0, history, historyIndex: Option.none, draft: "" };
  },

  /**
   * xterm の onData が渡す文字列を適用する。複数文字（貼り付け）は 1 文字ずつ適用し、
   * 貼り付けた改行はそのまま送信になる。連続する `draw` は 1 つにまとめる（貼り付けの
   * 1 文字ごとに描き直さない）。
   *
   * @param editor 今の状態
   * @param data 入力
   * @returns 次の状態と、端末に対して行うこと
   */
  handle(editor: LineEditor, data: string): EditorStep {
    const isEscape = data.startsWith("\x1b");
    if (isEscape || data.length === 1) return single(editor, data);
    const normalized = data.replace(/\r\n/g, "\n").replace(/[ \t]*\\\n\s*/g, " ");
    const effects: EditorEffect[] = [];
    let current = editor;
    for (const char of normalized) {
      const next = single(current, char);
      current = next.editor;
      for (const effect of next.effects) {
        const duplicatesDraw = effect.kind === "draw" && effects.at(-1)?.kind === "draw";
        if (!duplicatesDraw) effects.push(effect);
      }
    }
    return { editor: current, effects };
  },

  /**
   * 入力行を丸ごと置き換える（リソースツリーのダブルクリックで describe を挿入する）。
   *
   * @param editor 今の状態
   * @param line 置き換える行
   * @returns カーソルを末尾に置いた状態
   */
  replace(editor: LineEditor, line: string): LineEditor {
    const printable = StringEx.withoutControlChars(line);
    return {
      ...withBuffer(editor, printable, printable.length),
      historyIndex: Option.none,
      draft: "",
    };
  },

  /**
   * 補完候補を適用する。候補が 1 つなら置き換えて空白を足し、複数なら共通の接頭辞まで進める。
   *
   * @param editor 今の状態
   * @param candidates 最後の語を置き換える候補
   * @returns 次の状態と、複数候補のときに端末へ並べる候補
   */
  complete(
    editor: LineEditor,
    candidates: readonly string[],
  ): Readonly<{ editor: LineEditor; listing: readonly string[] }> {
    if (candidates.length === 0) return { editor, listing: [] };
    const start = lastWordStart(editor.buffer.slice(0, editor.cursor));
    const head = editor.buffer.slice(0, start);
    const tail = editor.buffer.slice(editor.cursor);
    if (candidates.length === 1) {
      const word = `${candidates[0]} `;
      return { editor: withBuffer(editor, head + word + tail, start + word.length), listing: [] };
    }
    const prefix = commonPrefix(candidates);
    return {
      editor: withBuffer(editor, head + prefix + tail, start + prefix.length),
      listing: candidates,
    };
  },

  /** 補完のために切り出す、カーソルまでの行。 */
  lineForCompletion(editor: LineEditor): string {
    return editor.buffer.slice(0, editor.cursor);
  },
} as const;
