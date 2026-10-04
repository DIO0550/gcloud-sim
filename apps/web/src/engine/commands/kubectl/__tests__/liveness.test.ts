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
    "gcloud container clusters create liveness-gke --zone=us-central1-a",
    "sim files load kubernetes-liveness",
    "kubectl apply -f live-web.yaml",
    "kubectl apply -f live-service.yaml",
  );
const d = (s: Session) => {
  const value = s.world.kubeDeployments.find(
    (d) => d.name === "live-web" && d.cluster === "liveness-gke",
  );
  if (!value) throw new Error("Missing Deployment");
  return value;
};
const pods = (s: Session) => KubePod.fromDeployment(d(s));
const first = (s: Session) => pods(s)[0]?.name ?? "missing";
const backends = (s: Session) => {
  const service = s.world.kubeServices.find((s) => s.name === "live-service");
  if (!service) throw new Error("Missing Service");
  return KubeServiceRouting.backends(s.world, service);
};
const probe = (s: Session, code = 200, pod = "", kind = "liveness") =>
  execute(
    s,
    `sim kubernetes probe live-web --kind=${kind} --status-code=${code}${pod ? ` --pod=${pod}` : ""}`,
  );
const healthy = (s = setup()) => probe(s, 200, "", "readiness");
const restarted = (s = healthy(), name = first(s)) => probe(probe(s, 503, name), 503, name);
const json = (s: Session, c: string) => JSON.parse(execute(s, c).text);
const snap = (s: Session) => JSON.parse(JSON.stringify(Snapshot.create(s.world, Now)));
const restore = (s: Session) => session(Result.unwrap(Snapshot.fromUnknown(snap(s))));
const rejected = (s: Session, command: string, message: string) => {
  const next = run(s, command);
  expect(next.text).toContain(message);
  expect(next.world).toEqual(s.world);
};
const manifest = (
  livenessProbe: unknown,
  readinessProbe: unknown = { httpGet: { port: 8080, path: "/ready" }, failureThreshold: 1 },
) => ({
  apiVersion: "apps/v1",
  kind: "Deployment",
  metadata: { name: "live-web" },
  spec: {
    replicas: 2,
    selector: { matchLabels: { app: "live-web" } },
    template: {
      metadata: { labels: { app: "live-web" } },
      spec: { containers: [{ name: "live-web", image: "nginx:1", livenessProbe, readinessProbe }] },
    },
  },
});
const config = {
  httpGet: { path: "/healthz", port: 8080 },
  successThreshold: 1,
  failureThreshold: 2,
};
const apply = (
  s: Session,
  p: unknown,
  ready: unknown = { httpGet: { port: 8080, path: "/ready" }, failureThreshold: 1 },
) =>
  execute(
    s,
    `sim files write probe.json --content='${JSON.stringify(manifest(p, ready))}'`,
    "kubectl apply -f probe.json",
  );

