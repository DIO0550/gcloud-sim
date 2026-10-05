// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { Now, run, type Session, session } from "@/engine/__tests__/setup";
import { KubeManifest } from "@/engine/domains/kube-manifest";
import { KubeServiceRouting } from "@/engine/domains/kube-service-routing";
import { KubeStorage } from "@/engine/domains/kube-storage";
import { KubePod } from "@/engine/domains/kubernetes";
import { World } from "@/engine/domains/world";
import { TreeSelection } from "@/engine/resource-tree";
import { Snapshot } from "@/engine/snapshot";
import { Result } from "@/utils/Result";

const required = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error("Missing test fixture");
  return value;
};
const execute = (s: Session, ...commands: string[]) =>
  commands.reduce((s, c) => {
    const next = run(s, c);
    expect(next.text, c).not.toMatch(/^(ERROR:|error:|Error from server)/m);
    expect(World.validate(next.world), c).toEqual(Result.ok(next.world));
    return next;
  }, s);
const rejected = (s: Session, command: string, message: string) => {
  const next = run(s, command);
  expect(next.text, command).toContain(message);
  expect(next.world).toEqual(s.world);
};
const ready = (cluster = "storage-gke") =>
  execute(
    session(),
    "gcloud services enable container.googleapis.com",
    `gcloud container clusters create-auto ${cluster} --region=us-central1`,
    "sim files load kubernetes-storage",
  );
const applied = (s = ready()) =>
  execute(
    s,
    "kubectl apply -f archive-class.yaml",
    "kubectl apply -f storage-claim.yaml",
    "kubectl apply -f storage-web.yaml",
  );
const put = (s: Session, text = "hello") =>
  execute(s, `sim kubernetes write-file storage-web --path=/data/message.txt --content='${text}'`);
const cat = (s: Session) =>
  execute(s, "kubectl exec deployment/storage-web -- cat /data/message.txt").text;
const json = (s: Session, c: string) => JSON.parse(execute(s, c).text);
const restore = (s: Session) =>
  session(
    Result.unwrap(Snapshot.fromUnknown(JSON.parse(JSON.stringify(Snapshot.create(s.world, Now))))),
  );
const write = (s: Session, value: unknown, path = "storage.json") =>
  execute(s, `sim files write ${path} --content='${JSON.stringify(value)}'`);
const claim = (storageClassName = "archive", namespace?: string) => ({
  apiVersion: "v1",
  kind: "PersistentVolumeClaim",
  metadata: { name: "app-data", ...(namespace ? { namespace } : {}) },
  spec: {
    accessModes: ["ReadWriteOnce"],
    storageClassName,
    resources: { requests: { storage: "1Gi" } },
  },
});
const workload = (namespace?: string) => ({
  apiVersion: "apps/v1",
  kind: "Deployment",
  metadata: { name: "storage-web", ...(namespace ? { namespace } : {}) },
  spec: {
    replicas: 1,
    selector: { matchLabels: { app: "storage-web" } },
    template: {
      metadata: { labels: { app: "storage-web" } },
      spec: {
        volumes: [{ name: "data", persistentVolumeClaim: { claimName: "app-data" } }],
        containers: [
          {
            name: "storage-web",
            image: "nginx:1",
            volumeMounts: [{ name: "data", mountPath: "/data" }],
          },
        ],
      },
    },
  },
});

