import { type Zone, ZoneLinkFor } from "@/engine/domains/catalog";
import type { JsonRecord } from "@/types/Json";
import type { ValueOf } from "@/types/ValueOf";
import { Option } from "@/utils/Option";

export const OperationTypes = {
  Insert: "insert",
  Delete: "delete",
  Start: "start",
  Stop: "stop",
  Suspend: "suspend",
  Resume: "resume",
  CreateSnapshot: "createSnapshot",
  SetTags: "setTags",
  SetMetadata: "setMetadata",
  SetMachineType: "setMachineType",
  AttachDisk: "attachDisk",
  Resize: "resize",
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
  zone: Option<Zone>;
  status: "DONE";
  progress: 100;
  insertTime: string;
  endTime: string;
  user: string;
}>;

/** 履歴の上限。古いものから捨てる（設計書 6.2 World）。 */
export const OperationHistoryLimit = 500;

/** `Operation.create` に渡す材料。 */
export type OperationSeed = Readonly<{
  projectId: string;
  operationType: OperationType;
  targetLink: string;
  targetName: string;
  zone: Option<Zone>;
  user: string;
  now: string;
  sequence: number;
}>;

export const Operation = {
  /**
   * 完了済みのオペレーションを作る。id と name は時刻と対象から組み立てる。
   *
   * @param seed 対象の情報と実行者・時刻
   * @returns `DONE` のオペレーション
   */
  create(seed: OperationSeed): Operation {
    const stamp = Date.parse(seed.now);
    return {
      id: `${stamp}${String(seed.sequence).padStart(4, "0")}`,
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

  /** ゾーンオペレーションの selfLink。`--async` の案内に出す。 */
  selfLink(operation: Operation): string {
    const scope = Option.isSome(operation.zone) ? `zones/${operation.zone.value}` : "global";
    return `https://www.googleapis.com/compute/v1/projects/${operation.projectId}/${scope}/operations/${operation.name}`;
  },

  toRecord(operation: Operation): JsonRecord {
    return {
      id: operation.id,
      name: operation.name,
      operationType: operation.operationType,
      targetLink: operation.targetLink,
      zone: Option.isSome(operation.zone)
        ? ZoneLinkFor(operation.projectId, operation.zone.value)
        : undefined,
      status: operation.status,
      progress: operation.progress,
      insertTime: operation.insertTime,
      endTime: operation.endTime,
      user: operation.user,
      selfLink: Operation.selfLink(operation),
    };
  },
} as const;
