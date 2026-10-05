// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { Now, run, type Session, session } from "@/engine/__tests__/setup";
import { KubeManifest } from "@/engine/domains/kube-manifest";
import { KubePod } from "@/engine/domains/kubernetes";
import { World } from "@/engine/domains/world";
import { Snapshot } from "@/engine/snapshot";
import { Result } from "@/utils/Result";

const execute = (s: Session, ...commands: string[]) =>
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
const ready = (start = session()) =>
  execute(
    start,
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create-auto immutable-gke --region=us-central1",
    "sim files load kubernetes-immutable",
    "kubectl apply -f frozen-settings.yaml",
    "kubectl apply -f frozen-credentials.yaml",
    "kubectl apply -f frozen-web.yaml",
  );
const restore = (s: Session) =>
  session(
    Result.unwrap(Snapshot.fromUnknown(JSON.parse(JSON.stringify(Snapshot.create(s.world, Now))))),
  );
const json = (s: Session, command: string) => JSON.parse(execute(s, command).text);
const config = (s: Session, name = "frozen-settings", namespace = "default") => {
  const c = s.world.kubeConfigs.find((c) => c.name === name && c.namespace === namespace);
  if (!c) throw new Error("fixture");
  return c;
};
const firstPod = (s: Session) => {
  const d = s.world.kubeDeployments.find(
    (d) => d.name === "frozen-web" && d.namespace === "default",
  );
  if (!d) throw new Error("fixture Deployment");
  const pod = KubePod.fromDeployment(d)[0];
  if (!pod) throw new Error("fixture Pod");
  return pod;
};
const write = (s: Session, content: string, file = "config.json") =>
  execute(s, `sim files write ${file} --content='${content}'`);
const manifest = (
  kind: "ConfigMap" | "Secret",
  immutable: unknown = undefined,
  data: Record<string, string> = { VALUE: "v1" },
  extra: Record<string, unknown> = {},
) => ({
  apiVersion: "v1",
  kind,
  metadata: { name: "settings" },
  immutable,
  [kind === "Secret" ? "stringData" : "data"]: data,
  ...extra,
});
const fixture = (kind: "ConfigMap" | "Secret", immutable: unknown = true) =>
  execute(
    write(ready(), JSON.stringify(manifest(kind, immutable))),
    "kubectl apply -f config.json",
  );
const editFiles = (s: Session) =>
  execute(
    s,
    "sim files replace frozen-settings.yaml --search=staging --replacement=production",
    "sim files replace frozen-credentials.yaml --search=demo-token-v1 --replacement=demo-token-v2",
  );
const recreate = (s: Session) =>
  execute(
    s,
    "kubectl delete -f frozen-settings.yaml",
    "kubectl apply -f frozen-settings.yaml",
    "kubectl delete -f frozen-credentials.yaml",
    "kubectl apply -f frozen-credentials.yaml",
  );

