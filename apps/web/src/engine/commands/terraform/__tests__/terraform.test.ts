// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { initialWorld, Now, run, type Session, session } from "@/engine/__tests__/setup";
import { TerraformNetworkExample } from "@/engine/commands/terraform";
import { TerraformState } from "@/engine/domains/terraform";
import { TfConfiguration } from "@/engine/domains/terraform/configuration";
import { Hcl } from "@/engine/domains/terraform/hcl";
import { World } from "@/engine/domains/world";
import { Mission } from "@/engine/missions";
import { terraformSatisfied } from "@/engine/missions/terraform";
import { TreeNode } from "@/engine/resource-tree";
import { Snapshot } from "@/engine/snapshot";
import { Result } from "@/utils/Result";

const execute = (start: Session, ...commands: string[]): Session =>
  commands.reduce((current, command) => {
    const next = run(current, command);
    expect(next.text, command).not.toContain("ERROR:");
    return next;
  }, start);
const ready = (start = session()): Session =>
  execute(
    start,
    "sim files load terraform-network",
    "gcloud auth application-default login",
    "terraform init",
  );
const built = (): Session => execute(ready(), "terraform apply -auto-approve");
const edit =
  "sim files replace main.tf --search='private_ip_google_access = false' --replacement='private_ip_google_access = true'";
const drift =
  "gcloud compute networks subnets update tf-lab-subnet --region=us-central1 --enable-private-ip-google-access";
const importFile = `sim files write import.tf --content='resource "google_compute_network" "imported" { project = "ace-dev-01" name = "tf-import-net" auto_create_subnetworks = false }'`;

test("plan is read-only, saved plans apply once, and apply is idempotent", () => {
  const s = ready();
  const planned = execute(s, "terraform validate", "terraform plan");
  expect(planned.world).toEqual(s.world);
  expect(planned.text).toContain("2 to add");
  const saved = execute(planned, "terraform plan -out=tfplan", "terraform show tfplan");
  expect(saved.world.terraform.resources).toHaveLength(0);
  const applied = execute(saved, "terraform apply tfplan");
  expect(applied.shell.kind).toBe("ready");
  expect(applied.world.terraform.resources).toHaveLength(2);
  expect(applied.world.networks.some((n) => n.name === "tf-lab-vpc")).toBe(true);
  expect(Result.isOk(World.validate(applied.world))).toBe(true);
  const again = execute(applied, "terraform plan", "terraform apply -auto-approve");
  expect(again.text).toContain("No resource changes");
  expect(again.world.networks).toEqual(applied.world.networks);
  expect(again.world.subnets).toEqual(applied.world.subnets);
  expect(run(again, "terraform apply tfplan").text).toContain("stale");
  expect(execute(again, "terraform output network_id").text).toContain(
    "projects/ace-dev-01/global/networks/tf-lab-vpc",
  );
  expect(JSON.stringify(TreeNode.fromWorld(applied.world))).toContain("tf-lab-vpc");
});

test("interactive apply previews, requires yes, and cancellation changes nothing", () => {
  const s = ready();
  const prompt = execute(s, "terraform apply");
  expect(prompt.shell.kind).toBe("confirming");
  expect(prompt.text).toContain("2 to add");
  expect(prompt.world).toEqual(s.world);
  expect(run(prompt, "y").shell.kind).toBe("confirming");
  expect(execute(prompt, "no").world).toEqual(s.world);
  expect(execute(prompt, "").world).toEqual(s.world);
  const applied = execute(prompt, "yes");
  expect(applied.world.terraform.resources).toHaveLength(2);
  const destroy = execute(applied, "terraform destroy");
  expect(destroy.text).toContain("2 to destroy");
  const cleared = execute(destroy, "yes");
  expect(cleared.world.terraform.resources).toEqual([]);
  expect(cleared.world.networks).toEqual(s.world.networks);
  expect(cleared.world.subnets).toEqual(s.world.subnets);
  expect(cleared.world.terraform.outputs).toEqual({});
});

