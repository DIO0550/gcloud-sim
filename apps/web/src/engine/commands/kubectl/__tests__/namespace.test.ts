// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { Now, run, type Session, session } from "@/engine/__tests__/setup";
import { KubeRuntime } from "@/engine/domains/kube-config";
import { KubeNamespace } from "@/engine/domains/kube-namespace";
import { KubeServiceRouting } from "@/engine/domains/kube-service-routing";
import { KubePod } from "@/engine/domains/kubernetes";
import { World } from "@/engine/domains/world";
import { TreeSelection } from "@/engine/resource-tree/selection";
import { Snapshot } from "@/engine/snapshot";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const execute = (s: Session, ...commands: string[]) =>
  commands.reduce((s, c) => {
    const next = run(s, c);
    expect(next.text, c).not.toMatch(/^(ERROR:|error:|Error from server)/m);
    const checked = World.validate(next.world);
    expect(checked, c).toEqual(Result.ok(next.world));
    return next;
  }, s);
const ready = () =>
  execute(
    session(),
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create namespace-gke --zone=us-central1-a",
  );
const rejected = (s: Session, c: string, message: string) => {
  const next = run(s, c);
  expect(next.text, c).toContain(message);
  expect(next.world).toEqual(s.world);
};
const json = (s: Session, c: string) => JSON.parse(execute(s, c).text);
const write = (s: Session, data: unknown, filename = "bundle.json") =>
  execute(s, `sim files write ${filename} --content='${JSON.stringify(data)}'`);
const d = (s: Session, ns = "staging") => {
  const found = s.world.kubeDeployments.find(
    (d) => d.namespace === ns && d.name === "web" && d.cluster === "namespace-gke",
  );
  if (!found) throw new Error("Missing Deployment");
  return found;
};
const svc = (s: Session, ns = "staging") => {
  const found = s.world.kubeServices.find(
    (s) => s.namespace === ns && s.name === "web" && s.cluster === "namespace-gke",
  );
  if (!found) throw new Error("Missing Service");
  return found;
};
const configured = () =>
  execute(
    ready(),
    "kubectl create namespace staging",
    "kubectl create ns production",
    ...["staging", "production"].flatMap((ns) => [
      `kubectl create deployment web --image=nginx:1 -n ${ns}`,
      `kubectl create configmap settings --from-literal=MODE=${ns} -n ${ns}`,
      `kubectl create secret generic token --from-literal=TOKEN=${ns} -n ${ns}`,
      `kubectl set env deployment/web --from=configmap/settings -n ${ns}`,
      `kubectl set env deployment/web --from=secret/token -n ${ns}`,
      `kubectl expose deployment web --port=80 -n ${ns}`,
      `kubectl set resources deployment/web --requests=cpu=100m -n ${ns}`,
      `kubectl autoscale deployment/web --min=1 --max=5 --cpu-percent=50 -n ${ns}`,
    ]),
  );
const deployment = (namespace?: string) => ({
  apiVersion: "apps/v1",
  kind: "Deployment",
  metadata: { name: "web", ...(namespace ? { namespace } : {}) },
  spec: {
    replicas: 1,
    selector: { matchLabels: { app: "web" } },
    template: {
      metadata: { labels: { app: "web" } },
      spec: { containers: [{ name: "web", image: "nginx:1" }] },
    },
  },
});
const nsManifest = (name = "test") => ({ apiVersion: "v1", kind: "Namespace", metadata: { name } });
const restore = (s: Session) =>
  session(
    Result.unwrap(Snapshot.fromUnknown(JSON.parse(JSON.stringify(Snapshot.create(s.world, Now))))),
  );

test("built-in namespaces are cluster scoped; create/get/describe/JSON/YAML and empty namespace listing work", () => {
  const s = ready();
  const builtins = json(s, "kubectl get ns -o json").items;
  expect(builtins.map((n: { metadata: { name: string } }) => n.metadata.name)).toEqual([
    "default",
    "kube-node-lease",
    "kube-public",
    "kube-system",
  ]);
  expect(builtins[0].metadata.namespace).toBeUndefined();
  expect(builtins[0].metadata.labels["kubernetes.io/metadata.name"]).toBe("default");
  const created = execute(s, "kubectl create namespace staging");
  expect(json(created, "kubectl get namespace/staging -o json")).toMatchObject({
    kind: "Namespace",
    metadata: { name: "staging", creationTimestamp: Now },
    status: { phase: "Active" },
  });
  expect(execute(created, "kubectl describe ns staging").text).toContain("Active");
  expect(execute(created, "kubectl get ns -o yaml").text).toContain("Namespace");
  expect(execute(created, "kubectl get deployments -n staging").text).toBe(
    "No resources found in staging namespace.",
  );
  rejected(created, "kubectl create namespace staging", "already exists");
  rejected(created, "kubectl create namespace default", "already exists");
});

