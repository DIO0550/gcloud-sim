// @vitest-environment node
import { expect, test } from "vitest";

import { run, session } from "@/engine/__tests__/setup";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";

test("buckets create は Creating を出し describe で location と class が見える", () => {
  const s = run(
    session(),
    "gcloud storage buckets create gs://ace-dev-01-logs --location=asia-northeast1 --default-storage-class=NEARLINE",
    "gcloud storage buckets describe gs://ace-dev-01-logs",
  );
  expect(s.text).toContain("name: ace-dev-01-logs");
  expect(s.text).toContain("location: ASIA-NORTHEAST1");
  expect(s.text).toContain("storageClass: NEARLINE");
});

test("バケット名は全プロジェクト横断でユニーク（別プロジェクトでも E-008）", () => {
  const s = run(
    session(),
    "gcloud storage buckets create gs://shared-name",
    "gcloud services enable storage.googleapis.com --project=ace-prod-01",
    "gcloud storage buckets create gs://shared-name --project=ace-prod-01",
  );
  expect(s.text).toContain("The resource 'buckets/shared-name' already exists");
});

test("goog で始まる名前は弾く", () => {
  const s = run(session(), "gcloud storage buckets create gs://goog-mine");
  expect(s.text).toContain('Bucket names cannot begin with the "goog" prefix');
});

test("3 文字未満・大文字入りの名前は弾く", () => {
  expect(run(session(), "gcloud storage buckets create gs://ab").text).toContain(
    "Invalid bucket name: 'ab'",
  );
  expect(run(session(), "gcloud storage buckets create gs://MyBucket").text).toContain(
    "Invalid bucket name: 'MyBucket'",
  );
});

test("知らないロケーションは E-003 になる", () => {
  const s = run(session(), "gcloud storage buckets create gs://b-1 --location=moon");
  expect(s.text).toContain("The specified location constraint is not valid: moon");
});

test("gs:// で始まらない URL は E-003 になる", () => {
  const s = run(session(), "gcloud storage buckets create my-bucket");
  expect(s.text).toContain("Invalid Cloud Storage URL: my-bucket.");
});

test("cp でオブジェクトを置き、ls で見え、rm で消える", () => {
  const s = run(
    session(),
    "gcloud storage buckets create gs://b-1",
    "gcloud storage cp ./report.csv gs://b-1/reports/",
    "gcloud storage ls gs://b-1",
  );
  expect(s.text).toBe("gs://b-1/reports/report.csv");
  const removed = run(
    s,
    "gcloud storage rm gs://b-1/reports/report.csv --quiet",
    "gcloud storage ls gs://b-1",
  );
  expect(removed.text).toBe("");
});

test("ls を引数なしで打つとバケットが並ぶ", () => {
  const s = run(
    session(),
    "gcloud storage buckets create gs://b-1",
    "gcloud storage buckets create gs://b-2",
    "gcloud storage ls",
  );
  expect(s.text).toBe("gs://b-1/\ngs://b-2/");
});

test("オブジェクトの残るバケットは delete できない", () => {
  const s = run(
    session(),
    "gcloud storage buckets create gs://b-1",
    "gcloud storage cp ./a.txt gs://b-1/",
    "gcloud storage buckets delete gs://b-1 --quiet",
  );
  expect(s.text).toContain("gs://b-1 bucket is not empty.");
  expect(Option.isSome(World.findBucket(s.world, "b-1"))).toBe(true);
});

test("空のバケットは delete で消える", () => {
  const s = run(
    session(),
    "gcloud storage buckets create gs://b-1",
    "gcloud storage buckets delete gs://b-1 --quiet",
  );
  expect(s.text).toBe("Removing gs://b-1/...");
  expect(World.findBucket(s.world, "b-1")).toEqual(Option.none);
});

test("バケットへの add-iam-policy-binding は権限がバケット単位で効く", () => {
  const s = run(
    session(),
    "gcloud storage buckets create gs://b-1",
    "gcloud storage buckets add-iam-policy-binding gs://b-1 --member=allUsers --role=roles/storage.objectViewer",
    "gcloud storage buckets get-iam-policy gs://b-1",
  );
  expect(s.text).toContain("  - allUsers");
  expect(s.text).toContain("  role: roles/storage.objectViewer");
});

test("gsutil mb -l は gcloud storage buckets create と同じ結果になる", () => {
  const gsutil = run(session(), "gsutil mb -l asia-northeast1 -c NEARLINE gs://b-1");
  const gcloud = run(
    session(),
    "gcloud storage buckets create gs://b-1 --location=asia-northeast1 --default-storage-class=NEARLINE",
  );
  expect(Option.unwrap(World.findBucket(gsutil.world, "b-1"))).toEqual(
    Option.unwrap(World.findBucket(gcloud.world, "b-1")),
  );
});

test("gsutil mb -b は on で均一なバケットレベルのアクセスになり、off ならならず、他は E-003", () => {
  const on = run(session(), "gsutil mb -b on gs://b-on");
  expect(Option.unwrap(World.findBucket(on.world, "b-on")).uniformBucketLevelAccess).toBe(true);
  const off = run(session(), "gsutil mb -b off gs://b-off");
  expect(Option.unwrap(World.findBucket(off.world, "b-off")).uniformBucketLevelAccess).toBe(false);
  const bad = run(session(), "gsutil mb -b maybe gs://b-bad");
  expect(bad.text).toContain("argument -b: Invalid choice: 'maybe'.");
  expect(World.findBucket(bad.world, "b-bad")).toEqual(Option.none);
});

test("gsutil ls / cp / rm も同じ World を操作する", () => {
  const s = run(
    session(),
    "gsutil mb gs://b-1",
    "gsutil cp ./a.txt gs://b-1/",
    "gsutil ls gs://b-1",
  );
  expect(s.text).toBe("gs://b-1/a.txt");
  const removed = run(s, "gsutil rm gs://b-1/a.txt -q", "gcloud storage ls gs://b-1");
  expect(removed.text).toBe("");
});

test("gsutil iam ch は未実装として案内する", () => {
  const s = run(session(), "gsutil iam ch allUsers:objectViewer gs://b-1");
  expect(s.text).toContain("gcloud-sim: command not implemented yet: gsutil iam ch");
});
