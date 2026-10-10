// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { Now, run, type Session, session } from "@/engine/__tests__/setup";
import { KubeServiceRouting } from "@/engine/domains/kube-service-routing";
import { KubeStorage } from "@/engine/domains/kube-storage";
import { KubePod } from "@/engine/domains/kubernetes";
import { World } from "@/engine/domains/world";
import { Snapshot } from "@/engine/snapshot";
import { Result } from "@/utils/Result";

const required = <T>(v: T | undefined): T => {
  if (v === undefined) throw new Error("Missing fixture");
  return v;
};
const execute = (s: Session, ...commands: string[]): Session =>
  commands.reduce((s, command) => {
    const next = run(s, command);
    expect(next.text, command).not.toMatch(/^(ERROR:|error:|Error from server)/m);
    expect(World.validate(next.world), command).toEqual(Result.ok(next.world));
    return next;
  }, s);
const rejected = (s: Session, command: string, message: string) => {
  const next = run(s, command);
  expect(next.text, command).toContain(message);
  expect(next.world, command).toEqual(s.world);
};
const ready = (cluster = "stateful-gke") =>
  execute(
    session(),
    "gcloud services enable container.googleapis.com",
    `gcloud container clusters create-auto ${cluster} --region=us-central1`,
    "sim files load kubernetes-statefulset",
  );
const applied = (s = ready()) =>
  execute(s, "kubectl apply -f stateful-service.yaml", "kubectl apply -f stateful-notes.yaml");
const set = (s: Session) => required(s.world.kubeStatefulSets[0]);
const json = (s: Session, c: string) => JSON.parse(execute(s, c).text);
const pv = (s: Session, ordinal: number) =>
  required(KubeStorage.volume(s.world, set(s), `data-notes-${ordinal}`));
const writeData = (s: Session) =>
  execute(
    s,
    "sim kubernetes write-file pod/notes-0 --path=/data/note.txt --content=first-note",
    "sim kubernetes write-file pod/notes-1 --path=/data/note.txt --content=second-note",
  );
const cat = (s: Session, ordinal: number) =>
  execute(s, `kubectl exec notes-${ordinal} -- cat /data/note.txt`).text;
const restore = (s: Session) =>
  session(
    Result.unwrap(Snapshot.fromUnknown(JSON.parse(JSON.stringify(Snapshot.create(s.world, Now))))),
  );
const write = (s: Session, value: unknown, path = "stateful.json") =>
  execute(s, `sim files write ${path} --content='${JSON.stringify(value)}'`);
const manifest = () => ({
  apiVersion: "apps/v1",
  kind: "StatefulSet",
  metadata: { name: "notes" },
  spec: {
    serviceName: "notes-peers",
    podManagementPolicy: "Parallel",
    replicas: 2,
    selector: { matchLabels: { app: "notes" } },
    template: {
      metadata: { labels: { app: "notes" } },
      spec: {
        containers: [
          { name: "notes", image: "nginx:1", volumeMounts: [{ name: "data", mountPath: "/data" }] },
        ],
      },
    },
    volumeClaimTemplates: [
      {
        metadata: { name: "data" },
        spec: {
          accessModes: ["ReadWriteOnce"],
          storageClassName: "standard-rwo",
          resources: { requests: { storage: "1Gi" } },
        },
      },
    ],
  },
});

