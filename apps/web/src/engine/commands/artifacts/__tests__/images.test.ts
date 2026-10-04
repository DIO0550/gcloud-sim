// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { Now, run, type Session, session } from "@/engine/__tests__/setup";
import { ContainerLab } from "@/engine/domains/container-lab";
import { Mission } from "@/engine/missions";
import { Snapshot } from "@/engine/snapshot";
import { Result } from "@/utils/Result";

const repo = "us-central1-docker.pkg.dev/ace-dev-01/ace-images";
const image = `${repo}/hello`;
const cmd = "gcloud artifacts docker";
const v1 = ContainerLab.digest("hello-web");
const v2 = ContainerLab.digest("hello-web-v2");
const execute = (s: Session, ...commands: string[]) =>
  commands.reduce((s, c) => {
    const next = run(s, c);
    expect(next.text, c).not.toContain("ERROR:");
    return next;
  }, s);
const rejected = (s: Session, c: string, message: string) => {
  const next = run(s, c);
  expect(next.text, c).toContain(message);
  expect(next.world).toEqual(s.world);
};
const ready = (flags = "", s = session()) =>
  execute(
    s,
    "gcloud services enable artifactregistry.googleapis.com",
    `gcloud artifacts repositories create ace-images --location=us-central1 --repository-format=docker ${flags}`,
    "gcloud auth configure-docker us-central1-docker.pkg.dev",
    `docker build -t ${image}:v1 ./hello-web`,
    `docker push ${image}:v1`,
    `docker build -t ${image}:v2 ./hello-web-v2`,
    `docker push ${image}:v2`,
  );
const restore = (s: Session) =>
  session(Result.unwrap(Snapshot.fromUnknown(Snapshot.create(s.world, Now))));
const images = (s: Session) => s.world.containerLab.registryImages;
const progress = (s: Session, id: string) => s.world.missions.find((m) => m.id === id)?.status;

