// @vitest-environment node
import { expect, test } from "vitest";
import { Now, run, type Session, session } from "@/engine/__tests__/setup";
import { TfConfiguration } from "@/engine/domains/terraform/configuration";
import {
  TerraformLessonSteps,
  terraformLessonSatisfied,
} from "@/engine/missions/terraform-lessons";
import { Snapshot } from "@/engine/snapshot";
import { Result } from "@/utils/Result";

const execute = (s: Session, ...commands: string[]) =>
  commands.reduce((current, command) => {
    const next = run(current, command);
    expect(next.text, command).not.toContain("ERROR:");
    return next;
  }, s);
test("sensitive values cannot leak through iteration/provider or cached locals", () => {
  for (const source of [
    'variable "names" { type=map(string) default={ hidden="tf-hidden" } sensitive=true } resource "google_compute_network" "net" { project="ace-dev-01" for_each=var.names name=each.value auto_create_subnetworks=false }',
    'variable "secret" {type=string default="ace-dev-01" sensitive=true} provider "google" {project=var.secret} resource "google_compute_network" "net" {name="tf-secret" auto_create_subnetworks=false}',
    'variable "secret" {type=string default="hidden" sensitive=true} locals {cached=var.secret} output "masked" {value=local.cached sensitive=true} output "leaked" {value=local.cached}',
  ]) {
    expect(() => TfConfiguration.compile({ "main.tf": source })).toThrow(/sensitive/i);
  }
  expect(() =>
    TfConfiguration.compile({
      "main.tf":
        'variable "numbers" {type=set(number) default=[1,2]} output "n" {value=var.numbers}',
    }),
  ).toThrow("set(string)");
});
test("module dependencies order child resources after the referenced root firewall", () => {
  const files = {
    "main.tf":
      'provider "google" {project="ace-dev-01"} resource "google_compute_firewall" "gate" {name="tf-gate" network="default" source_ranges=["10.0.0.0/8"] allow {protocol="icmp"}} module "network" {source="./modules/network" depends_on=[google_compute_firewall.gate]}',
    "modules/network/main.tf":
      'resource "google_compute_network" "net" {name="tf-dependency" auto_create_subnetworks=false}',
  };
  let s = session();
  for (const [file, text] of Object.entries(files)) {
    s = execute(s, `sim files write ${file} --content='${text}'`);
  }
  s = execute(
    s,
    "gcloud auth application-default login",
    "terraform init",
    "terraform plan -out=ordered",
  );
  expect(s.world.terraform.plans.ordered?.changes.map((c) => c.resource.address)).toEqual([
    "google_compute_firewall.gate",
    "module.network.google_compute_network.net",
  ]);
  expect(execute(s, "terraform apply ordered").world.terraform.resources).toHaveLength(2);
});
test("refresh-only evaluates the same CLI variable values as normal planning", () => {
  const source = 'variable "n" {type=number default=2} output "n" {value=var.n}';
  const s = execute(
    session(),
    `sim files write main.tf --content='${source}'`,
    "gcloud auth application-default login",
    "terraform init",
    "terraform apply -var=n=4 -auto-approve",
    "terraform plan -refresh-only -var=n=4 -out=refresh",
    "terraform apply refresh",
  );
  expect(s.world.terraform.outputs.n).toBe("4");
});
test("reusing nested locals retains inferred dependency edges for every consumer", () => {
  const source =
    'provider "google" {project="ace-dev-01"} locals { prefix=google_compute_network.z.name cached=local.prefix } resource "google_compute_network" "z" {name="tf-local" auto_create_subnetworks=false} resource "google_compute_network" "a" {name=format("%s-a",local.cached) auto_create_subnetworks=false} resource "google_compute_network" "b" {name=format("%s-b",local.cached) auto_create_subnetworks=false}';
  const config = TfConfiguration.compile({ "main.tf": source });
  expect(config.dependencies["google_compute_network.a"]).toContain("google_compute_network.z");
  expect(config.dependencies["google_compute_network.b"]).toContain("google_compute_network.z");
  const s = execute(
    session(),
    `sim files write main.tf --content='${source}'`,
    "gcloud auth application-default login",
    "terraform init",
    "terraform plan -out=local-plan",
  );
  expect(s.world.terraform.plans["local-plan"]?.changes[0]?.resource.address).toBe(
    "google_compute_network.z",
  );
});
test("init refuses a lock file that would exceed virtual-file limits without changing World", () => {
  let s = execute(session(), "gcloud auth application-default login");
  for (let i = 0; i < 32; i++) {
    s = execute(s, `sim files write empty${i}.tf --content=''`);
  }
  const result = run(s, "terraform init");
  expect(result.text).toContain("32 files");
  expect(result.world).toEqual(s.world);
  expect(Result.isOk(Snapshot.fromUnknown(Snapshot.create(s.world, Now)))).toBe(true);
});
test("invalid persisted sensitive names and dependency addresses cannot produce unsaveable state", () => {
  const s = execute(session(), ...TerraformLessonSteps.sensitive.slice(0, 4));
  const plan = s.world.terraform.plans["sensitive-plan"];
  if (!plan) {
    throw new Error("Missing plan");
  }
  for (const changed of [
    { ...plan, sensitiveOutputs: ["absent"] },
    { ...plan, dependencies: { invalid: ["bad"] } },
  ]) {
    const world = {
      ...s.world,
      terraform: { ...s.world.terraform, plans: { malformed: changed } },
    };
    expect(Result.isOk(Snapshot.fromUnknown(Snapshot.create(world, Now)))).toBe(false);
  }
});
test("a policy mission requires vetting the same plan that was applied", () => {
  const s = execute(session(), ...TerraformLessonSteps.policy.slice(0, 6));
  const other = execute(
    s,
    "sim files replace main.tf --search='ace-dev-01-tf-policy' --replacement='ace-dev-01-tf-other'",
    "terraform plan -out=other",
    "sim terraform plan-json other --out=secure.json",
    "gcloud beta terraform vet secure.json --policy-library=policies",
    "terraform apply secure-plan",
  );
  expect(terraformLessonSatisfied(other.world, { kind: "terraformLesson", lesson: "policy" })).toBe(
    false,
  );
});
test("generation recovery rejects a previously saved plan even when infrastructure is unchanged", () => {
  const s = execute(
    session(),
    ...TerraformLessonSteps.restore.slice(0, 9),
    "terraform plan -out=before-restore",
  );
  const restored = execute(
    s,
    "terraform state rm google_compute_subnetwork.lab",
    "sim terraform backend restore 1",
    "yes",
  );
  const result = run(restored, "terraform apply before-restore");
  expect(result.text).toContain("stale");
  expect(result.world).toEqual(restored.world);
});
