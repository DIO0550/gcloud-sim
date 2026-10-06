// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { Now, run, type Session, session } from "@/engine/__tests__/setup";
import { MasterVersion, NextMasterVersion } from "@/engine/domains/managed-services";
import { World } from "@/engine/domains/world";
import { Snapshot } from "@/engine/snapshot";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const cluster = "--cluster=ops-gke --zone=us-central1-a";
const execute = (s: Session, ...commands: string[]) =>
  commands.reduce((s, c) => {
    const next = run(s, c);
    expect(next.text, c).not.toMatch(/^(ERROR:|error:)/m);
    expect(World.validate(next.world), c).toEqual(Result.ok(next.world));
    return next;
  }, s);
const rejected = (s: Session, c: string, message: string) => {
  const next = run(s, c);
  expect(next.text, c).toContain(message);
  expect(next.world).toEqual(s.world);
};
const ready = (s = session()) =>
  execute(
    s,
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create ops-gke --zone=us-central1-a --num-nodes=2",
    `gcloud container node-pools create apps ${cluster} --machine-type=e2-standard-4 --disk-size=200 --num-nodes=4`,
  );
const pool = (s: Session, name = "apps") => {
  const p = s.world.nodePools.find((p) => p.cluster === "ops-gke" && p.name === name);
  if (!p) throw Error("Missing pool fixture");
  return p;
};
const update = (flags: string, name = "apps") =>
  `gcloud container node-pools update ${name} ${cluster} ${flags}`;
const scale = (n: number, name = "apps") =>
  `sim gke autoscale-nodes ${name} ${cluster} --required-nodes=${n}`;
const restored = (s: Session) =>
  session(
    Result.unwrap(Snapshot.fromUnknown(JSON.parse(JSON.stringify(Snapshot.create(s.world, Now))))),
  );

test("default pool is stored, named resize affects only that pool and count includes all pools", () => {
  let s = ready();
  expect(pool(s, "default-pool").nodeCount).toBe(2);
  expect(s.world.clusters[0]?.nodeCount).toBe(6);
  s = execute(
    s,
    "gcloud container clusters resize ops-gke --zone=us-central1-a --node-pool=apps --num-nodes=3 --quiet",
  );
  expect(pool(s).nodeCount).toBe(3);
  expect(pool(s, "default-pool").nodeCount).toBe(2);
  expect(s.world.clusters[0]?.nodeCount).toBe(5);
  expect(execute(s, `gcloud container node-pools list ${cluster}`).text).toMatch(
    /apps\s+e2-standard-4\s+200/,
  );
});

test("master upgrade preserves pool versions; named upgrade affects one pool and survives restore", () => {
  let s = ready();
  s = execute(s, "gcloud container clusters upgrade ops-gke --zone=us-central1-a --master --quiet");
  expect(s.world.clusters[0]?.currentMasterVersion).toBe(NextMasterVersion);
  expect(pool(s).version).toBe(MasterVersion);
  expect(pool(s, "default-pool").version).toBe(MasterVersion);
  s = execute(
    restored(s),
    "gcloud container clusters upgrade ops-gke --zone=us-central1-a --node-pool=apps --quiet",
  );
  expect(pool(s).version).toBe(NextMasterVersion);
  expect(pool(s, "default-pool").version).toBe(MasterVersion);
  expect(restored(s).world).toEqual(s.world);
  rejected(
    s,
    "gcloud container clusters upgrade ops-gke --zone=us-central1-a --node-pool=apps --quiet",
    "already on version",
  );
  rejected(
    s,
    `gcloud container clusters upgrade ops-gke --zone=us-central1-a --node-pool=apps --cluster-version=${MasterVersion} --quiet`,
    "downgrades",
  );
});

test.each([
  ["--master --node-pool=apps", "cannot be combined"],
  ["", "explicit --node-pool"],
  ["--master --cluster-version=latest", "Supported master"],
  [`--node-pool=apps --cluster-version=${NextMasterVersion}`, "newer than the control plane"],
  ["--node-pool=ghost", "Not found"],
  ["--node-pool=apps --cluster-version=1.99", "Unsupported cluster-version"],
])("invalid upgrade %s preserves state", (flags, message) => {
  rejected(
    ready(),
    `gcloud container clusters upgrade ops-gke --zone=us-central1-a ${flags} --quiet`,
    message,
  );
});