test("variables, references and in-place access changes update shared resources", () => {
  const s = execute(built(), edit, "terraform plan");
  expect(s.text).toContain("0 to add, 1 to change, 0 to destroy");
  const changed = execute(s, "terraform apply -auto-approve");
  expect(changed.world.subnets.find((n) => n.name === "tf-lab-subnet")?.privateIpGoogleAccess).toBe(
    true,
  );
  const range = execute(
    changed,
    `sim files write terraform.tfvars --content='subnet_cidr = "10.43.0.0/24"'`,
    "terraform plan",
  );
  expect(range.text).toContain("1 to add, 0 to change, 1 to destroy");
  const applied = execute(range, "terraform apply -auto-approve");
  expect(applied.world.subnets.find((n) => n.name === "tf-lab-subnet")?.ipCidrRange).toBe(
    "10.43.0.0/24",
  );
});

test("drift detection, refresh-only, and stale saved plans distinguish state from reality", () => {
  const s = execute(
    built(),
    `sim files write outputs.tf --content='output "access" { value = google_compute_subnetwork.lab.private_ip_google_access }'`,
    "terraform apply -auto-approve",
    "terraform plan -out=before",
  );
  const changed = execute(s, drift);
  const rejected = run(changed, "terraform apply before");
  expect(rejected.text).toContain("remote resources changed");
  expect(rejected.world).toEqual(changed.world);
  const planned = execute(changed, "terraform plan");
  expect(planned.text).toContain("1 to change");
  const refreshPlan = execute(planned, "terraform plan -refresh-only -out=refresh");
  expect(
    refreshPlan.world.terraform.resources.find((r) => r.type === "google_compute_subnetwork")
      ?.privateAccess,
  ).toBe(false);
  const refreshed = execute(refreshPlan, "terraform apply refresh");
  expect(refreshed.world.subnets).toEqual(changed.world.subnets);
  expect(
    refreshed.world.terraform.resources.find((r) => r.type === "google_compute_subnetwork")
      ?.privateAccess,
  ).toBe(true);
  expect(refreshed.world.terraform.outputs.access).toBe("true");
  const repaired = execute(refreshed, "terraform apply -auto-approve");
  expect(
    repaired.world.subnets.find((n) => n.name === "tf-lab-subnet")?.privateIpGoogleAccess,
  ).toBe(false);
});

test("saved plan preserves the reviewed configuration even after file edits", () => {
  const s = execute(ready(), "terraform plan -out=tfplan", edit, "terraform apply tfplan");
  expect(s.world.subnets.find((n) => n.name === "tf-lab-subnet")?.privateIpGoogleAccess).toBe(
    false,
  );
  expect(execute(s, "terraform plan").text).toContain("1 to change");
});

test("import does not create resources, refuses duplicates, rm preserves cloud, mv changes address", () => {
  const s = execute(
    session(),
    importFile,
    "gcloud auth application-default login",
    "terraform init",
  );
  const command =
    "terraform import google_compute_network.imported projects/ace-dev-01/global/networks/tf-import-net";
  expect(run(s, command).text).toContain("Remote resource not found");
  const existing = execute(s, "gcloud compute networks create tf-import-net --subnet-mode=custom");
  expect(run(existing, "terraform plan").text).toContain("Use terraform import");
  const imported = execute(existing, command);
  expect(imported.world.networks).toEqual(existing.world.networks);
  expect(run(imported, command).text).toContain("already managed");
  const moved = execute(
    imported,
    "terraform state mv google_compute_network.imported google_compute_network.renamed",
    `sim files replace import.tf --search='"imported"' --replacement='"renamed"'`,
    "terraform plan",
  );
  expect(moved.text).toContain("No resource changes");
  const removed = execute(moved, "terraform state rm google_compute_network.renamed");
  expect(removed.world.terraform.resources).toEqual([]);
  expect(removed.world.networks).toEqual(existing.world.networks);
  expect(run(removed, "terraform plan").text).toContain("Use terraform import");
});

