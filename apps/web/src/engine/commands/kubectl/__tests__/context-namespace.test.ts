// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { Now, run, type Session, session } from "@/engine/__tests__/setup";
import { KubeContext } from "@/engine/domains/kube-context";
import { World } from "@/engine/domains/world";
import { TreeSelection } from "@/engine/resource-tree/selection";
import { Snapshot } from "@/engine/snapshot";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const execute = (s: Session, ...commands: string[]) =>
  commands.reduce((s, command) => {
    const next = run(s, command);
    expect(next.text, command).not.toMatch(/^(ERROR:|error:|Error from server)/m);
    expect(World.validate(next.world), command).toEqual(Result.ok(next.world));
    return next;
  }, s);
const ready = () =>
  execute(
    session(),
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create context-gke --zone=us-central1-a",
    "kubectl create namespace staging",
    "kubectl create namespace production",
    "kubectl create deployment web --image=nginx:1 -n staging",
    "kubectl create deployment web --image=nginx:1 -n production",
  );
const rejected = (s: Session, command: string, message: string) => {
  const next = run(s, command);
  expect(next.text, command).toContain(message);
  expect(next.world, command).toEqual(s.world);
};
const json = (s: Session, command: string) => JSON.parse(execute(s, command).text);
const selected = (s: Session) => Option.unwrap(KubeContext.current(s.world, "ace-dev-01"));
const configured = () =>
  execute(ready(), "kubectl config set-context --current --namespace=staging");
const restore = (s: Session) =>
  session(
    Result.unwrap(Snapshot.fromUnknown(JSON.parse(JSON.stringify(Snapshot.create(s.world, Now))))),
  );

test("unset context falls back to default; set-context scopes implicit reads and mutations without changing resources", () => {
  const before = ready();
  expect(json(before, "kubectl get deployments -o json").items).toEqual([]);
  const s = execute(before, "kubectl config set-context --current --namespace=staging");
  expect(s.world.kubeDeployments).toEqual(before.world.kubeDeployments);
  expect(s.world.config).toEqual(before.world.config);
  expect(json(s, "kubectl get deployment web -o json").metadata.namespace).toBe("staging");
  const changed = execute(
    s,
    "kubectl set image deployment/web web=nginx:2",
    "kubectl scale deployment/web --replicas=2",
  );
  expect(json(changed, "kubectl get deployment web -o json").spec.replicas).toBe(2);
  expect(json(changed, "kubectl get deployment web -n production -o json").spec.replicas).toBe(1);
  expect(
    json(changed, "kubectl get deployment web -n production -o json").spec.template.spec
      .containers[0].image,
  ).toBe("nginx:1");
  expect(execute(changed, "kubectl config get-contexts").text).toMatch(/NAMESPACE[\s\S]*staging/);
  expect(execute(changed, "kubectl config view").text).toContain("namespace: staging");
  expect(json(changed, "kubectl get deployments -A -o json").items).toHaveLength(2);
  rejected(changed, "kubectl get deployments -A -n production", "all-namespaces");
});

test("explicit namespace overrides the context without persisting, and empty namespace removes the setting", () => {
  const s = execute(configured(), "kubectl scale deployment/web --replicas=3 -n production");
  expect(KubeContext.namespace(s.world, selected(s))).toBe("staging");
  expect(json(s, "kubectl get deployment web -o json").spec.replicas).toBe(1);
  expect(json(s, "kubectl get deployment web -n production -o json").spec.replicas).toBe(3);
  const reset = execute(
    s,
    "kubectl config set-context --current --namespace=''",
    "kubectl create deployment web --image=nginx:1",
  );
  expect(reset.world.kubeContextNamespaces).toEqual({});
  expect(json(reset, "kubectl get deployment web -o json").metadata.namespace).toBe("default");
  expect(execute(reset, "kubectl config view").text).not.toContain("namespace:");
  const explicitDefault = execute(s, "kubectl config set-context --current --namespace=default");
  expect(execute(explicitDefault, "kubectl config view").text).toContain("namespace: default");
  expect(
    execute(explicitDefault, "kubectl config set-context --current --namespace=default").world,
  ).toEqual(explicitDefault.world);
});

