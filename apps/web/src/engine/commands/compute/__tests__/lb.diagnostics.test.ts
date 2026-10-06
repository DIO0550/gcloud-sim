// @vitest-environment node
import { expect, test } from "vitest";
import { applicationLb, executeLb } from "@/engine/__tests__/lb.setup";
import { run, type Session, session } from "@/engine/__tests__/setup";
import { type LbRequest, lbHealth, lbProbe } from "@/engine/domains/load-balancing/graph";
import {
  bucketLesson,
  internalLesson,
  lbSatisfied,
  negLesson,
  passthroughLesson,
  tlsLesson,
} from "@/engine/missions/load-balancing";

const request: LbRequest = {
  host: "example.test",
  path: "/",
  port: 80,
  sourceIp: "198.51.100.10",
  network: "",
  region: "",
  minHealthy: 2,
};
const probe = (
  s: Session,
  patch: Partial<LbRequest> = {},
  name = s.world.forwardingRules[0]?.name,
) => {
  const rule = s.world.forwardingRules.find((r) => r.name === name);
  if (rule === undefined) {
    throw new Error("Missing frontend");
  }
  return lbProbe(s.world, rule, { ...request, ...patch });
};
const health = (s: Session, name = s.world.backendServices[0]?.name) => {
  const backend = s.world.backendServices.find((b) => b.name === name);
  if (backend === undefined) {
    throw new Error("Missing backend");
  }
  return lbHealth(s.world, backend);
};
test.each([
  [
    "no listener",
    "sim load-balancing serve web-group --zone=us-central1-a --port=80 --status-code=0",
    "APPLICATION_NOT_RESPONDING",
  ],
  [
    "wrong app port",
    "sim load-balancing serve web-group --zone=us-central1-a --port=8080",
    "HEALTH_CHECK_PORT_MISMATCH",
  ],
  [
    "wrong response path",
    "sim load-balancing serve web-group --zone=us-central1-a --port=80 --path=/healthz",
    "HEALTH_CHECK_RESPONSE_MISMATCH",
  ],
  [
    "HTTP error",
    "sim load-balancing serve web-group --zone=us-central1-a --port=80 --status-code=500",
    "HEALTH_CHECK_RESPONSE_MISMATCH",
  ],
  [
    "wrong named port",
    "gcloud compute instance-groups managed set-named-ports web-group --zone=us-central1-a --named-ports=http:8080",
    "APPLICATION_NOT_RESPONDING",
  ],
  [
    "missing named port",
    "gcloud compute instance-groups managed set-named-ports web-group --zone=us-central1-a --named-ports=other:80",
    "NAMED_PORT_MISSING",
  ],
])("diagnoses %s separately from RUNNING VM state", (label, command, reason) => {
  const wrong = executeLb(applicationLb(), command);
  expect(wrong.world.instances.every((v) => v.status === "RUNNING")).toBe(true);
  expect(health(wrong).every((h) => h.reasons.includes(reason))).toBe(true);
  expect(probe(wrong)).toMatchObject({
    success: false,
    reason: label.includes("named port")
      ? "BACKEND_APPLICATION_NOT_RESPONDING"
      : "INSUFFICIENT_HEALTHY_BACKENDS",
    healthy: label.includes("named port") ? 2 : 0,
  });
  expect(lbSatisfied(wrong.world, "application")).toBe(false);
});
test("TCP checks distinguish an open listener from an HTTP application error", () => {
  const base = executeLb(
    applicationLb(),
    "gcloud compute health-checks create tcp web-tcp --global --port=80",
    "gcloud compute backend-services update web-backend --global --health-checks=web-tcp",
    "sim load-balancing serve web-group --zone=us-central1-a --port=80 --status-code=500",
  );
  expect(health(base).every((h) => h.healthState === "HEALTHY")).toBe(true);
  expect(probe(base)).toMatchObject({
    reason: "BACKEND_APPLICATION_NOT_RESPONDING",
    healthy: 2,
    serving: 0,
  });
  const stopped = executeLb(
    base,
    "sim load-balancing serve web-group --zone=us-central1-a --port=80 --status-code=0",
  );
  expect(
    health(stopped).every((h) => h.healthReasons.includes("HEALTH_CHECK_CONNECTION_FAILED")),
  ).toBe(true);
  expect(probe(stopped).healthy).toBe(0);
});
test("healthy-count threshold exposes one failed member without changing its peer", () => {
  const base = applicationLb();
  const first = base.world.instanceGroups[0]?.instanceNames[0];
  expect(first).toBeDefined();
  const failed = executeLb(
    base,
    `sim load-balancing serve web-group --zone=us-central1-a --instance=${first} --port=80 --status-code=503`,
  );
  expect(health(failed).map((h) => h.healthState)).toEqual(["UNHEALTHY", "HEALTHY"]);
  expect(probe(failed)).toMatchObject({ success: false, healthy: 1 });
  expect(probe(failed, { minHealthy: 1 })).toMatchObject({ success: true, healthy: 1 });
  const restored = executeLb(
    failed,
    `sim load-balancing serve web-group --zone=us-central1-a --instance=${first} --port=80`,
  );
  expect(probe(restored)).toMatchObject({ success: true, healthy: 2 });
});
test.each([
  ["partial sources", "--source-ranges=35.191.0.0/16"],
  ["wrong tags", "--source-ranges=35.191.0.0/16,130.211.0.0/22 --target-tags=other"],
  ["wrong port", "--source-ranges=35.191.0.0/16,130.211.0.0/22 --allow=tcp:8080"],
  ["disabled", "--source-ranges=35.191.0.0/16,130.211.0.0/22 --disabled"],
])("health checks fail for %s firewall", (_, flags) => {
  const base = executeLb(
    applicationLb(),
    "gcloud compute firewall-rules delete web-health --quiet",
  );
  const allow = flags.includes("--allow=") ? "" : "--allow=tcp:80";
  const tags = flags.includes("--target-tags=") ? "" : "--target-tags=web-app";
  const wrong = executeLb(
    base,
    `gcloud compute firewall-rules create bad-health --network=default ${allow} ${tags} ${flags}`,
  );
  expect(health(wrong).every((h) => h.reasons.includes("HEALTH_CHECK_FIREWALL_BLOCKED"))).toBe(
    true,
  );
});
test("narrow deny rules and equal-priority deny prevent full-range health permission", () => {
  const base = applicationLb();
  const denied = executeLb(
    base,
    "gcloud compute firewall-rules create probe-deny --network=default --action=DENY --rules=tcp:80 --source-ranges=35.191.10.0/24 --target-tags=web-app --priority=1000",
  );
  expect(probe(denied).success).toBe(false);
  const override = executeLb(
    denied,
    "gcloud compute firewall-rules create probe-override --network=default --allow=tcp:80 --source-ranges=35.191.10.0/24 --target-tags=web-app --priority=900",
  );
  expect(probe(override).success).toBe(true);
});
test("VM stop removes only one healthy member; restart restores without executing metadata", () => {
  const base = applicationLb();
  const first = base.world.instanceGroups[0]?.instanceNames[0];
  const stopped = executeLb(
    base,
    `gcloud compute instances stop ${first} --zone=us-central1-a --quiet`,
  );
  expect(health(stopped)[0]?.reasons).toContain("VM_NOT_RUNNING");
  expect(probe(stopped).healthy).toBe(1);
  const started = executeLb(
    stopped,
    `gcloud compute instances start ${first} --zone=us-central1-a`,
  );
  expect(probe(started).success).toBe(true);
});
test("passthrough needs original client range independently from healthy probe ranges", () => {
  const built = executeLb(session(), ...passthroughLesson);
  expect(probe(built).success).toBe(true);
  const missing = executeLb(built, "gcloud compute firewall-rules delete nlb-clients --quiet");
  expect(health(missing).every((h) => h.healthState === "HEALTHY")).toBe(true);
  expect(probe(missing)).toMatchObject({
    success: false,
    reason: "BACKEND_TRAFFIC_FIREWALL_OR_PORT_BLOCKED",
    healthy: 2,
  });
  expect(probe(built, { sourceIp: "203.0.113.10" }).success).toBe(false);
});
test("internal healthy checks do not imply proxy-traffic permission or external client reachability", () => {
  const base = executeLb(session(), ...internalLesson);
  const client = { network: "internal-net", region: "us-central1", sourceIp: "10.20.0.10" };
  expect(probe(base, client).success).toBe(true);
  expect(probe(base)).toMatchObject({ reason: "INTERNAL_CLIENT_LOCATION_MISMATCH" });
  expect(probe(base, { ...client, region: "us-east1" }).success).toBe(false);
  expect(probe(base, { ...client, sourceIp: "10.21.0.10" }).success).toBe(false);
  const missing = executeLb(base, "gcloud compute firewall-rules delete internal-traffic --quiet");
  expect(health(missing).every((h) => h.healthState === "HEALTHY")).toBe(true);
  expect(probe(missing, client)).toMatchObject({
    success: false,
    reason: "BACKEND_TRAFFIC_FIREWALL_OR_PORT_BLOCKED",
  });
});
test("NEG endpoint ports, exact host and longest paths choose separate backends", () => {
  const base = executeLb(session(), ...negLesson);
  expect(probe(base).chain).toContain("neg-backend");
  expect(probe(base, { path: "/api/items" }).chain).toContain("neg-api");
  expect(probe(base, { host: "other.test", path: "/api/items" }).chain).toContain("neg-backend");
  const routes = executeLb(
    base,
    "gcloud compute url-maps add-path-matcher neg-map --global --path-matcher-name=catchall --default-service=neg-api --new-hosts='*' --path-rules='/*=neg-api'",
  );
  expect(probe(routes, { host: "other.test", path: "/" }).chain).toContain("neg-api");
  expect(probe(routes, { host: "example.test", path: "/" }).chain).toContain("neg-backend");
  const wrong = executeLb(
    base,
    "sim load-balancing serve neg-api-a --zone=us-central1-a --port=8080",
  );
  expect(probe(wrong, { path: "/api/items" })).toMatchObject({ success: false, healthy: 1 });
});
test("HTTPS refuses PROVISIONING certificates and mismatched hosts, then routes HTTP/CDN backend", () => {
  const pending = executeLb(session(), ...tlsLesson.slice(0, -1));
  expect(probe(pending, { port: 443 })).toMatchObject({
    success: false,
    reason: "TLS_CERTIFICATE_NOT_ACTIVE_OR_HOST_MISMATCH",
  });
  const active = executeLb(pending, ...tlsLesson.slice(-1));
  expect(probe(active, { port: 443 })).toMatchObject({ success: true, cdn: true, healthy: 2 });
  expect(probe(active, { port: 443, host: "other.test" }).success).toBe(false);
  expect(probe(active, { port: 80 })).toMatchObject({ reason: "FRONTEND_PORT_MISMATCH" });
});
test("backend bucket routing needs public viewer grant, and obeys public access prevention", () => {
  const full = executeLb(session(), ...bucketLesson);
  expect(probe(full, { minHealthy: 1 })).toMatchObject({
    success: true,
    selected: "lb-static-data",
    cdn: true,
  });
  const revoked = executeLb(
    full,
    "gcloud storage buckets remove-iam-policy-binding gs://lb-static-data --member=allUsers --role=roles/storage.objectViewer",
  );
  expect(probe(revoked, { minHealthy: 1 })).toMatchObject({
    reason: "BUCKET_PUBLIC_ACCESS_DENIED",
  });
  const prevented = executeLb(
    full,
    "gcloud storage buckets update gs://lb-static-data --public-access-prevention",
  );
  expect(probe(prevented, { minHealthy: 1 })).toMatchObject({
    reason: "BUCKET_PUBLIC_ACCESS_DENIED",
  });
});
test("read-only diagnostic command leaves World untouched and reports the actual chain", () => {
  const base = applicationLb();
  const output = run(base, "sim load-balancing probe web-front --global --min-healthy=2");
  expect(output.world).toEqual(base.world);
  expect(output.text).toContain("success: true");
  expect(output.text).toContain("web-proxy");
});

