// @vitest-environment node
import { expect, test } from "vitest";

import { run, session } from "@/engine/__tests__/setup";

const functionsApi = "gcloud services enable cloudfunctions.googleapis.com";
const deploy =
  "gcloud functions deploy hello --runtime=nodejs20 --trigger-http --region=asia-northeast1";

test("functions deploy は API 未有効なら E-007、有効なら URL を出して call が結果を返す", () => {
  const disabled = run(session(), deploy);
  expect(disabled.text).toContain("Cloud Functions API has not been used in project ace-dev-01");
  const deployed = run(session(), functionsApi, deploy);
  expect(deployed.text).toContain(
    "url: https://asia-northeast1-ace-dev-01.cloudfunctions.net/hello",
  );
  const called = run(
    deployed,
    'gcloud functions call hello --region=asia-northeast1 --data=\'{"name":"ace"}\'',
  );
  expect(called.text).toContain("result: Hello from hello (nodejs20)");
});

test("--trigger-topic は topic が無ければ E-005、あれば eventTrigger を持つ", () => {
  const missing = run(
    session(),
    functionsApi,
    "gcloud functions deploy sub --runtime=python312 --trigger-topic=events --region=asia-northeast1",
  );
  expect(missing.text).toContain("topics/events does not exist");
  const ok = run(
    missing,
    "gcloud services enable pubsub.googleapis.com",
    "gcloud pubsub topics create events",
    "gcloud functions deploy sub --runtime=python312 --trigger-topic=events --region=asia-northeast1",
    "gcloud functions list",
  );
  expect(ok.text).toMatch(/sub\s+ACTIVE\s+topic: events\s+asia-northeast1/);
});

test("トリガーを両方付ける・どちらも付けないは E-004、未知のランタイムは E-003", () => {
  const none = run(
    session(),
    functionsApi,
    "gcloud functions deploy f --runtime=nodejs20 --region=asia-northeast1",
  );
  expect(none.text).toContain("(--trigger-http | --trigger-topic)");
  const runtime = run(
    session(),
    functionsApi,
    "gcloud functions deploy f --runtime=cobol --trigger-http --region=asia-northeast1",
  );
  expect(runtime.text).toContain("Invalid choice: 'cobol'");
});

test("同じ名前へ再デプロイすると versionId が上がり、delete で消える", () => {
  const twice = run(
    session(),
    functionsApi,
    deploy,
    deploy,
    "gcloud functions describe hello --region=asia-northeast1",
  );
  expect(twice.text).toContain('versionId: "2"');
  const deleted = run(
    twice,
    "gcloud functions delete hello --region=asia-northeast1 --quiet",
    "gcloud functions list",
  );
  expect(deleted.text).toBe("Listed 0 items.");
});

test("functions の region は functions/region の設定からも決まる", () => {
  const s = run(
    session(),
    functionsApi,
    "gcloud config set functions/region asia-northeast1",
    "gcloud functions deploy hello --runtime=nodejs20 --trigger-http",
  );
  expect(s.text).toContain("name: projects/ace-dev-01/locations/asia-northeast1/functions/hello");
});

const appApi = "gcloud services enable appengine.googleapis.com";

test("app deploy は初回に --region が要り、2 回目はバージョンが増えて新しいものが 100% を受ける", () => {
  const noRegion = run(session(), appApi, "gcloud app deploy app.yaml");
  expect(noRegion.text).toContain("argument --region: Must be specified");
  const first = run(noRegion, "gcloud app deploy app.yaml --region=asia-northeast1 --version=v1");
  expect(first.text).toContain(
    "Creating App Engine application in project [ace-dev-01] and region [asia-northeast1]",
  );
  expect(first.text).toContain(
    "Deployed service [default] to [https://ace-dev-01.an.r.appspot.com]",
  );
  const second = run(first, "gcloud app deploy --version=v2", "gcloud app versions list");
  expect(second.text).toMatch(/default\s+v1\s+0\s+/);
  expect(second.text).toMatch(/default\s+v2\s+1\s+/);
});

test("app deploy の無いファイルは E-005、browse は URL を出す", () => {
  const missing = run(session(), appApi, "gcloud app deploy nope.yaml --region=asia-northeast1");
  expect(missing.text).toContain("[nope.yaml] could not be found");
  const browse = run(
    session(),
    appApi,
    "gcloud app deploy --region=asia-northeast1",
    "gcloud app browse",
  );
  expect(browse.text).toContain("https://ace-dev-01.an.r.appspot.com");
  const noApp = run(session(), appApi, "gcloud app browse");
  expect(noApp.text).toContain("does not contain an App Engine application");
});

test("services set-traffic は合計 1 の配分だけを受け、パーセント表記も合計 100 なら受ける", () => {
  const s = run(
    session(),
    appApi,
    "gcloud app deploy --region=asia-northeast1 --version=v1",
    "gcloud app deploy --version=v2",
  );
  const bad = run(s, "gcloud app services set-traffic default --splits=v1=0.5,v2=0.7");
  expect(bad.text).toContain("Traffic splits must sum to 1");
  const ok = run(
    s,
    "gcloud app services set-traffic default --splits=v1=50,v2=50",
    "gcloud app versions list",
  );
  expect(ok.text).toMatch(/v1\s+0\.5\s+/);
  expect(ok.text).toMatch(/v2\s+0\.5\s+/);
  const unknown = run(s, "gcloud app services set-traffic default --splits=v9=1");
  expect(unknown.text).toContain("Version [v9] of service [default] not found");
});
