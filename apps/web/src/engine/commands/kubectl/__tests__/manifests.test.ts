// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { Now, run, type Session, session } from "@/engine/__tests__/setup";
import { KubeManifest } from "@/engine/domains/kube-manifest";
import { KubePod } from "@/engine/domains/kubernetes";
import { Snapshot } from "@/engine/snapshot";
import { Result } from "@/utils/Result";

const execute = (s: Session, ...commands: string[]) =>
  commands.reduce((s, c) => {
    const next = run(s, c);
    expect(next.text, c).not.toMatch(/^(ERROR:|error:|Error from server)/m);
    return next;
  }, s);
const ready = () =>
  execute(
    session(),
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create-auto config-gke --region=us-central1",
    "sim files load kubernetes-config",
  );
const rejected = (s: Session, c: string, message: string) => {
  const next = run(s, c);
  expect(next.text).toContain(message);
  expect(next.world).toEqual(s.world);
};
const write = (s: Session, content: string, file = "config.json") =>
  execute(s, `sim files write ${file} --content='${content}'`);
const cm = (data: Record<string, unknown> = { MODE: "prod" }, name = "settings") => ({
  apiVersion: "v1",
  kind: "ConfigMap",
  metadata: { name },
  data,
});
const secret = (data: Record<string, unknown> = { TOKEN: "demo" }) => ({
  apiVersion: "v1",
  kind: "Secret",
  metadata: { name: "credentials" },
  stringData: data,
});
const restore = (s: Session) =>
  session(
    Result.unwrap(Snapshot.fromUnknown(JSON.parse(JSON.stringify(Snapshot.create(s.world, Now))))),
  );
const data = (s: Session, name = "settings") =>
  s.world.kubeConfigs.find((c) => c.name === name)?.data;

test("virtual YAML manifests create ConfigMap/Secret and repeated apply is unchanged, with no Terraform changes", () => {
  const s = ready();
  const applied = execute(
    s,
    "kubectl apply -f ./app-config.yaml",
    "kubectl apply -f app-secret.yaml",
  );
  const again = execute(applied, "kubectl apply -f app-config.yaml");
  expect(again.text).toContain("unchanged");
  expect(again.world).toEqual(applied.world);
  expect(applied.world.terraform).toEqual(s.world.terraform);
  expect(restore(applied).world).toEqual(applied.world);
  expect(execute(applied, "kubectl describe secret app-secret").text).not.toContain("demo-token");
  expect(
    JSON.parse(execute(applied, "kubectl get secret app-secret -o json").text).data.API_TOKEN,
  ).toBe("ZGVtby10b2tlbg==");
});

test("create refuses existing resources; delete from file removes configs but leaves virtual files", () => {
  const s = execute(ready(), "kubectl create -f app-config.yaml");
  rejected(s, "kubectl create -f app-config.yaml", "already exists");
  const deleted = execute(s, "kubectl delete -f app-config.yaml");
  expect(deleted.world.kubeConfigs).toHaveLength(0);
  expect(deleted.world.kubeFiles).toEqual(s.world.kubeFiles);
  rejected(deleted, "kubectl delete -f app-config.yaml", "not found");
});

test("apply changes data without recreating configs or restarting existing Pods; restart refreshes values", () => {
  const s = execute(
    ready(),
    "kubectl apply -f app-config.yaml",
    "kubectl create deployment web --image=nginx:1 --replicas=2",
    "kubectl set env deployment/web --from=configmap/app-config",
  );
  const edited = execute(
    s,
    "sim files replace app-config.yaml --search=staging --replacement=production",
  );
  expect(data(edited, "app-config")).toEqual(data(s, "app-config"));
  const applied = execute(edited, "kubectl apply -f app-config.yaml");
  expect(applied.world.kubeConfigs[0]?.createdAt).toBe(s.world.kubeConfigs[0]?.createdAt);
  expect(applied.world.kubeDeployments).toEqual(s.world.kubeDeployments);
  expect(execute(applied, "kubectl exec deployment/web -- printenv APP_MODE").text).toBe("staging");
  const restarted = execute(restore(applied), "kubectl rollout restart deployment/web");
  expect(execute(restarted, "kubectl exec deployment/web -- printenv APP_MODE").text).toBe(
    "production",
  );
});

