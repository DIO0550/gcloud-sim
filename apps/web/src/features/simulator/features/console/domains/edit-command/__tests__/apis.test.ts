// @vitest-environment node
import { expect, test } from "vitest";

import { run, session } from "@/engine/__tests__/setup";
import { Project } from "@/engine/domains/resource-hierarchy";
import { ApiServiceCommand } from "@/features/simulator/features/console/domains/edit-command/apis";

test("ApiServiceCommand は API の有効化・無効化コマンドを組み立ててエンジンで通る", () => {
  const enableLine = ApiServiceCommand.enable("pubsub.googleapis.com", "ace-dev-01");
  expect(enableLine).toBe("gcloud services enable pubsub.googleapis.com --project=ace-dev-01");

  const enabled = run(session(), enableLine);
  const projectAfterEnable = enabled.world.projects.find((p) => p.projectId === "ace-dev-01");
  expect(projectAfterEnable).toBeDefined();
  expect(Project.hasApi(projectAfterEnable as Project, "pubsub.googleapis.com")).toBe(true);

  const disableLine = ApiServiceCommand.disable("pubsub.googleapis.com", "ace-dev-01");
  expect(disableLine).toBe(
    "gcloud services disable pubsub.googleapis.com --project=ace-dev-01 --quiet",
  );

  const disabled = run(enabled, disableLine);
  const projectAfterDisable = disabled.world.projects.find((p) => p.projectId === "ace-dev-01");
  expect(projectAfterDisable).toBeDefined();
  expect(Project.hasApi(projectAfterDisable as Project, "pubsub.googleapis.com")).toBe(false);
});
