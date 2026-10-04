// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { Now, run, type Session, session } from "@/engine/__tests__/setup";
import { KubeManifest } from "@/engine/domains/kube-manifest";
import { KubeServiceRouting } from "@/engine/domains/kube-service-routing";
import { KubePod } from "@/engine/domains/kubernetes";
import { World } from "@/engine/domains/world";
import { Snapshot } from "@/engine/snapshot";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const execute = (s: Session, ...commands: string[]) =>
  commands.reduce((s, c) => {
    const next = run(s, c);
    expect(next.text, c).not.toMatch(/^(ERROR:|error:|Error from server)/m);
    expect(Result.isOk(World.validate(next.world)), c).toBe(true);
    return next;
  }, s);
const setup = (s = session()) =>
  execute(
    s,
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create startup-gke --zone=us-central1-a",
    "sim files load kubernetes-startup",
    "kubectl apply -f slow-web.yaml",
    "kubectl apply -f slow-service.yaml",
  );
const d = (s: Session) => {
  const value = s.world.kubeDeployments.find(
    (d) => d.name === "slow-web" && d.cluster === "startup-gke",
  );
  if (!value) throw new Error("Missing Deployment");
  return value;
};
const pods = (s: Session) => KubePod.fromDeployment(d(s));
const first = (s: Session) => pods(s)[0]?.name ?? "missing";
const backends = (s: Session) => {
  const service = s.world.kubeServices.find((s) => s.name === "slow-service");
  if (!service) throw new Error("Missing Service");
  return KubeServiceRouting.backends(s.world, service);
};
const probe = (s: Session, code = 200, pod = "", kind = "startup") =>
  execute(
    s,
    `sim kubernetes probe slow-web --kind=${kind} --status-code=${code}${pod ? ` --pod=${pod}` : ""}`,
  );
const healthy = (s = setup()) => probe(probe(s), 200, "", "readiness");
const restarted = (s = setup(), name = first(s)) =>
  probe(probe(probe(s, 503, name), 503, name), 503, name);
const json = (s: Session, c: string) => JSON.parse(execute(s, c).text);
const snap = (s: Session) => JSON.parse(JSON.stringify(Snapshot.create(s.world, Now)));
const restore = (s: Session) => session(Result.unwrap(Snapshot.fromUnknown(snap(s))));
const rejected = (s: Session, command: string, message: string) => {
  const next = run(s, command);
  expect(next.text).toContain(message);
  expect(next.world).toEqual(s.world);
};
const startupConfig = {
  httpGet: { path: "/healthz", port: 8080 },
  successThreshold: 1,
  failureThreshold: 3,
};
const readinessConfig = {
  httpGet: { path: "/ready", port: 8080 },
  successThreshold: 1,
  failureThreshold: 1,
};
const livenessConfig = { ...startupConfig, failureThreshold: 1 };
const manifest = (startupProbe: unknown, withOthers = true) => ({
  apiVersion: "apps/v1",
  kind: "Deployment",
  metadata: { name: "slow-web" },
  spec: {
    replicas: 2,
    selector: { matchLabels: { app: "slow-web" } },
    template: {
      metadata: { labels: { app: "slow-web" } },
      spec: {
        containers: [
          {
            name: "slow-web",
            image: "nginx:1",
            startupProbe,
            ...(withOthers
              ? { readinessProbe: readinessConfig, livenessProbe: livenessConfig }
              : {}),
          },
        ],
      },
    },
  },
});
const apply = (s: Session, config: unknown, withOthers = true) =>
  execute(
    s,
    `sim files write startup.json --content='${JSON.stringify(manifest(config, withOthers))}'`,
    "kubectl apply -f startup.json",
  );

