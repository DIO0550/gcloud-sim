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
  commands.reduce((s, command) => {
    const next = run(s, command);
    expect(next.text, command).not.toMatch(/^(ERROR:|error:|Error from server)/m);
    expect(World.validate(next.world), command).toEqual(Result.ok(next.world));
    return next;
  }, s);
const ready = () =>
  execute(
    session(),
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create-auto labels-gke --region=us-central1",
    "sim files load kubernetes-config-labels",
    "kubectl apply -f labeled-configs.yaml",
  );
const rejected = (s: Session, command: string, message: string | RegExp) => {
  const next = run(s, command);
  expect(next.text, command).toMatch(message);
  expect(next.world, command).toEqual(s.world);
};
const json = (s: Session, command: string) => JSON.parse(execute(s, command).text);
const restore = (s: Session) =>
  session(
    Result.unwrap(Snapshot.fromUnknown(JSON.parse(JSON.stringify(Snapshot.create(s.world, Now))))),
  );
const config = (s: Session, name = "settings-prod") => {
  const c = s.world.kubeConfigs.find((c) => c.name === name);
  if (!c) throw new Error("fixture");
  return c;
};
const classified = (s: Session) =>
  execute(
    s,
    "kubectl label cm settings-dev app=web environment=staging",
    "kubectl label configmaps/settings-prod app=web environment=production --overwrite",
    "kubectl label cm/settings-prod temporary-",
    "kubectl label secrets credentials app=web environment=production",
  );
const write = (s: Session, labels: unknown, name = "settings-prod") =>
  execute(
    s,
    `sim files write config.json --content='${JSON.stringify({ apiVersion: "v1", kind: "ConfigMap", metadata: { name, labels }, data: { MODE: "production" } })}'`,
  );

test("literal create has empty labels; imperative edits preserve data, apply ownership, timestamps and running Pods", () => {
  const before = ready();
  const after = classified(before);
  expect(config(after).labels).toEqual({ app: "web", environment: "production" });
  expect(config(after).data).toEqual(config(before).data);
  expect(config(after).lastAppliedLabelKeys).toEqual(["environment", "temporary"]);
  expect(config(after).createdAt).toBe(config(before).createdAt);
  expect(after.world.kubeDeployments).toEqual(before.world.kubeDeployments);
  expect(execute(after, "kubectl exec deployment/web -- printenv MODE").text).toBe("production");
  expect(execute(after, "kubectl exec deployment/web -- printenv TOKEN").text).toBe("demo-token");
  const literal = execute(
    after,
    "kubectl create configmap empty",
    "kubectl create secret generic empty",
  );
  expect(literal.world.kubeConfigs.filter((c) => c.name === "empty").map((c) => c.labels)).toEqual([
    {},
    {},
  ]);
  expect(restore(after).world).toEqual(after.world);
});

test("overwrite is required only for different values; removals, empty values and qualified keys are idempotent", () => {
  const s = ready();
  rejected(s, "kubectl label cm settings-prod app=web environment=production", "--overwrite");
  expect(execute(s, "kubectl label cm settings-prod environment=staging").world).toEqual(s.world);
  const changed = execute(
    s,
    "kubectl label cm settings-prod example.com/team=platform empty= temporary-",
  );
  expect(config(changed).labels).toEqual({
    "example.com/team": "platform",
    empty: "",
    environment: "staging",
  });
  expect(execute(changed, "kubectl label cm settings-prod temporary- absent-").world).toEqual(
    changed.world,
  );
});

test("selectors use AND equality and aliases, return empty lists, and combine with all namespaces", () => {
  const s = classified(ready());
  expect(
    json(s, "kubectl get cm -l app=web,environment==production -o json").items.map(
      (c: { metadata: { name: string } }) => c.metadata.name,
    ),
  ).toEqual(["settings-prod"]);
  expect(json(s, "kubectl get secrets -l environment=production -o json").items).toHaveLength(1);
  expect(execute(s, "kubectl get configmaps -l environment=staging").text).toContain(
    "settings-dev",
  );
  expect(execute(s, "kubectl get cm -l environment=absent").text).toContain("No resources found");
  expect(json(s, "kubectl get secrets -l app=missing -o json").items).toEqual([]);
  const other = execute(
    s,
    "kubectl create ns staging",
    "kubectl create configmap settings-prod --from-literal=MODE=staging -n staging",
    "kubectl label cm settings-prod environment=production -n staging",
  );
  expect(json(other, "kubectl get cm -A -l environment=production -o json").items).toHaveLength(2);
  expect(
    json(other, "kubectl get cm -n staging -l environment=production -o json").items[0].metadata
      .namespace,
  ).toBe("staging");
  expect(config(other).data).toEqual(config(s).data);
});

