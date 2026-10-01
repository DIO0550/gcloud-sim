// @vitest-environment node
import { expect, test } from "vitest";

import { run, session } from "@/engine/__tests__/setup";

const create = "gcloud compute instances create web-1 --zone=asia-northeast1-a";
const ssh = "gcloud compute ssh web-1 --zone=asia-northeast1-a";

test("RUNNING で外部 IP があり default-allow-ssh が当たっていれば、known hosts の警告を出して接続できる", () => {
  const s = run(session(), create, ssh);
  expect(s.text).toContain("Warning: Permanently added 'compute.");
  expect(s.text).toContain("対話シェルは再現しません");
  expect(s.text).not.toContain("Connection timed out");
});

test("--no-address の VM は外部 IP が無いので Connection timed out になる", () => {
  const s = run(session(), `${create} --no-address`, ssh);
  expect(s.text).toContain("port 22: Connection timed out");
  expect(s.text).toContain("外部 IP がありません");
});

test("外部 IP が無くても --internal-ip なら内部 IP で接続できる", () => {
  const s = run(session(), `${create} --no-address`, `${ssh} --internal-ip`);
  expect(s.text).toContain("Connecting to 10.146.0.2 (web-1)...");
  expect(s.text).not.toContain("Connection timed out");
});

test("--tunnel-through-iap も外部 IP を要らなくする", () => {
  const s = run(session(), `${create} --no-address`, `${ssh} --tunnel-through-iap`);
  expect(s.text).not.toContain("Connection timed out");
});

test("tcp:22 を許すファイアウォールが無ければ Connection timed out になる", () => {
  const s = run(
    session(),
    create,
    "gcloud compute firewall-rules delete default-allow-ssh --quiet",
    ssh,
  );
  expect(s.text).toContain("port 22: Connection timed out");
  expect(s.text).toContain("tcp:22 を許可するファイアウォールルール");
});

test("ターゲットタグ付きのルールは、そのタグを持つ VM にだけ当たる", () => {
  const withoutTag = run(
    session(),
    create,
    "gcloud compute firewall-rules delete default-allow-ssh --quiet",
    "gcloud compute firewall-rules create allow-ssh-tagged --allow=tcp:22 --target-tags=ssh",
    ssh,
  );
  expect(withoutTag.text).toContain("Connection timed out");
  const withTag = run(
    withoutTag,
    "gcloud compute instances add-tags web-1 --zone=asia-northeast1-a --tags=ssh",
    ssh,
  );
  expect(withTag.text).not.toContain("Connection timed out");
});

test("停止中の VM には接続できない", () => {
  const s = run(
    session(),
    create,
    "gcloud compute instances stop web-1 --zone=asia-northeast1-a",
    ssh,
  );
  expect(s.text).toContain("Connection timed out");
  expect(s.text).toContain("TERMINATED");
});

test("compute.instances.osLogin を持たない主体は E-006 になる", () => {
  const s = run(
    session(),
    create,
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:dev@example.com --role=roles/compute.viewer",
    `${ssh} --account=dev@example.com`,
  );
  expect(s.text).toContain("Required 'compute.instances.osLogin' permission");
  expect(s.text).toContain("roles/compute.osLogin");
});

test("scp は INSTANCE:PATH の側で接続の前提を確かめ、ファイル名を 1 行出す", () => {
  const s = run(
    session(),
    create,
    "gcloud compute scp ./app.tar.gz web-1:/tmp --zone=asia-northeast1-a",
  );
  expect(s.text).toContain("app.tar.gz");
  expect(s.text).toContain("100%");
  const noRemote = run(session(), create, "gcloud compute scp ./a ./b --zone=asia-northeast1-a");
  expect(noRemote.text).toContain("Specify one side as INSTANCE:PATH");
});

test("user@INSTANCE の綴りでも同じインスタンスを指す", () => {
  const s = run(session(), create, "gcloud compute ssh alice@web-1 --zone=asia-northeast1-a");
  expect(s.text).toContain("(web-1)");
});