test("startup blocks readiness/liveness and routing while process remains Running", () => {
  const s = setup();
  const record = json(s, `kubectl get pod ${first(s)} -o json`);
  expect(record.status).toMatchObject({
    phase: "Running",
    conditions: [{ status: "False" }],
    containerStatuses: [{ started: false, ready: false, restartCount: 0 }],
  });
  expect(record.simulator.startupSample).toBeNull();
  expect(record.spec.containers[0].startupProbe).toEqual(startupConfig);
  expect(backends(s)).toEqual([]);
  expect(json(s, "kubectl get deployment slow-web -o json").status.readyReplicas).toBe(0);
  expect(json(s, "kubectl get rs -o json").items.at(-1).status.readyReplicas).toBe(0);
  rejected(s, "sim kubernetes probe slow-web --status-code=200", "StartupProbePending");
  rejected(
    s,
    "sim kubernetes probe slow-web --kind=liveness --status-code=503",
    "StartupProbePending",
  );
  rejected(s, "kubectl rollout status deployment/slow-web", "StartupProbePending");
  execute(s, `kubectl logs ${first(s)}`, `kubectl exec ${first(s)} -- printenv`);
  const twice = probe(probe(s, 503), 503);
  expect(pods(twice).every((p) => !p.started && p.restarts === 0)).toBe(true);
  const started = probe(twice, 200, first(s));
  expect(pods(started).map((p) => p.started)).toEqual([true, false]);
  expect(backends(started)).toEqual([]);
  expect(d(started).podStartup.find((p) => p.podName === first(s))?.failures).toBe(0);
  const ready = probe(started, 200, first(s), "readiness");
  expect(backends(ready)).toHaveLength(1);
  expect(pods(ready).map((p) => p.restarts)).toEqual([0, 0]);
  rejected(
    ready,
    `sim kubernetes probe slow-web --kind=startup --pod=${first(s)} --status-code=503`,
    "StartupProbeCompleted",
  );
  rejected(
    ready,
    "sim kubernetes probe slow-web --kind=startup --status-code=200",
    "StartupProbeCompleted",
  );
  rejected(
    ready,
    "sim kubernetes probe slow-web --kind=liveness --status-code=200",
    "StartupProbePending",
  );
  rejected(ready, "sim kubernetes probe slow-web --status-code=200", "StartupProbePending");
});

test("startup and liveness restarts share one counter and each restart requires fresh startup", () => {
  const s = setup();
  const name = first(s);
  const failed = restarted(s);
  expect(pods(failed).map((p) => [p.name, p.ip])).toEqual(pods(s).map((p) => [p.name, p.ip]));
  expect([d(failed).revision, d(failed).generation]).toEqual([d(s).revision, d(s).generation]);
  expect(pods(failed).map((p) => p.restarts)).toEqual([1, 0]);
  expect(d(failed).podStartup[0]).toMatchObject({ started: false, failures: 0, restarted: true });
  const up = healthy(restore(failed));
  expect(backends(up)).toHaveLength(2);
  const liveFailed = probe(up, 503, name, "liveness");
  expect(pods(liveFailed).map((p) => p.restarts)).toEqual([2, 0]);
  expect(d(liveFailed).podStartup.some((p) => p.podName === name)).toBe(false);
  expect(d(liveFailed).podReadiness.some((p) => p.podName === name)).toBe(false);
  expect(backends(liveFailed)).toHaveLength(1);
  rejected(
    liveFailed,
    `sim kubernetes probe slow-web --kind=liveness --pod=${name} --status-code=200`,
    "StartupProbePending",
  );
  const again = restarted(restore(liveFailed), name);
  expect(pods(again).map((p) => p.restarts)).toEqual([3, 0]);
  expect(d(again).podLiveness.some((p) => p.podName === name)).toBe(false);
  const recovered = probe(probe(again, 200, name), 200, name, "readiness");
  expect(backends(recovered)).toHaveLength(2);
  expect(
    json(recovered, `kubectl get pod ${name} -o json`).status.containerStatuses[0],
  ).toMatchObject({ started: true, ready: true, restartCount: 3 });
  const sampled = probe(recovered, 200, name, "liveness");
  expect(d(sampled).podLiveness[0]?.restarts).toBe(3);
  expect(restore(sampled).world).toEqual(sampled.world);
});

test.each([199, 200, 399, 400, 599])("startup HTTP boundary %i with threshold 1", (code) => {
  const s = apply(setup(), { ...startupConfig, failureThreshold: 1 });
  const next = probe(s, code);
  const success = code >= 200 && code < 400;
  expect(pods(next).every((p) => p.started === success && p.restarts === Number(!success))).toBe(
    true,
  );
});

