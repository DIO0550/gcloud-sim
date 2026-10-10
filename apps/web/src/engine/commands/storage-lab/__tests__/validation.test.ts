// @vitest-environment node
import { expect, test } from "vitest";
import { initialWorld, Now, run, type Session, session } from "@/engine/__tests__/setup";
import { DataPrelude, DataSolutions } from "@/engine/missions/data-processing";
import { StoragePrelude, StorageSolutions, storageSatisfied } from "@/engine/missions/storage-lab";
import { Snapshot } from "@/engine/snapshot";

const lesson = (name: keyof typeof StorageSolutions) =>
  run(session(), ...StoragePrelude, ...StorageSolutions[name]);
const reject = (s: Session, line: string, reason: string) => {
  const next = run(s, line);
  expect(next.text, line).toContain(reason);
  expect(next.world).toEqual(s.world);
};

test("retention prevents replacement and delete; lock cannot be shortened, but longer is allowed", () => {
  const s = lesson("retention");
  reject(
    s,
    "gcloud storage cp ./changed.json gs://storage-retention/report.json",
    "retention prevents replacement",
  );
  reject(
    s,
    "gcloud storage rm gs://storage-retention/report.json --quiet",
    "retention prevents deletion",
  );
  reject(
    s,
    "gcloud storage buckets update gs://storage-retention --clear-retention-period",
    "cannot be shortened",
  );
  const longer = run(
    s,
    "gcloud storage buckets update gs://storage-retention --retention-period=2h",
  );
  expect(longer.world.storageLab.protections[0]?.retention).toBe(7200);
  const expired = run(
    longer,
    "sim storage time advance --seconds=7200",
    "gcloud storage rm gs://storage-retention/report.json --quiet",
  );
  expect(expired.world.buckets[0]?.objects).toHaveLength(0);
});

test("invalid durations and mutually exclusive retention flags do not change a bucket", () => {
  const s = lesson("ubla");
  for (const flags of [
    "--soft-delete-duration=6d",
    "--soft-delete-duration=90d",
    "--retention-period=100000d",
    "--retention-period=1h --clear-retention-period",
    "--lock-retention-period",
  ]) {
    const next = run(s, `gcloud storage buckets update gs://storage-ubla ${flags}`);
    expect(next.text).toContain("ERROR:");
    expect(next.world).toEqual(s.world);
  }
});

test("generation preconditions protect concurrent replacement and restoration makes a new generation", () => {
  const s = lesson("versioning");
  reject(
    s,
    "gcloud storage cp ./report.json gs://storage-versioning/report.json --if-generation-match=1",
    "precondition failed",
  );
  reject(
    s,
    "gcloud storage cp ./report.json gs://storage-versioning/report.json --if-generation-match=0",
    "precondition failed",
  );
  expect(s.world.storageLab.versions.map((v) => [v.generation, v.state])).toEqual([
    [1, "NONCURRENT"],
    [2, "NONCURRENT"],
    [3, "LIVE"],
  ]);
  reject(s, "gcloud storage restore gs://storage-versioning/report.json#1", "unavailable");
});

test("soft-deleted generations disappear at expiry, and policy changes do not rewrite their expiry", () => {
  const s = run(session(), ...StoragePrelude, ...StorageSolutions.softDelete.slice(0, -1));
  const expiry = s.world.storageLab.versions[0]?.expires;
  const changed = run(
    s,
    "gcloud storage buckets update gs://storage-softdelete --soft-delete-duration=30d",
  );
  expect(changed.world.storageLab.versions[0]?.expires).toBe(expiry);
  const expired = run(changed, "sim storage time advance --seconds=604800");
  expect(
    run(expired, "gcloud storage ls gs://storage-softdelete --soft-deleted").text,
  ).not.toContain("report.json");
  reject(expired, "gcloud storage restore gs://storage-softdelete/report.json#1", "expired");
});

