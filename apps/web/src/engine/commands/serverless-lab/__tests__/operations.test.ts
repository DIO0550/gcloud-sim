// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { Now, run, session } from "@/engine/__tests__/setup";
import {
  findDeployment,
  latestRevision,
  type RuntimeConfig,
} from "@/engine/domains/serverless-lab/model";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import {
  type ServerlessLesson,
  ServerlessPrelude,
  ServerlessSolutions,
  serverlessSatisfied,
} from "@/engine/missions/serverless";
import { Snapshot } from "@/engine/snapshot";
import { Result } from "@/utils/Result";

const base = () => run(session(), ...ServerlessPrelude);
const solution = (lesson: ServerlessLesson) => {
  let s = base();
  for (const command of ServerlessSolutions[lesson]) {
    const number = s.world.projects.find((p) => p.projectId === "ace-dev-01")!.projectNumber;
    s = run(
      s,
      command
        .replace("SERVICE_AGENT", `service-${number}@serverless-robot-prod.iam.gserviceaccount.com`)
        .replace("EVENT_ID", s.world.serverlessLab.events.at(-1)?.id ?? "MISSING"),
    );
  }
  return s;
};
const deploy = "gcloud run deploy api --region=us-central1 --image=gcr.io/cloudrun/hello";
const d = (s: ReturnType<typeof base>) =>
  findDeployment(s.world, { projectId: "ace-dev-01", region: "us-central1", name: "api" }, "run")!;

test("runtime updates keep old revision settings and no-traffic keeps the serving revision", () => {
  const first = run(
    base(),
    `${deploy} --set-env-vars=STAGE=stable --memory=512Mi --concurrency=10`,
  );
  const next = run(
    first,
    "gcloud run services update api --region=us-central1 --update-env-vars=STAGE=canary --memory=1Gi --no-traffic",
  );
  expect(d(next).revisions[0]).toEqual(d(first).revisions[0]);
  expect(d(next).traffic).toEqual(d(first).traffic);
  expect(latestRevision(d(next)).config).toMatchObject({
    env: { STAGE: "canary" },
    memoryMb: 1024,
    concurrency: 10,
  });
  const unsupported = run(next, "sim run invoke api --region=us-central1 --revision=api-00002-abc");
  expect(unsupported.text).toContain("No serving revision");
});

test.each([
  "--min-instances=11 --max-instances=10",
  "--max-instances=0",
  "--concurrency=0",
  "--cpu=3",
  "--memory=3bad",
  "--cpu=1 --memory=16Gi",
  "--timeout=0s",
  "--set-env-vars=PORT=8000",
  "--set-env-vars=constructor=x",
  "--set-env-vars=A=b --set-secrets=A=s:1",
  "--set-secrets=PASSWORD=s:bogus",
])("invalid runtime config is atomic: %s", (flags) => {
  const s = base();
  const rejected = run(s, `${deploy} ${flags}`);
  expect(rejected.text).toContain("ERROR:");
  expect(rejected.world).toBe(s.world);
});

test.each([
  "--to-revisions=api-00001-abc=99",
  "--to-revisions=unknown=100",
  "--to-revisions=api-00001-abc=-1,api-00002-abc=101",
  "--to-revisions=api-00001-abc=50.5,api-00002-abc=49.5",
  "--to-latest --to-revisions=api-00001-abc=100",
])("invalid traffic split preserves all revisions: %s", (flags) => {
  const s = run(base(), deploy, `${deploy} --no-traffic`);
  const rejected = run(s, `gcloud run services update-traffic api --region=us-central1 ${flags}`);
  expect(rejected.text).toContain("ERROR:");
  expect(rejected.world).toBe(s.world);
});

test("same-name services in different regions remain separate and wrong-region operations fail", () => {
  const s = run(base(), deploy, deploy.replace("us-central1", "asia-northeast1"));
  expect(s.world.runServices.filter((s) => s.name === "api")).toHaveLength(2);
  const bad = run(s, "gcloud run services delete api --region=europe-west1 --quiet");
  expect(bad.text).toContain("does not exist");
  expect(bad.world).toBe(s.world);
  const deleted = run(s, "gcloud run services delete api --region=us-central1 --quiet");
  expect(deleted.world.runServices.find((r) => r.name === "api")?.region).toBe("asia-northeast1");
  expect(Snapshot.fromUnknown(Snapshot.create(deleted.world, Now)).ok).toBe(true);
});

