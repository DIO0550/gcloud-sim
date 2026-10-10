// @vitest-environment node
import { expect, test } from "vitest";

import { run, session } from "@/engine/__tests__/setup";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";

const bucket = "gcloud storage buckets create gs://b-1";
const b1 = (s: ReturnType<typeof run>) => Option.unwrap(World.findBucket(s.world, "b-1"));

test("buckets update --versioning と gsutil versioning set はバージョニングを切り替える", () => {
  const on = run(session(), bucket, "gcloud storage buckets update gs://b-1 --versioning");
  expect(b1(on).versioning).toBe(true);
  const off = run(on, "gsutil versioning set off gs://b-1");
  expect(off.text).toBe("Suspending versioning for gs://b-1/...");
  expect(b1(off).versioning).toBe(false);
  expect(run(on, "gsutil versioning set maybe gs://b-1").text).toContain("Invalid choice: 'maybe'");
});

test("gsutil lifecycle set はサンプルのルールを付け、無いファイルは E-005", () => {
  const s = run(
    session(),
    bucket,
    "gsutil lifecycle set lifecycle-nearline.json gs://b-1",
    "gcloud storage buckets describe gs://b-1",
  );
  expect(b1(s).lifecycleRules).toEqual([
    { action: { type: "SetStorageClass", storageClass: "NEARLINE" }, condition: { age: 30 } },
  ]);
  expect(s.text).toContain("storageClass: NEARLINE");
  expect(run(session(), bucket, "gsutil lifecycle set rules.json gs://b-1").text).toContain(
    "No such file or directory: 'rules.json'",
  );
});

test("buckets update --lifecycle-file と --default-storage-class を同時に当てられる", () => {
  const s = run(
    session(),
    bucket,
    "gcloud storage buckets update gs://b-1 --lifecycle-file=lifecycle.json --default-storage-class=COLDLINE",
  );
  expect(b1(s).lifecycleRules).toEqual([{ action: { type: "Delete" }, condition: { age: 365 } }]);
  expect(b1(s).storageClass).toBe("COLDLINE");
});

test("objects update --storage-class はオブジェクトだけを変え、無いオブジェクトは E-005", () => {
  const s = run(
    session(),
    bucket,
    "gcloud storage cp ./a.log gs://b-1/",
    "gcloud storage objects update gs://b-1/a.log --storage-class=NEARLINE",
  );
  expect(b1(s).objects[0]?.storageClass).toEqual(Option.some("NEARLINE"));
  expect(b1(s).storageClass).toBe("STANDARD");
  expect(
    run(s, "gcloud storage objects update gs://b-1/zzz --storage-class=NEARLINE").text,
  ).toContain("matched no objects");
});

test("gsutil acl ch は UBLA のバケットで E-013、無効なバケットでは ACL を足す", () => {
  const ubla = run(
    session(),
    "gcloud storage buckets create gs://u-1 --uniform-bucket-level-access",
    "gsutil acl ch -u alice@example.com:R gs://u-1",
  );
  expect(ubla.text).toContain("uniform bucket-level access is enabled");
  const legacy = run(session(), bucket, "gsutil acl ch -u alice@example.com:R gs://b-1");
  expect(legacy.text).toBe("Updated ACL on gs://b-1/");
  expect(b1(legacy).acl).toEqual([{ entity: "alice@example.com", role: "READER" }]);
  expect(run(session(), bucket, "gsutil acl ch -u alice@example.com:X gs://b-1").text).toContain(
    'Invalid permission "X"',
  );
});

test("gsutil iam ch -d はバインディングを外し、無いものは E-005", () => {
  const s = run(
    session(),
    bucket,
    "gsutil iam ch allUsers:objectViewer gs://b-1",
    "gsutil iam ch -d allUsers:objectViewer gs://b-1",
  );
  expect(b1(s).iamPolicy.bindings).toEqual([]);
  expect(run(s, "gsutil iam ch -d allUsers:objectViewer gs://b-1").text).toContain("not found!");
});

test("rsync は gs:// 同士でオブジェクトを写し、ローカルからは 0 件、両方ローカルは E-003", () => {
  const s = run(
    session(),
    bucket,
    "gcloud storage buckets create gs://b-2",
    "gcloud storage cp ./a.log gs://b-1/logs/",
    "gcloud storage cp ./b.log gs://b-1/logs/",
    "gcloud storage rsync gs://b-1/logs/ gs://b-2/backup/",
  );
  expect(s.text).toContain("Completed files 2/2");
  expect(Option.unwrap(World.findBucket(s.world, "b-2")).objects.map((o) => o.name)).toEqual([
    "backup/a.log",
    "backup/b.log",
  ]);
  expect(run(s, "gsutil rsync -r ./dir gs://b-2").text).toContain("0 件");
  expect(run(s, "gcloud storage rsync ./a ./b").text).toContain(
    "At least one of SOURCE or DESTINATION must be a gs:// URL",
  );
});

test("sign-url は存在するオブジェクトの署名付き URL を出し、期限は --duration で決まる", () => {
  const s = run(
    session(),
    bucket,
    "gcloud storage cp ./a.log gs://b-1/",
    "gcloud services enable iamcredentials.googleapis.com",
    "gcloud iam service-accounts add-iam-policy-binding web-sa@ace-dev-01.iam.gserviceaccount.com --member=user:owner@example.com --role=roles/iam.serviceAccountTokenCreator",
    "gcloud storage sign-url gs://b-1/a.log --duration=10m --impersonate-service-account=web-sa@ace-dev-01.iam.gserviceaccount.com",
  );
  expect(s.text).toContain(
    "signed_url: https://storage.googleapis.com/b-1/a.log?X-Goog-Algorithm=GOOG4-RSA-SHA256",
  );
  expect(s.text).toContain("X-Goog-Expires=600");
  expect(s.text).toContain('expiration: "2026-09-30T14:12:31.000Z"');
  expect(run(s, "gcloud storage sign-url gs://b-1/zzz").text).toContain("matched no objects");
});
