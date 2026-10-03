// @vitest-environment node
import { expect, test } from "vitest";
import { initialWorld, Now, run, type Session, session } from "@/engine/__tests__/setup";
import { TerraformState } from "@/engine/domains/terraform";
import { TfBackend } from "@/engine/domains/terraform/backend";
import { Mission } from "@/engine/missions";
import { terraformSatisfied } from "@/engine/missions/terraform";
import { Snapshot } from "@/engine/snapshot";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const bucket = "ace-dev-01-tf-state";
const path = "terraform/lab/default.tfstate";
const execute = (s: Session, ...commands: string[]): Session =>
  commands.reduce((current, command) => {
    const next = run(current, command);
    expect(next.text, command).not.toContain("ERROR:");
    return next;
  }, s);
const local = (s = session()): Session =>
  execute(
    s,
    "sim files load terraform-network",
    "gcloud auth application-default login",
    "terraform init",
    "terraform apply -auto-approve",
  );
const configured = (s = local(), versioning = true): Session =>
  execute(
    s,
    `gcloud storage buckets create gs://${bucket} --location=us-central1 --uniform-bucket-level-access`,
    ...(versioning ? [`gcloud storage buckets update gs://${bucket} --versioning`] : []),
    "sim files load terraform-backend",
  );
const remote = (): Session => execute(configured(), "terraform init -force-copy");
const active = (s: Session) =>
  s.world.terraform.backend.remotes.find(
    (r) => TfBackend.key(r.config) === TfBackend.key(s.world.terraform.backend.config),
  );
const restore = (s: Session): Session =>
  session(
    Result.unwrap(Snapshot.fromUnknown(JSON.parse(JSON.stringify(Snapshot.create(s.world, Now))))),
  );
const rejected = (s: Session, command: string, message: string): void => {
  const next = run(s, command);
  expect(next.text).toContain(message);
  expect(next.world).toEqual(s.world);
};
const backendFile = (s: Session, prefix: string): Session =>
  execute(
    s,
    `sim files write backend.tf --content='terraform { backend "gcs" { bucket = "${bucket}" prefix = "${prefix}" } }'`,
  );

test("migration requires confirmation, cancellation preserves state, and copy never recreates infrastructure", () => {
  const s = configured(execute(local(), "terraform plan -out=before"));
  rejected(s, "terraform init", "-migrate-state");
  rejected(s, "terraform plan", "-migrate-state");
  const preview = execute(s, "terraform init -migrate-state");
  expect(preview.world).toEqual(s.world);
  expect(execute(preview, "no").world).toEqual(s.world);
  const migrated = execute(preview, "yes");
  expect(migrated.world.networks).toEqual(s.world.networks);
  expect(migrated.world.subnets).toEqual(s.world.subnets);
  expect(TfBackend.data(migrated.world.terraform)).toEqual(TfBackend.data(s.world.terraform));
  expect(active(migrated)?.data).toEqual(TfBackend.data(s.world.terraform));
  expect(migrated.world.buckets.find((b) => b.name === bucket)?.objects[0]?.name).toBe(path);
  rejected(migrated, "terraform apply before", "backend changed");
  expect(execute(migrated, "terraform plan").world).toEqual(migrated.world);
  expect(JSON.parse(execute(migrated, "terraform state pull").text).resources).toHaveLength(2);
  expect(execute(migrated, `gcloud storage ls gs://${bucket}/terraform/lab/`).text).toContain(
    "default.tfstate",
  );
  expect(restore(migrated).world).toEqual(migrated.world);
});

test("apply, refresh, state rm/import/mv and destroy commit remote generations", () => {
  let s = remote();
  const original = s.world.networks;
  const address = "google_compute_subnetwork.lab";
  const resource = s.world.terraform.resources.find((r) => r.address === address);
  if (!resource) throw new Error("Missing resource");
  const commands = [
    "terraform apply -refresh-only -auto-approve",
    `terraform state rm ${address}`,
    `terraform import ${address} ${TerraformState.id(resource)}`,
    `terraform state mv ${address} google_compute_subnetwork.renamed`,
    `terraform state mv google_compute_subnetwork.renamed ${address}`,
  ];
  for (const command of commands) {
    const generation = active(s)?.generation ?? 0;
    s = execute(restore(s), command);
    expect(active(s)?.generation).toBe(generation + 1);
    expect(active(s)?.data).toEqual(TfBackend.data(s.world.terraform));
    expect(s.world.networks).toEqual(original);
  }
  const saved = execute(s, "terraform plan -destroy -out=delete");
  s = execute(restore(saved), "terraform apply delete");
  expect(active(s)?.data.resources).toEqual([]);
  expect(active(s)?.versions).toHaveLength(6);
});