test("label and selector obey context defaults, explicit namespaces, cluster and project boundaries", () => {
  const s = execute(
    ready(),
    "kubectl create ns staging",
    "kubectl create configmap settings-prod -n staging",
    "kubectl config set-context --current --namespace=staging",
    "kubectl label cm settings-prod environment=staging",
  );
  expect(json(s, "kubectl get cm -l environment=staging -o json").items).toHaveLength(1);
  const explicit = execute(
    s,
    "kubectl label cm settings-prod environment=production --overwrite -n default",
  );
  expect(json(explicit, "kubectl get cm settings-prod -o json").metadata.labels.environment).toBe(
    "staging",
  );
  expect(
    json(explicit, "kubectl get cm settings-prod -n default -o json").metadata.labels.environment,
  ).toBe("production");
  const other = execute(
    explicit,
    "gcloud container clusters create-auto other --region=us-central1",
  );
  rejected(other, "kubectl label cm settings-prod app=web", "not found");
  const prod = execute(
    s,
    "gcloud config set project ace-prod-01",
    "gcloud billing projects link ace-prod-01 --billing-account=01AB2C-DEF345-6789AB",
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create-auto labels-gke --region=us-central1",
  );
  rejected(prod, "kubectl label cm settings-prod app=web", "not found");
  rejected(
    s,
    "kubectl label cm settings-prod app=web -n missing",
    'namespaces "missing" not found',
  );
});

test.each([
  ["kubectl label cm/settings-prod", "Must be specified"],
  ["kubectl label cm settings-prod", "Specify one"],
  ["kubectl label deployment/web app=web", "one named ConfigMap or Secret"],
  ["kubectl label all app=web", "one named ConfigMap or Secret"],
  ["kubectl label cm settings-prod app=web app=other", "Duplicate label key"],
  ["kubectl label cm settings-prod app=web app-", "Duplicate label key"],
  ["kubectl label cm settings-prod broken", "Invalid label"],
  ["kubectl label cm settings-prod bad/key/name=value", "Invalid label"],
  ["kubectl label cm settings-prod example.COM/team=value", "Invalid label"],
  ["kubectl label cm settings-prod app=bad/value", "Invalid label"],
  [`kubectl label cm settings-prod app=${"a".repeat(64)}`, "Invalid label"],
  ["kubectl label cm settings-prod app=web --all", "unrecognized"],
  ["kubectl get cm settings-prod -l app=web", "unnamed"],
  ["kubectl get secrets -l app!=web", "Invalid label"],
])("invalid label usage is atomic: %s", (command, message) => rejected(ready(), command, message));

test("the 100-label limit applies to the resulting map, with removal freeing room", () => {
  const labels = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`key${i}`, "v"]));
  const s = execute(write(ready(), labels), "kubectl apply -f config.json");
  rejected(s, "kubectl label cm settings-prod extra=v", "100");
  const replaced = execute(s, "kubectl label cm settings-prod key0- extra=v");
  expect(Object.keys(config(replaced).labels)).toHaveLength(100);
});

