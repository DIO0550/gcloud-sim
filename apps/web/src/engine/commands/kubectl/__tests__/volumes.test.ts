// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { Now, run, type Session, session } from "@/engine/__tests__/setup";
import { KubeManifest } from "@/engine/domains/kube-manifest";
import { KubeServiceRouting } from "@/engine/domains/kube-service-routing";
import { World } from "@/engine/domains/world";
import { Snapshot } from "@/engine/snapshot";
import { Result } from "@/utils/Result";

const execute = (s: Session, ...commands: string[]) =>
  commands.reduce((s, c) => {
    const next = run(s, c);
    expect(next.text, c).not.toMatch(/^(ERROR:|error:|Error from server)/m);
    expect(World.validate(next.world), c).toEqual(Result.ok(next.world));
    return next;
  }, s);
const rejected = (s: Session, command: string, message: string) => {
  const next = run(s, command);
  expect(next.text).toContain(message);
  expect(next.world).toEqual(s.world);
};
const restore = (s: Session) =>
  session(
    Result.unwrap(Snapshot.fromUnknown(JSON.parse(JSON.stringify(Snapshot.create(s.world, Now))))),
  );
const ready = (s = session(), reload = false) =>
  execute(
    s,
    "gcloud services enable container.googleapis.com",
    `gcloud container clusters create-auto ${reload ? "reload" : "volume"}-gke --region=us-central1`,
    `sim files load kubernetes-${reload ? "volume-refresh" : "volumes"}`,
  );
const applied = (s = session()) =>
  execute(
    ready(s),
    "kubectl apply -f volume-settings.yaml",
    "kubectl apply -f volume-credentials.yaml",
    "kubectl apply -f volume-web.yaml",
  );
const fix = (s: Session) =>
  execute(
    s,
    "sim files replace volume-web.yaml --search='key: missing.conf' --replacement='key: app.conf'",
    "kubectl apply -f volume-web.yaml",
  );
const reloaded = (s = session()) =>
  execute(
    ready(s, true),
    "kubectl apply -f reload-settings.yaml",
    "kubectl apply -f reload-web.yaml",
  );
const update = (s: Session) =>
  execute(
    s,
    "sim files replace reload-settings.yaml --search='MODE: staging' --replacement='MODE: production'",
    "kubectl apply -f reload-settings.yaml",
  );
const json = (s: Session, c: string) => JSON.parse(execute(s, c).text);
const write = (s: Session, data: unknown) =>
  execute(s, `sim files write volume.json --content='${JSON.stringify(data)}'`);
const deployment = (ns?: string) => ({
  apiVersion: "apps/v1",
  kind: "Deployment",
  metadata: { name: "web", ...(ns ? { namespace: ns } : {}) },
  spec: {
    replicas: 2,
    selector: { matchLabels: { app: "web" } },
    template: {
      metadata: { labels: { app: "web" } },
      spec: {
        volumes: [{ name: "settings", configMap: { name: "settings" } }],
        containers: [
          {
            name: "web",
            image: "nginx:1",
            volumeMounts: [{ name: "settings", mountPath: "/etc/config" }],
          },
        ],
      },
    },
  },
});
const mode = (s: Session, path = "/etc/config/MODE") =>
  execute(s, `kubectl exec deployment/reload-web -- cat ${path}`).text;
const status = (s: Session, id: string) => s.world.missions.find((m) => m.id === id)?.status;