test("liveness threshold restarts only selected container without replacing Pod/template and resets readiness", () => {
  const s = healthy();
  const name = first(s);
  const once = probe(s, 503, name);
  expect(pods(once).map((p) => p.restarts)).toEqual([0, 0]);
  expect(backends(once)).toHaveLength(2);
  const next = probe(once, 503, name);
  expect(pods(next).map((p) => [p.name, p.ip])).toEqual(pods(s).map((p) => [p.name, p.ip]));
  expect(pods(next).map((p) => p.restarts)).toEqual([1, 0]);
  expect([d(next).revision, d(next).generation, d(next).podIncarnations]).toEqual([
    d(s).revision,
    d(s).generation,
    d(s).podIncarnations,
  ]);
  expect(backends(next)).toHaveLength(1);
  const record = json(next, `kubectl get pod ${name} -o json`);
  expect(record.status).toMatchObject({
    phase: "Running",
    conditions: [{ status: "False" }],
    containerStatuses: [{ restartCount: 1, ready: false, state: { running: {} } }],
  });
  expect(record.simulator).toMatchObject({
    readinessSample: null,
    livenessSample: { statusCode: 503, failures: 0, restarts: 1, restarted: true },
  });
  expect(record.spec.containers[0].livenessProbe).toEqual(config);
  expect(json(next, "kubectl get deployment live-web -o json").status.readyReplicas).toBe(1);
  expect(json(next, "kubectl get rs -o json").items.at(-1).status.readyReplicas).toBe(1);
  expect(execute(next, "kubectl get pods").text).toMatch(/0\/1\s+Running\s+1/);
  rejected(next, "kubectl rollout status deployment/live-web", "ReadinessProbePending");
  execute(next, `kubectl logs ${name}`, `kubectl exec ${name} -- printenv`);
  const alive = probe(restore(next), 200, name);
  expect(backends(alive)).toHaveLength(1);
  const recovered = probe(alive, 200, name, "readiness");
  expect(backends(recovered)).toHaveLength(2);
  expect(pods(recovered).map((p) => p.restarts)).toEqual([1, 0]);
  execute(recovered, "kubectl rollout status deployment/live-web");
});

test("readiness failures never trigger liveness restart, while repeated liveness failures start fresh cycles", () => {
  const s = probe(healthy(), 503, "", "readiness");
  expect(backends(s)).toHaveLength(0);
  expect(pods(s).map((p) => p.restarts)).toEqual([0, 0]);
  const once = probe(s, 503);
  const interrupted = probe(once, 200);
  const one = probe(interrupted, 503);
  expect(pods(one).map((p) => p.restarts)).toEqual([0, 0]);
  const both = probe(one, 503);
  expect(pods(both).map((p) => p.restarts)).toEqual([1, 1]);
  const again = probe(probe(restore(both), 503), 503);
  expect(pods(again).map((p) => p.restarts)).toEqual([2, 2]);
  expect(d(again).podLiveness.every((p) => p.failures === 0)).toBe(true);
});

test.each([199, 200, 399, 400, 599])(
  "HTTP boundary %i controls restart with threshold 1",
  (code) => {
    const s = apply(setup(), { ...config, failureThreshold: 1 });
    const next = probe(s, code);
    expect(pods(next)[0]?.restarts).toBe(code >= 200 && code < 400 ? 0 : 1);
  },
);

test("default thresholds/path, liveness-only and probe removal", () => {
  const content = manifest({ httpGet: { port: 80 } });
  Reflect.deleteProperty(content.spec.template.spec.containers[0] ?? {}, "readinessProbe");
  const s = execute(
    setup(),
    `sim files write only.json --content='${JSON.stringify(content)}'`,
    "kubectl apply -f only.json",
  );
  expect(Option.unwrap(d(s).livenessProbe)).toEqual({
    httpGet: { path: "/", port: 80 },
    successThreshold: 1,
    failureThreshold: 3,
  });
  const next = probe(probe(probe(s, 503), 503), 503);
  expect(pods(next).every((p) => p.ready && p.restarts === 1)).toBe(true);
  expect(backends(next)).toHaveLength(2);
  const removed = apply(next, undefined);
  expect(d(removed).podLiveness).toEqual([]);
  rejected(
    removed,
    "sim kubernetes probe live-web --kind=liveness --status-code=200",
    "no livenessProbe",
  );
});

test("same apply keeps samples; probe changes and undo create new Pods with zero restarts", () => {
  const s = restarted();
  const again = execute(s, "kubectl apply -f live-web.yaml");
  expect(d(again)).toEqual(d(s));
  const changed = apply(s, { ...config, failureThreshold: 3 });
  expect(d(changed).revision).toBe(d(s).revision + 1);
  expect(d(changed).revisions.at(-1)?.reason).toBe("liveness");
  expect(d(changed).podLiveness).toEqual([]);
  const undo = execute(changed, "kubectl rollout undo deployment/live-web");
  expect(d(undo).livenessProbe).toEqual(d(s).livenessProbe);
  expect(pods(undo).every((p) => p.restarts === 0 && !p.ready)).toBe(true);
  expect(
    execute(undo, `kubectl rollout history deployment/live-web --revision=${d(undo).revision}`)
      .text,
  ).toContain("livenessProbe");
  expect(
    json(undo, "kubectl get rs -o json").items.at(-1).spec.template.spec.containers[0]
      .livenessProbe,
  ).toEqual(config);
});