for (const kind of ["ConfigMap", "Secret"] as const) {
  test(`${kind}: immutable create/apply is idempotent and changing the data or unsetting protection is atomic`, () => {
    const s = fixture(kind);
    expect(config(s, "settings").immutable).toBe(true);
    expect(execute(s, "kubectl apply -f config.json").text).toContain("unchanged");
    expect(execute(s, "kubectl apply -f config.json").world).toEqual(s.world);
    expect(restore(s).world).toEqual(s.world);
    rejected(s, "kubectl create -f config.json", "already exists");

    const changed = write(s, JSON.stringify(manifest(kind, true, { VALUE: "v2" })));
    rejected(changed, "kubectl apply -f config.json", "data is immutable");
    expect(run(changed, "kubectl apply -f config.json").text).not.toContain("v2");
    const unprotected = write(s, JSON.stringify(manifest(kind, false)));
    rejected(unprotected, "kubectl apply -f config.json", "immutable cannot be unset");
  });

  test(`${kind}: omitted immutable preserves the current protection; labels may still change`, () => {
    const s = fixture(kind);
    const omitted = write(
      s,
      JSON.stringify(
        manifest(
          kind,
          undefined,
          { VALUE: "v1" },
          { metadata: { name: "settings", labels: { team: "platform" } } },
        ),
      ),
    );
    const changed = execute(
      omitted,
      "kubectl apply -f config.json",
      `kubectl label ${kind.toLowerCase()}/settings owner=ops`,
    );
    expect(config(changed, "settings").immutable).toBe(true);
    expect(config(changed, "settings").data).toEqual(config(s, "settings").data);
    expect(config(changed, "settings").createdAt).toBe(config(s, "settings").createdAt);
    expect(config(changed, "settings").labels).toEqual({ owner: "ops", team: "platform" });
    expect(changed.world.kubeDeployments).toEqual(s.world.kubeDeployments);
    const noLabels = execute(
      write(changed, JSON.stringify(manifest(kind))),
      "kubectl apply -f config.json",
    );
    expect(config(noLabels, "settings").labels).toEqual({ owner: "ops" });
  });

  test.each<Record<string, string>>([
    { VALUE: "v2" },
    { VALUE: "v1", EXTRA: "new" },
    {},
    { OTHER: "v1" },
  ])(`${kind}: protected data cannot change keys or values: %j`, (data) => {
    const s = write(fixture(kind), JSON.stringify(manifest(kind, true, data)));
    rejected(s, "kubectl apply -f config.json", "data is immutable");
  });

  test.each(["true", 1, 0, null, [], {}])(
    `${kind}: invalid immutable types fail before changes: %j`,
    (immutable) => {
      const s = write(ready(), JSON.stringify(manifest(kind, immutable)));
      expect(Result.isOk(KubeManifest.parse(s.world.kubeFiles["config.json"] ?? ""))).toBe(false);
      rejected(s, "kubectl apply -f config.json", "immutable must be a boolean");
    },
  );

  test(`${kind}: mutable data updates and one-way locking are allowed without restarting Pods`, () => {
    const s = fixture(kind, false);
    const locked = execute(
      write(s, JSON.stringify(manifest(kind, true, { VALUE: "v2" }))),
      "kubectl apply -f config.json",
    );
    expect(config(locked, "settings").immutable).toBe(true);
    expect(config(locked, "settings").data).toEqual([{ key: "VALUE", value: "v2" }]);
    expect(locked.world.kubeDeployments).toEqual(s.world.kubeDeployments);
    const omitted = execute(
      write(ready(), JSON.stringify(manifest(kind, undefined))),
      "kubectl create -f config.json",
    );
    expect(config(omitted, "settings").immutable).toBe(false);
  });
}

test("locking treats data as a map, not insertion order, and equivalent Secret encoding is unchanged", () => {
  const s = execute(
    ready(),
    "kubectl create configmap settings --from-literal=Z=last --from-literal=A=first",
  );
  const locked = execute(
    write(s, JSON.stringify(manifest("ConfigMap", true, { A: "first", Z: "last" }))),
    "kubectl apply -f config.json",
  );
  const reverse = execute(
    write(locked, JSON.stringify(manifest("ConfigMap", true, { Z: "last", A: "first" }))),
    "kubectl apply -f config.json",
  );
  expect(reverse.text).toContain("unchanged");
  expect(reverse.world.kubeConfigs).toEqual(locked.world.kubeConfigs);

  const secret = execute(
    write(ready(), JSON.stringify(manifest("Secret", true, { VALUE: "架空の値" }))),
    "kubectl apply -f config.json",
  );
  const equivalent = {
    apiVersion: "v1",
    kind: "Secret",
    metadata: { name: "settings" },
    immutable: true,
    data: { VALUE: Buffer.from("架空の値").toString("base64") },
  };
  expect(
    execute(write(secret, JSON.stringify(equivalent)), "kubectl apply -f config.json").text,
  ).toContain("unchanged");
});

