import { IamPolicy } from "@/engine/domains/iam-policy";
import type { JsonRecord } from "@/types/Json";
import { Result } from "@/utils/Result";

/** サービスアカウント。自身もポリシーを持つ（`service-accounts add-iam-policy-binding` の対象）。 */
export type ServiceAccount = Readonly<{
  email: string;
  displayName: string;
  description: string;
  projectId: string;
  uniqueId: string;
  iamPolicy: IamPolicy;
}>;

export const ServiceAccount = {
  /**
   * `gcloud iam service-accounts create NAME` の NAME を検証してメールを組み立てる。
   *
   * @param seed アカウント ID・表示名・所属プロジェクト・採番済みの uniqueId
   * @returns 6〜30 文字の `[a-z][a-z0-9-]*` なら `NAME@PROJECT.iam.gserviceaccount.com` のアカウント。
   *   それ以外は理由
   */
  create(
    seed: Readonly<{
      accountId: string;
      displayName: string;
      description: string;
      projectId: string;
      uniqueId: string;
    }>,
  ): Result<ServiceAccount, string> {
    const valid = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(seed.accountId);
    if (!valid) {
      return Result.err(
        `Service account ID [${seed.accountId}] must be between 6 and 30 characters and match the regular expression [a-z]([-a-z0-9]*[a-z0-9])`,
      );
    }
    return Result.ok({
      email: ServiceAccount.email(seed.accountId, seed.projectId),
      displayName: seed.displayName,
      description: seed.description,
      projectId: seed.projectId,
      uniqueId: seed.uniqueId,
      iamPolicy: IamPolicy.Empty,
    });
  },

  withPolicy(account: ServiceAccount, iamPolicy: IamPolicy): ServiceAccount {
    return { ...account, iamPolicy };
  },

  /** `NAME@PROJECT.iam.gserviceaccount.com` の綴り。 */
  email(accountId: string, projectId: string): string {
    return `${accountId}@${projectId}.iam.gserviceaccount.com`;
  },

  /**
   * プロジェクト作成時に自動で付く Compute Engine のデフォルトサービスアカウント。
   *
   * @param projectNumber 12 桁のプロジェクト番号
   * @returns `PROJECT_NUMBER-compute@developer.gserviceaccount.com`
   */
  defaultComputeEmail(projectNumber: string): string {
    return `${projectNumber}-compute@developer.gserviceaccount.com`;
  },

  toRecord(account: ServiceAccount): JsonRecord {
    return {
      name: `projects/${account.projectId}/serviceAccounts/${account.email}`,
      email: account.email,
      displayName: account.displayName,
      description: account.description,
      projectId: account.projectId,
      uniqueId: account.uniqueId,
      disabled: false,
    };
  },
} as const;