test("ADC and API/project permissions are enforced and failed apply is atomic", () => {
  const s = execute(session(), "sim files load terraform-network", "terraform init");
  expect(run(s, "terraform plan").text).toContain("Application Default Credentials");
  const viewer = execute(
    s,
    "gcloud auth login developer@example.com",
    "gcloud auth application-default login",
    "gcloud auth login owner@example.com",
  );
  const result = run(viewer, "terraform apply -auto-approve");
  expect(result.text).toContain("Permission denied");
  expect(result.world).toEqual(viewer.world);
  const other = execute(
    ready(),
    `sim files write terraform.tfvars --content='project_id = "ace-prod-01"'`,
  );
  expect(run(other, "terraform plan").text).toContain("compute.googleapis.com is disabled");
  const missing = execute(
    other,
    `sim files write terraform.tfvars --content='project_id = "absent-project"'`,
  );
  expect(run(missing, "terraform plan").text).toContain("Project not found");
});

test("external dependencies block destroy without a partial deletion", () => {
  const s = execute(
    built(),
    "gcloud compute firewall-rules create extra --network=tf-lab-vpc --allow=tcp:22",
  );
  const result = run(s, "terraform destroy -auto-approve");
  expect(result.text).toContain("still in use");
  expect(result.world).toEqual(s.world);
});

test.each([
  'resource "google_compute_instance" "vm" { name = "vm" }',
  'module "network" { source = "./modules/network" }',
  'terraform { backend "s3" { bucket = "state" } }',
  'provider "google" { alias = "other" project = "ace-dev-01" }',
  'resource "google_compute_network" "net" { project = "ace-dev-01" name = "net" auto_create_subnetworks = false count = 2 }',
  'output "bad" { value = file("secrets") }',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal HCL template must be rejected
  'output "bad" { value = "${var.secret}" }',
  'variable "constructor" { type = string default = "bad" }',
  'output "bad" { value = missing.resource.id }',
  'resource "google_compute_network" "a" { name = google_compute_network.b.name project = "ace-dev-01" auto_create_subnetworks = false } resource "google_compute_network" "b" { name = google_compute_network.a.name project = "ace-dev-01" auto_create_subnetworks = false }',
])("unsupported or invalid HCL is rejected: %s", (source) => {
  expect(() => TfConfiguration.compile({ "main.tf": source })).toThrow();
  const s = execute(session(), `sim files write main.tf --content='${source}'`);
  const result = run(s, "terraform init");
  expect(result.text).toContain("ERROR:");
  expect(result.world).toEqual(s.world);
});

test("wrong variable type, CIDR, overlapping subnets and modes are rejected", () => {
  const s = ready();
  for (const value of [
    "subnet_cidr = 42",
    'subnet_cidr = "999.0.0.0/24"',
    'subnet_cidr = "10.42.0.1/24"',
    "missing = true",
  ]) {
    const edited = execute(s, `sim files write terraform.tfvars --content='${value}'`);
    expect(run(edited, "terraform plan").text).toContain("ERROR:");
  }
  expect(run(s, "terraform plan -destroy -refresh-only").text).toContain("mutually exclusive");
  const collision = execute(
    built(),
    `sim files write extra.tf --content='resource "google_compute_subnetwork" "other" { project = "ace-dev-01" name = "other" region = "us-central1" network = "tf-lab-vpc" ip_cidr_range = "10.42.0.0/24" }'`,
  );
  const result = run(collision, "terraform apply -auto-approve");
  expect(result.text).toContain("Overlapping");
  expect(result.world).toEqual(collision.world);
});

test("formatting is stable, check does not write, and virtual paths cannot escape", () => {
  const source = 'provider "google"{project="ace-dev-01" region="us-central1"}';
  expect(Hcl.parse(Hcl.format(Hcl.parse(source)))).toEqual(Hcl.parse(source));
  const s = execute(session(), `sim files write main.tf --content='${source}'`);
  expect(run(s, "terraform fmt -check").world).toEqual(s.world);
  const formatted = execute(s, "terraform fmt", "terraform fmt -check", "sim files read main.tf");
  expect(formatted.text).toContain('  project = "ace-dev-01"');
  expect(run(s, "sim files write ../main.tf --content=x").text).toContain("no paths");
  expect(run(s, "sim files replace main.tf --search=absent --replacement=x").world).toEqual(
    s.world,
  );
});