test.each(["Uppercase", "has.dot", "-start", "end-", "a".repeat(64)])(
  "invalid namespace %s is rejected without mutation",
  (name) => {
    const s = ready();
    rejected(s, `kubectl create namespace -- ${name}`, "Namespace must be");
    rejected(s, `kubectl create deployment web --image=nginx:1 -n ${name}`, "Namespace must be");
    rejected(write(s, nsManifest(name)), "kubectl apply -f bundle.json", "Invalid v1 Namespace");
  },
);

test("unknown namespace refuses writes/reads/probes/reconcile and sample manifests atomically", () => {
  const s = ready();
  for (const c of [
    "kubectl get deployment web",
    "kubectl create deployment web --image=nginx:1",
    "kubectl create configmap settings",
    "kubectl apply -f deployment.yaml",
    "kubectl delete -f deployment.yaml",
    "sim kubernetes probe web --status-code=200",
    "sim kubernetes reconcile web --cpu=100m",
  ]) {
    rejected(s, `${c} -n absent`, 'namespaces "absent" not found');
  }
  rejected(
    s,
    "kubectl create namespace stage -n staging -n production",
    "may only be specified once",
  );
});

test("same names coexist; default lookup does not select another namespace, and -A reports every namespace", () => {
  const s = configured();
  expect(execute(s, "kubectl get deployments").text).toBe(
    "No resources found in default namespace.",
  );
  rejected(s, "kubectl get deployment web", 'deployments.apps "web" not found');
  const list = json(s, "kubectl get deployments -A -o json").items;
  expect(list.map((r: { metadata: { namespace: string } }) => r.metadata.namespace)).toEqual([
    "production",
    "staging",
  ]);
  expect(execute(s, "kubectl get deployments --all-namespaces").text).toContain("NAMESPACE");
  expect(json(s, "kubectl get all -A -o json").items).toHaveLength(8);
  expect(json(s, "kubectl get pods -A -l app=web -o json").items).toHaveLength(2);
  rejected(s, "kubectl get deployment web -A", "cannot be combined");
  rejected(s, "kubectl get deployments -A -n staging", "cannot be combined");
  expect(json(s, "kubectl get deployment/web -n staging -o json").metadata.namespace).toBe(
    "staging",
  );
  expect(json(s, "kubectl get service/web -n production -o json").metadata.namespace).toBe(
    "production",
  );
  expect(
    json(s, "kubectl get rs -n staging -o json").items.every(
      (r: { metadata: { namespace: string } }) => r.metadata.namespace === "staging",
    ),
  ).toBe(true);
  expect(
    new Set(s.world.kubeDeployments.flatMap(KubePod.fromDeployment).map((p) => p.ip)).size,
  ).toBe(2);
});

test.each([
  "kubectl scale deployment/web --replicas=3",
  "kubectl set image deployment/web web=nginx:2",
  "kubectl set resources deployment/web --requests=cpu=200m",
  "kubectl set env deployment/web MODE=changed",
  "kubectl rollout restart deployment/web",
  "kubectl rollout undo deployment/web",
  "kubectl delete deployment/web",
  "kubectl delete service/web",
  "kubectl delete configmap/settings",
  "kubectl delete secret/token",
  "kubectl delete hpa/web",
  "sim kubernetes reconcile web --cpu=250m",
])("%s changes only the selected namespace", (command) => {
  const s = configured();
  const next = execute(s, `${command} --namespace=staging`);
  for (const key of ["kubeDeployments", "kubeServices", "kubeConfigs", "kubeHpas"] as const) {
    expect(next.world[key].filter((r) => r.namespace === "production")).toEqual(
      s.world[key].filter((r) => r.namespace === "production"),
    );
  }
});

