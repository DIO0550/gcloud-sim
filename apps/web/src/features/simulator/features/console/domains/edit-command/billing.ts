import { Budget } from "@/engine/domains/billing-budget";
import {
  collect,
  errorOf,
  type FieldErrors,
  flag,
  quote,
} from "@/features/simulator/features/console/domains/equivalent-command";
import { Option } from "@/utils/Option";

const sameList = <T>(a: readonly T[], b: readonly T[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

// --- 予算編集 ---

export type BudgetEditForm = Readonly<{
  budgetId: string;
  displayName: string;
  amount: string;
  thresholds: readonly number[];
  projectIds: readonly string[];
  originalThresholds: readonly number[];
  originalProjectIds: readonly string[];
}>;

export const BudgetEditForm = {
  create(): BudgetEditForm {
    return {
      budgetId: "",
      displayName: "",
      amount: "100000",
      thresholds: [0.5, 0.9, 1],
      projectIds: [],
      originalThresholds: [0.5, 0.9, 1],
      originalProjectIds: [],
    };
  },

  /** 既存の予算から編集フォームの初期値を作る。 */
  fromBudget(budget: Budget): BudgetEditForm {
    return {
      budgetId: Budget.id(budget),
      displayName: budget.displayName,
      amount: String(budget.amount),
      thresholds: [...budget.thresholds],
      projectIds: [...budget.projectIds],
      originalThresholds: [...budget.thresholds],
      originalProjectIds: [...budget.projectIds],
    };
  },

  collectErrors(form: BudgetEditForm): FieldErrors<BudgetEditForm> {
    return collect<BudgetEditForm>([
      [
        "displayName",
        form.displayName.trim() === "" ? Option.some("名前を入れてください。") : Option.none,
      ],
      ["amount", errorOf(Budget.parseAmount(form.amount))],
      [
        "thresholds",
        form.thresholds.length === 0
          ? Option.some("しきい値を 1 つ以上選んでください。")
          : Option.none,
      ],
    ]);
  },

  /** `gcloud billing budgets update BUDGET_ID --billing-account=... --display-name=... --budget-amount=...` */
  toCommand(form: BudgetEditForm, billingAccountId: string, projectId?: string): string {
    const thresholdsChanged = !sameList(form.thresholds, form.originalThresholds);
    const projectsChanged = !sameList(form.projectIds, form.originalProjectIds);
    const parts = [
      "gcloud billing budgets update",
      quote(form.budgetId),
      flag("billing-account", billingAccountId),
      ...(projectId === undefined ? [] : [flag("project", projectId)]),
      flag("display-name", form.displayName),
      flag("budget-amount", `${form.amount}JPY`),
      ...(thresholdsChanged
        ? [
            "--clear-threshold-rules",
            ...form.thresholds.map((t) =>
              flag("add-threshold-rule", `percent=${Math.round(t * 100)}`),
            ),
          ]
        : []),
      ...(projectsChanged
        ? form.projectIds.length === 0
          ? ["--clear-filter-projects"]
          : [flag("filter-projects", form.projectIds.map((id) => `projects/${id}`).join(","))]
        : []),
    ];
    return parts.join(" ");
  },
} as const;
