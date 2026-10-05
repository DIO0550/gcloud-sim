// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { Now, run, type Session, session } from "@/engine/__tests__/setup";
import { KubeManifest } from "@/engine/domains/kube-manifest";
import { World } from "@/engine/domains/world";
import { kubeIngressSatisfied } from "@/engine/missions/kube-ingress";
import { TreeSelection } from "@/engine/resource-tree";
import { Snapshot } from "@/engine/snapshot";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const execute = (s: Session, ...commands: string[]) =>
  commands.reduce((s, c) => {
    const next = run(s, c);
    expect(next.text, c).not.toMatch(/^(ERROR:|error:|Error from server)/m);
    expect(World.validate(next.world), c).toEqual(Result.ok(next.world));
    return next;
  }, s);
const rejected = (s: Session, c: string, message: string) => {
  const next = run(s, c);
  expect(next.text, c).toContain(message);
  expect(next.world).toEqual(s.world);
};
const ready = (recovery = false, s = session()) =>
  execute(
    s,
    "gcloud services enable container.googleapis.com",
    `gcloud container clusters create-auto ${recovery ? "ingress-fix-gke" : "ingress-gke"} --region=us-central1`,
    "sim files load kubernetes-ingress",
    `kubectl apply -f ${recovery ? "ingress-recovery.yaml" : "ingress-workloads.yaml"}`,
    `kubectl apply -f ${recovery ? "ingress-broken.json" : "ingress-routes.json"}`,
  );
const fixed = (s = ready()) =>
  execute(
    s,
    "sim files replace ingress-routes.json --search=wrong-api --replacement=api",
    "kubectl apply -f ingress-routes.json",
  );
const request = (path: string, name = "app-entry", host = "app.example.test") =>
  `sim kubernetes request ${name} --host=${host} --path=${path}`;
const first = (s: Session) => {
  const i = s.world.kubeIngresses[0];
  if (!i) throw new Error("Missing Ingress fixture");
  return i;
};
const write = (s: Session, resource: unknown) =>
  execute(s, `sim files write custom.json --content='${JSON.stringify(resource)}'`);
const spec = (s: Session) => JSON.parse(s.world.kubeFiles["ingress-routes.json"] ?? "");
const restored = (s: Session) =>
  session(
    Result.unwrap(Snapshot.fromUnknown(JSON.parse(JSON.stringify(Snapshot.create(s.world, Now))))),
  );

