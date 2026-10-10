// @vitest-environment node
import { expect, test } from "vitest";
import { Now, run, type Session, session } from "@/engine/__tests__/setup";
import { Snapshot } from "@/engine/snapshot";

const prelude =
  "gcloud services enable orgpolicy.googleapis.com cloudidentity.googleapis.com cloudidentityscim.googleapis.com iam.googleapis.com iamcredentials.googleapis.com storage.googleapis.com compute.googleapis.com";
const policy = (scope: string, constraint: string, spec: object) =>
  `sim files write policy.json --content='${JSON.stringify({ name: `${scope}/policies/${constraint}`, spec })}'`;
const deny = (s: Session, line: string, reason: string) => {
  const next = run(s, line);
  expect(next.text, line).toContain(reason);
  expect(next.world).toEqual(s.world);
};
test("org PAP applies through hierarchy; reset restores defaults, delete restores inheritance", () => {
  const s = run(
    session(),
    prelude,
    "gcloud storage buckets create gs://org-public",
    "gcloud storage cp ./report.json gs://org-public/report.json",
    "gcloud storage buckets add-iam-policy-binding gs://org-public --member=allUsers --role=roles/storage.objectViewer",
    policy("organizations/123456789012", "storage.publicAccessPrevention", {
      rules: [{ enforce: true }],
    }),
    "gcloud org-policies set-policy policy.json",
    "sim storage access check gs://org-public/report.json --principal=anonymous",
  );
  expect(s.text).toContain("allowed: false");
  deny(
    s,
    "gcloud storage buckets add-iam-policy-binding gs://org-public --member=allAuthenticatedUsers --role=roles/storage.objectViewer",
    "Public access prevention",
  );
  const reset = run(
    s,
    "gcloud org-policies reset storage.publicAccessPrevention --project=ace-dev-01",
    "sim storage access check gs://org-public/report.json --principal=anonymous",
  );
  expect(reset.text).toContain("allowed: true");
  const deleted = run(
    reset,
    "gcloud org-policies delete storage.publicAccessPrevention --project=ace-dev-01 --quiet",
    "sim storage access check gs://org-public/report.json --principal=anonymous",
  );
  expect(deleted.text).toContain("allowed: false");
  expect(Snapshot.fromUnknown(Snapshot.create(deleted.world, Now)).ok).toBe(true);
});
test("list constraint inheritance keeps parent deny and replacement can clear it", () => {
  const s = run(
    session(),
    prelude,
    policy("organizations/123456789012", "gcp.resourceLocations", {
      rules: [{ values: { deniedValues: ["is:us-central1"] } }],
    }),
    "gcloud org-policies set-policy policy.json",
    policy("projects/ace-dev-01", "gcp.resourceLocations", {
      inheritFromParent: true,
      rules: [{ values: { allowedValues: ["is:us-central1"] } }],
    }),
    "gcloud org-policies set-policy policy.json",
  );
  deny(
    s,
    "gcloud storage buckets create gs://location-denied --location=us-central1",
    "gcp.resourceLocations",
  );
  const replaced = run(
    s,
    policy("projects/ace-dev-01", "gcp.resourceLocations", {
      inheritFromParent: false,
      rules: [{ values: { allowedValues: ["is:us-central1"] } }],
    }),
    "gcloud org-policies set-policy policy.json",
    "gcloud storage buckets create gs://location-allowed --location=us-central1",
  );
  expect(replaced.world.buckets.some((b) => b.name === "location-allowed")).toBe(true);
  deny(
    replaced,
    "gcloud storage buckets create gs://location-wrong --location=us-east1",
    "gcp.resourceLocations",
  );
});
test("org key constraint prevents an external key while token creation remains keyless", () => {
  const s = run(
    session(),
    prelude,
    "gcloud iam service-accounts create token-worker",
    policy("organizations/123456789012", "iam.disableServiceAccountKeyCreation", {
      rules: [{ enforce: true }],
    }),
    "gcloud org-policies set-policy policy.json",
  );
  deny(
    s,
    "gcloud iam service-accounts keys create token.json --iam-account=token-worker@ace-dev-01.iam.gserviceaccount.com",
    "disableServiceAccountKeyCreation",
  );
  const issued = run(
    s,
    "gcloud auth print-access-token --impersonate-service-account=token-worker@ace-dev-01.iam.gserviceaccount.com --lifetime=60s",
  );
  expect(issued.world.adminLab.credentials).toHaveLength(1);
  expect(issued.world.serviceAccountKeys).toHaveLength(0);
  expect(Snapshot.fromUnknown(Snapshot.create(issued.world, Now)).ok).toBe(true);
});
test("group membership grants bucket custom-role permissions; disabling the user revokes access", () => {
  const s = run(
    session(),
    prelude,
    "sim identity users create reader@example.com --customer=C01simulator --given-name=Read --family-name=Only",
    "gcloud identity groups create readers@example.com --customer=C01simulator",
    "gcloud identity groups memberships add --group-email=readers@example.com --member-email=reader@example.com",
    "gcloud iam roles create BucketReader --permissions=storage.objects.get --title=Reader",
    "gcloud storage buckets create gs://group-data",
    "gcloud storage cp ./data.json gs://group-data/data.json",
    "gcloud storage buckets add-iam-policy-binding gs://group-data --member=group:readers@example.com --role=projects/ace-dev-01/roles/BucketReader",
    "gcloud storage cp gs://group-data/data.json ./read.json --account=reader@example.com",
  );
  expect(s.text).not.toContain("ERROR:");
  deny(
    s,
    "gcloud storage cp ./data.json gs://group-data/new.json --account=reader@example.com",
    "storage.objects.create",
  );
  const disabled = run(
    s,
    "sim identity users update reader@example.com --customer=C01simulator --no-active",
  );
  deny(
    disabled,
    "gcloud storage cp gs://group-data/data.json ./read.json --account=reader@example.com",
    "storage.objects.get",
  );
});
test("impersonation checks token permission separately from actAs and uses SA resource permissions", () => {
  const s = run(
    session(),
    prelude,
    "gcloud iam service-accounts create acting-worker",
    "gcloud iam service-accounts add-iam-policy-binding acting-worker@ace-dev-01.iam.gserviceaccount.com --member=user:dev@example.com --role=roles/iam.serviceAccountUser",
  );
  deny(
    s,
    "gcloud auth print-access-token --impersonate-service-account=acting-worker@ace-dev-01.iam.gserviceaccount.com --account=dev@example.com",
    "getAccessToken",
  );
  const creator = run(
    s,
    "gcloud iam service-accounts add-iam-policy-binding acting-worker@ace-dev-01.iam.gserviceaccount.com --member=user:dev@example.com --role=roles/iam.serviceAccountTokenCreator",
    "gcloud auth print-access-token --impersonate-service-account=acting-worker@ace-dev-01.iam.gserviceaccount.com --account=dev@example.com",
  );
  expect(creator.world.adminLab.credentials).toHaveLength(1);
  deny(
    creator,
    "gcloud storage buckets create gs://no-sa-grant --impersonate-service-account=acting-worker@ace-dev-01.iam.gserviceaccount.com --account=dev@example.com",
    "storage.buckets.create",
  );
  deny(
    creator,
    "gcloud auth print-access-token --impersonate-service-account=acting-worker@ace-dev-01.iam.gserviceaccount.com --lifetime=12h",
    "1s..3600s",
  );
});
