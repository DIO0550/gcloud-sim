import type { ApiName } from "@/engine/domains/catalog";
import { flag, quote } from "@/features/simulator/features/console/domains/equivalent-command";

/** API とサービスの有効化・無効化コマンドを組み立てる。 */
export const ApiServiceCommand = {
  /** `gcloud services enable API --project=P` */
  enable(apiName: ApiName | string, projectId: string): string {
    return ["gcloud services enable", quote(apiName), flag("project", projectId)].join(" ");
  },

  /** `gcloud services disable API --project=P --quiet` */
  disable(apiName: ApiName | string, projectId: string): string {
    return ["gcloud services disable", quote(apiName), flag("project", projectId), "--quiet"].join(
      " ",
    );
  },
} as const;