test("startup-only uses default config, remains unready until success and reaches Ready without readiness", () => {
  const s = apply(setup(), { httpGet: { port: 80 } }, false);
  expect(Option.unwrap(d(s).startupProbe)).toEqual({
    httpGet: { path: "/", port: 80 },
    successThreshold: 1,
    failureThreshold: 3,
  });
  expect(backends(s)).toEqual([]);
  const failed = restarted(s);
  expect(pods(failed)[0]?.restarts).toBe(1);
  const up = probe(failed);
  expect(backends(up)).toHaveLength(2);
  execute(up, "kubectl rollout status deployment/slow-web");
  const removed = apply(up, undefined, false);
  expect(d(removed).podStartup).toEqual([]);
  expect(d(removed).podRestarts).toEqual([]);
  expect(pods(removed).every((p) => p.ready && p.restarts === 0)).toBe(true);
  rejected(
    removed,
    "sim kubernetes probe slow-web --kind=startup --status-code=200",
    "no startupProbe",
  );
});

test("same apply preserves partial startup; changes/undo/recreate/rollout reset startup and counters", () => {
  const s = restarted();
  const oneFailure = probe(s, 503, first(s));
  expect(d(execute(oneFailure, "kubectl apply -f slow-web.yaml"))).toEqual(d(oneFailure));
  const changed = apply(oneFailure, { ...startupConfig, failureThreshold: 4 });
  expect(d(changed).revision).toBe(d(s).revision + 1);
  expect(d(changed).revisions.at(-1)?.reason).toBe("startup");
  expect(d(changed).podRestarts).toEqual([]);
  const undone = execute(changed, "kubectl rollout undo deployment/slow-web");
  expect(d(undone).startupProbe).toEqual(d(s).startupProbe);
  expect(pods(undone).every((p) => !p.started && p.restarts === 0)).toBe(true);
  expect(
    execute(undone, `kubectl rollout history deployment/slow-web --revision=${d(undone).revision}`)
      .text,
  ).toContain("startupProbe");
  expect(
    json(undone, "kubectl get rs -o json").items.at(-1).spec.template.spec.containers[0]
      .startupProbe,
  ).toEqual(startupConfig);
  const deleted = execute(s, `kubectl delete pod ${first(s)}`);
  expect(first(deleted)).not.toBe(first(s));
  expect(d(deleted).podStartup).toEqual([]);
  expect(d(deleted).podRestarts).toEqual([]);
  const rollout = execute(s, "kubectl rollout restart deployment/slow-web");
  expect(d(rollout).podStartup).toEqual([]);
  expect(d(rollout).podRestarts).toEqual([]);
});

test("scale and HPA preserve existing counters but new Pods must pass startup first", () => {
  const configured = execute(
    setup(),
    "kubectl set resources deployment/slow-web --requests=cpu=250m",
    "kubectl autoscale deployment/slow-web --max=4 --cpu-percent=50",
  );
  const s = restarted(configured);
  const blocked = execute(s, "sim kubernetes reconcile slow-web --cpu=250m");
  expect(blocked.text).toContain("PodsNotReady");
  const up = healthy(blocked);
  const scaled = execute(up, "sim kubernetes reconcile slow-web --cpu=250m");
  expect(pods(scaled).map((p) => [p.started, p.restarts])).toEqual([
    [true, 1],
    [true, 0],
    [false, 0],
    [false, 0],
  ]);
  const newPod = pods(scaled)[3]?.name ?? "missing";
  const failed = restarted(scaled, newPod);
  const smaller = execute(failed, "kubectl scale deployment/slow-web --replicas=2");
  expect(d(smaller).podRestarts).toEqual([{ podName: first(up), restarts: 1 }]);
  expect(d(smaller).podStartup.some((p) => p.podName === newPod)).toBe(false);
  const grown = execute(smaller, "kubectl scale deployment/slow-web --replicas=4");
  expect(
    pods(grown)
      .slice(2)
      .every((p) => !p.started && p.restarts === 0),
  ).toBe(true);
});

test("startup restart reloads only that container environment and startup errors reject atomic evaluation", () => {
  const s = execute(
    setup(),
    "kubectl create configmap settings --from-literal=MODE=old",
    "kubectl set env deployment/slow-web --from=configmap/settings",
  );
  const changed = execute(
    s,
    "kubectl delete configmap settings",
    "kubectl create configmap settings --from-literal=MODE=new",
  );
  const failed = restarted(changed);
  expect(execute(failed, `kubectl exec ${first(s)} -- printenv MODE`).text).toContain("new");
  const other = pods(s)[1]?.name ?? "missing";
  expect(execute(failed, `kubectl exec ${other} -- printenv MODE`).text).toContain("old");
  const removed = execute(failed, "kubectl delete configmap settings");
  const bad = restarted(removed);
  const record = json(bad, `kubectl get pod ${first(s)} -o json`);
  expect(record.status.containerStatuses[0]).toMatchObject({
    started: false,
    restartCount: 2,
    state: { waiting: { reason: "CreateContainerConfigError" } },
  });
  rejected(
    bad,
    "sim kubernetes probe slow-web --kind=startup --status-code=200",
    "CreateContainerConfigError",
  );
  const repaired = execute(
    restore(bad),
    "kubectl create configmap settings --from-literal=MODE=fixed",
  );
  expect(backends(healthy(repaired))).toHaveLength(2);
});

