// @vitest-environment node
import { expect, test } from "vitest";

import { run, session } from "@/engine/__tests__/setup";

test("kms keyrings create はロケーションごとに作り、list はそのロケーションだけを出す", () => {
  const s = run(
    session(),
    "gcloud services enable cloudkms.googleapis.com",
    "gcloud kms keyrings create app-ring --location=asia-northeast1",
    "gcloud kms keyrings create global-ring --location=global",
    "gcloud kms keyrings list --location=asia-northeast1",
  );
  expect(s.text).toContain("projects/ace-dev-01/locations/asia-northeast1/keyRings/app-ring");
  expect(s.text).not.toContain("global-ring");
  expect(run(s, "gcloud kms keyrings create app-ring --location=asia-northeast1").text).toContain(
    "already exists",
  );
  expect(run(s, "gcloud kms keyrings create r --location=mars").text).toContain(
    "locations/mars' was not found",
  );
});

test("dns managed-zones create は末尾ドットの DNS 名を要求し、list に出る", () => {
  const s = run(
    session(),
    "gcloud services enable dns.googleapis.com",
    "gcloud dns managed-zones create example-zone --dns-name=example.com. --description='main zone'",
    "gcloud dns managed-zones list",
  );
  expect(s.text).toMatch(/example-zone\s+example\.com\.\s+main zone\s+public/);
  const bad = run(
    session(),
    "gcloud services enable dns.googleapis.com",
    "gcloud dns managed-zones create z --dns-name=example.com --description=x",
  );
  expect(bad.text).toContain("must be a fully qualified domain name ending with a dot");
});

test("deployment-manager deployments create はサンプルの config.yaml だけを受け、list に出る", () => {
  const s = run(
    session(),
    "gcloud services enable deploymentmanager.googleapis.com",
    "gcloud deployment-manager deployments create web-dm --config=config.yaml",
    "gcloud deployment-manager deployments list",
  );
  expect(s.text).toMatch(/web-dm\s+insert\s+DONE/);
  const missing = run(
    session(),
    "gcloud services enable deploymentmanager.googleapis.com",
    "gcloud deployment-manager deployments create web-dm --config=other.yaml",
  );
  expect(missing.text).toContain("No such file or directory: 'other.yaml'");
});

test("これらの API は請求のリンクが無いプロジェクトでは有効化できない（E-016）", () => {
  const s = run(session(), "gcloud services enable cloudkms.googleapis.com --project=ace-prod-01");
  expect(s.text).toContain("Billing must be enabled");
});