test("remote tags can be added by digest, moved and listed independently of local Docker", () => {
  const start = ready();
  const tagged = execute(start, `${cmd} tags add ${image}@${v1} ${image}:stable`);
  expect(images(tagged).find((i) => i.digest === v1)?.tags).toEqual(["v1", "stable"]);
  const moved = execute(tagged, `${cmd} tags add ${image}:v2 ${image}:stable`);
  expect(images(moved).find((i) => i.digest === v1)?.tags).toEqual(["v1"]);
  expect(images(moved).find((i) => i.digest === v2)?.tags).toEqual(["v2", "stable"]);
  expect(moved.world.containerLab.images).toEqual(start.world.containerLab.images);
  expect(execute(moved, `${cmd} tags list ${image} --format=json`).text).toContain(
    `${image}:stable`,
  );
  expect(execute(moved, `${cmd} tags list ${repo}`).text).toContain(v2);
  expect(execute(moved, `${cmd} tags add ${image}:v2 ${image}:stable`).world).toEqual(moved.world);
  expect(restore(moved).world).toEqual(moved.world);
});
test("tag deletion asks for confirmation and retains an untagged digest", () => {
  const s = ready();
  const pending = execute(s, `${cmd} tags delete ${image}:v1`);
  expect(pending.world).toEqual(s.world);
  expect(run(pending, "n").world).toEqual(s.world);
  const untagged = execute(pending, "y");
  expect(images(untagged).find((i) => i.digest === v1)?.tags).toEqual([]);
  rejected(untagged, `${cmd} images describe ${image}:v1`, "not found");
  execute(untagged, `${cmd} images describe ${image}@${v1}`, `docker pull ${image}@${v1}`);
  const deleted = execute(restore(untagged), `${cmd} images delete ${image}@${v1} --quiet`);
  expect(images(deleted).map((i) => i.digest)).toEqual([v2]);
});
test("version deletion protects other tags; --delete-tags removes only the selected version", () => {
  const s = execute(ready(), `${cmd} tags add ${image}:v1 ${image}:stable`);
  rejected(s, `${cmd} images delete ${image}:v1 --quiet`, "--delete-tags");
  rejected(s, `${cmd} images delete ${image}@${v1} --quiet`, "--delete-tags");
  const pending = execute(s, `${cmd} images delete ${image}:v1 --delete-tags`);
  expect(pending.world).toEqual(s.world);
  expect(run(pending, "n").world).toEqual(s.world);
  const removed = execute(pending, "y");
  expect(images(removed).map((i) => i.digest)).toEqual([v2]);
  expect(removed.world.containerLab.images).toEqual(s.world.containerLab.images);
  const single = execute(removed, `${cmd} images delete ${image}:v2 --quiet`);
  expect(images(single)).toEqual([]);
});
test("bare image path deletion removes all versions atomically and isolates other image paths", () => {
  const s = execute(
    ready(),
    `docker tag ${image}:v2 ${repo}/other:v2`,
    `docker push ${repo}/other:v2`,
  );
  rejected(s, `${cmd} images delete ${image} --quiet`, "--delete-tags");
  const removed = execute(s, `${cmd} images delete ${image} --delete-tags --quiet`);
  expect(images(removed).map((i) => i.name)).toEqual(["other"]);
  expect(execute(s, `${cmd} images list ${image} --include-tags`).text).not.toContain("other");
  expect(execute(s, `${cmd} tags list ${image}`).text).not.toContain("other");
});
test("immutable tags allow new aliases but reject moves, untagging and all tagged deletions", () => {
  const s = execute(ready("--immutable-tags"), `${cmd} tags add ${image}:v1 ${image}:stable`);
  for (const command of [
    `${cmd} tags add ${image}:v2 ${image}:stable`,
    `${cmd} tags delete ${image}:v1 --quiet`,
    `${cmd} images delete ${image}:v1 --delete-tags --quiet`,
    `${cmd} images delete ${image} --delete-tags --quiet`,
  ])
    rejected(s, command, "immutable");
  const lab = s.world.containerLab;
  const untagged = session({
    ...s.world,
    containerLab: {
      ...lab,
      registryImages: images(s).map((i) => (i.digest === v1 ? { ...i, tags: [] } : i)),
    },
  });
  const removed = execute(untagged, `${cmd} images delete ${image}@${v1} --quiet`);
  expect(images(removed).map((i) => i.digest)).toEqual([v2]);
});
test("reader/writer/repoAdmin permissions differ and follow repository scope and active account", () => {
  const grant = (role: string) =>
    `gcloud artifacts repositories add-iam-policy-binding ace-images --location=us-central1 --member=user:student@example.com --role=roles/artifactregistry.${role} --account=owner@example.com`;
  const s = execute(ready(), grant("reader"), "gcloud auth login student@example.com");
  execute(s, `${cmd} tags list ${repo}`);
  rejected(s, `${cmd} tags add ${image}:v1 ${image}:stable`, "tags.create");
  const writer = execute(
    s,
    grant("writer"),
    `${cmd} tags add ${image}:v1 ${image}:stable`,
    `${cmd} tags add ${image}:v2 ${image}:stable`,
  );
  rejected(writer, `${cmd} tags delete ${image}:stable --quiet`, "tags.delete");
  rejected(writer, `${cmd} images delete ${image}:v1 --quiet`, "versions.delete");
  const admin = execute(
    writer,
    grant("repoAdmin"),
    `${cmd} tags delete ${image}:stable --quiet`,
    `${cmd} images delete ${image}:v1 --quiet`,
  );
  rejected(
    admin,
    "gcloud artifacts repositories delete ace-images --location=us-central1 --quiet",
    "repositories.delete",
  );
  rejected(
    admin,
    "gcloud artifacts repositories add-iam-policy-binding ace-images --location=us-central1 --member=user:student@example.com --role=roles/artifactregistry.admin",
    "setIamPolicy",
  );
  const other = execute(
    admin,
    "gcloud artifacts repositories create private-images --location=us-central1 --repository-format=docker --account=owner@example.com",
    `docker tag ${image}:v2 us-central1-docker.pkg.dev/ace-dev-01/private-images/hello:v2`,
  );
  rejected(
    other,
    `${cmd} tags list us-central1-docker.pkg.dev/ace-dev-01/private-images`,
    "Permission denied",
  );
  execute(admin, `${cmd} images delete ${image} --delete-tags --quiet`);
});
test.each([
  `tags add ${image}:missing ${image}:stable`,
  `tags add ${image}:v1 ${repo}/other:stable`,
  `tags add ${image}:v1 us-central1-docker.pkg.dev/ace-dev-01/elsewhere/hello:stable`,
  `tags add ${image}:v1 ${image}`,
  `tags add ${image}:v1 ${image}@${v2}`,
  `tags delete ${image} --quiet`,
  `tags list ${image}:v1`,
  `images delete ${image}:v1 --async --quiet`,
])("invalid or unsupported input leaves state unchanged: %s", (suffix) =>
  rejected(ready(), `${cmd} ${suffix}`, "ERROR:"),
);
test("API disable and unauthenticated accounts cannot modify remote images", () => {
  const s = ready();
  const noApi = session({
    ...s.world,
    projects: s.world.projects.map((p) => ({
      ...p,
      enabledApis: p.enabledApis.filter((api) => api !== "artifactregistry.googleapis.com"),
    })),
  });
  rejected(noApi, `${cmd} tags add ${image}:v1 ${image}:stable`, "disabled");
  rejected(
    execute(s, "gcloud config unset account"),
    `${cmd} images delete ${image}:v1 --quiet`,
    "No active account",
  );
});
test("remote version deletion preserves a running local container and build history", () => {
  const s = execute(
    ready(),
    `docker run -d --name cached -p 8080:8080 ${image}:v1`,
    "gcloud services enable cloudbuild.googleapis.com",
    "gcloud iam service-accounts create ace-builder",
    "gcloud iam service-accounts add-iam-policy-binding ace-builder@ace-dev-01.iam.gserviceaccount.com --member=user:owner@example.com --role=roles/iam.serviceAccountUser",
    "gcloud artifacts repositories add-iam-policy-binding ace-images --location=us-central1 --member=serviceAccount:ace-builder@ace-dev-01.iam.gserviceaccount.com --role=roles/artifactregistry.writer",
    `gcloud builds submit ./hello-web --tag=${image}:v1 --service-account=projects/ace-dev-01/serviceAccounts/ace-builder@ace-dev-01.iam.gserviceaccount.com`,
  );
  const removed = execute(s, `${cmd} images delete ${image}:v1 --quiet`);
  expect(removed.world.containerLab.builds).toEqual(s.world.containerLab.builds);
  expect(execute(removed, "sim docker request cached").text).toContain("200 OK");
  rejected(removed, `docker pull ${image}:v1`, "not found");
});
test("release mission requires remote stable on v2 while retaining v1", () => {
  const id = "m-containers-004";
  const s = ready("", session(Result.unwrap(Engine.startMission(session().world, id))));
  const wrong = execute(s, `${cmd} tags add ${image}:v1 ${image}:stable`);
  expect(progress(wrong, id)).toBe("in_progress");
  const done = execute(restore(wrong), `${cmd} tags add ${image}:v2 ${image}:stable`);
  expect(progress(done, id)).toBe("completed");
  const removed = execute(done, `${cmd} images delete ${image}:v1 --quiet`);
  const mission = Mission.all().find((m) => m.id === id);
  if (!mission) throw new Error("Missing mission");
  expect(Mission.assertionResults(removed.world, mission).every(Boolean)).toBe(false);
});
test("cleanup mission is independently solvable; stop-only, untag-only and blanket deletion fail", () => {
  const id = "m-containers-005";
  const path = "us-central1-docker.pkg.dev/ace-dev-01/cleanup-images";
  const initial = execute(
    session(),
    "docker build -t unrelated:v1 ./hello-web",
    "docker run -d --name unrelated unrelated:v1",
  );
  const s = session(Result.unwrap(Engine.startMission(initial.world, id)));
  expect(Result.unwrap(Engine.startMission(s.world, id))).toEqual(s.world);
  const stopped = execute(s, "docker stop cleanup-local");
  expect(progress(stopped, id)).toBe("in_progress");
  const untagged = execute(
    stopped,
    "docker rm cleanup-local",
    "docker rmi cleanup-local:v1",
    `${cmd} tags delete ${path}/old:v1 --quiet`,
  );
  expect(progress(untagged, id)).toBe("in_progress");
  const wrong = execute(
    untagged,
    "gcloud artifacts repositories delete cleanup-images --location=us-central1 --quiet",
  );
  expect(progress(wrong, id)).toBe("in_progress");
  const done = execute(restore(untagged), `${cmd} images delete ${path}/old --quiet`);
  expect(progress(done, id)).toBe("completed");
  expect(done.world.containerLab.images[0]?.tags).toContain("unrelated:v1");
  expect(done.world.containerLab.containers.map((c) => c.name)).toEqual(["unrelated"]);
  expect(images(done).map((i) => i.name)).toEqual(["keep"]);
});
test("help and completion expose the lifecycle commands", () => {
  expect(Engine.completionCandidates(session().world, `${cmd} tags `)).toEqual(
    expect.arrayContaining(["add", "delete", "list"]),
  );
  expect(execute(session(), `${cmd} images delete --help`).text).toContain("--delete-tags");
});