test("GCS prefixes and local backends can be migrated while retaining old remote copies", () => {
  const s = remote();
  const moved = execute(backendFile(s, "other"), "terraform init -force-copy");
  expect(moved.world.terraform.backend.remotes).toHaveLength(2);
  expect(active(moved)?.data).toEqual(active(s)?.data);
  const back = execute(moved, "sim files delete backend.tf", "terraform init -force-copy");
  expect(back.world.terraform.backend.config.kind).toBe("local");
  expect(back.world.terraform.backend.generation).toBe(0);
  expect(back.world.buckets).toEqual(moved.world.buckets);
  expect(restore(back).world).toEqual(back.world);
  const changed = execute(moved, "terraform state rm google_compute_subnetwork.lab");
  rejected(backendFile(changed, "terraform/lab"), "terraform init -force-copy", "different state");
});

test("known state can be reconnected; unrecognized destination objects are never overwritten", () => {
  const s = remote();
  const empty = session({
    ...s.world,
    terraform: {
      ...s.world.terraform,
      initialized: false,
      resources: [],
      outputs: {},
      serial: 0,
      plans: {},
    },
  });
  const loaded = execute(empty, "terraform init");
  expect(loaded.world.terraform.resources).toEqual(s.world.terraform.resources);
  expect(active(loaded)?.generation).toBe(active(s)?.generation);
  const collision = execute(
    configured(),
    `gcloud storage cp ./default.tfstate gs://${bucket}/terraform/lab/`,
  );
  rejected(collision, "terraform init -force-copy", "already exists");
});

test("versioning is recommended, keeps at most ten prior generations, and survives snapshot", () => {
  const unversioned = execute(configured(local(), false), "terraform init -force-copy");
  expect(unversioned.text).toContain("Warning");
  expect(
    active(execute(unversioned, "terraform apply -refresh-only -auto-approve"))?.versions,
  ).toEqual([]);
  let s = remote();
  for (let i = 0; i < 12; i++) s = execute(s, "terraform apply -refresh-only -auto-approve");
  expect(active(s)?.versions).toHaveLength(10);
  expect(active(s)?.versions[0]?.generation).toBe(3);
  expect(execute(restore(s), "sim terraform backend").text).toContain('"generation": 13');
});

test("lock survives export, prevents writes and migration, but allows state reads and exact-ID recovery", () => {
  const s = execute(remote(), "terraform plan -out=saved", "sim terraform lock");
  const lock = active(s)?.lock;
  if (!lock || !Option.isSome(lock)) throw new Error("Missing lock");
  const locked = restore(s);
  for (const command of [
    "terraform plan",
    "terraform apply saved",
    "terraform state rm google_compute_subnetwork.lab",
    "sim terraform lock",
  ])
    rejected(locked, command, "state lock");
  rejected(backendFile(locked, "other"), "terraform init -force-copy", "state lock");
  expect(execute(locked, "terraform state pull").world).toEqual(locked.world);
  rejected(locked, "terraform force-unlock wrong -force", "does not match");
  const preview = execute(locked, `terraform force-unlock ${lock.value.id}`);
  expect(preview.world).toEqual(locked.world);
  expect(execute(preview, "no").world).toEqual(locked.world);
  const unlocked = execute(preview, "yes");
  expect(unlocked.world.networks).toEqual(locked.world.networks);
  expect(active(unlocked)?.lock).toEqual(Option.none);
  expect(unlocked.world.buckets.find((b) => b.name === bucket)?.objects).toHaveLength(1);
  expect(execute(unlocked, "terraform apply saved").world.terraform.serial).toBe(
    locked.world.terraform.serial + 1,
  );
});

