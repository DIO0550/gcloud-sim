import { ResourceName } from "@/engine/domains/compute";
import type { JsonRecord } from "@/types/Json";
import { Result } from "@/utils/Result";

/** Deployment Manager のデプロイメント。作ったリソースの型と名前を持つ。 */
export type DmDeployment = Readonly<{
  projectId: string;
  name: string;
  config: string;
  resources: readonly Readonly<{ name: string; type: string }>[];
  insertTime: string;
}>;

export const DmDeployment = {
  create(seed: DmDeployment): Result<DmDeployment, string> {
    return Result.map(ResourceName.parse(seed.name), (name) => ({ ...seed, name }));
  },

  toRecord(deployment: DmDeployment): JsonRecord {
    return {
      name: deployment.name,
      insertTime: deployment.insertTime,
      operation: { operationType: "insert", status: "DONE" },
      target: { config: { content: deployment.config } },
      resources: deployment.resources.map((r) => ({ name: r.name, type: r.type })),
    };
  },
} as const;