test("allAuthenticatedUsers does not admit anonymous callers; Gen2 requires Run Invoker", () => {
  let s = run(
    base(),
    deploy,
    "gcloud run services add-iam-policy-binding api --region=us-central1 --member=allAuthenticatedUsers --role=roles/run.invoker",
  );
  const anonymous = Engine.execute({
    world: s.world,
    shell: s.shell,
    now: Now,
    line: "sim run invoke api --region=us-central1 --anonymous",
  });
  expect(anonymous.outcome.kind).toBe("failed");
  expect(anonymous.world.serverlessLab.deployments[0]?.invocations.at(-1)?.status).toBe("FAILED");
  s = run(s, "sim run invoke api --region=us-central1");
  expect(s.text).toContain("SUCCEEDED");
  const noRole = run(
    s,
    "gcloud functions deploy gen2 --region=us-central1 --runtime=nodejs22 --trigger-http",
    "gcloud functions add-iam-policy-binding gen2 --region=us-central1 --member=user:someone@example.com --role=roles/cloudfunctions.invoker",
    "gcloud config set account someone@example.com",
    "gcloud functions call gen2 --region=us-central1",
  );
  expect(noRole.text).toContain("run.routes.invoke");
});

test("SA existence and actAs are checked independently from service deployment permissions", () => {
  const s = base();
  expect(
    run(s, `${deploy} --service-account=missing@ace-dev-01.iam.gserviceaccount.com`).text,
  ).toContain("does not exist");
  const without = run(
    s,
    `gcloud iam service-accounts remove-iam-policy-binding lesson-worker@ace-dev-01.iam.gserviceaccount.com --member=user:${F.owner} --role=roles/iam.serviceAccountUser`,
    `${deploy} --service-account=lesson-worker@ace-dev-01.iam.gserviceaccount.com`,
  );
  expect(without.text).toContain("actAs");
  expect(without.world.runServices).toHaveLength(0);
});

test("create-only custom role cannot redeploy an existing resource", () => {
  const s = run(
    base(),
    deploy,
    "gcloud iam roles create runCreator --project=ace-dev-01 --permissions=run.services.create",
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:creator@example.com --role=projects/ace-dev-01/roles/runCreator",
    "gcloud config set account creator@example.com",
  );
  const rejected = run(s, deploy);
  expect(rejected.text).toContain("run.services.update");
  expect(rejected.world).toBe(s.world);
});

test("internal ingress rejects external/LB requests and permits an authorized internal source", () => {
  const s = run(base(), `${deploy} --ingress=internal`);
  expect(run(s, "sim run invoke api --region=us-central1").text).toContain("Ingress blocks");
  expect(run(s, "sim run invoke api --region=us-central1 --source=load-balancer").text).toContain(
    "internal source",
  );
  expect(run(s, "sim run invoke api --region=us-central1 --source=internal").text).toContain(
    "SUCCEEDED",
  );
});

test("Secret version disable/destroy and access revocation affect runtime without exposing data", () => {
  const s = solution("secret");
  const disabled = run(
    s,
    "gcloud secrets versions disable 1 --secret=lesson-password",
    "gcloud functions call secret-api --region=us-central1",
  );
  expect(disabled.text).toContain("disabled or destroyed");
  expect(disabled.text).not.toContain("lesson-only-password");
  const enabled = run(
    disabled,
    "gcloud secrets versions enable 1 --secret=lesson-password",
    "gcloud functions call secret-api --region=us-central1",
  );
  expect(enabled.text).toContain("SUCCEEDED");
  const revoked = run(
    enabled,
    "gcloud secrets remove-iam-policy-binding lesson-password --member=serviceAccount:lesson-worker@ace-dev-01.iam.gserviceaccount.com --role=roles/secretmanager.secretAccessor",
    "gcloud functions call secret-api --region=us-central1",
  );
  expect(revoked.text).toContain("secretmanager.versions.access");
  const destroyed = run(
    s,
    "gcloud secrets versions destroy 1 --secret=lesson-password --quiet",
    "gcloud secrets versions enable 1 --secret=lesson-password",
  );
  expect(destroyed.text).toContain("cannot be restored");
});

