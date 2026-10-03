// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { initialWorld, Now, run, type Session, session } from "@/engine/__tests__/setup";
import { TerraformInfrastructureExample as example } from "@/engine/commands/terraform/examples";
import { TerraformState } from "@/engine/domains/terraform";
import { TfConfiguration } from "@/engine/domains/terraform/configuration";
import { Hcl } from "@/engine/domains/terraform/hcl";
import { World } from "@/engine/domains/world";
import { Mission } from "@/engine/missions";
import { terraformSatisfied } from "@/engine/missions/terraform";
import { Snapshot } from "@/engine/snapshot";
import { Result } from "@/utils/Result";

const execute = (s: Session, ...commands: string[]): Session =>
  commands.reduce((current, command) => {
    const next = run(current, command);
    expect(next.text, command).not.toContain("ERROR:");
    return next;
  }, s);
const ready = (s = session()): Session =>
  execute(
    s,
    "sim files load terraform-infrastructure",
    "gcloud auth application-default login",
    "terraform init",
  );
const built = (s = session()): Session => execute(ready(s), "terraform apply -auto-approve");
const write = (s: Session, content: string): Session =>
  execute(s, `sim files write main.tf --content='${content}'`);
const restore = (s: Session): Session =>
  session(
    Result.unwrap(Snapshot.fromUnknown(JSON.parse(JSON.stringify(Snapshot.create(s.world, Now))))),
  );
const vm = (s: Session) => s.world.instances.find((i) => i.name === "tf-lab-vm");
const bucket = (s: Session) => s.world.buckets.find((b) => b.name === "ace-dev-01-tf-lab-assets");
const address = "google_compute_instance.web";
const bucketAddress = "google_storage_bucket.assets";
const bucketUrl = "gs://ace-dev-01-tf-lab-assets";

test("five resources share the CLI world, plan is read-only and destroy follows dependencies", () => {
  const s = ready();
  const planned = execute(s, "terraform plan");
  expect(planned.text).toContain("5 to add");
  expect(planned.world).toEqual(s.world);
  const saved = execute(planned, "terraform plan -out=infra");
  const applied = execute(restore(saved), "terraform apply infra");
  expect(applied.world.terraform.resources).toHaveLength(5);
  expect(vm(applied)).toMatchObject({
    machineType: "e2-micro",
    status: "RUNNING",
    tags: ["web"],
    creationTimestamp: Now,
  });
  expect(bucket(applied)).toMatchObject({
    versioning: true,
    uniformBucketLevelAccess: true,
    publicAccessPrevention: true,
  });
  expect(
    execute(applied, "gcloud compute instances describe tf-lab-vm --zone=us-central1-a").text,
  ).toContain("e2-micro");
  expect(execute(applied, `gcloud storage buckets describe ${bucketUrl}`).text).toContain(
    "enabled: true",
  );
  expect(execute(restore(applied), "terraform plan").text).toContain("No resource changes");
  expect(Result.isOk(World.validate(applied.world))).toBe(true);
  const destroy = execute(applied, "terraform plan -destroy -out=cleanup");
  const changes = destroy.world.terraform.plans.cleanup?.changes ?? [];
  expect(changes[0]?.resource.type).toBe("google_compute_instance");
  const deleted = execute(restore(destroy), "terraform apply cleanup");
  expect(deleted.world.instances).toEqual(s.world.instances);
  expect(deleted.world.firewallRules).toEqual(s.world.firewallRules);
  expect(deleted.world.buckets).toEqual(s.world.buckets);
  expect(deleted.world.networks).toEqual(s.world.networks);
  expect(deleted.world.subnets).toEqual(s.world.subnets);
  expect(Result.isOk(World.validate(deleted.world))).toBe(true);
});

test("CLI drift is detected, saved plans go stale, refresh changes only state and apply restores config", () => {
  const s = execute(built(), "terraform plan -out=old");
  const drifted = execute(
    s,
    "gcloud compute instances add-tags tf-lab-vm --zone=us-central1-a --tags=extra",
    `gcloud storage buckets update ${bucketUrl} --no-versioning`,
  );
  expect(run(drifted, "terraform apply old").text).toContain("stale");
  const plan = execute(drifted, "terraform plan");
  expect(plan.text).toContain("2 to change");
  expect(plan.world).toEqual(drifted.world);
  const refreshed = execute(drifted, "terraform apply -refresh-only -auto-approve");
  expect(refreshed.world.instances).toEqual(drifted.world.instances);
  expect(refreshed.world.buckets).toEqual(drifted.world.buckets);
  const repaired = execute(restore(refreshed), "terraform apply -auto-approve");
  expect(vm(repaired)?.tags).toEqual(["web"]);
  expect(vm(repaired)?.id).toBe(vm(s)?.id);
  expect(bucket(repaired)?.versioning).toBe(true);
});

