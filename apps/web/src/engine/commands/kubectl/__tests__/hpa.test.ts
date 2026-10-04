// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { Now, run, type Session, session } from "@/engine/__tests__/setup";
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
    "gcloud container clusters create-auto hpa-gke --region=us-central1",
    "kubectl create deployment hpa-web --image=nginx:1 --replicas=2",
  );
const configured = () =>
  execute(
    ready(),
    "kubectl set resources deployment/hpa-web --requests=cpu=250m --limits=cpu=1",
    "kubectl autoscale deployment/hpa-web --min=1 --max=5 --cpu-percent=50",
  );
const d = (s: Session) => {
  const value = s.world.kubeDeployments[0];
  if (!value) throw new Error("Missing fixture Deployment");
  return value;
};
const h = (s: Session) => {
  const value = s.world.kubeHpas[0];
  if (!value) throw new Error("Missing fixture HPA");
  return value;
};
const evaluation = (s: Session) => Option.unwrap(h(s).lastEvaluation);
const cycle = (s: Session, cpu: string) =>
  execute(s, `sim kubernetes reconcile hpa-web --cpu=${cpu}`);
const snapshot = (s: Session) => JSON.parse(JSON.stringify(Snapshot.create(s.world, Now)));
const restore = (s: Session) => session(Result.unwrap(Snapshot.fromUnknown(snapshot(s))));
const rejected = (s: Session, command: string, message = "error:") => {
  const next = run(s, command);
  expect(next.text).toContain(message);
  expect(next.world).toEqual(s.world);
};
const json = (s: Session, command: string) => JSON.parse(execute(s, command).text);

test("HPA creation waits for a sample; CPU uses requests, scales without rollout, retains old Pod values and updates Service endpoints", () => {
  const s = execute(
    configured(),
    "kubectl create configmap config --from-literal=MODE=old",
    "kubectl set env deployment/hpa-web --from=configmap/config",
    "kubectl expose deployment hpa-web --port=80",
    "kubectl delete configmap config",
    "kubectl create configmap config --from-literal=MODE=new",
  );
  expect(d(s).replicas).toBe(2);
  expect(execute(s, "kubectl get hpa").text).toContain("<unknown>/50%");
  const oldNames = KubePod.fromDeployment(d(s)).map((p) => p.name);
  const scaled = cycle(s, "0.250");
  expect(evaluation(scaled)).toMatchObject({
    currentReplicas: 2,
    desiredReplicas: 4,
    cpuMilli: 250,
    requestMilli: 250,
    reason: "Scaled",
  });
  expect(d(scaled).revision).toBe(d(s).revision);
  expect(d(scaled).revisions).toEqual(d(s).revisions);
  const names = KubePod.fromDeployment(d(scaled)).map((p) => p.name);
  expect(names.slice(0, 2)).toEqual(oldNames);
  expect(execute(scaled, `kubectl exec ${names[0]} -- printenv MODE`).text).toBe("old");
  expect(execute(scaled, `kubectl exec ${names[2]} -- printenv MODE`).text).toBe("new");
  expect(json(scaled, "kubectl get service hpa-web -o json").spec.selector).toEqual({
    app: "hpa-web",
  });
  expect(execute(scaled, "kubectl describe service hpa-web").text).toContain(names[3]);
  const record = json(scaled, "kubectl get horizontalpodautoscalers.autoscaling/hpa-web -o json");
  expect(record.spec.metrics[0].resource.target.averageUtilization).toBe(50);
  expect(record.status.currentMetrics[0].resource.current.averageUtilization).toBe(100);
  expect(record.status).toMatchObject({ currentReplicas: 2, desiredReplicas: 4 });
  expect(execute(scaled, "kubectl get all").text).toContain(
    "horizontalpodautoscaler.autoscaling/hpa-web",
  );
  expect(execute(scaled, "kubectl get hpa hpa-web -o yaml", "kubectl describe hpa").text).toContain(
    "explicit-single-cycle",
  );
  expect(execute(scaled, "kubectl get hpa").world).toEqual(scaled.world);
  expect(restore(scaled).world).toEqual(scaled.world);
});

