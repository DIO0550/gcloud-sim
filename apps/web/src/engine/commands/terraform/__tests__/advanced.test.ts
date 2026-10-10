// @vitest-environment node
import { expect, test } from "vitest";
import { initialWorld, Now, run, type Session, session } from "@/engine/__tests__/setup";
import { TfConfiguration } from "@/engine/domains/terraform/configuration";
import { Hcl } from "@/engine/domains/terraform/hcl";
import { Snapshot } from "@/engine/snapshot";
import { Result } from "@/utils/Result";

const execute = (s: Session, ...commands: string[]): Session =>
  commands.reduce((current, command) => {
    const next = run(current, command);
    expect(next.text, command).not.toContain("ERROR:");
    return next;
  }, s);
const write = (s: Session, file: string, text: string): Session =>
  execute(s, `sim files write ${file} --content='${text}'`);
const reject = (s: Session, command: string, message: string): void => {
  const result = run(s, command);
  expect(result.text).toContain(message);
  expect(result.world).toEqual(s.world);
};
const roundtrip = (s: Session): Session => {
  const decoded = Snapshot.fromUnknown(JSON.parse(JSON.stringify(Snapshot.create(s.world, Now))));
  expect(Result.isOk(decoded)).toBe(true);
  if (!Result.isOk(decoded)) {
    throw new Error(JSON.stringify(decoded.error));
  }
  expect(decoded.value).toEqual(s.world);
  return session(decoded.value);
};
const base = 'provider "google" { project = "ace-dev-01" region = "us-central1" }';
const ready = (source: string): Session =>
  execute(
    write(session(), "main.tf", `${base} ${source}`),
    "gcloud auth application-default login",
    "terraform init",
  );
const counted =
  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal HCL teaching configuration
  'variable "enabled" { type = bool default = true } variable "n" { type = number default = 2 } locals { prefix = "tf-count" } resource "google_compute_network" "net" { count = var.enabled ? var.n : 0 name = "${local.prefix}-${count.index + 1}" auto_create_subnetworks = false } output "first" { value = google_compute_network.net[0].id }';