test("ConfigMap/Secret references and Service routing never cross namespace boundaries", () => {
  const s = configured();
  for (const ns of ["staging", "production"]) {
    expect(execute(s, `kubectl exec deployment/web -n ${ns} -- printenv MODE`).text).toBe(ns);
    expect(execute(s, `kubectl exec deployment/web -n ${ns} -- printenv TOKEN`).text).toBe(ns);
    expect(KubeServiceRouting.backends(s.world, svc(s, ns))).toHaveLength(1);
    expect(KubeServiceRouting.backends(s.world, svc(s, ns))[0]?.endpoint).toBe(
      `${KubePod.fromDeployment(d(s, ns))[0]?.ip}:80`,
    );
  }
  const removed = execute(
    s,
    "kubectl delete configmap settings -n staging",
    "kubectl rollout restart deployment/web -n staging",
  );
  expect(
    KubeRuntime.error(
      removed.world.kubeConfigs,
      d(removed),
      KubePod.fromDeployment(d(removed))[0]?.name ?? "",
    ),
  ).toContain("CreateContainerConfigError");
  expect(KubeServiceRouting.backends(removed.world, svc(removed))).toEqual([]);
  expect(KubeServiceRouting.backends(removed.world, svc(removed, "production"))).toHaveLength(1);
  const withoutTarget = execute(
    s,
    "kubectl delete deployment web -n staging",
    "sim kubernetes reconcile web -n staging --cpu=250m",
  );
  expect(
    withoutTarget.world.kubeHpas.find((h) => h.namespace === "staging")?.lastEvaluation,
  ).toMatchObject(Option.some({ reason: "TargetNotFound" }));
});

test("same Pod names can be selected safely for deletion/logs/exec within a namespace", () => {
  const s = execute(
    ready(),
    "kubectl create ns staging",
    "kubectl create ns production",
    "kubectl create deployment web --image=nginx:1 -n staging",
    "kubectl create deployment web --image=nginx:1 -n production",
  );
  const pod = KubePod.fromDeployment(d(s))[0]?.name ?? "";
  expect(KubePod.fromDeployment(d(s, "production"))[0]?.name).toBe(pod);
  expect(json(s, `kubectl get pod ${pod} -n staging -o json`).metadata.namespace).toBe("staging");
  execute(s, `kubectl logs ${pod} -n staging`, `kubectl exec ${pod} -n staging -- env`);
  const next = execute(s, `kubectl delete pod ${pod} -n staging`);
  expect(d(next, "production")).toEqual(d(s, "production"));
  expect(KubePod.fromDeployment(d(next))[0]?.name).not.toBe(pod);
});

test("startup/readiness/liveness evaluations and restart counts are namespace scoped", () => {
  const probe = { httpGet: { path: "/", port: 80 }, failureThreshold: 1 };
  const m = deployment();
  const container = {
    name: "web",
    image: "nginx:1",
    startupProbe: probe,
    readinessProbe: probe,
    livenessProbe: probe,
  };
  m.spec.template.spec.containers = [container];
  const s = execute(
    write(ready(), m),
    "kubectl create ns staging",
    "kubectl create ns production",
    "kubectl apply -f bundle.json -n staging",
    "kubectl apply -f bundle.json -n production",
    "sim kubernetes probe web --kind=startup --status-code=200 -n staging",
    "sim kubernetes probe web --status-code=200 -n staging",
    "sim kubernetes probe web --kind=liveness --status-code=503 -n staging",
  );
  expect(d(s).podRestarts[0]?.restarts).toBe(1);
  expect(d(s, "production").podStartup).toEqual([]);
  rejected(s, "sim kubernetes probe web --status-code=200 -n production", "StartupProbePending");
  expect(restore(s).world).toEqual(s.world);
});