test("scale preserves survivors, removes deleted samples, recreated and rollout Pods reset counters", () => {
  const s = restarted();
  const bigger = execute(s, "kubectl scale deployment/live-web --replicas=3");
  expect(pods(bigger).map((p) => p.restarts)).toEqual([1, 0, 0]);
  const newName = pods(bigger)[2]?.name ?? "missing";
  const third = restarted(bigger, newName);
  const smaller = execute(third, "kubectl scale deployment/live-web --replicas=2");
  expect(d(smaller).podLiveness.some((p) => p.podName === newName)).toBe(false);
  const regrown = execute(smaller, "kubectl scale deployment/live-web --replicas=3");
  expect(pods(regrown).map((p) => p.restarts)).toEqual([1, 0, 0]);
  const deleted = execute(s, `kubectl delete pod ${first(s)}`);
  expect(pods(deleted).map((p) => p.restarts)).toEqual([0, 0]);
  expect(first(deleted)).not.toBe(first(s));
  const rollout = execute(s, "kubectl rollout restart deployment/live-web");
  expect(d(rollout).podLiveness).toEqual([]);
  expect(d(rollout).revision).toBe(d(s).revision + 1);
});

test("container restart resolves changed config for only that Pod and can encounter a startup error", () => {
  const s = healthy(
    execute(
      setup(),
      "kubectl create configmap settings --from-literal=MODE=old",
      "kubectl set env deployment/live-web --from=configmap/settings",
    ),
  );
  const name = first(s);
  const changed = execute(
    s,
    "kubectl delete configmap settings",
    "kubectl create configmap settings --from-literal=MODE=new",
  );
  expect(execute(changed, `kubectl exec ${name} -- printenv MODE`).text).toContain("old");
  const next = restarted(changed);
  expect(execute(next, `kubectl exec ${name} -- printenv MODE`).text).toContain("new");
  const other = pods(next)[1]?.name ?? "missing";
  expect(execute(next, `kubectl exec ${other} -- printenv MODE`).text).toContain("old");
  const removed = execute(next, "kubectl delete configmap settings");
  const failed = restarted(removed);
  const record = json(failed, `kubectl get pod ${name} -o json`);
  expect(record.status.containerStatuses[0]).toMatchObject({
    restartCount: 2,
    ready: false,
    state: { waiting: { reason: "CreateContainerConfigError" } },
  });
  expect(backends(failed)).toHaveLength(1);
  rejected(
    failed,
    "sim kubernetes probe live-web --kind=liveness --status-code=503",
    "CreateContainerConfigError",
  );
  rejected(failed, `kubectl exec ${name} -- printenv`, "CreateContainerConfigError");
  const repaired = execute(
    restore(failed),
    "kubectl create configmap settings --from-literal=MODE=repaired",
  );
  expect(execute(repaired, `kubectl exec ${name} -- printenv MODE`).text).toContain("repaired");
  expect(backends(probe(repaired, 200, name, "readiness"))).toHaveLength(2);
});

