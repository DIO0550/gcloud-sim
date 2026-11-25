// @vitest-environment node
import { expect, test } from "vitest";

import { run, session } from "@/engine/__tests__/setup";
import { Budget } from "@/engine/domains/billing-budget";

const account = "--billing-account=01AB2C-DEF345-6789AB";

test("budgets update は名前・額・しきい値の置換・対象プロジェクトの変更と解除を反映する", () => {
  const created = run(
    session(),
    "gcloud services enable billingbudgets.googleapis.com",
    `gcloud billing budgets create ${account} --display-name='Initial' --budget-amount=100000JPY --filter-projects=ace-dev-01`,
  );
  const createdBudget = created.world.budgets[0];
  expect(createdBudget).toBeDefined();
  const id = createdBudget ? Budget.id(createdBudget) : "";

  const updated = run(
    created,
    `gcloud billing budgets update ${id} ${account} --display-name='Monthly Cap' --budget-amount=250000JPY --clear-threshold-rules --add-threshold-rule=percent=50 --add-threshold-rule=percent=100 --clear-filter-projects`,
  );
  const after = updated.world.budgets[0];
  expect(after?.displayName).toBe("Monthly Cap");
  expect(after?.amount).toBe(250000);
  expect(after?.thresholds).toEqual([0.5, 1]);
  expect(after?.projectIds).toEqual([]);

  const scopedAgain = run(
    updated,
    `gcloud billing budgets update ${id} ${account} --filter-projects=projects/ace-dev-01`,
  );
  expect(scopedAgain.world.budgets[0]?.projectIds).toEqual(["ace-dev-01"]);
});

test("budgets update は存在しないプロジェクトや権限不足を拒む", () => {
  const created = run(
    session(),
    "gcloud services enable billingbudgets.googleapis.com",
    `gcloud billing budgets create ${account} --display-name='Initial' --budget-amount=100000JPY`,
  );
  const id = created.world.budgets[0] ? Budget.id(created.world.budgets[0]) : "";

  expect(
    run(created, `gcloud billing budgets update ${id} ${account} --filter-projects=ghost`).text,
  ).toContain("projects/ghost was not found");

  expect(
    run(
      created,
      `gcloud billing budgets update ${id} ${account} --display-name=Nope --account=dev@example.com`,
    ).text,
  ).toContain("Required 'billing.budgets.update' permission");
});