test("manifest namespace follows metadata or command default; -n mismatch and resolved duplicates are atomic", () => {
  const s = execute(ready(), "kubectl create ns staging", "kubectl create ns production");
  const first = execute(write(s, deployment("staging")), "kubectl apply -f bundle.json");
  expect(d(first).namespace).toBe("staging");
  rejected(
    write(first, deployment("staging")),
    "kubectl apply -f bundle.json -n production",
    "does not match",
  );
  expect(
    execute(write(s, deployment()), "kubectl apply -f bundle.json -n production").world
      .kubeDeployments[0]?.namespace,
  ).toBe("production");
  const mixed = execute(
    s,
    `sim files write mixed.yaml --content='${JSON.stringify(deployment("staging"))}\n---\n${JSON.stringify(deployment("production"))}'`,
    "kubectl apply -f mixed.yaml",
  );
  expect(mixed.world.kubeDeployments).toHaveLength(2);
  const duplicate = execute(
    s,
    `sim files write duplicate.yaml --content='${JSON.stringify(deployment())}\n---\n${JSON.stringify(deployment("staging"))}'`,
  );
  rejected(
    duplicate,
    "kubectl apply -f duplicate.yaml -n staging",
    "Duplicate resource in resolved",
  );
  const independent = execute(
    s,
    `sim files write independent.yaml --content='${JSON.stringify(deployment())}\n---\n${JSON.stringify(deployment("production"))}'`,
  );
  // An explicit -n must match every explicit manifest namespace.
  rejected(independent, "kubectl apply -f independent.yaml -n staging", "does not match");
  expect(
    execute(independent, "kubectl apply -f independent.yaml").world.kubeDeployments,
  ).toHaveLength(2);
});

test("Namespace manifests can precede workloads; failure rolls back namespace creation and all earlier resources", () => {
  const s = execute(
    ready(),
    `sim files write combined.yaml --content='${JSON.stringify(nsManifest("staging"))}\n---\n${JSON.stringify(deployment("staging"))}'`,
  );
  const applied = execute(s, "kubectl apply -f combined.yaml");
  expect(d(applied).namespace).toBe("staging");
  expect(execute(applied, "kubectl apply -f combined.yaml").world).toEqual(applied.world);
  rejected(applied, "kubectl create -f combined.yaml", "already exists");
  const invalid = execute(
    ready(),
    `sim files write failed.yaml --content='${JSON.stringify(nsManifest("staging"))}\n---\n${JSON.stringify(deployment("absent"))}'`,
  );
  rejected(invalid, "kubectl apply -f failed.yaml", 'namespaces "absent" not found');
});

test("namespace deletion cascades only within its project/cluster/namespace; built-ins are protected", () => {
  const s = configured();
  const other = execute(
    s,
    "gcloud container clusters create other --zone=us-central1-a",
    "kubectl create ns staging",
    "kubectl create deployment web --image=nginx:1 -n staging",
    "gcloud container clusters get-credentials namespace-gke --zone=us-central1-a",
  );
  const removed = execute(other, "kubectl delete namespace staging");
  expect(removed.world.kubeNamespaces).toHaveLength(2);
  expect(removed.world.kubeDeployments).toHaveLength(2);
  for (const key of ["kubeDeployments", "kubeServices", "kubeConfigs", "kubeHpas"] as const)
    expect(
      removed.world[key].some((r) => r.namespace === "staging" && r.cluster === "namespace-gke"),
    ).toBe(false);
  expect(removed.world.kubeDeployments.filter((d) => d.namespace === "production")).toEqual(
    other.world.kubeDeployments.filter((d) => d.namespace === "production"),
  );
  for (const name of ["default", "kube-system", "kube-public", "kube-node-lease"])
    rejected(other, `kubectl delete ns ${name}`, "Deleting built-in");
  const clusterDeleted = execute(
    other,
    "gcloud container clusters delete namespace-gke --zone=us-central1-a --quiet",
  );
  expect(clusterDeleted.world.kubeNamespaces.map((n) => n.cluster)).toEqual(["other"]);
});

test("viewer reads namespaces and -A but cannot mutate; namespace permissions/API/context are enforced", () => {
  const s = configured();
  const viewer = execute(
    s,
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:dev@example.com --role=roles/container.viewer",
    "gcloud auth login dev@example.com",
  );
  execute(viewer, "kubectl get ns", "kubectl describe ns staging", "kubectl get deployments -A");
  rejected(viewer, "kubectl create ns test", "container.namespaces.");
  rejected(viewer, "kubectl delete ns staging", "container.namespaces.");
  rejected(
    write(viewer, nsManifest("staging")),
    "kubectl apply -f bundle.json",
    "container.namespaces.",
  );
  const disabled = execute(s, "gcloud services disable container.googleapis.com");
  rejected(disabled, "kubectl get ns", "disabled");
  const missing = execute(s, "gcloud config unset container/cluster");
  rejected(missing, "kubectl get ns", "connection to the server");
});

