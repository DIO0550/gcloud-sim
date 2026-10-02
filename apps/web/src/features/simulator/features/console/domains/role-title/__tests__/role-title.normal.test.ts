// @vitest-environment node
import { expect, test } from "vitest";

import { session } from "@/engine/__tests__/setup";
import { roleTitleJa } from "@/features/simulator/features/console/domains/role-title";

test("Console の日本語の名前を持つロールはその名前、持たないものはカタログの title になる", () => {
  const { world } = session();
  expect(roleTitleJa(world, "roles/compute.instanceAdmin.v1")).toBe(
    "Compute インスタンス管理者（v1）",
  );
  expect(roleTitleJa(world, "roles/pubsub.viewer")).toBe("Pub/Sub Viewer");
  expect(roleTitleJa(world, "roles/unknown.role")).toBe("roles/unknown.role");
});
