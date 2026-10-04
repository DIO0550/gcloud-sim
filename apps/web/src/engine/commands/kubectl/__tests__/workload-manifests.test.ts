// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { Now, run, type Session, session } from "@/engine/__tests__/setup";
import { KubeManifest } from "@/engine/domains/kube-manifest";
import { KubeServiceRouting } from "@/engine/domains/kube-service-routing";
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
    "gcloud container clusters create-auto manifest-gke --region=us-central1",
    "sim files load kubernetes-workload",
  );
const rejected = (s: Session, command: string, error: string) => {
  const next = run(s, command);
  expect(next.text).toContain(error);
  expect(next.world).toEqual(s.world);
};
const write = (s: Session, value: unknown, filename = "workload.json") =>
  execute(s, `sim files write ${filename} --content='${JSON.stringify(value)}'`);
const deployment = (image = "nginx:1", replicas: number | undefined = 2, env: unknown[] = []) => ({
  apiVersion: "apps/v1",
  kind: "Deployment",
  metadata: { name: "web" },
  spec: {
    replicas,
    selector: { matchLabels: { app: "web" } },
    template: {
      metadata: { labels: { app: "web" } },
      spec: { containers: [{ name: "web", image, env }] },
    },
  },
});
const service = (target = "web", port = 80, targetPort = 8080) => ({
  apiVersion: "v1",
  kind: "Service",
  metadata: { name: "svc" },
  spec: { type: "LoadBalancer", selector: { app: target }, ports: [{ port, targetPort }] },
});
const restored = (s: Session) =>
  session(
    Result.unwrap(Snapshot.fromUnknown(JSON.parse(JSON.stringify(Snapshot.create(s.world, Now))))),
  );
const endpoints = (s: Session) => {
  const svc = s.world.kubeServices[0];
  if (!svc) throw new Error("missing service");
  return KubeServiceRouting.endpoints(s.world, svc);
};

test("YAML workload files create and idempotently apply; Service without matching Pods has no backends", () => {
  const s = ready();
  const applied = execute(
    s,
    "kubectl apply -f web-service.yaml",
    "kubectl apply -f web-deployment.yaml",
  );
  expect(applied.world.kubeDeployments[0]?.replicas).toBe(2);
  expect(endpoints(applied)).toEqual([]);
  expect(execute(applied, "kubectl describe svc manifest-svc").text).toContain("<none>");
  expect(
    execute(applied, "kubectl apply -f web-deployment.yaml", "kubectl apply -f web-service.yaml")
      .world,
  ).toEqual(applied.world);
  expect(restored(applied).world).toEqual(applied.world);
  expect(applied.world.terraform).toEqual(s.world.terraform);
  expect(Engine.completionCandidates(s.world, "sim files load kubernetes-w")).toContain(
    "kubernetes-workload",
  );
});

test("Service selector and ports update without replacing IP, creation time or Pods", () => {
  const s = execute(write(ready(), deployment()), "kubectl apply -f workload.json");
  const applied = execute(write(s, service("missing")), "kubectl apply -f workload.json");
  const edited = write(applied, service("web", 443, 8443));
  expect(endpoints(edited)).toEqual([]);
  const next = execute(edited, "kubectl apply -f workload.json");
  expect(endpoints(next)).toHaveLength(2);
  expect(endpoints(next).every((e) => e.endsWith(":8443"))).toBe(true);
  expect(next.world.kubeServices[0]).toMatchObject({
    clusterIp: applied.world.kubeServices[0]?.clusterIp,
    externalIp: applied.world.kubeServices[0]?.externalIp,
    createdAt: applied.world.kubeServices[0]?.createdAt,
    port: 443,
  });
  expect(next.world.kubeDeployments).toEqual(applied.world.kubeDeployments);
  expect(execute(next, "kubectl describe svc svc").text).toContain(endpoints(next)[0]);
  const record = JSON.parse(execute(next, "kubectl get svc svc -o json").text);
  expect(record.spec.selector).toEqual({ app: "web" });
  expect(record.spec.ports).toEqual([{ protocol: "TCP", port: 443, targetPort: 8443 }]);
});

test("image + env + replicas change is one template revision, then rollback restores template and preserves scale", () => {
  const first = execute(write(ready(), deployment()), "kubectl apply -f workload.json");
  const updated = execute(
    write(restored(first), deployment("nginx:2", 3, [{ name: "MODE", value: "new" }])),
    "kubectl apply -f workload.json",
  );
  expect(updated.world.kubeDeployments[0]).toMatchObject({
    revision: 2,
    generation: 2,
    replicas: 3,
  });
  expect(updated.world.kubeDeployments[0]?.revisions).toHaveLength(2);
  expect(execute(updated, "kubectl exec deployment/web -- printenv MODE").text).toBe("new");
  const again = execute(updated, "kubectl apply -f workload.json");
  expect(again.text).toContain("unchanged");
  expect(again.world).toEqual(updated.world);
  const undone = execute(restored(updated), "kubectl rollout undo deployment/web --to-revision=1");
  expect(undone.world.kubeDeployments[0]).toMatchObject({
    image: "nginx:1",
    env: [],
    replicas: 3,
    revision: 3,
  });
  expect(Result.isOk(Snapshot.fromUnknown(Snapshot.create(undone.world, Now)))).toBe(true);
});