test("apply owns only submitted labels and removes omitted managed labels without removing imperative labels", () => {
  const s = execute(
    write(ready(), { environment: "production", team: "platform" }),
    "kubectl apply -f config.json",
    "kubectl label cm settings-prod owner=ops",
  );
  expect(config(s).labels).toEqual({ environment: "production", owner: "ops", team: "platform" });
  expect(config(s).lastAppliedLabelKeys).toEqual(["environment", "team"]);
  const changed = execute(write(s, { environment: "production" }), "kubectl apply -f config.json");
  expect(config(changed).labels).toEqual({ environment: "production", owner: "ops" });
  expect(changed.world.kubeDeployments).toEqual(s.world.kubeDeployments);
  const omitted = execute(write(changed, undefined), "kubectl apply -f config.json");
  expect(config(omitted).labels).toEqual({ owner: "ops" });
  expect(config(omitted).lastAppliedLabelKeys).toEqual([]);
  expect(execute(omitted, "kubectl apply -f config.json").text).toContain("unchanged");
  expect(execute(omitted, "kubectl apply -f config.json").world).toEqual(omitted.world);
  const regained = execute(
    s,
    "kubectl label cm settings-prod team-",
    "kubectl apply -f config.json",
  );
  expect(config(regained).labels.team).toBe("platform");
});

test("manifest create labels do not claim apply ownership; Secret apply removes managed labels and protects its data", () => {
  const s = execute(write(ready(), { owner: "ops" }, "created"), "kubectl create -f config.json");
  expect(config(s, "created").lastAppliedLabelKeys).toEqual([]);
  expect(
    config(execute(write(s, {}, "created"), "kubectl apply -f config.json"), "created").labels,
  ).toEqual({ owner: "ops" });
  const secret = (labels: Record<string, string>) =>
    JSON.stringify({
      apiVersion: "v1",
      kind: "Secret",
      metadata: { name: "credentials", labels },
      stringData: { TOKEN: "demo-token" },
    });
  const labeled = execute(
    s,
    `sim files write secret.json --content='${secret({ environment: "production" })}'`,
    "kubectl apply -f secret.json",
    "kubectl label secret credentials owner=ops",
  );
  const cleared = execute(
    labeled,
    `sim files write secret.json --content='${secret({})}'`,
    "kubectl apply -f secret.json",
  );
  expect(config(cleared, "credentials").labels).toEqual({ owner: "ops" });
  expect(config(cleared, "credentials").data).toEqual(config(s, "credentials").data);
  expect(cleared.world.kubeDeployments).toEqual(s.world.kubeDeployments);
});

test.each([null, [], { team: 3 }, { team: true }, { "bad/key/name": "v" }, { team: "bad/value" }])(
  "invalid manifest metadata labels fail before any changes: %j",
  (labels) => {
    const s = write(ready(), labels);
    rejected(s, "kubectl apply -f config.json", /[Ll]abel/);
    const content = s.world.kubeFiles["config.json"];
    expect(Result.isOk(KubeManifest.parse(content ?? ""))).toBe(false);
  },
);

test("mixed manifest validation and permission failures are atomic", () => {
  const s = execute(
    ready(),
    "gcloud iam roles create configEditor --permissions=container.configMaps.get,container.configMaps.update,container.configMaps.list",
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:developer@example.com --role=projects/ace-dev-01/roles/configEditor",
    "gcloud auth login developer@example.com",
  );
  execute(s, "kubectl label cm settings-prod app=web", "kubectl get cm -l environment=staging");
  rejected(s, "kubectl label secret credentials app=web", "container.secrets.get");
  rejected(s, "kubectl get secrets -l app=web", "container.secrets.list");
  rejected(s, "kubectl apply -f labeled-configs.yaml", "container.secrets.get");
  const reader = execute(
    ready(),
    "gcloud iam roles create readOnly --permissions=container.configMaps.get",
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:developer@example.com --role=projects/ace-dev-01/roles/readOnly",
    "gcloud auth login developer@example.com",
  );
  rejected(reader, "kubectl label cm settings-prod app=web", "container.configMaps.update");
  const updater = execute(
    ready(),
    "gcloud iam roles create updateOnly --permissions=container.secrets.update",
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:developer@example.com --role=projects/ace-dev-01/roles/updateOnly",
    "gcloud auth login developer@example.com",
  );
  rejected(updater, "kubectl label secret credentials app=web", "container.secrets.get");
  rejected(
    execute(ready(), "gcloud services disable container.googleapis.com"),
    "kubectl label cm settings-prod app=web",
    "disabled",
  );
});

