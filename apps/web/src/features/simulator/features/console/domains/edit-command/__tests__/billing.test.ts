// @vitest-environment node
import { expect, test } from "vitest";

import { run, session } from "@/engine/__tests__/setup";
import type { Budget } from "@/engine/domains/billing-budget";
import { BudgetEditForm } from "@/features/simulator/features/console/domains/edit-command/billing";

test("BudgetEditForm はバリデーションと update コマンド生成を行い、エンジンで通る", () => {
  const created = run(
    session(),
    "gcloud services enable billingbudgets.googleapis.com",
    "gcloud billing budgets create --billing-account=01AB2C-DEF345-6789AB --display-name='Dev Budget' --budget-amount=100000JPY --filter-projects=ace-dev-01",
  );
  const budget = created.world.budgets[0] as Budget;
  const initial = BudgetEditForm.fromBudget(budget);

  expect(BudgetEditForm.collectErrors({ ...initial, displayName: "  " }).displayName).toBeDefined();
  expect(BudgetEditForm.collectErrors({ ...initial, amount: "0" }).amount).toBeDefined();
  expect(BudgetEditForm.collectErrors({ ...initial, thresholds: [] }).thresholds).toBeDefined();

  // 名前と金額だけ変更したときは余計な clear フラグを付けない
  const simpleEdit = { ...initial, displayName: "Renamed", amount: "120000" };
  const simpleLine = BudgetEditForm.toCommand(simpleEdit, "01AB2C-DEF345-6789AB", "ace-dev-01");
  expect(simpleLine).not.toContain("--clear-threshold-rules");
  expect(simpleLine).not.toContain("--clear-filter-projects");

  // しきい値と対象プロジェクトも変更したとき
  const fullEdit = {
    ...initial,
    displayName: "Prod Budget",
    amount: "200000",
    thresholds: [0.5, 1],
    projectIds: [],
  };
  expect(BudgetEditForm.collectErrors(fullEdit)).toEqual({});
  const fullLine = BudgetEditForm.toCommand(fullEdit, "01AB2C-DEF345-6789AB", "ace-dev-01");
  expect(fullLine).toContain("--clear-threshold-rules");
  expect(fullLine).toContain("--add-threshold-rule=percent=50");
  expect(fullLine).toContain("--add-threshold-rule=percent=100");
  expect(fullLine).toContain("--clear-filter-projects");

  const after = run(created, fullLine);
  const updated = after.world.budgets[0];
  expect(updated?.displayName).toBe("Prod Budget");
  expect(updated?.amount).toBe(200000);
  expect(updated?.thresholds).toEqual([0.5, 1]);
  expect(updated?.projectIds).toEqual([]);
});