test("omitted unmanaged data is retained, but removing a formerly applied key from an immutable config is rejected", () => {
  const s = execute(
    ready(),
    "kubectl create configmap settings --from-literal=A=one --from-literal=B=two",
  );
  const locked = execute(
    write(s, JSON.stringify(manifest("ConfigMap", true, { A: "one" }))),
    "kubectl apply -f config.json",
  );
  expect(config(locked, "settings").data).toEqual([
    { key: "A", value: "one" },
    { key: "B", value: "two" },
  ]);
  expect(config(locked, "settings").lastAppliedKeys).toEqual(["A"]);
  const removed = write(locked, JSON.stringify(manifest("ConfigMap", true, {})));
  rejected(removed, "kubectl apply -f config.json", "data is immutable");
});

test("immutable failure rolls back preceding Namespace, Deployment, Service, IP allocation and mutable config changes", () => {
  const s = ready();
  const documents = [
    { apiVersion: "v1", kind: "Namespace", metadata: { name: "temporary" } },
    manifest(
      "ConfigMap",
      false,
      { VALUE: "new" },
      { metadata: { name: "new-settings", namespace: "temporary" } },
    ),
    {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: { name: "first", namespace: "temporary" },
      spec: {
        selector: { matchLabels: { app: "first" } },
        template: {
          metadata: { labels: { app: "first" } },
          spec: { containers: [{ name: "first", image: "nginx:1" }] },
        },
      },
    },
    {
      apiVersion: "v1",
      kind: "Service",
      metadata: { name: "first", namespace: "temporary" },
      spec: { selector: { app: "first" }, ports: [{ port: 80, targetPort: 8080 }] },
    },
    manifest("ConfigMap", true, { MODE: "wrong" }, { metadata: { name: "frozen-settings" } }),
  ];
  const mixed = write(s, documents.map((m) => JSON.stringify(m)).join("\n---\n"), "mixed.yaml");
  rejected(mixed, "kubectl apply -f mixed.yaml", "data is immutable");
  expect(mixed.world.sequence).toBe(s.world.sequence);
});

test("delete/recreate preserves cached env; restart reads both updated immutable sources for every Pod", () => {
  const before = ready();
  const edited = editFiles(before);
  rejected(edited, "kubectl apply -f frozen-settings.yaml", "data is immutable");
  rejected(edited, "kubectl apply -f frozen-credentials.yaml", "data is immutable");
  const next = recreate(edited);
  expect(next.world.kubeDeployments).toEqual(before.world.kubeDeployments);
  expect(execute(next, "kubectl exec deployment/frozen-web -- printenv MODE").text).toBe("staging");
  expect(execute(next, "kubectl exec deployment/frozen-web -- printenv TOKEN").text).toBe(
    "demo-token-v1",
  );
  const restarted = execute(restore(next), "kubectl rollout restart deployment/frozen-web");
  expect(execute(restarted, "kubectl exec deployment/frozen-web -- printenv MODE").text).toBe(
    "production",
  );
  expect(execute(restarted, "kubectl exec deployment/frozen-web -- printenv TOKEN").text).toBe(
    "demo-token-v2",
  );
  expect(restarted.world.kubeDeployments[0]?.podEnvironments).toHaveLength(2);
  expect(
    restarted.world.kubeDeployments[0]?.podEnvironments.every(
      (p) =>
        p.values.some((e) => e.name === "MODE" && e.value === "production") &&
        p.values.some((e) => e.name === "TOKEN" && e.value === "demo-token-v2"),
    ),
  ).toBe(true);
  expect(restore(restarted).world).toEqual(restarted.world);
});

test("Pod recreation while a protected source is deleted waits, while other running Pods retain their values", () => {
  const s = ready();
  const pod = firstPod(s);
  const deleted = execute(
    s,
    "kubectl delete configmap frozen-settings",
    `kubectl delete pod ${pod.name}`,
  );
  expect(execute(deleted, "kubectl get pods").text).toContain("CreateContainerConfigError");
  expect(deleted.world.kubeDeployments[0]?.podEnvironments).toHaveLength(1);
  const newConfig = execute(editFiles(deleted), "kubectl apply -f frozen-settings.yaml");
  expect(
    newConfig.world.kubeDeployments[0]?.podEnvironments
      .map((p) => p.values.find((e) => e.name === "MODE")?.value)
      .sort(),
  ).toEqual(["production", "staging"]);
});

