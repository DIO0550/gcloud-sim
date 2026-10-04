// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { Now, run, type Session, session } from "@/engine/__tests__/setup";
import { KubePod } from "@/engine/domains/kubernetes";
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
const d = (s: Session) => {
  const d = s.world.kubeDeployments[0];
  if (!d) throw new Error("fixture");
  return d;
};
const pods = (s: Session) => KubePod.fromDeployment(d(s)).map((p) => p.name);
const json = (s: Session, c: string) => JSON.parse(execute(s, c).text);
const restore = (s: Session) =>
  session(
    Result.unwrap(Snapshot.fromUnknown(JSON.parse(JSON.stringify(Snapshot.create(s.world, Now))))),
  );
const configured = () =>
  execute(
    ready(),
    "kubectl create configmap settings --from-literal=MODE=staging --from-literal=COLOR=blue",
    "kubectl create secret generic credentials --from-literal=TOKEN=demo-secret",
    "kubectl set env deployment/web --from=configmap/settings",
    "kubectl set env deployment/web --from=secret/credentials",
  );

test("repeated literals preserve commas, equals, whitespace, empty and Unicode values; resources persist", () => {
  const s = execute(
    ready(),
    "kubectl create configmap settings --from-literal=MODE=prod --from-literal='MESSAGE=こんにちは, a=b' --from-literal=EMPTY=",
  );
  expect(json(s, "kubectl get cm settings -o json").data).toEqual({
    MODE: "prod",
    MESSAGE: "こんにちは, a=b",
    EMPTY: "",
  });
  expect(execute(s, "kubectl get configmaps").text).toContain("settings");
  expect(restore(s).world).toEqual(s.world);
  rejected(s, "kubectl create configmap settings", "already exists");
  rejected(s, "kubectl create configmap duplicate --from-literal=X=a --from-literal=X=b", "unique");
});
test("Secret list/describe hide values, explicit structured get encodes UTF-8 as base64", () => {
  const s = execute(
    ready(),
    "kubectl create secret generic credentials --from-literal='TOKEN=架空のトークン'",
  );
  const listing = execute(s, "kubectl get secrets").text;
  expect(listing).toContain("Opaque");
  expect(listing).not.toContain("架空");
  const description = execute(s, "kubectl describe secret credentials").text;
  expect(description).toContain("bytes");
  expect(description).not.toContain("架空");
  expect(json(s, "kubectl get secret/credentials -o json").data.TOKEN).toBe(
    Buffer.from("架空のトークン").toString("base64"),
  );
});
test("set env imports references, literal values and removals with idempotence and actual Pod inspection", () => {
  const s = execute(configured(), "kubectl set env deployment web LOG_LEVEL=debug EMPTY=");
  const env = json(s, "kubectl get deployment/web -o json").spec.template.spec.containers[0].env;
  expect(env).toContainEqual({
    name: "MODE",
    valueFrom: { configMapKeyRef: { name: "settings", key: "MODE" } },
  });
  expect(env).toContainEqual({
    name: "TOKEN",
    valueFrom: { secretKeyRef: { name: "credentials", key: "TOKEN" } },
  });
  expect(execute(s, "kubectl set env deployment/web --list").text).not.toContain("demo-secret");
  expect(execute(s, "kubectl exec deployment/web -- printenv TOKEN").text).toBe("demo-secret");
  expect(execute(s, "kubectl exec deployment/web -- env").text).toContain("MODE=staging");
  expect(execute(s, "kubectl set env deployment/web LOG_LEVEL=debug EMPTY=").world).toEqual(
    s.world,
  );
  const removed = execute(s, "kubectl set env deployment/web LOG_LEVEL- EMPTY-");
  rejected(removed, "kubectl exec deployment/web -- printenv LOG_LEVEL", "not set");
  expect(d(removed).revision).toBe(d(s).revision + 1);
});
test("import supports selected keys and prefix, while collisions and missing keys are atomic failures", () => {
  const s = execute(
    ready(),
    "kubectl create configmap settings --from-literal=mode=prod --from-literal=two-words=value",
  );
  const prefixed = execute(
    s,
    "kubectl set env deployment/web --from=configmap/settings --keys=mode --prefix=APP_",
  );
  expect(execute(prefixed, "kubectl exec deployment/web -- printenv APP_MODE").text).toBe("prod");
  expect(d(prefixed).env).toHaveLength(1);
  rejected(
    prefixed,
    "kubectl set env deployment/web --from=configmap/settings --keys=mode,missing",
    "not found",
  );
  const collision = execute(
    s,
    "kubectl create configmap collision --from-literal=a-b=1 --from-literal=A_B=2",
  );
  rejected(collision, "kubectl set env deployment/web --from=configmap/collision", "Duplicate");
});
test("config recreation keeps running values; scale-up resolves new values; restart refreshes all Pods", () => {
  const s = configured();
  const before = pods(s);
  const changed = execute(
    s,
    "kubectl delete cm settings",
    "kubectl create configmap settings --from-literal=MODE=production --from-literal=COLOR=green",
  );
  expect(pods(changed)).toEqual(before);
  expect(execute(changed, "kubectl exec deployment/web -- printenv MODE").text).toBe("staging");
  const scaled = execute(restore(changed), "kubectl scale deployment/web --replicas=3");
  expect(execute(scaled, `kubectl exec ${pods(scaled)[2]} -- printenv MODE`).text).toBe(
    "production",
  );
  expect(execute(scaled, `kubectl exec ${before[0]} -- printenv MODE`).text).toBe("staging");
  const restarted = execute(scaled, "kubectl rollout restart deployment/web");
  for (const pod of pods(restarted))
    expect(execute(restarted, `kubectl exec ${pod} -- printenv MODE`).text).toBe("production");
  expect(restore(restarted).world).toEqual(restarted.world);
});
test("missing configuration blocks only new Pods and recovers after a matching key is recreated", () => {
  const s = configured();
  const before = pods(s);
  const removed = execute(s, "kubectl delete secret credentials");
  expect(execute(removed, "kubectl exec deployment/web -- printenv TOKEN").text).toBe(
    "demo-secret",
  );
  const replaced = execute(removed, `kubectl delete pod ${before[0]}`);
  expect(json(replaced, "kubectl get deployment/web -o json").status.readyReplicas).toBe(1);
  expect(execute(replaced, "kubectl get pods").text).toContain("CreateContainerConfigError");
  expect(execute(replaced, `kubectl describe pod ${pods(replaced)[0]}`).text).toContain(
    "secret/credentials key TOKEN not found",
  );
  rejected(replaced, `kubectl logs ${pods(replaced)[0]}`, "CreateContainerConfigError");
  rejected(
    replaced,
    `kubectl exec ${pods(replaced)[0]} -- printenv TOKEN`,
    "CreateContainerConfigError",
  );
  rejected(replaced, "kubectl rollout status deployment/web", "not ready");
  const wrong = execute(
    replaced,
    "kubectl create secret generic credentials --from-literal=WRONG=demo",
  );
  rejected(wrong, "kubectl rollout status deployment/web", "not ready");
  const fixed = execute(
    restore(wrong),
    "kubectl delete secret credentials",
    "kubectl create secret generic credentials --from-literal=TOKEN=new-demo",
    "kubectl rollout status deployment/web",
  );
  expect(pods(fixed)).toEqual(pods(replaced));
  expect(execute(fixed, `kubectl exec ${pods(fixed)[0]} -- printenv TOKEN`).text).toBe("new-demo");
  expect(execute(fixed, `kubectl exec ${before[1]} -- printenv TOKEN`).text).toBe("demo-secret");
});
test("env rollback restores references and literals together with image, preserving replica count", () => {
  const original = execute(configured(), "kubectl set env deployment/web LOG_LEVEL=info");
  const revision = d(original).revision;
  const changed = execute(
    original,
    "kubectl set env deployment/web MODE=literal LOG_LEVEL=debug TOKEN-",
    "kubectl set image deployment/web web=nginx:2",
    "kubectl scale deployment/web --replicas=3",
  );
  const rolled = execute(changed, `kubectl rollout undo deployment/web --to-revision=${revision}`);
  expect(d(rolled)).toMatchObject({ env: d(original).env, image: "nginx:1", replicas: 3 });
  expect(execute(rolled, "kubectl exec deployment/web -- printenv MODE").text).toBe("staging");
  expect(
    execute(changed, `kubectl rollout history deployment/web --revision=${revision}`).text,
  ).toContain("secretKeyRef");
  const oldRs = json(changed, "kubectl get rs -o json").items.find(
    (r: { metadata: { annotations: Record<string, string> } }) =>
      r.metadata.annotations["deployment.kubernetes.io/revision"] === String(revision),
  );
  expect(oldRs.spec.template.spec.containers[0].env).toContainEqual({
    name: "LOG_LEVEL",
    value: "info",
  });
});
test("viewer reads ConfigMaps and template refs, but cannot read Secret values, execute or mutate", () => {
  const s = execute(
    configured(),
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:developer@example.com --role=roles/container.viewer",
    "gcloud auth login developer@example.com",
  );
  execute(
    s,
    "kubectl get configmaps",
    "kubectl describe cm settings",
    "kubectl set env deployment/web --list",
  );
  for (const c of [
    "kubectl get secrets",
    "kubectl get secret credentials -o json",
    "kubectl describe secret credentials",
  ])
    rejected(s, c, "container.secrets.");
  rejected(s, "kubectl exec deployment/web -- printenv TOKEN", "container.pods.exec");
  rejected(s, "kubectl set env deployment/web MODE=prod", "container.deployments.update");
  rejected(s, "kubectl create configmap new", "container.configMaps.create");
  rejected(s, "kubectl delete cm settings", "container.configMaps.delete");
});
test.each([
  "kubectl create configmap INVALID --from-literal=X=a",
  "kubectl create configmap invalid --from-literal=bad/key=a",
  "kubectl create configmap invalid --from-literal=bad",
  "kubectl create configmap invalid --from-file=real-file",
  "kubectl create secret generic invalid --from-env-file=real-file",
  "kubectl set env deployment/web --from=configmap/missing",
  "kubectl set env deployment/web --from=secret/missing",
  "kubectl set env deployment/web --keys=MODE MODE=x",
  "kubectl set env deployment/web --list MODE=x",
  "kubectl set env deployment/web --from=configmap/settings MODE=x",
  "kubectl set env deployment/web 1INVALID=value",
  "kubectl set env deployment/web MODE=x MODE=y",
  "kubectl set env deployment/web MODE=x MODE-",
  "kubectl set env service/web MODE=x",
  "kubectl exec deployment/web -- sh -c printenv",
  "kubectl create configmap bad -n other",
])("invalid/unsupported operation cannot mutate: %s", (c) => rejected(configured(), c, "error:"));
test("project, cluster and API scopes isolate configs; deleting cluster removes configurations", () => {
  const s = configured();
  const other = execute(s, "gcloud container clusters create-auto other --region=us-central1");
  rejected(other, "kubectl get cm settings", "not found");
  const removed = execute(
    other,
    "gcloud container clusters delete app --region=us-central1 --quiet",
  );
  expect(removed.world.kubeConfigs).toHaveLength(0);
  rejected(session(), "kubectl create configmap settings", "container.googleapis.com");
  rejected(s, "kubectl get cm settings --project=ace-prod-01", "container.googleapis.com");
});
test("v9 migration preserves template histories and Pod identities, initializes configurations", () => {
  const s = execute(
    ready(),
    "kubectl set image deployment/web web=nginx:2",
    "kubectl scale deployment/web --replicas=3",
  );
  const value = JSON.parse(JSON.stringify(Snapshot.create(s.world, Now)));
  value.schemaVersion = 9;
  delete value.world.kubeConfigs;
  for (const d of value.world.kubeDeployments) {
    delete d.env;
    delete d.podEnvironments;
    for (const r of d.revisions) delete r.env;
  }
  const migrated = session(Result.unwrap(Snapshot.fromUnknown(value)));
  expect(pods(migrated)).toEqual(pods(s));
  expect(d(migrated).revision).toBe(d(s).revision);
  expect(d(migrated).revisions).toEqual(d(s).revisions);
  expect(migrated.world.kubeConfigs).toEqual([]);
  expect(
    execute(migrated, "kubectl rollout undo deployment/web --to-revision=1").world
      .kubeDeployments[0]?.image,
  ).toBe("nginx:1");
});
test("malformed configuration/environment/cache snapshots fail validation", () => {
  const s = configured();
  for (const mutate of [
    (v: typeof s.world) => ({ ...v, kubeConfigs: [...v.kubeConfigs, ...v.kubeConfigs] }),
    (v: typeof s.world) => ({
      ...v,
      kubeConfigs: v.kubeConfigs.map((c) => ({ ...c, cluster: "absent" })),
    }),
    (v: typeof s.world) => ({
      ...v,
      kubeDeployments: v.kubeDeployments.map((d) => ({ ...d, env: [] })),
    }),
    (v: typeof s.world) => ({
      ...v,
      kubeDeployments: v.kubeDeployments.map((d) => ({
        ...d,
        podEnvironments: [{ podName: "absent", values: [] }],
      })),
    }),
  ])
    expect(Result.isOk(Snapshot.fromUnknown(Snapshot.create(mutate(s.world), Now)))).toBe(false);
});
const lesson = (id: string) =>
  execute(
    session(Result.unwrap(Engine.startMission(session().world, id))),
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create-auto config-gke --region=us-central1",
    "kubectl create deployment config-web --image=nginx:1 --replicas=2",
  );
