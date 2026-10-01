import { Engine, type OutputLine, Shell, type ShellState } from "@/engine";
import type { World } from "@/engine/domains/world";

/** テストで固定する時刻。 */
export const Now = "2026-09-30T14:02:31.000Z";

/** 初期 World。テストごとに作り直す（共有しない）。 */
export const initialWorld = (): World => Engine.initialWorld(Now);

export type Session = Readonly<{
  world: World;
  shell: ShellState;
  /** 直近の 1 行が出した出力 */
  lines: readonly OutputLine[];
  /** 直近の 1 行の出力を改行で繋いだもの */
  text: string;
}>;

export const session = (world: World = initialWorld()): Session => ({
  world,
  shell: Shell.Ready,
  lines: [],
  text: "",
});

/**
 * 1 行ずつ実行して最後の結果を返す。途中の行の出力は捨てる。
 *
 * @param start 開始状態
 * @param lines 順に打つ行
 * @returns 最後の行を打った後の状態
 */
export const run = (start: Session, ...lines: readonly string[]): Session =>
  lines.reduce<Session>((current, line) => {
    const result = Engine.execute({ world: current.world, shell: current.shell, line, now: Now });
    return {
      world: result.world,
      shell: result.shell,
      lines: result.lines,
      text: result.lines.map((l) => l.text).join("\n"),
    };
  }, start);
