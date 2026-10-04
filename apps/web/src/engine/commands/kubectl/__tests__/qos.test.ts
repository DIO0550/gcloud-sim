// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { Now, run, type Session, session } from "@/engine/__tests__/setup";
import { KubeResources } from "@/engine/domains/kube-resources";
import { KubePod } from "@/engine/domains/kubernetes";
import { World } from "@/engine/domains/world";
import { Snapshot } from "@/engine/snapshot";
import { Result } from "@/utils/Result";

const execute = (s: Session, ...commands: string[]) =>
  commands.reduce((s, command) => {
    const next = run(s, command);
    expect(next.text, command).not.toMatch(/^(ERROR:|error:|Error from server)/m);
    expect(Result.isOk(World.validate(next.world)), command).toBe(true);
    return next;
  }, s);
const ready = (s = session()) =>
  execute(
    s,
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create qos-gke --zone=us-central1-a",
    "kubectl create deployment web --image=nginx:1",
  );
const json = (s: Session, command = "kubectl get pods -o json") =>
  JSON.parse(execute(s, command).text);
const pod = (s: Session) => json(s).items[0];
const restore = (s: Session) =>
  session(
    Result.unwrap(Snapshot.fromUnknown(JSON.parse(JSON.stringify(Snapshot.create(s.world, Now))))),
  );
const manifest = (resources: unknown) => ({
  apiVersion: "apps/v1",
  kind: "Deployment",
  metadata: { name: "web" },
  spec: {
    selector: { matchLabels: { app: "web" } },
    template: {
      metadata: { labels: { app: "web" } },
      spec: { containers: [{ name: "web", image: "nginx:1", resources }] },
    },
  },
});
const apply = (s: Session, resources: unknown) =>
  execute(
    s,
    `sim files write qos.json --content='${JSON.stringify(manifest(resources))}'`,
    "kubectl apply -f qos.json",
  );

test.each([
  [{}, "BestEffort"],
  [{ requests: { cpu: "0", memory: "0" }, limits: { cpu: "0", memory: "0" } }, "BestEffort"],
  [{ requests: { cpu: "1m" } }, "Burstable"],
  [{ requests: { memory: "1" } }, "Burstable"],
  [{ limits: { cpu: "500m" } }, "Burstable"],
  [{ limits: { memory: "128Mi" } }, "Burstable"],
  [{ requests: { cpu: "500m", memory: "128Mi" } }, "Burstable"],
  [
    { requests: { cpu: "250m", memory: "128Mi" }, limits: { cpu: "500m", memory: "128Mi" } },
    "Burstable",
  ],
  [
    { requests: { cpu: "500m", memory: "64Mi" }, limits: { cpu: "500m", memory: "128Mi" } },
    "Burstable",
  ],
  [
    { requests: { cpu: "0", memory: "128Mi" }, limits: { cpu: "500m", memory: "128Mi" } },
    "Burstable",
  ],
  [{ limits: { cpu: "0", memory: "128Mi" } }, "Burstable"],
  [
    { requests: { cpu: "0.5", memory: "134217728" }, limits: { cpu: "500m", memory: "128Mi" } },
    "Guaranteed",
  ],
  [{ limits: { cpu: "1m", memory: "1" } }, "Guaranteed"],
] as const)(
  "QoS is derived from positive, defaulted quantities: %j → %s",
  (resources, expected) => {
    const s = apply(ready(), resources);
    expect(pod(s).status.qosClass).toBe(expected);
    const d = s.world.kubeDeployments.find((d) => d.name === "web");
    if (!d) throw new Error("Missing Deployment");
    const p = KubePod.fromDeployment(d)[0];
    if (!p) throw new Error("Missing Pod");
    expect(KubePod.toRecord(p).status).toMatchObject({ qosClass: expected });
    expect(execute(s, "kubectl describe pods").text).toContain(`qosClass: ${expected}`);
    expect(execute(s, "kubectl get pods -o yaml").text).toContain(`qosClass: ${expected}`);
  },
);