test("Object Creator can upload but cannot overwrite; private access requires IAM and HTTPS", () => {
  const s = run(
    lesson("iam"),
    "gcloud storage buckets add-iam-policy-binding gs://storage-iam --member=serviceAccount:storage-reader@ace-dev-01.iam.gserviceaccount.com --role=roles/storage.objectCreator",
  );
  reject(
    s,
    "gcloud storage cp ./report.json gs://storage-iam/report.json --account=storage-reader@ace-dev-01.iam.gserviceaccount.com",
    "storage.objects.delete",
  );
  const http = run(
    s,
    "sim storage access check gs://storage-iam/report.json --principal=storage-reader@ace-dev-01.iam.gserviceaccount.com --transport=http",
  );
  expect(http.text).toContain("allowed: false");
  reject(s, "sim storage access check gs://storage-iam/missing.json", "existing live object");
});

test("PAP rejects new public IAM bindings for both gcloud and gsutil", () => {
  const s = lesson("pap");
  reject(
    s,
    "gcloud storage buckets add-iam-policy-binding gs://storage-pap --member=allAuthenticatedUsers --role=roles/storage.objectViewer",
    "Public access prevention",
  );
  reject(
    s,
    "gsutil iam ch allAuthenticatedUsers:objectViewer gs://storage-pap",
    "Public access prevention",
  );
  expect(
    run(s, "sim storage access check gs://storage-pap/report.json --principal=anonymous").text,
  ).toContain("allowed: false");
});

test("PAP rejects public ACL additions on a bucket with fine-grained access", () => {
  const s = run(
    session(),
    ...StoragePrelude,
    "gcloud storage buckets create gs://pap-acl",
    "gcloud storage buckets update gs://pap-acl --public-access-prevention",
  );
  reject(s, "gsutil acl ch -u allUsers:R gs://pap-acl", "Public access prevention");
  reject(s, "gsutil acl ch -u allAuthenticatedUsers:R gs://pap-acl", "Public access prevention");
});

test("transfer automatic names remain available after deleting an earlier job", () => {
  const s = run(
    lesson("transfer"),
    "gcloud transfer jobs create gs://storage-source gs://storage-destination --do-not-run",
    "gcloud transfer jobs create gs://storage-source gs://storage-destination --do-not-run",
    "gcloud transfer jobs delete transferJobs/lesson-1 --quiet",
    "gcloud transfer jobs create gs://storage-source gs://storage-destination --do-not-run",
  );
  expect(s.text).not.toContain("ERROR:");
  expect(new Set(s.world.storageLab.transfers.map((t) => t.name)).size).toBe(3);
});

test("BigQuery input rewrites preserve storage history and load the current payload", () => {
  const s = run(
    session(),
    ...DataPrelude,
    ...DataSolutions.load.slice(0, 4),
    "gcloud storage buckets update gs://ace-csv-input --versioning",
    "gcloud storage ls gs://ace-csv-input --all-versions",
    "sim storage time advance --seconds=60",
    "sim storage objects write gs://ace-csv-input/input --data='alice,99'",
    "bq load warehouse.orders gs://ace-csv-input/input --location=US",
  );
  expect(s.text).not.toContain("ERROR:");
  expect(s.world.dataProcessing.tables[0]?.rows).toEqual([{ customer: "alice", amount: 99 }]);
  expect(s.world.storageLab.versions.map((v) => v.state)).toEqual(["NONCURRENT", "LIVE"]);
  expect(Snapshot.fromUnknown(Snapshot.create(s.world, Now)).ok).toBe(true);
});

test("CMEK service-agent authorization, location and key state affect object operations", () => {
  const ungranted = run(
    session(),
    ...StoragePrelude,
    ...StorageSolutions.cmek.filter(
      (line) => !line.includes("authorize-cmek") && !line.includes("storage cp"),
    ),
  );
  reject(
    ungranted,
    "gcloud storage cp ./report.json gs://storage-cmek/report.json",
    "service agent lacks",
  );
  const s = lesson("cmek");
  const disabled = run(
    s,
    "gcloud kms keys versions disable 1 --key=storage-key --keyring=storage-ring --location=us-central1",
  );
  reject(disabled, "gcloud storage cp gs://storage-cmek/report.json ./download.json", "ENABLED");
  reject(disabled, "gcloud storage cp ./next.json gs://storage-cmek/next.json", "ENABLED");
  expect(storageSatisfied(disabled.world, "cmek")).toBe(false);
  reject(
    s,
    "gcloud storage buckets create gs://wrong-location --location=us-east1 --default-encryption-key=projects/ace-dev-01/locations/us-central1/keyRings/storage-ring/cryptoKeys/storage-key",
    "same bucket location",
  );
});