const status = (s: Session, id: string) => s.world.missions.find((m) => m.id === id)?.status;
test("injection mission requires both source references, literal setting and running values", () => {
  const id = "m-gke-003";
  const s = execute(
    lesson(id),
    "kubectl create configmap app-config --from-literal=APP_MODE=production",
    "kubectl create secret generic app-secret --from-literal=API_TOKEN=demo-token",
  );
  const wrong = execute(
    s,
    "kubectl set env deployment/config-web APP_MODE=production API_TOKEN=demo-token LOG_LEVEL=info",
  );
  expect(status(wrong, id)).toBe("in_progress");
  const partial = execute(
    wrong,
    "kubectl set env deployment/config-web --from=configmap/app-config",
  );
  expect(status(partial, id)).toBe("in_progress");
  const done = execute(
    restore(partial),
    "kubectl set env deployment/config-web --from=secret/app-secret",
  );
  expect(status(done, id)).toBe("completed");
});
test("refresh mission remains incomplete until both Pods restart with changed config", () => {
  const id = "m-gke-004";
  const s = execute(
    lesson(id),
    "kubectl create configmap app-config --from-literal=APP_MODE=staging",
    "kubectl set env deployment/config-web --from=configmap/app-config",
    "kubectl delete configmap app-config",
    "kubectl create configmap app-config --from-literal=APP_MODE=production",
  );
  expect(status(s, id)).toBe("in_progress");
  const single = execute(s, `kubectl delete pod ${pods(s)[0]}`);
  expect(status(single, id)).toBe("in_progress");
  const wrong = execute(
    s,
    "kubectl set env deployment/config-web APP_MODE=production",
    "kubectl rollout restart deployment/config-web",
  );
  expect(status(wrong, id)).toBe("in_progress");
  expect(
    status(execute(restore(single), "kubectl rollout restart deployment/config-web"), id),
  ).toBe("completed");
});