test("missing items wait with FailedMount, repaired mounts expose text, Secret and arbitrary binary bytes", () => {
  const s = applied();
  expect(execute(s, "kubectl get pods").text).toContain("ContainerCreating");
  expect(execute(s, "kubectl describe deployment volume-web").text).toContain("missing.conf");
  rejected(s, "kubectl rollout status deployment/volume-web", "FailedMount");
  rejected(s, "kubectl exec deployment/volume-web -- cat /etc/app/app.conf", "FailedMount");
  expect(s.world.kubeDeployments[0]?.podEnvironments).toEqual([]);
  const next = fix(s);
  execute(next, "kubectl rollout status deployment/volume-web");
  expect(execute(next, "kubectl exec deployment/volume-web -- cat /etc/app/app.conf").text).toBe(
    "production",
  );
  expect(
    execute(next, "kubectl exec deployment/volume-web -- cat /etc/credentials/TOKEN").text,
  ).toBe("demo-volume-token");
  expect(
    execute(next, "kubectl exec deployment/volume-web -- base64 /etc/app/assets/asset.bin").text,
  ).toBe("AP+AAQ==");
  rejected(
    next,
    "kubectl exec deployment/volume-web -- cat /etc/app/assets/asset.bin",
    "non-UTF-8",
  );
  rejected(next, "kubectl exec deployment/volume-web -- cat /etc/app/missing", "not found");
  expect(execute(next, "kubectl get deployments volume-web -o yaml").text).toContain(
    "volumeMounts:",
  );
  expect(json(next, "kubectl get pods -o json").items[0].spec.volumes).toHaveLength(2);
  expect(json(next, "kubectl get rs -o json").items[0].spec.template.spec.volumes).toHaveLength(2);
  expect(
    execute(next, "kubectl rollout history deployment/volume-web --revision=1").text,
  ).toContain("missing.conf");
});

test("regular projections refresh without rollout while subPath and env remain saved through Snapshot", () => {
  const s = reloaded();
  const d = s.world.kubeDeployments[0];
  const next = restore(update(s));
  expect(mode(next)).toBe("production");
  expect(mode(next, "/etc/mode.conf")).toBe("staging");
  expect(execute(next, "kubectl exec deployment/reload-web -- printenv MODE").text).toBe("staging");
  expect(next.world.kubeDeployments[0]?.revision).toBe(d?.revision);
  expect(next.world.kubeDeployments[0]?.podIncarnations).toEqual(d?.podIncarnations);
  const restarted = execute(next, "kubectl rollout restart deployment/reload-web");
  expect(mode(restarted)).toBe("production");
  expect(mode(restarted, "/etc/mode.conf")).toBe("production");
  expect(execute(restarted, "kubectl exec deployment/reload-web -- printenv MODE").text).toBe(
    "production",
  );
});

test("one replaced Pod gets fresh subPath/env; scale preserves old caches and new Pods resolve fresh data", () => {
  const s = update(reloaded());
  const names = json(s, "kubectl get pods -o json").items.map((p: { name: string }) => p.name);
  const next = execute(s, `kubectl delete pod ${names[0]}`);
  const fresh = json(next, "kubectl get pods -o json").items[0].name;
  expect(execute(next, `kubectl exec ${fresh} -- cat /etc/mode.conf`).text).toBe("production");
  expect(execute(next, `kubectl exec ${names[1]} -- cat /etc/mode.conf`).text).toBe("staging");
  const larger = execute(next, "kubectl scale deployment/reload-web --replicas=3");
  const added = json(larger, "kubectl get pods -o json").items[2].name;
  expect(execute(larger, `kubectl exec ${added} -- cat /etc/mode.conf`).text).toBe("production");
  expect(execute(larger, `kubectl exec ${names[1]} -- cat /etc/mode.conf`).text).toBe("staging");
  const smaller = execute(larger, "kubectl scale deployment/reload-web --replicas=0");
  expect(smaller.world.kubeDeployments[0]?.podFiles).toEqual([]);
});

test("deleting a required source preserves existing files but blocks new Pods; recreating it recovers them", () => {
  const s = execute(
    reloaded(),
    "kubectl delete cm reload-settings",
    "kubectl scale deployment/reload-web --replicas=3",
  );
  expect(mode(s)).toBe("staging");
  expect(execute(s, "kubectl get pods").text).toContain("ContainerCreating");
  const next = update(s);
  expect(execute(next, "kubectl get pods").text).not.toContain("ContainerCreating");
  expect(mode(next)).toBe("production");
  expect(mode(next, "/etc/mode.conf")).toBe("staging");
  const newest = json(next, "kubectl get pods -o json").items[2].name;
  expect(execute(next, `kubectl exec ${newest} -- cat /etc/mode.conf`).text).toBe("production");
});