test("Redis network mismatch fails invocation and connector cannot be deleted while referenced", () => {
  const s = solution("redis");
  const forbidden = run(
    s,
    "gcloud compute networks vpc-access connectors delete lesson-connector --region=us-central1 --quiet",
  );
  expect(forbidden.text).toContain("still references");
  const wrong = {
    ...s.world,
    serverlessLab: {
      ...s.world.serverlessLab,
      redis: s.world.serverlessLab.redis.map((r) => ({ ...r, network: "other-network" })),
    },
  };
  expect(
    run(session(wrong), "gcloud functions call cache-api --region=us-central1").text,
  ).toContain("authorized VPC");
});

test("Eventarc receiver permission is required independently from Run Invoker", () => {
  const s = solution("storage");
  const eventId = s.world.serverlessLab.events.at(-1)!.id;
  const revoked = run(
    s,
    "gcloud projects remove-iam-policy-binding ace-dev-01 --member=serviceAccount:lesson-worker@ace-dev-01.iam.gserviceaccount.com --role=roles/eventarc.eventReceiver",
    `sim events replay ${eventId}`,
  );
  expect(revoked.text).toContain("eventarc.events.receiveEvent");
  expect(revoked.world.serverlessLab.deliveries.at(-1)?.status).toBe("PENDING");
  expect(
    run(s, "gcloud run services delete upload-api --region=us-central1 --quiet").text,
  ).toContain("Delete referencing");
});

test("retry touches only pending targets; replay shows duplicate side effects unless idempotent", () => {
  const s = solution("retry");
  const id = s.world.serverlessLab.events.at(-1)!.id;
  expect(run(s, `sim events retry ${id}`).text).toContain("no pending");
  const nonidempotent = run(
    s,
    "sim serverless handler event-worker --region=us-central1 --kind=function --no-idempotent",
    `sim events replay ${id}`,
  );
  expect(nonidempotent.world.serverlessLab.deliveries.at(-1)?.effects).toBe(2);
  expect(serverlessSatisfied(nonidempotent.world, "retry")).toBe(false);
});

test("Firestore filters ignore other paths/updates and Datastore mode cannot be a Native trigger", () => {
  const s = solution("firestore");
  const effects = s.world.serverlessLab.deliveries.reduce((n, v) => n + v.effects, 0);
  const wrongPath = run(
    s,
    "sim firestore documents write other/one --database='(default)' --data='{}'",
    "sim firestore documents write orders/one --database='(default)' --data='{}'",
  );
  expect(wrongPath.world.serverlessLab.deliveries.reduce((n, v) => n + v.effects, 0)).toBe(effects);
  const wrongMode = run(
    base(),
    "gcloud firestore databases create old-db --location=us-central1 --type=datastore-mode",
    "gcloud functions deploy db-worker --region=us-central1 --runtime=nodejs22 --trigger-event-filters='type=google.cloud.firestore.document.v1.created,database=old-db,document=orders/{id}'",
  );
  expect(wrongMode.text).toContain("Native");
});

test("workflow stops before its second target when the first target's Invoker permission is revoked", () => {
  const s = solution("workflow");
  const before = s.world.serverlessLab.deployments.find((d) => d.name === "workflow-function")!
    .invocations.length;
  const failed = run(
    s,
    "gcloud run services remove-iam-policy-binding workflow-api --region=us-central1 --member=serviceAccount:lesson-worker@ace-dev-01.iam.gserviceaccount.com --role=roles/run.invoker",
    "gcloud workflows run lesson-workflow --location=us-central1",
  );
  expect(failed.text).toContain("run.routes.invoke");
  expect(failed.world.serverlessLab.workflows[0]?.executions.at(-1)?.status).toBe("FAILED");
  expect(
    failed.world.serverlessLab.deployments.find((d) => d.name === "workflow-function")!.invocations,
  ).toHaveLength(before);
});

test("job failure retains execution history and returns a failed shell outcome", () => {
  const s = run(
    base(),
    "gcloud run jobs create bad-job --region=us-central1 --image=hello --set-env-vars=SIM_FAIL=true",
  );
  const result = Engine.execute({
    world: s.world,
    shell: s.shell,
    now: Now,
    line: "gcloud run jobs execute bad-job --region=us-central1",
  });
  expect(result.outcome.kind).toBe("failed");
  expect(result.world.serverlessLab.deployments[0]?.invocations.at(-1)?.status).toBe("FAILED");
});