test.each([
  null,
  {},
  { exec: { command: ["true"] } },
  { tcpSocket: { port: 80 } },
  { grpc: { port: 80 } },
  { ...startupConfig, successThreshold: 2 },
  { ...startupConfig, failureThreshold: 0 },
  { ...startupConfig, failureThreshold: 1001 },
  { ...startupConfig, failureThreshold: 1.5 },
  { ...startupConfig, successThreshold: "1" },
  { ...startupConfig, initialDelaySeconds: 1 },
  { ...startupConfig, periodSeconds: 1 },
  { ...startupConfig, timeoutSeconds: 1 },
  { ...startupConfig, terminationGracePeriodSeconds: 1 },
  { httpGet: { port: "http" } },
  { httpGet: { port: 65536 } },
  { httpGet: { port: 80, path: "relative" } },
  { httpGet: { port: 80, scheme: "HTTPS" } },
])("invalid/unsupported startup config is rejected: %j", (p) => {
  expect(Result.isOk(KubeManifest.parse(JSON.stringify(manifest(p))))).toBe(false);
});

test("startup sampling validates permissions, API, cluster, arguments and replicas", () => {
  const s = setup();
  const viewer = execute(
    s,
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:viewer@example.com --role=roles/container.viewer",
    "gcloud auth login viewer@example.com",
  );
  execute(viewer, "kubectl get pods -o json");
  rejected(
    viewer,
    "sim kubernetes probe slow-web --kind=startup --status-code=200",
    "container.deployments.update",
  );
  rejected(session(), "sim kubernetes probe slow-web --kind=startup --status-code=200", "ERROR:");
  for (const flags of [
    "--status-code=99",
    "--status-code=600",
    "--status-code=200.5",
    "--status-code=abc",
    "",
    "--status-code=200 --pod=foreign",
    "--status-code=200 --kind=startup",
  ])
    rejected(s, `sim kubernetes probe slow-web --kind=startup ${flags}`, "ERROR:");
  rejected(s, "sim kubernetes probe missing --kind=startup --status-code=200", "not found");
  const zero = execute(restarted(s), "kubectl scale deployment/slow-web --replicas=0");
  expect(d(zero).podRestarts).toEqual([]);
  rejected(
    zero,
    "sim kubernetes probe slow-web --kind=startup --status-code=200",
    "No matching Pod",
  );
  const other = execute(
    s,
    "gcloud container clusters create other --zone=us-central1-a",
    "kubectl apply -f slow-web.yaml",
  );
  const next = probe(other);
  expect(d(next).podStartup).toEqual([]);
  expect(next.world.kubeDeployments.find((d) => d.cluster === "other")?.podStartup).toHaveLength(2);
});

test("v16 migration preserves liveness restart count and all existing state", () => {
  const s = execute(
    session(),
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create liveness-gke --zone=us-central1-a",
    "sim files load kubernetes-liveness",
    "kubectl apply -f live-web.yaml",
    "kubectl apply -f live-service.yaml",
    "kubectl set resources deployment/live-web --requests=cpu=250m",
    "kubectl autoscale deployment/live-web --max=4 --cpu-percent=50",
    "sim kubernetes probe live-web --status-code=200",
    "sim kubernetes probe live-web --kind=liveness --status-code=503",
    "sim kubernetes probe live-web --kind=liveness --status-code=503",
    "sim kubernetes probe live-web --status-code=200",
    "sim kubernetes reconcile live-web --cpu=125m",
  );
  const old = snap(s);
  old.schemaVersion = 16;
  for (const dep of old.world.kubeDeployments) {
    delete dep.startupProbe;
    delete dep.podStartup;
    delete dep.podRestarts;
    for (const r of dep.revisions) delete r.startupProbe;
  }
  const migrated = session(Result.unwrap(Snapshot.fromUnknown(old)));
  expect(migrated.world).toEqual(s.world);
  const again = execute(
    migrated,
    "sim kubernetes probe live-web --kind=liveness --status-code=503",
    "sim kubernetes probe live-web --kind=liveness --status-code=503",
  );
  const deployment = again.world.kubeDeployments[0];
  if (!deployment) throw new Error("Missing migrated Deployment");
  expect(KubePod.fromDeployment(deployment).every((p) => p.restarts === 2)).toBe(true);
});

