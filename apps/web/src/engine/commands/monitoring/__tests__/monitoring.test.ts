// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { initialWorld, Now, run, type Session, session } from "@/engine/__tests__/setup";
import { World } from "@/engine/domains/world";
import { Mission } from "@/engine/missions";
import { Snapshot } from "@/engine/snapshot";
import { Result } from "@/utils/Result";

const execute = (start: Session, ...commands: string[]): Session =>
  commands.reduce((current, command) => {
    const next = run(current, command);
    expect(next.text, command).not.toContain("ERROR:");
    return next;
  }, start);
const cpu =
  'metric.type="compute.googleapis.com/instance/cpu/utilization" AND resource.type="gce_instance"';
const policy = `gcloud monitoring policies create --display-name='CPU high' --condition-display-name=CPU --condition-filter='${cpu}' --if='> 0.8' --duration=300s`;
const uptime =
  "gcloud monitoring uptime create public-web --resource-type=uptime-url --resource-labels=host=example.com,project_id=ace-dev-01 --protocol=https --path=/healthz --period=5";
const dashboard = "gcloud monitoring dashboards create --config-from-file=cpu-dashboard.json";
const metric = "gcloud logging metrics create user_errors --log-filter='severity>=ERROR'";

test("monitoring resources persist through list/describe/export/import and delete", () => {
  const created = execute(session(), policy, uptime, dashboard, metric);
  expect(created.world.uptimeChecks[0]).toMatchObject({
    period: "300s",
    timeout: "60s",
    port: 443,
  });
  expect(created.world.alertPolicies[0]).toMatchObject({
    threshold: 0.8,
    duration: "300s",
    enabled: true,
  });
  const restored = Result.unwrap(
    Snapshot.fromUnknown(JSON.parse(JSON.stringify(Snapshot.create(created.world, Now)))),
  );
  expect(restored).toEqual(created.world);
  for (const [group, item] of [
    ["monitoring policies", created.world.alertPolicies[0]],
    ["monitoring uptime", created.world.uptimeChecks[0]],
    ["monitoring dashboards", created.world.dashboards[0]],
    ["logging metrics", created.world.logMetrics[0]],
  ] as const) {
    expect(item).toBeDefined();
    const listed = execute(session(restored), `gcloud ${group} list --format=json`);
    expect(listed.text).toContain(item?.name);
    const described = execute(listed, `gcloud ${group} describe ${item?.name} --format=json`);
    expect(described.text).toContain(item?.name);
    const deleted = execute(described, `gcloud ${group} delete ${item?.name} --quiet`);
    expect(run(deleted, `gcloud ${group} describe ${item?.name}`).text).toContain("not found");
  }
});

test("dashboard validation has no side effects and rejects unsupported JSON fields", () => {
  const start = session();
  expect(execute(start, `${dashboard} --validate-only`).world).toEqual(start.world);
  const invalid = run(
    start,
    `gcloud monitoring dashboards create --config='{"displayName":"x","mosaicLayout":{}}'`,
  );
  expect(invalid.text).toContain("not supported");
  expect(invalid.world).toEqual(start.world);
  expect(run(start, `${dashboard} --config='{}'`).text).toContain("exactly one");
});

test.each([
  `${uptime} --timeout=61`,
  `${uptime} --port=0`,
  `${uptime} --path=missing-slash`,
  `${uptime} --resource-labels=host=example.com,project_id=ace-prod-01`,
  `${uptime} --resource-labels=host=https://example.com,project_id=ace-dev-01`,
  `${policy} --duration=1s`,
  `${policy} --if=absent`,
  `${metric} --log-filter='severity>=UNKNOWN'`,
])("invalid settings never mutate world: %s", (command) => {
  const start = session();
  const result = run(start, command);
  expect(result.text).toContain("ERROR:");
  expect(result.world).toEqual(start.world);
});

test("monitoring viewer can read but cannot create, editor can create, APIs and projects are enforced", () => {
  const viewer = execute(
    session(),
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:viewer@example.com --role=roles/monitoring.viewer",
    "gcloud auth login viewer@example.com",
  );
  expect(run(viewer, "gcloud monitoring uptime list").text).toBe("Listed 0 items.");
  expect(run(viewer, uptime).text).toContain(
    "Required 'monitoring.uptimeCheckConfigs.create' permission",
  );
  const editor = execute(
    viewer,
    "gcloud config set account owner@example.com",
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:viewer@example.com --role=roles/monitoring.editor",
    "gcloud config set account viewer@example.com",
    uptime,
  );
  expect(editor.world.uptimeChecks).toHaveLength(1);
  expect(run(session(), `${uptime} --project=ace-prod-01`).text).toContain("has not been used");
  expect(
    run(editor, "gcloud monitoring uptime describe projects/ace-prod-01/uptimeCheckConfigs/x").text,
  ).toContain("another project");
});

