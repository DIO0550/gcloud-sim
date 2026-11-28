// @vitest-environment node
import { expect, test } from "vitest";
import { run, session } from "@/engine/__tests__/setup";
import { World } from "@/engine/domains/world";
import { BucketIamGrantForm } from "@/features/simulator/features/console/domains/edit-command/storage";
import { FieldErrors } from "@/features/simulator/features/console/domains/equivalent-command";
import { Option } from "@/utils/Option";

const projectId = "ace-dev-01";

test("BucketIamGrantForm はメールアドレス補完・allUsers・バリデーションを正しく扱う", () => {
  const base = BucketIamGrantForm.create("my-bucket");

  expect(BucketIamGrantForm.collectErrors({ ...base, member: "" }).member).toBeDefined();
  expect(
    BucketIamGrantForm.collectErrors({ ...base, member: "not-a-member" }).member,
  ).toBeDefined();
  expect(
    BucketIamGrantForm.collectErrors({ ...base, member: "alice@example.com", role: "invalid" })
      .role,
  ).toBeDefined();

  expect(
    FieldErrors.isEmpty(BucketIamGrantForm.collectErrors({ ...base, member: "alice@example.com" })),
  ).toBe(true);
  expect(
    FieldErrors.isEmpty(
      BucketIamGrantForm.collectErrors({
        ...base,
        member: "worker@ace-dev-01.iam.gserviceaccount.com",
      }),
    ),
  ).toBe(true);
  expect(
    FieldErrors.isEmpty(BucketIamGrantForm.collectErrors({ ...base, member: "allUsers" })),
  ).toBe(true);
  expect(
    FieldErrors.isEmpty(
      BucketIamGrantForm.collectErrors({ ...base, member: "allAuthenticatedUsers" }),
    ),
  ).toBe(true);

  expect(
    BucketIamGrantForm.toCommand(
      { bucket: "my-bucket", member: "alice@example.com", role: "roles/storage.objectViewer" },
      projectId,
    ),
  ).toBe(
    "gcloud storage buckets add-iam-policy-binding gs://my-bucket --member=user:alice@example.com --role=roles/storage.objectViewer --project=ace-dev-01",
  );
  expect(
    BucketIamGrantForm.toCommand(
      {
        bucket: "my-bucket",
        member: "worker@ace-dev-01.iam.gserviceaccount.com",
        role: "roles/storage.objectAdmin",
      },
      projectId,
    ),
  ).toBe(
    "gcloud storage buckets add-iam-policy-binding gs://my-bucket --member=serviceAccount:worker@ace-dev-01.iam.gserviceaccount.com --role=roles/storage.objectAdmin --project=ace-dev-01",
  );
  expect(
    BucketIamGrantForm.removeCommand(
      "my-bucket",
      { member: "allUsers", role: "roles/storage.objectViewer" },
      projectId,
    ),
  ).toBe(
    "gcloud storage buckets remove-iam-policy-binding gs://my-bucket --member=allUsers --role=roles/storage.objectViewer --project=ace-dev-01",
  );
});

test("Cloud Storage バケット IAM 権限の付与・削除が CLI エンジンでそのまま通る", () => {
  let s = run(
    session(),
    "gcloud storage buckets create gs://iam-bucket --location=ASIA-NORTHEAST1 --uniform-bucket-level-access",
  );

  // 1. bare email（user: 自動補完）
  s = run(
    s,
    BucketIamGrantForm.toCommand(
      { bucket: "iam-bucket", member: "alice@example.com", role: "roles/storage.objectViewer" },
      projectId,
    ),
  );
  // 2. サービスアカウント email（serviceAccount: 自動補完）
  s = run(
    s,
    BucketIamGrantForm.toCommand(
      {
        bucket: "iam-bucket",
        member: "worker@ace-dev-01.iam.gserviceaccount.com",
        role: "roles/storage.objectAdmin",
      },
      projectId,
    ),
  );
  // 3. allUsers
  s = run(
    s,
    BucketIamGrantForm.toCommand(
      { bucket: "iam-bucket", member: "allUsers", role: "roles/storage.objectViewer" },
      projectId,
    ),
  );

  const b1 = Option.unwrap(World.findBucket(s.world, "iam-bucket"));
  const viewerBinding = b1.iamPolicy.bindings.find((b) => b.role === "roles/storage.objectViewer");
  const adminBinding = b1.iamPolicy.bindings.find((b) => b.role === "roles/storage.objectAdmin");
  expect(viewerBinding?.members).toContain("user:alice@example.com");
  expect(viewerBinding?.members).toContain("allUsers");
  expect(adminBinding?.members).toContain(
    "serviceAccount:worker@ace-dev-01.iam.gserviceaccount.com",
  );

  // 4. allUsers を削除
  s = run(
    s,
    BucketIamGrantForm.removeCommand(
      "iam-bucket",
      { member: "allUsers", role: "roles/storage.objectViewer" },
      projectId,
    ),
  );
  const b2 = Option.unwrap(World.findBucket(s.world, "iam-bucket"));
  const viewerAfter = b2.iamPolicy.bindings.find((b) => b.role === "roles/storage.objectViewer");
  expect(viewerAfter?.members).toEqual(["user:alice@example.com"]);
});