test("scale-only apply keeps existing Pod identities and environments; absent replicas keeps live scale", () => {
  const first = execute(write(ready(), deployment()), "kubectl apply -f workload.json");
  const initial = first.world.kubeDeployments[0];
  if (!initial) throw new Error("missing deployment");
  const scaled = execute(write(first, deployment("nginx:1", 3)), "kubectl apply -f workload.json");
  const d = scaled.world.kubeDeployments[0];
  if (!d) throw new Error("missing deployment");
  expect(d.revision).toBe(initial.revision);
  expect(KubePod.fromDeployment(d).slice(0, 2)).toEqual(KubePod.fromDeployment(initial));
  const manifest = deployment();
  delete (manifest.spec as { replicas?: number }).replicas;
  expect(
    execute(write(scaled, manifest), "kubectl apply -f workload.json").world.kubeDeployments[0]
      ?.replicas,
  ).toBe(3);
  expect(
    execute(write(ready(), manifest), "kubectl apply -f workload.json").world.kubeDeployments[0]
      ?.replicas,
  ).toBe(1);
});

test("environment key refs block missing configs, then resolve without revealing values in template", () => {
  const refs = [{ name: "TOKEN", valueFrom: { secretKeyRef: { name: "creds", key: "TOKEN" } } }];
  const s = execute(
    write(ready(), deployment("nginx:1", 2, refs)),
    "kubectl apply -f workload.json",
  );
  const withService = execute(write(s, service()), "kubectl apply -f workload.json");
  expect(endpoints(withService)).toEqual([]);
  expect(execute(withService, "kubectl get pods").text).toContain("CreateContainerConfigError");
  const fixed = execute(
    withService,
    "kubectl create secret generic creds --from-literal=TOKEN=demo-value",
  );
  expect(endpoints(fixed)).toHaveLength(2);
  expect(execute(fixed, "kubectl exec deployment/web -- printenv TOKEN").text).toBe("demo-value");
  expect(execute(fixed, "kubectl get deployment web -o json").text).not.toContain("demo-value");
  expect(restored(fixed).world).toEqual(fixed.world);
});

test("unready image, scaled-to-zero and deleted Deployment yield no endpoints; Service remains", () => {
  const s = execute(write(ready(), deployment()), "kubectl apply -f workload.json");
  const withService = execute(write(s, service()), "kubectl apply -f workload.json");
  const waiting = execute(
    withService,
    "kubectl set image deployment/web web=us-central1-docker.pkg.dev/ace-dev-01/missing/web:v1",
  );
  expect(endpoints(waiting)).toEqual([]);
  expect(endpoints(execute(withService, "kubectl scale deployment/web --replicas=0"))).toEqual([]);
  const deleted = execute(write(withService, deployment()), "kubectl delete -f workload.json");
  expect(endpoints(deleted)).toEqual([]);
  expect(deleted.world.kubeServices).toEqual(withService.world.kubeServices);
  expect(deleted.world.kubeFiles["workload.json"]).toBeDefined();
});

test("mixed config/service/deployment documents apply and delete atomically, including sequence allocation", () => {
  const source = [
    { apiVersion: "v1", kind: "ConfigMap", metadata: { name: "settings" }, data: { MODE: "prod" } },
    service(),
    deployment(),
  ]
    .map((m) => JSON.stringify(m))
    .join("\n---\n");
  const s = execute(ready(), `sim files write bundle.yaml --content='${source}'`);
  const applied = execute(s, "kubectl apply -f bundle.yaml");
  expect(applied.text).toContain("configmap/settings created");
  expect(applied.text).toContain("service/svc created");
  expect(applied.text).toContain("deployment.apps/web created");
  expect(endpoints(applied)).toHaveLength(2);
  rejected(applied, "kubectl create -f bundle.yaml", "already exists");
  const partial = execute(applied, "kubectl delete deployment web");
  rejected(partial, "kubectl delete -f bundle.yaml", "not found");
  const deleted = execute(applied, "kubectl delete -f bundle.yaml");
  expect(deleted.world.kubeConfigs).toHaveLength(0);
  expect(deleted.world.kubeServices).toHaveLength(0);
  expect(deleted.world.kubeDeployments).toHaveLength(0);
  const collision = execute(write(s, deployment()), "kubectl create -f workload.json");
  rejected(collision, "kubectl create -f bundle.yaml", "already exists");
});

