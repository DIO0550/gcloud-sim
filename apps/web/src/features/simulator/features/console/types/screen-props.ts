import type { Project } from "@/engine/domains/resource-hierarchy";
import type { World } from "@/engine/domains/world";
import type { ConsoleScreen } from "@/features/simulator/features/console/domains/console-screen";
import type { Option } from "@/utils/Option";

/** Console の画面が親（Simulator）に頼む操作。すべて CLI と同じ経路（DJ-011）。 */
export type ConsoleHandlers = Readonly<{
  /** コマンドを流す。`note` は端末に `# Console: ...` として先に出す説明。`next` は成功したら移る画面 */
  submit: (seed: Readonly<{ line: string; note: string; next: Option<ConsoleScreen> }>) => void;
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
}>;
