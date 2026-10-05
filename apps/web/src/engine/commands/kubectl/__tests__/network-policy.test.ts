// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { Now, run, type Session, session } from "@/engine/__tests__/setup";
import { KubeNetworkPolicy } from "@/engine/domains/kube-network-policy";
import { KubeServiceRouting } from "@/engine/domains/kube-service-routing";
import { KubePod } from "@/engine/domains/kubernetes";
import { World } from "@/engine/domains/world";
import { kubeNetworkSatisfied } from "@/engine/missions/kube-network-policy";
import { TreeSelection } from "@/engine/resource-tree";
import { Snapshot } from "@/engine/snapshot";
import { Result } from "@/utils/Result";

const required = <T>(v: T | undefined): T => {
  if (v === undefined) throw new Error("Missing test fixture");
  return v;
};
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
const ready = (standard = false, enabled = false) =>
  execute(
    session(),
    "gcloud services enable container.googleapis.com",
    `gcloud container clusters ${standard ? "create" : "create-auto"} policy-gke --region=us-central1${enabled ? " --enable-network-policy" : ""}`,
    "sim files load kubernetes-network-policy",
    "kubectl apply -f network-workloads.yaml",
  );
const deny = (s = ready()) =>
  execute(s, "kubectl apply -f deny-ingress.json", "kubectl apply -f deny-egress.json");
const repairedIngress = (s: Session) => {
  const fixed = s.world.kubeFiles["allow-ingress.json"]?.includes("wrong-client")
    ? execute(s, "sim files replace allow-ingress.json --search=wrong-client --replacement=client")
    : s;
  return execute(fixed, "kubectl apply -f allow-ingress.json");
};
const repaired = (s = deny()) =>
  execute(
    repairedIngress(s),
    "sim files replace allow-egress.json --search=wrong-backend --replacement=backend",
    "kubectl apply -f allow-egress.json",
  );
const connect = (s: Session, source = "client", target = "backend", port = 8080) =>
  execute(s, `sim kubernetes connect ${source} --to=${target} --port=${port}`);
const blocked = (
  s: Session,
  source = "client",
  target = "backend",
  port = 8080,
  direction = "DENIED",
) => rejected(s, `sim kubernetes connect ${source} --to=${target} --port=${port}`, direction);
const json = (s: Session, c: string) => JSON.parse(execute(s, c).text);
const policy = (spec: unknown, name = "custom", ns?: string) => ({
  apiVersion: "networking.k8s.io/v1",
  kind: "NetworkPolicy",
  metadata: { name, ...(ns ? { namespace: ns } : {}) },
  spec,
});
const write = (s: Session, p: unknown, path = "policy.json") =>
  execute(s, `sim files write ${path} --content='${JSON.stringify(p)}'`);
const apply = (s: Session, spec: unknown, name = "custom", ns?: string) =>
  execute(write(s, policy(spec, name, ns)), "kubectl apply -f policy.json");
const restored = (s: Session) =>
  session(
    Result.unwrap(Snapshot.fromUnknown(JSON.parse(JSON.stringify(Snapshot.create(s.world, Now))))),
  );
const cross = () =>
  execute(
    ready(),
    "kubectl apply -f network-namespaces.yaml",
    "kubectl apply -f cross-workloads.yaml",
    "kubectl apply -f cross-deny.yaml",
  );
const crossCommand = (fromNs = "client-ns", to = "backend", port = 8080) =>
  `sim kubernetes connect client -n ${fromNs} --to=${to} --to-namespace=data-ns --port=${port}`;
const repairedCross = (s: Session) =>
  execute(
    s,
    "sim files replace cross-ingress.json --search=wrong-client --replacement=client",
    "kubectl apply -f cross-ingress.json",
    "sim files replace cross-egress.json --search=wrong-backend --replacement=backend",
    "kubectl apply -f cross-egress.json",
  );