test("apply removes formerly managed keys while keeping unmanaged live keys, even after reload", () => {
  const s = execute(ready(), "kubectl create configmap settings --from-literal=KEEP=manual");
  const first = execute(
    write(s, JSON.stringify(cm({ MODE: "prod", REMOVE: "old" }))),
    "kubectl apply -f config.json",
  );
  const next = execute(
    write(restore(first), JSON.stringify(cm({ MODE: "new" }))),
    "kubectl apply -f config.json",
  );
  expect(data(next)).toEqual([
    { key: "KEEP", value: "manual" },
    { key: "MODE", value: "new" },
  ]);
  expect(execute(next, "kubectl apply -f config.json").world).toEqual(next.world);
});

test("Secret data decodes UTF-8 and stringData takes precedence; YAML block strings preserve newlines", () => {
  const source = { ...secret({ TOKEN: "日本語" }), data: { TOKEN: "b2xk", EMPTY: "" } };
  const s = execute(write(ready(), JSON.stringify(source)), "kubectl apply -f config.json");
  expect(data(s, "credentials")).toEqual([
    { key: "EMPTY", value: "" },
    { key: "TOKEN", value: "日本語" },
  ]);
  const parsed = Result.unwrap(
    KubeManifest.parse(
      "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: settings\ndata:\n  CONFIG: |\n    a=1\n    b=2\n  ENABLED: 'true'\n",
    ),
  );
  expect(parsed[0]?.kind === "configmap" ? parsed[0].data : []).toContainEqual({
    key: "CONFIG",
    value: "a=1\nb=2\n",
  });
});

test.each([
  "",
  "[]",
  "not: [valid",
  JSON.stringify({ ...cm(), apiVersion: "v2" }),
  JSON.stringify({ ...cm(), kind: "Deployment" }),
  JSON.stringify(cm({ BOOL: true })),
  JSON.stringify(cm({ NUM: 12 })),
  JSON.stringify({ ...cm(), immutable: true }),
  JSON.stringify({ ...cm(), binaryData: { BIN: "YQ==" } }),
  JSON.stringify({ ...cm(), metadata: { name: "settings", namespace: "other" } }),
  JSON.stringify({ ...cm(), metadata: { name: "settings", labels: { app: "web" } } }),
  JSON.stringify({ ...secret(), type: "kubernetes.io/dockerconfigjson" }),
  JSON.stringify({ ...secret(), data: { TOKEN: "not-base64!" } }),
  JSON.stringify({ ...secret({}), data: { TOKEN: "/w==" } }),
  JSON.stringify(cm({ "bad/key": "v" })),
  JSON.stringify(cm({}, "INVALID")),
  "apiVersion: v1\nkind: ConfigMap\nmetadata: {name: settings}\ndata: {X: a, X: b}",
  "apiVersion: v1\nkind: ConfigMap\nmetadata: {name: settings}\ndata: {X: &a hello, Y: *a}",
  "apiVersion: v1\nkind: ConfigMap\nmetadata: {name: settings}\ndata: {X: !!str value}",
])("invalid or unsupported manifests fail without changing World: %s", (source) => {
  const s = write(ready(), source);
  rejected(s, "kubectl apply -f config.json", "error:");
});

test("multiple YAML resources are applied/deleted together and invalid later entries never leave partial changes", () => {
  const source = [cm(), secret()].map((v) => JSON.stringify(v)).join("\n---\n");
  const s = write(ready(), source, "bundle.yaml");
  const applied = execute(s, "kubectl apply -f bundle.yaml");
  expect(applied.world.kubeConfigs).toHaveLength(2);
  expect(execute(applied, "kubectl delete -f bundle.yaml").world.kubeConfigs).toHaveLength(0);
  const broken = write(
    s,
    `${JSON.stringify(cm())}\n---\n${JSON.stringify({ ...secret(), immutable: true })}`,
  );
  rejected(broken, "kubectl apply -f config.json", "Unsupported");
  rejected(
    write(s, `${JSON.stringify(cm())}\n---\n${JSON.stringify(cm())}`),
    "kubectl apply -f config.json",
    "Duplicate resource",
  );
});