test("service-only permissions support apply/read/delete without Deployment or Pod permission", () => {
  const s = execute(
    ready(),
    "gcloud iam roles create serviceEditor --permissions=container.services.get,container.services.list,container.services.create,container.services.update,container.services.delete",
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:developer@example.com --role=projects/ace-dev-01/roles/serviceEditor",
    "gcloud auth login developer@example.com",
  );
  const first = execute(
    s,
    "kubectl apply -f web-service.yaml",
    "kubectl get svc",
    "kubectl describe svc manifest-svc",
  );
  execute(
    first,
    "sim files replace web-service.yaml --search=wrong-app --replacement=manifest-web",
    "kubectl apply -f web-service.yaml",
    "kubectl delete -f web-service.yaml",
  );
  execute(first, "kubectl delete svc manifest-svc");
  rejected(first, "kubectl apply -f web-deployment.yaml", "container.deployments.get");
  const source = `${JSON.stringify(service())}\n---\n${JSON.stringify(deployment())}`;
  const mixed = execute(s, `sim files write mixed.yaml --content='${source}'`);
  rejected(mixed, "kubectl apply -f mixed.yaml", "container.deployments.get");
});

test("apply requires get/create then update on existing Service", () => {
  const s = execute(
    ready(),
    "gcloud iam roles create serviceCreator --permissions=container.services.get,container.services.create",
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:developer@example.com --role=projects/ace-dev-01/roles/serviceCreator",
    "gcloud auth login developer@example.com",
  );
  const created = execute(s, "kubectl apply -f web-service.yaml");
  rejected(created, "kubectl apply -f web-service.yaml", "container.services.update");
  rejected(created, "kubectl delete -f web-service.yaml", "container.services.delete");
  rejected(created, "kubectl delete svc manifest-svc", "container.services.delete");
});

test("workload identity is isolated by cluster and current API/project context", () => {
  const s = execute(
    ready(),
    "kubectl apply -f web-deployment.yaml",
    "kubectl apply -f web-service.yaml",
    "gcloud container clusters create-auto other --region=us-central1",
    "kubectl apply -f web-deployment.yaml",
    "kubectl apply -f web-service.yaml",
  );
  expect(s.world.kubeDeployments).toHaveLength(2);
  expect(s.world.kubeServices).toHaveLength(2);
  const deleted = execute(
    s,
    "kubectl delete -f web-deployment.yaml",
    "kubectl delete -f web-service.yaml",
  );
  expect(deleted.world.kubeDeployments[0]?.cluster).toBe("manifest-gke");
  expect(deleted.world.kubeServices[0]?.cluster).toBe("manifest-gke");
  rejected(
    execute(session(), "sim files load kubernetes-workload"),
    "kubectl apply -f web-deployment.yaml",
    "container.googleapis.com",
  );
});

test("Service type transition is rejected atomically instead of fabricating IP allocation", () => {
  const s = execute(write(ready(), service()), "kubectl apply -f workload.json");
  const changed = { ...service(), spec: { ...service().spec, type: "ClusterIP" } };
  rejected(write(s, changed), "kubectl apply -f workload.json", "Changing Service type");
});

const invalidManifests = [
  { ...deployment(), apiVersion: "v1" },
  { ...deployment(), metadata: { name: "Bad" } },
  { ...deployment(), metadata: { name: "web", namespace: "other" } },
  { ...deployment(), metadata: { name: "web", labels: { tier: "app" } } },
  { ...deployment(), spec: { ...deployment().spec, replicas: -1 } },
  { ...deployment(), spec: { ...deployment().spec, replicas: 1001 } },
  { ...deployment(), spec: { ...deployment().spec, replicas: "2" } },
  { ...deployment(), spec: { ...deployment().spec, replicas: null } },
  { ...deployment(), spec: { ...deployment().spec, selector: { matchLabels: { app: "wrong" } } } },
  { ...deployment(), spec: { ...deployment().spec, strategy: { type: "RollingUpdate" } } },
  deployment("bad image"),
  deployment("nginx:1", 2, [{ name: "VALUE", value: true }]),
  deployment("nginx:1", 2, [
    { name: "A", value: "one" },
    { name: "A", value: "two" },
  ]),
  deployment("nginx:1", 2, [
    { name: "A", valueFrom: { secretKeyRef: { name: "s", key: "k", optional: true } } },
  ]),
  deployment("nginx:1", 2, [
    { name: "A", valueFrom: { fieldRef: { fieldPath: "metadata.name" } } },
  ]),
  deployment("nginx:1", 2, [
    { name: "A", value: "x", valueFrom: { secretKeyRef: { name: "s", key: "k" } } },
  ]),
  { ...service(), spec: { ...service().spec, selector: { tier: "web" } } },
  { ...service(), spec: { ...service().spec, type: "ExternalName" } },
  { ...service(), spec: { ...service().spec, type: null } },
  { ...service(), spec: { ...service().spec, clusterIP: "None" } },
  { ...service(), spec: { ...service().spec, ports: [{ port: 80, targetPort: "http" }] } },
  { ...service(), spec: { ...service().spec, ports: [{ port: 80, targetPort: null }] } },
  { ...service(), spec: { ...service().spec, ports: [{ port: 80, protocol: "UDP" }] } },
  { ...service(), spec: { ...service().spec, ports: [{ port: 80 }, { port: 443 }] } },
  service("web", 0),
  service("web", 65536),
  service("web", 80, -1),
];
test.each(invalidManifests)(
  "unsupported or invalid workload is rejected without state changes: %#",
  (manifest) => {
    expect(Result.isOk(KubeManifest.parse(JSON.stringify(manifest)))).toBe(false);
    rejected(write(ready(), manifest), "kubectl apply -f workload.json", "error:");
  },
);

