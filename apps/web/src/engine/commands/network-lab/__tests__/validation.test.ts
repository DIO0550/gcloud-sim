// @vitest-environment node
import { expect, test } from "vitest";
import { Now, run, type Session, session } from "@/engine/__tests__/setup";
import { Instance } from "@/engine/domains/compute";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import {
  type NetworkLesson,
  NetworkPrelude,
  NetworkSolutions,
  networkSatisfied,
} from "@/engine/missions/network-lab";
import { Snapshot } from "@/engine/snapshot";

const ready = () => run(session(), ...NetworkPrelude);
const solved = (lesson: NetworkLesson, end?: number) => {
  let s = ready();
  for (const line of NetworkSolutions[lesson].slice(0, end)) {
    s = run(s, line);
    expect(s.text, line).not.toContain("ERROR:");
  }
  return s;
};
const reject = (s: Session, line: string) => {
  const result = run(s, line);
  expect(result.text, line).toContain("ERROR:");
  expect(result.world, line).toBe(s.world);
};
test("policy editing and VPC association require distinct security and network permissions", () => {
  const networkAdmin = run(
    ready(),
    `gcloud projects add-iam-policy-binding ${F.devProjectId} --member=user:${F.developer} --role=roles/compute.networkAdmin`,
  );
  reject(
    networkAdmin,
    `gcloud compute network-firewall-policies create forbidden --global --account=${F.developer}`,
  );
  reject(
    networkAdmin,
    `gcloud compute firewall-rules create forbidden --allow=tcp:80 --account=${F.developer}`,
  );
  const securityAdmin = run(
    ready(),
    `gcloud projects add-iam-policy-binding ${F.devProjectId} --member=user:${F.developer} --role=roles/compute.securityAdmin`,
    `gcloud compute network-firewall-policies create scoped --global --account=${F.developer}`,
  );
  expect(securityAdmin.text).not.toContain("ERROR:");
  const association = `gcloud compute network-firewall-policies associations create scoped-vpc --firewall-policy=scoped --network=default --global-firewall-policy --account=${F.developer}`;
  reject(securityAdmin, association);
  const both = run(
    securityAdmin,
    `gcloud projects add-iam-policy-binding ${F.devProjectId} --member=user:${F.developer} --role=roles/compute.networkAdmin`,
    association,
  );
  expect(both.text).not.toContain("ERROR:");
  expect(both.world.networkLab.policies[0]?.network).toBe("default");
});
test("NAT logging records only checks using the configured NAT", () => {
  const s = run(
    solved("nat"),
    "gcloud compute routers nats delete egress-nat --region=us-central1 --router=egress-router --quiet",
    "gcloud compute routers nats create egress-nat --region=us-central1 --router=egress-router --auto-allocate-nat-external-ips --nat-custom-subnet-ip-ranges=egress-subnet --enable-logging",
    "sim network connectivity egress-worker --zone=us-central1-a --destination=internet",
  );
  expect(s.text).not.toContain("ERROR:");
  expect(s.world.networkLab.logs.at(-1)).toMatchObject({ kind: "NAT", rule: "egress-nat" });
  const noNat = run(
    s,
    "gcloud compute routers nats delete egress-nat --region=us-central1 --router=egress-router --quiet",
    "sim network connectivity egress-worker --zone=us-central1-a --destination=internet",
  );
  expect(noNat.world.networkLab.logs.filter((l) => l.kind === "NAT")).toHaveLength(1);
});
test("Shared VPC describe links identify the host project and SSH uses its firewall", () => {
  const s = run(
    solved("shared"),
    "gcloud compute firewall-rules create host-ssh --network=host --allow=tcp:22 --source-ranges=10.40.0.0/24",
    "gcloud compute ssh service-worker --project=ace-prod-01 --zone=us-central1-a --internal-ip",
  );
  expect(s.text).not.toContain("ERROR:");
  const worker = s.world.instances.find((i) => i.name === "service-worker");
  expect(worker).toBeDefined();
  if (worker) {
    expect(JSON.stringify(Instance.toRecord(worker))).toContain(
      "projects/ace-dev-01/global/networks/host",
    );
  }
});
for (const prefix of ["10.20.0.0/25", "10.22.0.0/23", "10.20.0.1/23", "10.20.0.0/24"]) {
  test(`subnet expansion rejects ${prefix} atomically`, () =>
    reject(
      solved("subnet", 2),
      `gcloud compute networks subnets expand-ip-range private-subnet --region=us-central1 --prefix=${prefix}`,
    ));
}
test("expansion and new subnet reject overlap in active peer VPC even with equal subnet names", () => {
  const s = solved("peering");
  reject(
    s,
    "gcloud compute networks subnets expand-ip-range left-subnet --region=us-central1 --prefix=10.30.0.0/15",
  );
  reject(
    s,
    "gcloud compute networks subnets create overlaps --network=right --region=us-central1 --range=10.30.0.0/24",
  );
});
test("peering creation rejects overlapping subnet ranges", () => {
  const s = run(
    ready(),
    "gcloud compute networks create second --subnet-mode=custom",
    "gcloud compute networks subnets create second-subnet --network=second --region=us-central1 --range=10.128.0.0/24",
  );
  reject(
    s,
    "gcloud compute networks peerings create overlapping --network=default --peer-network=second",
  );
});
for (const flags of [
  "--priority=-1",
  "--priority=65536",
  "--allow=tcp:99999",
  "--allow=tcp:100-20",
  "--allow=tcp:abc",
  "--source-ranges=10.1.1.1/24",
  "--target-tags=app --target-service-accounts=web-sa@ace-dev-01.iam.gserviceaccount.com",
  "--source-service-accounts=missing@example.com",
]) {
  test(`firewall rejects malformed or conflicting configuration: ${flags}`, () =>
    reject(ready(), `gcloud compute firewall-rules create invalid --allow=tcp:80 ${flags}`));
}
test("firewall update is atomic; equal priority deny wins, egress deny blocks even with NAT", () => {
  const s = solved("firewall");
  reject(s, "gcloud compute firewall-rules update secure-allow --priority=65536");
  reject(s, "gcloud compute firewall-rules update secure-allow --allow=tcp:80000");
  const denied = run(
    s,
    "gcloud compute firewall-rules update secure-deny --priority=1000",
    "sim network connectivity secure-client --zone=us-central1-a --destination=secure-server --port=80",
  );
  expect(denied.world.networkLab.checks.at(-1)).toMatchObject({
    allowed: false,
    reason: "firewall:secure-deny",
  });
  expect(networkSatisfied(denied.world, "firewall")).toBe(false);
  const egress = run(
    solved("nat"),
    "gcloud compute firewall-rules create no-egress --network=egress --direction=EGRESS --action=DENY --rules=tcp:443 --destination-ranges=0.0.0.0/0 --enable-logging",
    "sim network connectivity egress-worker --zone=us-central1-a --destination=internet",
  );
  expect(egress.world.networkLab.checks.at(-1)).toMatchObject({
    allowed: false,
    reason: "firewall:no-egress",
  });
});
test("service account source selectors do not apply across a peering", () => {
  const s = run(
    solved("peering"),
    "gcloud compute firewall-rules delete right-web --quiet",
    `gcloud compute firewall-rules create sa-source --network=right --allow=tcp:80 --source-service-accounts=${F.webServiceAccount}`,
    "sim network connectivity left-worker --zone=us-central1-a --destination=right-worker --port=80",
  );
  expect(s.text).not.toContain("ERROR:");
  expect(s.world.networkLab.checks.at(-1)?.allowed).toBe(false);
});
test("removing one peering deactivates both sides; recorded success cannot clear broken configuration", () => {
  const s = run(
    solved("peering"),
    "gcloud compute networks peerings delete right-to-left --network=right --quiet",
  );
  expect(s.world.peerings[0]?.state).toBe("INACTIVE");
  expect(networkSatisfied(s.world, "peering")).toBe(false);
});
test("NAT cannot use the wrong VPC, missing router, wrong project or two allocation scopes", () => {
  const s = solved("nat");
  for (const flags of [
    "--router=missing",
    "--router=egress-router --region=us-central1 --nat-all-subnet-ip-ranges",
    "--router=egress-router --nat-custom-subnet-ip-ranges=default",
    "--router=egress-router --project=ace-prod-01",
  ]) {
    reject(
      s,
      `gcloud compute routers nats create bad-nat --region=us-central1 --auto-allocate-nat-external-ips --nat-custom-subnet-ip-ranges=egress-subnet ${flags}`,
    );
  }
  reject(s, "gcloud compute routers delete egress-router --region=us-central1 --quiet");
  reject(
    s,
    "gcloud compute routers nats describe egress-nat --region=us-central1 --router=missing",
  );
});
test("Private Google Access does not permit internet access; missing default route is diagnosed", () => {
  const s = run(
    solved("subnet"),
    "sim network connectivity private-worker --zone=us-central1-a --destination=internet",
  );
  expect(s.world.networkLab.checks.at(-1)?.allowed).toBe(false);
  const removed = run(
    s,
    "gcloud compute routes delete private-internet --quiet",
    "sim network connectivity private-worker --zone=us-central1-a --destination=google-apis",
  );
  expect(removed.world.networkLab.checks.at(-1)?.reason).toBe("no-default-route");
});
test("Shared VPC requires attachment and host subnet-use permission; dependencies block detach", () => {
  const s = solved("shared");
  reject(
    s,
    "gcloud compute shared-vpc associated-projects remove ace-prod-01 --host-project=ace-dev-01",
  );
  reject(s, "gcloud compute shared-vpc disable ace-dev-01");
  reject(
    s,
    "gcloud compute instances create wrong-host --project=ace-prod-01 --zone=us-central1-a --network=projects/ace-dev-01/global/networks/host --subnet=projects/ace-dev-01/regions/us-east1/subnetworks/host-subnet",
  );
  const dev = run(
    s,
    `gcloud projects add-iam-policy-binding ace-prod-01 --member=user:${F.developer} --role=roles/compute.instanceAdmin.v1`,
  );
  reject(
    dev,
    `gcloud compute instances create forbidden --project=ace-prod-01 --account=${F.developer} --zone=us-central1-a --network=projects/ace-dev-01/global/networks/host --subnet=host-subnet`,
  );
  const cleared = run(
    s,
    "gcloud compute instances delete service-worker --project=ace-prod-01 --zone=us-central1-a --quiet",
    "gcloud compute shared-vpc associated-projects remove ace-prod-01 --host-project=ace-dev-01",
    "gcloud compute shared-vpc disable ace-dev-01",
  );
  expect(cleared.text).not.toContain("ERROR:");
  expect(cleared.world.networkLab.shared).toEqual([]);
});
for (const flags of [
  "--peer-ip-address=169.254.0.1",
  "--peer-ip-address=169.254.1.2",
  "--peer-ip-address=169.254.0.0",
  "--peer-asn=64512",
  "--peer-asn=65000.5",
]) {
  test(`BGP rejects invalid link or ASN: ${flags}`, () =>
    reject(
      solved("vpn", 7),
      `gcloud compute routers add-bgp-peer hybrid-router --region=us-central1 --peer-name=bad-peer --interface=interface-0 --peer-ip-address=169.254.0.2 --peer-asn=64513 ${flags}`,
    ));
}
test("hybrid dependency guards and disconnect recompute reachability", () => {
  const s = solved("vpn");
  reject(s, "gcloud compute vpn-gateways delete ha-gateway --region=us-central1 --quiet");
  reject(s, "gcloud compute external-vpn-gateways delete on-prem --quiet");
  reject(s, "gcloud compute vpn-tunnels delete tunnel-0 --region=us-central1 --quiet");
  reject(
    s,
    "gcloud compute routers remove-interface hybrid-router --region=us-central1 --interface-name=interface-0 --quiet",
  );
  reject(
    s,
    "sim network bgp establish peer-0 --region=us-central1 --router=hybrid-router --remote-prefix=10.70.0.1/24",
  );
  const disconnected = run(
    s,
    "sim network bgp disconnect peer-0 --region=us-central1 --router=hybrid-router",
    "sim network bgp disconnect peer-1 --region=us-central1 --router=hybrid-router",
    "sim network connectivity hybrid-worker --zone=us-central1-a --destination=10.70.0.10",
  );
  expect(disconnected.world.networkLab.checks.at(-1)?.allowed).toBe(false);
  expect(networkSatisfied(disconnected.world, "vpn")).toBe(false);
});
test("Partner Interconnect pending, disabled and wrong ASN states cannot connect", () => {
  const s = solved("interconnect");
  reject(
    s,
    "gcloud compute interconnects attachments partner create wrong-asn --router=partner-router --region=us-east1 --admin-enabled",
  );
  reject(
    s,
    "sim network interconnect activate partner-vlan --region=us-central1 --peer-asn=64514 --remote-prefix=10.71.0.1/24",
  );
  const disabled = run(
    s,
    "gcloud compute interconnects attachments partner update partner-vlan --region=us-central1 --no-admin-enabled",
    "sim network connectivity partner-worker --zone=us-central1-a --destination=10.71.0.10",
  );
  expect(disabled.world.networkLab.checks.at(-1)?.allowed).toBe(false);
});
test("DNS CRUD validates FQDN, TTL, CNAME conflicts, zone reference and private visibility", () => {
  const s = solved("dns");
  for (const command of [
    "gcloud dns record-sets create outside.example. --zone=internal --type=A --rrdatas=10.60.0.3",
    "gcloud dns record-sets create invalid.internal.example. --zone=internal --type=A --rrdatas=999.1.1.1",
    "gcloud dns record-sets update app.internal.example. --zone=internal --type=A --ttl=0 --rrdatas=10.60.0.3",
    "gcloud dns record-sets create app.internal.example. --zone=internal --type=CNAME --rrdatas=other.internal.example.",
    "gcloud dns managed-zones delete internal --quiet",
    "gcloud dns managed-zones update internal --networks=missing",
  ]) {
    reject(s, command);
  }
  const alias = run(
    s,
    "gcloud dns record-sets create alias.internal.example. --zone=internal --type=CNAME --rrdatas=app.internal.example.",
    "sim network connectivity dns-client --zone=us-central1-a --dns-name=alias.internal.example. --port=80",
  );
  expect(alias.world.networkLab.checks.at(-1)?.allowed).toBe(true);
  const unavailable = run(
    s,
    "gcloud dns managed-zones update internal --networks=default",
    "sim network connectivity dns-client --zone=us-central1-a --dns-name=app.internal.example. --port=80",
  );
  expect(unavailable.world.networkLab.checks.at(-1)?.reason).toBe("dns-unresolved");
  const removed = run(
    alias,
    "gcloud dns record-sets delete alias.internal.example. --zone=internal --type=CNAME --quiet",
    "gcloud dns record-sets delete app.internal.example. --zone=internal --type=A --quiet",
    "gcloud dns managed-zones delete internal --quiet",
  );
  expect(removed.text).not.toContain("ERROR:");
});
test("network policy validates priorities/tags, keeps classic ordering and guards associations", () => {
  const s = solved("ngfw");
  reject(s, "gcloud compute network-firewall-policies delete organization-web --global --quiet");
  reject(
    s,
    "gcloud compute network-firewall-policies associations delete wrong --firewall-policy=organization-web --global-firewall-policy --quiet",
  );
  reject(
    s,
    "gcloud compute network-firewall-policies rules create 1000 --firewall-policy=organization-web --action=allow --layer4-configs=all",
  );
  reject(
    s,
    "gcloud compute network-firewall-policies rules create 100 --firewall-policy=organization-web --action=allow --layer4-configs=all --target-secure-tags=untrusted",
  );
  reject(
    s,
    "gcloud compute network-firewall-policies rules create 100 --firewall-policy=organization-web --action=apply_security_profile_group --layer4-configs=all",
  );
  const classic = run(
    s,
    "gcloud compute firewall-rules create classic-deny --network=policy --action=DENY --rules=tcp:80",
    "sim network connectivity policy-client --zone=us-central1-a --destination=policy-server --port=80",
  );
  expect(classic.world.networkLab.checks.at(-1)?.allowed).toBe(false);
  const before = run(
    classic,
    "gcloud compute networks update policy --network-firewall-policy-enforcement-order=BEFORE_CLASSIC_FIREWALL",
    "sim network connectivity policy-client --zone=us-central1-a --destination=policy-server --port=80",
  );
  expect(before.world.networkLab.checks.at(-1)?.allowed).toBe(true);
});
test("API, IAM and project/zone isolation reject state changes", () => {
  const initial = session();
  const disabled = session({
    ...initial.world,
    projects: initial.world.projects.map((p) => ({
      ...p,
      enabledApis: p.enabledApis.filter((api) => api !== "compute.googleapis.com"),
    })),
  });
  reject(
    disabled,
    "gcloud compute routes create unavailable --destination-range=0.0.0.0/0 --next-hop-gateway=default-internet-gateway",
  );
  const s = solved("nat");
  reject(
    s,
    `gcloud compute routes create forbidden --account=${F.developer} --destination-range=0.0.0.0/0 --next-hop-gateway=default-internet-gateway`,
  );
  reject(s, "sim network connectivity egress-worker --zone=us-central1-b --destination=internet");
  reject(
    s,
    "sim network connectivity egress-worker --zone=us-central1-a --destination=internet --port=70000",
  );
});
test("v36 migration retains previous resources; malformed new references cannot import", () => {
  const s = solved("vpn");
  const old = JSON.parse(JSON.stringify(Snapshot.create(s.world, Now)));
  old.schemaVersion = 36;
  delete old.world.networkLab;
  const migrated = Snapshot.fromUnknown(old);
  expect(migrated.ok).toBe(true);
  if (migrated.ok) {
    expect(migrated.value.instances).toEqual(s.world.instances);
    expect(migrated.value.computeLab).toEqual(s.world.computeLab);
    expect(migrated.value.networkLab.gateways).toEqual([]);
  }
  for (const field of ["region", "router", "interface"]) {
    const snapshot = JSON.parse(JSON.stringify(Snapshot.create(s.world, Now)));
    snapshot.world.networkLab.bgpPeers[0][field] = "missing";
    expect(Snapshot.fromUnknown(snapshot).ok, field).toBe(false);
  }
});
