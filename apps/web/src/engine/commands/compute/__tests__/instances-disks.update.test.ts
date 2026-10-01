// @vitest-environment node
import { expect, test } from "vitest";

import { run, session } from "@/engine/__tests__/setup";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";

const zone = "--zone=asia-northeast1-a";
const create = `gcloud compute instances create web-1 ${zone}`;

const instance = (s: ReturnType<typeof run>) =>
  Option.unwrap(World.findInstance(s.world, "ace-dev-01", "asia-northeast1-a", "web-1"));

test("add-tags は既存のタグに重ねずに足す", () => {
  const s = run(
    session(),
    `${create} --tags=http-server`,
    `gcloud compute instances add-tags web-1 ${zone} --tags=http-server,ssh`,
  );
  expect(s.text).toContain("Updated [");
  expect(instance(s).tags).toEqual(["http-server", "ssh"]);
});

test("add-metadata は既存のキーを上書きし、describe に出る", () => {
  const s = run(
    session(),
    `${create} --metadata=env=dev`,
    `gcloud compute instances add-metadata web-1 ${zone} --metadata=env=prod,enable-oslogin=TRUE`,
    `gcloud compute instances describe web-1 ${zone}`,
  );
  expect(instance(s).metadata).toEqual({ env: "prod", "enable-oslogin": "TRUE" });
  expect(s.text).toContain("value: TRUE");
});

test("set-machine-type は RUNNING の VM を E-014 で拒み、停止後なら替わる", () => {
  const running = run(
    session(),
    create,
    `gcloud compute instances set-machine-type web-1 ${zone} --machine-type=e2-small`,
  );
  expect(running.text).toContain("instance is in status RUNNING");
  const stopped = run(
    running,
    `gcloud compute instances stop web-1 ${zone}`,
    `gcloud compute instances set-machine-type web-1 ${zone} --machine-type=e2-small`,
  );
  expect(stopped.text).toContain("Updated [");
  expect(instance(stopped).machineType).toBe("e2-small");
});

test("set-machine-type のカタログに無い型は E-005", () => {
  const s = run(
    session(),
    create,
    `gcloud compute instances stop web-1 ${zone}`,
    `gcloud compute instances set-machine-type web-1 ${zone} --machine-type=z9-huge`,
  );
  expect(s.text).toContain("machineTypes/z9-huge' was not found");
});

test("disks create は空のディスクを作り、list に独立ディスクとして出る", () => {
  const s = run(
    session(),
    `gcloud compute disks create data-1 ${zone} --size=200GB --type=pd-ssd`,
    "gcloud compute disks list",
  );
  expect(s.text).toMatch(/data-1\s+asia-northeast1-a\s+zone\s+200\s+pd-ssd\s+READY/);
});

test("disks create の既定は 500GB の pd-balanced で、単位の無い --size も GB として受ける", () => {
  const s = run(
    session(),
    `gcloud compute disks create data-1 ${zone}`,
    `gcloud compute disks create data-2 ${zone} --size=50`,
  );
  const disks = World.disksOf(s.world, "ace-dev-01");
  expect(disks.map((d) => [d.name, d.sizeGb, d.type])).toEqual([
    ["data-1", 500, "pd-balanced"],
    ["data-2", 50, "pd-balanced"],
  ]);
});

test("attach-disk は独立ディスクをインスタンスに繋ぎ、disks list の USERS に出る", () => {
  const s = run(
    session(),
    create,
    `gcloud compute disks create data-1 ${zone} --size=100GB`,
    `gcloud compute instances attach-disk web-1 ${zone} --disk=data-1`,
    `gcloud compute disks list --format=json`,
  );
  expect(instance(s).disks.map((d) => [d.deviceName, d.boot])).toEqual([
    ["web-1", true],
    ["data-1", false],
  ]);
  expect(s.text).toContain("instances/web-1");
  const twice = run(s, `gcloud compute instances attach-disk web-1 ${zone} --disk=data-1`);
  expect(twice.text).toContain("is already attached");
});

test("attach-disk は別ゾーンのディスクやブートディスクを繋げない（E-005）", () => {
  const s = run(
    session(),
    create,
    "gcloud compute disks create data-b --zone=asia-northeast1-b --size=100GB",
    `gcloud compute instances attach-disk web-1 ${zone} --disk=data-b`,
  );
  expect(s.text).toContain("disks/data-b' was not found");
});