test("count, locals, templates and CLI variable precedence produce stable instance addresses", () => {
  let s = ready(counted);
  s = write(s, "values.tfvars", "n = 3");
  s = write(s, "terraform.tfvars", "n = 1");
  s = write(s, "z.auto.tfvars", "n = 2");
  const planned = execute(s, "terraform plan -var-file=values.tfvars -var=n=4 -out=count-plan");
  expect(planned.world.terraform.resources).toHaveLength(0);
  expect(planned.world.terraform.plans["count-plan"]?.after).toHaveLength(4);
  const built = execute(roundtrip(planned), "terraform apply count-plan");
  expect(built.world.terraform.resources.map((r) => r.address)).toEqual(
    [0, 1, 2, 3].map((i) => `google_compute_network.net[${i}]`),
  );
  expect(built.world.networks.filter((n) => n.name.startsWith("tf-count"))).toHaveLength(4);
  expect(built.world.terraform.outputs.first).toContain("tf-count-1");
  expect(execute(built, "terraform plan -var=n=4").text).toContain("No resource changes");
  reject(built, "terraform apply count-plan -var=n=5", "Planning options");
  reject(built, "terraform plan -var=n=bad", "cannot reference");
});
test("for_each map keys preserve resource identity across insertion and value changes", () => {
  const source =
    'variable "names" { type = map(string) default = { blue = "tf-blue" green = "tf-green" } } resource "google_compute_network" "net" { for_each = var.names name = each.value auto_create_subnetworks = false } output "blue" { value = google_compute_network.net["blue"].name }';
  const s = execute(ready(source), "terraform apply -auto-approve");
  const before = s.world.networks;
  const again = execute(
    roundtrip(s),
    'terraform plan -var=\'names={ blue="tf-blue", green="tf-green", red="tf-red" }\' -out=more',
    "terraform apply more",
  );
  expect(again.world.terraform.resources.map((r) => r.address)).toContain(
    'google_compute_network.net["red"]',
  );
  expect(again.world.networks.filter((n) => before.some((b) => b.name === n.name))).toEqual(before);
  expect(again.world.terraform.outputs.blue).toBe("tf-blue");
  const formats = Hcl.format(Hcl.parse(source));
  expect(TfConfiguration.compile({ "main.tf": `${base} ${formats}` }).resources).toEqual(
    s.world.terraform.resources,
  );
});
test("toset iteration, explicit dependencies, and invalid/cyclic expressions are bounded", () => {
  const source =
    'resource "google_compute_network" "net" { for_each = toset(["tf-b", "tf-a", "tf-a"]) name = each.key auto_create_subnetworks = false } resource "google_storage_bucket" "asset" { name = "ace-dev-01-tf-dep" location = "US-CENTRAL1" depends_on = [google_compute_network.net] }';
  expect(
    execute(ready(source), "terraform apply -auto-approve").world.terraform.resources,
  ).toHaveLength(3);
  for (const bad of [
    'resource "google_compute_network" "net" { name = "x" auto_create_subnetworks = false count = 101 }',
    'resource "google_compute_network" "net" { name = "x" auto_create_subnetworks = false for_each = ["x"] }',
    'resource "google_compute_network" "net" { name = "x" auto_create_subnetworks = false depends_on = [google_compute_network.net] }',
    'output "bad" { value = 1 / 0 }',
    'locals { a = local.b b = local.a } output "bad" { value = local.a }',
    'output "bad" { value = file("/etc/passwd") }',
  ]) {
    expect(() => TfConfiguration.compile({ "main.tf": `${base} ${bad}` })).toThrow();
  }
});
test("provider constraints select an offline lock and incompatible edits require explicit upgrade", () => {
  const source =
    'terraform { required_version = ">= 1.0, < 2.0" required_providers { google = { source = "hashicorp/google" version = "~> 5.0" } } } resource "google_compute_network" "net" { name = "tf-version" auto_create_subnetworks = false }';
  const s = ready(source);
  expect(s.world.terraform.providerVersion).toBe("5.45.0");
  expect(s.world.terraform.files[".terraform.lock.hcl"]).toContain("5.45.0");
  const changed = execute(s, "sim files replace main.tf --search='~> 5.0' --replacement='~> 6.0'");
  reject(changed, "terraform plan", "init -upgrade");
  const upgraded = execute(changed, "terraform init -upgrade", "terraform apply -auto-approve");
  expect(upgraded.world.terraform.providerVersion).toBe("6.0.0");
  expect(roundtrip(upgraded).world).toEqual(upgraded.world);
  reject(
    execute(upgraded, "sim files replace main.tf --search='~> 6.0' --replacement='>= 100.0'"),
    "terraform init -upgrade",
    "No simulated",
  );
});
test("offline registry module, provider alias and module instance/moved paths share the World", () => {
  const source =
    'provider "google" { alias = "alt" project = "ace-dev-01" } module "vpc" { source = "terraform-google-modules/network/google" version = "~> 9.0" providers = { google = google.alt } for_each = { one = "tf-module-one" two = "tf-module-two" } project_id = "ace-dev-01" network_name = each.value } output "one" { value = module.vpc["one"].network_id }';
  const s = execute(ready(source), "terraform apply -auto-approve");
  expect(s.world.terraform.resources.map((r) => r.address)).toEqual([
    'module.vpc["one"].google_compute_network.network',
    'module.vpc["two"].google_compute_network.network',
  ]);
  const moved = write(
    s,
    "main.tf",
    `${base} ${source.replace('module "vpc"', 'module "renamed"').replace("value = module.vpc", "value = module.renamed")} moved { from = module.vpc["one"] to = module.renamed["one"] } moved { from = module.vpc["two"] to = module.renamed["two"] }`,
  );
  const planned = execute(moved, "terraform plan -out=move");
  expect(planned.world.terraform.plans.move?.moves).toHaveLength(2);
  expect(planned.world.terraform.plans.move?.changes).toHaveLength(0);
  expect(execute(roundtrip(planned), "terraform apply move").world.networks).toEqual(
    s.world.networks,
  );
});
test("auto VPC uses shared official subnet ranges and cleans generated subnets after VM removal", () => {
  const source =
    'resource "google_compute_network" "net" { name = "tf-auto" auto_create_subnetworks = true } resource "google_compute_instance" "vm" { count = 2 name = format("tf-auto-%d", count.index) zone = "us-central1-a" machine_type = "e2-micro" boot_disk { initialize_params { image = "debian-cloud/debian-12" } } network_interface { network = google_compute_network.net.id } }';
  const s = execute(ready(source), "terraform apply -auto-approve");
  expect(
    s.world.subnets.find((n) => n.network === "tf-auto" && n.region === "us-central1")?.ipCidrRange,
  ).toBe("10.128.0.0/20");
  expect(
    s.world.instances
      .filter((i) => i.name.startsWith("tf-auto-"))
      .map((i) => i.networkInterfaces[0]?.networkIP),
  ).toEqual(["10.128.0.2", "10.128.0.3"]);
  expect(execute(roundtrip(s), "terraform plan").text).toContain("No resource changes");
  const destroyed = execute(s, "terraform destroy -auto-approve");
  expect(destroyed.world.subnets.filter((n) => n.network === "tf-auto")).toHaveLength(0);
  expect(destroyed.world.networks).toEqual(initialWorld().networks);
});
test("sensitive output is masked in human views but state and explicit JSON retain the value", () => {
  const s = execute(
    ready(
      'variable "secret" { type = string default = "lesson-secret" sensitive = true } output "secret" { value = var.secret sensitive = true }',
    ),
    "terraform plan -out=secret",
    "terraform apply secret",
  );
  expect(s.text).not.toContain("lesson-secret");
  expect(execute(s, "terraform output").text).not.toContain("lesson-secret");
  expect(execute(s, "terraform show").text).not.toContain("lesson-secret");
  expect(execute(s, "terraform state pull").text).toContain("lesson-secret");
  expect(execute(s, "terraform show -json secret").text).toContain("lesson-secret");
  expect(
    execute(roundtrip(s), "terraform destroy -auto-approve").world.terraform.sensitiveOutputs,
  ).toEqual([]);
});
test("virtual state backup/push requires confirmation, preserves infrastructure and rejects bad JSON", () => {
  const s = execute(
    ready(
      'resource "google_compute_network" "net" { name = "tf-backup" auto_create_subnetworks = false }',
    ),
    "terraform apply -auto-approve",
    "sim terraform state save backup.tfstate",
    "terraform state rm google_compute_network.net",
  );
  const prompt = execute(s, "terraform state push backup.tfstate -force");
  expect(prompt.world).toEqual(s.world);
  expect(execute(prompt, "no").world).toEqual(s.world);
  const restored = execute(prompt, "yes", "terraform plan");
  expect(restored.world.networks).toEqual(s.world.networks);
  expect(restored.world.terraform.resources).toHaveLength(1);
  expect(restored.world.terraform.events.at(-1)?.kind).toBe("restore");
  expect(restored.text).toContain("No resource changes");
  const bad = write(restored, "bad.tfstate", '{"version":4,"resources":[]}');
  reject(bad, "terraform state push bad.tfstate -force", "Only this simulator");
  expect(roundtrip(restored).world).toEqual(restored.world);
});
test("known GCS generations restore state with a fresh serial, preserve World resources and stale plans", () => {
  const s = execute(
    ready(
      'resource "google_compute_network" "net" { name = "tf-history" auto_create_subnetworks = false }',
    ),
    "terraform apply -auto-approve",
    "gcloud storage buckets create gs://ace-dev-01-tf-state --location=us-central1 --uniform-bucket-level-access",
    "gcloud storage buckets update gs://ace-dev-01-tf-state --versioning",
    "sim files load terraform-backend",
    "terraform init -force-copy",
    "terraform state rm google_compute_network.net",
  );
  const oldSerial = s.world.terraform.serial;
  const prompt = execute(s, "sim terraform backend restore 1");
  expect(prompt.world).toEqual(s.world);
  expect(execute(prompt, "no").world).toEqual(s.world);
  const restored = execute(prompt, "yes", "terraform plan");
  expect(restored.world.networks).toEqual(s.world.networks);
  expect(restored.world.terraform.serial).toBe(oldSerial + 1);
  expect(restored.world.terraform.resources).toHaveLength(1);
  expect(restored.text).toContain("No resource changes");
  reject(restored, "sim terraform backend restore 999", "not found");
  expect(roundtrip(restored).world).toEqual(restored.world);
});
test("vet rejects public plans and malformed/stale JSON without applying or pretending to execute Rego", () => {
  const source =
    'resource "google_storage_bucket" "assets" { name = "ace-dev-01-tf-policy" location = "US-CENTRAL1" uniform_bucket_level_access = false }';
  let s = execute(
    ready(source),
    "terraform plan -out=reviewed",
    "sim terraform plan-json reviewed --out=reviewed.json",
  );
  s = write(
    s,
    "policies/policy.json",
    '{"allowedProjects":["ace-dev-01"],"allowedRegions":["us-central1"],"requirePrivateVm":true,"requireUniformBucket":true,"denyPublicIngress":true}',
  );
  reject(s, "gcloud beta terraform vet reviewed.json --policy-library=policies", "uniform bucket");
  const secure = execute(
    s,
    "sim files replace main.tf --search='uniform_bucket_level_access = false' --replacement='uniform_bucket_level_access = true'",
    "terraform plan -out=secure",
    "sim terraform plan-json secure --out=secure.json",
    "gcloud beta terraform vet secure.json --policy-library=policies",
  );
  expect(secure.world.buckets).toEqual(s.world.buckets);
  expect(secure.world.terraform.resources).toHaveLength(0);
  expect(secure.world.terraform.events.at(-1)?.kind).toBe("vet");
  const applied = execute(roundtrip(secure), "terraform apply secure");
  reject(applied, "gcloud beta terraform vet secure.json --policy-library=policies", "stale");
  reject(
    write(secure, "policies/policy.json", '{"rego":"evil"}'),
    "gcloud beta terraform vet secure.json --policy-library=policies",
    "Unsupported policy",
  );
});
