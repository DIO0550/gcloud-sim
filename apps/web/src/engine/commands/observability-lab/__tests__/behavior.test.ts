// @vitest-environment node
import { expect, test } from "vitest";
import { run, type Session, session } from "@/engine/__tests__/setup";
import { collectorStatus } from "@/engine/domains/observability-lab/collectors";
import { evaluateAlert, objectiveResult } from "@/engine/domains/observability-lab/evaluation";
import { storedLogs } from "@/engine/domains/observability-lab/logging";
import { ObserveCpuMetric } from "@/engine/domains/observability-lab/model";
import {
  ObservePolicyFile,
  ObservePrelude,
  ObserveSolutions,
  ObserveThreshold,
  observeSatisfied,
} from "@/engine/missions/observability-lab";

const prepared = () => run(session(), ...ObservePrelude);
const solved = (lesson: keyof typeof ObserveSolutions) =>
  run(prepared(), ...ObserveSolutions[lesson]);
const reject = (s: Session, line: string) => {
  const result = run(s, line);
  expect(result.text, line).toContain("ERROR:");
  expect(result.world).toEqual(s.world);
};
const policy = (s: Session) => {
  const config = s.world.observabilityLab.policies[0];
  if (!config) {
    throw new Error("Missing policy fixture");
  }
  return config;
};

test("notification requires a current evaluation, verification, enablement and enabled policy", () => {
  const s = solved("notification");
  const id = policy(s).name;
  for (const line of [
    "gcloud monitoring channels update oncall --no-enabled",
    `gcloud monitoring policies update ${id} --no-enabled`,
    `gcloud monitoring policies update ${id} --set-notification-channels=`,
    "sim monitoring clock advance --seconds=120",
  ]) {
    const changed = run(s, line);
    expect(changed.text).not.toContain("ERROR:");
    expect(observeSatisfied(changed.world, "notification"), line).toBe(false);
  }
  reject(s, "gcloud monitoring channels delete oncall --quiet");
  const deleted = run(s, "gcloud monitoring channels delete oncall --force --quiet");
  expect(deleted.text).not.toContain("ERROR:");
  expect(deleted.world.observabilityLab.policies[0]?.channels).toEqual([]);
});

test("missing modes are independent; NO_OP preserves previous breach and no observation is UNKNOWN", () => {
  const s = solved("notification");
  const config = policy(s);
  const missing = run(s, "sim monitoring clock advance --seconds=120").world;
  for (const mode of ["ACTIVE", "INACTIVE", "NO_OP"] as const) {
    const changed = {
      ...config,
      conditions: config.conditions.map((c) => ({ ...c, missing: mode })),
    };
    const result = evaluateAlert(missing, changed);
    expect(result.active).toBe(mode !== "INACTIVE");
    expect(result.results[0]?.evaluated).toBe(mode !== "NO_OP");
  }
  expect(
    evaluateAlert(
      { ...missing, observabilityLab: { ...missing.observabilityLab, points: [] } },
      config,
    ).active,
  ).toBe(false);
});

test("a gap, recovered value and insufficient duration do not meet the high CPU lesson", () => {
  const s = solved("notification");
  const last = s.world.observabilityLab.points.at(-1);
  if (!last) {
    throw new Error("Missing point");
  }
  for (const points of [
    [last],
    [{ ...last, value: 0.2 }],
    s.world.observabilityLab.points.map((p) => ({ ...p, time: 60 })),
  ]) {
    const world = { ...s.world, observabilityLab: { ...s.world.observabilityLab, points } };
    expect(observeSatisfied(world, "notification")).toBe(false);
  }
});

test("AND can combine resources; matching-resource AND cannot", () => {
  const s = solved("combiner");
  const config = policy(s);
  expect(evaluateAlert(s.world, config).active).toBe(true);
  expect(evaluateAlert(s.world, { ...config, combiner: "AND_WITH_MATCHING_RESOURCE" }).active).toBe(
    false,
  );
  expect(evaluateAlert(s.world, { ...config, combiner: "OR" }).active).toBe(true);
});