test.each([
  ["--num-nodes=-1", "Node count"],
  ["--num-nodes=1001", "Node count"],
  ["--disk-size=9", "Disk size"],
  ["--disk-size=65537", "Disk size"],
  ["--machine-type=ghost", "machineTypes/ghost"],
  ["--enable-network-policy", "unrecognized"],
  ["--enable-autoscaling", "Autoscaling requires"],
  ["--enable-autoscaling --min-nodes=5 --max-nodes=4", "Autoscaling requires"],
  ["--min-nodes=1 --max-nodes=4", "require --enable-autoscaling"],
])("invalid pool create %s preserves state", (flags, message) => {
  rejected(ready(), `gcloud container node-pools create bad ${cluster} ${flags}`, message);
});

test.each([-1, 1001])("invalid cluster count %i is rejected", (n) => {
  const s = execute(session(), "gcloud services enable container.googleapis.com");
  rejected(
    s,
    `gcloud container clusters create bad --zone=us-central1-a --num-nodes=${n}`,
    "Node count",
  );
});

test.each([
  ["", "Specify autoscaling or"],
  ["--enable-autoscaling --max-nodes=0", "Autoscaling requires"],
  ["--enable-autoscaling --min-nodes=-1 --max-nodes=4", "Autoscaling requires"],
  ["--enable-autoscaling --min-nodes=5 --max-nodes=4", "Autoscaling requires"],
  ["--enable-autoscaling --max-nodes=1001", "Autoscaling requires"],
  ["--no-enable-autoscaling --max-nodes=4", "require --enable-autoscaling"],
  ["--max-nodes=4", "require --enable-autoscaling"],
  ["--enable-autoscaling --max-nodes=4 --enable-autorepair", "separate commands"],
  ["--machine-type=e2-medium", "unrecognized"],
])("invalid pool update %s preserves state", (flags, message) =>
  rejected(ready(), update(flags), message),
);

test("settings alone do not resize; each explicit demand clamps at both bounds", () => {
  let s = execute(ready(), update("--enable-autoscaling --min-nodes=1 --max-nodes=3"));
  expect(pool(s).nodeCount).toBe(4);
  expect(pool(s).lastScale).toEqual(Option.none);
  s = execute(s, scale(10));
  expect(pool(s).nodeCount).toBe(3);
  expect(pool(s).lastScale).toEqual(
    Option.some({ requiredNodes: 10, beforeNodes: 4, afterNodes: 3 }),
  );
  s = execute(restored(s), scale(0));
  expect(pool(s).nodeCount).toBe(1);
  s = execute(s, scale(2));
  expect(pool(s).nodeCount).toBe(2);
  expect(pool(s, "default-pool").nodeCount).toBe(2);
  expect(s.world.clusters[0]?.nodeCount).toBe(4);
  expect(s.text).toContain("No Pod scheduling");
  rejected(
    s,
    "gcloud container clusters resize ops-gke --zone=us-central1-a --node-pool=apps --num-nodes=2 --quiet",
    "Disable autoscaling",
  );
  s = execute(s, update("--no-enable-autoscaling"));
  expect(pool(s).lastScale).toEqual(Option.none);
  rejected(s, scale(3), "disabled");
  s = execute(
    s,
    "gcloud container clusters resize ops-gke --zone=us-central1-a --node-pool=apps --num-nodes=0 --quiet",
  );
  expect(pool(s).nodeCount).toBe(0);
});

test("partial bounds retain the other bound and zero minimum works; management changes retain evaluation", () => {
  let s = execute(ready(), update("--enable-autoscaling --min-nodes=0 --max-nodes=4"), scale(0));
  expect(pool(s).nodeCount).toBe(0);
  const before = pool(s).lastScale;
  s = execute(s, update("--no-enable-autorepair --no-enable-autoupgrade"));
  expect(pool(s).autoRepair).toBe(false);
  expect(pool(s).autoUpgrade).toBe(false);
  expect(pool(s).lastScale).toEqual(before);
  s = execute(s, update("--enable-autoscaling --max-nodes=6"));
  expect(pool(s).autoscaling).toEqual(Option.some({ minNodes: 0, maxNodes: 6 }));
  expect(pool(s).lastScale).toEqual(Option.none);
  expect(restored(s).world).toEqual(s.world);
});

test("pool creation can save autoscaling and management settings without evaluating", () => {
  const s = execute(
    ready(),
    `gcloud container node-pools create extra ${cluster} --num-nodes=0 --enable-autoscaling --min-nodes=1 --max-nodes=5 --no-enable-autorepair`,
  );
  const p = s.world.nodePools.find((p) => p.name === "extra");
  expect(p).toMatchObject({
    nodeCount: 0,
    autoRepair: false,
    autoUpgrade: true,
    lastScale: Option.none,
    autoscaling: Option.some({ minNodes: 1, maxNodes: 5 }),
  });
});