test("custom roles distinguish source get from Deployment update, and ConfigMap-only read needs no Pod permission", () => {
  const s = execute(
    configured(),
    "gcloud iam roles create configReader --permissions=container.configMaps.get,container.configMaps.list,container.deployments.update",
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:developer@example.com --role=projects/ace-dev-01/roles/configReader",
    "gcloud auth login developer@example.com",
  );
  execute(
    s,
    "kubectl get cm settings -o json",
    "kubectl get configmaps",
    "kubectl set env deployment/web --from=configmap/settings",
  );
  rejected(s, "kubectl set env deployment/web --from=secret/credentials", "container.secrets.get");
});
test("help and completion expose configuration commands and sources from the selected cluster", () => {
  const s = configured();
  expect(Engine.completionCandidates(s.world, "kubectl create ")).toContain("configmap");
  expect(Engine.completionCandidates(s.world, "kubectl create secret ")).toContain("generic");
  expect(Engine.completionCandidates(s.world, "kubectl create --")).toContain("--filename");
  expect(Engine.completionCandidates(s.world, "kubectl set ")).toContain("env");
  expect(Engine.completionCandidates(s.world, "kubectl set env deployment/web --from=")).toContain(
    "--from=configmap/settings",
  );
  expect(execute(s, "kubectl create secret generic --help").text).toContain("--from-literal");
  const other = execute(s, "gcloud container clusters create-auto other --region=us-central1");
  expect(
    Engine.completionCandidates(other.world, "kubectl set env deployment/web --from="),
  ).not.toContain("--from=configmap/settings");
});
