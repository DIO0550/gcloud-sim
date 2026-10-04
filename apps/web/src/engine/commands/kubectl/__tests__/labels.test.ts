// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { Now, run, type Session, session } from "@/engine/__tests__/setup";
import { KubeLabels } from "@/engine/domains/kube-labels";
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
    "gcloud container clusters create-auto labels-gke --region=us-central1",
    "sim files load kubernetes-labels",
    "kubectl apply -f shop-blue.yaml",
    "kubectl apply -f shop-green.yaml",
    "kubectl apply -f shop-service.yaml",
  );
const write = (s: Session, manifest: unknown) =>
  execute(s, `sim files write labels.json --content='${JSON.stringify(manifest)}'`);
const apply = (s: Session, manifest: unknown) =>
  execute(write(s, manifest), "kubectl apply -f labels.json");
const manifest = (
  s: Session,
  name = "shop-blue",
  track = "blue",
  podLabels: Record<string, string> = { app: "shop", track },
) => ({
  apiVersion: "apps/v1",
  kind: "Deployment",
  metadata: { name, labels: { team: "storefront" } },
  spec: {
    replicas: 2,
    selector: { matchLabels: { app: "shop", track } },
    template: {
      metadata: { labels: podLabels },
      spec: {
        containers: [
          { name, image: s.world.kubeDeployments.find((d) => d.name === name)?.image ?? "nginx:1" },
        ],
      },
    },
  },
});
const service = (selector: Record<string, string>) => ({
  apiVersion: "v1",
  kind: "Service",
  metadata: { name: "shop", labels: { team: "storefront" } },
  spec: { type: "LoadBalancer", selector, ports: [{ port: 80 }] },
});
const required = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error("Missing fixture resource");
  return value;
};
const backends = (s: Session) =>
  KubeServiceRouting.backends(s.world, required(s.world.kubeServices[0]));
const rejected = (s: Session, command: string, message: string) => {
  const next = run(s, command);
  expect(next.text).toContain(message);
  expect(next.world).toEqual(s.world);
};
const snapshot = (s: Session) => JSON.parse(JSON.stringify(Snapshot.create(s.world, Now)));

test("AND selectors switch stable Service addresses, combine Deployments and filter Pods by their labels", () => {
  const s = ready();
  expect(backends(s).map((b) => b.deployment)).toEqual(["shop-blue", "shop-blue"]);
  const green = apply(s, service({ app: "shop", track: "green" }));
  expect(backends(green).map((b) => b.deployment)).toEqual(["shop-green", "shop-green"]);
  expect(green.world.kubeServices[0]).toMatchObject({
    clusterIp: s.world.kubeServices[0]?.clusterIp,
    externalIp: s.world.kubeServices[0]?.externalIp,
    createdAt: s.world.kubeServices[0]?.createdAt,
  });
  expect(execute(green, "kubectl describe svc shop").text).toContain(
    required(backends(green)[0]).pod,
  );
  const both = apply(green, service({ app: "shop" }));
  expect(new Set(backends(both).map((b) => b.endpoint)).size).toBe(4);
  expect(backends(apply(both, service({ team: "storefront" })))).toEqual([]);
  expect(backends(apply(both, service({ app: "shop", absent: "" })))).toEqual([]);
  const pods = JSON.parse(
    execute(both, "kubectl get pods -l app=shop,track=green -o json").text,
  ).items;
  expect(pods).toHaveLength(2);
  expect(
    pods.every((p: { metadata: { labels: unknown } }) =>
      KubeLabels.matches(
        { app: "shop", track: "green" },
        p.metadata.labels as Record<string, string>,
      ),
    ),
  ).toBe(true);
  expect(execute(both, "kubectl get deployments -l app=shop").text).toContain("No resources");
  expect(
    JSON.parse(execute(both, "kubectl get deployments --selector=team==storefront -o json").text)
      .items,
  ).toHaveLength(2);
  expect(
    JSON.parse(execute(both, "kubectl get services -l team=storefront -o json").text).items,
  ).toHaveLength(1);
  expect(JSON.parse(execute(both, "kubectl get rs -l track=blue -o json").text).items).toHaveLength(
    1,
  );
});