test("scope unlink preserves source samples and removes visibility; disabled source API also hides samples", () => {
  const s = solved("scope");
  const disabled = {
    ...s.world,
    projects: s.world.projects.map((p) =>
      p.projectId === "ace-prod-01"
        ? { ...p, enabledApis: p.enabledApis.filter((a) => a !== "monitoring.googleapis.com") }
        : p,
    ),
  };
  expect(observeSatisfied(disabled, "scope")).toBe(false);
  const removed = run(
    s,
    "gcloud beta monitoring metrics-scopes delete projects/ace-prod-01 --quiet",
  );
  expect(removed.text).not.toContain("ERROR:");
  expect(removed.world.observabilityLab.points).toEqual(s.world.observabilityLab.points);
  expect(observeSatisfied(removed.world, "scope")).toBe(false);
});

for (const [label, value] of [
  [
    "zero-duration",
    {
      ...ObserveThreshold(),
      conditionThreshold: { ...ObserveThreshold().conditionThreshold, duration: "0s" },
    },
  ],
  [
    "absent-too-short",
    {
      displayName: "absent",
      conditionAbsent: {
        filter: `metric.type="${ObserveCpuMetric}" AND resource.type="gce_instance"`,
        duration: "60s",
      },
    },
  ],
  [
    "arbitrary-promql",
    {
      displayName: "promql",
      conditionPrometheusQueryLanguage: { query: "sum(rate(metric[5m])) > 0.8", duration: "60s" },
    },
  ],
  ["unknown-fields", { ...ObserveThreshold(), unwanted: true }],
] as const) {
  test(`unsupported policy ${label} is rejected without mutation`, () => {
    const [write, create] = ObservePolicyFile(label, [value]);
    reject(run(prepared(), write ?? ""), create ?? "");
  });
}

test("PromQL forbids a second condition; stable IDs survive file replacement", () => {
  const s = solved("promql");
  const config = policy(s);
  const prefix = `projects/ace-dev-01/alertPolicies/${config.name}`;
  const content = {
    name: prefix,
    displayName: "promql-high",
    combiner: "OR",
    conditions: [
      { name: `${prefix}/conditions/${config.conditions[0]?.name}`, ...ObserveThreshold() },
    ],
  };
  const file = `sim files write replacement.json --content='${JSON.stringify(content)}'`;
  const updated = run(
    s,
    file,
    `gcloud monitoring policies update ${config.name} --policy-from-file=replacement.json`,
  );
  expect(updated.text).not.toContain("ERROR:");
  expect(policy(updated).conditions[0]?.name).toBe(config.conditions[0]?.name);
  expect(updated.world.observabilityLab.evaluations).toEqual([]);
  const both = ObservePolicyFile("both", [
    {
      displayName: "promql",
      conditionPrometheusQueryLanguage: {
        query:
          'compute_googleapis_com:instance_cpu_utilization{monitored_resource="gce_instance"} > 0.8',
        duration: "60s",
      },
    },
    ObserveThreshold(),
  ]);
  reject(run(prepared(), both[0] ?? ""), both[1] ?? "");
});

test("SLO zero traffic is UNKNOWN, budget is numeric and rolling expiry removes traffic", () => {
  const s = solved("slo");
  const objective = s.world.observabilityLab.objectives[0];
  if (!objective) {
    throw new Error("Missing SLO");
  }
  expect(objectiveResult({ ...objective, requests: [] }, 0).status).toBe("UNKNOWN");
  expect(objectiveResult(objective, 0).remainingBudget).toBeCloseTo(-1);
  expect(objectiveResult(objective, 0).burnRate).toBeCloseTo(2);
  expect(objectiveResult(objective, 86400).status).toBe("UNKNOWN");
  for (const line of [
    "sim monitoring slos create invalid --goal=1 --rolling-days=1",
    "sim monitoring slos create invalid --goal=0.99 --rolling-days=31",
    "sim monitoring slos record windows --good=101 --total=100",
  ]) {
    reject(s, line);
  }
});