test("no matching policies permit a new TCP connection without changing the world", () => {
  const s = ready();
  const next = connect(s);
  expect(next.text).toContain("not isolated");
  expect(next.text).toContain("No real connection");
  expect(next.world).toEqual(s.world);
});
test("Ingress and Egress isolate independently and both directions must permit the connection", () => {
  const s = deny();
  blocked(s, "client", "backend", 8080, "Egress: DENIED");
  const incoming = repairedIngress(s);
  blocked(incoming, "client", "backend", 8080, "Egress: DENIED");
  expect(run(incoming, "sim kubernetes connect client --to=backend --port=8080").text).toContain(
    "Ingress: ALLOWED",
  );
  const done = repaired(incoming);
  expect(connect(done).text).toContain("ALLOWED (simulated TCP)");
  blocked(done, "intruder");
  blocked(done, "client", "intruder");
  blocked(done, "client", "backend", 8081);
});
test("default deny and allow policies are additive and deleting an allow removes only that permission", () => {
  const s = repaired();
  expect(connect(s).text).toContain("selected by allow-backend, deny-client");
  const oneRemoved = execute(s, "kubectl delete netpol allow-client");
  blocked(oneRemoved, "client", "backend", 8080, "Ingress: DENIED");
  const permissive = apply(
    oneRemoved,
    { podSelector: {}, policyTypes: ["Ingress"], ingress: [{}] },
    "allow-all",
  );
  connect(permissive);
  expect(World.validate(restored(permissive).world)).toEqual(Result.ok(permissive.world));
});
test("Standard stores policies without enforcement until created with the enforcement flag; Autopilot is enabled", () => {
  const off = deny(ready(true));
  expect(required(off.world.clusters[0]).networkPolicyEnabled).toBe(false);
  expect(connect(off).text).toContain("enforcement is disabled");
  blocked(deny(ready(true, true)));
  expect(required(ready().world.clusters[0]).networkPolicyEnabled).toBe(true);
  expect(
    json(off, "gcloud container clusters describe policy-gke --region=us-central1 --format=json")
      .networkPolicy.enabled,
  ).toBe(false);
});
test("create/apply preserve identity, replace selectors/rules and support aliases and metadata label filtering", () => {
  let s = ready();
  s = execute(s, "kubectl create -f deny-ingress.json");
  rejected(s, "kubectl create -f deny-ingress.json", "already exists");
  expect(execute(s, "kubectl apply -f deny-ingress.json").text).toContain("unchanged");
  s = apply(s, { podSelector: { matchLabels: { app: "backend" } }, ingress: [{}] }, "deny-backend");
  expect(required(s.world.kubeNetworkPolicies[0]).createdAt).toBe(Now);
  connect(s);
  const record = json(s, "kubectl get networkpolicies.networking.k8s.io deny-backend -o json");
  expect(record.kind).toBe("NetworkPolicy");
  expect(record.spec.policyTypes).toEqual(["Ingress"]);
  expect(execute(s, "kubectl describe netpol/deny-backend").text).toContain("selectedPods");
  expect(execute(s, "kubectl get netpol -l team=missing").text).not.toContain("deny-backend");
  expect(execute(s, "kubectl get all").text).not.toContain("deny-backend");
});
test("empty policy selector targets every Pod only in its own namespace", () => {
  const s = apply(
    cross(),
    { podSelector: {}, policyTypes: ["Egress"] },
    "deny-everything",
    "other-ns",
  );
  rejected(s, crossCommand("other-ns"), "Egress: DENIED");
  const other = required(s.world.kubeDeployments.find((d) => d.namespace === "other-ns"));
  expect(
    KubeNetworkPolicy.selectedPods(
      s.world,
      required(s.world.kubeNetworkPolicies.find((p) => p.name === "deny-everything")),
    ).map((p) => p.name),
  ).toEqual(KubePod.fromDeployment(other).map((p) => p.name));
});
test("namespaceSelector and podSelector in one peer require AND; separate peers permit OR", () => {
  const s = repairedCross(cross());
  execute(s, crossCommand());
  rejected(s, crossCommand("other-ns"), "Ingress: DENIED");
  rejected(s, crossCommand("client-ns", "intruder"), "Egress: DENIED");
  const ingress = {
    podSelector: { matchLabels: { app: "backend" } },
    policyTypes: ["Ingress"],
    ingress: [
      {
        from: [
          { namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "client-ns" } } },
          { podSelector: { matchLabels: { app: "client" } } },
        ],
      },
    ],
  };
  const nsOrLocal = apply(s, ingress, "allow-client", "data-ns");
  rejected(nsOrLocal, crossCommand("other-ns"), "Ingress: DENIED");
  const everywhere = apply(
    nsOrLocal,
    {
      ...ingress,
      ingress: [
        { from: [{ namespaceSelector: {} }, { podSelector: { matchLabels: { app: "client" } } }] },
      ],
    },
    "allow-client",
    "data-ns",
  );
  execute(everywhere, crossCommand("other-ns"));
});
test("a podSelector-only peer remains in the policy namespace; empty peer selects all namespaces", () => {
  let s = cross();
  s = apply(
    s,
    { podSelector: {}, policyTypes: ["Ingress"], ingress: [{ from: [{ podSelector: {} }] }] },
    "allow-client",
    "data-ns",
  );
  rejected(s, crossCommand("other-ns"), "Ingress: DENIED");
  s = apply(
    s,
    { podSelector: {}, policyTypes: ["Ingress"], ingress: [{ from: [{}] }] },
    "allow-client",
    "data-ns",
  );
  execute(s, crossCommand("other-ns"));
});
test("empty from/to/ports arrays are unrestricted within a rule; omitted rules deny", () => {
  let s = deny();
  s = apply(
    s,
    { podSelector: {}, policyTypes: ["Ingress"], ingress: [{ from: [], ports: [] }] },
    "all-in",
  );
  s = apply(
    s,
    { podSelector: {}, policyTypes: ["Egress"], egress: [{ to: [], ports: [] }] },
    "all-out",
  );
  connect(s, "intruder", "backend", 65535);
});
test("a rule needs both its peer and destination port to match; rules and ports are unions", () => {
  let s = deny();
  s = apply(s, { podSelector: {}, policyTypes: ["Egress"], egress: [{}] }, "all-out");
  s = apply(s, {
    podSelector: { matchLabels: { app: "backend" } },
    ingress: [
      {
        from: [{ podSelector: { matchLabels: { app: "client" } } }],
        ports: [{ port: 8080 }, { port: 8081 }],
      },
      { from: [{ podSelector: { matchLabels: { app: "intruder" } } }], ports: [{ port: 9090 }] },
    ],
  });
  connect(s, "client", "backend", 8081);
  blocked(s, "intruder", "backend", 8080);
  connect(s, "intruder", "backend", 9090);
  blocked(s, "client", "backend", 9090);
});
test("policyTypes default to Ingress plus Egress for nonempty egress rules; explicit Egress leaves Ingress open", () => {
  let s = apply(ready(), { podSelector: { matchLabels: { app: "backend" } }, egress: [{}] });
  expect(required(s.world.kubeNetworkPolicies[0]).policyTypes).toEqual(["Ingress", "Egress"]);
  blocked(s);
  s = apply(s, {
    podSelector: { matchLabels: { app: "backend" } },
    policyTypes: ["Egress"],
    egress: [{}],
  });
  connect(s);
});
test("a Pod cannot block communication with itself", () => {
  const s = apply(ready(), { podSelector: {}, policyTypes: ["Ingress", "Egress"] });
  expect(connect(s, "client", "client").text).toContain("itself");
});
test("individual Pod recreation preserves policies and policy changes do not restart Pods", () => {
  let s = repaired();
  const before = s.world.kubeDeployments;
  s = apply(s, { podSelector: { matchLabels: { app: "backend" } }, ingress: [{}] }, "extra");
  expect(s.world.kubeDeployments).toEqual(before);
  const source = required(s.world.kubeDeployments.find((d) => d.name === "client"));
  s = execute(s, `kubectl delete pod ${required(KubePod.fromDeployment(source)[0]).name}`);
  connect(s);
  expect(restored(s).world.kubeNetworkPolicies).toEqual(s.world.kubeNetworkPolicies);
});
test("denied connections preserve Ready, Service backends, revisions and saved data", () => {
  const s = execute(deny(), "kubectl expose deployment backend --port=80 --target-port=8080");
  const service = required(s.world.kubeServices[0]);
  expect(KubeServiceRouting.backends(s.world, service)).toHaveLength(1);
  blocked(s);
  expect(execute(s, "kubectl get pods").text).toContain("1/1");
  expect(KubeServiceRouting.backends(s.world, service)).toHaveLength(1);
});
test("namespace/cluster deletion cleans their policies; identical names stay isolated", () => {
  let s = cross();
  s = apply(s, { podSelector: {}, policyTypes: ["Ingress"] }, "same", "other-ns");
  s = apply(s, { podSelector: {}, policyTypes: ["Ingress"] }, "same", "client-ns");
  expect(execute(s, "kubectl get netpol -A").text).toContain("other-ns");
  s = execute(s, "kubectl delete namespace other-ns");
  expect(s.world.kubeNetworkPolicies.some((p) => p.namespace === "other-ns")).toBe(false);
  s = execute(s, "gcloud container clusters create-auto another --region=us-central1");
  s = apply(s, { podSelector: {}, policyTypes: ["Ingress"] }, "same");
  s = execute(s, "gcloud container clusters delete policy-gke --region=us-central1 --quiet");
  expect(s.world.kubeNetworkPolicies.map((p) => p.cluster)).toEqual(["another"]);
  expect(restored(s).world).toEqual(s.world);
});
test("viewer reads policies, developer manages them, and connection helper needs exec; API is required", () => {
  let s = deny();
  s = execute(
    s,
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:viewer@example.com --role=roles/container.viewer",
    "gcloud auth login viewer@example.com",
  );
  execute(s, "kubectl get netpol", "kubectl describe netpol deny-backend");
  rejected(s, "kubectl apply -f deny-ingress.json", "container.networkPolicies.update");
  rejected(s, "kubectl delete netpol deny-backend", "container.networkPolicies.delete");
  rejected(s, "sim kubernetes connect client --to=backend --port=8080", "container.pods.exec");
  s = execute(
    s,
    "gcloud auth login owner@example.com",
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:writer@example.com --role=roles/container.developer",
    "gcloud auth login writer@example.com",
  );
  execute(s, "kubectl delete netpol deny-backend", "kubectl apply -f allow-ingress.json");
  s = execute(
    s,
    "gcloud auth login owner@example.com",
    "gcloud services disable container.googleapis.com",
  );
  rejected(s, "kubectl get netpol", "container.googleapis.com");
  rejected(s, "sim kubernetes connect client --to=backend --port=8080", "container.googleapis.com");
});
test("a mixed manifest failure is atomic including an earlier policy", () => {
  const source =
    JSON.stringify(policy({ podSelector: {}, policyTypes: ["Ingress"] })) +
    "\n---\n" +
    JSON.stringify({
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: { name: "missing-ns", namespace: "missing" },
      data: {},
    });
  const s = execute(ready(), `sim files write mixed.yaml --content='${source}'`);
  rejected(s, "kubectl apply -f mixed.yaml", "namespaces");
  expect(s.world.kubeNetworkPolicies).toEqual([]);
});
test.each([
  { podSelector: { matchExpressions: [] } },
  { podSelector: { matchLabels: null } },
  { podSelector: {}, ingress: [{ from: [{ ipBlock: { cidr: "0.0.0.0/0" } }] }] },
  {
    podSelector: {},
    ingress: [{ from: [{ namespaceSelector: { matchLabels: { team: "blue" } } }] }],
  },
  { podSelector: {}, ingress: [{ ports: [{ port: "http" }] }] },
  { podSelector: {}, ingress: [{ ports: [{ protocol: "UDP", port: 53 }] }] },
  { podSelector: {}, ingress: [{ ports: [{ port: 0 }] }] },
  { podSelector: {}, ingress: [{ ports: [{ port: 65536 }] }] },
  { podSelector: {}, ingress: [{ ports: [{ port: 80, endPort: 90 }] }] },
  { podSelector: {}, policyTypes: ["Bogus"] },
  { podSelector: {}, policyTypes: [] },
  { podSelector: {}, policyTypes: ["Egress"], ingress: [{}] },
])("unsupported or malformed spec %# is refused without applying", (spec) => {
  const s = write(ready(), policy(spec));
  rejected(s, "kubectl apply -f policy.json", "error:");
});
test.each([
  "",
  "--to=backend",
  "--to=backend --port=0",
  "--to=backend --port=65536",
  "--to=missing --port=8080",
  "--to=backend --port=8080 --to-namespace=missing",
])("invalid connection flags %s do not mutate the world", (flags) => {
  rejected(ready(), `sim kubernetes connect client ${flags}`, "ERROR:");
});
test("connection requires actual Pods and rejects waiting containers", () => {
  const zero = execute(ready(), "kubectl scale deployment/client --replicas=0");
  rejected(zero, "sim kubernetes connect client --to=backend --port=8080", "0 replicas");
  const waiting = execute(
    ready(),
    "kubectl set image deployment/client client=us-central1-docker.pkg.dev/ace-dev-01/missing/app:v1",
  );
  rejected(waiting, "sim kubernetes connect client --to=backend --port=8080", "ImagePull");
});
test("Snapshot v25 roundtrip preserves policies and v24 migration keeps PVC files and deployment state", () => {
  let s = execute(
    repaired(),
    "sim files load kubernetes-storage",
    "kubectl apply -f archive-class.yaml",
    "kubectl apply -f storage-claim.yaml",
    "kubectl apply -f storage-web.yaml",
    "sim kubernetes write-file storage-web --path=/data/x --content=keep",
  );
  expect(Snapshot.create(s.world, Now).schemaVersion).toBe(27);
  expect(restored(s).world).toEqual(s.world);
  const raw = JSON.parse(JSON.stringify(Snapshot.create(s.world, Now)));
  raw.schemaVersion = 24;
  delete raw.world.kubeNetworkPolicies;
  for (const c of raw.world.clusters) delete c.networkPolicyEnabled;
  const migrated = Result.unwrap(Snapshot.fromUnknown(raw));
  expect(migrated.kubePvs).toEqual(s.world.kubePvs);
  expect(migrated.kubeDeployments).toEqual(s.world.kubeDeployments);
  expect(migrated.kubeNetworkPolicies).toEqual([]);
  s = execute(session(migrated), "kubectl exec deployment/storage-web -- cat /data/x");
  expect(s.text).toBe("keep");
});
test.each(["port", "direction", "namespace", "enforcement"])(
  "invalid saved %s is rejected",
  (field) => {
    const raw = JSON.parse(JSON.stringify(Snapshot.create(repaired().world, Now)));
    const p = required(
      raw.world.kubeNetworkPolicies.find((p: { name: string }) => p.name === "allow-client"),
    );
    if (field === "port") p.ingress[0].ports[0] = -1;
    if (field === "direction") p.policyTypes = ["Wrong"];
    if (field === "namespace") p.namespace = "missing";
    if (field === "enforcement") raw.world.clusters[0].networkPolicyEnabled = false;
    expect(Result.isOk(Snapshot.fromUnknown(raw))).toBe(false);
  },
);
test("help and completion expose policy names and the connection helper; tree describe preserves namespace", () => {
  const s = deny();
  expect(Engine.completionCandidates(s.world, "kubectl get netp")).toContain("netpol");
  expect(Engine.completionCandidates(s.world, "kubectl get netpol deny-")).toContain(
    "deny-backend",
  );
  expect(execute(s, "sim kubernetes connect --help").text).toContain("--to-namespace");
  expect(
    TreeSelection.describeCommand({
      kind: "kube-network-policy",
      projectId: "ace-dev-01",
      cluster: "policy-gke",
      namespace: "data-ns",
      name: "allow-client",
    }),
  ).toEqual({ some: true, value: "kubectl describe netpol allow-client --namespace=data-ns" });
});
test("same-namespace mission requires both applied allow files and retained deny policies", () => {
  let s = session(Result.unwrap(Engine.startMission(ready().world, "m-gke-024")));
  s = deny(s);
  const status = (s: Session) => s.world.missions.find((m) => m.id === "m-gke-024")?.status;
  s = execute(s, "sim files replace allow-ingress.json --search=wrong-client --replacement=client");
  expect(status(s)).not.toBe("completed");
  s = repairedIngress(s);
  expect(status(s)).not.toBe("completed");
  s = repaired(s);
  expect(status(s)).toBe("completed");
  expect(connect(s).text).toContain("ALLOWED");
});
test("cross-namespace mission only clears after both namespace+Pod selectors are correctly applied", () => {
  let s = session(Result.unwrap(Engine.startMission(session().world, "m-gke-025")));
  s = execute(
    s,
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create-auto policy-ns-gke --region=us-central1",
    "sim files load kubernetes-network-policy",
    "kubectl apply -f network-namespaces.yaml",
    "kubectl apply -f cross-workloads.yaml",
    "kubectl apply -f cross-deny.yaml",
  );
  expect(s.world.missions.find((m) => m.id === "m-gke-025")?.status).not.toBe("completed");
  s = repairedCross(s);
  expect(s.world.missions.find((m) => m.id === "m-gke-025")?.status).toBe("completed");
  execute(s, crossCommand());
  rejected(s, crossCommand("other-ns"), "DENIED");
});

