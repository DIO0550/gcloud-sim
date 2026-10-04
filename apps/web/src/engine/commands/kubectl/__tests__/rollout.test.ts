// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { Now, run, type Session, session } from "@/engine/__tests__/setup";
import { KubeDeployment, KubePod } from "@/engine/domains/kubernetes";
import { Snapshot } from "@/engine/snapshot";
import { Result } from "@/utils/Result";

const execute = (s: Session, ...commands: string[]) =>
  commands.reduce((s, c) => {
    const next = run(s, c);
    expect(next.text, c).not.toMatch(/^(ERROR:|error:|Error from server)/m);
    return next;
  }, s);
const rejected = (s: Session, command: string, message: string) => {
  const next = run(s, command);
  expect(next.text, command).toContain(message);
  expect(next.world).toEqual(s.world);
};
const ready = () =>
  execute(
    session(),
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create-auto app --region=us-central1",
    "kubectl create deployment web --image=nginx:1 --replicas=2",
  );
const deployment = (s: Session) => {
  const d = s.world.kubeDeployments[0];
  if (!d) throw new Error("Missing fixture");
  return d;
};
const pods = (s: Session) => KubePod.fromDeployment(deployment(s)).map((p) => p.name);
const restore = (s: Session) =>
  session(
    Result.unwrap(Snapshot.fromUnknown(JSON.parse(JSON.stringify(Snapshot.create(s.world, Now))))),
  );