for (const lesson of ["agent", "prometheus"] as const) {
  test(`${lesson} needs current IAM/API/identity/target and explicit collection`, () => {
    const before = run(prepared(), ...ObserveSolutions[lesson].slice(0, -1));
    expect(observeSatisfied(before.world, lesson)).toBe(false);
    const s = solved(lesson);
    const collector = s.world.observabilityLab.collectors[0];
    if (!collector) {
      throw new Error("Missing collector");
    }
    expect(collectorStatus(s.world, collector)).toBe("READY");
    const removed = run(
      s,
      "gcloud projects remove-iam-policy-binding ace-dev-01 --member=serviceAccount:observe-agent@ace-dev-01.iam.gserviceaccount.com --role=roles/monitoring.metricWriter",
    );
    expect(removed.text).not.toContain("ERROR:");
    expect(observeSatisfied(removed.world, lesson)).toBe(false);
    reject(removed, `sim monitoring collectors collect ${lesson}`);
    const disabled = {
      ...s.world,
      projects: s.world.projects.map((p) => ({
        ...p,
        enabledApis: p.enabledApis.filter((a) => a !== "monitoring.googleapis.com"),
      })),
    };
    expect(collectorStatus(disabled, collector)).toBe("MONITORING_API_DISABLED");
    if (lesson === "prometheus") {
      expect(collectorStatus({ ...s.world, kubeDeployments: [] }, collector)).toBe(
        "PODMONITORING_TARGET_NOT_READY",
      );
    } else {
      expect(
        collectorStatus(
          { ...s.world, instances: s.world.instances.map((v) => ({ ...v, scopes: [] })) },
          collector,
        ),
      ).toBe("WRITE_SCOPES_MISSING");
    }
  });
}

test("routing starts at ingestion; IAM repair never replays DENIED logs", () => {
  let s = run(
    prepared(),
    "bq mk routed --dataset --location=us-central1",
    "gcloud logging sinks create sink bigquery.googleapis.com/projects/ace-dev-01/datasets/routed",
    "sim logging audit emit --category=ADMIN_ACTIVITY --service=compute.googleapis.com",
  );
  expect(s.world.observabilityLab.deliveries.some((d) => d.state === "DENIED")).toBe(true);
  s = run(
    s,
    "sim logging sinks grant-writer sink --location=us-central1",
    "sim logging sinks export sink --location=us-central1 --table=routed.logs",
  );
  expect(s.text).not.toContain("ERROR:");
  expect(s.world.dataProcessing.tables[0]?.rows).toEqual([]);
  s = run(
    s,
    "sim logging audit emit --category=ADMIN_ACTIVITY --service=compute.googleapis.com",
    "sim logging sinks export sink --location=us-central1 --table=routed.logs",
  );
  expect(s.world.dataProcessing.tables[0]?.rows).toHaveLength(1);
});

test("creating a sink never replays past operations; exclusions are sink-local", () => {
  let s = run(
    prepared(),
    "gcloud compute instances create past --zone=us-central1-a",
    "gcloud logging buckets create archive --location=us-central1",
    "gcloud logging sinks create sink logging.googleapis.com/projects/ace-dev-01/locations/us-central1/buckets/archive",
    "sim logging exclusions configure exclude --sink=sink --log-filter='severity=NOTICE'",
  );
  expect(storedLogs(s.world, "ace-dev-01", "us-central1", "archive")).toEqual([]);
  s = run(s, "sim logging audit emit --category=ADMIN_ACTIVITY --service=compute.googleapis.com");
  expect(storedLogs(s.world, "ace-dev-01", "us-central1", "archive")).toEqual([]);
  expect(storedLogs(s.world, "ace-dev-01", "global", "_Required").length).toBeGreaterThan(0);
  expect(s.world.observabilityLab.deliveries.some((d) => d.state === "EXCLUDED")).toBe(true);
});

test("views reject severity/payload filters and check a view's own reader membership", () => {
  const s = solved("routing");
  reject(
    s,
    "gcloud logging views create bad --bucket=archive --location=us-central1 --log-filter='severity=ERROR'",
  );
  reject(
    s,
    "gcloud logging views update compute --bucket=archive --location=us-central1 --log-filter='textPayload:secret'",
  );
  const reader = run(s, "gcloud auth login dev@example.com");
  reject(reader, "sim logging views read compute --bucket=archive --location=us-central1");
  const granted = run(
    s,
    "sim logging views grant-reader compute --bucket=archive --location=us-central1 --member=user:dev@example.com",
    "gcloud auth login dev@example.com",
    "sim logging views read compute --bucket=archive --location=us-central1",
  );
  expect(granted.text).not.toContain("ERROR:");
  expect(granted.text).toContain("compute.instances.insert");
});