test("built-in CSI classes are cluster scoped, read-only, delayed binding and expansion enabled", () => {
  const s = ready();
  const records = json(s, "kubectl get sc -A -o json").items;
  expect(records).toHaveLength(2);
  expect(records[0].metadata.namespace).toBeUndefined();
  expect(records[0].volumeBindingMode).toBe("WaitForFirstConsumer");
  expect(records[1].parameters.type).toBe("pd-ssd");
  rejected(s, "kubectl delete sc standard-rwo", "read-only");
  const configured = execute(s, "kubectl config set-context --current --namespace=missing");
  execute(configured, "kubectl get sc", "kubectl get pv");
});
test("WaitForFirstConsumer keeps PVC Pending, missing class fails mount, later class creation repairs it", () => {
  let s = execute(ready(), "kubectl apply -f storage-claim.yaml");
  expect(json(s, "kubectl get pvc app-data -o json").status.phase).toBe("Pending");
  expect(s.world.kubePvs).toEqual([]);
  s = execute(s, "kubectl apply -f storage-web.yaml");
  expect(execute(s, "kubectl describe pvc app-data").text).toContain(
    "StorageClass archive not found",
  );
  rejected(s, "kubectl rollout status deployment/storage-web", "FailedMount");
  rejected(
    s,
    `kubectl logs ${required(KubePod.fromDeployment(required(s.world.kubeDeployments[0]))[0]).name}`,
    "FailedMount",
  );
  rejected(s, "kubectl exec deployment/storage-web -- cat /data/message.txt", "FailedMount");
  s = execute(s, "kubectl apply -f archive-class.yaml");
  expect(json(s, "kubectl get pvc app-data -o json").status.phase).toBe("Bound");
  expect(s.world.kubePvs).toHaveLength(1);
  execute(s, "kubectl rollout status deployment/storage-web");
});
test("delayed binding waits for replicas > 0 and never returns to Pending after consumers disappear", () => {
  let s = execute(
    ready(),
    "kubectl apply -f archive-class.yaml",
    "kubectl apply -f storage-claim.yaml",
  );
  expect(execute(s, "kubectl describe pvc app-data").text).toContain("WaitForFirstConsumer");
  s = execute(
    s,
    "sim files replace storage-web.yaml --search='replicas: 1' --replacement='replicas: 0'",
    "kubectl apply -f storage-web.yaml",
  );
  expect(s.world.kubePvs).toHaveLength(0);
  s = execute(s, "kubectl scale deployment/storage-web --replicas=1");
  const pv = s.world.kubePvs[0];
  s = execute(s, "kubectl delete deployment/storage-web");
  expect(s.world.kubePvs[0]).toEqual(pv);
  expect(json(s, "kubectl get pvc app-data -o json").status.phase).toBe("Bound");
});
test("Immediate provisions before any Pod and creates no duplicate on unchanged apply", () => {
  const s = execute(
    ready(),
    "sim files replace archive-class.yaml --search=WaitForFirstConsumer --replacement=Immediate",
    "kubectl apply -f archive-class.yaml",
    "kubectl apply -f storage-claim.yaml",
  );
  expect(s.world.kubePvs).toHaveLength(1);
  expect(
    execute(s, "kubectl apply -f storage-claim.yaml", "kubectl apply -f archive-class.yaml").world,
  ).toEqual(s.world);
});
test("application writes preserve Unicode, empty contents and literal shell text without evaluating it", () => {
  const s = put(applied(), "こんにちは $(id) `ls`");
  expect(cat(s)).toBe("こんにちは $(id) `ls`");
  expect(cat(put(s, ""))).toBe("");
  expect(execute(s, "kubectl exec deployment/storage-web -- base64 /data/message.txt").text).toBe(
    Buffer.from("こんにちは $(id) `ls`").toString("base64"),
  );
});
test("Pod restart, individual replacement, scaling and image undo keep the same PV and data", () => {
  let s = put(applied());
  const pv = s.world.kubePvs[0];
  const original = KubePod.fromDeployment(required(s.world.kubeDeployments[0])).map((p) => p.name);
  s = execute(s, "kubectl rollout restart deployment/storage-web");
  expect(
    KubePod.fromDeployment(required(s.world.kubeDeployments[0])).map((p) => p.name),
  ).not.toEqual(original);
  expect(cat(s)).toBe("hello");
  const pod = required(KubePod.fromDeployment(required(s.world.kubeDeployments[0]))[0]);
  s = execute(
    s,
    `kubectl delete pod ${pod.name}`,
    "kubectl scale deployment/storage-web --replicas=2",
  );
  for (const pod of KubePod.fromDeployment(required(s.world.kubeDeployments[0])))
    expect(execute(s, `kubectl exec ${pod.name} -- cat /data/message.txt`).text).toBe("hello");
  s = execute(
    s,
    "kubectl set image deployment/storage-web storage-web=nginx:2",
    "kubectl rollout undo deployment/storage-web",
  );
  expect(cat(s)).toBe("hello");
  expect(s.world.kubePvs[0]).toEqual(pv);
});
test("multiple mounts and Deployments see the same PVC data; RWO does not mean one Pod", () => {
  let s = applied();
  const second = workload();
  second.metadata.name = "reader";
  required(second.spec.template.spec.containers[0]).name = "reader";
  required(second.spec.template.spec.containers[0]).volumeMounts.push({
    name: "data",
    mountPath: "/backup",
  });
  s = execute(write(s, second), "kubectl apply -f storage.json");
  s = put(s, "shared");
  expect(execute(s, "kubectl exec deployment/reader -- cat /data/message.txt").text).toBe("shared");
  expect(execute(s, "kubectl exec deployment/reader -- cat /backup/message.txt").text).toBe(
    "shared",
  );
  expect(s.world.kubePvs).toHaveLength(1);
});
test.each(["volume", "mount"])(
  "%s readOnly blocks application writes without changing data",
  (kind) => {
    const s = put(applied());
    const d = workload();
    const spec = d.spec.template.spec as unknown as {
      volumes: Record<string, unknown>[];
      containers: { name: string; image: string; volumeMounts: Record<string, unknown>[] }[];
    };
    if (kind === "volume")
      (required(spec.volumes[0]).persistentVolumeClaim as Record<string, unknown>).readOnly = true;
    if (kind === "mount") required(required(spec.containers[0]).volumeMounts[0]).readOnly = true;
    const ro = execute(write(s, d), "kubectl apply -f storage.json");
    rejected(
      ro,
      "sim kubernetes write-file storage-web --path=/data/message.txt --content=bad",
      "read-only",
    );
    expect(cat(ro)).toBe("hello");
  },
);
test.each([
  "/data/../host",
  "/data/./x",
  "/host/x",
  "/data",
  "/data/x/",
  "/data/message.txt/child",
])("unsafe or unmounted application path %s is rejected atomically", (path) => {
  rejected(
    put(applied()),
    `sim kubernetes write-file storage-web --path=${path} --content=x`,
    path.startsWith("/host") || path === "/data"
      ? "inside a mounted PVC"
      : path.includes("message.txt/")
        ? "conflicts"
        : "safe mounted file path",
  );
});
test("configuration volumes cannot be written and arbitrary shell commands remain unsupported", () => {
  const s = execute(
    applied(),
    "sim files load kubernetes-volume-refresh",
    "kubectl apply -f reload-settings.yaml",
    "kubectl apply -f reload-web.yaml",
  );
  rejected(
    s,
    "sim kubernetes write-file reload-web --path=/etc/config/MODE --content=bad",
    "mounted PVC",
  );
  rejected(s, "kubectl exec deployment/storage-web -- sh -c ls", "Only exec");
});
test("expansion preserves PV identity, creation time and files; shrink and class changes fail atomically", () => {
  let s = put(applied());
  const pv = required(s.world.kubePvs[0]);
  const d = required(s.world.kubeDeployments[0]);
  s = execute(
    s,
    "sim files replace storage-claim.yaml --search=1Gi --replacement=2Gi",
    "kubectl apply -f storage-claim.yaml",
  );
  expect(s.world.kubePvs[0]).toEqual({ ...pv, storageGi: 2 });
  expect(s.world.kubeDeployments[0]).toEqual(d);
  expect(json(s, "kubectl get pvc app-data -o json").status.capacity.storage).toBe("2Gi");
  const small = execute(s, "sim files replace storage-claim.yaml --search=2Gi --replacement=1Gi");
  rejected(small, "kubectl apply -f storage-claim.yaml", "cannot shrink");
  rejected(
    write(s, claim("premium-rwo")),
    "kubectl apply -f storage.json",
    "storageClassName is immutable",
  );
});
test("expansion depends on the current class allowVolumeExpansion and fails after class deletion", () => {
  let s = execute(
    applied(),
    "sim files replace archive-class.yaml --search='allowVolumeExpansion: true' --replacement='allowVolumeExpansion: false'",
    "kubectl apply -f archive-class.yaml",
    "sim files replace storage-claim.yaml --search=1Gi --replacement=2Gi",
  );
  rejected(s, "kubectl apply -f storage-claim.yaml", "does not allow");
  s = execute(s, "kubectl delete sc archive");
  execute(s, "kubectl rollout status deployment/storage-web");
  rejected(s, "kubectl apply -f storage-claim.yaml", "does not allow");
});
test("StorageClass provisioning fields are immutable; modifying expansion does not change existing PV policy", () => {
  const s = applied();
  rejected(
    execute(s, "sim files replace archive-class.yaml --search=Retain --replacement=Delete"),
    "kubectl apply -f archive-class.yaml",
    "immutable",
  );
  const changed = execute(
    s,
    "kubectl delete sc archive",
    "sim files replace archive-class.yaml --search=Retain --replacement=Delete",
    "kubectl apply -f archive-class.yaml",
  );
  expect(changed.world.kubePvs[0]?.reclaimPolicy).toBe("Retain");
});
test("PVC deletion protection keeps a Bound mount and data until all consumer Pods disappear", () => {
  let s = execute(put(applied()), "kubectl delete pvc app-data");
  expect(execute(s, "kubectl get pvc").text).toContain("Terminating");
  expect(json(s, "kubectl get pvc app-data -o json").metadata.deletionTimestamp).toBe(Now);
  expect(cat(s)).toBe("hello");
  rejected(s, "kubectl apply -f storage-claim.yaml", "Terminating");
  rejected(s, `kubectl delete pv ${required(s.world.kubePvs[0]).name}`, "protected");
  s = execute(s, "kubectl scale deployment/storage-web --replicas=0");
  expect(s.world.kubePvcs).toEqual([]);
  expect(s.world.kubePvs[0]?.released).toBe(true);
  expect(s.world.kubePvs[0]?.files[0]?.value).toBe(Buffer.from("hello").toString("base64"));
});
test("Retain leaves Released data, a recreated claim receives a different empty PV, manual PV deletion works", () => {
  let s = execute(
    put(applied()),
    "kubectl delete deployment/storage-web",
    "kubectl delete pvc app-data",
  );
  const old = required(s.world.kubePvs[0]);
  s = execute(s, "kubectl apply -f storage-claim.yaml", "kubectl apply -f storage-web.yaml");
  expect(s.world.kubePvs).toHaveLength(2);
  expect(s.world.kubePvcs[0]?.volumeName).not.toBe(old.name);
  rejected(s, "kubectl exec deployment/storage-web -- cat /data/message.txt", "not found");
  s = execute(s, `kubectl delete pv ${old.name}`);
  expect(s.world.kubePvs).toHaveLength(1);
});
test("Delete policy removes the PV and simulated disk data after unused PVC deletion", () => {
  const s = execute(
    put(
      applied(
        execute(
          ready(),
          "sim files replace archive-class.yaml --search=Retain --replacement=Delete",
        ),
      ),
    ),
    "kubectl scale deployment/storage-web --replicas=0",
    "kubectl delete pvc app-data",
  );
  expect(s.world.kubePvs).toEqual([]);
  expect(s.world.kubePvcs).toEqual([]);
});
test("Service and HPA exclude a waiting storage consumer and recover when the claim is provisioned", () => {
  let s = execute(
    ready(),
    "kubectl apply -f storage-claim.yaml",
    "kubectl apply -f storage-web.yaml",
    "kubectl expose deployment/storage-web --port=80",
    "kubectl set resources deployment/storage-web --requests=cpu=250m",
    "kubectl autoscale deployment/storage-web --min=1 --max=3 --cpu-percent=50",
  );
  expect(KubeServiceRouting.backends(s.world, required(s.world.kubeServices[0]))).toEqual([]);
  s = execute(s, "sim kubernetes reconcile storage-web --cpu=250m");
  expect(s.world.kubeDeployments[0]?.replicas).toBe(1);
  s = execute(
    s,
    "kubectl apply -f archive-class.yaml",
    "sim kubernetes reconcile storage-web --cpu=250m",
  );
  expect(s.world.kubeDeployments[0]?.replicas).toBe(2);
  expect(KubeServiceRouting.backends(s.world, required(s.world.kubeServices[0]))).toHaveLength(2);
});
test("namespace resources and files remain separate; namespace deletion releases Retain PV at cluster scope", () => {
  let s = execute(applied(), "kubectl create ns staging");
  s = execute(write(s, claim("archive", "staging")), "kubectl apply -f storage.json");
  s = execute(write(s, workload("staging")), "kubectl apply -f storage.json");
  s = put(s, "default");
  s = execute(
    s,
    "sim kubernetes write-file storage-web -n staging --path=/data/message.txt --content=staging",
  );
  expect(cat(s)).toBe("default");
  expect(
    execute(s, "kubectl exec deployment/storage-web -n staging -- cat /data/message.txt").text,
  ).toBe("staging");
  expect(json(s, "kubectl get pvc -A -o json").items).toHaveLength(2);
  expect(json(s, "kubectl get pv -A -o json").items).toHaveLength(2);
  s = execute(s, "kubectl delete ns staging");
  expect(s.world.kubePvcs).toHaveLength(1);
  expect(s.world.kubePvs.find((p) => p.namespace === "staging")?.released).toBe(true);
  expect(cat(s)).toBe("default");
});
test("class and same-name claims are scoped to cluster and project, cluster deletion removes only owned storage", () => {
  let s = put(applied());
  s = execute(
    s,
    "gcloud container clusters create-auto other --region=us-central1",
    "kubectl apply -f storage-claim.yaml",
    "kubectl apply -f storage-web.yaml",
  );
  expect(s.world.kubePvs).toHaveLength(1);
  rejected(s, "kubectl exec deployment/storage-web -- cat /data/message.txt", "FailedMount");
  s = execute(s, "kubectl apply -f archive-class.yaml");
  expect(s.world.kubePvs).toHaveLength(2);
  rejected(s, "kubectl exec deployment/storage-web -- cat /data/message.txt", "not found");
  s = execute(s, "gcloud container clusters delete other --region=us-central1 --quiet");
  expect(s.world.kubeStorageClasses).toHaveLength(1);
  expect(s.world.kubePvcs).toHaveLength(1);
  expect(s.world.kubePvs).toHaveLength(1);
});
test("mixed manifest create/delete permissions are atomic, including namespace and storage changes", () => {
  const bundle = [
    { apiVersion: "v1", kind: "Namespace", metadata: { name: "staging" } },
    claim("standard-rwo", "staging"),
    { ...workload("staging"), spec: { ...workload("staging").spec, replicas: -1 } },
  ]
    .map((v) => JSON.stringify(v))
    .join("\n---\n");
  const s = execute(ready(), `sim files write bundle.yaml --content='${bundle}'`);
  rejected(s, "kubectl apply -f bundle.yaml", "Replicas");
  const valid = execute(
    put(applied()),
    `sim files write bundle.yaml --content='${JSON.stringify(claim())}\n---\n${JSON.stringify(claim("archive", "staging"))}'`,
  );
  rejected(valid, "kubectl delete -f bundle.yaml", "not found");
});
test("viewer can inspect all storage kinds but cannot mutate storage or write application data", () => {
  const s = execute(
    applied(),
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:viewer@example.com --role=roles/container.viewer",
    "gcloud auth login viewer@example.com",
  );
  execute(
    s,
    "kubectl get sc",
    "kubectl get pv",
    "kubectl get pvc",
    "kubectl describe pvc app-data",
  );
  rejected(s, "kubectl apply -f archive-class.yaml", "container.storageClasses.update");
  rejected(s, "kubectl apply -f storage-claim.yaml", "container.persistentVolumeClaims.update");
  rejected(s, "kubectl delete pvc app-data", "container.persistentVolumeClaims.delete");
  rejected(
    s,
    "sim kubernetes write-file storage-web --path=/data/x --content=x",
    "container.pods.exec",
  );
});
test("developer can manage Kubernetes storage objects; API boundary also rejects writes", () => {
  const s = execute(
    applied(),
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:writer@example.com --role=roles/container.developer",
    "gcloud auth login writer@example.com",
  );
  execute(
    s,
    "kubectl get sc",
    "kubectl apply -f storage-claim.yaml",
    "sim kubernetes write-file storage-web --path=/data/x --content=x",
  );
  execute(s, "kubectl apply -f archive-class.yaml");
  const disabled = execute(
    s,
    "gcloud auth login owner@example.com",
    "gcloud services disable container.googleapis.com",
  );
  rejected(disabled, "kubectl get pvc", "container.googleapis.com");
  rejected(
    disabled,
    "sim kubernetes write-file storage-web --path=/data/x --content=x",
    "container.googleapis.com",
  );
});
test.each(["0Gi", "1Mi", "1.5Gi", "1025Gi", 1])(
  "unsupported PVC quantity %s fails rather than succeeding",
  (storage) => {
    const c = claim();
    (c.spec.resources.requests as Record<string, unknown>).storage = storage;
    expect(Result.isOk(KubeManifest.parse(JSON.stringify(c)))).toBe(false);
  },
);
test("unsupported static binding, RWX, Block, selectors, default class selection and PVC subPath are rejected", () => {
  for (const spec of [
    { ...claim().spec, volumeName: "manual" },
    { ...claim().spec, accessModes: ["ReadWriteMany"] },
    { ...claim().spec, volumeMode: "Block" },
    { ...claim().spec, selector: { matchLabels: { app: "web" } } },
    { accessModes: ["ReadWriteOnce"], resources: { requests: { storage: "1Gi" } } },
  ])
    expect(Result.isOk(KubeManifest.parse(JSON.stringify({ ...claim(), spec })))).toBe(false);
  const d = workload();
  Object.assign(required(required(d.spec.template.spec.containers[0]).volumeMounts[0]), {
    subPath: "file",
  });
  expect(Result.isOk(KubeManifest.parse(JSON.stringify(d)))).toBe(false);
  const none = execute(write(ready(), claim("")), "kubectl apply -f storage.json");
  expect(execute(none, "kubectl describe pvc app-data").text).toContain("No storage class");
});
test("Snapshot 24 round trips Bound/Terminating/Released data and rejects broken binding or unsafe bytes", () => {
  let s = put(applied());
  expect(restore(s).world).toEqual(s.world);
  s = execute(s, "kubectl delete pvc app-data");
  expect(restore(s).world).toEqual(s.world);
  s = execute(s, "kubectl scale deployment/storage-web --replicas=0");
  expect(restore(s).world).toEqual(s.world);
  for (const edit of [
    (w: World) => ({
      ...w,
      kubePvs: [{ ...required(w.kubePvs[0]), files: [{ path: "../host", value: "eA==" }] }],
    }),
    (w: World) => ({
      ...w,
      kubePvs: [{ ...required(w.kubePvs[0]), files: [{ path: "x", value: "bad==" }] }],
    }),
    (w: World) => ({
      ...w,
      kubePvcs: [
        {
          projectId: "ace-dev-01",
          cluster: "storage-gke",
          namespace: "default",
          name: "fake",
          storageClassName: "archive",
          storageGi: 1,
          volumeName: required(w.kubePvs[0]).name,
          deleting: "",
          createdAt: Now,
        },
      ],
    }),
  ])
    expect(
      Result.isOk(Snapshot.fromUnknown({ ...Snapshot.create(s.world, Now), world: edit(s.world) })),
    ).toBe(false);
});
test("v23 migration preserves stale configuration projections, history, probes and context while adding empty storage", () => {
  const s = execute(
    ready(),
    "sim files load kubernetes-volume-refresh",
    "kubectl apply -f reload-settings.yaml",
    "kubectl apply -f reload-web.yaml",
    "sim files replace reload-settings.yaml --search=staging --replacement=production",
    "kubectl apply -f reload-settings.yaml",
    "kubectl config set-context --current --namespace=default",
  );
  const snapshot = JSON.parse(JSON.stringify(Snapshot.create(s.world, Now)));
  snapshot.schemaVersion = 23;
  delete snapshot.world.kubeStorageClasses;
  delete snapshot.world.kubePvcs;
  delete snapshot.world.kubePvs;
  const migrated = Result.unwrap(Snapshot.fromUnknown(snapshot));
  expect(migrated).toEqual(s.world);
  expect(
    execute(session(migrated), "kubectl exec deployment/reload-web -- cat /etc/mode.conf").text,
  ).toBe("staging");
});
test("help, kind/name completion and tree describe commands cover storage without adding namespace to PV/SC", () => {
  const s = applied();
  expect(Engine.completionCandidates(s.world, "kubectl get p")).toContain("pvc");
  expect(Engine.completionCandidates(s.world, "kubectl get pvc a")).toContain("app-data");
  expect(execute(s, "sim kubernetes write-file --help").text).toContain("--content");
  expect(
    TreeSelection.describeCommand({
      kind: "kube-storage",
      resourceKind: "pv",
      projectId: "ace-dev-01",
      cluster: "storage-gke",
      name: "pvc-sim-10",
    }),
  ).toEqual({ some: true, value: "kubectl describe pv pvc-sim-10" });
  expect(KubeStorage.valid({ ...s.world, kubePvs: [...s.world.kubePvs, ...s.world.kubePvs] })).toBe(
    false,
  );
});
test("persistence mission requires repair, expanded claim, data and restart; intermediate/wrong values cannot clear", () => {
  let s = ready();
  s = session(Result.unwrap(Engine.startMission(s.world, "m-gke-022")));
  s = execute(s, "kubectl apply -f storage-claim.yaml", "kubectl apply -f storage-web.yaml");
  expect(s.world.missions.find((m) => m.id === "m-gke-022")?.status).not.toBe("completed");
  s = put(
    execute(
      s,
      "kubectl apply -f archive-class.yaml",
      "sim files replace storage-claim.yaml --search=1Gi --replacement=2Gi",
      "kubectl apply -f storage-claim.yaml",
    ),
    "survives-restart",
  );
  expect(s.world.missions.find((m) => m.id === "m-gke-022")?.status).not.toBe("completed");
  s = execute(s, "kubectl rollout restart deployment/storage-web");
  expect(s.world.missions.find((m) => m.id === "m-gke-022")?.status).toBe("completed");
});
test("retention mission requires PVC removal and Released data; Delete policy cannot clear", () => {
  let s = ready("retain-gke");
  s = session(Result.unwrap(Engine.startMission(s.world, "m-gke-023")));
  s = put(applied(s), "keep-me");
  s = execute(s, "kubectl delete pvc app-data");
  expect(s.world.missions.find((m) => m.id === "m-gke-023")?.status).not.toBe("completed");
  s = execute(s, "kubectl scale deployment/storage-web --replicas=0");
  expect(s.world.missions.find((m) => m.id === "m-gke-023")?.status).toBe("completed");
  const start = session(Result.unwrap(Engine.startMission(ready("retain-gke").world, "m-gke-023")));
  const deleted = execute(
    put(
      applied(
        execute(start, "sim files replace archive-class.yaml --search=Retain --replacement=Delete"),
      ),
      "keep-me",
    ),
    "kubectl delete deployment/storage-web",
    "kubectl delete pvc app-data",
  );
  expect(deleted.world.missions.find((m) => m.id === "m-gke-023")?.status).not.toBe("completed");
});