test("metadata-only labels do not recreate Pods; Pod label revisions roll back with the template", () => {
  const s = ready();
  const before = required(s.world.kubeDeployments[0]);
  const m = manifest(s);
  const meta = apply(s, { ...m, metadata: { ...m.metadata, labels: { owner: "frontend" } } });
  expect(meta.world.kubeDeployments[0]).toEqual({ ...before, labels: { owner: "frontend" } });
  const changed = apply(
    meta,
    manifest(meta, "shop-blue", "blue", { app: "shop", track: "blue", release: "v2" }),
  );
  expect(changed.world.kubeDeployments[0]?.revision).toBe(2);
  expect(changed.world.kubeDeployments[0]?.revisions.at(-1)?.reason).toBe("labels");
  expect(
    execute(changed, "kubectl rollout history deployment/shop-blue --revision=2").text,
  ).toContain("release: v2");
  const routed = apply(changed, service({ release: "v2" }));
  expect(backends(routed)).toHaveLength(2);
  const undone = execute(
    routed,
    "kubectl scale deployment/shop-blue --replicas=3",
    "kubectl rollout undo deployment/shop-blue --to-revision=1",
  );
  expect(undone.world.kubeDeployments[0]).toMatchObject({
    replicas: 3,
    podLabels: { app: "shop", track: "blue" },
    revision: 3,
  });
  expect(backends(undone)).toEqual([]);
  expect(Result.unwrap(Snapshot.fromUnknown(snapshot(undone)))).toEqual(undone.world);
});

test("selector cannot change even when new template labels match, and file batches stay atomic", () => {
  const s = ready();
  const changed = write(s, manifest(s, "shop-blue", "other"));
  rejected(changed, "kubectl apply -f labels.json", "immutable");
  const batch = execute(
    s,
    `sim files write batch.yaml --content='${JSON.stringify(service({ app: "shop" }))}\n---\n${JSON.stringify(manifest(s, "shop-blue", "other"))}'`,
  );
  rejected(batch, "kubectl apply -f batch.yaml", "immutable");
  rejected(
    write(s, manifest(s, "shop-blue", "blue", { app: "shop", track: "green" })),
    "kubectl apply -f labels.json",
    "selector",
  );
});

test("map ordering is idempotent and expose uses the Deployment selector", () => {
  const s = ready();
  const m = manifest(s, "shop-blue", "blue", { track: "blue", app: "shop" });
  expect(apply(s, m).world.kubeDeployments).toEqual(s.world.kubeDeployments);
  expect(apply(s, service({ track: "blue", app: "shop" })).world.kubeServices).toEqual(
    s.world.kubeServices,
  );
  const exposed = execute(s, "kubectl expose deployment shop-green --name=green --port=80");
  const svc = required(exposed.world.kubeServices.find((s) => s.name === "green"));
  expect(svc.selector).toEqual({ app: "shop", track: "green" });
  expect(KubeServiceRouting.backends(exposed.world, svc).map((b) => b.deployment)).toEqual([
    "shop-green",
    "shop-green",
  ]);
});

test("Pod IPs remain unique at 1000 replicas across Deployments, including after snapshot reload", () => {
  const s = execute(
    apply(ready(), service({ app: "shop" })),
    "kubectl scale deployment/shop-blue --replicas=1000",
    "kubectl scale deployment/shop-green --replicas=1000",
  );
  expect(backends(s)).toHaveLength(2000);
  expect(new Set(backends(s).map((b) => b.endpoint)).size).toBe(2000);
  expect(Result.unwrap(Snapshot.fromUnknown(snapshot(s)))).toEqual(s.world);
  const names = s.world.kubeDeployments.flatMap(KubePod.fromDeployment);
  expect(
    names.every((p) => p.ip.split(".").every((part) => Number(part) >= 0 && Number(part) <= 255)),
  ).toBe(true);
});

test("routing excludes unready Pods and never crosses clusters", () => {
  const s = apply(ready(), service({ app: "shop" }));
  const bad = execute(
    s,
    "kubectl set image deployment/shop-blue shop-blue=us-central1-docker.pkg.dev/ace-dev-01/missing/app:v1",
  );
  expect(backends(bad).map((b) => b.deployment)).toEqual(["shop-green", "shop-green"]);
  const other = execute(
    bad,
    "gcloud container clusters create-auto other --region=us-central1",
    "kubectl apply -f shop-green.yaml",
  );
  expect(backends(other)).toHaveLength(2);
  const deleted = execute(
    other,
    "gcloud container clusters get-credentials labels-gke --region=us-central1",
    "kubectl delete deployment shop-green",
  );
  expect(backends(deleted)).toEqual([]);
});

