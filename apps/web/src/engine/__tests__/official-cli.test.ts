// @vitest-environment node
import { expect, test } from "vitest";
import { Engine, Shell, type ShellState } from "@/engine";
import { ConfigurationFiles, type FileEdit } from "@/engine/domains/configuration-files";
import { World } from "@/engine/domains/world";
import { Mission } from "@/engine/missions";
import { Snapshot } from "@/engine/snapshot";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const now = "2026-10-13T00:00:00.000Z";

test("独自コマンドは登録・実行・ヘルプ・補完・公開ミッションに含まれない", () => {
  const world = Engine.initialWorld(now);
  expect(Engine.registry.specs.some((command) => command.path[0] === "sim")).toBe(false);
  expect(Engine.completionCandidates(world, "")).not.toContain("sim");
  expect(Engine.completionCandidates(world, "sim ")).toEqual([]);
  for (const line of [
    "sim --help",
    "sim ace scenarios describe interface-cloud-shell",
    "sim files load terraform-network",
    "sim kubernetes reconcile web --cpu=100m",
  ]) {
    const result = Engine.execute({ world, shell: Shell.Ready, line, now });
    expect(result.outcome.kind, line).not.toBe("succeeded");
    expect(
      result.lines.some(
        (output) => output.tone === "error" && output.text.includes("command not found"),
      ),
      line,
    ).toBe(true);
    expect(result.world, line).toEqual(world);
    expect(result.completed).toEqual([]);
  }
  for (const mission of Engine.missions()) {
    expect([mission.description, ...mission.hints].join("\n"), mission.id).not.toMatch(/\bsim\s/);
    expect(mission.assertions.some((a) => a.kind === "aceDecision" || a.kind === "aiLesson")).toBe(
      false,
    );
  }
  for (const id of ["m-ace-interface-cloud-shell", "m-ai-notebook", "m-ace-challenge-network"]) {
    expect(Engine.startMission(world, id).ok).toBe(false);
  }
});

test("ファイル編集と実際のCLIだけでTerraform総合演習を完了し、保存から復元できる", () => {
  let world = Result.unwrap(
    Engine.startMission(Engine.initialWorld(now), "m-ace-challenge-terraform"),
  );
  let shell: ShellState = Shell.Ready;
  const mission = Option.unwrap(Mission.find("m-ace-challenge-terraform"));
  const edit = (action: FileEdit) => {
    world = Result.unwrap(Engine.editFiles(world, action));
  };
  const run = (...lines: string[]) => {
    for (const line of lines) {
      const result = Engine.execute({ world, shell, line, now });
      expect(result.outcome.kind, result.lines.map((l) => l.text).join("\n")).not.toBe("failed");
      world = result.world;
      shell = result.shell;
    }
  };
  expect(Mission.assertionResults(world, mission)).toContain(false);
  run("gcloud services enable compute.googleapis.com storage.googleapis.com");
  edit({ kind: "load", name: "terraform-network", overwrite: false });
  run(
    "gcloud auth application-default login",
    "terraform init",
    "terraform validate",
    "terraform plan -out=ace-create-plan",
    "terraform apply ace-create-plan",
    "gcloud compute networks create tf-import-net --subnet-mode=custom",
  );
  edit({
    kind: "write",
    name: "import.tf",
    content:
      'resource "google_compute_network" "imported" { project = "ace-dev-01" name = "tf-import-net" auto_create_subnetworks = false }',
  });
  run(
    "terraform import google_compute_network.imported projects/ace-dev-01/global/networks/tf-import-net",
  );
  edit({ kind: "load", name: "terraform-modules", overwrite: true });
  expect(ConfigurationFiles.filesOf(world)).toHaveProperty("import.tf");
  run(
    "terraform init",
    "terraform plan -out=ace-module-plan",
    "terraform apply ace-module-plan",
    "gcloud storage buckets create gs://ace-dev-01-tf-state --location=us-central1 --uniform-bucket-level-access",
    "gcloud storage buckets update gs://ace-dev-01-tf-state --versioning",
  );
  edit({ kind: "load", name: "terraform-backend", overwrite: false });
  run(
    "terraform init -migrate-state",
    "yes",
    "terraform state list",
    "terraform state pull",
    "terraform plan",
  );
  expect(Mission.assertionResults(world, mission)).not.toContain(false);
  expect(Option.unwrap(World.findMissionProgress(world, mission.id)).status).toBe("completed");
  const restored = Result.unwrap(Snapshot.fromUnknown(Snapshot.create(world, now)));
  expect(Mission.assertionResults(restored, mission)).not.toContain(false);
  expect(ConfigurationFiles.filesOf(restored)).toEqual(ConfigurationFiles.filesOf(world));
});

