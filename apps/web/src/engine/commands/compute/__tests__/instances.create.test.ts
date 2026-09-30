// @vitest-environment node
import { expect, test } from "vitest";

import { run, session } from "@/engine/__tests__/setup";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";

const create =
  "gcloud compute instances create web-1 --zone=asia-northeast1-a --machine-type=e2-small --tags=http-server";

test("create は Created と table を出し、list / describe で取れる", () => {
  const s = run(session(), create);
  expect(s.lines[0]?.text).toBe(
    "Created [https://www.googleapis.com/compute/v1/projects/ace-dev-01/zones/asia-northeast1-a/instances/web-1].",
  );
  expect(s.lines[1]?.text).toMatch(
    /^NAME\s+ZONE\s+MACHINE_TYPE\s+PREEMPTIBLE\s+INTERNAL_IP\s+EXTERNAL_IP\s+STATUS$/,
  );
  expect(s.lines[2]?.text).toMatch(
    /^web-1\s+asia-northeast1-a\s+e2-small\s+10\.146\.0\.2\s+34\.84\.\d+\.\d+\s+RUNNING$/,
  );
  const listed = run(s, "gcloud compute instances list");
  expect(listed.text).toContain("web-1");
  const described = run(s, "gcloud compute instances describe web-1 --zone=asia-northeast1-a");
  expect(described.text).toContain("name: web-1");
  expect(described.text).toContain("  - http-server");
});

test("zone がフラグにも config にも無いと E-004 で設定方法を案内する", () => {
  const s = run(session(), "gcloud compute instances create web-1");
  expect(s.text).toContain(
    "ERROR: (gcloud.compute.instances.create) argument --zone: Must be specified.",
  );
  expect(s.text).toContain("gcloud config set compute/zone");
});

test("compute/zone を設定していればフラグ無しで作れる", () => {
  const s = run(
    session(),
    "gcloud config set compute/zone asia-northeast1-b",
    "gcloud compute instances create web-1",
  );
  expect(World.findInstance(s.world, "ace-dev-01", "asia-northeast1-b", "web-1")).not.toEqual(
    Option.none,
  );
});

test("machine-type を省くと e2-medium になる", () => {
  const s = run(session(), "gcloud compute instances create web-1 --zone=asia-northeast1-a");
  expect(
    Option.unwrap(World.findInstance(s.world, "ace-dev-01", "asia-northeast1-a", "web-1"))
      .machineType,
  ).toBe("e2-medium");
});

test("カタログに無い zone は E-005 になる", () => {
  const s = run(session(), "gcloud compute instances create web-1 --zone=mars-central1-a");
  expect(s.text).toContain(
    "The resource 'projects/ace-dev-01/zones/mars-central1-a' was not found",
  );
});

test("カタログに無い machine-type は E-005 になる", () => {
  const s = run(
    session(),
    "gcloud compute instances create web-1 --zone=asia-northeast1-a --machine-type=z9-huge",
  );
  expect(s.text).toContain("machineTypes/z9-huge' was not found");
});

test("同じゾーンに同名を作ると E-008 になる", () => {
  const s = run(session(), create, create);
  expect(s.text).toContain(
    "ERROR: (gcloud.compute.instances.create) The resource 'projects/ace-dev-01/zones/asia-northeast1-a/instances/web-1' already exists",
  );
});

test("別のゾーンなら同名でも作れる", () => {
  const s = run(
    session(),
    create,
    "gcloud compute instances create web-1 --zone=asia-northeast1-b",
  );
  expect(s.text).toContain("Created [");
});

test("Compute API が無効なプロジェクトでは E-007 で enable を案内する", () => {
  const s = run(
    session(),
    "gcloud compute instances create web-1 --zone=asia-northeast1-a --project=ace-prod-01",
  );
  expect(s.text).toContain(
    "Compute Engine API has not been used in project ace-prod-01 before or it is disabled.",
  );
  expect(s.text).toContain("gcloud services enable compute.googleapis.com --project=ace-prod-01");
});

