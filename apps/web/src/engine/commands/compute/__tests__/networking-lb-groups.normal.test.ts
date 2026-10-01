// @vitest-environment node
import { expect, test } from "vitest";

import { run, session } from "@/engine/__tests__/setup";
import { World } from "@/engine/domains/world";

test("addresses create --region は RESERVED の外部 IP を予約し、--global はグローバルになる", () => {
  const s = run(
    session(),
    "gcloud compute addresses create web-ip --region=asia-northeast1",
    "gcloud compute addresses create lb-ip --global",
    "gcloud compute addresses list",
  );
  expect(s.text).toMatch(/lb-ip\s+34\.120\.\d+\.\d+\s+EXTERNAL\s+.*RESERVED/);
  expect(s.text).toMatch(/web-ip\s+35\.200\.\d+\.\d+\s+EXTERNAL\s+.*asia-northeast1\s+.*RESERVED/);
});

test("addresses create は --region も --global も無ければ E-004、内部アドレスは 10.146 系", () => {
  const missing = run(session(), "gcloud compute addresses create web-ip");
  expect(missing.text).toContain("argument --region: Must be specified");
  const internal = run(
    session(),
    "gcloud compute addresses create ilb-ip --region=asia-northeast1 --address-type=INTERNAL",
  );
  expect(internal.text).toMatch(/ilb-ip\s+10\.146\.15\.\d+\s+INTERNAL/);
});

test("routers create はネットワークとリージョンを要求し、ASN の既定は 64512", () => {
  const s = run(
    session(),
    "gcloud compute routers create nat-router --network=default --region=asia-northeast1",
    "gcloud compute routers list",
  );
  expect(s.text).toMatch(/nat-router\s+asia-northeast1\s+default/);
  expect(s.world.routers[0]?.asn).toBe(64512);
  const missing = run(
    session(),
    "gcloud compute routers create nat-router --network=nope --region=asia-northeast1",
  );
  expect(missing.text).toContain("networks/nope' was not found");
});

test("peerings create は相手側が無ければ INACTIVE、相手側もこちらを向くと両方 ACTIVE になる", () => {
  const one = run(
    session(),
    "gcloud compute networks create vpc-a --subnet-mode=custom",
    "gcloud compute networks create vpc-b --subnet-mode=custom",
    "gcloud compute networks peerings create a-to-b --network=vpc-a --peer-network=vpc-b",
  );
  expect(one.text).toMatch(/a-to-b\s+vpc-a\s+ace-dev-01\s+vpc-b\s+INACTIVE/);
  const both = run(
    one,
    "gcloud compute networks peerings create b-to-a --network=vpc-b --peer-network=vpc-a",
  );
  expect(both.text).toMatch(/b-to-a\s+vpc-b\s+ace-dev-01\s+vpc-a\s+ACTIVE/);
  expect(both.world.peerings.map((p) => p.state)).toEqual(["ACTIVE", "ACTIVE"]);
});

test("peerings create は自分自身や無いネットワークとは組めない", () => {
  const self = run(
    session(),
    "gcloud compute networks peerings create p --network=default --peer-network=default",
  );
  expect(self.text).toContain("A network cannot peer with itself");
  const missing = run(
    session(),
    "gcloud compute networks peerings create p --network=default --peer-network=ghost",
  );
  expect(missing.text).toContain("networks/ghost' was not found");
});

const lb = [
  "gcloud compute health-checks create hc-http --http --port=8080",
  "gcloud compute backend-services create web-bs --global --protocol=HTTP --health-checks=hc-http",
  "gcloud compute forwarding-rules create web-fr --global --backend-service=web-bs --ports=80",
];

test("health-checks → backend-services → forwarding-rules の順で組むと、転送ルールがバックエンドを指す", () => {
  const s = run(session(), ...lb, "gcloud compute forwarding-rules list");
  expect(s.text).toMatch(/web-fr\s+34\.110\.\d+\.\d+\s+TCP\s+web-bs/);
  expect(s.world.healthChecks[0]?.port).toBe(8080);
  expect(s.world.backendServices[0]?.healthChecks).toEqual(["hc-http"]);
});

