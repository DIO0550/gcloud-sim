// @vitest-environment node
import { expect, test } from "vitest";

import { Keys, LineEditor } from "@/features/simulator/domains/line-editor";
import { Option } from "@/utils/Option";

const type = (editor: LineEditor, text: string): LineEditor =>
  [...text].reduce((e, c) => LineEditor.handle(e, c).editor, editor);

test("文字を打つとカーソルの位置に入る", () => {
  const editor = type(LineEditor.create(), "gcloud");
  expect(editor.buffer).toBe("gcloud");
  expect(editor.cursor).toBe(6);
});

test("Backspace はカーソルの前の 1 文字を消し、先頭では何もしない", () => {
  const editor = LineEditor.handle(type(LineEditor.create(), "ab"), "\x7f").editor;
  expect(editor.buffer).toBe("a");
  expect(LineEditor.handle(LineEditor.create(), "\x7f").editor.buffer).toBe("");
});

test("← で戻った位置に挿入できる", () => {
  const moved = LineEditor.handle(type(LineEditor.create(), "ac"), Keys.Left).editor;
  expect(type(moved, "b").buffer).toBe("abc");
});

test("Enter は行を送信し、履歴に積んでバッファを空にする", () => {
  const stepped = LineEditor.handle(type(LineEditor.create(), "gcloud config list"), "\r");
  expect(stepped.effects).toEqual([{ kind: "submit", line: "gcloud config list" }]);
  expect(stepped.editor.buffer).toBe("");
  expect(stepped.editor.history).toEqual(["gcloud config list"]);
});

test("空行の Enter は履歴に積まない", () => {
  const stepped = LineEditor.handle(LineEditor.create(), "\r");
  expect(stepped.effects).toEqual([{ kind: "submit", line: "" }]);
  expect(stepped.editor.history).toEqual([]);
});

test("直前と同じ行は履歴に重ねて積まない", () => {
  const once = LineEditor.handle(type(LineEditor.create(), "ls"), "\r").editor;
  const twice = LineEditor.handle(type(once, "ls"), "\r").editor;
  expect(twice.history).toEqual(["ls"]);
});

test("↑ で履歴を遡り、↓ で打ちかけの行に戻る", () => {
  const editor = LineEditor.create(["first", "second"]);
  const drafted = type(editor, "dra");
  const up1 = LineEditor.handle(drafted, Keys.Up).editor;
  expect(up1.buffer).toBe("second");
  const up2 = LineEditor.handle(up1, Keys.Up).editor;
  expect(up2.buffer).toBe("first");
  const up3 = LineEditor.handle(up2, Keys.Up).editor;
  expect(up3.buffer).toBe("first");
  const down = LineEditor.handle(LineEditor.handle(up3, Keys.Down).editor, Keys.Down).editor;
  expect(down.buffer).toBe("dra");
  expect(down.historyIndex).toEqual(Option.none);
});

test("Ctrl+C は行を捨てて interrupt を返す", () => {
  const stepped = LineEditor.handle(type(LineEditor.create(), "abc"), "\x03");
  expect(stepped.editor.buffer).toBe("");
  expect(stepped.effects).toEqual([{ kind: "interrupt" }]);
});

test("Ctrl+L は clear を返しバッファを残す", () => {
  const stepped = LineEditor.handle(type(LineEditor.create(), "abc"), "\x0c");
  expect(stepped.editor.buffer).toBe("abc");
  expect(stepped.effects).toEqual([{ kind: "clear" }]);
});

test("Tab は complete を返す", () => {
  expect(LineEditor.handle(type(LineEditor.create(), "gcl"), "\t").effects).toEqual([
    { kind: "complete" },
  ]);
});

test("候補が 1 つなら最後の語を置き換えて空白を足す", () => {
  const editor = type(LineEditor.create(), "gcloud comp");
  const completed = LineEditor.complete(editor, ["compute"]);
  expect(completed.editor.buffer).toBe("gcloud compute ");
  expect(completed.listing).toEqual([]);
});