test.each(["rm", "overwrite"])(
  "external state %s is detected without changing infrastructure",
  (action) => {
    const s = remote();
    const damaged = execute(
      s,
      action === "rm"
        ? `gcloud storage rm gs://${bucket}/${path} --quiet`
        : `gcloud storage cp ./default.tfstate gs://${bucket}/terraform/lab/`,
    );
    for (const command of [
      "terraform state pull",
      "terraform plan",
      "terraform apply -auto-approve",
      "terraform init",
    ])
      rejected(damaged, command, "deleted or changed");
  },
);

test("backend requires existing bucket, Storage API, ADC and bucket-specific object permissions", () => {
  const noBucket = execute(local(), "sim files load terraform-backend");
  rejected(noBucket, "terraform init -force-copy", "does not exist");
  const s = configured();
  rejected(
    execute(s, "gcloud services disable storage.googleapis.com"),
    "terraform init -force-copy",
    "storage.googleapis.com is disabled",
  );
  rejected(
    session({ ...s.world, session: { ...s.world.session, adc: Option.none } }),
    "terraform init -force-copy",
    "Credentials are missing",
  );
  const dev = execute(
    s,
    "gcloud auth login developer@example.com",
    "gcloud auth application-default login",
    "gcloud auth login owner@example.com",
  );
  rejected(dev, "terraform init -force-copy", "Backend permission denied");
  const viewer = execute(
    dev,
    `gcloud storage buckets add-iam-policy-binding gs://${bucket} --member=user:developer@example.com --role=roles/storage.objectViewer`,
  );
  rejected(viewer, "terraform init -force-copy", "storage.objects.create");
  const writer = execute(
    viewer,
    `gcloud storage buckets add-iam-policy-binding gs://${bucket} --member=user:developer@example.com --role=roles/storage.objectAdmin`,
  );
  const migrated = execute(writer, "terraform init -force-copy");
  expect(active(migrated)?.data.resources).toHaveLength(2);
});

test("read-only credentials can read remote state but cannot commit", () => {
  const s = execute(
    remote(),
    `gcloud storage buckets add-iam-policy-binding gs://${bucket} --member=user:developer@example.com --role=roles/storage.objectViewer`,
    "gcloud auth login developer@example.com",
    "gcloud auth application-default login",
  );
  expect(execute(s, "terraform state pull").world).toEqual(s.world);
  rejected(s, "terraform state rm google_compute_network.lab", "storage.objects.create");
});

test("active managed backend bucket cannot be destroyed even with force_destroy", () => {
  const s = execute(
    remote(),
    `sim files write bucket.tf --content='resource "google_storage_bucket" "state" { project = "ace-dev-01" name = "${bucket}" location = "US-CENTRAL1" force_destroy = true }'`,
    `terraform import google_storage_bucket.state ${bucket}`,
    "terraform apply -auto-approve",
  );
  rejected(s, "terraform destroy -auto-approve", "active backend bucket");
});

test.each([
  'backend "s3" {}',
  'backend "local" { path = "state" }',
  'backend "gcs" { bucket = var.bucket }',
  'backend "gcs" { bucket = "valid-bucket" credentials = "secret" }',
  'backend "gcs" { bucket = "valid-bucket" prefix = "../state" }',
  'backend "gcs" { bucket = "valid-bucket" prefix = "/state" }',
  'backend "local" {} backend "local" {}',
])("unsupported or unsafe backend fails atomically: %s", (block) => {
  const s = execute(session(), `sim files write backend.tf --content='terraform { ${block} }'`);
  rejected(s, "terraform init", "ERROR:");
});

test("backend blocks in child modules are rejected", () => {
  const s = execute(
    session(),
    `sim files write main.tf --content='module "child" { source = "./child" }'`,
    `sim files write child/main.tf --content='terraform { backend "local" {} }'`,
  );
  rejected(s, "terraform init", "root");
});

test.each([4, 5])("v%s snapshots retain local state and saved plans", (version) => {
  const s = execute(local(), "terraform plan -out=saved");
  const { backend: _backend, ...terraform } = s.world.terraform;
  const plans = Object.fromEntries(
    Object.entries(terraform.plans).map(([name, plan]) => {
      const { backendRevision: _revision, ...old } = plan;
      if (version === 5) return [name, old];
      const { moves: _moves, ...v4 } = old;
      return [name, v4];
    }),
  );
  const loaded = session(
    Result.unwrap(
      Snapshot.fromUnknown({
        ...Snapshot.create(s.world, Now),
        schemaVersion: version,
        world: { ...s.world, terraform: { ...terraform, plans } },
      }),
    ),
  );
  expect(loaded.world.terraform.backend).toEqual(TfBackend.empty());
  expect(loaded.world.terraform.resources).toEqual(s.world.terraform.resources);
  execute(loaded, "terraform apply saved");
});