test("log metric update preserves identity and duplicate create fails", () => {
  const start = execute(session(), metric);
  const duplicate = run(start, metric);
  expect(duplicate.world).toEqual(start.world);
  expect(duplicate.text).toContain("already exists");
  const updated = execute(
    start,
    "gcloud logging metrics update user_errors --log-filter='severity>=WARNING' --description=warning-count",
  );
  expect(updated.world.logMetrics).toEqual([
    {
      projectId: "ace-dev-01",
      name: "user_errors",
      filter: "severity>=WARNING",
      description: "warning-count",
    },
  ]);
});

test("logging positional filter and severity order select actual audit entries", () => {
  const start = execute(
    session(),
    "gcloud compute instances create log-vm --zone=asia-northeast1-a",
    "gcloud compute instances stop log-vm --zone=asia-northeast1-a",
  );
  const error = execute(start, "gcloud logging read 'severity>=ERROR' --format=json");
  expect(JSON.parse(error.text)).toEqual([]);
  const notices = execute(
    start,
    "gcloud logging read 'severity>=INFO AND resource.type=\"gce_instance\"' --order=asc --format=json",
  );
  expect(
    JSON.parse(notices.text).map(
      (r: { protoPayload: { methodName: string } }) => r.protoPayload.methodName,
    ),
  ).toEqual(["v1.compute.instances.insert", "v1.compute.instances.stop"]);
  expect(
    execute(
      start,
      "gcloud logging read 'protoPayload.methodName:v1.compute.instances.stop' --format=json",
    ).text,
  ).not.toContain("instances.insert");
  expect(run(start, "gcloud logging read 'unsupported function()'").text).toContain("ERROR:");
});

test("sink update retains writer identity and deletion is observable", () => {
  const start = execute(session(), "gcloud logging sinks create sink storage.googleapis.com/a");
  const updated = execute(
    start,
    "gcloud logging sinks update sink storage.googleapis.com/b --log-filter='severity>=ERROR'",
  );
  expect(updated.world.logSinks[0]).toMatchObject({
    writerIdentity: start.world.logSinks[0]?.writerIdentity,
    destination: "storage.googleapis.com/b",
    filter: "severity>=ERROR",
  });
  expect(execute(updated, "gcloud logging sinks delete sink --quiet").world.logSinks).toEqual([]);
});

test.each([
  ["m-observe-001", metric],
  ["m-observe-002", uptime],
  ["m-observe-003", dashboard],
  ["m-observe-004", policy],
])("mission %s can be solved from an initial world", (id, command) => {
  const start = session(Result.unwrap(Engine.startMission(initialWorld(), id)));
  expect(World.findMissionProgress(start.world, id)).toMatchObject({
    value: { status: "in_progress" },
  });
  const completed = execute(start, command);
  expect(World.findMissionProgress(completed.world, id)).toMatchObject({
    value: { status: "completed" },
  });
});

test("wrong target, disabled alert and validate-only do not clear missions", () => {
  for (const [id, command] of [
    ["m-observe-001", `${metric} --log-filter='severity>=INFO'`],
    ["m-observe-002", `${uptime} --path=/other`],
    ["m-observe-003", `${dashboard} --validate-only`],
    ["m-observe-004", `${policy} --no-enabled`],
    ["m-observe-004", `${policy} --if='> 0.9'`],
  ] as const) {
    const start = session(Result.unwrap(Engine.startMission(initialWorld(), id)));
    const result = execute(start, command);
    expect(World.findMissionProgress(result.world, id)).toMatchObject({
      value: { status: "in_progress" },
    });
  }
});

test("log export mission requires destination writer IAM, not just a sink", () => {
  const id = "m-observe-005";
  const start = execute(
    session(Result.unwrap(Engine.startMission(initialWorld(), id))),
    "gcloud storage buckets create gs://ace-audit-logs --location=asia-northeast1",
    "gcloud logging sinks create audit-export storage.googleapis.com/ace-audit-logs --log-filter='severity>=ERROR'",
  );
  expect(World.findMissionProgress(start.world, id)).toMatchObject({
    value: { status: "in_progress" },
  });
  const result = execute(
    start,
    `gcloud storage buckets add-iam-policy-binding gs://ace-audit-logs --member=${start.world.logSinks[0]?.writerIdentity} --role=roles/storage.objectCreator`,
  );
  expect(World.findMissionProgress(result.world, id)).toMatchObject({
    value: { status: "completed" },
  });
});

test("v2 snapshots migrate observability collections and retain all mission progress", () => {
  const oldWorld = initialWorld();
  const { logMetrics: _a, uptimeChecks: _b, alertPolicies: _c, dashboards: _d, ...v2 } = oldWorld;
  const restored = Result.unwrap(Snapshot.fromUnknown({ schemaVersion: 2, world: v2 }));
  expect(restored.logMetrics).toEqual([]);
  expect(restored.dashboards).toEqual([]);
  expect(restored.missions).toHaveLength(Mission.all().length);
  const broken = {
    ...oldWorld,
    uptimeChecks: [
      {
        projectId: "ace-dev-01",
        name: "bad",
        displayName: "bad",
        host: "example.com",
        path: "/",
        protocol: "https",
        port: 0,
        period: "300s",
        timeout: "60s",
      },
    ],
  };
  expect(Result.isOk(Snapshot.fromUnknown({ schemaVersion: 3, world: broken }))).toBe(false);
});