test("Secret list, describe and label output keep data hidden; explicit JSON get encodes data", () => {
  const s = classified(ready());
  for (const command of [
    "kubectl get secrets -l app=web",
    "kubectl describe secret credentials",
    "kubectl label secret credentials app=web",
  ]) {
    const text = execute(s, command).text;
    expect(text).not.toContain("demo-token");
    expect(text).not.toContain("ZGVtby10b2tlbg==");
  }
  expect(execute(s, "kubectl describe secret credentials").text).toContain("production");
  expect(json(s, "kubectl get secrets -l app=web -o json").items[0].data.TOKEN).toBe(
    "ZGVtby10b2tlbg==",
  );
});

test.each([18, 19])(
  "legacy v%s fills empty labels and preserves namespaced configurations and runtime",
  (version) => {
    const s = execute(
      ready(),
      "kubectl create ns staging",
      "kubectl create configmap settings-prod --from-literal=MODE=staging -n staging",
      "kubectl config set-context --current --namespace=staging",
    );
    const snapshot = JSON.parse(JSON.stringify(Snapshot.create(s.world, Now)));
    snapshot.schemaVersion = version;
    for (const c of snapshot.world.kubeConfigs) {
      delete c.labels;
      delete c.lastAppliedLabelKeys;
    }
    if (version === 18) delete snapshot.world.kubeContextNamespaces;
    const migrated = Result.unwrap(Snapshot.fromUnknown(snapshot));
    const expected = {
      ...s.world,
      kubeConfigs: s.world.kubeConfigs.map((c) => ({ ...c, labels: {}, lastAppliedLabelKeys: [] })),
      kubeContextNamespaces: version === 18 ? {} : s.world.kubeContextNamespaces,
    };
    expect(migrated).toEqual(expected);
    expect(restore(session(migrated)).world).toEqual(migrated);
  },
);

test.each([
  { labels: undefined },
  { labels: { app: 1 } },
  { labels: { app: "bad/value" } },
  { lastAppliedLabelKeys: undefined },
  { lastAppliedLabelKeys: ["app", "app"] },
  { lastAppliedLabelKeys: ["bad/key/name"] },
])("malformed v20 label fields are rejected: %j", (patch) => {
  const s = ready();
  const snapshot = JSON.parse(JSON.stringify(Snapshot.create(s.world, Now)));
  Object.assign(snapshot.world.kubeConfigs[0], patch);
  expect(Result.isOk(Snapshot.fromUnknown(snapshot))).toBe(false);
});

test("mission requires correct labels and original referenced data and Deployment revision", () => {
  const id = "m-gke-017";
  const status = (s: Session) => s.world.missions.find((m) => m.id === id)?.status;
  const started = session(Result.unwrap(Engine.startMission(session().world, id)));
  const prepared = execute(
    started,
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create-auto labels-gke --region=us-central1",
    "sim files load kubernetes-config-labels",
    "kubectl apply -f labeled-configs.yaml",
  );
  expect(status(prepared)).toBe("in_progress");
  const wrong = execute(prepared, "kubectl rollout restart deployment/web");
  expect(status(classified(wrong))).toBe("in_progress");
  const badData = execute(
    write(prepared, { environment: "staging" }),
    "sim files replace config.json --search=production --replacement=wrong",
    "kubectl apply -f config.json",
  );
  expect(status(classified(badData))).toBe("in_progress");
  const done = classified(restore(prepared));
  expect(status(done)).toBe("completed");
  expect(restore(done).world).toEqual(done.world);
});

test("help and completion expose the bounded label command and overwrite flag", () => {
  const s = ready();
  expect(Engine.completionCandidates(s.world, "kubectl la")).toContain("label");
  expect(Engine.completionCandidates(s.world, "kubectl label ")).toContain("cm");
  expect(Engine.completionCandidates(s.world, "kubectl label cm settings-prod --")).toContain(
    "--overwrite",
  );
  expect(execute(s, "kubectl label --help").text).toContain("--overwrite");
});

test("configuration validation rejects too many managed label keys independently of live labels", () => {
  const c = config(ready());
  expect(
    Result.isOk(
      KubeConfig.validate({
        ...c,
        labels: {},
        lastAppliedLabelKeys: Array.from({ length: 101 }, (_, i) => `key${i}`),
      }),
    ),
  ).toBe(false);
});