test("literal create defaults to mutable; get/describe surface the flag without disclosing Secret data", () => {
  const s = execute(
    ready(),
    "kubectl create configmap plain",
    "kubectl create secret generic plain",
  );
  expect(s.world.kubeConfigs.filter((c) => c.name === "plain").every((c) => !c.immutable)).toBe(
    true,
  );
  expect(json(s, "kubectl get cm frozen-settings -o json").immutable).toBe(true);
  expect(json(s, "kubectl get secret frozen-credentials -o json").immutable).toBe(true);
  expect(execute(s, "kubectl describe secret frozen-credentials").text).toContain(
    "immutable: true",
  );
  expect(execute(s, "kubectl describe secret frozen-credentials").text).not.toContain(
    "demo-token-v1",
  );
  expect(execute(s, "kubectl get secrets").text).not.toContain("demo-token-v1");
  expect(json(s, "kubectl get secret plain -o json").immutable).toBe(false);
});

test("API and kind-specific permissions remain necessary for metadata changes and delete/recreate", () => {
  const disabled = execute(ready(), "gcloud services disable container.googleapis.com");
  rejected(disabled, "kubectl apply -f frozen-settings.yaml", "disabled");
  const viewer = execute(
    ready(),
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:dev@example.com --role=roles/container.viewer",
    "gcloud auth login dev@example.com",
  );
  execute(viewer, "kubectl get cm frozen-settings -o yaml");
  rejected(viewer, "kubectl apply -f frozen-settings.yaml", "container.configMaps.update");
  rejected(viewer, "kubectl delete secret frozen-credentials", "container.secrets.delete");
  const editor = execute(
    ready(),
    "gcloud iam roles create configEditor --permissions=container.configMaps.get,container.configMaps.update",
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:developer@example.com --role=projects/ace-dev-01/roles/configEditor",
    "gcloud auth login developer@example.com",
  );
  execute(editor, "kubectl label cm frozen-settings app=web --overwrite");
  rejected(editor, "kubectl delete configmap frozen-settings", "container.configMaps.delete");
  rejected(editor, "kubectl apply -f frozen-credentials.yaml", "container.secrets.get");
});

test("context/explicit Namespace and cluster/project boundaries keep unrelated immutable sources intact", () => {
  const s = execute(
    ready(),
    "kubectl create ns staging",
    "kubectl config set-context --current --namespace=staging",
    "kubectl apply -f frozen-settings.yaml",
  );
  const edited = execute(
    s,
    "sim files replace frozen-settings.yaml --search=staging --replacement=production",
  );
  rejected(edited, "kubectl apply -f frozen-settings.yaml", "data is immutable");
  const recreated = execute(
    edited,
    "kubectl delete -f frozen-settings.yaml",
    "kubectl apply -f frozen-settings.yaml",
  );
  expect(config(recreated, "frozen-settings", "staging").data).toEqual([
    { key: "MODE", value: "production" },
  ]);
  expect(config(recreated).data).toEqual([{ key: "MODE", value: "staging" }]);
  rejected(recreated, "kubectl apply -f frozen-settings.yaml -n default", "data is immutable");
  const other = execute(
    edited,
    "gcloud container clusters create-auto other --region=us-central1",
    "kubectl apply -f frozen-settings.yaml",
  );
  expect(other.world.kubeConfigs.find((c) => c.cluster === "other")?.data).toEqual([
    { key: "MODE", value: "production" },
  ]);
  const prod = execute(
    edited,
    "gcloud config set project ace-prod-01",
    "gcloud billing projects link ace-prod-01 --billing-account=01AB2C-DEF345-6789AB",
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create-auto immutable-gke --region=us-central1",
    "kubectl apply -f frozen-settings.yaml",
  );
  expect(prod.world.kubeConfigs.find((c) => c.projectId === "ace-prod-01")?.data).toEqual([
    { key: "MODE", value: "production" },
  ]);
  expect(
    prod.world.kubeConfigs.find((c) => c.projectId === "ace-dev-01" && c.namespace === "default")
      ?.data,
  ).toEqual([{ key: "MODE", value: "staging" }]);
});

