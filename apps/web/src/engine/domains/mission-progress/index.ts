import type { ValueOf } from "@/types/ValueOf";

export const MissionStatuses = {
  Available: "available",
  InProgress: "in_progress",
  Completed: "completed",
} as const;
export type MissionStatus = ValueOf<typeof MissionStatuses>;

/** ミッションの進捗（定義は `engine/missions/` が持ち、World にはこれだけを保存する）。 */
export type MissionProgress = Readonly<{
  id: string;
  status: MissionStatus;
  revealedHints: number;
}>;

export const MissionProgress = {
  create(id: string): MissionProgress {
    return { id, status: MissionStatuses.Available, revealedHints: 0 };
  },

  /**
   * 開始する。`available` と `completed`（再挑戦）から `in_progress` へ（設計書 8「Mission の状態」）。
   *
   * @param progress 元
   * @returns 進行中にした進捗。ヒントは伏せ直す
   */
  start(progress: MissionProgress): MissionProgress {
    return { ...progress, status: MissionStatuses.InProgress, revealedHints: 0 };
  },

  /**
   * 中断する。`in_progress` のときだけ `available` へ戻す。`completed` は履歴として残す。
   *
   * @param progress 元
   * @returns 進行中なら `available`。それ以外は変えない
   */
  abandon(progress: MissionProgress): MissionProgress {
    return progress.status === MissionStatuses.InProgress
      ? { ...progress, status: MissionStatuses.Available }
      : progress;
  },

  complete(progress: MissionProgress): MissionProgress {
    return { ...progress, status: MissionStatuses.Completed };
  },

  revealHint(progress: MissionProgress, total: number): MissionProgress {
    return { ...progress, revealedHints: Math.min(total, progress.revealedHints + 1) };
  },

  isInProgress(progress: MissionProgress): boolean {
    return progress.status === MissionStatuses.InProgress;
  },
} as const;
