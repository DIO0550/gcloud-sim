// @vitest-environment node
import { expect, test } from "vitest";

import { run, session } from "@/engine/__tests__/setup";
import { Option } from "@/utils/Option";

test("version は SDK の版と入っているコンポーネントを出す", () => {
  const s = run(session(), "gcloud version");
  expect(s.text).toContain("Google Cloud SDK 540.0.0");
  expect(s.text).toContain("gsutil 5.35");
  expect(s.text).not.toContain("kubectl");
});

test("components install は知っている id を Installed にし、未知の id は E-003", () => {
  const s = run(session(), "gcloud components install kubectl", "gcloud components list");
  expect(s.text).toMatch(/Installed\s+kubectl\s+kubectl/);
  expect(s.world.session.components).toEqual(["kubectl"]);
  expect(run(session(), "gcloud components install helm").text).toContain(
    "The following components are unknown [helm]",
  );
  expect(run(session(), "gcloud components update").text).toContain(
    "All components are up to date.",
  );
});

test("info と init は現在の設定を出し、対話はしない", () => {
  const info = run(session(), "gcloud info");
  expect(info.text).toContain("Account: [owner@example.com]");
  expect(info.text).toContain("Project: [ace-dev-01]");
  const start = session();
  const init = run(start, "gcloud init");
  expect(init.text).toContain(
    "Welcome! This command will take you through the configuration of gcloud.",
  );
  expect(init.text).toContain("project = ace-dev-01");
  expect(init.world).toEqual(start.world);
});

test("auth activate-service-account はサンプルの key.json で web-sa になり、無いファイルは E-005", () => {
  const s = run(
    session(),
    "gcloud auth activate-service-account --key-file=key.json",
    "gcloud auth list",
  );
  expect(s.text).toMatch(/\*\s+web-sa@ace-dev-01\.iam\.gserviceaccount\.com/);
  const missing = run(session(), "gcloud auth activate-service-account --key-file=x.json");
  expect(missing.text).toContain("No such file or directory: 'x.json'");
  const mismatch = run(
    session(),
    "gcloud auth activate-service-account other@ace-dev-01.iam.gserviceaccount.com --key-file=key.json",
  );
  expect(mismatch.text).toContain("does not match the account in the key file");
});

test("application-default login はアクティブなアカウントを ADC として記録し、未選択なら E-004", () => {
  const s = run(session(), "gcloud auth application-default login");
  expect(s.text).toContain(
    "Credentials saved to file: [~/.config/gcloud/application_default_credentials.json]",
  );
  expect(s.world.session.adc).toEqual(Option.some("owner@example.com"));
  const none = run(
    session(),
    "gcloud config unset account",
    "gcloud auth application-default login",
  );
  expect(none.text).toContain("You do not currently have an active account selected.");
});
