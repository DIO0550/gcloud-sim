// @vitest-environment node
import { expect, test } from "vitest";
import { Now, run, type Session, session } from "@/engine/__tests__/setup";
import { Mission } from "@/engine/missions";
import { BuildMissions, buildSatisfied } from "@/engine/missions/builds";
import { Snapshot } from "@/engine/snapshot";
import { Result } from "@/utils/Result";

const image = "us-central1-docker.pkg.dev/ace-dev-01/ace-images/hello:v1";
const builder = "ace-builder@ace-dev-01.iam.gserviceaccount.com";
const nodes = "ace-nodes@ace-dev-01.iam.gserviceaccount.com";
const submit = `gcloud builds submit ./hello-web --tag=${image} --service-account=projects/ace-dev-01/serviceAccounts/${builder} --region=us-central1`;
const execute = (s: Session, ...commands: string[]) =>
  commands.reduce((s, c) => {
    const next = run(s, c);
    expect(next.text, c).not.toContain("ERROR:");
    return next;
  }, s);
const denied = (s: Session, c: string, message: string) => {
  const next = run(s, c);
  expect(next.text).toContain(message);
  expect(next.world).toEqual(s.world);
};
const grant = (email: string, role: string) =>
  `gcloud artifacts repositories add-iam-policy-binding ace-images --location=us-central1 --member=serviceAccount:${email} --role=roles/artifactregistry.${role}`;
const ready = (s = session()) =>
  execute(
    s,
    "gcloud services enable cloudbuild.googleapis.com artifactregistry.googleapis.com container.googleapis.com",
    "gcloud artifacts repositories create ace-images --repository-format=docker --location=us-central1",
    "gcloud iam service-accounts create ace-builder",
    "gcloud iam service-accounts create ace-nodes",
    `gcloud iam service-accounts add-iam-policy-binding ${builder} --member=user:owner@example.com --role=roles/iam.serviceAccountUser`,
    `gcloud iam service-accounts add-iam-policy-binding ${nodes} --member=user:owner@example.com --role=roles/iam.serviceAccountUser`,
  );
const published = (s = ready()) => execute(s, grant(builder, "writer"), submit);
const deploy = (s: Session, ref = image) =>
  execute(
    s,
    `gcloud container clusters create-auto ace-gke --region=us-central1 --service-account=${nodes}`,
    `kubectl create deployment hello --image=${ref} --replicas=2`,
  );
const buildId = (s: Session) => s.world.containerLab.builds.at(-1)?.id ?? "missing";
const buildCmd = (s: Session, verb: string) =>
  `gcloud builds ${verb} ${buildId(s)} --region=us-central1`;
const restore = (s: Session) =>
  session(Result.unwrap(Snapshot.fromUnknown(Snapshot.create(s.world, Now))));