test("ConfigMap-only role can apply/delete without Deployment permission; mixed Secret file fails atomically", () => {
  const s = execute(
    ready(),
    "gcloud iam roles create configEditor --permissions=container.configMaps.get,container.configMaps.create,container.configMaps.update,container.configMaps.delete",
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:developer@example.com --role=projects/ace-dev-01/roles/configEditor",
    "gcloud auth login developer@example.com",
  );
  const applied = execute(
    s,
    "kubectl apply -f app-config.yaml",
    "sim files replace app-config.yaml --search=staging --replacement=production",
    "kubectl apply -f app-config.yaml",
  );
  execute(applied, "kubectl delete -f app-config.yaml");
  const mixed = write(s, `${JSON.stringify(cm())}\n---\n${JSON.stringify(secret())}`);
  rejected(mixed, "kubectl apply -f config.json", "container.secrets.get");
  expect(mixed.world.kubeConfigs).toHaveLength(0);
});

test("apply uses get plus create for a new config and get plus update for an existing config", () => {
  const s = execute(
    ready(),
    "gcloud iam roles create configCreator --permissions=container.configMaps.get,container.configMaps.create",
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:developer@example.com --role=projects/ace-dev-01/roles/configCreator",
    "gcloud auth login developer@example.com",
  );
  const created = execute(s, "kubectl apply -f app-config.yaml");
  rejected(created, "kubectl apply -f app-config.yaml", "container.configMaps.update");
  rejected(created, "kubectl delete -f app-config.yaml", "container.configMaps.delete");
  rejected(created, "kubectl create -f app-secret.yaml", "container.secrets.create");
});

test("virtual files do not bypass API or cluster context and same name stays isolated per cluster", () => {
  rejected(
    execute(session(), "sim files load kubernetes-config"),
    "kubectl apply -f app-config.yaml",
    "container.googleapis.com",
  );
  const s = execute(ready(), "kubectl apply -f app-config.yaml");
  const other = execute(
    s,
    "gcloud container clusters create-auto other --region=us-central1",
    "kubectl apply -f app-config.yaml",
  );
  expect(other.world.kubeConfigs).toHaveLength(2);
  const deleted = execute(other, "kubectl delete -f app-config.yaml");
  expect(deleted.world.kubeConfigs[0]?.cluster).toBe("config-gke");
});

test("virtual filenames cannot escape workspace; existing virtual deployment.yaml takes precedence over sample", () => {
  const s = ready();
  for (const path of [
    "../config.yaml",
    "/config.yaml",
    "a//x.yaml",
    "a/../x.yaml",
    "constructor/x.yaml",
    "https://example.com/x.yaml",
  ])
    rejected(s, `sim files write ${path} --content=x`, "ERROR:");
  const virtual = write(s, JSON.stringify(cm()), "deployment.yaml");
  const applied = execute(virtual, "kubectl apply -f deployment.yaml");
  expect(applied.world.kubeDeployments).toHaveLength(0);
  expect(data(applied)).toEqual([{ key: "MODE", value: "prod" }]);
  rejected(write(s, "invalid", "deployment.yaml"), "kubectl apply -f deployment.yaml", "error:");
  rejected(s, "kubectl apply -f app-config.yaml -f app-secret.yaml", "error:");
  rejected(s, "kubectl apply -f missing/deployment.yaml", "does not exist");
  rejected(s, "kubectl create -f app-config.yaml deployment web", "Do not combine");
  rejected(s, "kubectl delete -f app-config.yaml cm other", "Do not combine");
});

test("file listing/read/replace/delete and completions work for both workspaces", () => {
  const s = execute(ready(), "sim files load terraform-network");
  expect(execute(s, "sim files list").text).toContain("app-config.yaml");
  expect(execute(s, "sim files read ./app-config.yaml").text).toContain("ConfigMap");
  expect(Engine.completionCandidates(s.world, "sim files load kubernetes-")).toContain(
    "kubernetes-config",
  );
  expect(Engine.completionCandidates(s.world, "kubectl apply --filename=app-")).toContain(
    "--filename=app-config.yaml",
  );
  rejected(s, "sim files load kubernetes-config", "already exists");
  const deleted = execute(s, "sim files delete app-config.yaml");
  expect(deleted.world.terraform).toEqual(s.world.terraform);
  rejected(deleted, "kubectl apply -f app-config.yaml", "does not exist");
});