test("named settings preserve selection; use-context and get-credentials retain a different default per cluster", () => {
  const a = configured();
  const nameA = KubeContext.name(selected(a));
  const b = execute(
    a,
    "gcloud container clusters create other-gke --zone=asia-northeast1-a",
    "kubectl config set-context --current --namespace=production",
  );
  const nameB = KubeContext.name(selected(b));
  const named = execute(b, `kubectl config set-context ${nameA} --namespace=staging`);
  expect(execute(named, "kubectl config current-context").text).toBe(nameB);
  const switched = execute(named, "kubectl config use-context context-gke");
  expect(KubeContext.namespace(switched.world, selected(switched))).toBe("staging");
  const credentials = execute(
    switched,
    "gcloud container clusters get-credentials other-gke --zone=asia-northeast1-a",
  );
  expect(KubeContext.namespace(credentials.world, selected(credentials))).toBe("production");
  const noCurrent = execute(credentials, "gcloud config unset container/cluster");
  rejected(
    noCurrent,
    "kubectl config set-context --current --namespace=staging",
    "current-context is not set",
  );
  const changed = execute(
    noCurrent,
    "kubectl config set-context context-gke --namespace=production",
    "kubectl config get-contexts",
    "kubectl config use-context context-gke",
  );
  expect(KubeContext.namespace(changed.world, selected(changed))).toBe("production");
});

test("same cluster name in another project uses an independent context namespace", () => {
  const dev = configured();
  const prod = execute(
    dev,
    "gcloud config set project ace-prod-01",
    "gcloud billing projects link ace-prod-01 --billing-account=01AB2C-DEF345-6789AB",
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create context-gke --zone=us-central1-a",
    "kubectl config set-context --current --namespace=production",
  );
  const back = execute(prod, "gcloud config set project ace-dev-01");
  expect(KubeContext.namespace(back.world, selected(back))).toBe("staging");
  expect(Object.values(back.world.kubeContextNamespaces).sort()).toEqual(["production", "staging"]);
  rejected(
    back,
    "kubectl config set-context gke_ace-prod-01_us-central1-a_context-gke --namespace=staging",
    "no context exists",
  );
});

test("gcloud configurations share context defaults while selecting their own current clusters", () => {
  const a = configured();
  const b = execute(
    a,
    "gcloud config configurations create other",
    "gcloud config set account owner@example.com",
    "gcloud config set project ace-dev-01",
    "gcloud container clusters create other-gke --zone=us-central1-a",
    "kubectl config set-context --current --namespace=production",
  );
  const back = execute(b, "gcloud config configurations activate default");
  expect(execute(back, "kubectl config current-context").text).toContain("context-gke");
  expect(KubeContext.namespace(back.world, selected(back))).toBe("staging");
});

test.each([
  ["kubectl config set-context --current", "Use config set-context"],
  ["kubectl config set-context --namespace=staging", "Use config set-context"],
  [
    "kubectl config set-context context-gke --current --namespace=staging",
    "Use config set-context",
  ],
  ["kubectl config set-context absent --namespace=staging", "no context exists"],
  ["kubectl config set-context --current --namespace=Bad", "lowercase DNS label"],
  ["kubectl config set-context --current --namespace=a.b", "lowercase DNS label"],
  [`kubectl config set-context --current --namespace=${"a".repeat(64)}`, "lowercase DNS label"],
  ["kubectl config get-contexts --namespace=staging", "only supported with config set-context"],
  ["kubectl config use-context context-gke --current", "only supported with config set-context"],
  [
    "kubectl config set-context --current --namespace=staging -n production",
    "only be specified once",
  ],
])("invalid context usage cannot mutate state: %s", (command, message) =>
  rejected(configured(), command, message),
);

