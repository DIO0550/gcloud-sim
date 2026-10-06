// @vitest-environment node
import { expect, test } from "vitest";

import { run, session } from "@/engine/__tests__/setup";

const zone = "--zone=asia-northeast1-a";
const region = "--region=asia-northeast1";

test("disks describe は独立ディスクとインスタンスのブートディスクのどちらも YAML で出す", () => {
  const s = run(
    session(),
    `gcloud compute disks create data-1 ${zone} --size=200GB`,
    `gcloud compute instances create web-1 ${zone}`,
  );
  const standalone = run(s, `gcloud compute disks describe data-1 ${zone}`);
  expect(standalone.text).toContain("name: data-1");
  expect(standalone.text).toContain('sizeGb: "200"');
  const boot = run(s, `gcloud compute disks describe web-1 ${zone}`);
  expect(boot.text).toContain("name: web-1");
  expect(boot.text).toContain("instances/web-1");
  const missing = run(s, `gcloud compute disks describe nope ${zone}`);
  expect(missing.text).toContain("disks/nope' was not found");
});

test("snapshots describe は作ったスナップショットを出し、無ければ E-005", () => {
  const s = run(
    session(),
    `gcloud compute instances create web-1 ${zone}`,
    `gcloud compute disks snapshot web-1 ${zone} --snapshot-names=snap-1`,
    "gcloud compute snapshots describe snap-1",
  );
  expect(s.text).toContain("name: snap-1");
  expect(run(s, "gcloud compute snapshots describe snap-9").text).toContain(
    "snapshots/snap-9' was not found",
  );
});

test("networks subnets describe はリージョンで引き、別リージョンの名前は E-005", () => {
  const s = run(session(), `gcloud compute networks subnets describe default ${region}`);
  expect(s.text).toContain("name: default");
  expect(s.text).toContain('ipCidrRange: "10.146.0.0/20"');
  const other = run(
    session(),
    "gcloud compute networks subnets describe nope --region=us-central1",
  );
  expect(other.text).toContain("regions/us-central1/subnetworks/nope' was not found");
});

test("addresses / routers describe は作ったものを出す", () => {
  const s = run(
    session(),
    `gcloud compute addresses create web-ip ${region}`,
    `gcloud compute routers create nat-router --network=default ${region}`,
  );
  expect(run(s, `gcloud compute addresses describe web-ip ${region}`).text).toContain(
    "addressType: EXTERNAL",
  );
  expect(run(s, `gcloud compute routers describe nat-router ${region}`).text).toContain(
    "asn: 64512",
  );
  expect(run(s, "gcloud compute addresses describe nope --global").text).toContain(
    "addresses/nope' was not found",
  );
});

test("ロードバランサの部品はそれぞれ describe できる", () => {
  const s = run(
    session(),
    "gcloud compute health-checks create hc --http --port=80",
    "gcloud compute backend-services create web-bes --global --load-balancing-scheme=EXTERNAL_MANAGED --health-checks=hc",
    "gcloud compute url-maps create web-map --global --default-service=web-bes",
    "gcloud compute target-http-proxies create web-proxy --global --url-map=web-map",
    "gcloud compute forwarding-rules create web-fr --global --load-balancing-scheme=EXTERNAL_MANAGED --target-http-proxy=web-proxy",
  );
  expect(run(s, "gcloud compute health-checks describe hc").text).toContain("type: HTTP");
  expect(run(s, "gcloud compute backend-services describe web-bes --global").text).toContain(
    "healthChecks/hc",
  );
  expect(run(s, "gcloud compute forwarding-rules describe web-fr --global").text).toContain(
    "targetHttpProxies/web-proxy",
  );
  expect(run(s, "gcloud compute health-checks describe nope").text).toContain(
    "healthChecks/nope' was not found",
  );
});