test("all-Pod evaluation is atomic on startup error; HPA waits for readiness after restart", () => {
  const s = healthy(
    execute(
      setup(),
      "kubectl set resources deployment/live-web --requests=cpu=250m",
      "kubectl autoscale deployment/live-web --max=4 --cpu-percent=50",
    ),
  );
  const next = restarted(s);
  const blocked = execute(next, "sim kubernetes reconcile live-web --cpu=250m");
  expect(d(blocked).replicas).toBe(2);
  expect(blocked.text).toContain("PodsNotReady");
  const recovered = probe(blocked, 200, "", "readiness");
  const scaled = execute(recovered, "sim kubernetes reconcile live-web --cpu=250m");
  expect(pods(scaled).map((p) => p.restarts)).toEqual([1, 0, 0, 0]);
  const configured = execute(
    healthy(),
    "kubectl create configmap settings --from-literal=MODE=ok",
    "kubectl set env deployment/live-web --from=configmap/settings",
    "kubectl delete configmap settings",
    "kubectl scale deployment/live-web --replicas=3",
  );
  rejected(
    configured,
    "sim kubernetes probe live-web --kind=liveness --status-code=503",
    "CreateContainerConfigError",
  );
});

test.each([
  null,
  {},
  { exec: { command: ["true"] } },
  { tcpSocket: { port: 80 } },
  { grpc: { port: 80 } },
  { ...config, successThreshold: 2 },
  { ...config, failureThreshold: 0 },
  { ...config, failureThreshold: 1001 },
  { ...config, failureThreshold: 1.5 },
  { ...config, successThreshold: "1" },
  { ...config, initialDelaySeconds: 1 },
  { ...config, timeoutSeconds: 1 },
  { ...config, periodSeconds: 1 },
  { ...config, terminationGracePeriodSeconds: 1 },
  { httpGet: { port: "http" } },
  { httpGet: { port: 65536 } },
  { httpGet: { port: 80, path: "relative" } },
  { httpGet: { port: 80, scheme: "HTTPS" } },
  { httpGet: { port: 80, host: "localhost" } },
  { httpGet: { port: 80, httpHeaders: [] } },
])("unsupported/invalid liveness probe is rejected: %j", (p) => {
  expect(Result.isOk(KubeManifest.parse(JSON.stringify(manifest(p))))).toBe(false);
});

test.each([
  "--kind=startup --status-code=200",
  "--kind=Liveness --status-code=200",
  "--kind=liveness",
  "--kind=liveness --status-code=99",
  "--kind=liveness --status-code=600",
  "--kind=liveness --status-code=200.5",
  "--kind=liveness --status-code=200 --pod=foreign",
  "--kind=liveness --kind=liveness --status-code=200",
])("invalid sampling rejects mutation: %s", (flags) => {
  rejected(healthy(), `sim kubernetes probe live-web ${flags}`, "ERROR:");
});

test("probe permissions, disabled API, current cluster and zero replicas are enforced", () => {
  const s = healthy();
  const viewer = execute(
    s,
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:viewer@example.com --role=roles/container.viewer",
    "gcloud auth login viewer@example.com",
  );
  execute(viewer, "kubectl get pods -o json");
  rejected(
    viewer,
    "sim kubernetes probe live-web --kind=liveness --status-code=503",
    "container.deployments.update",
  );
  rejected(session(), "sim kubernetes probe live-web --kind=liveness --status-code=503", "ERROR:");
  rejected(s, "sim kubernetes probe missing --kind=liveness --status-code=503", "not found");
  const zero = execute(restarted(s), "kubectl scale deployment/live-web --replicas=0");
  expect(d(zero).podLiveness).toEqual([]);
  rejected(
    zero,
    "sim kubernetes probe live-web --kind=liveness --status-code=503",
    "No matching Pod",
  );
  const other = execute(
    s,
    "gcloud container clusters create other --zone=us-central1-a",
    "kubectl apply -f live-web.yaml",
  );
  const sampled = probe(other, 503);
  expect(d(sampled).podLiveness).toEqual([]);
  expect(
    sampled.world.kubeDeployments.find((d) => d.cluster === "other")?.podLiveness,
  ).toHaveLength(2);
});

