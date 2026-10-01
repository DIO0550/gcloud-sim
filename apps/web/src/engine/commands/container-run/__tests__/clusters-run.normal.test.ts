// @vitest-environment node
import { expect, test } from "vitest";

import { run, session } from "@/engine/__tests__/setup";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";

const enableContainer = "gcloud services enable container.googleapis.com";
const enableRun = "gcloud services enable run.googleapis.com";

test("同名のクラスタは、指定したゾーンに一致するものだけが引ける", () => {
  const s = run(
    session(),
    enableContainer,
    "gcloud container clusters create app --zone=asia-northeast1-a",
    "gcloud container clusters get-credentials app --zone=asia-northeast1-b",
  );
  expect(s.text).toContain(
    "Not found: projects/ace-dev-01/locations/asia-northeast1-b/clusters/app.",
  );
  const matched = run(s, "gcloud container clusters get-credentials app --zone=asia-northeast1-a");
  expect(matched.text).toContain("kubeconfig entry generated for app.");
});

test("--region で作ったリージョン クラスタは --region で引ける", () => {
  const s = run(
    session(),
    enableContainer,
    "gcloud container clusters create-auto app --region=asia-northeast1",
    "gcloud container clusters describe app --region=asia-northeast1",
  );
  expect(s.text).toContain("location: asia-northeast1");
  expect(s.text).toContain("enabled: true");
});

test("ゾーンもリージョンも無ければ E-004 でゾーンの指定を促す", () => {
  const s = run(session(), enableContainer, "gcloud container clusters create app");
  expect(s.text).toContain("argument --zone: Must be specified.");
});

test("run deploy は --region が無ければ run/region を既定にする（compute/region ではない）", () => {
  const s = run(
    session(),
    enableRun,
    "gcloud config set compute/region us-central1",
    "gcloud config set run/region asia-northeast1",
    "gcloud run deploy hello --image=gcr.io/cloudrun/hello",
  );
  expect(Option.unwrap(World.findRunService(s.world, "ace-dev-01", "hello")).region).toBe(
    "asia-northeast1",
  );
  const none = run(session(), enableRun, "gcloud run deploy hello --image=gcr.io/cloudrun/hello");
  expect(none.text).toContain("gcloud config set run/region REGION");
});

test("run deploy を同名で打ち直すと置き換わり、--allow-unauthenticated は前回の値を引き継ぐ", () => {
  const s = run(
    session(),
    enableRun,
    "gcloud run deploy hello --image=gcr.io/cloudrun/hello --region=asia-northeast1 --allow-unauthenticated",
    "gcloud run deploy hello --image=gcr.io/cloudrun/hello:v2 --region=asia-northeast1",
  );
  expect(World.runServicesOf(s.world, "ace-dev-01")).toHaveLength(1);
  expect(Option.unwrap(World.findRunService(s.world, "ace-dev-01", "hello"))).toMatchObject({
    image: "gcr.io/cloudrun/hello:v2",
    allowUnauthenticated: true,
  });
});