test("machine resize requires stopping permission and allow_stopping_for_update; tags/metadata preserve identity", () => {
  const s = built();
  const edited = write(
    s,
    example.replace(
      'machine_type = "e2-micro"',
      'machine_type = "e2-small"\n metadata = { z = "last", a = "first" }',
    ),
  );
  expect(run(edited, "terraform plan").text).toContain("allow_stopping_for_update");
  const enabled = write(
    edited,
    edited.world.terraform.files["main.tf"]?.replace(
      'machine_type = "e2-small"',
      'machine_type = "e2-small"\n allow_stopping_for_update = true',
    ) ?? "",
  );
  const updated = execute(enabled, "terraform apply -auto-approve");
  expect(vm(updated)?.id).toBe(vm(s)?.id);
  expect(vm(updated)).toMatchObject({
    machineType: "e2-small",
    status: "RUNNING",
    metadata: { a: "first", z: "last" },
  });
  expect(execute(restore(updated), "terraform plan").text).toContain("No resource changes");
  const stopped = execute(
    edited,
    "gcloud compute instances stop tf-lab-vm --zone=us-central1-a",
    "terraform apply -auto-approve",
  );
  expect(vm(stopped)).toMatchObject({ machineType: "e2-small", status: "TERMINATED" });
});

test("firewall allow/deny and ranges update in place and affect the shared rule", () => {
  const s = built();
  const edited = write(
    s,
    example.replace("allow {", "deny {").replace('ports = ["80", "443"]', 'ports = ["443"]'),
  );
  const planned = execute(edited, "terraform plan");
  expect(planned.text).toContain("0 to add, 1 to change, 0 to destroy");
  const updated = execute(planned, "terraform apply -auto-approve");
  expect(updated.world.firewallRules.find((f) => f.name === "tf-lab-http")).toMatchObject({
    allowed: [],
    denied: [{ protocol: "tcp", ports: ["443"] }],
  });
  expect(execute(updated, "terraform plan").text).toContain("No resource changes");
});

test("nonempty buckets block atomic destroy until force_destroy is applied to state", () => {
  const s = execute(built(), `gcloud storage cp ./asset.txt ${bucketUrl}/`);
  const rejected = run(s, "terraform destroy -auto-approve");
  expect(rejected.text).toContain("not empty");
  expect(rejected.world).toEqual(s.world);
  const edited = write(s, example.replace("force_destroy = false", "force_destroy = true"));
  expect(run(edited, "terraform destroy -auto-approve").text).toContain("not empty");
  const enabled = execute(edited, "terraform apply -auto-approve");
  expect(bucket(enabled)?.objects).toEqual(bucket(s)?.objects);
  const deleted = execute(enabled, "terraform destroy -auto-approve");
  expect(bucket(deleted)).toBeUndefined();
  expect(vm(deleted)).toBeUndefined();
});

test("unmanaged dependencies block cleanup without partial mutation", () => {
  const s = execute(
    built(),
    "gcloud compute instances create unmanaged --zone=us-central1-a --network=tf-lab-vpc --subnet=tf-lab-subnet",
  );
  const rejected = run(s, "terraform destroy -auto-approve");
  expect(rejected.text).toContain("still in use");
  expect(rejected.world).toEqual(s.world);
});

test("state rm/import and moved work with every new resource type", () => {
  const s = built();
  const originalVm = vm(s);
  let current = s;
  for (const r of s.world.terraform.resources.filter((r) =>
    ["google_compute_instance", "google_compute_firewall", "google_storage_bucket"].includes(
      r.type,
    ),
  )) {
    current = execute(current, `terraform state rm ${r.address}`);
    expect(run(current, "terraform plan").text).toContain("Use terraform import");
    current = execute(
      current,
      `terraform import ${r.address} ${r.type === "google_storage_bucket" ? `${r.project}/${r.name}` : TerraformState.id(r)}`,
    );
    expect(run(current, `terraform import ${r.address} ${TerraformState.id(r)}`).text).toContain(
      "already managed",
    );
  }
  const renamed = write(
    current,
    example
      .replace('"google_compute_instance" "web"', '"google_compute_instance" "renamed"')
      .replaceAll("google_compute_instance.web.id", "google_compute_instance.renamed.id") +
      `moved { from = ${address} to = google_compute_instance.renamed }`,
  );
  const plan = execute(renamed, "terraform plan -out=moved");
  expect(plan.text).toContain("has moved to");
  expect(plan.text).toContain("No resource changes");
  const applied = execute(plan, "terraform apply moved");
  expect(vm(applied)).toEqual(originalVm);
});