test("remote build creates history and registry image without local Docker state/auth", () => {
  const s = published();
  expect(s.world.containerLab.builds[0]?.status).toBe("SUCCESS");
  expect(s.world.containerLab.registryImages).toHaveLength(1);
  expect(s.world.containerLab.images).toEqual([]);
  expect(s.world.containerLab.authHosts).toEqual([]);
  expect(execute(s, "gcloud builds list --region=us-central1").text).toContain(buildId(s));
  expect(execute(s, buildCmd(s, "log")).text).toContain(`Pushed ${image}`);
  expect(execute(s, buildCmd(s, "describe")).text).toContain(builder);
  expect(restore(s).world).toEqual(s.world);
});
test("builder needs repository write permission even when submitter is owner; failure remains inspectable", () => {
  const s = execute(ready(), submit);
  expect(s.world.containerLab.builds[0]?.status).toBe("FAILURE");
  expect(s.world.containerLab.registryImages).toEqual([]);
  expect(execute(s, buildCmd(s, "log")).text).toContain("uploadArtifacts");
  const fixed = execute(s, grant(builder, "writer"), submit);
  expect(fixed.world.containerLab.builds.map((b) => b.status)).toEqual(["FAILURE", "SUCCESS"]);
});
test("queued/working builds do not publish, reads do not advance, cancellation prevents publication", () => {
  const queued = execute(ready(), grant(builder, "writer"), `${submit} --async`);
  expect(queued.world.containerLab.builds[0]?.status).toBe("QUEUED");
  expect(execute(queued, buildCmd(queued, "describe")).world).toEqual(queued.world);
  const working = execute(queued, `sim builds advance ${buildId(queued)} --region=us-central1`);
  expect(working.world.containerLab.builds[0]?.status).toBe("WORKING");
  expect(working.world.containerLab.registryImages).toEqual([]);
  const cancelled = execute(restore(working), buildCmd(working, "cancel"));
  expect(cancelled.world.containerLab.builds[0]?.status).toBe("CANCELLED");
  denied(cancelled, `sim builds advance ${buildId(cancelled)} --region=us-central1`, "terminal");
  expect(cancelled.world.containerLab.registryImages).toEqual([]);
});
test("async completion rechecks execution identity permissions and repository existence", () => {
  const queued = execute(ready(), grant(builder, "writer"), `${submit} --async`);
  const working = execute(
    queued,
    `sim builds advance ${buildId(queued)} --region=us-central1`,
    `gcloud artifacts repositories remove-iam-policy-binding ace-images --location=us-central1 --member=serviceAccount:${builder} --role=roles/artifactregistry.writer`,
  );
  const failed = execute(working, `sim builds advance ${buildId(working)} --region=us-central1`);
  expect(failed.world.containerLab.builds[0]?.status).toBe("FAILURE");
  const fixed = execute(failed, grant(builder, "writer"), `${submit} --async`);
  const done = execute(
    fixed,
    `sim builds advance ${buildId(fixed)} --region=us-central1`,
    `sim builds advance ${buildId(fixed)} --region=us-central1`,
  );
  expect(done.world.containerLab.builds.at(-1)?.status).toBe("SUCCESS");
});
test("submit permission and serviceAccount actAs are separate", () => {
  const s = execute(
    ready(),
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:developer@example.com --role=roles/cloudbuild.builds.editor",
    "gcloud auth login developer@example.com",
  );
  denied(s, submit, "iam.serviceAccounts.actAs");
  const withActAs = execute(
    s,
    "gcloud auth login owner@example.com",
    `gcloud iam service-accounts add-iam-policy-binding ${builder} --member=user:developer@example.com --role=roles/iam.serviceAccountUser`,
    grant(builder, "writer"),
    "gcloud auth login developer@example.com",
    submit,
  );
  expect(withActAs.world.containerLab.builds.at(-1)?.status).toBe("SUCCESS");
  denied(
    execute(withActAs, "gcloud auth login dev@example.com"),
    submit,
    "cloudbuild.builds.create",
  );
});
test.each([
  [submit.replace("--region=us-central1", "--region=invalid"), "region"],
  [submit.replace("./hello-web", "./unknown"), "built-in"],
  [submit.replace(builder, "missing@ace-dev-01.iam.gserviceaccount.com"), "not found"],
  [`${submit} --config=arbitrary.yaml`, "unrecognized"],
])("invalid build input leaves state intact: %s", (command, message) => {
  denied(ready(), command, message);
});
test("build lookup is scoped by project and region and API is required", () => {
  denied(session(), submit, "cloudbuild.googleapis.com");
  const s = published();
  denied(s, `gcloud builds describe ${buildId(s)}`, "not found");
  denied(s, `${buildCmd(s, "describe")} --project=ace-prod-01`, "cloudbuild.googleapis.com");
});
test("GKE creates a deployment but reports ImagePullBackOff until node SA can pull", () => {
  const s = deploy(published());
  expect(execute(s, "kubectl get pods").text).toContain("ImagePullBackOff");
  expect(execute(s, "kubectl get deployments").text).toContain("0/2");
  expect(execute(s, "kubectl describe deployment hello").text).toContain("downloadArtifacts");
  denied(s, "kubectl rollout status deployment/hello", "not ready");
  const fixed = execute(s, grant(nodes, "reader"));
  expect(execute(restore(fixed), "kubectl get pods").text).toContain("Running");
  expect(execute(fixed, "kubectl rollout status deployment/hello").text).toContain(
    "successfully rolled out",
  );
  const deleted = execute(
    fixed,
    "gcloud artifacts repositories delete ace-images --location=us-central1 --quiet",
  );
  expect(execute(deleted, "kubectl get pods").text).toContain("ImagePullBackOff");
});
test("missing image fails even with node reader; registry digest references work", () => {
  const s = deploy(execute(published(), grant(nodes, "reader")), image.replace(":v1", ":missing"));
  expect(execute(s, "kubectl describe deployment hello").text).toContain("tag or digest not found");
  const digest = s.world.containerLab.registryImages[0]?.digest;
  const fixed = execute(
    s,
    "kubectl delete deployment hello",
    `kubectl create deployment hello --image=${image.replace(":v1", `@${digest}`)} --replicas=2`,
  );
  expect(execute(fixed, "kubectl rollout status deployment/hello").text).toContain(
    "successfully rolled out",
  );
});
test("cluster node account requires existence and actAs; default public images remain compatible", () => {
  const s = ready();
  denied(
    s,
    "gcloud container clusters create-auto invalid --region=us-central1 --service-account=missing@example.com",
    "must exist",
  );
  const restricted = execute(
    s,
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:developer@example.com --role=roles/container.admin",
    "gcloud auth login developer@example.com",
  );
  denied(
    restricted,
    `gcloud container clusters create-auto ace-gke --region=us-central1 --service-account=${nodes}`,
    "actAs",
  );
  const publicImage = execute(
    s,
    "gcloud container clusters create-auto public-gke --region=us-central1",
    "kubectl create deployment web --image=nginx",
  );
  expect(execute(publicImage, "kubectl rollout status deployment/web").text).toContain(
    "successfully rolled out",
  );
});
test("v7 migration keeps Docker/registry state and defaults builds/node identity", () => {
  const s = execute(published(), "docker build -t local:v1 ./hello-web");
  const snap = JSON.parse(JSON.stringify(Snapshot.create(s.world, Now)));
  snap.schemaVersion = 7;
  delete snap.world.containerLab.builds;
  const restored = Result.unwrap(Snapshot.fromUnknown(snap));
  expect(restored.containerLab.images).toEqual(s.world.containerLab.images);
  expect(restored.containerLab.registryImages).toEqual(s.world.containerLab.registryImages);
  expect(restored.containerLab.builds).toEqual([]);
});
test("invalid imported build status/digest/reference are rejected", () => {
  const s = published();
  for (const patch of [
    { status: "UNKNOWN" },
    { digest: "forged" },
    { tag: "nginx:v1" },
    { projectId: "missing-project" },
  ]) {
    const snap = JSON.parse(JSON.stringify(Snapshot.create(s.world, Now)));
    Object.assign(snap.world.containerLab.builds[0], patch);
    expect(Result.isOk(Snapshot.fromUnknown(snap))).toBe(false);
  }
});
test("missions work independently from initial world and do not clear on incomplete builds/deployments", () => {
  for (const m of BuildMissions) {
    const start = session(Result.unwrap(Mission.start(session().world, m)));
    expect(Mission.assertionResults(start.world, m).every(Boolean)).toBe(false);
    const built = published(ready(start));
    expect(buildSatisfied(built.world, { kind: "cloudBuildPublished" })).toBe(true);
    if (m.id === "m-builds-001") {
      expect(Mission.assertionResults(built.world, m).every(Boolean)).toBe(true);
      continue;
    }
    const pending = deploy(built);
    expect(Mission.assertionResults(pending.world, m).every(Boolean)).toBe(false);
    const running = execute(pending, grant(nodes, "reader"));
    expect(Mission.assertionResults(running.world, m).every(Boolean)).toBe(false);
    const done = execute(
      running,
      "kubectl expose deployment hello --type=LoadBalancer --port=80 --target-port=8080",
    );
    expect(Mission.assertionResults(done.world, m).every(Boolean)).toBe(true);
    const cleaned = execute(
      done,
      "kubectl delete service hello",
      "kubectl delete deployment hello",
      "gcloud container clusters delete ace-gke --region=us-central1 --quiet",
      "gcloud artifacts repositories delete ace-images --location=us-central1 --quiet",
    );
    expect(cleaned.world.kubeServices).toEqual([]);
    expect(cleaned.world.kubeDeployments).toEqual([]);
    expect(cleaned.world.containerLab.registryImages).toEqual([]);
    expect(cleaned.world.containerLab.builds[0]?.status).toBe("SUCCESS");
  }
});