test.each([
  "missing",
  "foreign",
  "duplicate",
  "counter",
  "started",
  "status",
  "mismatch",
  "threshold",
  "restartMismatch",
  "duplicateCount",
  "negativeCount",
  "unsafeCount",
  "blockedReadiness",
  "blockedLiveness",
])("invalid saved startup/container state is rejected: %s", (kind) => {
  const value = snap(restarted());
  const dep = value.world.kubeDeployments[0];
  const sample = dep.podStartup[0];
  if (kind === "missing") delete dep.podStartup;
  if (kind === "foreign") sample.podName = "foreign";
  if (kind === "duplicate") dep.podStartup.push(sample);
  if (kind === "counter") sample.failures = 3;
  if (kind === "started") sample.started = true;
  if (kind === "status") sample.statusCode = 600;
  if (kind === "mismatch") dep.startupProbe.value.httpGet.port = 80;
  if (kind === "threshold") dep.revisions[0].startupProbe.value.successThreshold = 2;
  if (kind === "restartMismatch") dep.podRestarts[0].restarts = 2;
  if (kind === "duplicateCount") dep.podRestarts.push(dep.podRestarts[0]);
  if (kind === "negativeCount") dep.podRestarts[0].restarts = -1;
  if (kind === "unsafeCount") dep.podRestarts[0].restarts = Number.MAX_SAFE_INTEGER + 1;
  if (kind === "blockedReadiness")
    dep.podReadiness.push({
      podName: sample.podName,
      ready: true,
      statusCode: 200,
      failures: 0,
      successes: 1,
    });
  if (kind === "blockedLiveness")
    dep.podLiveness.push({
      podName: sample.podName,
      statusCode: 200,
      failures: 0,
      restarts: 1,
      restarted: false,
    });
  expect(Result.isOk(Snapshot.fromUnknown(value))).toBe(false);
});

test("restart count overflow rejects the entire all-Pod evaluation", () => {
  const value = snap(probe(probe(restarted(), 503), 503));
  const dep = value.world.kubeDeployments[0];
  const sample = dep.podStartup.find((p: { restarts: number }) => p.restarts === 1);
  sample.restarts = Number.MAX_SAFE_INTEGER;
  dep.podRestarts[0].restarts = Number.MAX_SAFE_INTEGER;
  const s = session(Result.unwrap(Snapshot.fromUnknown(value)));
  rejected(
    s,
    "sim kubernetes probe slow-web --kind=startup --status-code=503",
    "restart count limit",
  );
});

test("startup mission needs one started/ready and one pending Pod with failures 2 and no restarts", () => {
  const id = "m-gke-014";
  const status = (s: Session) => s.world.missions.find((m) => m.id === id)?.status;
  const s = setup(session(Result.unwrap(Engine.startMission(session().world, id))));
  expect(status(s)).toBe("in_progress");
  const twice = probe(probe(s, 503), 503);
  expect(status(twice)).toBe("in_progress");
  expect(status(healthy(twice))).toBe("in_progress");
  const one = probe(restore(twice), 200, first(s));
  expect(status(one)).toBe("in_progress");
  const wrong = execute(
    one,
    "sim files replace slow-service.yaml --search='app: slow-web' --replacement='app: missing'",
    "kubectl apply -f slow-service.yaml",
  );
  expect(status(probe(wrong, 200, first(s), "readiness"))).toBe("in_progress");
  const done = probe(one, 200, first(s), "readiness");
  expect(status(done)).toBe("completed");
  expect(restore(done).world).toEqual(done.world);
  expect(execute(done, "sim kubernetes probe --help").text).toContain("startup");
  expect(Engine.completionCandidates(done.world, "sim files load kubernetes-s")).toContain(
    "kubernetes-startup",
  );
});