test("ファイル画面のYAMLをkubectlで適用し、設定変更をPodへ反映できる", () => {
  let world = Result.unwrap(Engine.startMission(Engine.initialWorld(now), "m-gke-005"));
  const run = (...lines: string[]) => {
    for (const line of lines) {
      const result = Engine.execute({ world, shell: Shell.Ready, line, now });
      expect(result.outcome.kind, result.lines.map((l) => l.text).join("\n")).toBe("succeeded");
      world = result.world;
    }
  };
  run(
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create-auto config-gke --region=us-central1",
    "gcloud container clusters get-credentials config-gke --region=us-central1",
    "kubectl create deployment config-web --image=nginx:1 --replicas=2",
  );
  world = Result.unwrap(
    Engine.editFiles(world, { kind: "load", name: "kubernetes-config", overwrite: false }),
  );
  run(
    "kubectl apply -f app-config.yaml",
    "kubectl apply -f app-secret.yaml",
    "kubectl set env deployment/config-web --from=configmap/app-config",
    "kubectl set env deployment/config-web --from=secret/app-secret",
  );
  const content = ConfigurationFiles.filesOf(world)["app-config.yaml"] ?? "";
  world = Result.unwrap(
    Engine.editFiles(world, {
      kind: "write",
      name: "app-config.yaml",
      content: content.replace("staging", "production"),
    }),
  );
  run(
    "kubectl apply -f app-config.yaml",
    "kubectl rollout restart deployment/config-web",
    "kubectl rollout status deployment/config-web",
  );
  expect(Option.unwrap(World.findMissionProgress(world, "m-gke-005")).status).toBe("completed");
});

test("設定ファイル編集は不正なパス・上書き・上限を拒否し、リソースとstateを保つ", () => {
  const world = Engine.initialWorld(now);
  for (const name of [
    "../main.tf",
    "/main.tf",
    "__proto__/config.yaml",
    "./config.yaml",
    "config.txt",
  ]) {
    expect(Engine.editFiles(world, { kind: "write", name, content: "draft" }).ok, name).toBe(false);
  }
  expect(Engine.editFiles(world, { kind: "load", name: "__proto__", overwrite: false }).ok).toBe(
    false,
  );
  expect(
    Engine.editFiles(world, { kind: "write", name: "large.tf", content: "x".repeat(64001) }).ok,
  ).toBe(false);
  const loaded = Result.unwrap(
    Engine.editFiles(world, { kind: "load", name: "terraform-network", overwrite: false }),
  );
  expect(
    Engine.editFiles(loaded, { kind: "load", name: "terraform-network", overwrite: false }).ok,
  ).toBe(false);
  const deleted = Result.unwrap(Engine.editFiles(loaded, { kind: "delete", name: "main.tf" }));
  expect(ConfigurationFiles.filesOf(deleted)).not.toHaveProperty("main.tf");
  expect(deleted.networks).toEqual(loaded.networks);
  expect(deleted.terraform.resources).toEqual(loaded.terraform.resources);
  expect(deleted.terraform.serial).toEqual(loaded.terraform.serial);
});

test("旧Snapshotの廃止ミッションは復元せず、現在の件数にも含めない", () => {
  const world = Engine.initialWorld(now);
  const legacy = {
    ...world,
    missions: [
      ...world.missions,
      { id: "m-ace-interface-cloud-shell", status: "completed" as const, revealedHints: 2 },
    ],
  };
  expect(Mission.counts(legacy)).toEqual({ completed: 0, total: Engine.missions().length });
  const restored = Result.unwrap(Snapshot.fromUnknown(Snapshot.create(legacy, now)));
  expect(World.findMissionProgress(restored, "m-ace-interface-cloud-shell").some).toBe(false);
  expect(restored.missions).toEqual(world.missions);
});