const deployment = (name: string, labels: Record<string, string> = {}, readiness = false) => ({
  apiVersion: "apps/v1",
  kind: "Deployment",
  metadata: { name },
  spec: {
    replicas: 1,
    selector: { matchLabels: { app: name } },
    template: {
      metadata: { labels: { app: name, ...labels } },
      spec: {
        containers: [
          {
            name,
            image: "nginx:1",
            ...(readiness
              ? { readinessProbe: { httpGet: { path: "/ready", port: 8080 }, failureThreshold: 1 } }
              : {}),
          },
        ],
      },
    },
  },
});
test("Pod template label changes and undo immediately alter matching permissions without changing policy rules", () => {
  let s = apply(
    repaired(),
    {
      podSelector: { matchLabels: { app: "backend" } },
      policyTypes: ["Ingress"],
      ingress: [
        {
          from: [{ podSelector: { matchLabels: { app: "client", team: "trusted" } } }],
          ports: [{ port: 8080 }],
        },
      ],
    },
    "allow-client",
  );
  blocked(s);
  s = execute(
    write(s, deployment("client", { team: "trusted" }), "client.json"),
    "kubectl apply -f client.json",
  );
  connect(s);
  s = execute(s, "kubectl rollout undo deployment/client");
  blocked(s);
});
test("readiness failure removes Service endpoints but a direct Pod network decision remains independent", () => {
  let s = execute(
    write(ready(), deployment("backend", {}, true), "backend.json"),
    "kubectl apply -f backend.json",
    "kubectl expose deployment backend --port=80 --target-port=8080",
    "sim kubernetes probe backend --status-code=503",
  );
  const service = required(s.world.kubeServices[0]);
  expect(KubeServiceRouting.backends(s.world, service)).toEqual([]);
  s = connect(s);
  expect(s.text).toContain("ALLOWED");
});
test("a permissive policy cannot satisfy the restricted mission", () => {
  let s = session(Result.unwrap(Engine.startMission(ready().world, "m-gke-024")));
  s = repaired(deny(s));
  const policySpec = {
    podSelector: {},
    policyTypes: ["Ingress", "Egress"],
    ingress: [{}],
    egress: [{}],
  };
  const permissive = apply(s, policySpec, "permit-all");
  expect(kubeNetworkSatisfied(permissive.world, false)).toBe(false);
});

