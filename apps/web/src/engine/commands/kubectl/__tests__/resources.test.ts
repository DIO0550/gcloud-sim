// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { Now, run, type Session, session } from "@/engine/__tests__/setup";
import { KubeManifest } from "@/engine/domains/kube-manifest";
import { KubeResources } from "@/engine/domains/kube-resources";
import { KubePod } from "@/engine/domains/kubernetes";
import { Snapshot } from "@/engine/snapshot";
import { Result } from "@/utils/Result";

const execute = (s: Session, ...commands: string[]) =>
  commands.reduce((s, c) => {
    const next = run(s, c);
    expect(next.text, c).not.toMatch(/^(ERROR:|error:|Error from server)/m);
    return next;
  }, s);
const ready = (s = session()) =>
  execute(
    s,
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create-auto resources-gke --region=us-central1",
    "kubectl create deployment web --image=nginx:1 --replicas=2",
  );
const d = (s: Session) => {
  const value = s.world.kubeDeployments.find((d) => d.name === "web");
  if (!value) throw new Error("Missing fixture Deployment");
  return value;
};
const configured = () =>
  execute(
    ready(),
    "kubectl set resources deployment/web --requests=cpu=250m,memory=128Mi --limits=cpu=500m,memory=256Mi",
  );
const pods = (s: Session) => KubePod.fromDeployment(d(s)).map((p) => p.name);
const snap = (s: Session) => JSON.parse(JSON.stringify(Snapshot.create(s.world, Now)));
const restored = (s: Session) => session(Result.unwrap(Snapshot.fromUnknown(snap(s))));
const rejected = (s: Session, command: string, message = "error:") => {
  const next = run(s, command);
  expect(next.text).toContain(message);
  expect(next.world).toEqual(s.world);
};
const manifest = (resources: unknown) => ({
  apiVersion: "apps/v1",
  kind: "Deployment",
  metadata: { name: "web" },
  spec: {
    replicas: 2,
    selector: { matchLabels: { app: "web" } },
    template: {
      metadata: { labels: { app: "web" } },
      spec: { containers: [{ name: "web", image: "nginx:1", resources }] },
    },
  },
});
const write = (s: Session, value: unknown) =>
  execute(s, `sim files write resource.json --content='${JSON.stringify(value)}'`);
const apply = (s: Session, resources: unknown) =>
  execute(write(s, manifest(resources)), "kubectl apply -f resource.json");
const json = (s: Session, command: string) => JSON.parse(execute(s, command).text);

test("set resources creates one revision, shows all template views, preserves other fields and is quantity-idempotent", () => {
  const s = execute(ready(), "kubectl set env deployment/web MODE=demo");
  const next = execute(
    s,
    "kubectl set resources deployment web -c=web --requests=cpu=0.25,memory=134217728 --limits=cpu=0.500,memory=256Mi",
  );
  expect(d(next)).toMatchObject({
    resources: {
      requests: { cpu: "250m", memory: "128Mi" },
      limits: { cpu: "500m", memory: "256Mi" },
    },
    revision: 3,
    generation: 3,
    env: d(s).env,
    selector: d(s).selector,
    podLabels: d(s).podLabels,
    replicas: 2,
  });
  expect(pods(next)).not.toEqual(pods(s));
  expect(d(next).revisions.at(-1)?.reason).toBe("resources");
  const resource = d(next).resources;
  expect(
    json(next, "kubectl get deployment web -o json").spec.template.spec.containers[0].resources,
  ).toEqual(resource);
  expect(
    json(next, "kubectl get pods -o json").items.every(
      (p: { spec: { containers: { resources: unknown }[] } }) =>
        JSON.stringify(p.spec.containers[0]?.resources) === JSON.stringify(resource),
    ),
  ).toBe(true);
  expect(
    json(next, "kubectl get rs -o json").items.at(-1).spec.template.spec.containers[0].resources,
  ).toEqual(resource);
  expect(execute(next, "kubectl rollout history deployment/web --revision=3").text).toContain(
    'cpu: "250m"',
  );
  expect(execute(next, "kubectl describe deployment web").text).toContain('memory: "128Mi"');
  expect(execute(next, "kubectl exec deployment/web -- printenv MODE").text).toContain("demo");
  const repeat = execute(
    next,
    "kubectl set resources deployment/web --requests=memory=128Mi,cpu=250m --limits=memory=268435456,cpu=500m",
  );
  expect(repeat.text).toContain("unchanged");
  expect(repeat.world).toEqual(next.world);
  expect(restored(next).world).toEqual(next.world);
});