test("Pod structured status survives JSON, named get, get all and table output", () => {
  const s = ready();
  const p = pod(s);
  expect(p.status).toMatchObject({
    phase: "Running",
    qosClass: "BestEffort",
    podIP: expect.stringMatching(/^10\./),
  });
  expect(json(s, `kubectl get pod ${p.metadata.name} -o json`).status).toEqual(p.status);
  expect(
    json(s, "kubectl get all -o json").items.find((item: { kind: string }) => item.kind === "Pod")
      .status,
  ).toEqual(p.status);
  expect(execute(s, "kubectl get pods").text).toMatch(/1\/1\s+Running\s+0/);
  expect(execute(s, "kubectl get all").text).toMatch(/pod\/web-.*1\/1\s+Running/);
  expect(execute(s, "kubectl get pods").world).toEqual(s.world);
});

test("QoS follows CLI changes, undo, restart, scale, Pod recreation and Snapshot restore", () => {
  const initial = ready();
  const guaranteed = execute(
    initial,
    "kubectl set resources deployment/web --limits=cpu=500m,memory=256Mi",
  );
  expect(pod(guaranteed).status.qosClass).toBe("Guaranteed");
  expect(pod(guaranteed).metadata.name).not.toBe(pod(initial).metadata.name);
  const changed = execute(guaranteed, "kubectl set resources deployment/web --requests=cpu=250m");
  expect(pod(changed).status.qosClass).toBe("Burstable");
  const undone = execute(restore(changed), "kubectl rollout undo deployment/web");
  expect(pod(undone).status.qosClass).toBe("Guaranteed");
  const next = execute(
    undone,
    "kubectl rollout restart deployment/web",
    "kubectl scale deployment/web --replicas=2",
  );
  const replaced = execute(next, `kubectl delete pod ${pod(next).metadata.name}`);
  expect(pod(replaced).metadata.name).not.toBe(pod(next).metadata.name);
  expect(
    json(restore(replaced)).items.map((p: { status: { qosClass: string } }) => p.status.qosClass),
  ).toEqual(["Guaranteed", "Guaranteed"]);
  const removed = execute(
    replaced,
    "kubectl set resources deployment/web --requests=cpu=0,memory=0 --limits=cpu=0,memory=0",
  );
  expect(pod(removed).status.qosClass).toBe("BestEffort");
  expect(Snapshot.create(removed.world, Now).schemaVersion).toBe(17);
});

test("manifest replacement clears QoS inputs and repeated apply preserves Pods", () => {
  const s = apply(ready(), { limits: { cpu: "500m", memory: "256Mi" } });
  expect(pod(s).status.qosClass).toBe("Guaranteed");
  expect(execute(s, "kubectl apply -f qos.json").world).toEqual(s.world);
  expect(pod(apply(s, undefined)).status.qosClass).toBe("BestEffort");
});

test("failed Pod still has QoS; STATUS keeps its startup error and phase is Pending", () => {
  const s = execute(ready(), "kubectl set resources deployment/web --limits=cpu=500m,memory=256Mi");
  const value = manifest({ limits: { cpu: "500m", memory: "256Mi" } });
  const container = value.spec.template.spec.containers[0];
  const broken = {
    ...value,
    spec: {
      ...value.spec,
      template: {
        ...value.spec.template,
        spec: {
          containers: [
            {
              ...container,
              env: [
                { name: "MODE", valueFrom: { configMapKeyRef: { name: "missing", key: "MODE" } } },
              ],
            },
          ],
        },
      },
    },
  };
  const failed = execute(
    s,
    `sim files write broken.json --content='${JSON.stringify(broken)}'`,
    "kubectl apply -f broken.json",
  );
  expect(pod(failed).status).toMatchObject({ phase: "Pending", qosClass: "Guaranteed" });
  expect(execute(failed, "kubectl get pods").text).toContain("CreateContainerConfigError");
  expect(execute(failed, "kubectl get all").text).toContain("CreateContainerConfigError");
});

