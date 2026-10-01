import type { Region } from "@/engine/domains/catalog";
import type { JsonRecord } from "@/types/Json";
import { Result } from "@/utils/Result";

export type KmsKeyRing = Readonly<{
  projectId: string;
  name: string;
  location: Region | "global";
  createTime: string;
}>;

export const KmsKeyRing = {
  /**
   * キーリングを作る。名前は `[a-zA-Z0-9_-]{1,63}`。
   *
   * @param seed 材料
   * @returns 作ったキーリング。名前の形式が悪ければ理由
   */
  create(seed: KmsKeyRing): Result<KmsKeyRing, string> {
    return /^[A-Za-z0-9_-]{1,63}$/.test(seed.name)
      ? Result.ok(seed)
      : Result.err(
          `Invalid value for [KEYRING]: ${seed.name}. Key ring names must match [a-zA-Z0-9_-]{1,63}.`,
        );
  },

  fullName(ring: KmsKeyRing): string {
    return `projects/${ring.projectId}/locations/${ring.location}/keyRings/${ring.name}`;
  },

  toRecord(ring: KmsKeyRing): JsonRecord {
    return { name: KmsKeyRing.fullName(ring), createTime: ring.createTime };
  },
} as const;
