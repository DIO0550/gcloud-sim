// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { Now, run, type Session, session } from "@/engine/__tests__/setup";
import { KubeManifest } from "@/engine/domains/kube-manifest";
import { KubeReadiness } from "@/engine/domains/kube-readiness";
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
const ready = (s = session()) =>
  execute(
    s,
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create readiness-gke --zone=us-central1-a",
    "sim files load kubernetes-readiness",
    "kubectl apply -f ready-web.yaml",
    "kubectl apply -f ready-service.yaml",
  );
const d = (s: Session) => {
  const value = s.world.kubeDeployments.find(
    (d) => d.name === "ready-web" && d.cluster === "readiness-gke",
  );
  if (!value) throw new Error("Missing Deployment");
  return value;
};
const pods = (s: Session) => KubePod.fromDeployment(d(s));
const first = (s: Session) => pods(s)[0]?.name ?? "missing";
const backends = (s: Session) => {
  const service = s.world.kubeServices.find((s) => s.name === "ready-service");
  if (!service) throw new Error("Missing Service");
  return KubeServiceRouting.backends(s.world, service);
};
const probe = (s: Session, code = 200, pod = "") =>
  execute(s, `sim kubernetes probe ready-web --status-code=${code}${pod ? ` --pod=${pod}` : ""}`);
const healthy = (s = ready()) => probe(probe(s));
const json = (s: Session, c: string) => JSON.parse(execute(s, c).text);
const snap = (s: Session) => JSON.parse(JSON.stringify(Snapshot.create(s.world, Now)));
const restore = (s: Session) => session(Result.unwrap(Snapshot.fromUnknown(snap(s))));
const rejected = (s: Session, c: string, message: string) => {
  const next = run(s, c);
  expect(next.text).toContain(message);
  expect(next.world).toEqual(s.world);
};
const manifest = (readinessProbe: unknown) => ({
  apiVersion: "apps/v1",
  kind: "Deployment",
  metadata: { name: "ready-web" },
  spec: {
    replicas: 2,
    selector: { matchLabels: { app: "ready-web" } },
    template: {
      metadata: { labels: { app: "ready-web" } },
      spec: { containers: [{ name: "ready-web", image: "nginx:1", readinessProbe }] },
    },
  },
});
const apply = (s: Session, p: unknown) =>
  execute(
    s,
    `sim files write probe.json --content='${JSON.stringify(manifest(p))}'`,
    "kubectl apply -f probe.json",
  );
const config = {
  httpGet: { path: "/ready", port: 8080 },
  successThreshold: 2,
  failureThreshold: 2,
};

test("Running Pods start unready and join Service only after consecutive successes", () => {
  const s = ready();
  expect(backends(s)).toEqual([]);
  const record = json(s, "kubectl get pods -o json").items[0];
  expect(record.status).toMatchObject({
    phase: "Running",
    conditions: [{ type: "Ready", status: "False" }],
  });
  expect(record.spec.containers[0].readinessProbe).toEqual(config);
  expect(execute(s, "kubectl get pods").text).toMatch(/0\/1\s+Running\s+0/);
  expect(json(s, "kubectl get deployment ready-web -o json")).toMatchObject({
    status: { readyReplicas: 0 },
    containerError: "",
  });
  rejected(s, "kubectl rollout status deployment/ready-web", "ReadinessProbePending");
  const once = probe(s);
  expect(backends(once)).toEqual([]);
  const next = probe(once);
  expect(backends(next)).toHaveLength(2);
  expect(json(next, "kubectl get deployment ready-web -o json").status.readyReplicas).toBe(2);
  expect(d(next).revision).toBe(d(s).revision);
  expect(d(next).generation).toBe(d(s).generation);
  expect(pods(next).map((p) => p.name)).toEqual(pods(s).map((p) => p.name));
  expect(execute(next, "kubectl rollout status deployment/ready-web").text).toContain(
    "successfully",
  );
});