test.each(["configMap", "secret"])(
  "optional %s missing resource/key starts with empty files then gets projected data",
  (source) => {
    const m = deployment();
    m.spec.template.spec.volumes = [
      {
        name: "settings",
        [source]: {
          [source === "secret" ? "secretName" : "name"]: "settings",
          optional: true,
          items: [{ key: "MODE", path: "nested/mode" }],
        },
      },
    ] as unknown as typeof m.spec.template.spec.volumes;
    const s = execute(write(ready(), m), "kubectl apply -f volume.json");
    execute(s, "kubectl rollout status deployment/web");
    rejected(s, "kubectl exec deployment/web -- cat /etc/config/nested/mode", "not found");
    const command =
      source === "secret"
        ? "kubectl create secret generic settings"
        : "kubectl create configmap settings";
    const next = execute(s, `${command} --from-literal=MODE=ready`);
    expect(execute(next, "kubectl exec deployment/web -- cat /etc/config/nested/mode").text).toBe(
      "ready",
    );
  },
);

test("removed selected keys retain running projections on refresh failure and fail new Pods", () => {
  const s = fix(applied());
  const edited = execute(
    s,
    "sim files replace volume-settings.yaml --search='  app.conf: production' --replacement='  OTHER: changed'",
    "kubectl apply -f volume-settings.yaml",
    "kubectl scale deployment/volume-web --replicas=3",
  );
  expect(execute(edited, "kubectl exec deployment/volume-web -- cat /etc/app/app.conf").text).toBe(
    "production",
  );
  expect(execute(edited, "kubectl get pods").text).toContain("ContainerCreating");
  const next = execute(
    edited,
    "sim files replace volume-settings.yaml --search='  OTHER: changed' --replacement='  app.conf: updated'",
    "kubectl apply -f volume-settings.yaml",
  );
  expect(execute(next, "kubectl exec deployment/volume-web -- cat /etc/app/app.conf").text).toBe(
    "updated",
  );
});

test("apply volumes creates one revision, reapply is unchanged, undo restores mounts and reads current source", () => {
  const s = fix(applied());
  const before = s.world.kubeDeployments[0];
  const changed = execute(
    s,
    "sim files replace volume-web.yaml --search='mountPath: /etc/app' --replacement='mountPath: /etc/other'",
    "kubectl apply -f volume-web.yaml",
  );
  expect(changed.world.kubeDeployments[0]?.revision).toBe((before?.revision ?? 0) + 1);
  expect(execute(changed, "kubectl apply -f volume-web.yaml").world).toEqual(changed.world);
  rejected(changed, "kubectl exec deployment/volume-web -- cat /etc/app/app.conf", "not found");
  const undone = execute(
    restore(changed),
    `kubectl rollout undo deployment/volume-web --to-revision=${before?.revision}`,
  );
  expect(execute(undone, "kubectl exec deployment/volume-web -- cat /etc/app/app.conf").text).toBe(
    "production",
  );
  expect(undone.world.kubeDeployments[0]?.volumeMounts).toEqual(before?.volumeMounts);
});

test("namespace sources do not leak; explicit exec namespace and context default agree", () => {
  const m = deployment("staging");
  const s = execute(
    write(ready(), m),
    "kubectl create ns staging",
    "kubectl create configmap settings --from-literal=MODE=default",
    "kubectl apply -f volume.json",
  );
  expect(execute(s, "kubectl get pods -n staging").text).toContain("ContainerCreating");
  const next = execute(
    s,
    "kubectl create configmap settings --from-literal=MODE=staging -n staging",
  );
  expect(execute(next, "kubectl exec deployment/web -n staging -- cat /etc/config/MODE").text).toBe(
    "staging",
  );
  const context = execute(next, "kubectl config set-context --current --namespace=staging");
  expect(execute(context, "kubectl exec deployment/web -- cat /etc/config/MODE").text).toBe(
    "staging",
  );
  const deleted = execute(next, "kubectl delete ns staging");
  expect(deleted.world.kubeDeployments).toHaveLength(0);
});