test("workload mission requires initial image history, applied update and matching ready Service plus edited files", () => {
  const id = "m-gke-006";
  const start = ready(session(Result.unwrap(Engine.startMission(session().world, id))));
  const status = (s: Session) => s.world.missions.find((m) => m.id === id)?.status;
  const first = execute(
    start,
    "kubectl apply -f web-deployment.yaml",
    "kubectl apply -f web-service.yaml",
  );
  expect(status(first)).toBe("in_progress");
  const edited = execute(
    first,
    "sim files replace web-deployment.yaml --search=nginx:1 --replacement=nginx:2",
    "sim files replace web-service.yaml --search=wrong-app --replacement=manifest-web",
  );
  expect(status(edited)).toBe("in_progress");
  const updated = execute(edited, "kubectl apply -f web-deployment.yaml");
  expect(status(updated)).toBe("in_progress");
  const wrong = execute(
    updated,
    "kubectl scale deployment/manifest-web --replicas=1",
    "kubectl apply -f web-service.yaml",
  );
  expect(status(wrong)).toBe("in_progress");
  const correct = execute(restored(updated), "kubectl apply -f web-service.yaml");
  expect(status(correct)).toBe("completed");
  const skipped = execute(
    start,
    "sim files replace web-deployment.yaml --search=nginx:1 --replacement=nginx:2",
    "sim files replace web-service.yaml --search=wrong-app --replacement=manifest-web",
    "kubectl apply -f web-deployment.yaml",
    "kubectl apply -f web-service.yaml",
  );
  expect(status(skipped)).toBe("in_progress");
});

test.each([
  { containers: [{ name: "other", image: "nginx:1" }] },
  { containers: [{ name: "web", image: "nginx:1", ports: [{ containerPort: 80 }] }] },
  {
    containers: [
      { name: "web", image: "nginx:1" },
      { name: "sidecar", image: "nginx:1" },
    ],
  },
  {
    containers: [
      { name: "web", image: "nginx:1", envFrom: [{ configMapRef: { name: "settings" } }] },
    ],
  },
  { containers: [{ name: "web", image: "nginx:1" }], volumes: [] },
])("unsupported Pod template fields never silently disappear: %#", (spec) => {
  const d = deployment();
  const manifest = { ...d, spec: { ...d.spec, template: { ...d.spec.template, spec } } };
  rejected(write(ready(), manifest), "kubectl apply -f workload.json", "error:");
});

test.each(["web-deployment.yaml", "web-service.yaml"])(
  "create-only permissions do not grant apply or get: %s",
  (file) => {
    const s = execute(
      ready(),
      "gcloud iam roles create creator --permissions=container.deployments.create,container.services.create",
      "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:developer@example.com --role=projects/ace-dev-01/roles/creator",
      "gcloud auth login developer@example.com",
    );
    rejected(s, `kubectl apply -f ${file}`, ".get");
    const created = execute(s, `kubectl create -f ${file}`);
    rejected(created, `kubectl delete -f ${file}`, ".delete");
  },
);

test("Service defaults and NodePort use the existing model and survive snapshot reload", () => {
  const base = {
    apiVersion: "v1",
    kind: "Service",
    metadata: { name: "svc" },
    spec: { selector: { app: "web" }, ports: [{ port: 8080 }] },
  };
  const s = execute(write(ready(), base), "kubectl create -f workload.json");
  expect(s.world.kubeServices[0]).toMatchObject({
    type: "ClusterIP",
    targetPort: 8080,
    externalIp: { some: false },
  });
  const node = { ...base, spec: { ...base.spec, type: "NodePort" } };
  const next = execute(write(ready(), node), "kubectl create -f workload.json");
  expect(JSON.parse(execute(next, "kubectl get svc svc -o json").text).spec.type).toBe("NodePort");
  expect(restored(next).world).toEqual(next.world);
});