test.each([-1, 1000001])("invalid explicit demand %i preserves settings", (n) => {
  rejected(
    execute(ready(), update("--enable-autoscaling --max-nodes=4")),
    scale(n),
    "required-nodes",
  );
});

test("default pool updates/deletion are persistent and recreate is possible; Pods remain unchanged", () => {
  let s = execute(ready(), "kubectl create deployment web --image=nginx:1 --replicas=2");
  const deployments = s.world.kubeDeployments;
  s = execute(
    s,
    update("--enable-autoscaling --min-nodes=0 --max-nodes=2", "default-pool"),
    scale(0, "default-pool"),
  );
  expect(pool(s, "default-pool").nodeCount).toBe(0);
  s = execute(restored(s), `gcloud container node-pools delete default-pool ${cluster} --quiet`);
  expect(s.world.nodePools.map((p) => p.name)).toEqual(["apps"]);
  expect(restored(s).world.nodePools).toEqual(s.world.nodePools);
  expect(execute(s, `gcloud container node-pools list ${cluster}`).text).not.toContain(
    "default-pool",
  );
  s = execute(s, `gcloud container node-pools create default-pool ${cluster} --num-nodes=1`);
  expect(pool(s, "default-pool").nodeCount).toBe(1);
  expect(s.world.kubeDeployments).toEqual(deployments);
  s = execute(s, `gcloud container node-pools delete apps ${cluster} --quiet`);
  expect(s.world.clusters[0]?.nodeCount).toBe(1);
  rejected(s, `gcloud container node-pools delete apps ${cluster} --quiet`, "Not found");
});

test("namespace-independent pool commands validate project, location, API and principal permissions", () => {
  const s = ready();
  rejected(
    s,
    "gcloud container node-pools update apps --cluster=ops-gke --zone=us-central1-b --enable-autorepair",
    "Not found",
  );
  rejected(
    s,
    `gcloud container node-pools update apps ${cluster} --region=us-central1 --enable-autorepair`,
    "either --zone or --region",
  );
  rejected(
    s,
    `gcloud container node-pools update apps ${cluster} --project=ace-prod-01 --enable-autorepair`,
    "container.googleapis.com",
  );
  const reader = execute(s, "gcloud auth login developer@example.com");
  rejected(reader, update("--enable-autoscaling --max-nodes=4"), "container.clusters.update");
  rejected(reader, scale(3), "container.clusters.update");
  rejected(
    reader,
    `gcloud container node-pools delete apps ${cluster} --quiet`,
    "container.clusters.update",
  );
  const off = execute(s, "gcloud services disable container.googleapis.com --quiet");
  rejected(off, update("--enable-autorepair"), "container.googleapis.com");
});

test("Autopilot refuses user-managed pool operations and has no stored default pool", () => {
  const s = execute(
    session(),
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create-auto auto --region=us-central1",
  );
  expect(s.world.nodePools).toEqual([]);
  for (const c of [
    "gcloud container node-pools create bad --cluster=auto --region=us-central1",
    "gcloud container node-pools update bad --cluster=auto --region=us-central1 --enable-autorepair",
    "gcloud container node-pools delete bad --cluster=auto --region=us-central1 --quiet",
    "sim gke autoscale-nodes bad --cluster=auto --region=us-central1 --required-nodes=3",
    "gcloud container clusters upgrade auto --region=us-central1 --node-pool=bad --quiet",
  ])
    rejected(s, c, "Autopilot");
});

test("v26 migration materializes old default and retains custom settings and Ingress/network/storage data", () => {
  const s = execute(
    ready(),
    "sim files load kubernetes-ingress",
    "kubectl apply -f ingress-workloads.yaml",
    "kubectl apply -f ingress-routes.json",
    "sim files load kubernetes-network-policy",
    "kubectl apply -f deny-ingress.json",
    "sim files load kubernetes-storage",
    "kubectl apply -f archive-class.yaml",
    "kubectl apply -f storage-claim.yaml",
    "kubectl apply -f storage-web.yaml",
    "sim kubernetes write-file storage-web --path=/data/saved.txt --content=retained",
  );
  expect(s.world.kubeNetworkPolicies.length).toBeGreaterThan(0);
  expect(s.world.kubePvs.length).toBeGreaterThan(0);
  const old = JSON.parse(JSON.stringify(Snapshot.create(s.world, Now)));
  old.schemaVersion = 26;
  old.world.nodePools = old.world.nodePools
    .filter((p: { name: string }) => p.name !== "default-pool")
    .map((p: Record<string, unknown>) => {
      const { autoRepair, autoUpgrade, autoscaling, lastScale, ...legacy } = p;
      return legacy;
    });
  old.world.clusters[0].nodeCount = 2;
  const next = Result.unwrap(Snapshot.fromUnknown(old));
  expect(next.nodePools).toEqual(s.world.nodePools);
  expect(next.clusters).toEqual(s.world.clusters);
  expect(next.kubeIngresses).toEqual(s.world.kubeIngresses);
  expect(next.kubeDeployments).toEqual(s.world.kubeDeployments);
  expect(next.kubeNetworkPolicies).toEqual(s.world.kubeNetworkPolicies);
  expect(next.kubePvs).toEqual(s.world.kubePvs);
  expect(Snapshot.create(next, Now).schemaVersion).toBe(30);
});

