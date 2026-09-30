// @vitest-environment node
import { expect, test } from "vitest";

import { run, session } from "@/engine/__tests__/setup";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";

const zone = "asia-northeast1-a";
const create = `gcloud compute instances create web-1 --zone=${zone}`;
const instance = (world: World) =>
  Option.unwrap(World.findInstance(world, "ace-dev-01", zone, "web-1"));

test("stop で TERMINATED になり外部 IP が解放される", () => {
  const s = run(session(), create, `gcloud compute instances stop web-1 --zone=${zone}`);
  expect(s.text).toBe(
    "Stopping instance(s) web-1...done.\nUpdated [https://www.googleapis.com/compute/v1/projects/ace-dev-01/zones/asia-northeast1-a/instances/web-1].",
  );
  expect(instance(s.world).status).toBe("TERMINATED");
  expect(instance(s.world).networkInterfaces[0]?.externalIP).toEqual({
    kind: "ephemeral",
    address: Option.none,
  });
});

test("start で RUNNING に戻り外部 IP が再採番される", () => {
  const s = run(
    session(),
    create,
    `gcloud compute instances stop web-1 --zone=${zone}`,
    `gcloud compute instances start web-1 --zone=${zone}`,
  );
  expect(instance(s.world).status).toBe("RUNNING");
  const ip = instance(s.world).networkInterfaces[0]?.externalIP;
  expect(ip?.kind === "ephemeral" && Option.isSome(ip.address)).toBe(true);
});

test("--no-address で作った VM は start しても外部 IP が付かない", () => {
  const s = run(
    session(),
    `${create} --no-address`,
    `gcloud compute instances stop web-1 --zone=${zone}`,
    `gcloud compute instances start web-1 --zone=${zone}`,
  );
  expect(instance(s.world).networkInterfaces[0]?.externalIP).toEqual({ kind: "none" });
});

test("TERMINATED への stop は冪等に成功し状態を変えない", () => {
  const s = run(
    session(),
    create,
    `gcloud compute instances stop web-1 --zone=${zone}`,
    `gcloud compute instances stop web-1 --zone=${zone}`,
  );
  expect(s.text).toContain("Stopping instance(s) web-1...done.");
  expect(instance(s.world).status).toBe("TERMINATED");
  expect(s.world.operations.filter((o) => o.operationType === "stop")).toHaveLength(1);
});

test("RUNNING への start も冪等", () => {
  const s = run(session(), create, `gcloud compute instances start web-1 --zone=${zone}`);
  expect(s.text).toContain("Starting instance(s) web-1...done.");
  expect(s.world.operations.filter((o) => o.operationType === "start")).toHaveLength(0);
});

test("suspend / resume で SUSPENDED と RUNNING を行き来する", () => {
  const suspended = run(session(), create, `gcloud compute instances suspend web-1 --zone=${zone}`);
  expect(instance(suspended.world).status).toBe("SUSPENDED");
  const resumed = run(suspended, `gcloud compute instances resume web-1 --zone=${zone}`);
  expect(instance(resumed.world).status).toBe("RUNNING");
});

test("SUSPENDED への stop は E-014 になる", () => {
  const s = run(
    session(),
    create,
    `gcloud compute instances suspend web-1 --zone=${zone}`,
    `gcloud compute instances stop web-1 --zone=${zone}`,
  );
  expect(s.text).toContain("ERROR: (gcloud.compute.instances.stop) Invalid resource state");
  expect(instance(s.world).status).toBe("SUSPENDED");
});

test("delete は確認プロンプトを出し、y で消える", () => {
  const asked = run(session(), create, `gcloud compute instances delete web-1 --zone=${zone}`);
  expect(asked.text).toBe("Do you want to continue (Y/n)?");
  expect(asked.shell.kind).toBe("confirming");
  expect(World.findInstance(asked.world, "ace-dev-01", zone, "web-1")).not.toEqual(Option.none);
  const deleted = run(asked, "y");
  expect(deleted.text).toBe(
    "Deleted [https://www.googleapis.com/compute/v1/projects/ace-dev-01/zones/asia-northeast1-a/instances/web-1].",
  );
  expect(World.findInstance(deleted.world, "ace-dev-01", zone, "web-1")).toEqual(Option.none);
  expect(deleted.shell.kind).toBe("ready");
});

test("delete の確認に n と答えると Aborted by user になり消えない", () => {
  const s = run(session(), create, `gcloud compute instances delete web-1 --zone=${zone}`, "n");
  expect(s.text).toBe("ERROR: (gcloud) Aborted by user.");
  expect(World.findInstance(s.world, "ace-dev-01", zone, "web-1")).not.toEqual(Option.none);
});

test("delete の確認に Enter だけで答えると続行する", () => {
  const s = run(session(), create, `gcloud compute instances delete web-1 --zone=${zone}`, "");
  expect(World.findInstance(s.world, "ace-dev-01", zone, "web-1")).toEqual(Option.none);
});

test("delete の確認に y/n 以外を答えると聞き直す", () => {
  const s = run(session(), create, `gcloud compute instances delete web-1 --zone=${zone}`, "maybe");
  expect(s.text).toContain("Please enter 'y' or 'n'");
  expect(s.shell.kind).toBe("confirming");
});

test("--quiet なら確認せずに消える", () => {
  const s = run(session(), create, `gcloud compute instances delete web-1 --zone=${zone} --quiet`);
  expect(s.text).toContain("Deleted [");
  expect(s.shell.kind).toBe("ready");
});

test("stop に必要な権限が無い主体は E-006 になり、含むロールのヒントが出る", () => {
  const s = run(
    session(),
    create,
    "gcloud config set account dev@example.com",
    `gcloud compute instances stop web-1 --zone=${zone}`,
  );
  expect(s.text).toContain(
    "Required 'compute.instances.stop' permission for 'projects/ace-dev-01'",
  );
  expect(s.text).toContain(
    "gcloud-sim: hint: この権限を含むロール: roles/compute.instanceAdmin.v1",
  );
  expect(instance(s.world).status).toBe("RUNNING");
});

test("無いインスタンスへの stop は E-005 になる", () => {
  const s = run(session(), `gcloud compute instances stop ghost --zone=${zone}`);
  expect(s.text).toContain(
    "The resource 'projects/ace-dev-01/zones/asia-northeast1-a/instances/ghost' was not found",
  );
});

test("snapshots create はブートディスクから作り list に出る", () => {
  const s = run(
    session(),
    create,
    `gcloud compute snapshots create web-1-snap --source-disk=web-1 --source-disk-zone=${zone}`,
    "gcloud compute snapshots list",
  );
  expect(s.text).toMatch(/web-1-snap\s+10\s+web-1\s+READY/);
});

test("オペレーションは 500 件で古いものから捨てられる", () => {
  const start = session();
  const many = Array.from({ length: 260 }, (_, i) => [
    `gcloud compute instances create vm-${i} --zone=${zone}`,
    `gcloud compute instances stop vm-${i} --zone=${zone}`,
  ]).flat();
  const s = run(start, ...many);
  expect(s.world.operations).toHaveLength(500);
  expect(s.world.operations[0]?.targetName).toBe("vm-10");
});
