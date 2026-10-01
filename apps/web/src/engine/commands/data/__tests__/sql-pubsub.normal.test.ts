// @vitest-environment node
import { expect, test } from "vitest";

import { run, session } from "@/engine/__tests__/setup";

const sqlApi = "gcloud services enable sqladmin.googleapis.com";
const create =
  "gcloud sql instances create db-1 --database-version=POSTGRES_15 --tier=db-f1-micro --region=asia-northeast1";

test("sql instances create は RUNNABLE のインスタンスを作り、list に出る", () => {
  const s = run(session(), sqlApi, create, "gcloud sql instances list");
  expect(s.text).toMatch(
    /db-1\s+POSTGRES_15\s+asia-northeast1-a\s+db-f1-micro\s+35\.243\.\d+\.\d+\s+-\s+RUNNABLE/,
  );
});

test("sql instances create は API 未有効なら E-007、未知の版やティアは E-003、同名は E-008", () => {
  expect(run(session(), create).text).toContain("Cloud SQL Admin API has not been used");
  expect(
    run(
      session(),
      sqlApi,
      "gcloud sql instances create db-1 --database-version=ORACLE_1 --region=asia-northeast1",
    ).text,
  ).toContain("Invalid choice: 'ORACLE_1'");
  expect(run(session(), sqlApi, create, create).text).toContain("already exists");
});

test("backups create はインスタンスにバックアップを足し、delete でインスタンスごと消える", () => {
  const s = run(
    session(),
    sqlApi,
    create,
    "gcloud sql backups create --instance=db-1 --description=nightly",
    "gcloud sql backups list --instance=db-1",
  );
  expect(s.text).toMatch(/\d+\s+2026-09-30T14:02:31\.000Z\s+-\s+SUCCESSFUL/);
  const missing = run(s, "gcloud sql backups create --instance=ghost");
  expect(missing.text).toContain("The Cloud SQL instance does not exist");
  const deleted = run(s, "gcloud sql instances delete db-1 --quiet");
  expect(deleted.world.sqlInstances).toEqual([]);
  expect(deleted.world.sqlBackups).toEqual([]);
});

const pubsubApi = "gcloud services enable pubsub.googleapis.com";

test("pubsub topics create → subscriptions create --topic で繋がり、topic が無ければ E-005", () => {
  const s = run(
    session(),
    pubsubApi,
    "gcloud pubsub topics create events",
    "gcloud pubsub subscriptions create events-sub --topic=events",
    "gcloud pubsub subscriptions list",
  );
  expect(s.text).toMatch(
    /projects\/ace-dev-01\/subscriptions\/events-sub\s+projects\/ace-dev-01\/topics\/events\s+PULL/,
  );
  const missing = run(session(), pubsubApi, "gcloud pubsub subscriptions create s --topic=ghost");
  expect(missing.text).toContain("NOT_FOUND: Resource not found (resource=ghost)");
});

test("pubsub の名前は goog 始まりや 3 文字未満を拒み、topics list に出る", () => {
  const bad = run(session(), pubsubApi, "gcloud pubsub topics create goog-events");
  expect(bad.text).toContain("Invalid resource name given (name=goog-events)");
  const listed = run(
    session(),
    pubsubApi,
    "gcloud pubsub topics create events",
    "gcloud pubsub topics list",
  );
  expect(listed.text).toContain("projects/ace-dev-01/topics/events");
});