test("partial CLI update keeps unspecified amounts, limit-only defaults and zero removes keys", () => {
  const s = execute(ready(), "kubectl set resources deployment/web --limits=cpu=1,memory=1Gi");
  expect(d(s).resources).toEqual({
    requests: { cpu: "1", memory: "1Gi" },
    limits: { cpu: "1", memory: "1Gi" },
  });
  const lower = execute(s, "kubectl set resources deployment/web --requests=cpu=250m");
  expect(d(lower).resources.requests).toEqual({ cpu: "250m", memory: "1Gi" });
  const withoutLimit = execute(lower, "kubectl set resources deployment/web --limits=cpu=0");
  expect(d(withoutLimit).resources).toEqual({
    requests: { cpu: "250m", memory: "1Gi" },
    limits: { memory: "1Gi" },
  });
  const cleared = execute(
    withoutLimit,
    "kubectl set resources deployment/web --requests=cpu=0,memory=0 --limits=memory=0",
  );
  expect(d(cleared).resources).toEqual(KubeResources.empty());
  expect(
    json(cleared, "kubectl get deployment web -o json").spec.template.spec.containers[0].resources,
  ).toBeUndefined();
});

test("undo restores resources and env with the template but retains scale", () => {
  const s = execute(configured(), "kubectl set env deployment/web MODE=demo");
  const revision = d(s).revision;
  const changed = execute(
    s,
    "kubectl set resources deployment/web --requests=cpu=300m",
    "kubectl set env deployment/web MODE=other",
    "kubectl scale deployment/web --replicas=3",
  );
  const undo = execute(
    restored(changed),
    `kubectl rollout undo deployment/web --to-revision=${revision}`,
  );
  expect(d(undo)).toMatchObject({
    resources: d(s).resources,
    env: d(s).env,
    replicas: 3,
    revision: d(changed).revision + 1,
  });
  expect(execute(undo, "kubectl exec deployment/web -- printenv MODE").text).toContain("demo");
  const restarted = execute(undo, "kubectl rollout restart deployment/web");
  expect(d(restarted).resources).toEqual(d(s).resources);
  const scaled = execute(restarted, "kubectl scale deployment/web --replicas=4");
  expect(pods(scaled).slice(0, 3)).toEqual(pods(restarted));
});

test("manifest resource/image/env/label/replica update is a single revision and omitted resources clear settings", () => {
  const s = configured();
  const m = manifest({
    requests: { cpu: 0.25, memory: "128Mi" },
    limits: { cpu: 1, memory: "512Mi" },
  });
  const edited = {
    ...m,
    spec: {
      ...m.spec,
      replicas: 3,
      template: {
        ...m.spec.template,
        metadata: { labels: { app: "web", release: "v2" } },
        spec: {
          containers: [
            {
              ...m.spec.template.spec.containers[0],
              image: "nginx:2",
              env: [{ name: "MODE", value: "prod" }],
            },
          ],
        },
      },
    },
  };
  const next = execute(write(s, edited), "kubectl apply -f resource.json");
  expect(d(next)).toMatchObject({
    revision: d(s).revision + 1,
    generation: d(s).generation + 1,
    image: "nginx:2",
    replicas: 3,
    podLabels: { app: "web", release: "v2" },
    resources: {
      requests: { cpu: "250m", memory: "128Mi" },
      limits: { cpu: "1", memory: "512Mi" },
    },
  });
  const repeat = execute(next, "kubectl apply -f resource.json");
  expect(repeat.world).toEqual(next.world);
  expect(d(apply(next, undefined)).resources).toEqual(KubeResources.empty());
});

test("requests may be specified without limits; manifest limit-only receives defaults", () => {
  const s = apply(ready(), { requests: { cpu: "100m" } });
  expect(d(s).resources).toEqual({ requests: { cpu: "100m" }, limits: {} });
  const next = apply(s, { limits: { memory: "64Mi" } });
  expect(d(next).resources).toEqual({ requests: { memory: "64Mi" }, limits: { memory: "64Mi" } });
});

test.each([
  { requests: { cpu: "501m" }, limits: { cpu: "0.5" } },
  { requests: { memory: "1Gi" }, limits: { memory: "1000M" } },
  { requests: { cpu: "0.0005" } },
  { requests: { cpu: "0.5m" } },
  { limits: { memory: "1.5Gi" } },
  { limits: { memory: "400m" } },
  { requests: { cpu: -1 } },
  { requests: { memory: -1 } },
  { requests: { cpu: true } },
  { limits: { memory: null } },
  { requests: { gpu: "1" } },
  { requests: { "ephemeral-storage": "1Gi" } },
  { claims: [] },
  { requests: [] },
  { requests: null },
  null,
  { requests: { cpu: "9007199254740992m" } },
  { limits: { memory: "999999999999999999Gi" } },
])("invalid resources never partially apply: %j", (resources) => {
  expect(Result.isOk(KubeManifest.parse(JSON.stringify(manifest(resources))))).toBe(false);
  rejected(write(ready(), manifest(resources)), "kubectl apply -f resource.json");
});