test("failure threshold removes one Pod, leaves it running without restart, and recovery rejoins", () => {
  const s = healthy();
  const name = first(s);
  const oneFailure = probe(s, 503, name);
  expect(backends(oneFailure)).toHaveLength(2);
  const failed = probe(oneFailure, 503, name);
  expect(backends(failed)).toHaveLength(1);
  const item = json(failed, `kubectl get pod ${name} -o json`);
  expect(item).toMatchObject({
    ready: "0/1",
    restarts: 0,
    displayStatus: "Running",
    status: { phase: "Running", conditions: [{ type: "Ready", status: "False" }] },
  });
  expect(json(failed, "kubectl get rs -o json").items[0].status.readyReplicas).toBe(1);
  expect(execute(failed, "kubectl describe service ready-service").text).not.toContain(`"${name}"`);
  expect(execute(failed, `kubectl logs ${name}`).text).toContain("Listening");
  execute(failed, `kubectl exec ${name} -- printenv`);
  const once = probe(restore(failed), 200, name);
  expect(backends(once)).toHaveLength(1);
  const recovered = probe(once, 200, name);
  expect(backends(recovered)).toHaveLength(2);
  expect(pods(recovered).map((p) => p.name)).toEqual(pods(s).map((p) => p.name));
});

test("opposite responses reset consecutive counts; HTTP 200..399 is successful", () => {
  let s = probe(ready(), 200);
  s = probe(s, 500);
  s = probe(s, 399);
  expect(backends(s)).toHaveLength(0);
  s = probe(s, 200);
  expect(backends(s)).toHaveLength(2);
  s = probe(s, 400);
  s = probe(s, 204);
  s = probe(s, 199);
  expect(backends(s)).toHaveLength(2);
  s = probe(s, 599);
  expect(backends(s)).toHaveLength(0);
});

test("default probe values, saturating counters and absent probe compatibility", () => {
  const s = apply(ready(), { httpGet: { port: 80 } });
  expect(Option.unwrap(d(s).readinessProbe)).toEqual({
    httpGet: { path: "/", port: 80 },
    successThreshold: 1,
    failureThreshold: 3,
  });
  const up = probe(probe(s));
  expect(d(up).podReadiness.every((p) => p.successes === 1)).toBe(true);
  expect(backends(probe(probe(up, 503), 503))).toHaveLength(2);
  const down = probe(probe(probe(probe(up, 503), 503), 503), 503);
  expect(d(down).podReadiness.every((p) => !p.ready && p.failures === 3)).toBe(true);
  const cleared = apply(down, undefined);
  expect(d(cleared).podReadiness).toEqual([]);
  expect(backends(cleared)).toHaveLength(2);
  rejected(cleared, "sim kubernetes probe ready-web --status-code=200", "no readinessProbe");
});

test("apply is idempotent, template changes reset samples, undo restores config but not old readiness", () => {
  const s = healthy();
  expect(execute(s, "kubectl apply -f ready-web.yaml").world).toEqual(s.world);
  const changed = apply(s, { ...config, httpGet: { path: "/health", port: 80 } });
  expect(d(changed).revisions.at(-1)?.reason).toBe("readiness");
  expect(d(changed).revision).toBe(d(s).revision + 1);
  expect(d(changed).podReadiness).toEqual([]);
  expect(backends(changed)).toEqual([]);
  const undo = execute(healthy(changed), "kubectl rollout undo deployment/ready-web");
  expect(d(undo).readinessProbe).toEqual(d(s).readinessProbe);
  expect(d(undo).podReadiness).toEqual([]);
  expect(
    json(undo, "kubectl get rs -o json").items.at(-1).spec.template.spec.containers[0]
      .readinessProbe,
  ).toEqual(config);
  expect(execute(undo, "kubectl rollout history deployment/ready-web --revision=3").text).toContain(
    "readinessProbe",
  );
});

test("scale preserves existing readiness, new/recreated/restarted Pods need fresh samples", () => {
  const s = healthy();
  const grown = execute(s, "kubectl scale deployment/ready-web --replicas=3");
  expect(backends(grown)).toHaveLength(2);
  expect(d(grown).podReadiness).toEqual(d(s).podReadiness);
  const recreated = execute(grown, `kubectl delete pod ${first(grown)}`);
  expect(backends(recreated)).toHaveLength(1);
  expect(d(recreated).podReadiness).toHaveLength(1);
  const reduced = execute(healthy(recreated), "kubectl scale deployment/ready-web --replicas=1");
  expect(d(reduced).podReadiness).toHaveLength(1);
  const restarted = execute(reduced, "kubectl rollout restart deployment/ready-web");
  expect(backends(restarted)).toEqual([]);
  expect(d(restarted).podReadiness).toEqual([]);
});