test("bucket import never inherits force_destroy from configuration", () => {
  const s = built();
  const configured = write(s, example.replace("force_destroy = false", "force_destroy = true"));
  const imported = execute(
    configured,
    `terraform state rm ${bucketAddress}`,
    `terraform import ${bucketAddress} ace-dev-01-tf-lab-assets`,
  );
  expect(
    imported.world.terraform.resources.find((r) => r.type === "google_storage_bucket")
      ?.forceDestroy,
  ).toBe(false);
  expect(execute(imported, "terraform plan").text).toContain("1 to change");
});

test("ADC permissions are enforced for compute and storage independently with atomic failure", () => {
  const s = ready();
  const restricted = execute(
    s,
    "gcloud auth login developer@example.com",
    "gcloud auth application-default login",
    "gcloud auth login owner@example.com",
  );
  const rejected = run(restricted, "terraform apply -auto-approve");
  expect(rejected.text).toContain("Permission denied");
  expect(rejected.world).toEqual(restricted.world);
  const noStorage = execute(s, "gcloud services disable storage.googleapis.com");
  expect(run(noStorage, "terraform plan").text).toContain("storage.googleapis.com is disabled");
  const noCompute = execute(s, "gcloud services disable compute.googleapis.com");
  expect(run(noCompute, "terraform plan").text).toContain("compute.googleapis.com is disabled");
});

test("bucket IAM grants permit updates without project write privileges", () => {
  const s = execute(
    built(),
    `gcloud storage buckets add-iam-policy-binding ${bucketUrl} --member=user:developer@example.com --role=roles/storage.admin`,
  );
  const bucketOnly = `provider "google" { project = "ace-dev-01" } resource "google_storage_bucket" "assets" { name = "ace-dev-01-tf-lab-assets" location = "US-CENTRAL1" storage_class = "NEARLINE" }`;
  let selected = write(s, bucketOnly);
  for (const r of selected.world.terraform.resources.filter(
    (r) => r.type !== "google_storage_bucket",
  ))
    selected = execute(selected, `terraform state rm ${r.address}`);
  const dev = execute(
    selected,
    "gcloud auth login developer@example.com",
    "gcloud auth application-default login",
  );
  const updated = execute(dev, "terraform apply -auto-approve");
  expect(bucket(updated)?.storageClass).toBe("NEARLINE");
  expect(updated.world.instances).toEqual(s.world.instances);
});

test("service account attachment requires actAs and preserves VM on a denied apply", () => {
  const s = execute(ready(), "gcloud iam service-accounts create tf-runner");
  const source = example.replace(
    '  tags = ["web"]',
    '  tags = ["web"]\n service_account { email = "tf-runner@ace-dev-01.iam.gserviceaccount.com" scopes = ["cloud-platform"] }',
  );
  const configured = write(s, source);
  const denied = run(configured, "terraform apply -auto-approve");
  expect(denied.text).toContain("iam.serviceAccounts.actAs");
  expect(denied.world).toEqual(configured.world);
  const granted = execute(
    configured,
    "gcloud iam service-accounts add-iam-policy-binding tf-runner@ace-dev-01.iam.gserviceaccount.com --member=user:owner@example.com --role=roles/iam.serviceAccountUser",
  );
  const created = execute(granted, "terraform apply -auto-approve");
  expect(vm(created)?.serviceAccount).toBe("tf-runner@ace-dev-01.iam.gserviceaccount.com");
  expect(execute(created, "terraform plan").text).toContain("No resource changes");
  const missing = write(s, source.replace("tf-runner@", "missing@"));
  expect(run(missing, "terraform plan").text).toContain("Service account not found");
});

test("nested module lists and blocks format stably and scalar outputs retain values", () => {
  const config = TfConfiguration.compile({
    "main.tf":
      'provider "google" { project = "ace-dev-01" region = "us-central1" } module "infra" { source = "./infra" } output "url" { value = module.infra.bucket_url }',
    "infra/main.tf": example.replace(/provider "google" \{[^}]+\}/, " "),
  });
  expect(config.resources).toHaveLength(5);
  expect(config.resources.every((r) => r.address.startsWith("module.infra."))).toBe(true);
  expect(config.outputs.url).toBe(bucketUrl);
  expect(Hcl.parse(Hcl.format(Hcl.parse(example)))).toEqual(Hcl.parse(example));
});

