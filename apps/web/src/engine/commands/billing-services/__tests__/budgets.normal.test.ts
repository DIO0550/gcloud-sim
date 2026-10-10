// @vitest-environment node
import { expect, test } from "vitest";

import { run, session } from "@/engine/__tests__/setup";

const account = "--billing-account=01AB2C-DEF345-6789AB";

test("budgets create は請求アカウントに予算を足し、しきい値の既定は 50/90/100%", () => {
  const s = run(
    session(),
    `gcloud billing budgets create ${account} --display-name='Dev budget' --budget-amount=100000JPY --filter-projects=ace-dev-01`,
    `gcloud billing budgets list ${account}`,
  );
  expect(s.text).toMatch(/\S+-budget\s+Dev budget\s+100000\s+JPY/);
  expect(s.world.budgets[0]?.thresholds).toEqual([0.5, 0.9, 1]);
  expect(s.world.budgets[0]?.projectIds).toEqual(["ace-dev-01"]);
});

test("budgets create は額・しきい値・請求アカウント・プロジェクトを検証する", () => {
  expect(
    run(session(), `gcloud billing budgets create ${account} --display-name=x --budget-amount=lots`)
      .text,
  ).toContain("Expected a number");
  expect(
    run(
      session(),
      `gcloud billing budgets create ${account} --display-name=x --budget-amount=100 --threshold-rule=percent=2`,
    ).text,
  ).toContain("Must be a fraction from 0.0 through 1.0");
  expect(
    run(
      session(),
      "gcloud billing budgets create --billing-account=NOPE --display-name=x --budget-amount=100",
    ).text,
  ).toContain("billingAccounts/NOPE' was not found");
  expect(
    run(
      session(),
      `gcloud billing budgets create ${account} --display-name=x --budget-amount=100 --filter-projects=ghost`,
    ).text,
  ).toContain("projects/ghost' was not found");
});

test("billing.budgets.create を持たない主体は E-006", () => {
  const s = run(
    session(),
    `gcloud billing budgets create ${account} --display-name=x --budget-amount=100 --account=dev@example.com`,
  );
  expect(s.text).toContain("Required 'billing.budgets.create' permission");
});
