import type { ExecutionStatus } from "@/engine";
import type { Project } from "@/engine/domains/resource-hierarchy";
import type { World } from "@/engine/domains/world";
import type { ConsoleScreen } from "@/features/simulator/features/console/domains/console-screen";
import type { Option } from "@/utils/Option";

/**
 * Console のフォームから流したコマンドの結果。成功なら一覧へ戻り、失敗ならフォームに赤帯を出す
 * （UC-008 例外フロー）。`id` は実行ごとに単調増加し、フォームが自分の送信結果を判別するために使う。
 */
export type ConsoleOutcome = Readonly<{ id: number; line: string; outcome: ExecutionStatus }>;

/** Console の画面が親（Simulator）に頼む操作。すべて CLI と同じ経路（DJ-011）。 */
export type ConsoleHandlers = Readonly<{
  /**
   * コマンドを流す。`note` は端末に `# Console: ...` として先に出す説明。`next` は成功したら移る画面。
   * `rest` は続けて流すコマンド（VPC の作成のように 1 回の操作が何行にもなるとき）。どれかが失敗したらそこで止める
   */
  submit: (
    seed: Readonly<{
      line: string;
      note: string;
      next: Option<ConsoleScreen>;
      rest?: readonly Readonly<{ line: string; note: string }>[];
      /** 実行後に下のターミナルドロワーを開くか（SSH 接続など） */
      openTerminal?: boolean;
    }>,
  ) => void;
  /** 端末の入力行に入れる（実行はしない） */
  insert: (line: string) => void;
  copy: (text: string) => void;
  confirm: (message: string) => boolean;
  changeScreen: (screen: ConsoleScreen) => void;
}>;

/** 各画面が受け取るもの。プロジェクトは解決済み（未設定なら `ConsoleView` が画面を出す前に止める）。 */
export type ScreenProps = Readonly<{
  world: World;
  project: Project;
  handlers: ConsoleHandlers;
  navigationOpen?: boolean;
  outcome?: Option<ConsoleOutcome>;
}>;
