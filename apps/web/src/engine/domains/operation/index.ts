import type { JsonRecord } from "@/types/Json";
import type { ValueOf } from "@/types/ValueOf";

export const OperationTypes = {
  Insert: "insert",
  Delete: "delete",
  Start: "start",
  Stop: "stop",
  Suspend: "suspend",
  Resume: "resume",
  CreateSnapshot: "createSnapshot",
} as const;
export type OperationType = ValueOf<typeof OperationTypes>;

/**
 * 非同期処理の疑似オブジェクト（DJ-008）。保存時は常に `DONE`。
 * `targetLink` は対象の selfLink、`zone` はゾーンリソースなら `some`。
 */
export type Operation = Readonly<{
  id: string;
  name: string;
  projectId: string;
  operationType: OperationType;
  targetLink: string;
  targetName: string;
  zone: string;
  status: "DONE";
  progress: 100;
  insertTime: string;
  endTime: string;
  user: string;
}>;

/** 履歴の上限。古いものから捨てる（設計書 6.2 World）。 */
export const OperationHistoryLimit = 500;

export const Operation = {
  /**
   * 完了済みのオペレーションを作る。id と name は時刻と対象から組み立てる。
   *
   * @param seed 対象の情報と実行者・時刻
   * @returns `DONE` のオペレーション
   */
  create(
    seed: Readonly<{
      projectId: string;
      operationType: OperationType;
      targetLink: string;
      targetName: string;
      zone: string;
      user: string;
      now: string;
      sequence: number;
    }>,
  ): Operation {
    const stamp = Date.parse(seed.now);
    const id = `${stamp}${String(seed.sequence).padStart(4, "0")}`;
    return {
      id,
      name: `operation-${stamp}-${seed.sequence.toString(16).padStart(8, "0")}-${seed.targetName}`,
      projectId: seed.projectId,
      operationType: seed.operationType,
      targetLink: seed.targetLink,
      targetName: seed.targetName,
      zone: seed.zone,
      status: "DONE",
      progress: 100,
      insertTime: seed.now,
      endTime: seed.now,
      user: seed.user,
    };
  },

  toRecord(operation: Operation): JsonRecord {
    return {
      id: operation.id,
      name: operation.name,
      operationType: operation.operationType,
      targetLink: operation.targetLink,
      zone:
        operation.zone === ""
          ? undefined
          : `https://www.googleapis.com/compute/v1/projects/${operation.projectId}/zones/${operation.zone}`,
      status: operation.status,
      progress: operation.progress,
      insertTime: operation.insertTime,
      endTime: operation.endTime,
      user: operation.user,
    };
  },
} as const;