test("Snapshot roundtrip retains restarts and v15 migration preserves readiness/HPA/history/files", () => {
  const s = restarted();
  expect(restore(s).world).toEqual(s.world);
  const oldState = healthy(
    execute(
      apply(s, undefined),
      "kubectl set resources deployment/live-web --requests=cpu=250m",
      "kubectl autoscale deployment/live-web --max=3 --cpu-percent=50",
    ),
  );
  const evaluated = execute(oldState, "sim kubernetes reconcile live-web --cpu=125m");
  const old = snap(evaluated);
  old.schemaVersion = 15;
  for (const dep of old.world.kubeDeployments) {
    delete dep.livenessProbe;
    delete dep.podLiveness;
    for (const r of dep.revisions) delete r.livenessProbe;
  }
  const restored = Result.unwrap(Snapshot.fromUnknown(old));
  expect(restored.kubeHpas).toEqual(evaluated.world.kubeHpas);
  expect(restored.kubeFiles).toEqual(evaluated.world.kubeFiles);
  expect(restored.kubeDeployments[0]?.podReadiness).toEqual(d(evaluated).podReadiness);
  expect(restored.kubeDeployments[0]?.podEnvironments).toEqual(d(evaluated).podEnvironments);
  expect(restored.kubeDeployments[0]?.resources).toEqual(d(evaluated).resources);
  expect(restored.kubeDeployments[0]?.livenessProbe).toEqual(Option.none);
  expect(restored.kubeDeployments[0]?.podLiveness).toEqual([]);
});

test.each([
  "missing",
  "foreign",
  "duplicate",
  "counter",
  "negative",
  "unsafe",
  "status",
  "mismatch",
  "successThreshold",
  "successRestart",
  "falseRestart",
  "noRestarts",
])("malformed Snapshot liveness is rejected: %s", (kind) => {
  const value = snap(restarted());
  const dep = value.world.kubeDeployments[0];
  const sample = dep.podLiveness[0];
  if (kind === "missing") delete dep.podLiveness;
  if (kind === "foreign") sample.podName = "foreign";
  if (kind === "duplicate") dep.podLiveness.push(sample);
  if (kind === "counter") sample.failures = 2;
  if (kind === "negative") sample.restarts = -1;
  if (kind === "unsafe") sample.restarts = Number.MAX_SAFE_INTEGER + 1;
  if (kind === "status") sample.statusCode = 600;
  if (kind === "mismatch") dep.livenessProbe.value.httpGet.port = 80;
  if (kind === "successThreshold") dep.revisions[0].livenessProbe.value.successThreshold = 2;
  if (kind === "successRestart") sample.statusCode = 200;
  if (kind === "falseRestart") sample.restarted = false;
  if (kind === "noRestarts") sample.restarts = 0;
  expect(Result.isOk(Snapshot.fromUnknown(value))).toBe(false);
});

test("mission requires one restarted/recovered container and two Service backends; progress resumes", () => {
  const id = "m-gke-013";
  const status = (s: Session) => s.world.missions.find((m) => m.id === id)?.status;
  const s = healthy(setup(session(Result.unwrap(Engine.startMission(session().world, id)))));
  expect(status(s)).toBe("in_progress");
  const partial = restarted(s);
  expect(status(partial)).toBe("in_progress");
  const live = probe(restore(partial), 200, first(partial));
  expect(status(live)).toBe("in_progress");
  const wrong = execute(
    live,
    "sim files replace live-service.yaml --search='app: live-web' --replacement='app: missing'",
    "kubectl apply -f live-service.yaml",
  );
  expect(status(probe(wrong, 200, "", "readiness"))).toBe("in_progress");
  const both = probe(probe(s, 503), 503);
  expect(status(probe(probe(both), 200, "", "readiness"))).toBe("in_progress");
  const done = probe(live, 200, first(live), "readiness");
  expect(status(done)).toBe("completed");
  expect(restore(done).world).toEqual(done.world);
  expect(execute(done, "sim kubernetes probe --help").text).toContain("--kind");
  expect(Engine.completionCandidates(done.world, "sim files load kubernetes-l")).toContain(
    "kubernetes-liveness",
  );
  expect(Engine.completionCandidates(done.world, "sim kubernetes probe live-")).toContain(
    "live-web",
  );
});