test("v13 and v12 snapshots derive QoS from retained or defaulted resources", () => {
  const s = execute(ready(), "kubectl set resources deployment/web --limits=cpu=500m,memory=256Mi");
  const snapshot = JSON.parse(JSON.stringify(Snapshot.create(s.world, Now)));
  snapshot.schemaVersion = 13;
  delete snapshot.world.kubeHpas;
  expect(pod(session(Result.unwrap(Snapshot.fromUnknown(snapshot)))).status.qosClass).toBe(
    "Guaranteed",
  );
  snapshot.schemaVersion = 12;
  for (const d of snapshot.world.kubeDeployments) {
    delete d.resources;
    for (const r of d.revisions) delete r.resources;
  }
  expect(pod(session(Result.unwrap(Snapshot.fromUnknown(snapshot)))).status.qosClass).toBe(
    "BestEffort",
  );
});

test("QoS reads retain viewer permissions and cluster isolation", () => {
  const s = execute(
    ready(),
    "kubectl set resources deployment/web --limits=cpu=500m,memory=256Mi",
    "gcloud container clusters create other-qos --zone=us-central1-a",
    "kubectl create deployment web --image=nginx:1",
  );
  expect(pod(s).status.qosClass).toBe("BestEffort");
  const original = execute(
    s,
    "gcloud container clusters get-credentials qos-gke --zone=us-central1-a",
  );
  expect(pod(original).status.qosClass).toBe("Guaranteed");
  const viewer = execute(
    original,
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:developer@example.com --role=roles/container.viewer",
    "gcloud auth login developer@example.com",
  );
  expect(pod(viewer).status.qosClass).toBe("Guaranteed");
  const denied = run(viewer, "kubectl set resources deployment/web --requests=cpu=250m");
  expect(denied.world).toEqual(viewer.world);
  expect(denied.text).toContain("Required 'container.deployments.update' permission");
});

test("QoS mission requires all three exact configurations and resumes from saved partial work", () => {
  const id = "m-gke-011";
  const status = (s: Session) => s.world.missions.find((m) => m.id === id)?.status;
  const start = session(Result.unwrap(Engine.startMission(session().world, id)));
  expect(status(start)).toBe("in_progress");
  const s = execute(
    start,
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create qos-gke --zone=us-central1-a",
    "kubectl create deployment qos-best --image=nginx:1",
    "kubectl create deployment qos-burst --image=nginx:1",
    "kubectl create deployment qos-guaranteed --image=nginx:1",
    "kubectl set resources deployment/qos-burst --requests=cpu=250m,memory=128Mi --limits=cpu=500m,memory=256Mi",
    "kubectl set resources deployment/qos-guaranteed --limits=cpu=500m",
  );
  expect(status(s)).toBe("in_progress");
  const wrongAmount = execute(
    s,
    "kubectl set resources deployment/qos-guaranteed --limits=memory=128Mi",
  );
  expect(status(wrongAmount)).toBe("in_progress");
  const wrongScale = execute(
    s,
    "kubectl scale deployment/qos-best --replicas=0",
    "kubectl set resources deployment/qos-guaranteed --limits=memory=256Mi",
  );
  expect(status(wrongScale)).toBe("in_progress");
  const wrongBest = execute(
    s,
    "kubectl set resources deployment/qos-best --requests=cpu=1m",
    "kubectl set resources deployment/qos-guaranteed --limits=memory=256Mi",
  );
  expect(status(wrongBest)).toBe("in_progress");
  const done = execute(
    restore(s),
    "kubectl set resources deployment/qos-guaranteed --limits=memory=256Mi",
  );
  expect(status(done)).toBe("completed");
  expect(restore(done).world).toEqual(done.world);
  expect(
    done.world.kubeDeployments
      .filter((d) => d.cluster === "qos-gke")
      .map((d) => KubeResources.qosClass(d.resources)),
  ).toEqual(["BestEffort", "Burstable", "Guaranteed"]);
});
