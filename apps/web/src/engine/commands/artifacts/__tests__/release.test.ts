// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { Now, run, type Session, session } from "@/engine/__tests__/setup";
import {
  ContainerRelease as L,
  releaseCleanupComplete,
} from "@/engine/domains/container-lab/release";
import { Mission } from "@/engine/missions";
import {
  ContainerReleaseMissions,
  ContainerReleaseSteps as steps,
} from "@/engine/missions/container-release";
import { TreeNode } from "@/engine/resource-tree";
import { SchemaVersion, Snapshot } from "@/engine/snapshot";
import { Result } from "@/utils/Result";

const execute = (s: Session, commands: readonly string[]): Session =>
  commands.reduce((current, command) => {
    const next = run(current, command);
    expect(next.text, command).not.toContain("ERROR:");
    return next;
  }, s);
const denied = (s: Session, command: string, message: string): void => {
  const next = run(s, command);
  expect(next.text).toContain(message);
  expect(next.world).toEqual(s.world);
};
const restore = (s: Session): Session =>
  session(Result.unwrap(Snapshot.fromUnknown(Snapshot.create(s.world, Now))));
const validate = "sim container-release validate-deployment --region=us-central1";

test("fresh world, partial workflow and deletion alone do not satisfy cleanup; evidence survives every save", () => {
  const mission = ContainerReleaseMissions[0];
  expect(mission).toBeDefined();
  if (!mission) {
    return;
  }
  let current = session(Result.unwrap(Engine.startMission(session().world, mission.id)));
  expect(Mission.assertionResults(current.world, mission).every(Boolean)).toBe(false);
  for (const [index, command] of steps.entries()) {
    current = restore(execute(current, [command]));
    // Removing the dedicated node identity is the last required cleanup operation.
    expect(Mission.assertionResults(current.world, mission).every(Boolean), command).toBe(
      index >= 24,
    );
  }
  expect(current.world.containerLab.releases[0]?.stage).toBe("DEPLOYMENT_VALIDATED");
  expect(run(current, "sim container-release status").text).toContain("cleanupComplete: true");
  expect(JSON.stringify(TreeNode.fromWorld(current.world))).toContain("公開検証: ace-release");
  const restarted = Result.unwrap(Engine.startMission(current.world, mission.id));
  expect(releaseCleanupComplete(restarted)).toBe(false);
  expect(restarted.containerLab.releases).toEqual([]);
});

test("local validation checks recipe, running state and both ports; publishing first is rejected", () => {
  denied(session(), "sim container-release validate-local", "Run release-local");
  const wrongPort = execute(session(), [
    steps[1],
    "docker run -d --name release-local -p 8080:80 release-local:v1",
  ]);
  denied(wrongPort, "sim container-release validate-local", "Run release-local");
  const wrongRecipe = execute(session(), [
    "docker build -t release-local:v1 ./hello-web-v2",
    steps[2],
  ]);
  denied(wrongRecipe, "sim container-release validate-local", "Run release-local");
  const publishedFirst = execute(
    session(),
    steps.slice(0, 8).filter((s) => s !== steps[3]),
  );
  denied(publishedFirst, steps[3], "before publishing");
  const local = execute(session(), steps.slice(0, 4));
  expect(local.world.containerLab.releases[0]?.stage).toBe("LOCAL_VALIDATED");
  expect(run(local, steps[3]).world).toEqual(local.world);
});

test("deployment evidence requires prior local validation, pull IAM, Ready replicas and correct Service", () => {
  const configured = execute(
    session(),
    steps.slice(0, 16).filter((s) => ![steps[3], steps[15]].some((skip) => skip === s)),
  );
  denied(configured, validate, "Validate the local release");
  const missingReader = execute(
    session(),
    steps.slice(0, 15).filter((s) => ![steps[10], steps[13]].some((skip) => skip === s)),
  );
  denied(missingReader, validate, "not ready");
  const fixed = execute(missingReader, [steps[10]]);
  expect(execute(fixed, [validate]).world.containerLab.releases[0]?.stage).toBe(
    "DEPLOYMENT_VALIDATED",
  );
  const writer = execute(fixed, [
    `gcloud artifacts repositories add-iam-policy-binding release-images --location=us-central1 --member=serviceAccount:${L.nodeAccount} --role=roles/artifactregistry.writer`,
  ]);
  denied(writer, validate, "not ready");
  const otherDigest = execute(fixed, [
    `docker build -t ${L.image} ./hello-web-v2`,
    `docker push ${L.image}`,
  ]);
  denied(otherDigest, validate, "not ready");
  const wrongService = execute(fixed, [
    steps[16],
    "kubectl expose deployment release-web --type=LoadBalancer --port=80 --target-port=80",
  ]);
  denied(wrongService, validate, "not ready");
  const noEvidence = {
    ...fixed.world,
    containerLab: { ...fixed.world.containerLab, releases: [] },
  };
  const removed = execute(session(noEvidence), steps.slice(16));
  expect(releaseCleanupComplete(removed.world)).toBe(false);
});

test("API, caller IAM, project, location and unsupported flags leave validation state unchanged", () => {
  const ready = execute(session(), steps.slice(0, 15));
  denied(
    ready,
    "sim container-release validate-deployment --region=asia-northeast1",
    "us-central1",
  );
  denied(ready, `${validate} --project=ace-prod-01`, "container.googleapis.com");
  denied(ready, `${validate} --model=arbitrary`, "unrecognized");
  const otherAccount = execute(ready, ["gcloud auth login stranger@example.com"]);
  denied(otherAccount, validate, "container.clusters.get");
  const disabled = execute(ready, ["gcloud services disable container.googleapis.com --quiet"]);
  denied(disabled, validate, "container.googleapis.com");
  expect(Engine.completionCandidates(ready.world, "sim container-release ")).toContain(
    "validate-deployment",
  );
  expect(run(ready, `${validate} --help`).text).toContain(
    "sim container-release validate-deployment",
  );
});

test("v39 migration retains Docker state but never invents historic validation evidence", () => {
  const local = execute(session(), steps.slice(0, 4));
  const { releases: _releases, ...oldLab } = local.world.containerLab;
  const imported = Snapshot.fromUnknown({
    schemaVersion: 39,
    exportedAt: Now,
    world: { ...local.world, containerLab: oldLab },
  });
  const snapshot = Result.unwrap(imported);
  expect(snapshot.containerLab.images).toEqual(local.world.containerLab.images);
  expect(snapshot.containerLab.releases).toEqual([]);
  const invalid = {
    ...local.world,
    containerLab: {
      ...local.world.containerLab,
      releases: [
        {
          ...local.world.containerLab.releases[0],
          stage: "DEPLOYMENT_VALIDATED",
          deploymentValidatedAt: "invalid",
        },
      ],
    },
  };
  expect(
    Result.isOk(
      Snapshot.fromUnknown({ schemaVersion: SchemaVersion, exportedAt: Now, world: invalid }),
    ),
  ).toBe(false);
});

test("cleanup is scoped to lesson resources and never requires removing unrelated workloads", () => {
  const unrelated = execute(session(), [
    "docker build -t keep:v2 ./hello-web-v2",
    "docker run -d --name keep-local keep:v2",
  ]);
  const completed = execute(unrelated, steps);
  expect(releaseCleanupComplete(completed.world)).toBe(true);
  expect(completed.world.containerLab.containers.some((c) => c.name === "keep-local")).toBe(true);
  expect(completed.world.containerLab.images.some((i) => i.tags.includes("keep:v2"))).toBe(true);
  expect(completed.world.containerLab.repositories.some((r) => r.name === L.repository)).toBe(
    false,
  );
});