test("signing checks signer object IAM, signBlob IAM, private key mode and TTL", () => {
  const s = run(session(), ...StoragePrelude, ...StorageSolutions.signed.slice(0, 4));
  reject(
    s,
    "gcloud storage sign-url gs://storage-signed/report.json --impersonate-service-account=storage-signer@ace-dev-01.iam.gserviceaccount.com",
    "storage.objects.get",
  );
  const ready = run(s, ...StorageSolutions.signed.slice(4, 5));
  reject(
    ready,
    "gcloud storage sign-url gs://storage-signed/report.json --duration=13h --impersonate-service-account=storage-signer@ace-dev-01.iam.gserviceaccount.com",
    "12h",
  );
  reject(
    ready,
    "gcloud storage sign-url gs://storage-signed/report.json --private-key-file=secret.json",
    "Private key files are not read",
  );
  reject(
    ready,
    "gcloud storage sign-url gs://storage-signed/report.json --impersonate-service-account=storage-signer@ace-dev-01.iam.gserviceaccount.com --account=developer@example.com",
    "signBlob",
  );
});

test("signed URL access changes when signer access is revoked", () => {
  const s = run(session(), ...StoragePrelude, ...StorageSolutions.signed.slice(0, 7));
  expect(s.text).toContain("allowed: true");
  const revoked = run(
    s,
    "gcloud storage buckets remove-iam-policy-binding gs://storage-signed --member=serviceAccount:storage-signer@ace-dev-01.iam.gserviceaccount.com --role=roles/storage.objectViewer",
    "sim storage signed-url check signed-2",
  );
  expect(revoked.text).toContain("signer-permission-revoked");
});

test("transfer operation reports agent failures without copying, then observes disabled state", () => {
  const s = run(
    session(),
    ...StoragePrelude,
    ...StorageSolutions.transfer.slice(0, 3),
    "gcloud transfer jobs create gs://storage-source gs://storage-destination --name=transferJobs/denied",
  );
  expect(s.world.storageLab.transfers[0]?.operation).toBe("FAILED");
  expect(s.text).toContain("service agent lacks");
  expect(s.world.buckets.find((b) => b.name === "storage-destination")?.objects).toHaveLength(0);
  const disabled = run(
    lesson("transfer"),
    "gcloud transfer jobs update transferJobs/storage-lesson --status=disabled",
    "gcloud transfer jobs run transferJobs/storage-lesson",
  );
  expect(disabled.text).toContain("Transfer job is disabled");
  expect(disabled.world.storageLab.transfers[0]?.operation).toBe("FAILED");
});

test("transfer overwrite needs delete and unsupported sources never create a job", () => {
  const s = run(
    lesson("transfer"),
    "gcloud storage cp ./different.json gs://storage-destination/report.json",
    "gcloud transfer jobs update transferJobs/storage-lesson --overwrite-when=always",
    "gcloud transfer jobs run transferJobs/storage-lesson",
  );
  expect(s.text).toContain("storage.objects.delete");
  reject(
    s,
    "gcloud transfer jobs create s3://external gs://storage-destination",
    "other source types",
  );
  reject(
    s,
    "gcloud transfer jobs create gs://storage-source/prefix gs://storage-destination",
    "Prefixes",
  );
  reject(s, "gcloud storage rm gs://storage-source --recursive --quiet", "transfer job");
});

test("file storage rejects unsupported profiles, aggregate pool overcommit and dependency deletion", () => {
  const s = lesson("netapp");
  const third = run(
    s,
    "gcloud netapp volumes create second-volume --location=us-central1 --capacity=1024 --protocols=nfsv3 --share-name=share2 --storage-pool=shared-pool",
  );
  expect(third.text).not.toContain("ERROR:");
  reject(
    third,
    "gcloud netapp volumes create third-volume --location=us-central1 --capacity=1024 --protocols=nfsv3 --share-name=share3 --storage-pool=shared-pool",
    "exceed pool capacity",
  );
  reject(
    s,
    "gcloud netapp storage-pools delete shared-pool --location=us-central1 --quiet",
    "Delete volumes",
  );
  reject(
    s,
    "gcloud filestore instances create too-small --zone=us-central1-c --tier=BASIC_HDD --file-share=name=small,capacity=100GB --network=name=default",
    "Unsupported configuration",
  );
  reject(
    s,
    "gcloud lustre instances create unsupported --location=us-central1-a --capacity-gib=18000 --per-unit-storage-throughput=125 --filesystem=lustrefs --network=default",
    "Unsupported configuration",
  );
  reject(s, "gcloud netapp volumes describe shared-volume --location=us-east1", "not exist");
});