test("deleted registry versions block GKE pulls while the simplified model recovers after repush", () => {
  const nodes = "ace-nodes@ace-dev-01.iam.gserviceaccount.com";
  const s = execute(
    ready(),
    "gcloud services enable container.googleapis.com",
    "gcloud iam service-accounts create ace-nodes",
    `gcloud iam service-accounts add-iam-policy-binding ${nodes} --member=user:owner@example.com --role=roles/iam.serviceAccountUser`,
    `gcloud artifacts repositories add-iam-policy-binding ace-images --location=us-central1 --member=serviceAccount:${nodes} --role=roles/artifactregistry.reader`,
    `gcloud container clusters create-auto lifecycle --region=us-central1 --service-account=${nodes}`,
    `kubectl create deployment hello --image=${image}:v1 --replicas=2`,
    "kubectl rollout status deployment/hello",
  );
  const removed = execute(s, `${cmd} images delete ${image}:v1 --quiet`);
  expect(execute(removed, "kubectl get pods").text).toContain("ImagePullBackOff");
  rejected(removed, "kubectl rollout status deployment/hello", "not ready");
  expect(
    execute(removed, `docker push ${image}:v1`, "kubectl rollout status deployment/hello").text,
  ).toContain("successfully rolled out");
});

test("cleanup setup rejects local name collisions without replacing existing state", () => {
  const s = execute(session(), "docker build -t cleanup-local:v1 ./hello-web-v2");
  const before = Snapshot.create(s.world, Now);
  expect(Result.isOk(Engine.startMission(s.world, "m-containers-005"))).toBe(false);
  expect(Snapshot.create(s.world, Now)).toEqual(before);
});