test("retention, irreversible lock/analytics, delete grace and built-in bucket rules", () => {
  let s = run(
    prepared(),
    "gcloud logging buckets update _Required --location=global --enable-analytics",
  );
  expect(s.text).not.toContain("ERROR:");
  for (const line of [
    "gcloud logging buckets update _Required --location=global --retention-days=30",
    "gcloud logging buckets delete _Default --location=global --quiet",
    "gcloud logging buckets create invalid --location=moon",
    "gcloud logging buckets create invalid --location=us-central1 --retention-days=0",
  ]) {
    reject(s, line);
  }
  s = run(
    s,
    "gcloud logging buckets create archive --location=us-central1 --retention-days=1 --enable-analytics",
    "gcloud logging sinks create sink logging.googleapis.com/projects/ace-dev-01/locations/us-central1/buckets/archive",
    "sim logging audit emit --category=ADMIN_ACTIVITY --service=compute.googleapis.com",
    "gcloud logging buckets update archive --location=us-central1 --locked",
  );
  expect(s.text).not.toContain("ERROR:");
  reject(s, "gcloud logging buckets delete archive --location=us-central1 --quiet");
  reject(s, "gcloud logging buckets update archive --location=us-central1 --no-locked");
  reject(s, "gcloud logging buckets update archive --location=us-central1 --no-enable-analytics");
  s = run(s, "sim monitoring clock advance --seconds=86400");
  expect(storedLogs(s.world, "ace-dev-01", "us-central1", "archive")).toEqual([]);
  s = run(
    s,
    "gcloud logging buckets delete archive --location=us-central1 --quiet",
    "gcloud logging buckets undelete archive --location=us-central1",
  );
  expect(s.text).not.toContain("ERROR:");
  s = run(
    s,
    "gcloud logging buckets delete archive --location=us-central1 --quiet",
    "sim monitoring clock advance --seconds=604800",
  );
  reject(s, "gcloud logging buckets undelete archive --location=us-central1");
});

test("Data Access defaults off, BigQuery always records, viewer excludes private entries", () => {
  let s = run(
    prepared(),
    "sim logging audit emit --category=DATA_ACCESS --service=compute.googleapis.com",
  );
  expect(s.text).toContain("recorded: false");
  expect(s.world.observabilityLab.logs).toEqual([]);
  s = run(
    s,
    "sim logging audit emit --category=DATA_ACCESS --service=bigquery.googleapis.com",
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:dev@example.com --role=roles/logging.viewer",
    "gcloud auth login dev@example.com",
    "gcloud logging read 'logName:cloudaudit.googleapis.com%2Fdata_access'",
  );
  expect(s.text).not.toContain("sim.fixture.dataRead");
  s = run(
    s,
    "gcloud auth login owner@example.com",
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:dev@example.com --role=roles/logging.privateLogViewer",
    "gcloud auth login dev@example.com",
    "gcloud logging read 'logName:cloudaudit.googleapis.com%2Fdata_access'",
  );
  expect(s.text).toContain("sim.fixture.dataRead");
});

test("ancestor audit enablement cannot be switched off by a project", () => {
  const s = run(
    prepared(),
    "sim logging audit configure --scope=organizations/123456789012 --service=allServices --data-read",
    "sim logging audit configure --scope=projects/ace-dev-01 --service=compute.googleapis.com --no-data-read",
    "sim logging audit emit --category=DATA_ACCESS --service=compute.googleapis.com",
  );
  expect(s.text).toContain("recorded: true");
  reject(
    s,
    "sim logging audit configure --scope=projects/ace-prod-01 --service=allServices --data-read",
  );
});

test("API, IAM, project and unsupported inputs reject without a state change", () => {
  reject(
    run(session(), "gcloud services disable monitoring.googleapis.com --quiet"),
    "gcloud monitoring channels create --display-name=oncall --type=email --channel-labels=email_address=oncall@example.com",
  );
  const s = prepared();
  for (const line of [
    "gcloud monitoring channels create --display-name=oncall --type=sms --channel-labels=email_address=a@example.com",
    "gcloud monitoring channels create --display-name=oncall --type=email --channel-labels=email_address=bad",
    "sim monitoring metric-descriptors create invalid --type=custom.googleapis.com/anything --resource-type=generic_task",
    "sim monitoring clock advance --seconds=-1",
    "sim monitoring clock advance --seconds=31536001",
    "gcloud monitoring channels describe oncall --project=missing",
  ]) {
    reject(s, line);
  }
  reject(
    run(s, "gcloud auth login dev@example.com"),
    "sim monitoring slos create no-access --goal=0.99 --rolling-days=1",
  );
});
