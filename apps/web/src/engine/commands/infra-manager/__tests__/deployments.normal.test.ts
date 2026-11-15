// @vitest-environment node
import { expect, test } from "vitest";

import { run, session } from "@/engine/__tests__/setup";
import { ExternalIp } from "@/engine/domains/compute";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";

const sa = "projects/ace-dev-01/serviceAccounts/481200000001-compute@developer.gserviceaccount.com";
const lamp = "gs://gcloud-sim-marketplace/lamp-stack-ubuntu/blueprint.tar.gz";
const applyLamp = (inputs = "zone=asia-northeast1-b,machine_type=e2-medium"): string =>
  `gcloud infra-manager deployments apply projects/ace-dev-01/locations/asia-northeast1/deployments/lamp-1 --service-account=${sa} --gcs-source=${lamp} --input-values=${inputs}`;
const enabled = () => run(session(), "gcloud services enable config.googleapis.com");

test("apply は Marketplace のブループリントから VM と HTTP/HTTPS のルールを作り、デプロイメントを記録する", () => {
  const s = run(enabled(), applyLamp());
  expect(s.text).toContain(
    "Creating the deployment [projects/ace-dev-01/locations/asia-northeast1/deployments/lamp-1]...done.",
  );
  const vm = World.findInstance(s.world, "ace-dev-01", "asia-northeast1-b", "lamp-1-vm");
  expect(Option.isSome(vm)).toBe(true);
  const instance = Option.unwrap(vm);
  expect(instance.machineType).toBe("e2-medium");
  expect(instance.tags).toEqual(["lamp-1-deployment"]);
  const ip = ExternalIp.address(instance.networkInterfaces[0]?.externalIP ?? ExternalIp.None);
  expect(Option.isSome(ip)).toBe(true);
  expect(s.text).toContain(`サイトのアドレス http://${Option.unwrap(ip)}/`);
  const http = Option.unwrap(World.findFirewallRule(s.world, "ace-dev-01", "lamp-1-tcp-80"));
  expect(http.targetTags).toEqual(["lamp-1-deployment"]);
  expect(Option.isSome(World.findFirewallRule(s.world, "ace-dev-01", "lamp-1-tcp-443"))).toBe(true);

  const listed = run(s, "gcloud infra-manager deployments list --location=asia-northeast1");
  expect(listed.text).toMatch(/lamp-1\s+ACTIVE/);
  const described = run(
    s,
    "gcloud infra-manager deployments describe lamp-1 --location=asia-northeast1",
  );
  expect(described.text).toContain("name: lamp-1-vm");
  expect(described.text).toContain("inputValue: e2-medium");
});

test("HTTPS を切ればそのルールは作らない。ゾーンがロケーションの外なら作らない", () => {
  const s = run(enabled(), applyLamp("zone=asia-northeast1-a,enable_tcp_443=false"));
  expect(Option.isSome(World.findFirewallRule(s.world, "ace-dev-01", "lamp-1-tcp-80"))).toBe(true);
  expect(Option.isSome(World.findFirewallRule(s.world, "ace-dev-01", "lamp-1-tcp-443"))).toBe(
    false,
  );
  const outside = run(enabled(), applyLamp("zone=us-central1-a"));
  expect(outside.text).toContain("is not in the deployment location asia-northeast1");
  expect(outside.world.instances).toHaveLength(0);
});

test("API が無効なら E-007、知らないブループリントや SA の綴り違いは受けない", () => {
  expect(run(session(), applyLamp()).text).toContain("Infrastructure Manager API");
  expect(run(enabled(), applyLamp().replace(lamp, "gs://other/blueprint.tar.gz")).text).toContain(
    "Blueprint not found",
  );
  expect(
    run(enabled(), applyLamp().replace(sa, "481200000001-compute@developer.gserviceaccount.com"))
      .text,
  ).toContain("Expected projects/{projectID}/serviceAccounts/{email}");
});

test("delete はデプロイメントと、それが作った VM とルールを消す", () => {
  const s = run(
    enabled(),
    applyLamp(),
    "gcloud infra-manager deployments delete lamp-1 --location=asia-northeast1 --quiet",
  );
  expect(s.text).toContain("Deleting the deployment");
  expect(s.world.infraDeployments).toHaveLength(0);
  expect(s.world.instances.some((i) => i.name === "lamp-1-vm")).toBe(false);
  expect(s.world.firewallRules.some((f) => f.name.startsWith("lamp-1-"))).toBe(false);
});
