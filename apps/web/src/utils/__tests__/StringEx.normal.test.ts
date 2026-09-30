// @vitest-environment node
import { expect, test } from "vitest";

import { StringEx } from "@/utils/StringEx";

test("制御文字と DEL を落とし、タブと通常の文字は残す（ESC を落とせば後続はただの文字）", () => {
  expect(StringEx.withoutControlChars("a\u001b[31mb\u0007c\u007f\td")).toBe("a[31mbc\td");
});

test("C1（8 ビットの CSI 等）も落とし、Latin-1 の文字は残す", () => {
  expect(StringEx.withoutControlChars("a\u009b31mbé")).toBe("a31mbé");
});

test("サロゲートペアの文字はそのまま残る", () => {
  expect(StringEx.withoutControlChars("日本語 🙂\u0000")).toBe("日本語 🙂");
});