test("インスタンスを消すとディスクの USERS から外れる", () => {
  const s = run(
    session(),
    create,
    `gcloud compute disks create data-1 ${zone} --size=100GB`,
    `gcloud compute instances attach-disk web-1 ${zone} --disk=data-1`,
    `gcloud compute instances delete web-1 ${zone} --quiet`,
  );
  expect(World.disksOf(s.world, "ace-dev-01")[0]?.users).toEqual([]);
});

test("disks resize は大きくする方向だけを受け、縮小は E-003", () => {
  const grown = run(
    session(),
    `gcloud compute disks create data-1 ${zone} --size=100GB`,
    `gcloud compute disks resize data-1 ${zone} --size=200GB`,
  );
  expect(grown.text).toContain("Updated [");
  expect(World.disksOf(grown.world, "ace-dev-01")[0]?.sizeGb).toBe(200);
  const shrunk = run(grown, `gcloud compute disks resize data-1 ${zone} --size=50GB`);
  expect(shrunk.text).toContain("Disk size cannot be decreased (current size: 200 GB)");
});

test("disks resize はブートディスクも大きくできる", () => {
  const s = run(session(), create, `gcloud compute disks resize web-1 ${zone} --size=20GB`);
  expect(s.text).toContain("Updated [");
  expect(instance(s).disks[0]?.sizeGb).toBe(20);
});

test("disks snapshot は disks create したディスクからもブートディスクからも作れる", () => {
  const s = run(
    session(),
    create,
    `gcloud compute disks create data-1 ${zone} --size=100GB`,
    `gcloud compute disks snapshot data-1 ${zone} --snapshot-names=data-1-snap`,
    `gcloud compute disks snapshot web-1 ${zone} --snapshot-names=web-1-snap`,
    "gcloud compute snapshots list",
  );
  expect(s.text).toMatch(/data-1-snap\s+100\s+data-1\s+READY/);
  expect(s.text).toMatch(/web-1-snap\s+10\s+web-1\s+READY/);
});

test("project-info add-metadata はプロジェクト全体のメタデータに積み、describe に出る", () => {
  const s = run(
    session(),
    "gcloud compute project-info add-metadata --metadata=enable-oslogin=TRUE",
    "gcloud compute project-info add-metadata --metadata=team=web",
    "gcloud compute project-info describe",
  );
  expect(s.text).toContain("key: enable-oslogin");
  expect(s.text).toContain("key: team");
});

test("os-login ssh-keys add は OpenSSH の公開鍵だけを受け、同じ鍵は重ねない", () => {
  const key =
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGxJx8yq3VwT7Uo9fTQb4lE2mS1vN0pQ8rZ5tY7uW9xA user@host";
  const s = run(
    session(),
    `gcloud compute os-login ssh-keys add --key="${key}"`,
    `gcloud compute os-login ssh-keys add --key="${key}"`,
  );
  expect(s.text).toContain("sshPublicKeys:");
  expect(s.world.osLoginKeys).toHaveLength(1);
  const bad = run(session(), "gcloud compute os-login ssh-keys add --key=notakey");
  expect(bad.text).toContain("Expected an OpenSSH public key");
});

test("同名のディスクは別ゾーンなら作れる", () => {
  const s = run(
    session(),
    "gcloud compute disks create data-1 --zone=asia-northeast1-a --size=10GB",
    "gcloud compute disks create data-1 --zone=asia-northeast1-b --size=10GB",
  );
  expect(World.disksOf(s.world, "ace-dev-01").map((d) => d.zone)).toEqual([
    "asia-northeast1-a",
    "asia-northeast1-b",
  ]);
});

test("別ゾーンに同名のディスクがあっても、resize は指したゾーンのものだけを変える", () => {
  const s = run(
    session(),
    "gcloud compute disks create data-1 --zone=asia-northeast1-a --size=10GB",
    "gcloud compute disks create data-1 --zone=asia-northeast1-b --size=10GB",
    "gcloud compute disks resize data-1 --zone=asia-northeast1-b --size=20GB --quiet",
  );
  expect(World.disksOf(s.world, "ace-dev-01").map((d) => [d.zone, d.sizeGb])).toEqual([
    ["asia-northeast1-a", 10],
    ["asia-northeast1-b", 20],
  ]);
});
