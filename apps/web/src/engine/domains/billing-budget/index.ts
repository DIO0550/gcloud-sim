import type { JsonRecord } from "@/types/Json";
import { Result } from "@/utils/Result";

/** 請求アカウントの予算（`gcloud billing budgets`）。 */
export type Budget = Readonly<{
  billingAccountId: string;
  name: string;
  displayName: string;
  /** 通貨単位の額。通貨は請求アカウントの通貨（JPY） */
  amount: number;
  /** 0〜1 のしきい値。既定は 0.5 / 0.9 / 1.0 */
  thresholds: readonly number[];
  /** 対象プロジェクト。空ならアカウント全体 */
  projectIds: readonly string[];
  createTime: string;
}>;

export const Budget = {
  /**
   * 予算を作る。名前は通し番号から採番し、しきい値の既定は 50% / 90% / 100%。
   *
   * @param seed 材料
   * @returns 作った予算。額が正でなければ理由
   */
  create(
    seed: Readonly<{
      billingAccountId: string;
      displayName: string;
      amount: number;
      thresholds: readonly number[];
      projectIds: readonly string[];
      createTime: string;
      sequence: number;
    }>,
  ): Result<Budget, string> {
    if (!(seed.amount > 0)) {
      return Result.err(`Invalid value for [--budget-amount]: ${seed.amount}. Must be positive.`);
    }
    const outOfRange = seed.thresholds.find((t) => !(t > 0));
    if (outOfRange !== undefined) {
      return Result.err(
        `Invalid value for [--threshold-rule]: percent=${outOfRange}. Must be a positive fraction such as 0.5.`,
      );
    }
    if (seed.displayName.trim() === "") return Result.err("Display name must not be empty.");
    return Result.ok({
      billingAccountId: seed.billingAccountId,
      name: `billingAccounts/${seed.billingAccountId}/budgets/${(0x7a2b + seed.sequence).toString(16)}-budget`,
      displayName: seed.displayName,
      amount: seed.amount,
      thresholds: seed.thresholds.length === 0 ? [0.5, 0.9, 1] : seed.thresholds,
      projectIds: seed.projectIds,
      createTime: seed.createTime,
    });
  },

  toRecord(budget: Budget): JsonRecord {
    return {
      name: budget.name,
      displayName: budget.displayName,
      amount: { specifiedAmount: { currencyCode: "JPY", units: String(budget.amount) } },
      thresholdRules: budget.thresholds.map((t) => ({
        thresholdPercent: t,
        spendBasis: "CURRENT_SPEND",
      })),
      budgetFilter: {
        projects: budget.projectIds.map((p) => `projects/${p}`),
        creditTypesTreatment: "INCLUDE_ALL_CREDITS",
      },
      etag: "budget-etag",
    };
  },
} as const;
