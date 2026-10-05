// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { Now, run, type Session, session } from "@/engine/__tests__/setup";
import { KubeConfig } from "@/engine/domains/kube-config";
import { KubeManifest } from "@/engine/domains/kube-manifest";
import { World } from "@/engine/domains/world";
import { Snapshot } from "@/engine/snapshot";
import { Result } from "@/utils/Result";

const execute = (s: Session, ...commands: string[]) =>
  commands.reduce((current, command) => {
    const next = run(current, command);
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
    "gcloud container clusters create-auto binary-gke --region=us-central1",
    "sim files load kubernetes-binary-data",
  );

const applied = (start = session()) =>
  execute(ready(start), "kubectl apply -f asset-settings.yaml", "kubectl apply -f asset-web.yaml");

const fix = (s: Session) =>
  execute(
    s,
    "sim files replace asset-web.yaml --search='key: asset.bin' --replacement='key: MODE'",
    "kubectl apply -f asset-web.yaml",
  );

const restore = (s: Session) =>
  session(
    Result.unwrap(Snapshot.fromUnknown(JSON.parse(JSON.stringify(Snapshot.create(s.world, Now))))),
  );

const write = (s: Session, value: unknown) =>
  execute(s, `sim files write config.json --content='${JSON.stringify(value)}'`);

const manifest = (
  binaryData: unknown = { "asset.bin": "AP+AAQ==" },
  data: unknown = { MODE: "production" },
  extra = {},
) => ({
  apiVersion: "v1",
  kind: "ConfigMap",
  metadata: { name: "asset-settings" },
  data,
  binaryData,
  ...extra,
});

const config = (s: Session, namespace = "default") => {
  const c = s.world.kubeConfigs.find(
    (c) => c.name === "asset-settings" && c.namespace === namespace,
  );
  if (!c) throw new Error("fixture ConfigMap");
  return c;
};

const pods = (s: Session) => {
  const json: {
    items: { name: string; status: { conditions: { type: string; status: string }[] } }[];
  } = JSON.parse(execute(s, "kubectl get pods -o json").text);
  return json.items.map((pod) => ({
    name: pod.name,
    ready: pod.status.conditions.find((condition) => condition.type === "Ready")?.status === "True",
  }));
};

test("YAML/JSON binaryData stores arbitrary bytes, reports decoded sizes and counts both maps", () => {
  const s = execute(ready(), "kubectl create -f asset-settings.yaml");
  expect(config(s).binaryData).toEqual([{ key: "asset.bin", value: "AP+AAQ==" }]);
  expect(config(s).lastAppliedBinaryKeys).toEqual([]);
  const json = JSON.parse(execute(s, "kubectl get cm asset-settings -o json").text);
  expect(json.data).toEqual({ MODE: "production" });
  expect(json.binaryData).toEqual({ "asset.bin": "AP+AAQ==" });
  expect(json.count).toBe(2);
  expect(execute(s, "kubectl get cm").text).toMatch(/asset-settings\s+2\s+/);
  expect(execute(s, "kubectl get cm asset-settings -o yaml").text).toContain("asset.bin: AP+AAQ==");
  const described = execute(s, "kubectl describe cm asset-settings").text;
  expect(described).toContain("4 bytes");
  expect(described).not.toContain("AP+AAQ==");
  expect(described).toContain("production");
  expect(restore(s).world).toEqual(s.world);
});

test("equivalent base64 padding bits normalize and repeated apply is unchanged", () => {
  const s = execute(
    write(ready(), manifest({ A: "AB==", B: "AAB=", EMPTY: "" })),
    "kubectl apply -f config.json",
  );
  expect(config(s).binaryData).toEqual([
    { key: "A", value: "AA==" },
    { key: "B", value: "AAA=" },
    { key: "EMPTY", value: "" },
  ]);
  const canonical = execute(
    write(s, manifest({ EMPTY: "", B: "AAA=", A: "AA==" })),
    "kubectl apply -f config.json",
  );
  expect(canonical.text).toContain("unchanged");
  expect(canonical.world.kubeConfigs).toEqual(s.world.kubeConfigs);
  expect(restore(canonical).world).toEqual(canonical.world);
  const described = execute(s, "kubectl describe cm asset-settings").text;
  for (const size of ["0 bytes", "1 bytes", "2 bytes"]) expect(described).toContain(size);
});

test.each([null, [], "bytes", 5, { BIN: 1 }, { BIN: true }, { BIN: null }, { BIN: {} }])(
  "malformed binaryData rejects the whole apply without printing its value: %j",
  (binaryData) => {
    const s = write(ready(), manifest(binaryData));
    rejected(s, "kubectl apply -f config.json", "binaryData");
  },
);

test.each(["%%%", "Zg", "Zg=", "A===", "====", "_w==", "-w==", "Y Q==", "YQ==\n"])(
  "invalid base64 is rejected: %j",
  (value) => {
    rejected(
      write(ready(), manifest({ BIN: value })),
      "kubectl apply -f config.json",
      "valid base64",
    );
  },
);

test.each(["bad/key", "", "é", "a".repeat(254)])(
  "binary keys use the same constraints as text keys: %j",
  (key) => {
    rejected(
      write(ready(), manifest({ [key]: "AA==" })),
      "kubectl apply -f config.json",
      "Invalid configuration key",
    );
  },
);

test("text/binary keys cannot overlap; the combined map is limited to 100 keys", () => {
  rejected(
    write(ready(), manifest({ MODE: "AA==" })),
    "kubectl apply -f config.json",
    "keys must be unique",
  );
  const ninetyNine = Object.fromEntries(Array.from({ length: 99 }, (_, i) => [`B${i}`, "AA=="]));
  const s = execute(write(ready(), manifest(ninetyNine)), "kubectl apply -f config.json");
  expect(config(s).data.length + config(s).binaryData.length).toBe(100);
  rejected(
    write(s, manifest({ ...ninetyNine, EXTRA: "AA==" })),
    "kubectl apply -f config.json",
    "maximum 100",
  );
});

test("the 1 MiB boundary sums text UTF-8 bytes and decoded binary bytes, not base64 or JSON overhead", () => {
  const base = config(execute(ready(), "kubectl apply -f asset-settings.yaml"));
  const binaryData = [{ key: "BIN", value: btoa("a".repeat(1048573)) }];
  const exact = { ...base, data: [{ key: "TEXT", value: "あ" }], binaryData };
  expect(KubeConfig.validate(exact)).toEqual(Result.ok(exact));
  expect(
    Result.isOk(KubeConfig.validate({ ...exact, data: [{ key: "TEXT", value: "あa" }] })),
  ).toBe(false);
  expect(
    Result.isOk(
      KubeConfig.validate({
        ...exact,
        binaryData: [{ key: "BIN", value: btoa("a".repeat(1048574)) }],
      }),
    ),
  ).toBe(false);
});

test("binaryData is ConfigMap-only and Secret UTF-8 data behavior is preserved", () => {
  rejected(
    write(ready(), { ...manifest(), kind: "Secret" }),
    "kubectl apply -f config.json",
    "Unsupported field in manifest",
  );
  const s = execute(
    write(ready(), {
      apiVersion: "v1",
      kind: "Secret",
      metadata: { name: "credentials" },
      data: { TOKEN: "YQ==" },
    }),
    "kubectl apply -f config.json",
  );
  const c = s.world.kubeConfigs.find((c) => c.kind === "secret");
  expect(c?.binaryData).toEqual([]);
  expect(c?.lastAppliedBinaryKeys).toEqual([]);
  expect(execute(s, "kubectl describe secret credentials").text).toContain("1 bytes");
  const literal = execute(s, "kubectl create configmap literal --from-literal=X=Y");
  expect(literal.world.kubeConfigs.find((c) => c.name === "literal")?.binaryData).toEqual([]);
});

test("apply manages text and binary keys separately and preserves unrelated live keys after reload", () => {
  const created = execute(
    write(ready(), manifest({ KEEP: "AA==", CHANGE: "AQ==" }, { MANUAL: "live" })),
    "kubectl create -f config.json",
  );
  const first = execute(
    write(created, manifest({ CHANGE: "Ag==", REMOVE: "Aw==" }, { MODE: "production" })),
    "kubectl apply -f config.json",
  );
  const next = execute(
    write(restore(first), manifest({ CHANGE: "BA==" }, {})),
    "kubectl apply -f config.json",
  );
  expect(config(next).binaryData).toEqual([
    { key: "CHANGE", value: "BA==" },
    { key: "KEEP", value: "AA==" },
  ]);
  expect(config(next).data).toEqual([{ key: "MANUAL", value: "live" }]);
  expect(config(next).lastAppliedBinaryKeys).toEqual(["CHANGE"]);
  expect(config(next).lastAppliedKeys).toEqual([]);
  expect(config(next).createdAt).toBe(config(created).createdAt);
});

test("managed keys can move between text and binary fields, but retained unmanaged collisions are rejected", () => {
  const s = execute(write(ready(), manifest({}, { X: "a" })), "kubectl apply -f config.json");
  const binary = execute(write(s, manifest({ X: "YQ==" }, {})), "kubectl apply -f config.json");
  expect(config(binary).data).toEqual([]);
  expect(config(binary).lastAppliedKeys).toEqual([]);
  const text = execute(write(binary, manifest({}, { X: "text" })), "kubectl apply -f config.json");
  expect(config(text).binaryData).toEqual([]);
  expect(config(text).lastAppliedBinaryKeys).toEqual([]);
  const unmanaged = execute(
    write(ready(), manifest({ X: "AA==" }, {})),
    "kubectl create -f config.json",
  );
  rejected(
    write(unmanaged, manifest({}, { X: "text" })),
    "kubectl apply -f config.json",
    "keys must be unique",
  );
});

test.each([
  { "asset.bin": "AA==" },
  { "asset.bin": "AP+AAQ==", EXTRA: "" },
  {},
  { OTHER: "AP+AAQ==" },
])("immutable protects binary values, keys and empty bytes: %j", (binaryData) => {
  const s = execute(
    write(ready(), manifest(undefined, undefined, { immutable: true })),
    "kubectl apply -f config.json",
  );
  rejected(
    write(s, manifest(binaryData, undefined, { immutable: true })),
    "kubectl apply -f config.json",
    "binaryData is immutable",
  );
  const labeled = execute(s, "kubectl label cm asset-settings owner=ops");
  expect(config(labeled).binaryData).toEqual(config(s).binaryData);
  expect(config(labeled).lastAppliedBinaryKeys).toEqual(config(s).lastAppliedBinaryKeys);
  rejected(
    write(s, manifest(undefined, undefined, { immutable: false })),
    "kubectl apply -f config.json",
    "immutable cannot be unset",
  );
});

test("immutable same-byte normalization is allowed; deletion by edited file permits recreation", () => {
  const s = execute(
    write(ready(), manifest({ BIN: "AA==" }, {}, { immutable: true })),
    "kubectl apply -f config.json",
  );
  const same = execute(
    write(s, manifest({ BIN: "AB==" }, {}, { immutable: true })),
    "kubectl apply -f config.json",
  );
  expect(same.text).toContain("unchanged");
  const changed = write(same, manifest({ BIN: "AQ==" }, {}, { immutable: true }));
  const recreated = execute(
    changed,
    "kubectl delete -f config.json",
    "kubectl create -f config.json",
  );
  expect(config(recreated).binaryData).toEqual([{ key: "BIN", value: "AQ==" }]);
});

test("immutable failure rolls back earlier mutable ConfigMap and Namespace changes in a mixed file", () => {
  const s = execute(
    write(ready(), manifest(undefined, undefined, { immutable: true })),
    "kubectl apply -f config.json",
  );
  const documents = [
    { apiVersion: "v1", kind: "Namespace", metadata: { name: "staging" } },
    manifest({ OTHER: "AA==" }, {}, { metadata: { name: "unprotected" } }),
    manifest({ "asset.bin": "AQ==" }),
  ]
    .map((v) => JSON.stringify(v))
    .join("\n---\n");
  const edited = execute(s, `sim files write mixed.yaml --content='${documents}'`);
  rejected(edited, "kubectl apply -f mixed.yaml", "binaryData is immutable");
});

test("binaryData is never used by configMapKeyRef or set env --from, even for UTF-8 or empty bytes", () => {
  const s = applied();
  expect(pods(s).every((pod) => !pod.ready)).toBe(true);
  expect(execute(s, "kubectl get pods").text).toContain("CreateContainerConfigError");
  rejected(s, "kubectl rollout status deployment/asset-web", "not ready");
  rejected(s, "kubectl exec deployment/asset-web -- printenv MODE", "CreateContainerConfigError");
  rejected(
    s,
    "kubectl set env deployment/asset-web --from=configmap/asset-settings --keys=asset.bin",
    "Key asset.bin not found",
  );
  const text = execute(s, "kubectl set env deployment/asset-web --from=configmap/asset-settings");
  expect(text.world.kubeDeployments[0]?.env).toEqual([
    { name: "MODE", source: "configmap", resource: "asset-settings", key: "MODE", value: "" },
  ]);
  expect(execute(text, "kubectl exec deployment/asset-web -- printenv MODE").text).toBe(
    "production",
  );
  const utf = execute(write(s, manifest({ "asset.bin": "YQ==" })), "kubectl apply -f config.json");
  expect(pods(utf).every((pod) => !pod.ready)).toBe(true);
  const empty = execute(write(s, manifest({ "asset.bin": "" })), "kubectl apply -f config.json");
  expect(pods(empty).every((pod) => !pod.ready)).toBe(true);
});

test("moving a referenced key from text to binary keeps running Pods cached while new Pods wait", () => {
  const s = fix(applied());
  const moved = execute(
    write(s, manifest({ MODE: "cHJvZHVjdGlvbg==", "asset.bin": "AP+AAQ==" }, {})),
    "kubectl apply -f config.json",
  );
  expect(moved.world.kubeDeployments).toEqual(s.world.kubeDeployments);
  expect(execute(moved, "kubectl exec deployment/asset-web -- printenv MODE").text).toBe(
    "production",
  );
  const scaled = execute(restore(moved), "kubectl scale deployment/asset-web --replicas=3");
  expect(pods(scaled).map((pod) => pod.ready)).toEqual([true, true, false]);
  const repaired = execute(
    write(scaled, manifest(undefined, { MODE: "repaired" })),
    "kubectl apply -f config.json",
  );
  expect(pods(repaired).every((pod) => pod.ready)).toBe(true);
  const newest = pods(repaired).at(-1);
  if (!newest) throw new Error("fixture Pod");
  expect(execute(repaired, `kubectl exec ${newest.name} -- printenv MODE`).text).toBe("repaired");
  expect(execute(repaired, "kubectl exec deployment/asset-web -- printenv MODE").text).toBe(
    "production",
  );
});

test("API and ConfigMap permissions still gate binary reads, updates and deletion", () => {
  const s = applied();
  const disabled = execute(s, "gcloud services disable container.googleapis.com");
  rejected(disabled, "kubectl apply -f asset-settings.yaml", "disabled");
  const viewer = execute(
    s,
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:dev@example.com --role=roles/container.viewer",
    "gcloud auth login dev@example.com",
  );
  expect(execute(viewer, "kubectl get cm asset-settings -o json").text).toContain("AP+AAQ==");
  rejected(viewer, "kubectl apply -f asset-settings.yaml", "container.configMaps.update");
  rejected(viewer, "kubectl delete cm asset-settings", "container.configMaps.delete");
});

test("namespace/context, project and cluster scopes isolate matching binary ConfigMaps", () => {
  const s = execute(
    applied(),
    "kubectl create ns staging",
    "kubectl config set-context --current --namespace=staging",
    "kubectl apply -f asset-settings.yaml",
  );
  const changed = execute(
    write(s, manifest({ "asset.bin": "AQ==" })),
    "kubectl apply -f config.json",
  );
  expect(config(changed, "staging").binaryData[0]?.value).toBe("AQ==");
  expect(config(changed).binaryData[0]?.value).toBe("AP+AAQ==");
  const all = JSON.parse(execute(changed, "kubectl get cm -A -o json").text);
  expect(all.items).toHaveLength(2);
  const cluster = execute(
    changed,
    "gcloud container clusters create-auto other --region=us-central1",
    "kubectl apply -f asset-settings.yaml",
  );
  expect(cluster.world.kubeConfigs.filter((c) => c.cluster === "binary-gke")).toEqual(
    changed.world.kubeConfigs,
  );
  const project = execute(
    cluster,
    "gcloud config set project ace-prod-01",
    "gcloud billing projects link ace-prod-01 --billing-account=01AB2C-DEF345-6789AB",
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create-auto binary-gke --region=us-central1",
    "kubectl apply -f asset-settings.yaml",
  );
  expect(project.world.kubeConfigs.filter((c) => c.projectId === "ace-dev-01")).toEqual(
    cluster.world.kubeConfigs,
  );
});

test.each([18, 19, 20, 21])(
  "v%s migration adds empty binary fields and retains prior runtime and ownership",
  (version) => {
    const s = execute(
      fix(applied()),
      "kubectl create ns staging",
      "kubectl config set-context --current --namespace=staging",
      "kubectl apply -f asset-settings.yaml",
      "kubectl label cm asset-settings owner=ops",
    );
    const snapshot = JSON.parse(JSON.stringify(Snapshot.create(s.world, Now)));
    snapshot.schemaVersion = version;
    for (const c of snapshot.world.kubeConfigs) {
      delete c.binaryData;
      delete c.lastAppliedBinaryKeys;
      c.immutable = true;
      if (version < 21) delete c.immutable;
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
        immutable: version === 21,
        binaryData: [],
        lastAppliedBinaryKeys: [],
        ...(version < 20 ? { labels: {}, lastAppliedLabelKeys: [] } : {}),
      })),
    });
    expect(restore(session(migrated)).world).toEqual(migrated);
  },
);