test.each([
  (m: ReturnType<typeof deployment>) => {
    m.spec.template.spec.volumes = [{ name: "settings", configMap: { name: "missing" } }];
  },
])("missing source is accepted by apply and diagnosed at Pod startup", (mutate) => {
  const m = deployment();
  mutate(m);
  const s = execute(write(ready(), m), "kubectl apply -f volume.json");
  expect(execute(s, "kubectl get pods").text).toContain("ContainerCreating");
  expect(execute(s, "kubectl describe deployment web").text).toContain("missing");
});

test.each([
  ["unknown mount", { name: "unknown", mountPath: "/etc/config" }],
  ["relative mount", { name: "settings", mountPath: "etc/config" }],
  ["traversal mount", { name: "settings", mountPath: "/etc/../config" }],
  ["traversal subPath", { name: "settings", mountPath: "/etc/config", subPath: "../MODE" }],
  ["wrong readOnly", { name: "settings", mountPath: "/etc/config", readOnly: "true" }],
  ["unknown field", { name: "settings", mountPath: "/etc/config", subPathExpr: "MODE" }],
])("invalid volume mount is rejected atomically: %s", (_label, mount) => {
  const m = deployment();
  const container = m.spec.template.spec.containers[0];
  if (!container) throw new Error("fixture container");
  container.volumeMounts = [mount] as (typeof m.spec.template.spec.containers)[0]["volumeMounts"];
  const s = write(ready(), m);
  rejected(s, "kubectl apply -f volume.json", "error:");
});

test.each([
  { name: "settings", configMap: { name: "settings", optional: "true" } },
  { name: "settings", configMap: { name: "settings", items: [{ key: "MODE", path: "../mode" }] } },
  {
    name: "settings",
    configMap: {
      name: "settings",
      items: [
        { key: "MODE", path: "a" },
        { key: "OTHER", path: "a/b" },
      ],
    },
  },
  {
    name: "settings",
    configMap: {
      name: "settings",
      items: [
        { key: "MODE", path: "a" },
        { key: "MODE", path: "b" },
      ],
    },
  },
  { name: "settings", configMap: { name: "settings" }, secret: { secretName: "settings" } },
  { name: "settings", emptyDir: {} },
  { name: "settings", configMap: { name: "settings", defaultMode: 420 } },
])("unsupported or malformed volumes are rejected: %j", (volume) => {
  const m = deployment();
  m.spec.template.spec.volumes = [volume] as typeof m.spec.template.spec.volumes;
  expect(Result.isOk(KubeManifest.parse(JSON.stringify(m)))).toBe(false);
  const s = write(ready(), m);
  rejected(s, "kubectl apply -f volume.json", "error:");
});

test("overlapping mounts and duplicate volumes are rejected", () => {
  const m = deployment();
  m.spec.template.spec.containers[0]?.volumeMounts.push({
    name: "settings",
    mountPath: "/etc/config/nested",
  });
  expect(Result.isOk(KubeManifest.parse(JSON.stringify(m)))).toBe(false);
  const duplicate = deployment();
  duplicate.spec.template.spec.volumes.push({ name: "settings", configMap: { name: "settings" } });
  expect(Result.isOk(KubeManifest.parse(JSON.stringify(duplicate)))).toBe(false);
});

test("exec enforces API and IAM and rejects shell/unmounted host paths", () => {
  const s = fix(applied());
  rejected(
    execute(s, "gcloud services disable container.googleapis.com"),
    "kubectl exec deployment/volume-web -- cat /etc/app/app.conf",
    "disabled",
  );
  const viewer = execute(
    s,
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:viewer@example.com --role=roles/container.viewer",
    "gcloud auth login viewer@example.com",
  );
  rejected(
    viewer,
    "kubectl exec deployment/volume-web -- cat /etc/credentials/TOKEN",
    "container.pods.exec",
  );
  execute(viewer, "kubectl get deployments volume-web -o yaml");
  rejected(s, "kubectl exec deployment/volume-web -- sh -c cat", "Only exec");
  rejected(s, "kubectl exec deployment/volume-web -- cat /etc/passwd", "not found");
  rejected(s, "kubectl exec deployment/volume-web -- cat /etc/app/app.conf extra", "Only exec");
  expect(Engine.completionCandidates(s.world, "sim files load kubernetes-vol")).toContain(
    "kubernetes-volumes",
  );
  expect(execute(s, "kubectl exec --help").text).toContain("cat");
});

