// @vitest-environment node
import { expect, test } from "vitest";

import { Engine } from "@/engine";
import { initialWorld, run, session } from "@/engine/__tests__/setup";
import { World } from "@/engine/domains/world";
import { Result } from "@/utils/Result";

const started = (id: string) => session(Result.unwrap(Engine.startMission(initialWorld(), id)));
const statusOf = (s: ReturnType<typeof run>, id: string) => World.findMissionProgress(s.world, id);

const zone = "--zone=asia-northeast1-a";

test("m-setup-003 は額が 100000 JPY の予算でクリアになり、額が違えばならない", () => {
  const wrong = run(
    started("m-setup-003"),
    "gcloud billing budgets create --billing-account=01AB2C-DEF345-6789AB --display-name=x --budget-amount=50000JPY",
  );
  expect(statusOf(wrong, "m-setup-003")).toMatchObject({ value: { status: "in_progress" } });
  const right = run(
    wrong,
    "gcloud billing budgets create --billing-account=01AB2C-DEF345-6789AB --display-name=monthly --budget-amount=100000JPY",
  );
  expect(statusOf(right, "m-setup-003")).toMatchObject({ value: { status: "completed" } });
});

test("m-plan-003 はトピックと、それを購読するサブスクリプションでクリアになる", () => {
  const s = run(
    started("m-plan-003"),
    "gcloud services enable pubsub.googleapis.com",
    "gcloud pubsub topics create orders",
    "gcloud pubsub topics create other",
    "gcloud pubsub subscriptions create orders-worker --topic=other",
  );
  expect(statusOf(s, "m-plan-003")).toMatchObject({ value: { status: "in_progress" } });
  const right = run(
    started("m-plan-003"),
    "gcloud services enable pubsub.googleapis.com",
    "gcloud pubsub topics create orders",
    "gcloud pubsub subscriptions create orders-worker --topic=orders",
  );
  expect(statusOf(right, "m-plan-003")).toMatchObject({ value: { status: "completed" } });
});

test("m-deploy-004 は 3 レプリカと LoadBalancer の Service が揃ってクリアになる", () => {
  const base = run(
    started("m-deploy-004"),
    "gcloud services enable container.googleapis.com",
    `gcloud container clusters create app ${zone} --quiet`,
    `gcloud container clusters get-credentials app ${zone}`,
    "kubectl apply -f deployment.yaml",
    "kubectl expose deployment web --type=LoadBalancer --port=80",
  );
  expect(statusOf(base, "m-deploy-004")).toMatchObject({ value: { status: "in_progress" } });
  const scaled = run(base, "kubectl scale deployment web --replicas=3");
  expect(statusOf(scaled, "m-deploy-004")).toMatchObject({ value: { status: "completed" } });
});

test("m-deploy-005 は未認証許可の HTTP 関数でクリアになり、トピックトリガーではならない", () => {
  const topic = run(
    started("m-deploy-005"),
    "gcloud services enable cloudfunctions.googleapis.com pubsub.googleapis.com",
    "gcloud pubsub topics create t",
    "gcloud functions deploy hello --runtime=python312 --trigger-topic=t --region=asia-northeast1",
  );
  expect(statusOf(topic, "m-deploy-005")).toMatchObject({ value: { status: "in_progress" } });
  const http = run(
    topic,
    "gcloud functions deploy hello --runtime=python312 --trigger-http --allow-unauthenticated --region=asia-northeast1",
  );
  expect(statusOf(http, "m-deploy-005")).toMatchObject({ value: { status: "completed" } });
});

test("m-deploy-006 は MySQL 8.0 の app-db でクリアになる", () => {
  const s = run(
    started("m-deploy-006"),
    "gcloud services enable sqladmin.googleapis.com",
    "gcloud sql instances create app-db --database-version=MYSQL_8_0 --region=asia-northeast1",
  );
  expect(statusOf(s, "m-deploy-006")).toMatchObject({ value: { status: "completed" } });
});

test("m-ops-003 は MIG に自動スケーリングを付けた時点でクリアになる", () => {
  const base = run(
    started("m-ops-003"),
    "gcloud compute instance-templates create web-tpl --machine-type=e2-small",
    `gcloud compute instance-groups managed create web-mig --template=web-tpl --size=2 ${zone}`,
  );
  expect(statusOf(base, "m-ops-003")).toMatchObject({ value: { status: "in_progress" } });
  const scaled = run(
    base,
    `gcloud compute instance-groups managed set-autoscaling web-mig --max-num-replicas=5 ${zone}`,
  );
  expect(statusOf(scaled, "m-ops-003")).toMatchObject({ value: { status: "completed" } });
});

test("m-iam-003 はカスタムロールの作成と付与でクリアになり、権限が足りなければならない", () => {
  const partial = run(
    started("m-iam-003"),
    "gcloud iam roles create vmOperator --project=ace-dev-01 --title=VMOperator --permissions=compute.instances.start",
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:dev@example.com --role=projects/ace-dev-01/roles/vmOperator",
  );
  expect(statusOf(partial, "m-iam-003")).toMatchObject({ value: { status: "in_progress" } });
  const full = run(
    started("m-iam-003"),
    "gcloud iam roles create vmOperator --project=ace-dev-01 --title=VMOperator --permissions=compute.instances.start,compute.instances.stop,compute.instances.get,compute.instances.list",
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:dev@example.com --role=projects/ace-dev-01/roles/vmOperator",
  );
  expect(statusOf(full, "m-iam-003")).toMatchObject({ value: { status: "completed" } });
});
