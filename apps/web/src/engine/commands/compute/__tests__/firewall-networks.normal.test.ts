// @vitest-environment node
import { expect, test } from "vitest";

import { run, session } from "@/engine/__tests__/setup";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";

const rule = (world: World, name: string) =>
  Option.unwrap(World.findFirewallRule(world, "ace-dev-01", name));

test("INGRESS で送信元を省くと 0.0.0.0/0、指定すればその値になる", () => {
  const s = run(
    session(),
    "gcloud compute firewall-rules create open --allow=tcp:80",
    "gcloud compute firewall-rules create narrow --allow=tcp:80 --source-ranges=10.0.0.0/8,192.168.0.0/16",
  );
  expect(rule(s.world, "open").sourceRanges).toEqual(["0.0.0.0/0"]);
  expect(rule(s.world, "narrow").sourceRanges).toEqual(["10.0.0.0/8", "192.168.0.0/16"]);
});

test("EGRESS は destinationRanges を持ち、sourceRanges は空になる", () => {
  const s = run(
    session(),
    "gcloud compute firewall-rules create out --direction=EGRESS --action=DENY --rules=tcp:25 --destination-ranges=0.0.0.0/0",
  );
  expect(rule(s.world, "out")).toMatchObject({
    direction: "EGRESS",
    destinationRanges: ["0.0.0.0/0"],
    sourceRanges: [],
    allowed: [],
    denied: [{ protocol: "tcp", ports: ["25"] }],
  });
});

test("priority は省くと 1000、指定すればその値になる", () => {
  const s = run(
    session(),
    "gcloud compute firewall-rules create p-default --allow=icmp",
    "gcloud compute firewall-rules create p-500 --allow=icmp --priority=500",
  );
  expect(rule(s.world, "p-default").priority).toBe(1000);
  expect(rule(s.world, "p-500").priority).toBe(500);
});

test("--allow と --action の両方を渡す・どちらも渡さないと E-004 になる", () => {
  const both = run(
    session(),
    "gcloud compute firewall-rules create x --allow=icmp --action=ALLOW --rules=icmp",
  );
  expect(both.text).toContain("argument (--action --rules | --allow): Must be specified.");
  const none = run(session(), "gcloud compute firewall-rules create x");
  expect(none.text).toContain("argument (--action --rules | --allow): Must be specified.");
});

test("--boot-disk-size は 1TB を 1024、単位なしを GB、小文字も受け、それ以外は E-003", () => {
  const size = (flag: string) => {
    const s = run(
      session(),
      `gcloud compute instances create vm --zone=asia-northeast1-a --boot-disk-size=${flag}`,
    );
    const instance = World.findInstance(s.world, "ace-dev-01", "asia-northeast1-a", "vm");
    return Option.isSome(instance) ? instance.value.disks[0]?.sizeGb : s.text;
  };
  expect(size("1TB")).toBe(1024);
  expect(size("20")).toBe(20);
  expect(size("10gb")).toBe(10);
  expect(size("10XB")).toContain(
    "argument --boot-disk-size: Invalid value for [--boot-disk-size]: 10XB.",
  );
});

test("--boot-disk-type はカタログ外なら E-003 で、指定した種類がディスクに入る", () => {
  const ssd = run(
    session(),
    "gcloud compute instances create vm --zone=asia-northeast1-a --boot-disk-type=pd-ssd",
  );
  expect(
    Option.unwrap(World.findInstance(ssd.world, "ace-dev-01", "asia-northeast1-a", "vm")).disks[0]
      ?.type,
  ).toBe("pd-ssd");
  const bad = run(
    session(),
    "gcloud compute instances create vm --zone=asia-northeast1-a --boot-disk-type=pd-quantum",
  );
  expect(bad.text).toContain("argument --boot-disk-type: Invalid choice: 'pd-quantum'.");
});

test("サブネットの残るネットワークは消せず、妨げているサブネットが理由に出る", () => {
  const s = run(
    session(),
    "gcloud compute networks create vpc-app --subnet-mode=custom",
    "gcloud compute networks subnets create app-subnet --network=vpc-app --region=asia-northeast1 --range=10.10.0.0/24",
    "gcloud compute networks delete vpc-app --quiet",
  );
  expect(s.text).toContain(
    "is already being used by 'https://www.googleapis.com/compute/v1/projects/ace-dev-01/regions/asia-northeast1/subnetworks/app-subnet'",
  );
  expect(Option.isSome(World.findNetwork(s.world, "ace-dev-01", "vpc-app"))).toBe(true);
});

test("別のネットワークにサブネットがあっても、空のネットワークは消せる", () => {
  const s = run(
    session(),
    "gcloud compute networks create vpc-empty --subnet-mode=custom",
    "gcloud compute networks delete vpc-empty --quiet",
  );
  expect(s.text).toContain("Deleted [");
  expect(World.findNetwork(s.world, "ace-dev-01", "vpc-empty")).toEqual(Option.none);
});

test("同名のネットワークでも別プロジェクトのサブネットは削除を妨げない", () => {
  const s = run(
    session(),
    "gcloud compute networks create shared --subnet-mode=custom",
    "gcloud services enable compute.googleapis.com --project=ace-prod-01",
  );
  const prod = run(
    { ...s, world: Option.unwrap(Option.some({ ...s.world })) },
    "gcloud billing projects link ace-prod-01 --billing-account=01AB2C-DEF345-6789AB",
    "gcloud services enable compute.googleapis.com --project=ace-prod-01",
    "gcloud compute networks create shared --subnet-mode=custom --project=ace-prod-01",
    "gcloud compute networks subnets create s --network=shared --region=us-central1 --range=10.1.0.0/24 --project=ace-prod-01",
    "gcloud compute networks delete shared --quiet",
  );
  expect(prod.text).toContain("Deleted [");
  expect(World.findNetwork(prod.world, "ace-dev-01", "shared")).toEqual(Option.none);
  expect(Option.isSome(World.findNetwork(prod.world, "ace-prod-01", "shared"))).toBe(true);
});
