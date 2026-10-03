// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { initialWorld, Now, run, type Session, session } from "@/engine/__tests__/setup";
import { ContainerLab } from "@/engine/domains/container-lab";
import { World } from "@/engine/domains/world";
import { Mission } from "@/engine/missions";
import { containerSatisfied } from "@/engine/missions/containers";
import { TreeNode, TreeSelection } from "@/engine/resource-tree";
import { Snapshot } from "@/engine/snapshot";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const host = "us-central1-docker.pkg.dev";
const url = `${host}/ace-dev-01/ace-images`;
const image = `${url}/hello:v1`;
const id = "projects/ace-dev-01/locations/us-central1/repositories/ace-images";
const execute = (s: Session, ...commands: string[]): Session =>
  commands.reduce((current, command) => {
    const next = run(current, command);
    expect(next.text, command).not.toContain("ERROR:");
    return next;
  }, s);
const rejected = (s: Session, command: string, message: string): void => {
  const next = run(s, command);
  expect(next.text, command).toContain(message);
  expect(next.world).toEqual(s.world);
};
const built = (s = session()): Session => execute(s, "docker build -t hello:v1 ./hello-web");
const ready = (s = built(), flags = ""): Session =>
  execute(
    s,
    "gcloud services enable artifactregistry.googleapis.com",
    `gcloud artifacts repositories create ace-images --location=us-central1 --repository-format=docker ${flags}`,
    `gcloud auth configure-docker ${host}`,
    `docker tag hello:v1 ${image}`,
  );
const published = (s = ready()): Session => execute(s, `docker push ${image}`);
const restore = (s: Session): Session =>
  session(
    Result.unwrap(Snapshot.fromUnknown(JSON.parse(JSON.stringify(Snapshot.create(s.world, Now))))),
  );
const registry = (s: Session) => s.world.containerLab.registryImages;

test("local build/run/logs/inspect/request and cleanup never create registry resources", () => {
  const s = built();
  expect(s.world.containerLab.images).toHaveLength(1);
  expect(registry(s)).toEqual([]);
  expect(execute(s, "docker images").text).toContain("hello:v1");
  const running = execute(s, "docker run -d --name hello-local -p 8080:8080 hello:v1");
  expect(execute(running, "docker ps").text).toContain("hello-local");
  expect(execute(running, "docker logs hello-local").text).toContain("v1");
  expect(execute(running, "docker inspect hello-local").text).toContain(
    ContainerLab.digest("hello-web"),
  );
  expect(execute(running, "sim docker request hello-local").text).toContain("200 OK");
  rejected(running, "docker rm hello-local", "running");
  rejected(running, "docker rmi hello:v1", "referenced by a container");
  rejected(
    running,
    "docker run -d --name conflict -p 8080:8080 hello:v1",
    "Conflicting published ports",
  );
  rejected(running, "docker run -d --name hello-local hello:v1", "already exists");
  const stopped = execute(restore(running), "docker stop hello-local");
  expect(execute(stopped, "docker ps").text).not.toContain("hello-local");
  expect(execute(stopped, "docker ps -a").text).toContain("EXITED");
  rejected(stopped, "sim docker request hello-local", "Connection failed");
  const freed = execute(
    stopped,
    "docker run -d --name replacement -p 8080:8080 hello:v1",
    "docker rm -f replacement",
    "docker rm hello-local",
    "docker rmi hello:v1",
  );
  expect(freed.world.containerLab.images).toEqual([]);
  expect(freed.world.containerLab.containers).toEqual([]);
  expect(registry(freed)).toEqual([]);
});

test("tags move independently while containers retain their original image and logs", () => {
  const s = execute(
    built(),
    "docker run -d --name original -p 8080:8080 hello:v1",
    "docker build -t hello:v1 ./hello-web-v2",
    "docker run -d --name updated -p 8081:8080 hello:v1",
  );
  expect(execute(s, "sim docker request original").text).toContain("v1");
  expect(execute(s, "sim docker request updated").text).toContain("v2");
  expect(s.world.containerLab.images).toHaveLength(2);
  expect(ContainerLab.local(s.world.containerLab, "hello:v1").recipe).toBe("hello-web-v2");
  expect(restore(s).world).toEqual(s.world);
});

