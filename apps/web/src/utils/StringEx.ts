const Tab = 0x09;
const C0Limit = 0x20;
const Delete = 0x7f;
const C1Limit = 0xa0;

/** C0（タブを除く）・DEL・C1。C1 は 8 ビットの CSI（U+009B）等として端末に解釈されうる。 */
const isControl = (codePoint: number): boolean =>
  (codePoint < C0Limit && codePoint !== Tab) || (codePoint >= Delete && codePoint < C1Limit);

/** 文字列への汎用操作。 */
export const StringEx = {
  /**
   * 制御文字（C0・DEL・C1。タブは残す）を落とす。端末に書く前・入力行に入れる前に通す。
   *
   * @param text 元
   * @returns 制御文字を含まない文字列
   */
  withoutControlChars(text: string): string {
    return [...text].filter((char) => !isControl(char.codePointAt(0) ?? 0)).join("");
  },

  /**
   * カンマか空白で区切った並びにする。前後の空白は落とし、空の要素は残さない。
   *
   * @param text `a, b  c`
   * @returns `["a", "b", "c"]`
   */
  splitList(text: string): readonly string[] {
    return text.split(/[\s,]+/).filter((item) => item !== "");
  },
} as const;