test("same-name storage in another project is independent and context namespace scopes helper writes", () => {
  let s = put(applied(), "dev-data");
  s = execute(
    s,
    "gcloud config set project ace-prod-01",
    "gcloud billing projects link ace-prod-01 --billing-account=01AB2C-DEF345-6789AB",
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create-auto storage-gke --region=us-central1",
    "kubectl apply -f archive-class.yaml",
    "kubectl apply -f storage-claim.yaml",
    "kubectl apply -f storage-web.yaml",
  );
  rejected(s, "kubectl exec deployment/storage-web -- cat /data/message.txt", "not found");
  s = put(s, "prod-data");
  expect(cat(s)).toBe("prod-data");
  s = execute(s, "gcloud config set project ace-dev-01");
  expect(cat(s)).toBe("dev-data");
  s = execute(
    s,
    "kubectl create ns staging",
    "kubectl config set-context --current --namespace=staging",
  );
  rejected(s, "sim kubernetes write-file storage-web --path=/data/x --content=wrong", "not found");
  expect(
    execute(s, "kubectl exec deployment/storage-web -n default -- cat /data/message.txt").text,
  ).toBe("dev-data");
});
test("claim/mount template changes and undo restore the original persistent data without copying it into a new claim", () => {
  let s = put(applied(), "original");
  const other = { ...claim(), metadata: { name: "other-data" } };
  s = execute(write(s, other), "kubectl apply -f storage.json");
  const d = workload();
  required(d.spec.template.spec.volumes[0]).persistentVolumeClaim.claimName = "other-data";
  s = execute(write(s, d), "kubectl apply -f storage.json");
  rejected(s, "kubectl exec deployment/storage-web -- cat /data/message.txt", "not found");
  s = put(s, "new-claim");
  s = execute(s, "kubectl rollout undo deployment/storage-web");
  expect(cat(s)).toBe("original");
  expect(s.world.kubePvs).toHaveLength(2);
});
test("liveness container restart preserves the volume identity and data", () => {
  const d = workload();
  Object.assign(required(d.spec.template.spec.containers[0]), {
    livenessProbe: { httpGet: { path: "/healthz", port: 80 }, failureThreshold: 1 },
  });
  let s = put(execute(write(applied(), d), "kubectl apply -f storage.json"));
  const pv = s.world.kubePvs[0];
  const pod = required(KubePod.fromDeployment(required(s.world.kubeDeployments[0]))[0]).name;
  s = execute(s, "sim kubernetes probe storage-web --kind=liveness --status-code=500");
  expect(cat(s)).toBe("hello");
  expect(s.world.kubePvs[0]).toEqual(pv);
  expect(required(KubePod.fromDeployment(required(s.world.kubeDeployments[0]))[0]).name).toBe(pod);
  expect(required(KubePod.fromDeployment(required(s.world.kubeDeployments[0]))[0]).restarts).toBe(
    1,
  );
});
test("write requires consuming Pods, explicit path and content and enforces total byte limits", () => {
  const s = applied();
  rejected(s, "sim kubernetes write-file storage-web --path=/data/x", "--content");
  rejected(s, "sim kubernetes write-file storage-web --content=x", "--path");
  const none = execute(s, "kubectl scale deployment/storage-web --replicas=0");
  rejected(
    none,
    "sim kubernetes write-file storage-web --path=/data/x --content=x",
    "no consuming Pods",
  );
  const full = {
    ...s.world,
    kubePvs: s.world.kubePvs.map((p) => ({
      ...p,
      files: [{ path: "large.txt", value: Buffer.alloc(1048576, 97).toString("base64") }],
    })),
  };
  rejected(
    session(full),
    "sim kubernetes write-file storage-web --path=/data/x --content=x",
    "1 MiB total",
  );
});
