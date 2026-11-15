// @vitest-environment node
import { expect, test } from "vitest";
import { initialWorld, run, session } from "@/engine/__tests__/setup";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

test("gcloud iam roles delete はカスタムロールを消し、無いロールは NOT_FOUND", () => {
  const s = run(
    session(),
    "gcloud iam roles create vmReader --project=ace-dev-01 --permissions=compute.instances.get",
    "gcloud iam roles delete vmReader --project=ace-dev-01 --quiet",
  );
  expect(s.text).toContain("deleted role [vmReader] in project [ace-dev-01]");
  expect(World.customRolesOf(s.world, "ace-dev-01")).toEqual([]);
  const again = run(s, "gcloud iam roles delete vmReader --project=ace-dev-01 --quiet");
  expect(again.text).toContain("NOT_FOUND");
});

test("gcloud iam service-accounts keys delete は鍵を 1 本消す", () => {
  const email = "batch-runner@ace-dev-01.iam.gserviceaccount.com";
  const created = run(
    session(),
    "gcloud iam service-accounts create batch-runner",
    `gcloud iam service-accounts keys create key.json --iam-account=${email}`,
  );
  const key = World.keysOf(created.world, email)[0];
  expect(key).toBeDefined();
  const deleted = run(
    created,
    `gcloud iam service-accounts keys delete ${key?.keyId} --iam-account=${email} --quiet`,
  );
  expect(deleted.text).toContain(`deleted key [${key?.keyId}] for service account [${email}]`);
  expect(World.keysOf(deleted.world, email)).toEqual([]);
});

test("gsutil rb は空のバケットだけを消す", () => {
  const created = run(
    session(),
    "gsutil mb gs://ace-dev-01-rb",
    "gsutil cp report.csv gs://ace-dev-01-rb/",
  );
  const blocked = run(created, "gsutil rb gs://ace-dev-01-rb -q");
  expect(blocked.text).toContain("not empty");
  const emptied = run(
    created,
    "gsutil rm gs://ace-dev-01-rb/report.csv -q",
    "gsutil rb gs://ace-dev-01-rb -q",
  );
  expect(Option.isSome(World.findBucket(emptied.world, "ace-dev-01-rb"))).toBe(false);
});

test("学習用組織は中が空なら消せ、最初の組織や中身のある組織は消せない", () => {
  const created = World.createOrganization(initialWorld(), "learning.example");
  if (!Result.isOk(created)) throw new Error(created.error);
  const organization = created.value.additionalOrganizations[0];
  if (organization === undefined) throw new Error("organization was not created");
  expect(Result.isOk(World.deleteOrganization(created.value, created.value.organization.id))).toBe(
    false,
  );
  const withFolder = run(
    session(created.value),
    `gcloud resource-manager folders create --display-name=Sandbox --organization=${organization.id}`,
  );
  const blocked = World.deleteOrganization(withFolder.world, organization.id);
  expect(Result.isOk(blocked)).toBe(false);
  const deleted = World.deleteOrganization(created.value, organization.id);
  expect(Result.isOk(deleted) && deleted.value.additionalOrganizations).toEqual([]);
});