test("--no-address なら外部 IP が付かない", () => {
  const s = run(
    session(),
    "gcloud compute instances create web-1 --zone=asia-northeast1-a --no-address",
  );
  const instance = Option.unwrap(
    World.findInstance(s.world, "ace-dev-01", "asia-northeast1-a", "web-1"),
  );
  expect(instance.networkInterfaces[0]?.externalIP).toEqual({ kind: "none" });
  expect(s.lines[2]?.text).toMatch(/10\.146\.0\.2\s+RUNNING$/);
});

test("--preemptible は table の PREEMPTIBLE に true を出す", () => {
  const s = run(
    session(),
    "gcloud compute instances create web-1 --zone=asia-northeast1-a --preemptible",
  );
  expect(s.lines[2]?.text).toMatch(/e2-medium\s+true\s+10\./);
});

test("--preemptible と --provisioning-model=SPOT は併用できない", () => {
  const s = run(
    session(),
    "gcloud compute instances create web-1 --zone=asia-northeast1-a --preemptible --provisioning-model=SPOT",
  );
  expect(s.text).toContain("--preemptible cannot be combined with --provisioning-model=SPOT.");
});

test("--async はリソースではなくオペレーションを出す", () => {
  const s = run(session(), `${create} --async`);
  expect(s.text).toContain(
    "Instance creation in progress for [web-1]: https://www.googleapis.com/compute/v1/projects/ace-dev-01/zones/asia-northeast1-a/operations/operation-",
  );
  expect(s.text).not.toContain("NAME");
});

test("operations list に insert が DONE で残る", () => {
  const s = run(session(), create, "gcloud compute operations list");
  expect(s.text).toMatch(/operation-\S+\s+insert\s+web-1\s+200\s+DONE/);
});

test("default ネットワークが無ければ E-005 になる", () => {
  const s = run(
    session(),
    "gcloud compute instances create web-1 --zone=asia-northeast1-a --network=vpc-x",
  );
  expect(s.text).toContain(
    "The resource 'projects/ace-dev-01/global/networks/vpc-x' was not found",
  );
});

test("サブネットのリージョンとゾーンのリージョンが違うと E-014 になる", () => {
  const s = run(
    session(),
    "gcloud compute networks create vpc-app --subnet-mode=custom",
    "gcloud compute networks subnets create app-subnet --network=vpc-app --region=us-central1 --range=10.10.0.0/24",
    "gcloud compute instances create web-1 --zone=asia-northeast1-a --network=vpc-app --subnet=app-subnet",
  );
  expect(s.text).toContain(
    "The subnetwork is in region 'us-central1' but the instance zone 'asia-northeast1-a' is in region 'asia-northeast1'.",
  );
});

test("--scopes=cloud-platform はスコープを URL に展開し、省略時は既定の 6 件", () => {
  const custom = run(
    session(),
    "gcloud compute instances create web-1 --zone=asia-northeast1-a --scopes=cloud-platform",
  );
  expect(
    Option.unwrap(World.findInstance(custom.world, "ace-dev-01", "asia-northeast1-a", "web-1"))
      .scopes,
  ).toEqual(["https://www.googleapis.com/auth/cloud-platform"]);
  const plain = run(session(), "gcloud compute instances create web-1 --zone=asia-northeast1-a");
  expect(
    Option.unwrap(World.findInstance(plain.world, "ace-dev-01", "asia-northeast1-a", "web-1"))
      .scopes,
  ).toHaveLength(6);
});

test("存在しないサービスアカウントを付けると E-005 になる", () => {
  const s = run(
    session(),
    "gcloud compute instances create web-1 --zone=asia-northeast1-a --service-account=nope@ace-dev-01.iam.gserviceaccount.com",
  );
  expect(s.text).toContain(
    "serviceAccounts/nope@ace-dev-01.iam.gserviceaccount.com' was not found",
  );
});

test("--filter=status=RUNNING で list を絞れる", () => {
  const s = run(
    session(),
    create,
    "gcloud compute instances create batch-1 --zone=asia-northeast1-b",
    "gcloud compute instances stop batch-1 --zone=asia-northeast1-b",
    'gcloud compute instances list --filter="status=RUNNING"',
  );
  expect(s.text).toContain("web-1");
  expect(s.text).not.toContain("batch-1");
});