test("instance-templates / instance-groups managed describe は作ったものを出す", () => {
  const s = run(
    session(),
    "gcloud compute instance-templates create web-tpl --machine-type=e2-small",
    `gcloud compute instance-groups managed create web-mig --template=web-tpl --size=2 ${zone}`,
  );
  expect(run(s, "gcloud compute instance-templates describe web-tpl").text).toContain(
    "machineType: e2-small",
  );
  expect(run(s, `gcloud compute instance-groups managed describe web-mig ${zone}`).text).toContain(
    "targetSize: 2",
  );
});

test("node-pools describe は default-pool と足したプールを出し、Autopilot には無い", () => {
  const s = run(
    session(),
    "gcloud services enable container.googleapis.com",
    `gcloud container clusters create app ${zone} --quiet`,
    `gcloud container node-pools create batch --cluster=app ${zone} --machine-type=e2-small`,
  );
  expect(
    run(s, `gcloud container node-pools describe default-pool --cluster=app ${zone}`).text,
  ).toContain("name: default-pool");
  expect(run(s, `gcloud container node-pools describe batch --cluster=app ${zone}`).text).toContain(
    "machineType: e2-small",
  );
  expect(run(s, `gcloud container node-pools describe nope --cluster=app ${zone}`).text).toContain(
    "nodePools/nope",
  );
});

test("pubsub topics / subscriptions describe は完全名で出す", () => {
  const s = run(
    session(),
    "gcloud services enable pubsub.googleapis.com",
    "gcloud pubsub topics create orders",
    "gcloud pubsub subscriptions create orders-sub --topic=orders",
  );
  expect(run(s, "gcloud pubsub topics describe orders").text).toContain(
    "name: projects/ace-dev-01/topics/orders",
  );
  expect(run(s, "gcloud pubsub subscriptions describe orders-sub").text).toContain(
    "topic: projects/ace-dev-01/topics/orders",
  );
  expect(run(s, "gcloud pubsub subscriptions describe nope").text).toContain(
    "subscriptions/nope' was not found",
  );
});

test("logging sinks / kms keyrings / dns managed-zones / deployments describe", () => {
  const s = run(
    session(),
    "gcloud services enable logging.googleapis.com cloudkms.googleapis.com dns.googleapis.com deploymentmanager.googleapis.com",
    "gcloud logging sinks create audit-sink storage.googleapis.com/audit-bucket",
    "gcloud kms keyrings create app-ring --location=asia-northeast1",
    "gcloud dns managed-zones create example-zone --dns-name=example.com. --description=x",
    "gcloud deployment-manager deployments create dm-1 --config=config.yaml",
  );
  expect(run(s, "gcloud logging sinks describe audit-sink").text).toContain(
    "destination: storage.googleapis.com/audit-bucket",
  );
  expect(run(s, "gcloud kms keyrings describe app-ring --location=asia-northeast1").text).toContain(
    "keyRings/app-ring",
  );
  expect(run(s, "gcloud kms keyrings describe app-ring --location=global").text).toContain(
    "locations/global/keyRings/app-ring' was not found",
  );
  expect(run(s, "gcloud dns managed-zones describe example-zone").text).toContain(
    "dnsName: example.com.",
  );
  expect(run(s, "gcloud deployment-manager deployments describe dm-1").text).toContain(
    "name: dm-1",
  );
});

test("billing budgets describe は名前の末尾の ID で引く", () => {
  const s = run(
    session(),
    "gcloud billing budgets create --billing-account=01AB2C-DEF345-6789AB --display-name=dev --budget-amount=100000JPY",
    "gcloud billing budgets list --billing-account=01AB2C-DEF345-6789AB",
  );
  const id = /^(\S+-budget)\s/m.exec(s.text)?.[1] ?? "";
  expect(id).not.toBe("");
  const described = run(
    s,
    `gcloud billing budgets describe ${id} --billing-account=01AB2C-DEF345-6789AB`,
  );
  expect(described.text).toContain("displayName: dev");
  expect(
    run(s, "gcloud billing budgets describe nope --billing-account=01AB2C-DEF345-6789AB").text,
  ).toContain("budgets/nope' was not found");
});