test.each([
  ["/", "web"],
  ["/api", "api"],
  ["/api/", "api"],
  ["/api/users", "api"],
  ["/api/health", "health"],
  ["/api/health/detail", "api"],
  ["/apix", "web"],
  ["/API", "web"],
])("host/path %s selects %s and does not mutate resources", (path, name) => {
  const s = fixed();
  const next = execute(s, request(path));
  expect(next.text).toContain(`Service: default/${name}:80`);
  expect(next.text).toContain(":8080");
  expect(next.text).toContain("No real LB");
  expect(next.world).toEqual(s.world);
});
test("other hosts fail, hostname case is ignored and Exact wins equal-length Prefix", () => {
  let s = fixed();
  rejected(s, request("/", "app-entry", "other.example.test"), "NO_ROUTE");
  execute(s, request("/", "app-entry", "APP.EXAMPLE.TEST"));
  const r = spec(s);
  r.spec.rules[0].http.paths.push({
    path: "/api/health",
    pathType: "Prefix",
    backend: { service: { name: "web", port: { number: 80 } } },
  });
  s = execute(write(s, r), "kubectl apply -f custom.json");
  expect(execute(s, request("/api/health")).text).toContain("default/health:80");
  expect(execute(s, request("/api/health/child")).text).toContain("default/web:80");
});
test("catch-all host, default-only Ingress and unmatched fallback resolve the selected backend", () => {
  let s = fixed();
  const r = spec(s);
  delete r.spec.rules[0].host;
  r.spec.defaultBackend = { service: { name: "health", port: { number: 80 } } };
  r.spec.rules[0].http.paths = r.spec.rules[0].http.paths.slice(1);
  s = execute(write(s, r), "kubectl apply -f custom.json");
  expect(execute(s, request("/api", "app-entry", "other.example.test")).text).toContain(
    "default/api:80",
  );
  expect(execute(s, request("/fallback")).text).toContain("Rule: defaultBackend");
  delete r.spec.rules;
  s = execute(write(s, r), "kubectl apply -f custom.json");
  expect(execute(s, request("/api")).text).toContain("default/health:80");
});
test("missing backend, Service port, selector and readiness are separate recovery steps", () => {
  rejected(ready(), request("/api"), "Service wrong-api not found");
  let s = ready(true);
  rejected(s, request("/", "recovery-entry"), "exposes port 80, not 8080");
  s = execute(
    s,
    "sim files replace ingress-broken.json --search=8080 --replacement=80",
    "kubectl apply -f ingress-broken.json",
  );
  rejected(s, request("/", "recovery-entry"), "no Ready backends");
  s = execute(
    s,
    "sim files replace ingress-recovery.yaml --search=wrong-recovery --replacement=recovery",
    "kubectl apply -f ingress-recovery.yaml",
  );
  rejected(s, request("/", "recovery-entry"), "no Ready backends");
  s = execute(s, "sim kubernetes probe recovery --status-code=200");
  expect(execute(s, request("/", "recovery-entry")).text).toContain("ROUTED");
  s = execute(s, "sim kubernetes probe recovery --status-code=503");
  rejected(s, request("/", "recovery-entry"), "no Ready backends");
});
test.each(["ClusterIP", "LoadBalancer"])(
  "non-NodePort backend %s is diagnosed without rejecting the Ingress resource",
  (type) => {
    const s = fixed();
    const r = {
      apiVersion: "v1",
      kind: "Service",
      metadata: { name: "api" },
      spec: { type, selector: { app: "api" }, ports: [{ port: 80, targetPort: 8080 }] },
    };
    const next = execute(write(s, r), "kubectl delete svc api", "kubectl apply -f custom.json");
    rejected(next, request("/api"), "must be NodePort");
    execute(next, request("/"));
  },
);
test("zero replicas, missing image, deleted Service and recreation update derived diagnostics immediately", () => {
  const s = fixed();
  const zero = execute(s, "kubectl scale deployment/api --replicas=0");
  rejected(zero, request("/api"), "no Ready backends");
  const image = execute(
    s,
    "kubectl set image deployment/api api=us-central1-docker.pkg.dev/ace-dev-01/missing/app:v1",
  );
  rejected(image, request("/api"), "no Ready backends");
  const removed = execute(s, "kubectl delete svc api");
  rejected(removed, request("/api"), "not found");
  execute(execute(removed, "kubectl apply -f ingress-workloads.yaml"), request("/api"));
});
test("create/apply/delete aliases, label filters and JSON/YAML outputs preserve creation identity", () => {
  const s = fixed();
  expect(execute(s, "kubectl apply -f ingress-routes.json").text).toContain("unchanged");
  rejected(s, "kubectl create -f ingress-routes.json", "already exists");
  for (const alias of ["ingress", "ingresses", "ing", "ingresses.networking.k8s.io"]) {
    expect(execute(s, `kubectl get ${alias}/app-entry`).text).toContain("app-entry");
    const r = JSON.parse(execute(s, `kubectl get ${alias} app-entry -o json`).text);
    expect(r.spec.rules[0].http.paths[1].backend.service.port.number).toBe(80);
    expect(r.status.loadBalancer).toEqual({});
  }
  expect(execute(s, "kubectl get ing -l lesson=ingress -o yaml").text).toContain("kind: Ingress");
  expect(execute(s, "kubectl get ing -l lesson=missing -o json").text).toContain('"items": []');
  expect(execute(s, "kubectl describe ing app-entry").text).toContain("no real LB");
  expect(first(restored(s)).createdAt).toBe(first(s).createdAt);
  const removed = execute(s, "kubectl delete ing/app-entry");
  expect(removed.world.kubeIngresses).toEqual([]);
  rejected(removed, "kubectl delete ing app-entry", "not found");
});
test("namespace and cluster scope, explicit manifest mismatch, -A and cascading deletion", () => {
  let s = fixed();
  s = execute(s, "kubectl create namespace staging");
  const r = spec(s);
  r.metadata.namespace = "staging";
  const written = write(s, r);
  rejected(written, "kubectl apply -f custom.json -n default", "does not match");
  s = execute(written, "kubectl apply -f custom.json");
  rejected(s, `${request("/")} -n staging`, "Service web not found");
  expect(JSON.parse(execute(s, "kubectl get ing -A -o json").text).items).toHaveLength(2);
  expect(first(execute(s, "kubectl delete namespace staging"))).toEqual(first(s));
  const removed = execute(s, "kubectl delete ing app-entry -n staging");
  expect(removed.world.kubeIngresses).toHaveLength(1);
  s = execute(s, "gcloud container clusters create-auto other-gke --region=us-central1");
  rejected(s, request("/"), "not found");
  s = execute(s, "gcloud container clusters delete ingress-gke --region=us-central1 --quiet");
  expect(s.world.kubeIngresses).toEqual([]);
});
test("viewer reads and requests, developer manages Ingress and API enablement is required", () => {
  let s = execute(
    fixed(),
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:viewer@example.com --role=roles/container.viewer",
    "gcloud auth login viewer@example.com",
  );
  execute(s, "kubectl get ing", request("/"));
  rejected(s, "kubectl apply -f ingress-routes.json", "container.ingresses.update");
  rejected(s, "kubectl delete ing app-entry", "container.ingresses.delete");
  s = execute(
    s,
    "gcloud auth login owner@example.com",
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:viewer@example.com --role=roles/container.developer",
    "gcloud auth login viewer@example.com",
  );
  execute(s, "kubectl apply -f ingress-routes.json", "kubectl delete ing app-entry");
  const off = {
    ...fixed().world,
    projects: fixed().world.projects.map((p) => ({
      ...p,
      enabledApis: p.enabledApis.filter((a) => a !== "container.googleapis.com"),
    })),
  };
  rejected(session(off), request("/"), "container.googleapis.com");
});
test("a later resource validation or permission failure rolls back the whole multi-document file", () => {
  const s = fixed();
  const r = spec(s);
  r.metadata.name = "atomic";
  const invalid = execute(
    s,
    `sim files write atomic.yaml --content='${JSON.stringify(r)}\n---\n${JSON.stringify({ apiVersion: "v1", kind: "Secret", metadata: { name: "bad" }, data: { key: "invalid" } })}'`,
  );
  rejected(invalid, "kubectl apply -f atomic.yaml", "base64");
  const missing = execute(
    s,
    `sim files write atomic.yaml --content='${JSON.stringify(r)}\n---\n${JSON.stringify({ ...r, metadata: { name: "missing", namespace: "not-created" } })}'`,
  );
  rejected(missing, "kubectl apply -f atomic.yaml", "not found");
  const permitted = execute(
    s,
    `sim files write atomic.yaml --content='${JSON.stringify(r)}\n---\n${JSON.stringify({ apiVersion: "v1", kind: "Secret", metadata: { name: "new-secret" }, stringData: { key: "value" } })}'`,
    "gcloud iam roles create ingressWriter --permissions=container.ingresses.get,container.ingresses.create,container.ingresses.update",
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:writer@example.com --role=roles/container.viewer",
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:writer@example.com --role=projects/ace-dev-01/roles/ingressWriter",
    "gcloud auth login writer@example.com",
  );
  rejected(permitted, "kubectl apply -f atomic.yaml", "container.secrets.get");
});