test.each([
  ["0", 1, "TooFewReplicas"],
  ["1m", 1, "Scaled"],
  ["125m", 2, "WithinRange"],
  ["250m", 4, "Scaled"],
  ["251m", 5, "Scaled"],
  ["1", 5, "TooManyReplicas"],
  ["1000000", 5, "TooManyReplicas"],
])("one evaluation with %s CPU yields %i replicas (%s)", (cpu, count, reason) => {
  const s = cycle(configured(), cpu);
  expect(d(s).replicas).toBe(count);
  expect(evaluation(s).reason).toBe(reason);
});
test.each([
  ["90m", 10],
  ["110m", 10],
  ["89m", 9],
  ["111m", 12],
])("10 percent tolerance has exact boundaries: %s", (cpu, replicas) => {
  const s = execute(
    ready(),
    "kubectl set resources deployment/hpa-web --requests=cpu=200m",
    "kubectl scale deployment/hpa-web --replicas=10",
    "kubectl autoscale deployment hpa-web --max=20 --cpu-percent=50",
  );
  expect(d(cycle(s, cpu)).replicas).toBe(replicas);
});
test("minimum and maximum are enforced even inside tolerance; target may exceed 100 percent", () => {
  const s = execute(
    ready(),
    "kubectl set resources deployment/hpa-web --requests=cpu=100m",
    "kubectl autoscale deployment hpa-web --min=3 --max=5 --cpu-percent=200",
  );
  expect(d(cycle(s, "200m")).replicas).toBe(3);
  const manual = execute(s, "kubectl scale deployment/hpa-web --replicas=8");
  expect(d(cycle(manual, "200m")).replicas).toBe(5);
});
test("missing and zero requests, zero replicas, missing target and unready Pods do not scale", () => {
  const noRequest = execute(ready(), "kubectl autoscale deployment/hpa-web --max=5");
  expect(evaluation(cycle(noRequest, "250m")).reason).toBe("MissingCpuRequest");
  const zero = execute(noRequest, "kubectl scale deployment/hpa-web --replicas=0");
  expect(evaluation(cycle(zero, "250m"))).toMatchObject({
    reason: "ScalingDisabled",
    desiredReplicas: 0,
  });
  const missing = execute(noRequest, "kubectl delete deployment/hpa-web");
  expect(evaluation(cycle(missing, "250m")).reason).toBe("TargetNotFound");
  expect(restore(cycle(missing, "250m")).world).toEqual(cycle(missing, "250m").world);
  const badImage = execute(
    configured(),
    "kubectl set image deployment/hpa-web hpa-web=us-central1-docker.pkg.dev/ace-dev-01/missing/web:v1",
  );
  expect(evaluation(cycle(badImage, "250m")).reason).toBe("PodsNotReady");
  const config = execute(
    configured(),
    "kubectl create configmap config --from-literal=MODE=old",
    "kubectl set env deployment/hpa-web --from=configmap/config",
    "kubectl delete configmap config",
    "kubectl scale deployment/hpa-web --replicas=3",
  );
  expect(evaluation(cycle(config, "250m"))).toMatchObject({
    reason: "PodsNotReady",
    desiredReplicas: 3,
  });
});
test("repairing CPU request needs another explicit evaluation; deleting HPA leaves Deployment and clears history", () => {
  const missing = cycle(
    execute(ready(), "kubectl autoscale deployment/hpa-web --max=5 --cpu-percent=50"),
    "250m",
  );
  const repaired = execute(missing, "kubectl set resources deployment/hpa-web --requests=cpu=250m");
  expect(d(repaired).replicas).toBe(2);
  expect(evaluation(repaired).reason).toBe("MissingCpuRequest");
  const scaled = cycle(repaired, "250m");
  const removed = execute(scaled, "kubectl delete hpa hpa-web");
  expect(d(removed)).toEqual(d(scaled));
  expect(removed.world.kubeHpas).toEqual([]);
  const recreated = execute(removed, "kubectl autoscale deployment hpa-web --max=5 --name=other");
  expect(h(recreated).lastEvaluation).toEqual(Option.none);
  expect(h(recreated).targetCpu).toBe(80);
  rejected(recreated, "sim kubernetes reconcile hpa-web --cpu=250m", "not found");
});
test.each([
  "kubectl autoscale deployment/hpa-web",
  "kubectl autoscale deployment/hpa-web --max=0",
  "kubectl autoscale deployment/hpa-web --min=0 --max=5",
  "kubectl autoscale deployment/hpa-web --min=6 --max=5",
  "kubectl autoscale deployment/hpa-web --max=1001",
  "kubectl autoscale deployment/hpa-web --max=5 --cpu-percent=0",
  "kubectl autoscale deployment/hpa-web --max=5 --cpu-percent=1001",
  "kubectl autoscale deployment/hpa-web --max=5 --name=BAD",
  "kubectl autoscale deployment/hpa-web --max=5 --cpu-percent=50.5",
  "kubectl autoscale service/hpa-web --max=5",
])("invalid autoscaler creation is atomic: %s", (command) => rejected(ready(), command));
test.each(["-1m", "1Mi", "0.0001", "1000000001m", "NaN"])(
  "invalid CPU sample is atomic: %s",
  (cpu) => rejected(configured(), `sim kubernetes reconcile hpa-web --cpu=${cpu}`, "ERROR:"),
);
test("duplicates, unavailable targets, unsupported operations, API, namespace and context are rejected", () => {
  const s = configured();
  rejected(s, "kubectl autoscale deployment hpa-web --max=5", "already exists");
  rejected(s, "kubectl autoscale deployment hpa-web --max=5 --name=other", "Only one HPA");
  rejected(s, "kubectl autoscale deployment missing --max=5", "not found");
  rejected(s, "sim kubernetes reconcile hpa-web", "--cpu is required");
  rejected(s, "kubectl get hpa -n other", 'namespaces "other" not found');
  rejected(s, "kubectl get hpa -l app=hpa-web", "--selector supports");
  rejected(s, "kubectl delete hpa missing", "not found");
  rejected(s, "kubectl get hpa missing", "not found");
  rejected(session(), "kubectl autoscale deployment hpa-web --max=5", "container.googleapis.com");
  rejected(
    execute(session(), "gcloud services enable container.googleapis.com"),
    "sim kubernetes reconcile hpa-web --cpu=1",
    "connection to the server",
  );
  const other = execute(s, "gcloud container clusters create-auto other --region=us-central1");
  expect(execute(other, "kubectl get hpa").text).toContain("No resources");
  rejected(other, "sim kubernetes reconcile hpa-web --cpu=1", "not found");
  const deleted = execute(
    s,
    "gcloud container clusters delete hpa-gke --region=us-central1 --quiet",
  );
  expect(deleted.world.kubeHpas).toEqual([]);
});
test("viewer reads HPA, but cannot create/delete or run simulated evaluation", () => {
  const viewer = execute(
    configured(),
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:developer@example.com --role=roles/container.viewer",
    "gcloud auth login developer@example.com",
  );
  execute(
    viewer,
    "kubectl get hpa",
    "kubectl get hpa/hpa-web -o json",
    "kubectl describe hpa hpa-web",
  );
  rejected(
    viewer,
    "kubectl autoscale deployment/hpa-web --max=5",
    "container.horizontalPodAutoscalers.create",
  );
  rejected(viewer, "kubectl delete hpa hpa-web", "container.horizontalPodAutoscalers.delete");
  rejected(
    viewer,
    "sim kubernetes reconcile hpa-web --cpu=250m",
    "container.horizontalPodAutoscalers.update",
  );
});
test("v13 migration preserves all preexisting resources, revisions, files and configuration", () => {
  const s = execute(
    ready(),
    "kubectl set resources deployment/hpa-web --requests=cpu=250m,memory=128Mi",
    "kubectl set image deployment/hpa-web hpa-web=nginx:2",
    "sim files load kubernetes-labels",
  );
  const old = snapshot(s);
  old.schemaVersion = 13;
  delete old.world.kubeHpas;
  expect(Result.unwrap(Snapshot.fromUnknown(old))).toEqual(s.world);
});
test.each([
  "missing",
  "duplicate",
  "targetDuplicate",
  "cluster",
  "range",
  "sample",
  "scaledWithoutRequest",
])("v14 rejects invalid HPA snapshot: %s", (kind) => {
  const value = snapshot(cycle(configured(), "250m"));
  const hpa = value.world.kubeHpas[0];
  if (kind === "missing") delete value.world.kubeHpas;
  if (kind === "duplicate") value.world.kubeHpas.push(hpa);
  if (kind === "targetDuplicate") value.world.kubeHpas.push({ ...hpa, name: "other" });
  if (kind === "cluster") hpa.cluster = "missing";
  if (kind === "range") hpa.minReplicas = 6;
  if (kind === "sample") hpa.lastEvaluation.value.cpuMilli = -1;
  if (kind === "scaledWithoutRequest") hpa.lastEvaluation.value.requestMilli = 0;
  expect(Result.isOk(Snapshot.fromUnknown(value))).toBe(false);
});
test("mission rejects manual scale, missing request and insufficient CPU sample; resumes after save", () => {
  const id = "m-gke-009";
  const s = ready(session(Result.unwrap(Engine.startMission(session().world, id))));
  const status = (s: Session) => s.world.missions.find((m) => m.id === id)?.status;
  const configured = execute(
    s,
    "kubectl autoscale deployment/hpa-web --min=1 --max=5 --cpu-percent=50",
  );
  expect(status(cycle(configured, "250m"))).toBe("in_progress");
  const withRequest = execute(
    configured,
    "kubectl set resources deployment/hpa-web --requests=cpu=250m",
  );
  expect(status(execute(withRequest, "kubectl scale deployment/hpa-web --replicas=4"))).toBe(
    "in_progress",
  );
  expect(status(cycle(withRequest, "125m"))).toBe("in_progress");
  expect(status(cycle(restore(withRequest), "250m"))).toBe("completed");
});
test("help and completion expose the teaching command and current cluster HPAs", () => {
  const s = configured();
  expect(execute(s, "kubectl autoscale --help").text).toContain("cpu-percent");
  expect(execute(s, "sim kubernetes reconcile --help").text).toContain("--cpu");
  expect(Engine.completionCandidates(s.world, "sim kubernetes reconcile hpa-")).toContain(
    "hpa-web",
  );
});