test.each([
  "--requests=cpu=600m",
  "--limits=memory=64Mi",
  "--requests=cpu=1,cpu=2",
  "--requests=cpu",
  "--limits=",
  "--requests=cpu=200m --requests=memory=64Mi",
  "--requests=cpu=100m -c=other",
  "--requests=cpu=100m --local",
  "--all --requests=cpu=100m",
  "",
])("invalid CLI settings preserve the World: %s", (flags) =>
  rejected(configured(), `kubectl set resources deployment/web ${flags}`),
);

test("validation is atomic across multi-resource manifests", () => {
  const s = execute(
    ready(),
    `sim files write batch.yaml --content='apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: new-config\ndata:\n  MODE: prod\n---\n${JSON.stringify(manifest({ requests: { cpu: "2" }, limits: { cpu: "1" } }))}'`,
  );
  rejected(s, "kubectl apply -f batch.yaml");
});

test("permission, API and namespace guards apply; completion and help expose the new command", () => {
  rejected(
    session(),
    "kubectl set resources deployment/web --requests=cpu=100m",
    "container.googleapis.com",
  );
  const s = ready();
  rejected(
    s,
    "kubectl set resources deployment/web --requests=cpu=100m --namespace=other",
    'namespaces "other" not found',
  );
  const viewer = execute(
    s,
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:viewer@example.com --role=roles/container.viewer",
    "gcloud auth login viewer@example.com",
  );
  rejected(
    viewer,
    "kubectl set resources deployment/web --requests=cpu=100m",
    "container.deployments.update",
  );
  execute(viewer, "kubectl get deployment web -o json");
  expect(Engine.completionCandidates(s.world, "kubectl set ")).toContain("resources");
  expect(execute(s, "kubectl set resources --help").text).toContain("--requests");
});

test("v12 migration preserves custom selectors, Pod networks, histories and configs while adding unspecified resources", () => {
  const s = execute(
    ready(),
    "sim files load kubernetes-labels",
    "kubectl apply -f shop-blue.yaml",
    "kubectl apply -f shop-green.yaml",
    "kubectl apply -f shop-service.yaml",
    "kubectl create configmap config --from-literal=MODE=demo",
    "kubectl set env deployment/web --from=configmap/config",
    "kubectl set image deployment/web web=nginx:2",
  );
  const old = snap(s);
  old.schemaVersion = 12;
  for (const d of old.world.kubeDeployments) {
    delete d.resources;
    for (const r of d.revisions) delete r.resources;
  }
  expect(Result.unwrap(Snapshot.fromUnknown(old))).toEqual(s.world);
});

test.each(["invalid", "missing", "history", "mismatch"])(
  "v13 snapshots reject invalid/missing/differing resource history: %s",
  (kind) => {
    const value = snap(configured());
    if (kind === "invalid") value.world.kubeDeployments[0].resources.requests.cpu = "2";
    if (kind === "missing") delete value.world.kubeDeployments[0].resources;
    if (kind === "history")
      value.world.kubeDeployments[0].revisions[0].resources.limits = { gpu: "1" };
    if (kind === "mismatch") value.world.kubeDeployments[0].resources.requests.cpu = "100m";
    expect(Result.isOk(Snapshot.fromUnknown(value))).toBe(false);
  },
);

test("resource mission stays incomplete for invalid file, edits only, wrong amounts and wrong replica count", () => {
  const id = "m-gke-008";
  const s = execute(
    session(Result.unwrap(Engine.startMission(session().world, id))),
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create-auto resources-gke --region=us-central1",
    "sim files load kubernetes-resources",
  );
  const status = (s: Session) => s.world.missions.find((m) => m.id === id)?.status;
  rejected(s, "kubectl apply -f resource-web.yaml", "request must not exceed");
  expect(status(s)).toBe("in_progress");
  const edited = execute(
    s,
    "sim files replace resource-web.yaml --search=500m --replacement=100m",
    "sim files replace resource-web.yaml --search=250m --replacement=500m",
  );
  const wrong = execute(edited, "kubectl apply -f resource-web.yaml");
  expect(status(wrong)).toBe("in_progress");
  const file = execute(
    wrong,
    "sim files replace resource-web.yaml --search=100m --replacement=250m",
  );
  expect(status(file)).toBe("in_progress");
  const wrongScale = execute(
    file,
    "kubectl scale deployment/resource-web --replicas=1",
    "kubectl set resources deployment/resource-web --requests=cpu=250m",
  );
  expect(status(wrongScale)).toBe("in_progress");
  const done = execute(restored(file), "kubectl apply -f resource-web.yaml");
  expect(status(done)).toBe("completed");
});