test("the mission requires default deny policies to still select their intended Pods", () => {
  const s = repaired();
  expect(kubeNetworkSatisfied(s.world, false)).toBe(true);
  const file = JSON.parse(required(s.world.kubeFiles["deny-ingress.json"]));
  file.spec.podSelector.matchLabels.app = "unselected";
  const changed = execute(
    write(s, file, "deny-ingress.json"),
    "kubectl apply -f deny-ingress.json",
  );
  connect(changed);
  expect(kubeNetworkSatisfied(changed.world, false)).toBe(false);
});

test("the namespace mission rejects split OR peers even when no existing Pod exposes their broader scope", () => {
  let s = execute(
    session(),
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create-auto policy-ns-gke --region=us-central1",
    "sim files load kubernetes-network-policy",
    "kubectl apply -f network-namespaces.yaml",
    "kubectl apply -f cross-workloads.yaml",
    "kubectl apply -f cross-deny.yaml",
  );
  s = repairedCross(s);
  expect(kubeNetworkSatisfied(s.world, true)).toBe(true);
  const file = JSON.parse(required(s.world.kubeFiles["cross-ingress.json"]));
  file.spec.ingress[0].from = [
    { namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "client-ns" } } },
    { podSelector: { matchLabels: { app: "client" } } },
  ];
  s = execute(write(s, file, "cross-ingress.json"), "kubectl apply -f cross-ingress.json");
  execute(s, crossCommand());
  rejected(s, crossCommand("other-ns"), "DENIED");
  expect(kubeNetworkSatisfied(s.world, true)).toBe(false);
});