test.each([18, 19, 20])(
  "v%s migration fills mutable flags and retains existing namespaces, labels and runtime",
  (version) => {
    const s = execute(
      ready(),
      "kubectl create ns staging",
      "kubectl apply -f frozen-settings.yaml -n staging",
      "kubectl config set-context --current --namespace=staging",
      "kubectl label cm frozen-settings owner=ops",
    );
    const snapshot = JSON.parse(JSON.stringify(Snapshot.create(s.world, Now)));
    snapshot.schemaVersion = version;
    for (const c of snapshot.world.kubeConfigs) {
      delete c.immutable;
      if (version < 20) {
        delete c.labels;
        delete c.lastAppliedLabelKeys;
      }
    }
    if (version === 18) delete snapshot.world.kubeContextNamespaces;
    const migrated = Result.unwrap(Snapshot.fromUnknown(snapshot));
    expect(migrated).toEqual({
      ...s.world,
      kubeContextNamespaces: version === 18 ? {} : s.world.kubeContextNamespaces,
      kubeConfigs: s.world.kubeConfigs.map((c) => ({
        ...c,
        immutable: false,
        ...(version < 20 ? { labels: {}, lastAppliedLabelKeys: [] } : {}),
      })),
    });
    expect(restore(session(migrated)).world).toEqual(migrated);
  },
);

test.each([undefined, null, "true", 1])(
  "v22 rejects missing or malformed immutable fields: %j",
  (immutable) => {
    const snapshot = JSON.parse(JSON.stringify(Snapshot.create(ready().world, Now)));
    snapshot.world.kubeConfigs[0].immutable = immutable;
    expect(Result.isOk(Snapshot.fromUnknown(snapshot))).toBe(false);
  },
);

test("the immutable mission requires edited files, protected sources, key references and a restart of both Pods", () => {
  const id = "m-gke-018";
  const status = (s: Session) => s.world.missions.find((m) => m.id === id)?.status;
  const initial = ready(session(Result.unwrap(Engine.startMission(session().world, id))));
  expect(status(initial)).toBe("in_progress");
  const edited = editFiles(initial);
  expect(status(edited)).toBe("in_progress");
  const replaced = recreate(restore(edited));
  expect(status(replaced)).toBe("in_progress");
  const pod = firstPod(replaced);
  expect(status(execute(replaced, `kubectl delete pod ${pod.name}`))).toBe("in_progress");
  const literal = execute(
    replaced,
    "kubectl set env deployment/frozen-web MODE=production TOKEN=demo-token-v2",
    "kubectl rollout restart deployment/frozen-web",
  );
  expect(status(literal)).toBe("in_progress");
  const wrongFiles = execute(
    replaced,
    "sim files replace frozen-settings.yaml --search=production --replacement=staging",
    "kubectl rollout restart deployment/frozen-web",
  );
  expect(status(wrongFiles)).toBe("in_progress");
  const mutable = execute(
    replaced,
    "kubectl delete secret frozen-credentials",
    "kubectl create secret generic frozen-credentials --from-literal=TOKEN=demo-token-v2",
    "kubectl rollout restart deployment/frozen-web",
  );
  expect(status(mutable)).toBe("in_progress");
  const done = execute(restore(replaced), "kubectl rollout restart deployment/frozen-web");
  expect(status(done)).toBe("completed");
  expect(restore(done).world).toEqual(done.world);
});

test("sample completion includes immutable manifests and apply/create help explains the feature", () => {
  const s = ready();
  expect(execute(s, "kubectl apply --help").text).toContain("immutable");
  expect(Engine.completionCandidates(s.world, "sim files load kubernetes-i")).toContain(
    "kubernetes-immutable",
  );
  expect(Engine.completionCandidates(s.world, "kubectl apply -f frozen-")).toContain(
    "frozen-settings.yaml",
  );
});