test("StatefulSet creates stable ordinal names and one independently bound PVC/PV per Pod", () => {
  const s = applied();
  expect(s.world.kubeDeployments).toEqual([]);
  expect(set(s).revision).toBe(1);
  expect(KubePod.fromDeployment(set(s)).map((p) => p.name)).toEqual(["notes-0", "notes-1"]);
  expect(s.world.kubePvcs.map((c) => c.name)).toEqual(["data-notes-0", "data-notes-1"]);
  expect(s.world.kubePvs).toHaveLength(2);
  expect(pv(s, 0).name).not.toBe(pv(s, 1).name);
  expect(json(s, "kubectl get sts/notes -o json").kind).toBe("StatefulSet");
  expect(json(s, "kubectl get statefulsets.apps -o json").items).toHaveLength(1);
  expect(json(s, "kubectl get rs -o json").items).toEqual([]);
});
test("Pod records resolve their own PVC and identity labels, hostname and governing Service", () => {
  const s = applied();
  const pod = json(s, "kubectl get pod notes-1 -o json");
  expect(pod.spec.volumes[0].persistentVolumeClaim.claimName).toBe("data-notes-1");
  expect(pod.metadata.labels["statefulset.kubernetes.io/pod-name"]).toBe("notes-1");
  expect(pod.metadata.labels["apps.kubernetes.io/pod-index"]).toBe("1");
  expect(pod.spec.hostname).toBe("notes-1");
  expect(pod.spec.subdomain).toBe("notes-peers");
  expect(pod.metadata.ownerReferences[0].kind).toBe("StatefulSet");
  expect(
    json(s, "kubectl get pods -l apps.kubernetes.io/pod-index=1 -o json").items.map(
      (p: { metadata: { name: string } }) => p.metadata.name,
    ),
  ).toEqual(["notes-1"]);
});
test("headless Service has no virtual cluster IP and resolves Ready StatefulSet backends", () => {
  const s = applied();
  const service = required(s.world.kubeServices[0]);
  expect(json(s, "kubectl get svc notes-peers -o json").spec.clusterIP).toBe("None");
  expect(KubeServiceRouting.backends(s.world, service).map((b) => b.pod)).toEqual([
    "notes-0",
    "notes-1",
  ]);
  const targeted = { ...service, selector: { "statefulset.kubernetes.io/pod-name": "notes-1" } };
  expect(KubeServiceRouting.backends(s.world, targeted).map((b) => b.pod)).toEqual(["notes-1"]);
});
test("deleting one Pod recreates only that stable name with its original PV and data", () => {
  const before = writeData(applied());
  const next = execute(before, "kubectl delete pod notes-0");
  expect(KubePod.fromDeployment(set(next)).map((p) => p.name)).toEqual(["notes-0", "notes-1"]);
  expect(set(next).podIncarnations[0]).toBeGreaterThan(set(before).podIncarnations[0] ?? 0);
  expect(set(next).podIncarnations[1]).toBe(set(before).podIncarnations[1]);
  expect(pv(next, 0)).toEqual(pv(before, 0));
  expect(cat(next, 0)).toBe("first-note");
  expect(cat(next, 1)).toBe("second-note");
});
test("scale down retains Bound claims even with Delete reclaim policy and scale up reuses data", () => {
  const before = writeData(applied());
  const down = execute(before, "kubectl scale sts/notes --replicas=1");
  expect(json(down, "kubectl get pods -o json").items).toHaveLength(1);
  expect(down.world.kubePvcs).toEqual(before.world.kubePvcs);
  expect(pv(down, 1).reclaimPolicy).toBe("Delete");
  expect(down.world.kubePvs).toEqual(before.world.kubePvs);
  const up = execute(down, "kubectl scale statefulset notes --replicas=2");
  expect(cat(up, 1)).toBe("second-note");
  expect(cat(up, 0)).toBe("first-note");
  expect(set(up).podIncarnations[0]).toBe(set(before).podIncarnations[0]);
  expect(set(up).statefulSet.lastScale).toEqual({
    from: 1,
    to: 2,
    reusedClaims: [{ name: "data-notes-1", volumeName: pv(before, 1).name }],
  });
});
test("scaling to zero preserves all claims and explicit StatefulSet deletion preserves PVs", () => {
  const before = writeData(applied());
  let s = execute(before, "kubectl scale sts/notes --replicas=0", "kubectl delete sts notes");
  expect(s.world.kubeStatefulSets).toEqual([]);
  expect(s.world.kubePvcs).toEqual(before.world.kubePvcs);
  expect(s.world.kubePvs).toEqual(before.world.kubePvs);
  s = execute(s, "kubectl create -f stateful-notes.yaml");
  expect(pv(s, 1).name).toBe(pv(before, 1).name);
  expect(cat(s, 1)).toBe("second-note");
});
test("StatefulSet deletion through a manifest retains data and direct PVC deletion still releases it", () => {
  const before = writeData(applied());
  let s = execute(before, "kubectl delete -f stateful-notes.yaml");
  expect(s.world.kubePvs).toEqual(before.world.kubePvs);
  s = execute(s, "kubectl delete pvc data-notes-1");
  expect(s.world.kubePvcs.map((c) => c.name)).toEqual(["data-notes-0"]);
  expect(s.world.kubePvs).toHaveLength(1);
});
test("PVC protection waits for StatefulSet consumers; explicit claim deletion removes data after scale down", () => {
  const before = writeData(applied());
  let s = execute(before, "kubectl delete pvc data-notes-1");
  expect(required(s.world.kubePvcs.find((c) => c.name === "data-notes-1")).deleting).toBe(Now);
  expect(pv(s, 1).files).toEqual(pv(before, 1).files);
  s = execute(s, "kubectl scale sts/notes --replicas=1", "kubectl scale sts/notes --replicas=2");
  expect(pv(s, 1).name).not.toBe(pv(before, 1).name);
  expect(pv(s, 1).files).toEqual([]);
  expect(set(s).statefulSet.lastScale?.reusedClaims).toEqual([]);
});
test("template image updates replace all Pods immediately while preserving names and PVC data", () => {
  const before = writeData(applied());
  const m = manifest();
  required(m.spec.template.spec.containers[0]).image = "nginx:2";
  const s = execute(write(before, m), "kubectl apply -f stateful.json");
  expect(set(s).image).toBe("nginx:2");
  expect(set(s).revision).toBe(2);
  expect(set(s).podIncarnations.every((n) => n > 0)).toBe(true);
  expect(KubePod.fromDeployment(set(s)).map((p) => p.name)).toEqual(["notes-0", "notes-1"]);
  expect(s.world.kubePvs).toEqual(before.world.kubePvs);
  expect(cat(s, 0)).toBe("first-note");
});
test("apply is unchanged for identical specs and replica-only apply preserves existing Pod state", () => {
  const before = writeData(applied());
  const same = execute(before, "kubectl apply -f stateful-notes.yaml");
  expect(same.text).toContain("unchanged");
  expect(same.world).toEqual(before.world);
  const m = manifest();
  m.spec.replicas = 1;
  const down = execute(write(before, m), "kubectl apply -f stateful.json");
  m.spec.replicas = 2;
  const up = execute(write(down, m), "kubectl apply -f stateful.json");
  expect(set(up).revision).toBe(1);
  expect(cat(up, 1)).toBe("second-note");
  expect(set(up).statefulSet.lastScale?.reusedClaims).toHaveLength(1);
});
test("missing StorageClass keeps all ordinal claims Pending and late creation repairs mounts", () => {
  const m = manifest();
  required(m.spec.volumeClaimTemplates[0]).spec.storageClassName = "late";
  let s = execute(write(ready(), m), "kubectl apply -f stateful.json");
  expect(json(s, "kubectl get sts notes -o json").status.readyReplicas).toBe(0);
  expect(
    json(s, "kubectl get all -o json").items.find((r: { kind: string }) => r.kind === "StatefulSet")
      .status.readyReplicas,
  ).toBe(0);
  expect(execute(s, "kubectl get pods").text).toContain("ContainerCreating");
  rejected(s, "kubectl exec notes-0 -- env", "FailedMount");
  s = execute(
    write(
      s,
      {
        apiVersion: "storage.k8s.io/v1",
        kind: "StorageClass",
        metadata: { name: "late" },
        provisioner: "pd.csi.storage.gke.io",
        volumeBindingMode: "WaitForFirstConsumer",
      },
      "class.json",
    ),
    "kubectl apply -f class.json",
  );
  expect(json(s, "kubectl get sts notes -o json").status.readyReplicas).toBe(2);
  expect(s.world.kubePvs).toHaveLength(2);
});
test("zero replicas materialize no claims; only newly active ordinals create PVCs", () => {
  const m = manifest();
  m.spec.replicas = 0;
  let s = execute(write(ready(), m), "kubectl apply -f stateful.json");
  expect(s.world.kubePvcs).toEqual([]);
  s = execute(s, "kubectl scale sts/notes --replicas=3");
  expect(s.world.kubePvcs.map((c) => c.name)).toEqual([
    "data-notes-0",
    "data-notes-1",
    "data-notes-2",
  ]);
});
test("selector, governing Service and claim templates are immutable on a live StatefulSet", () => {
  const s = applied();
  for (const change of [
    (m: ReturnType<typeof manifest>) => {
      m.spec.serviceName = "other";
    },
    (m: ReturnType<typeof manifest>) => {
      required(m.spec.volumeClaimTemplates[0]).spec.resources.requests.storage = "2Gi";
    },
    (m: ReturnType<typeof manifest>) => {
      required(m.spec.volumeClaimTemplates[0]).spec.storageClassName = "premium-rwo";
    },
    (m: ReturnType<typeof manifest>) => {
      m.spec.selector.matchLabels.app = "other";
      m.spec.template.metadata.labels.app = "other";
    },
  ]) {
    const m = manifest();
    change(m);
    rejected(write(s, m), "kubectl apply -f stateful.json", "immutable");
  }
});
const invalidCases: readonly [string, (m: ReturnType<typeof manifest>) => void, string][] = [
  [
    "default OrderedReady",
    (m) => {
      Reflect.deleteProperty(m.spec, "podManagementPolicy");
    },
    "Parallel",
  ],
  [
    "OrderedReady",
    (m) => {
      m.spec.podManagementPolicy = "OrderedReady";
    },
    "Parallel",
  ],
  [
    "OnDelete",
    (m) => {
      Object.assign(m.spec, { updateStrategy: { type: "OnDelete" } });
    },
    "OnDelete",
  ],
  [
    "partition",
    (m) => {
      Object.assign(m.spec, {
        updateStrategy: { type: "RollingUpdate", rollingUpdate: { partition: 1 } },
      });
    },
    "Unsupported",
  ],
  [
    "Delete on scale",
    (m) => {
      Object.assign(m.spec, { persistentVolumeClaimRetentionPolicy: { whenScaled: "Delete" } });
    },
    "Retain",
  ],
  [
    "Delete on delete",
    (m) => {
      Object.assign(m.spec, { persistentVolumeClaimRetentionPolicy: { whenDeleted: "Delete" } });
    },
    "Retain",
  ],
  [
    "ordinals.start",
    (m) => {
      Object.assign(m.spec, { ordinals: { start: 3 } });
    },
    "Unsupported",
  ],
  [
    "multiple containers",
    (m) => {
      m.spec.template.spec.containers.push({ name: "sidecar", image: "nginx:1", volumeMounts: [] });
    },
    "exactly one",
  ],
  [
    "resource requirements",
    (m) => {
      Object.assign(required(m.spec.template.spec.containers[0]), {
        resources: { requests: { cpu: "1" } },
      });
    },
    "Unsupported",
  ],
  [
    "readiness probe",
    (m) => {
      Object.assign(required(m.spec.template.spec.containers[0]), {
        readinessProbe: { httpGet: { path: "/", port: 8080 } },
      });
    },
    "Unsupported",
  ],
  [
    "RWX",
    (m) => {
      required(m.spec.volumeClaimTemplates[0]).spec.accessModes = ["ReadWriteMany"];
    },
    "ReadWriteOnce",
  ],
  [
    "fractional capacity",
    (m) => {
      required(m.spec.volumeClaimTemplates[0]).spec.resources.requests.storage = "1.5Gi";
    },
    "integer",
  ],
  [
    "duplicate templates",
    (m) => {
      m.spec.volumeClaimTemplates.push(required(m.spec.volumeClaimTemplates[0]));
    },
    "Duplicate",
  ],
  [
    "unmounted template",
    (m) => {
      required(m.spec.template.spec.containers[0]).volumeMounts = [];
    },
    "mounted",
  ],
  [
    "generated PVC name overflow",
    (m) => {
      m.metadata.name = "n".repeat(59);
      required(m.spec.template.spec.containers[0]).name = m.metadata.name;
    },
    "63 characters",
  ],
  [
    "negative replicas",
    (m) => {
      m.spec.replicas = -1;
    },
    "0 to 1000",
  ],
  [
    "identity label override",
    (m) => {
      Object.assign(m.spec.template.metadata.labels, { "apps.kubernetes.io/pod-index": "4" });
    },
    "managed",
  ],
];
test.each(invalidCases)(
  "rejects unsupported or invalid %s atomically",
  (_name, mutate, message) => {
    const m = manifest();
    mutate(m);
    const s = write(ready(), m);
    rejected(s, "kubectl apply -f stateful.json", message);
  },
);
test("headless Service restrictions and immutability are enforced", () => {
  const s = applied();
  const service = {
    apiVersion: "v1",
    kind: "Service",
    metadata: { name: "notes-peers" },
    spec: {
      type: "NodePort",
      clusterIP: "None",
      selector: { app: "notes" },
      ports: [{ port: 8080 }],
    },
  };
  rejected(write(s, service), "kubectl apply -f stateful.json", "headless");
  service.spec.type = "ClusterIP";
  service.spec.clusterIP = "10.1.2.3";
  rejected(write(s, service), "kubectl apply -f stateful.json", "headless");
  Reflect.deleteProperty(service.spec, "clusterIP");
  rejected(write(s, service), "kubectl apply -f stateful.json", "headless clusterIP");
});
test("missing or mismatched governing Service is diagnosed separately from Pod readiness", () => {
  let s = execute(ready(), "kubectl apply -f stateful-notes.yaml");
  expect(execute(s, "kubectl describe sts notes").text).toContain("Governing Service not found");
  expect(json(s, "kubectl get sts notes -o json").status.readyReplicas).toBe(2);
  s = execute(s, "kubectl apply -f stateful-service.yaml", "kubectl delete svc notes-peers");
  expect(s.world.kubeStatefulSets).toHaveLength(1);
  expect(s.world.kubePvcs).toHaveLength(2);
});
test("namespace and cluster deletion remove StatefulSets without touching another namespace", () => {
  let s = applied();
  s = execute(
    s,
    "kubectl create namespace team",
    "kubectl apply -f stateful-service.yaml -n team",
    "kubectl apply -f stateful-notes.yaml -n team",
  );
  expect(s.world.kubeStatefulSets).toHaveLength(2);
  expect(s.world.kubePvcs).toHaveLength(4);
  expect(json(s, "kubectl get sts -A -o json").items).toHaveLength(2);
  expect(json(s, "kubectl get pods -A -o json").items).toHaveLength(4);
  s = execute(s, "kubectl delete namespace team");
  expect(s.world.kubeStatefulSets).toHaveLength(1);
  expect(s.world.kubePvcs).toHaveLength(2);
  s = execute(s, "gcloud container clusters delete stateful-gke --region=us-central1 --quiet");
  expect(s.world.kubeStatefulSets).toEqual([]);
  expect(s.world.kubePvcs).toEqual([]);
});
test("Deployment and StatefulSet with the same name stay separate and use distinct Pod networks", () => {
  const s = execute(applied(), "kubectl create deployment notes --image=nginx:1");
  const pods = [...s.world.kubeDeployments, ...s.world.kubeStatefulSets].flatMap(
    KubePod.fromDeployment,
  );
  expect(new Set(pods.map((p) => p.ip)).size).toBe(3);
  expect(json(s, "kubectl get deployment notes -o json").kind).toBe("Deployment");
  expect(
    json(s, "kubectl get all -o json").items.filter(
      (r: { kind: string }) => r.kind === "StatefulSet",
    ),
  ).toHaveLength(1);
  rejected(s, "kubectl autoscale sts/notes --max=3 --cpu-percent=80", "expected a deployment");
  rejected(s, "kubectl set image sts/notes notes=nginx:2", "expected a deployment");
});
test("viewer reads StatefulSets and Pods but cannot create, update, delete or write data", () => {
  const s = execute(
    applied(),
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:viewer@example.com --role=roles/container.viewer",
    "gcloud auth login viewer@example.com",
  );
  execute(
    s,
    "kubectl get sts",
    "kubectl describe sts notes",
    "kubectl get pods",
    "kubectl get pvc",
  );
  rejected(s, "kubectl scale sts/notes --replicas=1", "container.statefulSets.update");
  rejected(s, "kubectl delete sts notes", "container.statefulSets.delete");
  rejected(s, "kubectl create -f stateful-notes.yaml", "container.statefulSets.create");
  rejected(
    s,
    "sim kubernetes write-file pod/notes-0 --path=/data/note.txt --content=x",
    "container.pods.exec",
  );
});
test("StatefulSet name, Pod and write-target completion uses the current cluster", () => {
  const s = applied();
  expect(Engine.completionCandidates(s.world, "kubectl get sts no")).toEqual(["notes"]);
  expect(Engine.completionCandidates(s.world, "kubectl delete pod no")).toEqual([
    "notes-0",
    "notes-1",
  ]);
  expect(Engine.completionCandidates(s.world, "sim kubernetes write-file pod/no")).toEqual([
    "pod/notes-0",
    "pod/notes-1",
  ]);
});
test("StatefulSet write permissions operate without granting Deployment update or delete", () => {
  let s = execute(
    applied(),
    "gcloud iam roles create statefulWriter --permissions=container.statefulSets.create,container.statefulSets.update,container.statefulSets.delete,container.pods.exec",
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:writer@example.com --role=roles/container.viewer",
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:writer@example.com --role=projects/ace-dev-01/roles/statefulWriter",
    "gcloud auth login writer@example.com",
  );
  s = execute(
    s,
    "kubectl scale sts/notes --replicas=1",
    "sim kubernetes write-file pod/notes-0 --path=/data/note.txt --content=x",
    "kubectl delete sts notes",
    "kubectl create -f stateful-notes.yaml",
  );
  expect(cat(s, 0)).toBe("x");
  rejected(s, "kubectl scale deployment/notes --replicas=2", "container.deployments.update");
});
test("a later multi-document permission failure commits no StatefulSet or generated PVCs", () => {
  const m = manifest();
  m.metadata.name = "another";
  required(m.spec.template.spec.containers[0]).name = "another";
  const secret = {
    apiVersion: "v1",
    kind: "Secret",
    metadata: { name: "new-secret" },
    stringData: { key: "value" },
  };
  const s = execute(
    ready(),
    `sim files write atomic.yaml --content='${JSON.stringify(m)}\n---\n${JSON.stringify(secret)}'`,
    "gcloud iam roles create statefulWriter --permissions=container.statefulSets.create",
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:writer@example.com --role=roles/container.viewer",
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:writer@example.com --role=projects/ace-dev-01/roles/statefulWriter",
    "gcloud auth login writer@example.com",
  );
  rejected(s, "kubectl apply -f atomic.yaml", "container.secrets.get");
  expect(s.world.kubePvcs).toEqual([]);
  expect(s.world.kubeStatefulSets).toEqual([]);
});
test("Container API enablement is required for StatefulSet reads", () => {
  const s = execute(applied(), "gcloud services disable container.googleapis.com --quiet");
  rejected(s, "kubectl get sts", "container.googleapis.com");
});
test("creating a StatefulSet cannot adopt incompatible retained claims", () => {
  const s = execute(applied(), "kubectl delete sts notes");
  const m = manifest();
  required(m.spec.volumeClaimTemplates[0]).spec.storageClassName = "premium-rwo";
  rejected(write(s, m), "kubectl create -f stateful.json", "incompatible");
});
test("a StatefulSet application write targets the declared ordinal and respects read-only mounts", () => {
  const m = manifest();
  Object.assign(required(m.spec.template.spec.containers[0]).volumeMounts[0] ?? {}, {
    readOnly: true,
  });
  const s = execute(write(ready(), m), "kubectl create -f stateful.json");
  rejected(
    s,
    "sim kubernetes write-file pod/notes-1 --path=/data/note.txt --content=x",
    "read-only",
  );
});
test("current Snapshot preserves StatefulSet identities, scale history and per-ordinal data", () => {
  const s = execute(
    writeData(applied()),
    "kubectl delete pod notes-0",
    "kubectl scale sts/notes --replicas=1",
    "kubectl scale sts/notes --replicas=2",
  );
  const next = restore(s);
  expect(next.world).toEqual(s.world);
  expect(cat(next, 1)).toBe("second-note");
  expect(Snapshot.create(next.world, Now).schemaVersion).toBe(39);
});
test("v28 migration adds empty StatefulSets and preserves private endpoint and node-pool state", () => {
  let s = ready();
  s = execute(
    s,
    "gcloud container clusters create private --region=us-central1 --enable-private-nodes --enable-ip-alias --master-ipv4-cidr=172.16.0.0/28 --enable-private-endpoint",
    "gcloud container clusters get-credentials private --region=us-central1 --internal-ip",
  );
  const raw = JSON.parse(JSON.stringify(Snapshot.create(s.world, Now)));
  raw.schemaVersion = 28;
  Reflect.deleteProperty(raw.world, "kubeStatefulSets");
  const next = Result.unwrap(Snapshot.fromUnknown(raw));
  expect(next.kubeStatefulSets).toEqual([]);
  expect(next.nodePools).toEqual(s.world.nodePools);
  expect(next.clusters).toEqual(s.world.clusters);
  expect(next.kubeContextEndpoints).toEqual(s.world.kubeContextEndpoints);
});
test("malformed or inconsistent StatefulSet snapshots are rejected", () => {
  const s = applied();
  for (const mutate of [
    (r: { world: { kubeStatefulSets: Record<string, unknown>[] } }) => {
      required(r.world.kubeStatefulSets[0]).statefulSet = {
        serviceName: "notes-peers",
        volumeClaimTemplates: [],
      };
    },
    (r: { world: { kubeStatefulSets: Record<string, unknown>[] } }) => {
      required(r.world.kubeStatefulSets[0]).podIncarnations = [0];
    },
  ]) {
    const raw = JSON.parse(JSON.stringify(Snapshot.create(s.world, Now)));
    mutate(raw);
    expect(Result.isOk(Snapshot.fromUnknown(raw))).toBe(false);
  }
});
test("mission for one-Pod recovery requires both separate data files and an untouched second Pod", () => {
  let s = session(Result.unwrap(Engine.startMission(ready().world, "m-gke-032")));
  s = writeData(applied(s));
  expect(s.world.missions.find((m) => m.id === "m-gke-032")?.status).not.toBe("completed");
  const wrong = execute(s, "kubectl delete pod notes-1");
  expect(wrong.world.missions.find((m) => m.id === "m-gke-032")?.status).not.toBe("completed");
  s = execute(s, "kubectl delete pod notes-0");
  expect(s.world.missions.find((m) => m.id === "m-gke-032")?.status).toBe("completed");
});
test("scale mission requires actual 1-to-2 reuse, not just Pod deletion or fresh replacement claims", () => {
  let s = session(
    Result.unwrap(Engine.startMission(ready("stateful-scale-gke").world, "m-gke-033")),
  );
  s = writeData(applied(s));
  const wrong = execute(s, "kubectl delete pod notes-1");
  expect(wrong.world.missions.find((m) => m.id === "m-gke-033")?.status).not.toBe("completed");
  const down = execute(s, "kubectl scale sts/notes --replicas=1");
  expect(down.world.missions.find((m) => m.id === "m-gke-033")?.status).not.toBe("completed");
  const fresh = execute(
    down,
    "kubectl delete pvc data-notes-1",
    "kubectl scale sts/notes --replicas=2",
    "sim kubernetes write-file pod/notes-1 --path=/data/note.txt --content=second-note",
  );
  expect(fresh.world.missions.find((m) => m.id === "m-gke-033")?.status).not.toBe("completed");
  const up = execute(down, "kubectl scale sts/notes --replicas=2");
  expect(up.world.missions.find((m) => m.id === "m-gke-033")?.status).toBe("completed");
});