test("migration mission is independently solvable, requiring migrated resources and versioning", () => {
  const mission = Mission.all().find((m) => m.id === "m-terraform-007");
  if (!mission) throw new Error("Missing mission");
  const start = session(Result.unwrap(Mission.start(initialWorld(), mission)));
  const s = configured(local(start), false);
  expect(
    execute(s, "terraform init -migrate-state").world.missions.find((m) => m.id === mission.id)
      ?.status,
  ).toBe("in_progress");
  const migrated = execute(s, "terraform init -force-copy");
  expect(migrated.world.missions.find((m) => m.id === mission.id)?.status).toBe("in_progress");
  const done = execute(migrated, `gcloud storage buckets update gs://${bucket} --versioning`);
  expect(done.world.missions.find((m) => m.id === mission.id)?.status).toBe("completed");
  const fresh = execute(
    configured(
      execute(start, "sim files load terraform-network", "gcloud auth application-default login"),
    ),
    "terraform init",
    "terraform apply -auto-approve",
  );
  const assertion = mission.assertions[0];
  if (assertion?.kind !== "terraformBackendMigrated") throw new Error("Missing assertion");
  expect(terraformSatisfied(fresh.world, assertion)).toBe(false);
  expect(terraformSatisfied(restore(done).world, assertion)).toBe(true);
});

test("backend API and IAM follow the bucket project independently of the provider", () => {
  const s = configured();
  const other = session({
    ...s.world,
    buckets: s.world.buckets.map((b) =>
      b.name === bucket ? { ...b, projectId: "ace-prod-01" } : b,
    ),
  });
  rejected(other, "terraform init -force-copy", "backend project ace-prod-01");
  const enabled = execute(
    other,
    "gcloud services enable storage.googleapis.com --project=ace-prod-01",
    "gcloud services disable storage.googleapis.com --project=ace-dev-01",
  );
  const copied = execute(enabled, "terraform init -force-copy");
  expect(active(copied)?.config.bucket).toBe(bucket);
});

test("changed or unknown lock objects cannot be force-unlocked; valid locks recover after configuration edits", () => {
  const s = execute(remote(), "sim terraform lock");
  const lock = active(s)?.lock;
  if (!lock || !Option.isSome(lock)) throw new Error("Missing lock");
  const damaged = execute(s, `gcloud storage cp ./default.tflock gs://${bucket}/terraform/lab/`);
  rejected(damaged, `terraform force-unlock ${lock.value.id} -force`, "Lock object changed");
  const changed = backendFile(s, "another");
  const unlocked = execute(
    changed,
    `terraform force-unlock ${lock.value.id} -force`,
    "terraform init -force-copy",
  );
  expect(active(unlocked)?.config.prefix).toBe("another");
  const unknown = execute(
    remote(),
    `gcloud storage cp ./default.tflock gs://${bucket}/terraform/lab/`,
  );
  rejected(unknown, "terraform plan", "owner is unknown");
});

test("snapshot rejects invalid backend counters, history, remote data and saved-plan revisions", () => {
  const s = remote();
  const r = active(s);
  if (!r) throw new Error("Missing remote");
  for (const backend of [
    { ...s.world.terraform.backend, generation: -1 },
    { ...s.world.terraform.backend, remotes: [r, r] },
    {
      ...s.world.terraform.backend,
      remotes: [{ ...r, versions: [{ generation: r.generation, data: r.data }] }],
    },
    { ...s.world.terraform.backend, remotes: [{ ...r, data: { ...r.data, serial: -1 } }] },
  ])
    expect(
      Result.isOk(
        Snapshot.fromUnknown({
          ...Snapshot.create(s.world, Now),
          world: { ...s.world, terraform: { ...s.world.terraform, backend } },
        }),
      ),
    ).toBe(false);
});