test("HPA blocks unready Pods; scale-up produces new unready Pods", () => {
  const s = execute(
    ready(),
    "kubectl set resources deployment/ready-web --requests=cpu=250m",
    "kubectl autoscale deployment/ready-web --max=4 --cpu-percent=50",
  );
  const blocked = execute(s, "sim kubernetes reconcile ready-web --cpu=250m");
  expect(blocked.text).toContain("PodsNotReady");
  expect(d(blocked).replicas).toBe(2);
  const scaled = execute(healthy(blocked), "sim kubernetes reconcile ready-web --cpu=250m");
  expect(d(scaled).replicas).toBe(4);
  expect(backends(scaled)).toHaveLength(2);
  expect(execute(scaled, "sim kubernetes reconcile ready-web --cpu=250m").text).toContain(
    "PodsNotReady",
  );
});

test.each([
  null,
  {},
  { tcpSocket: { port: 80 } },
  { exec: { command: ["true"] } },
  { httpGet: null },
  { httpGet: { port: "http" } },
  { httpGet: { port: 0 } },
  { httpGet: { port: 65536 } },
  { httpGet: { port: 80, path: "ready" } },
  { httpGet: { port: 80, path: null } },
  { httpGet: { port: 80, host: "example.com" } },
  { httpGet: { port: 80, scheme: "HTTPS" } },
  { httpGet: { port: 80, httpHeaders: [] } },
  { httpGet: { port: 80 }, periodSeconds: 10 },
  { httpGet: { port: 80 }, initialDelaySeconds: 0 },
  { httpGet: { port: 80 }, timeoutSeconds: 1 },
  { ...config, successThreshold: 0 },
  { ...config, failureThreshold: 1001 },
  { ...config, failureThreshold: 1.5 },
  { ...config, successThreshold: "2" },
  { ...config, successThreshold: null },
])("invalid/unsupported probe is rejected atomically: %j", (value) => {
  expect(Result.isOk(KubeManifest.parse(JSON.stringify(manifest(value))))).toBe(false);
  const s = execute(
    ready(),
    `sim files write invalid.json --content='${JSON.stringify(manifest(value))}'`,
  );
  rejected(s, "kubectl apply -f invalid.json", "error:");
});

test.each([
  "",
  "--status-code=99",
  "--status-code=600",
  "--status-code=200.5",
  "--status-code=abc",
  "--status-code=200 --status-code=503",
  "--status-code=200 --pod=missing",
  "--status-code=200 --namespace=other",
])("bad probe command cannot mutate samples: %s", (args) => {
  rejected(ready(), `sim kubernetes probe ready-web ${args}`, "ERROR:");
});

test("startup failure blocks probe, while viewer can read but cannot supply samples", () => {
  const s = ready();
  const value = manifest(config);
  const broken = {
    ...value,
    spec: {
      ...value.spec,
      template: {
        ...value.spec.template,
        spec: {
          containers: [
            {
              ...value.spec.template.spec.containers[0],
              env: [
                { name: "MODE", valueFrom: { configMapKeyRef: { name: "missing", key: "MODE" } } },
              ],
            },
          ],
        },
      },
    },
  };
  const failed = execute(
    s,
    `sim files write broken.json --content='${JSON.stringify(broken)}'`,
    "kubectl apply -f broken.json",
  );
  rejected(
    failed,
    "sim kubernetes probe ready-web --status-code=200",
    "CreateContainerConfigError",
  );
  const viewer = execute(
    s,
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:viewer@example.com --role=roles/container.viewer",
    "gcloud auth login viewer@example.com",
  );
  execute(viewer, "kubectl get pods -o json", "kubectl describe deployment ready-web");
  rejected(
    viewer,
    "sim kubernetes probe ready-web --status-code=200",
    "container.deployments.update",
  );
});

test("cluster/API boundaries, missing Deployment and zero replicas reject sample mutation", () => {
  rejected(session(), "sim kubernetes probe ready-web --status-code=200", "ERROR:");
  rejected(ready(), "sim kubernetes probe missing --status-code=200", "not found");
  const zero = execute(healthy(), "kubectl scale deployment/ready-web --replicas=0");
  expect(d(zero).podReadiness).toEqual([]);
  rejected(zero, "sim kubernetes probe ready-web --status-code=200", "No matching Pod");
  const other = execute(
    healthy(),
    "gcloud container clusters create other --zone=us-central1-a",
    "kubectl apply -f ready-web.yaml",
  );
  const sampled = probe(other);
  expect(d(sampled).podReadiness).toEqual(d(other).podReadiness);
  expect(
    sampled.world.kubeDeployments
      .find((d) => d.cluster === "other")
      ?.podReadiness.every((p) => !p.ready),
  ).toBe(true);
});