test("push and pull preserve identity, latest defaults, and local removals leave remote images", () => {
  const s = published();
  expect(registry(s)).toHaveLength(1);
  expect(registry(s)[0]?.digest).toBe(ContainerLab.local(s.world.containerLab, image).id);
  expect(execute(s, `docker push ${image}`).world).toEqual(s.world);
  const removed = execute(s, `docker rmi ${image}`, "docker rmi hello:v1");
  expect(removed.world.containerLab.images).toEqual([]);
  const pulled = execute(
    restore(removed),
    `docker pull ${image}`,
    `docker run -d --name pulled -p 8080:8080 ${image}`,
  );
  expect(execute(pulled, "sim docker request pulled").text).toContain("v1");
  const latest = execute(pulled, `docker tag ${image} ${url}/hello`, `docker push ${url}/hello`);
  expect(registry(latest)[0]?.tags).toEqual(["v1", "latest"]);
  expect(
    execute(latest, `gcloud artifacts docker images list ${url} --include-tags --format=json`).text,
  ).toContain('"v1"');
  const byDigest = execute(latest, `docker pull ${url}/hello@${ContainerLab.digest("hello-web")}`);
  expect(byDigest.world.containerLab.images).toHaveLength(1);
  expect(
    execute(byDigest, `gcloud artifacts docker images describe ${image} --format='value(digest)'`)
      .text,
  ).toBe(ContainerLab.digest("hello-web"));
});

test("missing local images auto-pull, but a later invalid run leaves no cache or container", () => {
  const s = execute(published(), `docker rmi ${image}`, "docker rmi hello:v1");
  rejected(s, `docker run -d --name invalid! ${image}`, "Invalid container name");
  expect(
    execute(s, `docker run -d --name automatic ${image}`).world.containerLab.containers,
  ).toHaveLength(1);
});

test("mutable tags retain old digests and immutable tags reject replacement atomically", () => {
  const s = published();
  const updated = execute(s, `docker build -t ${image} ./hello-web-v2`, `docker push ${image}`);
  expect(registry(updated)).toHaveLength(2);
  expect(registry(updated).find((i) => i.recipe === "hello-web")?.tags).toEqual([]);
  expect(registry(updated).find((i) => i.recipe === "hello-web-v2")?.tags).toEqual(["v1"]);
  execute(updated, `docker pull ${url}/hello@${ContainerLab.digest("hello-web")}`);
  const immutable = execute(
    published(ready(built(), "--immutable-tags")),
    `docker build -t ${image} ./hello-web-v2`,
  );
  rejected(immutable, `docker push ${image}`, "immutable");
  expect(registry(immutable)).toHaveLength(1);
});

test("repository API, existence, auth host, current account and exact location are enforced", () => {
  rejected(
    built(),
    "gcloud artifacts repositories create ace-images --location=us-central1 --repository-format=docker",
    "disabled",
  );
  const noAuth = execute(built(), `docker tag hello:v1 ${image}`);
  rejected(noAuth, `docker push ${image}`, "authentication is not configured");
  const noRepo = execute(noAuth, `gcloud auth configure-docker ${host}`);
  rejected(noRepo, `docker push ${image}`, "Repository not found");
  const s = ready();
  rejected(s, `docker pull ${image}`, "Image not found");
  rejected(execute(s, "gcloud config unset account"), `docker push ${image}`, "No active account");
  rejected(
    s,
    "gcloud artifacts repositories describe ace-images --location=asia-northeast1",
    "Repository not found",
  );
  rejected(s, `gcloud artifacts repositories describe ${id} --project=ace-prod-01`, "do not match");
  rejected(
    s,
    "gcloud artifacts repositories create ace-images --location=us-central1 --repository-format=docker",
    "already exists",
  );
  const other = execute(
    s,
    "gcloud artifacts repositories create ace-images --location=asia-northeast1 --repository-format=docker",
  );
  expect(other.world.containerLab.repositories).toHaveLength(2);
});

test("repository-scoped reader can pull, cannot push, and writer does not grant access elsewhere", () => {
  const s = execute(
    published(),
    "gcloud artifacts repositories create private-images --location=us-central1 --repository-format=docker",
    "gcloud auth login student@example.com",
    "gcloud auth login owner@example.com",
    `gcloud artifacts repositories add-iam-policy-binding ${id} --member=user:student@example.com --role=roles/artifactregistry.reader`,
  );
  const student = execute(
    s,
    "gcloud auth login student@example.com",
    "gcloud auth application-default login",
    "gcloud auth login owner@example.com",
  );
  execute(student, `docker push ${image}`); // Docker follows gcloud, not ADC.
  const reader = execute(student, "gcloud auth login student@example.com", `docker pull ${image}`);
  rejected(reader, `docker push ${image}`, "uploadArtifacts");
  rejected(
    reader,
    "gcloud artifacts repositories describe private-images --location=us-central1",
    "Permission denied",
  );
  rejected(
    reader,
    `gcloud artifacts repositories add-iam-policy-binding ${id} --member=user:student@example.com --role=roles/artifactregistry.admin`,
    "setIamPolicy",
  );
  const writer = execute(
    reader,
    `gcloud artifacts repositories add-iam-policy-binding ${id} --member=user:student@example.com --role=roles/artifactregistry.writer --account=owner@example.com`,
    `docker push ${image}`,
  );
  expect(World.currentPrincipal(writer.world)).toEqual(Option.some("student@example.com"));
  rejected(
    writer,
    "gcloud artifacts repositories create student-images --location=us-central1 --repository-format=docker",
    "repositories.create",
  );
  const revoked = execute(
    writer,
    `gcloud artifacts repositories remove-iam-policy-binding ${id} --member=user:student@example.com --role=roles/artifactregistry.writer --account=owner@example.com`,
  );
  rejected(revoked, `docker push ${image}`, "uploadArtifacts");
  expect(execute(revoked, `gcloud artifacts repositories get-iam-policy ${id}`).text).toContain(
    "reader",
  );
});