test("snapshot v17 retains probes/restarts/HPA/files/env/history while adding default namespace", () => {
  const s = execute(
    ready(),
    "sim files load kubernetes-startup",
    "kubectl apply -f slow-web.yaml",
    "kubectl apply -f slow-service.yaml",
    "kubectl set resources deployment/slow-web --requests=cpu=100m",
    "sim kubernetes probe slow-web --kind=startup --status-code=503",
    "sim kubernetes probe slow-web --kind=startup --status-code=503",
    "sim kubernetes probe slow-web --kind=startup --status-code=503",
    "kubectl autoscale deployment/slow-web --min=1 --max=3",
    "sim kubernetes reconcile slow-web --cpu=250m",
  );
  const value = JSON.parse(JSON.stringify(Snapshot.create(s.world, Now)));
  value.schemaVersion = 17;
  delete value.world.kubeNamespaces;
  for (const key of ["kubeDeployments", "kubeServices", "kubeConfigs", "kubeHpas"])
    for (const r of value.world[key]) delete r.namespace;
  const migrated = Result.unwrap(Snapshot.fromUnknown(value));
  expect(migrated).toEqual(s.world);
  expect(Snapshot.create(migrated, Now).schemaVersion).toBe(35);
});

test.each([
  "missing",
  "duplicate",
  "builtin",
  "badName",
  "missingCluster",
  "unknownNamespace",
  "missingNamespace",
  "duplicateResource",
  "duplicateHpaTarget",
])("invalid saved namespace state is rejected: %s", (kind) => {
  const value = JSON.parse(JSON.stringify(Snapshot.create(configured().world, Now)));
  if (kind === "missing") delete value.world.kubeNamespaces;
  if (kind === "duplicate") value.world.kubeNamespaces.push(value.world.kubeNamespaces[0]);
  if (kind === "builtin") value.world.kubeNamespaces[0].name = "default";
  if (kind === "badName") value.world.kubeNamespaces[0].name = "Bad";
  if (kind === "missingCluster") value.world.kubeNamespaces[0].cluster = "absent";
  if (kind === "unknownNamespace") value.world.kubeDeployments[0].namespace = "absent";
  if (kind === "missingNamespace") delete value.world.kubeDeployments[0].namespace;
  if (kind === "duplicateResource")
    value.world.kubeDeployments.push(value.world.kubeDeployments[0]);
  if (kind === "duplicateHpaTarget")
    value.world.kubeHpas.push({ ...value.world.kubeHpas[0], name: "second" });
  expect(Result.isOk(Snapshot.fromUnknown(value))).toBe(false);
});

test("completion and tree identities/descriptions include namespace", () => {
  const s = configured();
  expect(Engine.completionCandidates(s.world, "kubectl get deployments --namespace=sta")).toEqual([
    "--namespace=staging",
  ]);
  expect(Engine.completionCandidates(s.world, "sim kubernetes probe web -n prod")).toEqual([
    "production",
  ]);
  expect(execute(s, "kubectl get --help").text).toContain("--all-namespaces");
  const selection = {
    kind: "kube-deployment",
    projectId: "ace-dev-01",
    cluster: "namespace-gke",
    name: "web",
    namespace: "staging",
  } as const;
  expect(TreeSelection.equals(selection, { ...selection, namespace: "production" })).toBe(false);
  expect(TreeSelection.describeCommand(selection)).toEqual(
    Option.some("kubectl describe deployment web --namespace=staging"),
  );
  const cluster = s.world.clusters[0];
  if (!cluster) throw new Error("Missing cluster");
  expect(KubeNamespace.of(s.world, cluster).map((n) => n.name)).toContain("staging");
});