test("multi-resource apply fails without committing earlier projection updates", () => {
  const s = reloaded();
  const cm = {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: { name: "reload-settings" },
    data: { MODE: "production" },
  };
  const bad = deployment();
  bad.spec.selector.matchLabels.app = "wrong";
  const bundle = execute(
    s,
    `sim files write atomic.yaml --content='${JSON.stringify(cm)}\n---\n${JSON.stringify(bad)}'`,
  );
  rejected(bundle, "kubectl apply -f atomic.yaml", "selector");
  expect(mode(bundle)).toBe("staging");
});

test("Snapshot 23 round trips stale subPath caches and rejects altered file/path/template state", () => {
  const s = update(reloaded());
  expect(restore(s).world).toEqual(s.world);
  for (const mutate of [
    (d: Record<string, unknown>) => {
      d.podFiles = [{ podName: "foreign", files: [] }];
    },
    (d: Record<string, unknown>) => {
      d.podFiles = [
        {
          podName: s.world.kubeDeployments[0]?.podFiles[0]?.podName,
          files: [{ path: "/etc/passwd", value: "eA==" }],
        },
      ];
    },
    (d: Record<string, unknown>) => {
      d.volumeMounts = [];
    },
    (d: Record<string, unknown>) => {
      d.podFiles = [
        {
          podName: s.world.kubeDeployments[0]?.podFiles[0]?.podName,
          files: [{ path: "/etc/config/MODE", value: "***" }],
        },
      ];
    },
  ]) {
    const raw = JSON.parse(JSON.stringify(Snapshot.create(s.world, Now)));
    mutate(raw.world.kubeDeployments[0]);
    expect(Result.isOk(Snapshot.fromUnknown(raw))).toBe(false);
  }
});

test.each([18, 19, 20, 21, 22])(
  "Snapshot v%s fills only empty volume state while preserving prior configuration/context",
  (version) => {
    const s = execute(
      reloaded(),
      "kubectl create ns staging",
      "kubectl config set-context --current --namespace=staging",
    );
    const raw = JSON.parse(JSON.stringify(Snapshot.create(s.world, Now)));
    raw.schemaVersion = version;
    for (const d of raw.world.kubeDeployments) {
      delete d.volumes;
      delete d.volumeMounts;
      delete d.podFiles;
      for (const r of d.revisions) {
        delete r.volumes;
        delete r.volumeMounts;
      }
    }
    const migrated = Result.unwrap(Snapshot.fromUnknown(raw));
    const d = migrated.kubeDeployments[0];
    expect(d?.volumes).toEqual([]);
    expect(d?.volumeMounts).toEqual([]);
    expect(d?.podFiles).toEqual([]);
    expect(d?.podEnvironments).toEqual(s.world.kubeDeployments[0]?.podEnvironments);
    expect(migrated.kubeNamespaces).toEqual(s.world.kubeNamespaces);
    if (version >= 19)
      expect(migrated.kubeContextNamespaces).toEqual(s.world.kubeContextNamespaces);
  },
);

test("mount recovery mission needs repaired applied files and all Pods, survives import", () => {
  const s = applied(session(Result.unwrap(Engine.startMission(session().world, "m-gke-020"))));
  expect(status(s, "m-gke-020")).toBe("in_progress");
  const edited = execute(
    s,
    "sim files replace volume-web.yaml --search='key: missing.conf' --replacement='key: app.conf'",
  );
  expect(status(edited, "m-gke-020")).toBe("in_progress");
  expect(status(execute(restore(edited), "kubectl apply -f volume-web.yaml"), "m-gke-020")).toBe(
    "completed",
  );
});