test("v10 migration keeps ConfigMap/Secret, runtime environments, Terraform and container states", () => {
  const s = execute(
    ready(),
    "kubectl apply -f app-config.yaml",
    "kubectl create deployment web --image=nginx:1",
    "kubectl set env deployment/web --from=configmap/app-config",
    "sim files load terraform-network",
  );
  const old = JSON.parse(JSON.stringify(Snapshot.create(s.world, Now)));
  old.schemaVersion = 10;
  delete old.world.kubeFiles;
  for (const c of old.world.kubeConfigs) delete c.lastAppliedKeys;
  const migrated = session(Result.unwrap(Snapshot.fromUnknown(old)));
  expect(migrated.world.kubeDeployments).toEqual(s.world.kubeDeployments);
  expect(migrated.world.terraform).toEqual(s.world.terraform);
  expect(migrated.world.containerLab).toEqual(s.world.containerLab);
  expect(migrated.world.kubeConfigs[0]?.lastAppliedKeys).toEqual([]);
  expect(data(migrated, "app-config")).toEqual(data(s, "app-config"));
  expect(migrated.world.kubeFiles).toEqual({});
});

test("snapshot validation rejects unsafe files and malformed last-applied keys", () => {
  const s = execute(ready(), "kubectl apply -f app-config.yaml");
  for (const kubeFiles of [
    { "../bad.yaml": "" },
    { "file.yaml": "x".repeat(64001) },
    Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`f${i}.yaml`, ""])),
  ])
    expect(Result.isOk(Snapshot.fromUnknown(Snapshot.create({ ...s.world, kubeFiles }, Now)))).toBe(
      false,
    );
  const bad = {
    ...s.world,
    kubeConfigs: s.world.kubeConfigs.map((c) => ({ ...c, lastAppliedKeys: ["X", "X"] })),
  };
  expect(Result.isOk(Snapshot.fromUnknown(Snapshot.create(bad, Now)))).toBe(false);
});

test("manifest mission requires apply-managed references and all Pods refreshed, not just file edits", () => {
  const id = "m-gke-005";
  const start = session(Result.unwrap(Engine.startMission(session().world, id)));
  const status = (s: Session) => s.world.missions.find((m) => m.id === id)?.status;
  const s = execute(
    start,
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create-auto config-gke --region=us-central1",
    "kubectl create deployment config-web --image=nginx:1 --replicas=2",
    "sim files load kubernetes-config",
    "kubectl apply -f app-config.yaml",
    "kubectl apply -f app-secret.yaml",
    "kubectl set env deployment/config-web --from=configmap/app-config",
    "kubectl set env deployment/config-web --from=secret/app-secret",
    "sim files replace app-config.yaml --search=staging --replacement=production",
  );
  expect(status(s)).toBe("in_progress");
  const applied = execute(s, "kubectl apply -f app-config.yaml");
  expect(status(applied)).toBe("in_progress");
  const deployment = applied.world.kubeDeployments[0];
  if (!deployment) throw new Error("fixture deployment missing");
  const pod = KubePod.fromDeployment(deployment)[0];
  if (!pod) throw new Error("fixture Pod missing");
  expect(status(execute(applied, `kubectl delete pod ${pod.name}`))).toBe("in_progress");
  const wrong = execute(
    applied,
    "kubectl set env deployment/config-web APP_MODE=production",
    "kubectl rollout restart deployment/config-web",
  );
  expect(status(wrong)).toBe("in_progress");
  expect(status(execute(restore(applied), "kubectl rollout restart deployment/config-web"))).toBe(
    "completed",
  );
});

test("create/delete multi-resource failures do not leave partial changes", () => {
  const s = execute(
    write(ready(), [cm(), secret()].map((v) => JSON.stringify(v)).join("\n---\n")),
    "kubectl create secret generic credentials --from-literal=TOKEN=old",
  );
  rejected(s, "kubectl create -f config.json", "already exists");
  const both = execute(s, "kubectl create configmap settings --from-literal=MODE=old");
  const missing = execute(both, "kubectl delete secret credentials");
  rejected(missing, "kubectl delete -f config.json", "not found");
});

test("built-in sample create distinguishes AlreadyExists from apply", () => {
  const s = execute(ready(), "kubectl create -f deployment.yaml", "kubectl create -f service.yaml");
  rejected(s, "kubectl create -f deployment.yaml", "already exists");
  rejected(s, "kubectl create -f service.yaml", "already exists");
  expect(execute(s, "kubectl apply -f deployment.yaml").text).toContain("unchanged");
});