test("Ingress completion follows the current cluster and get all excludes Ingress", () => {
  const s = fixed();
  expect(Engine.completionCandidates(s.world, "kubectl get ing a")).toContain("app-entry");
  expect(Engine.completionCandidates(s.world, "sim kubernetes request a")).toContain("app-entry");
  const all = JSON.parse(execute(s, "kubectl get all -o json").text);
  expect(all.items.some((i: { kind: string }) => i.kind === "Ingress")).toBe(false);
  const other = execute(s, "gcloud container clusters create-auto other-gke --region=us-central1");
  expect(Engine.completionCandidates(other.world, "kubectl get ing a")).not.toContain("app-entry");
});
test.each([
  { tls: [] },
  { ingressClassName: "gce" },
  { rules: [] },
  { rules: [{ host: "*.example.test", http: { paths: [] } }] },
  { defaultBackend: { service: { name: "web", port: { name: "http" } } } },
  { defaultBackend: { service: { name: "web", port: { number: 0 } } } },
  { defaultBackend: { resource: { kind: "StorageBucket", name: "x" } } },
  {
    rules: [
      {
        http: {
          paths: [
            {
              path: "/*",
              pathType: "ImplementationSpecific",
              backend: { service: { name: "web", port: { number: 80 } } },
            },
          ],
        },
      },
    ],
  },
])("unsupported or malformed spec %# is rejected atomically", (value) => {
  const s = ready();
  const r = spec(s);
  r.spec = value;
  rejected(write(s, r), "kubectl apply -f custom.json", "error:");
});
test("wrong API, annotations, duplicate normalized paths, >32 paths and missing pathType fail parsing", () => {
  const r = spec(ready());
  for (const bad of [
    { ...r, apiVersion: "extensions/v1beta1" },
    { ...r, metadata: { name: "x", annotations: { "kubernetes.io/ingress.class": "nginx" } } },
    { ...r, metadata: { name: "x", annotations: { unknown: "ignored" } } },
  ])
    expect(Result.isOk(KubeManifest.parse(JSON.stringify(bad)))).toBe(false);
  const paths = r.spec.rules[0].http.paths;
  paths.push({ ...paths[0], path: "/" });
  expect(Result.isOk(KubeManifest.parse(JSON.stringify(r)))).toBe(false);
  r.spec.rules[0].http.paths = Array.from({ length: 33 }, (_, i) => ({
    ...paths[0],
    path: `/${i}`,
  }));
  expect(Result.isOk(KubeManifest.parse(JSON.stringify(r)))).toBe(false);
  r.spec.rules[0].http.paths = [{ ...paths[0], pathType: undefined }];
  expect(Result.isOk(KubeManifest.parse(JSON.stringify(r)))).toBe(false);
});
test.each([
  "",
  "--host=app.example.test --path=relative",
  "--host=https://example.test",
  "--host=app.example.test --path=/api?query=1",
  "--host=app.example.test --path=/*",
])("invalid request flags %s preserve the world", (flags) =>
  rejected(fixed(), `sim kubernetes request app-entry ${flags}`, "ERROR:"),
);
test("snapshot v26 roundtrip and v25 migration preserve policy enforcement, probes, files and services", () => {
  let s = execute(
    fixed(),
    "sim files load kubernetes-network-policy",
    "kubectl apply -f deny-ingress.json",
  );
  expect(restored(s).world).toEqual(s.world);
  const raw = JSON.parse(JSON.stringify(Snapshot.create(s.world, Now)));
  raw.schemaVersion = 25;
  delete raw.world.kubeIngresses;
  const migrated = Result.unwrap(Snapshot.fromUnknown(raw));
  expect(migrated.kubeIngresses).toEqual([]);
  expect(migrated.kubeNetworkPolicies).toEqual(s.world.kubeNetworkPolicies);
  expect(migrated.clusters).toEqual(s.world.clusters);
  expect(migrated.kubeServices).toEqual(s.world.kubeServices);
  expect(migrated.kubeFiles).toEqual(s.world.kubeFiles);
  s = restored(s);
  const corrupt = JSON.parse(JSON.stringify(Snapshot.create(s.world, Now)));
  corrupt.world.kubeIngresses[0].paths[0].backend.port = 0;
  expect(Result.isOk(Snapshot.fromUnknown(corrupt))).toBe(false);
  corrupt.world.kubeIngresses[0].paths[0].backend.port = 80;
  corrupt.world.kubeIngresses[0].namespace = "missing";
  expect(Result.isOk(Snapshot.fromUnknown(corrupt))).toBe(false);
});
test("tree selection has namespace identity and produces a scoped describe command", () => {
  const selection = {
    kind: "kube-ingress",
    projectId: "ace-dev-01",
    cluster: "ingress-gke",
    namespace: "staging",
    name: "app-entry",
  } as const;
  expect(TreeSelection.key(selection)).toContain("staging/app-entry");
  expect(TreeSelection.describeCommand(selection)).toEqual(
    Option.some("kubectl describe ing app-entry --namespace=staging"),
  );
});
test("routing mission requires applied file and all expected routes, with no fallback or global host", () => {
  const started = session(Result.unwrap(Engine.startMission(session().world, "m-gke-026")));
  const s = ready(false, started);
  expect(kubeIngressSatisfied(s.world, false)).toBe(false);
  const edited = execute(
    s,
    "sim files replace ingress-routes.json --search=wrong-api --replacement=api",
  );
  expect(kubeIngressSatisfied(edited.world, false)).toBe(false);
  const done = execute(edited, "kubectl apply -f ingress-routes.json");
  expect(kubeIngressSatisfied(done.world, false)).toBe(true);
  expect(done.world.missions.find((m) => m.id === "m-gke-026")?.status).toBe("completed");
  expect(
    kubeIngressSatisfied(
      {
        ...done.world,
        kubeIngresses: done.world.kubeIngresses.map((i) => ({
          ...i,
          defaultBackend: Option.some({ name: "web", port: 80 }),
        })),
      },
      false,
    ),
  ).toBe(false);
  expect(kubeIngressSatisfied(execute(done, "kubectl delete svc api").world, false)).toBe(false);
});
test("recovery mission requires live port, selector and two Ready backends; edits alone never clear", () => {
  let s = ready(true, session(Result.unwrap(Engine.startMission(session().world, "m-gke-027"))));
  expect(kubeIngressSatisfied(s.world, true)).toBe(false);
  s = execute(
    s,
    "sim files replace ingress-broken.json --search=8080 --replacement=80",
    "kubectl apply -f ingress-broken.json",
    "sim files replace ingress-recovery.yaml --search=wrong-recovery --replacement=recovery",
    "kubectl apply -f ingress-recovery.yaml",
  );
  expect(kubeIngressSatisfied(s.world, true)).toBe(false);
  s = execute(restored(s), "sim kubernetes probe recovery --status-code=200");
  expect(kubeIngressSatisfied(s.world, true)).toBe(true);
  expect(s.world.missions.find((m) => m.id === "m-gke-027")?.status).toBe("completed");
  expect(
    kubeIngressSatisfied(execute(s, "sim kubernetes probe recovery --status-code=503").world, true),
  ).toBe(false);
  expect(
    kubeIngressSatisfied(execute(s, "kubectl scale deployment/recovery --replicas=1").world, true),
  ).toBe(false);
});