test.each([
  ['ports = ["80", "443"]', 'ports = ["70000"]'],
  ['ports = ["80", "443"]', 'ports = ["90-80"]'],
  ['protocol = "tcp"', 'protocol = "icmp"'],
  ['source_ranges = ["0.0.0.0/0"]', 'source_ranges = ["300.0.0.0/1"]'],
  ['source_ranges = ["0.0.0.0/0"]', 'direction = "EGRESS" source_ranges = ["0.0.0.0/0"]'],
  ['source_ranges = ["0.0.0.0/0"]', "source_ranges = []"],
  ['target_tags = ["web"]', "target_tags = [12]"],
  ['target_tags = ["web"]', "priority = 65536"],
  ['machine_type = "e2-micro"', 'machine_type = "not-a-machine"'],
  ['zone = "us-central1-a"', 'zone = "invalid-zone"'],
  ['image = "debian-cloud/debian-12"', 'image = "unknown/image"'],
  ['image = "debian-cloud/debian-12"', 'image = "debian-cloud/debian-12" size = 0'],
  ["access_config {}", 'access_config { nat_ip = "1.2.3.4" }'],
  ['location = "US-CENTRAL1"', 'location = "MOON"'],
  ["uniform_bucket_level_access = true", 'uniform_bucket_level_access = "true"'],
  ["versioning { enabled = true }", "versioning {}"],
  ["versioning { enabled = true }", "versioning { enabled = true } versioning { enabled = false }"],
  ["force_destroy = false", "lifecycle { prevent_destroy = true }"],
])("invalid resource configurations fail without mutation: %s -> %s", (from, to) => {
  const s = write(session(), example.replace(from, to));
  const rejected = run(s, "terraform init");
  expect(rejected.text).toContain("ERROR:");
  expect(rejected.world).toEqual(s.world);
});

test("zone/subnet mismatch and globally duplicate buckets are refused", () => {
  const s = write(ready(), example.replace('zone = "us-central1-a"', 'zone = "asia-northeast1-a"'));
  expect(run(s, "terraform plan").text).toContain("location mismatch");
  const otherProject = bucket(built());
  if (!otherProject) throw new Error("Missing fixture bucket");
  const collision = ready(
    session({
      ...initialWorld(),
      buckets: [{ ...otherProject, projectId: "ace-prod-01", name: "ace-dev-01-tf-lab-assets" }],
    }),
  );
  expect(run(collision, "terraform plan").text).toContain("another project");
});

test("corrupted new resource snapshot fields are rejected, existing v5 files still import", () => {
  const s = built();
  expect(restore(s).world).toEqual(s.world);
  const snapshot = Snapshot.create(s.world, Now);
  for (const invalid of [{ diskSize: -1 }, { machineType: "fake" }, { tags: ["INVALID!"] }]) {
    const resources = s.world.terraform.resources.map((r) =>
      r.type === "google_compute_instance" ? { ...r, ...invalid } : r,
    );
    expect(
      Result.isOk(
        Snapshot.fromUnknown({
          ...snapshot,
          world: { ...s.world, terraform: { ...s.world.terraform, resources } },
        }),
      ),
    ).toBe(false);
  }
});

test.each(["m-terraform-005", "m-terraform-006"])(
  "%s is independently solvable and does not clear on plan/state rm",
  (id) => {
    const mission = Mission.all().find((m) => m.id === id);
    if (!mission) throw new Error("Missing mission");
    const start = session(Result.unwrap(Mission.start(initialWorld(), mission)));
    expect(Mission.evaluate(start.world).completed).toEqual([]);
    const planned = execute(ready(start), "terraform plan -out=infra");
    expect(planned.world.missions.find((m) => m.id === id)?.status).toBe("in_progress");
    const created = execute(planned, "terraform apply infra");
    if (id === "m-terraform-005") {
      expect(created.world.missions.find((m) => m.id === id)?.status).toBe("completed");
      return;
    }
    const destroyPlan = execute(created, "terraform plan -destroy -out=cleanup");
    expect(destroyPlan.world.missions.find((m) => m.id === id)?.status).toBe("in_progress");
    let removed = destroyPlan;
    for (const r of created.world.terraform.resources)
      removed = execute(removed, `terraform state rm ${r.address}`);
    expect(removed.world.missions.find((m) => m.id === id)?.status).toBe("in_progress");
    const deleted = execute(restore(destroyPlan), "terraform apply cleanup");
    expect(deleted.world.missions.find((m) => m.id === id)?.status).toBe("completed");
    for (const assertion of mission.assertions)
      if (assertion.kind === "terraformDestroyed")
        expect(terraformSatisfied(deleted.world, assertion)).toBe(true);
    expect(Engine.completionCandidates(deleted.world, "sim files load terraform-i")).toContain(
      "terraform-infrastructure",
    );
  },
);
