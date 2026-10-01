// @vitest-environment node
import { expect, test } from "vitest";

import { Engine } from "@/engine";
import { RoleCatalog } from "@/engine/domains/role-catalog";

/**
 * カタログに無い権限は許可に倒す（DJ-006）ので、コマンドが要求する権限の綴りを間違えると
 * 誰でも通ってしまう。要求している権限がすべてカタログに載っていることを固定する。
 */
test("コマンドが要求する権限はすべてロールカタログに載っている", () => {
  const unknown = Engine.registry.specs.flatMap((spec) => {
    const requires = spec.kind === "project" || spec.kind === "target";
    if (!requires) return [];
    return spec.requiredPermissions
      .filter((permission) => !RoleCatalog.isKnownPermission(permission))
      .map((permission) => `${spec.path.join(" ")}: ${permission}`);
  });
  expect(unknown).toEqual([]);
});

test("ミッションが確かめる有効権限もカタログに載っている（載っていないと常に真になる）", () => {
  const unknown = Engine.missions().flatMap((mission) =>
    mission.assertions.flatMap((assertion) =>
      assertion.kind === "effectivePermission" &&
      !RoleCatalog.isKnownPermission(assertion.permission)
        ? [`${mission.id}: ${assertion.permission}`]
        : [],
    ),
  );
  expect(unknown).toEqual([]);
});