test("internal two-response lesson rejects proxy traffic allowed to only one healthy VM", () => {
  const full = executeLb(session(), ...internalLesson);
  const firstIp = full.world.instances[0]?.networkInterfaces[0]?.networkIP;
  const partial = session({
    ...full.world,
    firewallRules: full.world.firewallRules.map((f) =>
      f.name === "internal-traffic" ? { ...f, destinationRanges: [`${firstIp}/32`] } : f,
    ),
  });
  const client = { network: "internal-net", region: "us-central1", sourceIp: "10.20.0.10" };
  expect(health(partial).every((h) => h.healthState === "HEALTHY")).toBe(true);
  expect(probe(partial, client)).toMatchObject({
    success: false,
    reason: "BACKEND_TRAFFIC_FIREWALL_OR_PORT_BLOCKED",
    healthy: 2,
    serving: 1,
  });
  expect(probe(partial, { ...client, minHealthy: 1 }).success).toBe(true);
  expect(lbSatisfied(partial.world, "internal")).toBe(false);
});
test("passthrough two-response lesson rejects client traffic allowed to only one healthy VM", () => {
  const full = executeLb(session(), ...passthroughLesson);
  const firstIp = full.world.instances[0]?.networkInterfaces[0]?.networkIP;
  const partial = session({
    ...full.world,
    firewallRules: full.world.firewallRules.map((f) =>
      f.name === "nlb-clients" ? { ...f, destinationRanges: [`${firstIp}/32`] } : f,
    ),
  });
  expect(health(partial).every((h) => h.healthState === "HEALTHY")).toBe(true);
  expect(probe(partial)).toMatchObject({
    success: false,
    reason: "BACKEND_TRAFFIC_FIREWALL_OR_PORT_BLOCKED",
    healthy: 2,
    serving: 1,
  });
  expect(probe(partial, { minHealthy: 1 }).success).toBe(true);
  expect(lbSatisfied(partial.world, "passthrough")).toBe(false);
});
