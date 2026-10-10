// @vitest-environment node
import { expect, test } from "vitest";
import { run, session } from "@/engine/__tests__/setup";
import { Dashboard } from "@/engine/domains/monitoring";
import { ObservePrelude, ObserveSolutions } from "@/engine/missions/observability-lab";

const reject = (s: ReturnType<typeof session>, line: string) => {
  const result = run(s, line);
  expect(result.text, line).toContain("ERROR:");
  expect(result.world).toEqual(s.world);
};
test("dashboard update validates latest etag, ownership and supported layout", () => {
  let s = run(
    session(),
    ...ObservePrelude,
    "gcloud monitoring dashboards create --config-from-file=cpu-dashboard.json",
  );
  const dashboard = s.world.dashboards[0];
  if (!dashboard) {
    throw new Error("Missing dashboard");
  }
  const config = { ...Dashboard.toRecord(dashboard), displayName: "Updated CPU" };
  const line = `gcloud monitoring dashboards update ${dashboard.name} --config='${JSON.stringify(config)}'`;
  s = run(s, line);
  expect(s.text).not.toContain("ERROR:");
  expect(s.world.dashboards[0]?.displayName).toBe("Updated CPU");
  reject(s, line);
  reject(
    s,
    `gcloud monitoring dashboards update ${dashboard.name} --project=ace-prod-01 --config='${JSON.stringify(config)}'`,
  );
});
test("uptime updates validate paths, timing, nonempty changes and resource identity", () => {
  let s = run(
    session(),
    ...ObservePrelude,
    "gcloud monitoring uptime create public-web --resource-type=uptime-url --resource-labels=host=example.com,project_id=ace-dev-01 --protocol=https --path=/healthz --period=5",
  );
  const check = s.world.uptimeChecks[0];
  if (!check) {
    throw new Error("Missing uptime");
  }
  s = run(
    s,
    `gcloud monitoring uptime update ${check.name} --display-name=Ready --period=1 --timeout=10 --path=/ready --port=8443`,
  );
  expect(s.text).not.toContain("ERROR:");
  expect(s.world.uptimeChecks[0]).toMatchObject({
    displayName: "Ready",
    period: "60s",
    timeout: "10s",
    path: "/ready",
    port: 8443,
  });
  for (const flags of ["", "--path=invalid", "--timeout=61", "--period=2", "--port=0"]) {
    reject(s, `gcloud monitoring uptime update ${check.name} ${flags}`);
  }
});
test("collector, metric and SLO lifecycles preserve explicit references and bounds", () => {
  let s = run(session(), ...ObservePrelude, ...ObserveSolutions.agent);
  s = run(s, "sim monitoring collectors delete agent --quiet");
  expect(s.text).not.toContain("ERROR:");
  expect(s.world.observabilityLab.collectors).toEqual([]);
  expect(s.world.observabilityLab.points).toHaveLength(1);
  s = run(
    s,
    "sim monitoring metric-descriptors create latency --type=custom.googleapis.com/ace/latency --resource-type=generic_task",
    "sim monitoring time-series write --metric=custom.googleapis.com/ace/latency --resource=api --resource-type=generic_task --value=10",
    "sim monitoring metric-descriptors describe latency",
    "sim monitoring metric-descriptors delete latency --quiet",
  );
  expect(s.text).not.toContain("ERROR:");
  expect(s.world.observabilityLab.descriptors).toEqual([]);
  expect(s.world.observabilityLab.points).toHaveLength(1);
  s = run(
    s,
    ...ObserveSolutions.slo,
    "sim monitoring slos update availability --goal=0.95 --rolling-days=7",
  );
  expect(s.text).not.toContain("ERROR:");
  expect(s.world.observabilityLab.objectives[0]).toMatchObject({
    goal: 0.95,
    rollingSeconds: 604800,
  });
  reject(s, "sim monitoring slos update availability --goal=1");
  s = run(s, "sim monitoring slos delete availability --quiet");
  expect(s.world.observabilityLab.objectives.map((o) => o.name)).toEqual(["windows"]);
});
test("metrics scope linking requires access on both projects", () => {
  const s = run(
    session(),
    ...ObservePrelude,
    "gcloud services enable monitoring.googleapis.com --project=ace-prod-01",
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:dev@example.com --role=roles/monitoring.metricsScopesAdmin",
    "gcloud auth login dev@example.com",
  );
  reject(s, "gcloud beta monitoring metrics-scopes create projects/ace-prod-01");
});