test("same HPA and Deployment names in another cluster stay isolated and survive snapshots", () => {
  const original = configured();
  const other = execute(
    original,
    "gcloud container clusters create-auto other --region=us-central1",
    "kubectl create deployment hpa-web --image=nginx:1 --replicas=2",
    "kubectl set resources deployment/hpa-web --requests=cpu=250m",
    "kubectl autoscale deployment hpa-web --max=5 --cpu-percent=50",
    "sim kubernetes reconcile hpa-web --cpu=250m",
  );
  expect(other.world.kubeDeployments.map((d) => d.replicas)).toEqual([2, 4]);
  expect(other.world.kubeHpas[0]).toEqual(h(original));
  expect(json(other, "kubectl get hpa -o json").items).toHaveLength(1);
  expect(restore(other).world).toEqual(other.world);
  const removed = execute(
    other,
    "gcloud container clusters delete other --region=us-central1 --quiet",
  );
  expect(removed.world.kubeHpas).toEqual(original.world.kubeHpas);
});

test("custom HPA reader needs no Pod access, and HPA update alone cannot scale a Deployment", () => {
  const s = execute(
    configured(),
    "gcloud iam roles create hpaReader --permissions=container.horizontalPodAutoscalers.get,container.horizontalPodAutoscalers.list,container.horizontalPodAutoscalers.update",
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:developer@example.com --role=projects/ace-dev-01/roles/hpaReader",
    "gcloud auth login developer@example.com",
  );
  execute(s, "kubectl get hpa", "kubectl describe hpa hpa-web");
  rejected(s, "kubectl get pods", "container.pods.list");
  rejected(s, "sim kubernetes reconcile hpa-web --cpu=250m", "container.deployments.update");
});
