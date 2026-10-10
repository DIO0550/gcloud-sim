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
    if (!Number.isFinite(seed.amount) || !(seed.amount > 0)) {
      return Result.err(`Invalid value for [--budget-amount]: ${seed.amount}. Must be positive.`);
    }
    const outOfRange = seed.thresholds.find((t) => !Number.isFinite(t) || t < 0 || t > 1);
    if (outOfRange !== undefined) {
      return Result.err(
        `Invalid value for [--threshold-rule]: percent=${outOfRange}. Must be a fraction from 0.0 through 1.0, such as 0.5.`,
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

  /**
   * 額の綴りを数にする（`--budget-amount` の通貨を除いた部分と、Console のフォーム）。
   *
   * @param raw `100000` / `1500.5` のような綴り
   * @returns 正の数。数でない・0 以下なら理由
   */
  parseAmount(raw: string): Result<number, string> {
    const amount = /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : Number.NaN;
    return Number.isFinite(amount) && amount > 0
      ? Result.ok(amount)
      : Result.err(`Invalid value for [--budget-amount]: ${raw}. Must be a positive number.`);
  },

  /** `billingAccounts/A/budgets/ID` の ID 部分。`budgets describe` はこれで引く。 */
  id(budget: Budget): string {
    return budget.name.slice(budget.name.lastIndexOf("/") + 1);
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