test.each([
  { binaryData: undefined },
  { binaryData: null },
  { binaryData: [{ key: "BIN", value: "%%%" }] },
  { binaryData: [{ key: "BIN", value: "AB==" }] },
  { binaryData: [{ key: "MODE", value: "AA==" }] },
  { lastAppliedBinaryKeys: undefined },
  { lastAppliedBinaryKeys: ["BIN", "BIN"] },
  { lastAppliedBinaryKeys: ["bad/key"] },
  { kind: "secret" },
])(
  "current snapshots reject malformed, overlapping or noncanonical binary fields: %j",
  (fields) => {
    const snapshot = JSON.parse(JSON.stringify(Snapshot.create(applied().world, Now)));
    Object.assign(snapshot.world.kubeConfigs[0], fields);
    expect(Result.isOk(Snapshot.fromUnknown(snapshot))).toBe(false);
  },
);

test("mission requires both files, retained binary bytes, a text reference and 2 ready Pods", () => {
  const id = "m-gke-019";
  const status = (s: Session) => s.world.missions.find((mission) => mission.id === id)?.status;
  const s = applied(session(Result.unwrap(Engine.startMission(session().world, id))));
  expect(status(s)).toBe("in_progress");
  expect(
    status(
      execute(
        s,
        "sim files replace asset-web.yaml --search='key: asset.bin' --replacement='key: MODE'",
      ),
    ),
  ).toBe("in_progress");
  expect(status(execute(s, "kubectl set env deployment/asset-web MODE=production"))).toBe(
    "in_progress",
  );
  const missingBinary = execute(write(s, manifest({})), "kubectl apply -f config.json");
  expect(status(fix(missingBinary))).toBe("in_progress");
  const incorrectBinary = execute(
    write(s, manifest({ "asset.bin": "AQ==" })),
    "kubectl apply -f config.json",
  );
  expect(status(fix(incorrectBinary))).toBe("in_progress");
  const fewerPods = execute(
    s,
    "sim files replace asset-web.yaml --search='replicas: 2' --replacement='replicas: 1'",
  );
  expect(status(fix(fewerPods))).toBe("in_progress");
  expect(status(fix(restore(s)))).toBe("completed");
});

test("sample files are discoverable through completion and apply help mentions binaryData", () => {
  const s = ready();
  const completion = (line: string) => Engine.completionCandidates(s.world, line);
  expect(completion("sim files load kubernetes-b")).toContain("kubernetes-binary-data");
  expect(completion("kubectl apply -f asset-")).toEqual(
    expect.arrayContaining(["asset-settings.yaml", "asset-web.yaml"]),
  );
  expect(execute(s, "kubectl apply --help").text).toContain("binaryData");
  expect(Result.isOk(KubeManifest.parse(s.world.kubeFiles["asset-settings.yaml"] ?? ""))).toBe(
    true,
  );
});