test("saved files, plans and state survive snapshots; v1/v2/v3 migrate and malformed state fails", () => {
  const s = execute(ready(), "terraform plan -out=tfplan");
  const restored = Result.unwrap(
    Snapshot.fromUnknown(JSON.parse(JSON.stringify(Snapshot.create(s.world, Now)))),
  );
  expect(restored).toEqual(s.world);
  const applied = execute(session(restored), "terraform apply tfplan");
  expect(
    Result.unwrap(
      Snapshot.fromUnknown(JSON.parse(JSON.stringify(Snapshot.create(applied.world, Now)))),
    ),
  ).toEqual(applied.world);
  for (const version of [1, 2, 3]) {
    const { terraform: _terraform, ...legacy } = initialWorld();
    const migrated = Result.unwrap(
      Snapshot.fromUnknown({ schemaVersion: version, exportedAt: Now, world: legacy }),
    );
    expect(migrated.terraform).toEqual(TerraformState.empty());
  }
  for (const patch of [
    { serial: -1 },
    { resources: [...applied.world.terraform.resources, ...applied.world.terraform.resources] },
    { files: { "../outside.tf": "bad" } },
  ]) {
    const snapshot = Snapshot.create(
      { ...applied.world, terraform: { ...applied.world.terraform, ...patch } },
      Now,
    );
    expect(Result.isOk(Snapshot.fromUnknown(snapshot))).toBe(false);
  }
});

test.each(["m-terraform-001", "m-terraform-002", "m-terraform-003"])(
  "mission %s is independently solvable and rejects incomplete/wrong state",
  (id) => {
    const mission = Mission.all().find((m) => m.id === id);
    if (!mission) throw new Error("Missing mission");
    let s = session(Result.unwrap(Mission.start(initialWorld(), mission)));
    expect(Mission.evaluate(s.world).completed).toEqual([]);
    if (id === "m-terraform-003")
      s = execute(
        s,
        importFile,
        "gcloud auth application-default login",
        "terraform init",
        "gcloud compute networks create tf-import-net --subnet-mode=custom",
      );
    else s = ready(s);
    expect(Mission.evaluate(s.world).completed).toEqual([]);
    if (id === "m-terraform-002")
      s = execute(
        s,
        edit,
        `sim files write terraform.tfvars --content='subnet_cidr = "10.43.0.0/24"'`,
      );
    s = execute(
      s,
      id === "m-terraform-003"
        ? "terraform import google_compute_network.imported projects/ace-dev-01/global/networks/tf-import-net"
        : "terraform apply -auto-approve",
    );
    expect(s.world.missions.find((m) => m.id === id)?.status).toBe("completed");
    for (const assertion of mission.assertions) {
      if (assertion.kind !== "terraformManaged") continue;
      expect(terraformSatisfied(s.world, assertion)).toBe(true);
      expect(
        terraformSatisfied(
          { ...s.world, terraform: { ...s.world.terraform, resources: [] } },
          assertion,
        ),
      ).toBe(false);
      expect(
        terraformSatisfied(
          {
            ...s.world,
            terraform: {
              ...s.world.terraform,
              files: { "main.tf": TerraformNetworkExample.replace('"tf-lab-vpc"', '"wrong-vpc"') },
            },
          },
          assertion,
        ),
      ).toBe(false);
    }
  },
);

test("new commands expose help and completion", () => {
  expect(run(session(), "terraform plan --help").text).toContain("-out");
  expect(Engine.registry.specs.some((s) => s.path.join(" ") === "sim files replace")).toBe(true);
  expect(Engine.completionCandidates(initialWorld(), "terraform plan -o")).toContain("-out");
  expect(Engine.completionCandidates(initialWorld(), "terraform plan --pro")).toEqual([]);
  expect(run(session(), "terraform plan --project=ace-prod-01").text).toContain("unrecognized");
  const s = built();
  expect(Engine.completionCandidates(s.world, "terraform state show google_compute_sub")).toContain(
    "google_compute_subnetwork.lab",
  );
  expect(Engine.completionCandidates(s.world, "sim files read ma")).toContain("main.tf");
});