test("refresh mission rejects updated ConfigMap alone or one replaced Pod, completes after restart", () => {
  const s = update(
    reloaded(session(Result.unwrap(Engine.startMission(session().world, "m-gke-021")))),
  );
  expect(status(s, "m-gke-021")).toBe("in_progress");
  const pod = json(s, "kubectl get pods -o json").items[0].name;
  expect(status(execute(s, `kubectl delete pod ${pod}`), "m-gke-021")).toBe("in_progress");
  const done = execute(restore(s), "kubectl rollout restart deployment/reload-web");
  expect(status(done, "m-gke-021")).toBe("completed");
});

test("FailedMount removes Service endpoints and prevents HPA evaluation until repair", () => {
  const s = execute(
    applied(),
    "kubectl set resources deployment/volume-web --requests=cpu=250m",
    "kubectl expose deployment volume-web --port=80",
    "kubectl autoscale deployment/volume-web --min=2 --max=4 --cpu-percent=80",
  );
  const service = s.world.kubeServices[0];
  if (!service) throw new Error("fixture service");
  expect(KubeServiceRouting.endpoints(s.world, service)).toEqual([]);
  expect(execute(s, "sim kubernetes reconcile volume-web --cpu=250m").text).toContain(
    "PodsNotReady",
  );
  const fixed = fix(s);
  expect(KubeServiceRouting.endpoints(fixed.world, service)).toHaveLength(2);
});

test("liveness restart keeps Pod/subPath contents but reloads environment", () => {
  const started = execute(
    reloaded(),
    "sim files replace reload-web.yaml --search='          image: nginx:1' --replacement='          image: nginx:1\n          livenessProbe:\n            httpGet:\n              path: /health\n              port: 80\n            failureThreshold: 1'",
    "kubectl apply -f reload-web.yaml",
  );
  const s = update(started);
  const pod = json(s, "kubectl get pods -o json").items[0].name;
  const next = execute(
    s,
    `sim kubernetes probe reload-web --kind=liveness --status-code=500 --pod=${pod}`,
  );
  expect(execute(next, `kubectl exec ${pod} -- cat /etc/mode.conf`).text).toBe("staging");
  expect(execute(next, `kubectl exec ${pod} -- printenv MODE`).text).toBe("production");
  expect(execute(next, `kubectl exec ${pod} -- cat /etc/config/MODE`).text).toBe("production");
});

test("optional projection deletes missing files and binary empty/unicode bytes are preserved", () => {
  const s = reloaded();
  const manifest = json(s, "kubectl get cm reload-settings -o json");
  const changed = {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: { name: "reload-settings" },
    data: { MODE: "日本語", BOM: "\ufefftext" },
    binaryData: { "empty.bin": "" },
  };
  const next = execute(write(s, changed), "kubectl apply -f volume.json");
  expect(mode(next)).toBe("日本語");
  expect(mode(next, "/etc/config/BOM")).toBe("\ufefftext");
  expect(mode(next, "/etc/config/empty.bin")).toBe("");
  const removed = execute(
    write(next, { ...changed, data: {}, binaryData: {} }),
    "kubectl apply -f volume.json",
  );
  // The subPath is retained even though its source key disappeared.
  expect(mode(removed, "/etc/mode.conf")).toBe("staging");
  rejected(removed, "kubectl exec deployment/reload-web -- cat /etc/config/MODE", "not found");
  expect(manifest.data.MODE).toBe("staging");
});

test("waiting environment references are not cached until files and environment both resolve", () => {
  const m = deployment();
  const container = m.spec.template.spec.containers[0];
  if (!container) throw new Error("fixture");
  Object.assign(container, {
    env: [{ name: "MODE", valueFrom: { configMapKeyRef: { name: "env-settings", key: "MODE" } } }],
  });
  const s = execute(
    write(ready(), m),
    "kubectl create configmap settings --from-literal=MODE=mounted",
    "kubectl apply -f volume.json",
  );
  expect(s.world.kubeDeployments[0]?.podFiles).toEqual([]);
  expect(execute(s, "kubectl get pods").text).toContain("CreateContainerConfigError");
  const next = execute(s, "kubectl create configmap env-settings --from-literal=MODE=ready");
  expect(execute(next, "kubectl exec deployment/web -- cat /etc/config/MODE").text).toBe("mounted");
  expect(execute(next, "kubectl exec deployment/web -- printenv MODE").text).toBe("ready");
});