test("health-checks create の既定は TCP:80、HTTPS は 443", () => {
  const s = run(
    session(),
    "gcloud compute health-checks create hc-tcp",
    "gcloud compute health-checks create hc-s --https",
  );
  expect(s.world.healthChecks.map((h) => [h.protocol, h.port])).toEqual([
    ["TCP", 80],
    ["HTTPS", 443],
  ]);
});

test("backend-services create は無いヘルスチェックを E-005 にする", () => {
  const s = run(
    session(),
    "gcloud compute backend-services create web-bs --global --health-checks=ghost",
  );
  expect(s.text).toContain("healthChecks/ghost' was not found");
});

test("forwarding-rules create はスコープの違うバックエンドを見つけず、予約アドレスを使うと IN_USE にする", () => {
  const regional = run(
    session(),
    "gcloud compute health-checks create hc --tcp",
    "gcloud compute backend-services create web-bs --global --health-checks=hc",
    "gcloud compute forwarding-rules create web-fr --region=asia-northeast1 --backend-service=web-bs",
  );
  expect(regional.text).toContain("regions/asia-northeast1/backendServices/web-bs' was not found");
  const reserved = run(
    session(),
    "gcloud compute addresses create lb-ip --global",
    ...lb.slice(0, 2),
    "gcloud compute forwarding-rules create web-fr --global --backend-service=web-bs --address=lb-ip",
  );
  expect(reserved.world.forwardingRules[0]?.ipAddress).toBe(reserved.world.addresses[0]?.address);
  expect(reserved.world.addresses[0]?.status).toBe("IN_USE");
});

test("instance-templates create → instance-groups managed create --size=3 で VM が 3 台できる", () => {
  const s = run(
    session(),
    "gcloud compute instance-templates create web-tpl --machine-type=e2-small --tags=http-server",
    "gcloud compute instance-groups managed create web-mig --zone=asia-northeast1-a --template=web-tpl --size=3",
    "gcloud compute instances list",
  );
  const instances = World.instancesOf(s.world, "ace-dev-01");
  expect(instances).toHaveLength(3);
  expect(
    instances.every((i) => i.machineType === "e2-small" && i.tags.includes("http-server")),
  ).toBe(true);
  expect(instances.every((i) => i.name.startsWith("web-mig-"))).toBe(true);
  expect(s.text.match(/RUNNING/g)).toHaveLength(3);
});

test("リージョンの MIG はゾーンに分散して置き、set-autoscaling で autoscaled になる", () => {
  const s = run(
    session(),
    "gcloud compute instance-templates create web-tpl",
    "gcloud compute instance-groups managed create web-mig --region=asia-northeast1 --template=web-tpl --size=3 --base-instance-name=web",
    "gcloud compute instance-groups managed set-autoscaling web-mig --region=asia-northeast1 --max-num-replicas=5 --target-cpu-utilization=0.7",
    "gcloud compute instance-groups managed list",
  );
  const zones = new Set(World.instancesOf(s.world, "ace-dev-01").map((i) => i.zone));
  expect(zones.size).toBe(3);
  expect(s.text).toMatch(/web-mig\s+asia-northeast1\s+region\s+web\s+3\s+3\s+web-tpl\s+yes/);
  expect(s.world.instanceGroups[0]?.autoscaling).toEqual({
    some: true,
    value: { minReplicas: 1, maxReplicas: 5, targetCpuUtilization: 0.7, coolDownPeriodSec: 60 },
  });
});

test("set-autoscaling は max が min より小さいと E-003、無いテンプレートは E-005", () => {
  const bad = run(
    session(),
    "gcloud compute instance-templates create web-tpl",
    "gcloud compute instance-groups managed create web-mig --zone=asia-northeast1-a --template=web-tpl --size=1",
    "gcloud compute instance-groups managed set-autoscaling web-mig --zone=asia-northeast1-a --max-num-replicas=1 --min-num-replicas=3",
  );
  expect(bad.text).toContain("not less than --min-num-replicas (3)");
  const missing = run(
    session(),
    "gcloud compute instance-groups managed create web-mig --zone=asia-northeast1-a --template=ghost --size=1",
  );
  expect(missing.text).toContain("instanceTemplates/ghost' was not found");
});
