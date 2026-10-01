// @vitest-environment node
import { expect, test } from "vitest";

import { run, session } from "@/engine/__tests__/setup";

const base = [
  "gcloud services enable container.googleapis.com",
  "gcloud container clusters create app --zone=asia-northeast1-a --num-nodes=2",
];

test("clusters resize はノード数を替え、Autopilot は拒む", () => {
  const s = run(
    session(),
    ...base,
    "gcloud container clusters resize app --zone=asia-northeast1-a --num-nodes=5 --quiet",
    "gcloud container clusters list",
  );
  expect(s.text).toMatch(/app\s+asia-northeast1-a\s+\S+\s+\S+\s+e2-medium\s+\S+\s+5\s+RUNNING/);
  const auto = run(
    session(),
    base[0] ?? "",
    "gcloud container clusters create-auto ap --region=asia-northeast1",
    "gcloud container clusters resize ap --region=asia-northeast1 --num-nodes=1 --quiet",
  );
  expect(auto.text).toContain("is an Autopilot cluster");
});

test("clusters upgrade はマスターを 1 つ先の版へ上げ、2 回目は最新だと拒む", () => {
  const once = run(
    session(),
    ...base,
    "gcloud container clusters upgrade app --zone=asia-northeast1-a --master --quiet",
  );
  expect(once.text).toContain("Master version: 1.32.2-gke.1182000");
  const twice = run(
    once,
    "gcloud container clusters upgrade app --zone=asia-northeast1-a --master --quiet",
  );
  expect(twice.text).toContain("already on the latest available version");
});

test("node-pools create はクラスタにプールを足し、list は default-pool と一緒に出す", () => {
  const s = run(
    session(),
    ...base,
    "gcloud container node-pools create high-mem --cluster=app --zone=asia-northeast1-a --machine-type=n2-standard-4 --num-nodes=1",
    "gcloud container node-pools list --cluster=app --zone=asia-northeast1-a",
  );
  expect(s.text).toMatch(/default-pool\s+e2-medium\s+100/);
  expect(s.text).toMatch(/high-mem\s+n2-standard-4\s+100/);
  expect(
    run(s, "gcloud container node-pools create default-pool --cluster=app --zone=asia-northeast1-a")
      .text,
  ).toContain("already exists");
  expect(
    run(s, "gcloud container node-pools create p --cluster=ghost --zone=asia-northeast1-a").text,
  ).toContain("Not found");
});
