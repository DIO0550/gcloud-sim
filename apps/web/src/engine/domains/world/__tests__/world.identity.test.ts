// @vitest-environment node
import { expect, test } from "vitest";

import { initialWorld } from "@/engine/__tests__/setup";
import type { Subnet } from "@/engine/domains/compute";
import { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const projectId = F.devProjectId;

/** 初期 World の asia-northeast1 の `default` サブネット（自動モードの default ネットワークが持つ）。 */
const tokyoDefault = (): Subnet =>
  Option.unwrap(
    World.findLocated(initialWorld(), "subnets", {
      projectId,
      location: "asia-northeast1",
      name: "default",
    }),
  );

test("同じ名前でも置き場が違えば withNamed で足せる", () => {
  const probe: Subnet = { ...tokyoDefault(), name: "probe" };
  const first = World.withNamed(initialWorld(), "subnets", probe, "probe@asia-northeast1");
  const second = Result.flatMap(first, (w) =>
    World.withNamed(w, "subnets", { ...probe, region: "us-central1" }, "probe@us-central1"),
  );
  expect(Result.isOk(second)).toBe(true);
});

test("同じ置き場・同じ名前の要素を withNamed で足すと E-008 の材料になる", () => {
  const duplicate = World.withNamed(initialWorld(), "subnets", tokyoDefault(), "default@tokyo");
  expect(duplicate).toEqual(Result.err({ resource: "default@tokyo" }));
});

test("withoutNamed は置き場まで一致したものだけを消す", () => {
  const world = World.withoutNamed(initialWorld(), "subnets", tokyoDefault());
  const remaining = (location: string) =>
    Option.isSome(World.findLocated(world, "subnets", { projectId, location, name: "default" }));
  expect(remaining("asia-northeast1")).toBe(false);
  expect(remaining("us-central1")).toBe(true);
});