test("repository IAM inherits from project without copying bindings", () => {
  const s = execute(
    published(),
    "gcloud auth login student@example.com",
    "gcloud auth login owner@example.com",
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:student@example.com --role=roles/artifactregistry.writer",
    "gcloud auth login student@example.com",
    `docker push ${image}`,
  );
  expect(s.world.containerLab.repositories[0]?.iamPolicy.bindings).toEqual([]);
  expect(execute(s, `gcloud artifacts repositories describe ${id}`).text).toContain("DOCKER");
});

test("repository deletion asks for approval and leaves cached local containers usable", () => {
  const s = execute(published(), `docker run -d --name cached -p 8080:8080 ${image}`);
  const pending = execute(s, `gcloud artifacts repositories delete ${id}`);
  expect(pending.world).toEqual(s.world);
  expect(run(pending, "n").world).toEqual(s.world);
  const removed = execute(pending, "y");
  expect(registry(removed)).toEqual([]);
  expect(removed.world.containerLab.repositories).toEqual([]);
  expect(removed.world.containerLab.images).toEqual(s.world.containerLab.images);
  expect(execute(removed, "sim docker request cached").text).toContain("200 OK");
  rejected(removed, `docker pull ${image}`, "Repository not found");
});

test.each([
  "docker run -d -p 8080:8080 --publish=8081:8080 hello:v1",
  "docker build -t hello:v1 --tag=hello:v2 ./hello-web",
  "docker build -t hello:v1 /tmp/untrusted",
  "docker build -t hello:v1 --file=other.Dockerfile .",
  "docker build -t hello:v1 --build-arg=SECRET .",
  "docker run hello:v1",
  "docker run -d -p 0:8080 hello:v1",
  "docker run -d -p 70000:8080 hello:v1",
  "docker run -d -p 127.0.0.1:8080:8080 hello:v1",
  "docker run -d --privileged hello:v1",
  "docker run -d -v /tmp:/host hello:v1",
  "docker run -d hello:v1 sh",
  "docker push hello:v1 --project=ace-dev-01",
  "docker tag hello:v1 BadName:v1",
  "docker pull evil.example/hello:v1",
  "gcloud auth configure-docker https://us-central1-docker.pkg.dev",
  "gcloud artifacts repositories create unsupported --location=moon --repository-format=docker",
  "gcloud artifacts repositories create unsupported --location=us-central1 --repository-format=npm",
])("unsupported or unsafe input fails without mutation: %s", (command) =>
  rejected(built(), command, "ERROR:"),
);

test("wrong published container port does not pretend the application is reachable", () => {
  const s = execute(built(), "docker run -d --name wrong -p 8080:80 hello:v1");
  rejected(s, "sim docker request wrong", "Connection failed");
  expect(
    containerSatisfied(s.world, { kind: "localContainerReady", name: "wrong", hostPort: 8080 }),
  ).toBe(false);
});

test("snapshot v7 round-trips images, containers, IAM and tags; v6 retains Terraform backend", () => {
  const s = execute(published(), `docker run -d --name saved -p 8080:8080 ${image}`);
  expect(restore(s).world).toEqual(s.world);
  expect(Result.isOk(World.validate(s.world))).toBe(true);
  const terraform = execute(
    session(),
    "sim files load terraform-network",
    "gcloud auth application-default login",
    "terraform init",
    "terraform apply -auto-approve",
    "gcloud storage buckets create gs://ace-dev-01-tf-state",
    "sim files load terraform-backend",
    "terraform init -force-copy",
  );
  const { containerLab: _lab, ...old } = terraform.world;
  const restored = Result.unwrap(
    Snapshot.fromUnknown({
      ...Snapshot.create(terraform.world, Now),
      schemaVersion: 6,
      world: old,
    }),
  );
  expect(restored.terraform).toEqual(terraform.world.terraform);
  expect(restored.containerLab).toEqual(ContainerLab.empty());
});