test("set image stores revisions, accepts both resource forms and is idempotent", () => {
  const s = ready();
  const updated = execute(s, "kubectl set image deployment/web web=nginx:2");
  expect(deployment(updated).revisions.map((r) => r.image)).toEqual(["nginx:1", "nginx:2"]);
  expect(pods(updated)).not.toEqual(pods(s));
  const unchanged = execute(updated, "kubectl set image deployment web web=nginx:2");
  expect(unchanged.world).toEqual(updated.world);
  const wildcard = execute(updated, "kubectl set image deployment/web *=nginx:3");
  expect(deployment(wildcard).revision).toBe(3);
  expect(restore(wildcard).world).toEqual(wildcard.world);
});
test("scale and scale-only apply change spec generation without a new revision or replacing existing Pods", () => {
  const s = execute(ready(), "kubectl apply -f deployment.yaml");
  const d = deployment(s);
  const scaled = execute(s, "kubectl scale deployment/web --replicas=3");
  expect(deployment(scaled).revision).toBe(d.revision);
  expect(deployment(scaled).generation).toBe(d.generation + 1);
  expect(pods(scaled).slice(0, 2)).toEqual(pods(s));
  const reapplied = execute(scaled, "kubectl apply -f deployment.yaml");
  expect(deployment(reapplied).revision).toBe(d.revision);
  expect(pods(reapplied)).toEqual(pods(s));
});
test("undo restores only the Pod template, retains scaled replicas and reuses its ReplicaSet identity", () => {
  const s = ready();
  const hash = KubeDeployment.replicaSetHash(deployment(s));
  const updated = execute(
    s,
    "kubectl set image deployment/web web=nginx:2",
    "kubectl scale deployment/web --replicas=4",
  );
  const undone = execute(restore(updated), "kubectl rollout undo deployment/web --to-revision=1");
  expect(deployment(undone)).toMatchObject({ image: "nginx:1", replicas: 4, revision: 3 });
  expect(deployment(undone).revisions.map((r) => r.revision)).toEqual([2, 3]);
  expect(KubeDeployment.replicaSetHash(deployment(undone))).toBe(hash);
  expect(pods(undone).every((p) => !pods(s).includes(p))).toBe(true);
  expect(execute(undone, "kubectl rollout undo deployment/web --to-revision=3").world).toEqual(
    undone.world,
  );
  const again = execute(undone, "kubectl rollout undo deployment web");
  expect(deployment(again)).toMatchObject({ image: "nginx:2", replicas: 4, revision: 4 });
});
test("history detail shows the saved image; reads never change state and missing history cannot be undone", () => {
  const s = ready();
  rejected(s, "kubectl rollout undo deployment/web", "not retained");
  const updated = execute(s, "kubectl set image deployment/web web=nginx:2");
  const history = execute(updated, "kubectl rollout history deployment/web --revision=1");
  expect(history.text).toContain("nginx:1");
  expect(history.text).not.toContain("nginx:2");
  expect(history.world).toEqual(updated.world);
  rejected(updated, "kubectl rollout history deployment/web --revision=999", "not retained");
  rejected(updated, "kubectl rollout undo deployment/web --to-revision=999", "not retained");
});
test("retained histories are bounded to current plus ten older templates", () => {
  let s = ready();
  for (let i = 2; i <= 15; i++) s = execute(s, `kubectl set image deployment/web web=nginx:${i}`);
  expect(deployment(s).revisions.map((r) => r.revision)).toEqual([
    5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
  ]);
  rejected(s, "kubectl rollout undo deployment/web --to-revision=1", "not retained");
  expect(restore(s).world).toEqual(s.world);
});
test("deleting one Pod replaces only that Pod and does not create a rollout revision", () => {
  const s = ready();
  const before = pods(s);
  const removed = execute(s, `kubectl delete pod ${before[0]}`);
  expect(pods(removed)[0]).not.toBe(before[0]);
  expect(pods(removed)[1]).toBe(before[1]);
  expect(deployment(removed).revision).toBe(deployment(s).revision);
  expect(deployment(removed).generation).toBe(deployment(s).generation);
  expect(deployment(removed).revisions).toEqual(deployment(s).revisions);
  rejected(removed, `kubectl delete pod ${before[0]}`, "not found");
  expect(pods(restore(removed))).toEqual(pods(removed));
  const restarted = execute(removed, "kubectl rollout restart deployment/web");
  expect(deployment(restarted).revision).toBe(2);
  expect(pods(restarted).every((p) => !pods(removed).includes(p))).toBe(true);
});
test("ReplicaSets expose previous/current replicas and template contents", () => {
  const s = execute(ready(), "kubectl set image deployment/web web=nginx:2");
  const rows = JSON.parse(execute(s, "kubectl get rs -o json").text).items;
  expect(rows.map((r: { desired: number }) => r.desired)).toEqual([0, 2]);
  const old = rows[0].name;
  expect(execute(s, `kubectl describe replicaset ${old}`).text).toContain("nginx:1");
  rejected(s, "kubectl get rs missing", "not found");
});
test("viewer can inspect status/history but cannot mutate; context and namespaces are enforced", () => {
  const s = execute(
    ready(),
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:developer@example.com --role=roles/container.viewer",
    "gcloud auth login developer@example.com",
  );
  execute(s, "kubectl rollout history deployment/web", "kubectl rollout status deployment/web");
  for (const c of [
    "kubectl set image deployment/web web=nginx:2",
    "kubectl rollout restart deployment/web",
    "kubectl rollout undo deployment/web",
  ])
    rejected(s, c, "container.deployments.update");
  rejected(s, "kubectl rollout history deployment/web -n other", "Only namespace default");
  const other = execute(
    ready(),
    "gcloud container clusters create-auto other --region=us-central1",
  );
  rejected(other, "kubectl rollout history deployment/web", "not found");
  rejected(session(), "kubectl set image deployment/web web=nginx:2", "container.googleapis.com");
});
test.each([
  "kubectl set image deployment/web wrong=nginx:2",
  "kubectl set image deployment/web web=",
  "kubectl set image deployment/web web=nginx:2 other=nginx:3",
  "kubectl set image deployment/web web=nginx:2 --local",
  "kubectl set image service/web web=nginx:2",
  "kubectl rollout undo deployment/web --to-revision=-1",
  "kubectl rollout history deployment/web --revision=-1",
  "kubectl rollout status deployment/web --to-revision=1",
  "kubectl scale deployment/web --replicas=1001",
])("unsupported or invalid request never mutates: %s", (c) => rejected(ready(), c, "error:"));

const image = "us-central1-docker.pkg.dev/ace-dev-01/release-images/hello";
const nodes = "release-nodes@ace-dev-01.iam.gserviceaccount.com";
const lesson = (id: string) =>
  execute(
    session(Result.unwrap(Engine.startMission(session().world, id))),
    "gcloud services enable artifactregistry.googleapis.com container.googleapis.com cloudbuild.googleapis.com",
    "gcloud artifacts repositories create release-images --repository-format=docker --location=us-central1",
    "gcloud auth configure-docker us-central1-docker.pkg.dev",
    `docker build -t ${image}:v1 ./hello-web`,
    `docker push ${image}:v1`,
    `docker build -t ${image}:v2 ./hello-web-v2`,
    `docker push ${image}:v2`,
    "gcloud iam service-accounts create release-nodes",
    `gcloud iam service-accounts add-iam-policy-binding ${nodes} --member=user:owner@example.com --role=roles/iam.serviceAccountUser`,
    `gcloud artifacts repositories add-iam-policy-binding release-images --location=us-central1 --member=serviceAccount:${nodes} --role=roles/artifactregistry.reader`,
    `gcloud container clusters create-auto release-gke --region=us-central1 --service-account=${nodes}`,
    `kubectl create deployment hello --image=${image}:v1 --replicas=2`,
  );