test("revision limit preserves the first serving revision and rejects the 101st deploy atomically", () => {
  const first = run(base(), `${deploy} --set-env-vars=STAGE=stable`);
  let s = first;
  for (let i = 2; i <= 100; i += 1) {
    s = run(s, `${deploy} --no-traffic --set-env-vars=STAGE=revision-${i}`);
    expect(s.text).not.toContain("ERROR:");
  }
  expect(d(s).revisions).toHaveLength(100);
  expect(d(s).revisions[0]).toEqual(d(first).revisions[0]);
  expect(d(s).traffic).toEqual(d(first).traffic);

  const rejected = run(s, `${deploy} --no-traffic`);
  expect(rejected.text).toContain("at most 100 revisions");
  expect(rejected.world).toBe(s.world);
  expect(run(s, "sim run invoke api --region=us-central1 --revision=api-00001-abc").text).toContain(
    "SUCCEEDED",
  );
  expect(Snapshot.fromUnknown(Snapshot.create(s.world, Now)).ok).toBe(true);
});

test.each([
  { revisions: [] },
  { traffic: { missing: 100 } },
  { traffic: { "api-00001-abc": 99 } },
  { tasks: 0 },
  { tasks: 1.5 },
  { trigger: { kind: "storage", source: "bucket", eventType: "unsupported", document: "" } },
  {
    invocations: [
      {
        principal: "user",
        source: "external",
        status: "UNKNOWN",
        reason: "",
        revision: "",
        eventId: "",
      },
    ],
  },
])("Snapshot rejects malformed deployment data: %j", (change) => {
  const s = run(base(), deploy);
  const snapshot = Snapshot.create(s.world, Now);
  const result = Snapshot.fromUnknown({
    ...snapshot,
    world: {
      ...snapshot.world,
      serverlessLab: { ...s.world.serverlessLab, deployments: [{ ...d(s), ...change }] },
    },
  });
  const kind = "invocations" in change ? "malformed" : "invariant";
  expect(result).toMatchObject({ ok: false, error: { kind } });
});

const invalidRuntimeConfigs: readonly Partial<RuntimeConfig>[] = [
  { concurrency: 0 },
  { minInstances: 101, maxInstances: 100 },
  { memoryMb: 16384, cpu: 1 },
  { timeoutSeconds: 0 },
  { env: { constructor: "unsafe" } },
  { env: { PASSWORD: "value" }, secrets: { PASSWORD: "secret:1" } },
];
test.each(invalidRuntimeConfigs)("Snapshot rejects malformed runtime config: %j", (change) => {
  const s = run(base(), deploy);
  const deployment = d(s);
  const revision = latestRevision(deployment);
  const snapshot = Snapshot.create(s.world, Now);
  const result = Snapshot.fromUnknown({
    ...snapshot,
    world: {
      ...snapshot.world,
      serverlessLab: {
        ...s.world.serverlessLab,
        deployments: [
          {
            ...deployment,
            revisions: [{ ...revision, config: { ...revision.config, ...change } }],
          },
        ],
      },
    },
  });
  const kind = change.env && Object.hasOwn(change.env, "constructor") ? "malformed" : "invariant";
  expect(result).toMatchObject({ ok: false, error: { kind } });
});

test("v31 migration preserves legacy HTTP visibility, runtime memory and Pub/Sub triggers", () => {
  const s = run(
    base(),
    `${deploy} --allow-unauthenticated`,
    "gcloud pubsub topics create legacy-events",
    "gcloud functions deploy legacy-worker --region=us-central1 --runtime=nodejs22 --memory=512Mi --trigger-topic=legacy-events",
  );
  const { serverlessLab: _lab, ...world } = s.world;
  const restored = Result.unwrap(
    Snapshot.fromUnknown({ schemaVersion: 31, exportedAt: Now, world }),
  );
  expect(restored.serverlessLab.deployments).toHaveLength(2);
  const service = findDeployment(
    restored,
    { projectId: "ace-dev-01", region: "us-central1", name: "api" },
    "run",
  );
  expect(service?.policy.bindings).toContainEqual({
    role: "roles/run.invoker",
    members: ["allUsers"],
  });
  const worker = findDeployment(
    restored,
    { projectId: "ace-dev-01", region: "us-central1", name: "legacy-worker" },
    "function",
  );
  expect(worker?.revisions[0]?.config.memoryMb).toBe(512);
  expect(worker?.trigger).toMatchObject({ kind: "topic", source: "legacy-events" });
  expect(Snapshot.fromUnknown(Snapshot.create(restored, Now)).ok).toBe(true);
});