test("snapshot roundtrip retains samples; v14 migration preserves HPA evaluations and resource history", () => {
  const s = probe(healthy(), 503, first(healthy()));
  expect(restore(s).world).toEqual(s.world);
  const legacy = execute(
    apply(s, undefined),
    "kubectl set resources deployment/ready-web --requests=cpu=250m",
    "kubectl autoscale deployment/ready-web --max=4 --cpu-percent=50",
    "sim kubernetes reconcile ready-web --cpu=250m",
  );
  const old = snap(legacy);
  old.schemaVersion = 14;
  for (const d of old.world.kubeDeployments) {
    delete d.readinessProbe;
    delete d.podReadiness;
    for (const r of d.revisions) delete r.readinessProbe;
  }
  const restored = Result.unwrap(Snapshot.fromUnknown(old));
  expect(restored.kubeHpas).toEqual(legacy.world.kubeHpas);
  expect(restored.kubeDeployments[0]?.resources).toEqual(d(legacy).resources);
  expect(restored.kubeDeployments[0]?.podReadiness).toEqual([]);
  expect(restored.kubeDeployments[0]?.readinessProbe).toEqual(Option.none);
});

test.each(["missing", "foreign", "duplicate", "counter", "status", "mismatch", "threshold"])(
  "invalid saved probe/sample is rejected: %s",
  (kind) => {
    const value = snap(healthy());
    const d = value.world.kubeDeployments[0];
    if (kind === "missing") delete d.podReadiness;
    if (kind === "foreign") d.podReadiness[0].podName = "foreign";
    if (kind === "duplicate") d.podReadiness.push(d.podReadiness[0]);
    if (kind === "counter") d.podReadiness[0].successes = 3;
    if (kind === "status") d.podReadiness[0].statusCode = 503;
    if (kind === "mismatch") d.readinessProbe.value.httpGet.port = 80;
    if (kind === "threshold") d.podReadiness[0].ready = false;
    expect(Result.isOk(Snapshot.fromUnknown(value))).toBe(false);
  },
);

test("mission requires a mixed ready/unready pair with one actual Service backend and resumes", () => {
  const id = "m-gke-012";
  const status = (s: Session) => s.world.missions.find((m) => m.id === id)?.status;
  const s = ready(session(Result.unwrap(Engine.startMission(session().world, id))));
  expect(status(s)).toBe("in_progress");
  const allReady = healthy(s);
  expect(status(allReady)).toBe("in_progress");
  expect(status(probe(probe(allReady, 503), 503))).toBe("in_progress");
  const partial = probe(allReady, 503, first(allReady));
  expect(status(partial)).toBe("in_progress");
  const wrongService = execute(
    partial,
    "sim files replace ready-service.yaml --search='app: ready-web' --replacement='app: missing'",
    "kubectl apply -f ready-service.yaml",
  );
  expect(status(probe(wrongService, 503, first(wrongService)))).toBe("in_progress");
  const done = probe(restore(partial), 503, first(partial));
  expect(status(done)).toBe("completed");
  expect(restore(done).world).toEqual(done.world);
  expect(execute(done, "sim kubernetes probe --help").text).toContain("--status-code");
  expect(Engine.completionCandidates(done.world, "sim kubernetes probe ready-")).toContain(
    "ready-web",
  );
  expect(Engine.completionCandidates(done.world, "sim files load kubernetes-r")).toContain(
    "kubernetes-readiness",
  );
  expect(KubeReadiness.ready(d(done), first(done))).toBe(false);
});

test("all-Pod sampling is atomic when only a newly scaled Pod has a config startup error", () => {
  const s = execute(
    ready(),
    "kubectl create configmap settings --from-literal=MODE=demo",
    "kubectl set env deployment/ready-web --from=configmap/settings",
  );
  const up = healthy(s);
  const mixed = execute(
    up,
    "kubectl delete configmap settings",
    "kubectl scale deployment/ready-web --replicas=3",
  );
  rejected(mixed, "sim kubernetes probe ready-web --status-code=503", "CreateContainerConfigError");
  const one = probe(mixed, 503, first(mixed));
  expect(
    json(one, `kubectl get pod ${first(one)} -o json`).simulator.readinessSample,
  ).toMatchObject({ ready: true, failures: 1, successes: 0, statusCode: 503 });
  expect(backends(one)).toHaveLength(2);
});
