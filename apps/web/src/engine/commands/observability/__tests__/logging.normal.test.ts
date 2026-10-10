// @vitest-environment node
import { expect, test } from "vitest";

import { run, session } from "@/engine/__tests__/setup";

test("logging read はオペレーション履歴から監査ログを新しい順に出す", () => {
  const s = run(
    session(),
    "gcloud compute instances create web-1 --zone=asia-northeast1-a",
    "gcloud compute instances stop web-1 --zone=asia-northeast1-a",
    "gcloud logging read",
  );
  const methods = s.text.match(/methodName: [^\n]+/g) ?? [];
  expect(methods).toEqual([
    "methodName: v1.compute.instances.stop",
    "methodName: v1.compute.instances.insert",
  ]);
  expect(s.text).toContain("principalEmail: owner@example.com");
});

test("logging read --freshness は綴りを検証し、--limit で件数を絞れる", () => {
  const bad = run(session(), "gcloud logging read --freshness=soon");
  expect(bad.text).toContain("Invalid value: soon");
  const limited = run(
    session(),
    "gcloud compute instances create web-1 --zone=asia-northeast1-a",
    "gcloud compute instances stop web-1 --zone=asia-northeast1-a",
    "gcloud logging read --limit=1",
  );
  expect(limited.text.match(/methodName/g)).toHaveLength(1);
});

test("logging logs list は4種の監査ログとflow/firewallを出す", () => {
  const s = run(session(), "gcloud logging logs list");
  expect(s.text).toContain("projects/ace-dev-01/logs/cloudaudit.googleapis.com%2Factivity");
  expect(s.text.split("\n")).toHaveLength(6);
  expect(s.text).toContain("cloudaudit.googleapis.com%2Fpolicy");
  expect(s.text).toContain("compute.googleapis.com%2Fvpc_flows");
  expect(s.text).toContain("compute.googleapis.com%2Ffirewall");
});

test("sinks create は Storage / BigQuery / Pub/Sub の転送先だけを受け、list に出る", () => {
  const s = run(
    session(),
    "gcloud logging sinks create audit-sink storage.googleapis.com/my-logs --log-filter='severity>=ERROR'",
    "gcloud logging sinks list",
  );
  expect(s.text).toMatch(/audit-sink\s+storage\.googleapis\.com\/my-logs\s+severity>=ERROR/);
  const bad = run(session(), "gcloud logging sinks create s ftp://nowhere");
  expect(bad.text).toContain("Expected storage.googleapis.com/BUCKET");
});

test("monitoring の一覧は空で、API 未有効なら E-007", () => {
  expect(run(session(), "gcloud monitoring dashboards list").text).toBe("Listed 0 items.");
  expect(run(session(), "gcloud monitoring policies list --project=ace-prod-01").text).toContain(
    "Cloud Monitoring API has not been used",
  );
});