test("missing/deleted namespace remains configured and can be recovered with config or an explicit flag", () => {
  const s = execute(configured(), "kubectl delete namespace staging");
  expect(KubeContext.namespace(s.world, selected(s))).toBe("staging");
  rejected(s, "kubectl get deployments", 'namespaces "staging" not found');
  expect(json(s, "kubectl get deployments -A -o json").items).toHaveLength(1);
  execute(
    s,
    "kubectl get ns",
    "kubectl get nodes",
    "kubectl get deployment web -n production",
    "kubectl config get-contexts",
    "kubectl config view",
  );
  const changed = execute(s, "kubectl config set-context --current --namespace=not-created");
  rejected(
    changed,
    "kubectl create deployment nope --image=nginx:1",
    'namespaces "not-created" not found',
  );
  execute(
    changed,
    "kubectl config set-context --current --namespace=''",
    "kubectl get deployments",
  );
});

test("manifest omission uses context; explicit metadata namespace wins unless an explicit flag disagrees", () => {
  const s = execute(
    configured(),
    "sim files load kubernetes-workload",
    "kubectl apply -f web-deployment.yaml",
  );
  expect(s.world.kubeDeployments.find((d) => d.name === "manifest-web")?.namespace).toBe("staging");
  const namespaces = execute(
    s,
    "sim files load kubernetes-namespace",
    "kubectl apply -f production.yaml",
  );
  expect(json(namespaces, "kubectl get configmap settings -n production -o json").data.MODE).toBe(
    "production",
  );
  expect(namespaces.world.kubeConfigs.some((c) => c.namespace === "staging")).toBe(false);
  rejected(namespaces, "kubectl apply -f production.yaml -n staging", "namespace");
});

test("probe and HPA evaluation use the context default and preserve the other namespace", () => {
  const s = execute(
    configured(),
    "sim files load kubernetes-startup",
    "kubectl apply -f slow-web.yaml",
    "kubectl apply -f slow-web.yaml -n production",
    "kubectl set resources deployment/slow-web --requests=cpu=100m",
    "kubectl autoscale deployment/slow-web --min=1 --max=4",
    "sim kubernetes probe slow-web --kind=startup --status-code=200",
    "sim kubernetes probe slow-web --status-code=200",
    "sim kubernetes reconcile slow-web --cpu=250m",
  );
  const own = s.world.kubeDeployments.find(
    (d) => d.name === "slow-web" && d.namespace === "staging",
  );
  const other = s.world.kubeDeployments.find(
    (d) => d.name === "slow-web" && d.namespace === "production",
  );
  expect(own?.replicas).toBe(4);
  expect(other?.replicas).toBe(2);
  expect(other?.podStartup).toEqual([]);
  expect(other?.podReadiness).toEqual([]);
});

test("viewer can modify local context, but API and existing cluster get permission still apply", () => {
  const s = execute(
    ready(),
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:dev@example.com --role=roles/container.viewer",
    "gcloud auth login dev@example.com",
    "kubectl config set-context --current --namespace=staging",
    "kubectl get deployment web",
  );
  rejected(s, "kubectl scale deployment/web --replicas=2", "container.deployments.update");
  const disabled = execute(ready(), "gcloud services disable container.googleapis.com");
  rejected(disabled, "kubectl config set-context --current --namespace=staging", "disabled");
  const denied = execute(ready(), "gcloud auth login nobody@example.com");
  rejected(
    denied,
    "kubectl config set-context --current --namespace=staging",
    "container.clusters.get",
  );
});

test("cluster deletion removes only that context setting and recreating it starts with default", () => {
  const s = execute(
    configured(),
    "gcloud container clusters create other-gke --zone=us-central1-a",
    "kubectl config set-context --current --namespace=production",
    "gcloud container clusters delete context-gke --zone=us-central1-a --quiet",
  );
  expect(Object.values(s.world.kubeContextNamespaces)).toEqual(["production"]);
  const recreated = execute(s, "gcloud container clusters create context-gke --zone=us-central1-a");
  expect(KubeContext.namespace(recreated.world, selected(recreated))).toBe("default");
  expect(restore(recreated).world).toEqual(recreated.world);
});