test("namespace mission requires independent configs and Service backends, and only staging may be updated", () => {
  const id = "m-gke-015";
  const status = (s: Session) => s.world.missions.find((m) => m.id === id)?.status;
  const s = execute(
    session(Result.unwrap(Engine.startMission(session().world, id))),
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create namespace-gke --zone=us-central1-a",
    "sim files load kubernetes-namespace",
    "kubectl apply -f namespaces.yaml",
    "kubectl apply -f staging.yaml",
    "kubectl apply -f production.yaml",
  );
  expect(status(s)).toBe("in_progress");
  const updated = execute(s, "kubectl set image deployment/web web=nginx:2 -n staging");
  expect(status(updated)).toBe("in_progress");
  const wrongProduction = execute(
    updated,
    "kubectl set image deployment/web web=nginx:2 -n production",
    "kubectl scale deployment/web --replicas=3 -n staging",
  );
  expect(status(wrongProduction)).toBe("in_progress");
  const badService = {
    apiVersion: "v1",
    kind: "Service",
    metadata: { name: "web-service", namespace: "staging" },
    spec: { selector: { app: "absent" }, ports: [{ port: 80 }] },
  };
  const wrongService = execute(
    write(updated, badService),
    "kubectl apply -f bundle.json",
    "kubectl scale deployment/web --replicas=3 -n staging",
  );
  expect(status(wrongService)).toBe("in_progress");
  const done = execute(restore(updated), "kubectl scale deployment/web --replicas=3 -n staging");
  expect(status(done)).toBe("completed");
  expect(restore(done).world).toEqual(done.world);
});

test("same namespace names and resources in another project remain independent", () => {
  const s = configured();
  const prod = execute(
    s,
    "gcloud config set project ace-prod-01",
    "gcloud billing projects link ace-prod-01 --billing-account=01AB2C-DEF345-6789AB",
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create namespace-gke --zone=us-central1-a",
    "kubectl create ns staging",
    "kubectl create deployment web --image=nginx:1 -n staging",
  );
  const removed = execute(prod, "kubectl delete ns staging");
  expect(removed.world.kubeDeployments.filter((d) => d.projectId === "ace-dev-01")).toEqual(
    s.world.kubeDeployments,
  );
  expect(removed.world.kubeNamespaces.filter((n) => n.projectId === "ace-dev-01")).toEqual(
    s.world.kubeNamespaces,
  );
});

test("ConfigMap/Secret/HPA manifests create/apply/delete in selected namespaces and preserve unrelated state", () => {
  const s = execute(configured(), "sim files load kubernetes-hpa");
  const m = json(s, "kubectl get hpa web -n staging -o json");
  delete m.status;
  delete m.simulator;
  m.metadata = { name: "web", namespace: "staging" };
  m.spec.maxReplicas = 4;
  const applied = execute(
    write(s, { apiVersion: m.apiVersion, kind: m.kind, metadata: m.metadata, spec: m.spec }),
    "kubectl apply -f bundle.json",
  );
  expect(applied.world.kubeHpas.find((h) => h.namespace === "staging")?.maxReplicas).toBe(4);
  expect(applied.world.kubeHpas.find((h) => h.namespace === "production")).toEqual(
    s.world.kubeHpas.find((h) => h.namespace === "production"),
  );
  expect(execute(applied, "kubectl apply -f bundle.json").world).toEqual(applied.world);
  const deleted = execute(applied, "kubectl delete -f bundle.json");
  expect(deleted.world.kubeHpas.map((h) => h.namespace)).toEqual(["production"]);
  const cm = {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: { name: "settings", namespace: "staging" },
    data: { MODE: "updated" },
  };
  const updated = execute(write(s, cm), "kubectl apply -f bundle.json");
  expect(
    updated.world.kubeConfigs.find((c) => c.namespace === "production" && c.kind === "configmap"),
  ).toEqual(
    s.world.kubeConfigs.find((c) => c.namespace === "production" && c.kind === "configmap"),
  );
  expect(execute(updated, "kubectl exec deployment/web -n staging -- printenv MODE").text).toBe(
    "staging",
  );
  expect(
    execute(
      updated,
      "kubectl rollout restart deployment/web -n staging",
      "kubectl exec deployment/web -n staging -- printenv MODE",
    ).text,
  ).toBe("updated");
});

test("resource names resembling cluster-scoped kinds cannot bypass namespace validation", () => {
  const s = ready();
  for (const name of ["namespace", "node", "nodes"])
    rejected(s, `kubectl create configmap ${name} -n absent`, 'namespaces "absent" not found');
});

test("kubeconfig can list and switch contexts before a current context is set", () => {
  const s = execute(ready(), "gcloud config unset container/cluster");
  expect(execute(s, "kubectl config get-contexts").text).toContain("namespace-gke");
  expect(execute(s, "kubectl config view").text).toContain("namespace-gke");
  const switched = execute(s, "kubectl config use-context namespace-gke");
  expect(execute(switched, "kubectl config current-context").text).toContain("namespace-gke");
});