test("候補が複数なら共通の接頭辞まで進めて候補を並べる", () => {
  const editor = type(LineEditor.create(), "gcloud compute inst");
  const completed = LineEditor.complete(editor, [
    "instance-groups",
    "instance-templates",
    "instances",
  ]);
  expect(completed.editor.buffer).toBe("gcloud compute instance");
  expect(completed.listing).toHaveLength(3);
});

test("候補が無ければ何も変えない", () => {
  const editor = type(LineEditor.create(), "xyz");
  expect(LineEditor.complete(editor, [])).toEqual({ editor, listing: [] });
});

test("貼り付けた複数行は 1 行ずつ送信になる", () => {
  const stepped = LineEditor.handle(LineEditor.create(), "gcloud config list\ngcloud auth list\n");
  expect(stepped.effects.filter((e) => e.kind === "submit")).toEqual([
    { kind: "submit", line: "gcloud config list" },
    { kind: "submit", line: "gcloud auth list" },
  ]);
});

test("バックスラッシュで継続した貼り付けは 1 行に繋がる", () => {
  const stepped = LineEditor.handle(
    LineEditor.create(),
    "gcloud compute instances create web-1 \\\n    --zone=asia-northeast1-a\n",
  );
  expect(stepped.effects).toContainEqual({
    kind: "submit",
    line: "gcloud compute instances create web-1 --zone=asia-northeast1-a",
  });
});

test("replace は行を丸ごと置き換えカーソルを末尾に置く", () => {
  const editor = LineEditor.replace(type(LineEditor.create(), "abc"), "gcloud projects list");
  expect(editor.buffer).toBe("gcloud projects list");
  expect(editor.cursor).toBe(20);
});

test("貼り付けた制御文字は入力行に入らない", () => {
  expect(LineEditor.handle(LineEditor.create(), "a\x07b").editor.buffer).toBe("ab");
});

test("replace はエスケープ列を落とし、履歴を辿っている位置も戻す", () => {
  const browsing = LineEditor.handle(LineEditor.create(["ls"]), Keys.Up).editor;
  const replaced = LineEditor.replace(browsing, "gcloud\x1b[31m projects list");
  expect(replaced.buffer).toBe("gcloud[31m projects list");
  expect(replaced.historyIndex).toEqual(Option.none);
});

test("貼り付けの draw は 1 つにまとまり、送信を挟むと分かれる", () => {
  expect(LineEditor.handle(LineEditor.create(), "ab").effects).toEqual([{ kind: "draw" }]);
  expect(LineEditor.handle(LineEditor.create(), "a\nb").effects).toEqual([
    { kind: "draw" },
    { kind: "submit", line: "a" },
    { kind: "draw" },
  ]);
});

test("Home / End と Ctrl+U でカーソルと行頭削除が効く", () => {
  const editor = type(LineEditor.create(), "abcd");
  expect(LineEditor.handle(editor, Keys.Home).editor.cursor).toBe(0);
  expect(
    LineEditor.handle(LineEditor.handle(editor, Keys.Home).editor, Keys.End).editor.cursor,
  ).toBe(4);
  const moved = LineEditor.handle(LineEditor.handle(editor, Keys.Left).editor, Keys.Left).editor;
  expect(LineEditor.handle(moved, "\x15").editor.buffer).toBe("cd");
});

test("候補の制御文字は落としてから入力行に入れる", () => {
  const editor = type(LineEditor.create(), "gcloud compute instances describe we");
  const completed = LineEditor.complete(editor, ["web\u0007-1"]);
  expect(completed.editor.buffer).toBe("gcloud compute instances describe web-1 ");
});

test("候補が複数のとき、並べる候補からも制御文字を落とす", () => {
  const editor = type(LineEditor.create(), "gcloud compute instances describe we");
  const completed = LineEditor.complete(editor, ["web\u0007-1", "web-2"]);
  expect(completed.listing).toEqual(["web-1", "web-2"]);
});
