import { Option } from "@/utils/Option";

/**
 * 手順で見せる中身。端末に打つ 1 行・ファイル画面で保存する内容・画面での操作のどれか。
 * `file` と `action` は作者が直接書かず、`sim files …` の行を公開時に読み替えて作る（practiceCatalog）。
 */
export type StepDetail =
  | Readonly<{ kind: "cli"; line: string }>
  | Readonly<{ kind: "file"; name: string; content: string }>
  | Readonly<{ kind: "action"; text: string }>;

/**
 * 実行手順の 1 ステップ。「何をするか」（`what`）を先に言い、打つ行や画面の操作（`detail`）と
 * 補足（`note`: 何が起きるか・注意点）を添える。コマンドだけを並べると目的が読めないため、
 * `what` は必ず持つ。
 */
export type MissionStep = Readonly<{
  what: string;
  detail: Option<StepDetail>;
  note: Option<string>;
}>;

const noteOf = (note: string | undefined): Option<string> => Option.fromNullable(note);

export const MissionStep = {
  /**
   * 端末で打つ 1 行の手順。
   *
   * @param what 何をするか。動詞で終わる短い一文（例: 「ログ用のバケットを作る」）
   * @param line 端末に打つ行。`sim files …` はファイル画面の操作として見せる
   * @param note 何が起きるか・注意点（任意）
   * @returns 手順
   */
  run(what: string, line: string, note?: string): MissionStep {
    return { what, detail: Option.some({ kind: "cli", line }), note: noteOf(note) };
  },

  /**
   * 画面（Console・ファイル画面）で操作する手順。
   *
   * @param what 何をするか
   * @param text 押すボタン・入れる値などの操作
   * @param note 補足（任意）
   * @returns 手順
   */
  act(what: string, text: string, note?: string): MissionStep {
    return { what, detail: Option.some({ kind: "action", text }), note: noteOf(note) };
  },

  /**
   * 打つものが無い確認・判断の手順。
   *
   * @param what 何をするか・何を確かめるか
   * @param note 補足（任意）
   * @returns 手順
   */
  say(what: string, note?: string): MissionStep {
    return { what, detail: Option.none, note: noteOf(note) };
  },

  /**
   * 端末に打つ行だけを順に取り出す（テストで手順をそのまま流すとき）。
   *
   * @param steps 手順
   * @returns `cli` の行
   */
  lines(steps: readonly MissionStep[]): readonly string[] {
    return steps.flatMap((step) =>
      Option.isSome(step.detail) && step.detail.value.kind === "cli"
        ? [step.detail.value.line]
        : [],
    );
  },

  /**
   * 手順の文字をすべてつなぐ（公開してよい語だけかを確かめるとき）。
   *
   * @param step 手順
   * @returns what・中身・補足を改行でつないだ文字列
   */
  text(step: MissionStep): string {
    const detail = Option.map(step.detail, (d) => {
      switch (d.kind) {
        case "cli":
          return d.line;
        case "file":
          return `${d.name}\n${d.content}`;
        case "action":
          return d.text;
      }
    });
    return [step.what, Option.unwrapOr(detail, ""), Option.unwrapOr(step.note, "")].join("\n");
  },
} as const;