test.each(["app in (shop)", "app!=shop", "app", "app=shop,app=other", "", "app=shop,"])(
  "invalid equality query is rejected: %s",
  (query) => rejected(ready(), `kubectl get pods -l '${query}'`, "error:"),
);
test.each(["kubectl get nodes -l app=shop", "kubectl get deployment shop-blue -l app=shop"])(
  "unsupported filter cannot silently succeed: %s",
  (cmd) => rejected(ready(), cmd, "--selector"),
);

test.each([
  {},
  { "bad key": "v" },
  { "UPPER.example/key": "v" },
  { "a/b/c": "v" },
  { app: true },
  { app: 2 },
  { app: "bad value" },
  { app: "-bad" },
  { ["a".repeat(64)]: "v" },
  { app: "a".repeat(64) },
])("invalid nonempty selector rejected: %j", (value) =>
  expect(Result.isOk(KubeLabels.parse(value, true))).toBe(false),
);
test("valid prefixed, empty and punctuation label values are applied and selectable", () => {
  const s = ready();
  const labels = {
    app: "shop",
    track: "blue",
    "example.com/Release": "v1.2_0-x",
    empty: "",
    constructor: "own",
  };
  const next = apply(s, manifest(s, "shop-blue", "blue", labels));
  expect(
    JSON.parse(
      execute(
        next,
        "kubectl get pods -l example.com/Release=v1.2_0-x,empty=,constructor=own -o json",
      ).text,
    ).items,
  ).toHaveLength(2);
  expect(KubeLabels.matches({ constructor: "own" }, {})).toBe(false);
});

test("v11 migration preserves files, managed config keys, runtime env and history while assigning unique Pod networks", () => {
  const s = execute(
    session(),
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create-auto old --region=us-central1",
    "sim files load kubernetes-config",
    "kubectl apply -f app-config.yaml",
    "kubectl create deployment one --image=nginx:1 --replicas=2",
    "kubectl create deployment two --image=nginx:1",
    "kubectl set env deployment/one --from=configmap/app-config",
    "kubectl set image deployment/one one=nginx:2",
    "kubectl expose deployment one --port=80",
  );
  const old = snapshot(s);
  old.schemaVersion = 11;
  for (const d of old.world.kubeDeployments) {
    delete d.labels;
    delete d.selector;
    delete d.podLabels;
    delete d.podNetwork;
    for (const r of d.revisions) delete r.podLabels;
  }
  for (const svc of old.world.kubeServices) {
    svc.targetDeployment = svc.selector.app;
    delete svc.selector;
    delete svc.labels;
  }
  const world = Result.unwrap(Snapshot.fromUnknown(old));
  expect(world).toEqual(s.world);
  expect(new Set(world.kubeDeployments.flatMap(KubePod.fromDeployment).map((p) => p.ip)).size).toBe(
    3,
  );
});

test.each(["selector", "podLabels", "history", "network", "service"])(
  "invalid v12 state is rejected: %s",
  (field) => {
    const snap = snapshot(ready());
    if (field === "selector") snap.world.kubeDeployments[0].selector = {};
    if (field === "podLabels") snap.world.kubeDeployments[0].podLabels = { app: "wrong" };
    if (field === "history")
      snap.world.kubeDeployments[0].revisions[0].podLabels = { app: "wrong" };
    if (field === "network")
      snap.world.kubeDeployments[1].podNetwork = snap.world.kubeDeployments[0].podNetwork;
    if (field === "service") snap.world.kubeServices[0].selector = {};
    expect(Result.isOk(Snapshot.fromUnknown(snap))).toBe(false);
  },
);

test("label mission requires green-only ready backends and applied files with both Deployments retained", () => {
  const id = "m-gke-007";
  const s = ready(session(Result.unwrap(Engine.startMission(session().world, id))));
  const status = (s: Session) => s.world.missions.find((m) => m.id === id)?.status;
  expect(status(s)).toBe("in_progress");
  const edit = execute(s, "sim files replace shop-service.yaml --search=blue --replacement=green");
  expect(status(edit)).toBe("in_progress");
  const wrong = execute(
    edit,
    "kubectl scale deployment/shop-green --replicas=1",
    "kubectl apply -f shop-service.yaml",
  );
  expect(status(wrong)).toBe("in_progress");
  const missing = execute(
    edit,
    "kubectl delete deployment shop-blue",
    "kubectl apply -f shop-service.yaml",
  );
  expect(status(missing)).toBe("in_progress");
  const complete = execute(
    session(Result.unwrap(Snapshot.fromUnknown(snapshot(edit)))),
    "kubectl apply -f shop-service.yaml",
  );
  expect(status(complete)).toBe("completed");
});