const status = (s: Session, id: string) => s.world.missions.find((m) => m.id === id)?.status;
test("update mission needs previous v1 and available v2, not a fresh v2 deployment", () => {
  const id = "m-gke-001";
  const s = lesson(id);
  expect(status(s, id)).toBe("in_progress");
  const wrong = execute(
    s,
    "kubectl delete deployment hello",
    `kubectl create deployment hello --image=${image}:v2 --replicas=2`,
  );
  expect(status(wrong, id)).toBe("in_progress");
  const failed = execute(s, `kubectl set image deployment/hello hello=${image}:missing`);
  expect(status(failed, id)).toBe("in_progress");
  const done = execute(restore(failed), `kubectl set image deployment hello hello=${image}:v2`);
  expect(status(done, id)).toBe("completed");
});
test("rollback mission diagnoses pull failure and preserves 3 replicas during recovery", () => {
  const id = "m-gke-002";
  const s = lesson(id);
  const failed = execute(s, `kubectl set image deployment/hello hello=${image}:missing`);
  expect(execute(failed, "kubectl get pods").text).toContain("ImagePullBackOff");
  expect(
    JSON.parse(execute(failed, "kubectl get deployments hello -o json").text).status.readyReplicas,
  ).toBe(0);
  rejected(failed, "kubectl rollout status deployment/hello", "not ready");
  const scaled = execute(failed, "kubectl scale deployment/hello --replicas=3");
  expect(status(scaled, id)).toBe("in_progress");
  const wrong = execute(scaled, `kubectl set image deployment/hello hello=${image}:v1`);
  expect(status(wrong, id)).toBe("in_progress");
  const done = execute(
    restore(scaled),
    "kubectl rollout undo deployment/hello --to-revision=1",
    "kubectl rollout status deployment/hello",
  );
  expect(status(done, id)).toBe("completed");
  expect(deployment(done).replicas).toBe(3);
  expect(execute(done, "kubectl get pods").text).not.toContain("ImagePullBackOff");
});
test("v8 migration preserves local/registry state and node identity, without inventing old revisions", () => {
  const s = execute(
    lesson("m-gke-001"),
    `kubectl set image deployment/hello hello=${image}:v2`,
    "kubectl rollout restart deployment/hello",
    `gcloud artifacts repositories add-iam-policy-binding release-images --location=us-central1 --member=serviceAccount:${nodes} --role=roles/artifactregistry.writer`,
    `gcloud builds submit ./hello-web --tag=${image}:v1 --service-account=projects/ace-dev-01/serviceAccounts/${nodes}`,
  );
  const snap = JSON.parse(JSON.stringify(Snapshot.create(s.world, Now)));
  snap.schemaVersion = 8;
  for (const d of snap.world.kubeDeployments) {
    delete d.revision;
    delete d.revisions;
    delete d.podIncarnations;
    delete d.podSequence;
  }
  const imported = session(Result.unwrap(Snapshot.fromUnknown(snap)));
  expect(imported.world.containerLab).toEqual(s.world.containerLab);
  expect(imported.world.clusters).toEqual(s.world.clusters);
  expect(deployment(imported).revisions).toEqual([
    { revision: 3, templateId: 3, image: `${image}:v2`, reason: "migrated", env: [] },
  ]);
  rejected(imported, "kubectl rollout undo deployment/hello --to-revision=1", "not retained");
  execute(
    imported,
    `kubectl set image deployment/hello hello=${image}:v1`,
    "kubectl rollout undo deployment/hello",
  );
});
test("invalid saved histories, replicas and Pod identities are rejected", () => {
  const s = ready();
  const d = deployment(s);
  for (const patch of [
    { revisions: [] },
    { revision: 0 },
    { revision: 2 },
    { replicas: -1 },
    { replicas: 1001 },
    { revisions: [...d.revisions, ...d.revisions] },
    { podIncarnations: [-1, 0] },
    { podIncarnations: [] },
    { revisions: [{ ...d.revisions[0], image: "forged" }] },
  ]) {
    const snap = JSON.parse(JSON.stringify(Snapshot.create(s.world, Now)));
    Object.assign(snap.world.kubeDeployments[0], patch);
    expect(Result.isOk(Snapshot.fromUnknown(snap)), JSON.stringify(patch)).toBe(false);
  }
});
test("completion and help expose supported subcommands and flags", () => {
  expect(Engine.completionCandidates(ready().world, "kubectl rollout ")).toContain("undo");
  expect(execute(ready(), "kubectl rollout undo --help").text).toContain("--to-revision");
  expect(execute(ready(), "kubectl set image --help").text).toContain("CONTAINER=IMAGE");
});