test.each(["count", "bounds", "newer", "evaluation", "autopilot"])(
  "invalid snapshot %s is rejected",
  (kind) => {
    const json = JSON.parse(JSON.stringify(Snapshot.create(ready().world, Now)));
    const p = json.world.nodePools[1];
    if (kind === "count") p.nodeCount = -1;
    if (kind === "bounds") p.autoscaling = Option.some({ minNodes: 5, maxNodes: 4 });
    if (kind === "newer") p.version = NextMasterVersion;
    if (kind === "evaluation")
      p.lastScale = Option.some({ requiredNodes: 10, beforeNodes: 2, afterNodes: 4 });
    if (kind === "autopilot") json.world.clusters[0].autopilot = true;
    expect(Result.isOk(Snapshot.fromUnknown(json))).toBe(false);
  },
);

test("upgrade mission rejects master-only and wrong pool changes, then completes after exact named upgrade", () => {
  let s = ready(session(Result.unwrap(Engine.startMission(session().world, "m-gke-028"))));
  const status = (s: Session) => s.world.missions.find((m) => m.id === "m-gke-028")?.status;
  expect(status(s)).not.toBe("completed");
  s = execute(
    s,
    "gcloud container clusters resize ops-gke --zone=us-central1-a --node-pool=apps --num-nodes=3 --quiet",
    "gcloud container clusters upgrade ops-gke --zone=us-central1-a --master --quiet",
  );
  expect(status(s)).not.toBe("completed");
  s = execute(
    s,
    "gcloud container clusters resize ops-gke --zone=us-central1-a --num-nodes=3 --quiet",
    "gcloud container clusters upgrade ops-gke --zone=us-central1-a --node-pool=apps --quiet",
  );
  expect(status(s)).not.toBe("completed");
  s = execute(
    s,
    "gcloud container clusters resize ops-gke --zone=us-central1-a --num-nodes=2 --quiet",
  );
  expect(status(s)).toBe("completed");
});

test("autoscaling mission requires management, bounds and a matching explicit evaluation", () => {
  let s = execute(
    session(Result.unwrap(Engine.startMission(session().world, "m-gke-029"))),
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create autoscale-gke --zone=us-central1-a --num-nodes=2",
    "gcloud container node-pools create apps --cluster=autoscale-gke --zone=us-central1-a --num-nodes=1 --no-enable-autorepair --no-enable-autoupgrade",
    "gcloud container node-pools update apps --cluster=autoscale-gke --zone=us-central1-a --enable-autoscaling --min-nodes=1 --max-nodes=4",
    "sim gke autoscale-nodes apps --cluster=autoscale-gke --zone=us-central1-a --required-nodes=10",
  );
  const status = (s: Session) => s.world.missions.find((m) => m.id === "m-gke-029")?.status;
  expect(status(s)).not.toBe("completed");
  s = execute(
    s,
    "gcloud container node-pools update apps --cluster=autoscale-gke --zone=us-central1-a --enable-autorepair --enable-autoupgrade",
  );
  expect(status(s)).toBe("completed");
  let settings = execute(
    session(Result.unwrap(Engine.startMission(session().world, "m-gke-029"))),
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create autoscale-gke --zone=us-central1-a --num-nodes=2",
    "gcloud container node-pools create apps --cluster=autoscale-gke --zone=us-central1-a --num-nodes=4 --enable-autoscaling --min-nodes=1 --max-nodes=4",
  );
  expect(status(settings)).not.toBe("completed");
  settings = execute(
    settings,
    "sim gke autoscale-nodes apps --cluster=autoscale-gke --zone=us-central1-a --required-nodes=3",
  );
  expect(status(settings)).not.toBe("completed");
});