test("Snapshot v19 round-trip preserves defaults and v18 migration preserves all namespaced state", () => {
  const s = execute(
    configured(),
    "sim files load kubernetes-startup",
    "kubectl apply -f slow-web.yaml",
    "sim kubernetes probe slow-web --kind=startup --status-code=503",
    "sim kubernetes probe slow-web --kind=startup --status-code=503",
    "sim kubernetes probe slow-web --kind=startup --status-code=503",
    "kubectl set resources deployment/web --requests=cpu=100m",
    "kubectl autoscale deployment/web --min=1 --max=3",
    "sim kubernetes reconcile web --cpu=250m",
  );
  expect(restore(s).world).toEqual(s.world);
  const snapshot = JSON.parse(JSON.stringify(Snapshot.create(s.world, Now)));
  snapshot.schemaVersion = 18;
  delete snapshot.world.kubeContextNamespaces;
  const world = Result.unwrap(Snapshot.fromUnknown(snapshot));
  expect(world).toEqual({ ...s.world, kubeContextNamespaces: {} });
  const migrated = session(world);
  expect(json(migrated, "kubectl get deployments -o json").items).toEqual([]);
  expect(json(migrated, "kubectl get deployments -n staging -o json").items).toHaveLength(2);
});

test.each([
  undefined,
  [],
  { missing: "staging" },
  { gke_ace_dev: "Bad" },
  { gke_ace_dev: "" },
  { gke_ace_dev: 1 },
])("invalid saved context mapping is rejected: %j", (mapping) => {
  const s = configured();
  const snapshot = JSON.parse(JSON.stringify(Snapshot.create(s.world, Now)));
  snapshot.world.kubeContextNamespaces =
    mapping && "gke_ace_dev" in mapping
      ? { [KubeContext.name(selected(s))]: mapping.gke_ace_dev }
      : mapping;
  expect(Result.isOk(Snapshot.fromUnknown(snapshot))).toBe(false);
});

test("context help/completion and tree describe explicitly target the selected namespace", () => {
  const s = configured();
  expect(Engine.completionCandidates(s.world, "kubectl config set-")).toContain("set-context");
  expect(Engine.completionCandidates(s.world, "kubectl config set-context gke_")).toContain(
    KubeContext.name(selected(s)),
  );
  expect(execute(s, "kubectl config --help").text).toContain("--current");
  for (const selection of [
    { kind: "kube-deployment" as const },
    { kind: "kube-service" as const },
    { kind: "kube-hpa" as const },
    { kind: "kube-config" as const, resourceKind: "configmap" as const },
  ]) {
    const command = Option.unwrap(
      TreeSelection.describeCommand({
        ...selection,
        projectId: "ace-dev-01",
        cluster: "context-gke",
        name: "web",
      }),
    );
    expect(command).toContain("--namespace=default");
  }
  const defaultResource = execute(s, "kubectl create deployment web --image=nginx:3 -n default");
  const command = Option.unwrap(
    TreeSelection.describeCommand({
      kind: "kube-deployment",
      projectId: "ace-dev-01",
      cluster: "context-gke",
      name: "web",
    }),
  );
  expect(execute(defaultResource, command).text).toContain("nginx:3");
});

test("mission requires independent updates, unchanged production revision and the final active namespace", () => {
  const id = "m-gke-016";
  const status = (s: Session) => s.world.missions.find((m) => m.id === id)?.status;
  const s = execute(
    session(Result.unwrap(Engine.startMission(session().world, id))),
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create context-gke --zone=us-central1-a",
    "kubectl create ns staging",
    "kubectl create ns production",
    "kubectl create deployment web --image=nginx:1 -n staging",
    "kubectl create deployment web --image=nginx:1 -n production",
    "kubectl config set-context --current --namespace=staging",
    "kubectl set image deployment/web web=nginx:2",
    "kubectl scale deployment/web --replicas=2",
  );
  expect(status(s)).toBe("in_progress");
  const wrong = execute(
    s,
    "kubectl set image deployment/web web=nginx:2 -n production",
    "kubectl config set-context --current --namespace=production",
  );
  expect(status(wrong)).toBe("in_progress");
  const restoredImage = execute(wrong, "kubectl set image deployment/web web=nginx:1");
  expect(status(restoredImage)).toBe("in_progress");
  const done = execute(restore(s), "kubectl config set-context --current --namespace=production");
  expect(status(done)).toBe("completed");
  expect(restore(done).world).toEqual(done.world);
});