test("invalid saved image references, duplicate tags, missing projects and conflicting ports are rejected", () => {
  const s = execute(published(), "docker run -d --name saved -p 8080:8080 hello:v1");
  const lab = s.world.containerLab;
  const container = lab.containers[0];
  if (!container) throw new Error("Missing fixture");
  for (const invalid of [
    { ...lab, images: lab.images.map((i) => ({ ...i, id: "invalid" })) },
    { ...lab, images: [...lab.images, ...lab.images] },
    { ...lab, containers: [{ ...container, imageId: ContainerLab.digest("hello-web-v2") }] },
    {
      ...lab,
      containers: [container, { ...container, id: "sim-container-99999", name: "conflict" }],
    },
    { ...lab, registryImages: registry(s).map((i) => ({ ...i, repositoryId: "missing" })) },
    {
      ...lab,
      repositories: lab.repositories.map((r) => ({
        ...r,
        projectId: "nonexistent",
        id: ContainerLab.repositoryId("nonexistent", r.location, r.name),
      })),
      registryImages: [],
    },
    { ...lab, authHosts: ["evil.example"] },
  ])
    expect(
      Result.isOk(
        Snapshot.fromUnknown({
          ...Snapshot.create(s.world, Now),
          world: { ...s.world, containerLab: invalid },
        }),
      ),
    ).toBe(false);
});

test.each(["m-containers-001", "m-containers-002", "m-containers-003"])(
  "%s is independently solvable and partial/wrong state does not clear",
  (missionId) => {
    const mission = Mission.all().find((m) => m.id === missionId);
    if (!mission) throw new Error("Missing mission");
    const start = session(Result.unwrap(Mission.start(initialWorld(), mission)));
    const first = built(start);
    expect(first.world.missions.find((m) => m.id === missionId)?.status).toBe("in_progress");
    if (missionId === "m-containers-001") {
      const wrong = execute(first, "docker run -d --name hello-local -p 8080:80 hello:v1");
      expect(wrong.world.missions.find((m) => m.id === missionId)?.status).toBe("in_progress");
      const done = execute(
        wrong,
        "docker rm -f hello-local",
        "docker run -d --name hello-local -p 8080:8080 hello:v1",
      );
      expect(done.world.missions.find((m) => m.id === missionId)?.status).toBe("completed");
      return;
    }
    const tagged = ready(first);
    expect(tagged.world.missions.find((m) => m.id === missionId)?.status).toBe("in_progress");
    const pushed = published(tagged);
    if (missionId === "m-containers-002") {
      expect(pushed.world.missions.find((m) => m.id === missionId)?.status).toBe("completed");
      return;
    }
    const broad = execute(
      pushed,
      `gcloud artifacts repositories add-iam-policy-binding ${id} --member=user:developer@example.com --role=roles/artifactregistry.writer`,
      `gcloud artifacts repositories add-iam-policy-binding ${id} --member=user:developer@example.com --role=roles/artifactregistry.reader`,
    );
    expect(broad.world.missions.find((m) => m.id === missionId)?.status).toBe("in_progress");
    const least = execute(
      restore(broad),
      `gcloud artifacts repositories remove-iam-policy-binding ${id} --member=user:developer@example.com --role=roles/artifactregistry.writer`,
    );
    expect(least.world.missions.find((m) => m.id === missionId)?.status).toBe("completed");
  },
);

test("resource tree separates local Docker and cloud repositories; help and completion expose supported commands", () => {
  const s = execute(published(), "docker run -d --name visible hello:v1");
  const flat = (nodes: readonly TreeNode[]): readonly TreeNode[] =>
    nodes.flatMap((n) => [n, ...flat(n.children)]);
  const nodes = flat(TreeNode.fromWorld(s.world));
  expect(nodes.some((n) => n.label.kind === "group" && n.label.group === "local-docker")).toBe(
    true,
  );
  expect(nodes.some((n) => n.label.kind === "group" && n.label.group === "artifacts")).toBe(true);
  const selections = nodes.flatMap((n) => (Option.isSome(n.selection) ? [n.selection.value] : []));
  expect(selections.filter((s) => s.kind === "container-lab")).toHaveLength(3);
  for (const selection of selections.filter((s) => s.kind === "container-lab")) {
    const command = TreeSelection.describeCommand(selection);
    if (Option.isSome(command)) execute(s, command.value);
  }
  expect(Engine.completionCandidates(s.world, "docker st")).toContain("stop");
  expect(Engine.completionCandidates(s.world, "docker logs v")).toContain("visible");
  expect(execute(s, "docker run --help").text).toContain("--publish");
  expect(execute(s, "docker run --help").text).not.toContain("--project");
});