test("Snapshot rejects corrupted generation references and fixed file profiles", () => {
  const world = lesson("filestore").world;
  expect(
    Snapshot.fromUnknown(
      Snapshot.create(
        {
          ...world,
          storageLab: {
            ...world.storageLab,
            files: world.storageLab.files.map((f) => ({ ...f, capacity: 1 })),
          },
        },
        Now,
      ),
    ).ok,
  ).toBe(false);
  const objectWorld = lesson("ubla").world;
  expect(
    Snapshot.fromUnknown(
      Snapshot.create(
        { ...objectWorld, storageLab: { ...objectWorld.storageLab, versions: [] } },
        Now,
      ),
    ).ok,
  ).toBe(false);
});

test("v37 snapshots migrate with empty storage extension and preserve legacy object metadata", () => {
  const world = initialWorld();
  const { storageLab: omitted, ...legacy } = world;
  expect(omitted.versions).toHaveLength(0);
  const restored = Snapshot.fromUnknown({ schemaVersion: 37, world: legacy, exportedAt: Now });
  expect(restored.ok).toBe(true);
  if (restored.ok) {
    expect(restored.value.storageLab.versions).toEqual([]);
    expect(restored.value.buckets).toEqual(world.buckets);
  }
});

test("PAP removes public grants for authenticated accounts and signing as well as anonymous access", () => {
  const s = run(
    session(),
    ...StoragePrelude,
    "gcloud storage buckets create gs://pap-public",
    "gcloud storage cp ./report.json gs://pap-public/report.json",
    "gcloud iam service-accounts create pap-reader",
    "gcloud storage buckets add-iam-policy-binding gs://pap-public --member=allUsers --role=roles/storage.objectViewer",
    "gcloud iam service-accounts add-iam-policy-binding pap-reader@ace-dev-01.iam.gserviceaccount.com --member=user:owner@example.com --role=roles/iam.serviceAccountTokenCreator",
    "gcloud storage buckets update gs://pap-public --public-access-prevention",
  );
  reject(
    s,
    "gcloud storage cp gs://pap-public/report.json ./read.json --account=pap-reader@ace-dev-01.iam.gserviceaccount.com",
    "storage.objects.get",
  );
  reject(
    s,
    "gcloud storage objects describe gs://pap-public/report.json --account=pap-reader@ace-dev-01.iam.gserviceaccount.com",
    "storage.objects.get",
  );
  reject(
    s,
    "gcloud storage sign-url gs://pap-public/report.json --impersonate-service-account=pap-reader@ace-dev-01.iam.gserviceaccount.com",
    "storage.objects.get",
  );
});

test("Terraform backend preserves tracked object generations after storage reads and virtual time", () => {
  const s = run(
    session(),
    ...StoragePrelude,
    "sim files load terraform-network",
    "gcloud auth application-default login",
    "terraform init",
    "terraform apply -auto-approve",
    "gcloud storage buckets create gs://ace-dev-01-tf-state --location=us-central1 --uniform-bucket-level-access",
    "gcloud storage buckets update gs://ace-dev-01-tf-state --versioning",
    "sim files load terraform-backend",
    "terraform init -force-copy",
  );
  expect(s.text).not.toContain("ERROR:");
  const tracked = run(
    s,
    "gcloud storage ls gs://ace-dev-01-tf-state --all-versions",
    "sim storage time advance --seconds=60",
    "terraform apply -auto-approve",
  );
  expect(tracked.text).not.toContain("ERROR:");
  expect(Snapshot.fromUnknown(Snapshot.create(tracked.world, Now)).ok).toBe(true);
  expect(
    tracked.world.storageLab.versions.filter((v) => v.bucket === "ace-dev-01-tf-state").length,
  ).toBeGreaterThan(1);
  const protectedState = run(
    s,
    "gcloud storage buckets update gs://ace-dev-01-tf-state --retention-period=1h",
  );
  reject(protectedState, "terraform apply -auto-approve", "retention policy prevents");
});
