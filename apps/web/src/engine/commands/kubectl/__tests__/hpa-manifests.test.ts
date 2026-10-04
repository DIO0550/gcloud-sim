// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { Now, run, type Session, session } from "@/engine/__tests__/setup";
import { KubeManifest, KubeManifestExamples } from "@/engine/domains/kube-manifest";
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
    "gcloud container clusters create-auto hpa-manifest-gke --region=us-central1",
    "sim files load kubernetes-hpa",
  );
const configured = () =>
  execute(ready(), "kubectl apply -f autoscale-web.yaml", "kubectl apply -f autoscale-hpa.yaml");
const evaluated = () => execute(configured(), "sim kubernetes reconcile autoscale-web --cpu=1");
const h = (s: Session) => {
  const value = s.world.kubeHpas[0];
  if (!value) throw new Error("Missing HPA fixture");
  return value;
};
const d = (s: Session) => {
  const value = s.world.kubeDeployments[0];
  if (!value) throw new Error("Missing Deployment fixture");
  return value;
};
const restore = (s: Session) =>
  session(
    Result.unwrap(Snapshot.fromUnknown(JSON.parse(JSON.stringify(Snapshot.create(s.world, Now))))),
  );
const rejected = (s: Session, command: string, error = "error:") => {
  const next = run(s, command);
  expect(next.text).toContain(error);
  expect(next.world).toEqual(s.world);
};
const manifest = () => ({
  apiVersion: "autoscaling/v2",
  kind: "HorizontalPodAutoscaler",
  metadata: { name: "autoscale-web" },
  spec: {
    scaleTargetRef: { apiVersion: "apps/v1", kind: "Deployment", name: "autoscale-web" },
    minReplicas: 1,
    maxReplicas: 3,
    metrics: [
      {
        type: "Resource",
        resource: { name: "cpu", target: { type: "Utilization", averageUtilization: 80 } },
      },
    ],
  },
});
const patched = (path: string, value: unknown) => {
  const copy = JSON.parse(JSON.stringify(manifest()));
  const keys = path.split(".");
  let parent: Record<string, unknown> = copy;
  for (const key of keys.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
  parent[keys.at(-1) ?? ""] = value;
  return copy;
};
const source = (s: Session, text: string, filename = "hpa.json") =>
  execute(s, `sim files write ${filename} --content='${text}'`);
const write = (s: Session, value: unknown) => source(s, JSON.stringify(value));
const updated = (s: Session) =>
  execute(
    s,
    "sim files replace autoscale-hpa.yaml --search='maxReplicas: 3' --replacement='maxReplicas: 6'",
    "sim files replace autoscale-hpa.yaml --search='averageUtilization: 80' --replacement='averageUtilization: 50'",
  );

test("YAML and JSON create/apply preserve identical HPA state and existing evaluation", () => {
  const s = execute(
    ready(),
    "kubectl create -f autoscale-web.yaml",
    "kubectl create -f autoscale-hpa.yaml",
    "sim kubernetes reconcile autoscale-web --cpu=1",
  );
  expect(h(s)).toMatchObject({
    target: "autoscale-web",
    minReplicas: 1,
    maxReplicas: 3,
    targetCpu: 80,
  });
  expect(d(s).replicas).toBe(3);
  expect(Option.unwrap(h(s).lastEvaluation).reason).toBe("TooManyReplicas");
  const json = write(s, manifest());
  const reapplied = execute(json, "kubectl apply -f hpa.json");
  expect(reapplied.text).toContain("unchanged");
  expect(reapplied.world).toEqual(json.world);
  expect(
    execute(s, "kubectl apply -f autoscale-web.yaml", "kubectl apply -f autoscale-hpa.yaml").world,
  ).toEqual(s.world);
  expect(restore(s).world).toEqual(s.world);
  expect(Snapshot.create(s.world, Now).schemaVersion).toBe(18);
  rejected(s, "kubectl create -f autoscale-hpa.yaml", "already exists");
});
test("configuration changes clear the sample, preserve creation time and Pods, and require explicit reevaluation", () => {
  const initial = evaluated();
  const changed = updated(initial);
  expect(h(changed)).toEqual(h(initial));
  const applied = execute(changed, "kubectl apply -f autoscale-hpa.yaml");
  expect(applied.text).toContain("configured");
  expect(h(applied)).toMatchObject({
    maxReplicas: 6,
    targetCpu: 50,
    lastEvaluation: Option.none,
    createdAt: h(initial).createdAt,
  });
  expect(d(applied)).toEqual(d(initial));
  expect(execute(applied, "kubectl get hpa").text).toContain("<unknown>/50%");
  const scaled = execute(restore(applied), "sim kubernetes reconcile autoscale-web --cpu=250m");
  expect(d(scaled).replicas).toBe(6);
  expect(d(scaled).revisions).toEqual(d(initial).revisions);
  expect(KubePod.fromDeployment(d(scaled)).slice(0, 3)).toEqual(KubePod.fromDeployment(d(initial)));
  expect(Option.unwrap(h(scaled).lastEvaluation)).toMatchObject({
    currentReplicas: 3,
    desiredReplicas: 6,
    reason: "Scaled",
  });
  expect(restore(scaled).world).toEqual(scaled.world);
});
test("lowering limits clears an out-of-range previous result without scaling until reconcile", () => {
  const s = execute(
    updated(evaluated()),
    "kubectl apply -f autoscale-hpa.yaml",
    "sim kubernetes reconcile autoscale-web --cpu=250m",
  );
  const lower = execute(write(s, patched("spec.maxReplicas", 2)), "kubectl apply -f hpa.json");
  expect(d(lower).replicas).toBe(6);
  expect(h(lower).lastEvaluation).toEqual(Option.none);
  expect(restore(lower).world).toEqual(lower.world);
  expect(d(execute(lower, "sim kubernetes reconcile autoscale-web --cpu=250m")).replicas).toBe(2);
});
test("minReplicas omission resets it to 1; explicit null is rejected", () => {
  const s = execute(
    write(evaluated(), patched("spec.minReplicas", 2)),
    "kubectl apply -f hpa.json",
  );
  expect(h(s).minReplicas).toBe(2);
  const reset = execute(
    write(s, patched("spec.minReplicas", undefined)),
    "kubectl apply -f hpa.json",
  );
  expect(h(reset).minReplicas).toBe(1);
  rejected(write(reset, patched("spec.minReplicas", null)), "kubectl apply -f hpa.json");
});
test("HPA can precede its Deployment; missing target is visible and target changes clear previous evaluation", () => {
  const s = execute(
    ready(),
    "kubectl apply -f autoscale-hpa.yaml",
    "sim kubernetes reconcile autoscale-web --cpu=250m",
  );
  expect(Option.unwrap(h(s).lastEvaluation).reason).toBe("TargetNotFound");
  const repaired = execute(
    s,
    "kubectl apply -f autoscale-web.yaml",
    "sim kubernetes reconcile autoscale-web --cpu=1",
  );
  expect(d(repaired).replicas).toBe(3);
  const retargeted = execute(
    write(repaired, patched("spec.scaleTargetRef.name", "other")),
    "kubectl apply -f hpa.json",
  );
  expect(h(retargeted).target).toBe("other");
  expect(h(retargeted).lastEvaluation).toEqual(Option.none);
  expect(d(retargeted)).toEqual(d(repaired));
  const recovered = execute(
    retargeted,
    "kubectl create deployment other --image=nginx:1",
    "kubectl set resources deployment/other --requests=cpu=250m",
    "sim kubernetes reconcile autoscale-web --cpu=1",
  );
  expect(recovered.world.kubeDeployments.find((d) => d.name === "other")?.replicas).toBe(3);
  expect(restore(recovered).world).toEqual(recovered.world);
});
test("delete by file uses the HPA name, leaves its Deployment, and can delete after target removal", () => {
  const s = evaluated();
  const removed = execute(
    write(s, patched("spec.scaleTargetRef.name", "other")),
    "kubectl delete -f hpa.json",
  );
  expect(removed.world.kubeHpas).toEqual([]);
  expect(d(removed)).toEqual(d(s));
  rejected(removed, "kubectl delete -f hpa.json", "not found");
  const missing = execute(
    s,
    "kubectl delete deployment/autoscale-web",
    "kubectl delete -f autoscale-hpa.yaml",
  );
  expect(missing.world.kubeHpas).toEqual([]);
});

test.each([
  ["apiVersion", "autoscaling/v1"],
  ["metadata.namespace", "INVALID"],
  ["metadata.name", "BAD"],
  ["metadata.labels", { app: "web" }],
  ["spec", null],
  ["spec.scaleTargetRef.apiVersion", "v1"],
  ["spec.scaleTargetRef.kind", "StatefulSet"],
  ["spec.scaleTargetRef.name", ""],
  ["spec.scaleTargetRef.namespace", "other"],
  ["spec.minReplicas", 0],
  ["spec.minReplicas", 4],
  ["spec.maxReplicas", undefined],
  ["spec.maxReplicas", "3"],
  ["spec.maxReplicas", 1001],
  ["spec.maxReplicas", 1.5],
  ["spec.metrics", undefined],
  ["spec.metrics", []],
  ["spec.metrics", [{}, {}]],
  ["spec.metrics", null],
  ["spec.metrics.0.type", "External"],
  ["spec.metrics.0.resource.name", "memory"],
  ["spec.metrics.0.resource.target.type", "AverageValue"],
  ["spec.metrics.0.resource.target.averageUtilization", "80"],
  ["spec.metrics.0.resource.target.averageUtilization", 0],
  ["spec.metrics.0.resource.target.averageUtilization", 1001],
  ["spec.metrics.0.resource.target.averageValue", "250m"],
  ["spec.behavior", {}],
  ["status", {}],
])("unsupported or malformed HPA field fails atomically: %s (%j)", (path, value) => {
  rejected(write(evaluated(), patched(path, value)), "kubectl apply -f hpa.json");
});

test("two HPAs cannot target one Deployment, including retargeting and duplicate file resources", () => {
  const s = evaluated();
  rejected(
    write(s, patched("metadata.name", "duplicate-target")),
    "kubectl apply -f hpa.json",
    "Only one HPA",
  );
  const second = manifest();
  second.metadata.name = "other";
  second.spec.scaleTargetRef.name = "other";
  const both = execute(write(s, second), "kubectl apply -f hpa.json");
  second.spec.scaleTargetRef.name = "autoscale-web";
  rejected(write(both, second), "kubectl apply -f hpa.json", "Only one HPA");
  const duplicate = `${JSON.stringify(manifest())}\n---\n${JSON.stringify(manifest())}`;
  rejected(source(s, duplicate, "batch.yaml"), "kubectl apply -f batch.yaml", "Duplicate resource");
});
const config = JSON.stringify({
  apiVersion: "v1",
  kind: "ConfigMap",
  metadata: { name: "batch" },
  data: { MODE: "demo" },
});
test("mixed documents roll back all earlier resource changes on HPA conflict, invalid spec, or deletion failure", () => {
  const s = evaluated();
  const duplicate = JSON.stringify(patched("metadata.name", "other"));
  rejected(
    source(s, `${config}\n---\n${duplicate}`, "batch.yaml"),
    "kubectl apply -f batch.yaml",
    "Only one HPA",
  );
  rejected(
    source(s, `${config}\n---\n${JSON.stringify(patched("spec.maxReplicas", 0))}`, "batch.yaml"),
    "kubectl apply -f batch.yaml",
  );
  rejected(
    source(s, `${JSON.stringify(manifest())}\n---\n${config}`, "batch.yaml"),
    "kubectl delete -f batch.yaml",
    "not found",
  );
});
test("a mixed file creates and deletes HPA and Deployment in either order without evaluating", () => {
  const file = KubeManifestExamples["kubernetes-hpa"];
  if (!file) throw new Error("Missing example");
  const s = source(
    ready(),
    `${file["autoscale-hpa.yaml"]}\n---\n${file["autoscale-web.yaml"]}`,
    "batch.yaml",
  );
  const created = execute(s, "kubectl create -f batch.yaml");
  expect(d(created).replicas).toBe(1);
  expect(h(created).lastEvaluation).toEqual(Option.none);
  const deleted = execute(created, "kubectl delete -f batch.yaml");
  expect(deleted.world.kubeHpas).toEqual([]);
  expect(deleted.world.kubeDeployments).toEqual([]);
});
const asRole = (s: Session, permissions: string) =>
  execute(
    s,
    `gcloud iam roles create hpaOnly --permissions=${permissions}`,
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:developer@example.com --role=projects/ace-dev-01/roles/hpaOnly",
    "gcloud auth login developer@example.com",
  );
test("HPA-only permissions manage manifests without Deployment access; apply needs get and update even unchanged", () => {
  const s = asRole(
    ready(),
    "container.horizontalPodAutoscalers.create,container.horizontalPodAutoscalers.get,container.horizontalPodAutoscalers.update,container.horizontalPodAutoscalers.delete",
  );
  const created = execute(s, "kubectl apply -f autoscale-hpa.yaml");
  execute(created, "kubectl apply -f autoscale-hpa.yaml", "kubectl delete -f autoscale-hpa.yaml");
  rejected(s, "kubectl apply -f autoscale-web.yaml", "container.deployments.get");
  const creator = asRole(ready(), "container.horizontalPodAutoscalers.create");
  execute(creator, "kubectl create -f autoscale-hpa.yaml");
  rejected(
    creator,
    "kubectl apply -f autoscale-hpa.yaml",
    "container.horizontalPodAutoscalers.get",
  );
  const reader = asRole(configured(), "container.horizontalPodAutoscalers.get");
  rejected(
    reader,
    "kubectl apply -f autoscale-hpa.yaml",
    "container.horizontalPodAutoscalers.update",
  );
  rejected(
    reader,
    "kubectl delete -f autoscale-hpa.yaml",
    "container.horizontalPodAutoscalers.delete",
  );
});
test("mixed-file permission failure leaves earlier HPA creation uncommitted", () => {
  const s = source(ready(), `${JSON.stringify(manifest())}\n---\n${config}`, "batch.yaml");
  const user = asRole(
    s,
    "container.horizontalPodAutoscalers.get,container.horizontalPodAutoscalers.create",
  );
  rejected(user, "kubectl apply -f batch.yaml", "container.configMaps.get");
});
test("API and cluster boundaries are enforced; same named HPA in another cluster is independent", () => {
  const disabled = execute(session(), "sim files load kubernetes-hpa");
  rejected(disabled, "kubectl apply -f autoscale-hpa.yaml", "container.googleapis.com");
  const s = evaluated();
  rejected(s, "kubectl apply -f autoscale-hpa.yaml -n other", 'namespaces "other" not found');
  const other = execute(
    s,
    "gcloud container clusters create-auto other --region=us-central1",
    "kubectl apply -f autoscale-hpa.yaml",
  );
  expect(other.world.kubeHpas).toHaveLength(2);
  expect(other.world.kubeHpas[0]).toEqual(h(s));
  const removed = execute(other, "kubectl delete -f autoscale-hpa.yaml");
  expect(removed.world.kubeHpas).toEqual(s.world.kubeHpas);
  expect(restore(other).world).toEqual(other.world);
});
test("HPA manifest mission requires edited file, applied settings and 3 -> 6 evaluation, and survives save", () => {
  const id = "m-gke-010";
  const s = execute(
    ready(session(Result.unwrap(Engine.startMission(session().world, id)))),
    "kubectl apply -f autoscale-web.yaml",
    "kubectl apply -f autoscale-hpa.yaml",
    "sim kubernetes reconcile autoscale-web --cpu=1",
  );
  const status = (s: Session) => s.world.missions.find((m) => m.id === id)?.status;
  expect(status(s)).toBe("in_progress");
  const file = updated(s);
  expect(status(file)).toBe("in_progress");
  const applied = execute(file, "kubectl apply -f autoscale-hpa.yaml");
  expect(status(applied)).toBe("in_progress");
  expect(status(execute(applied, "kubectl scale deployment/autoscale-web --replicas=6"))).toBe(
    "in_progress",
  );
  expect(status(execute(applied, "sim kubernetes reconcile autoscale-web --cpu=125m"))).toBe(
    "in_progress",
  );
  const outOfSync = execute(
    applied,
    "sim files replace autoscale-hpa.yaml --search='maxReplicas: 6' --replacement='maxReplicas: 5'",
    "sim kubernetes reconcile autoscale-web --cpu=250m",
  );
  expect(status(outOfSync)).toBe("in_progress");
  const done = execute(
    restore(applied),
    "sim kubernetes reconcile autoscale-web --cpu=250m",
    "kubectl apply -f autoscale-web.yaml",
    "kubectl apply -f autoscale-hpa.yaml",
  );
  expect(status(done)).toBe("completed");
  expect(d(done).replicas).toBe(6);
});
test("help, sample completion and files expose the new supported kind", () => {
  const s = ready();
  expect(execute(s, "kubectl apply --help").text).toContain("HPA");
  expect(Engine.completionCandidates(s.world, "sim files load kubernetes-h")).toContain(
    "kubernetes-hpa",
  );
  expect(Engine.completionCandidates(s.world, "sim files read autoscale-h")).toContain(
    "autoscale-hpa.yaml",
  );
  expect(Result.isOk(KubeManifest.parse(s.world.kubeFiles["autoscale-hpa.yaml"] ?? ""))).toBe(true);
});
