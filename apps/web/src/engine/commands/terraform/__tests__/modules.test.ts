// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { initialWorld, Now, run, type Session, session } from "@/engine/__tests__/setup";
import { TerraformModuleExample } from "@/engine/commands/terraform/examples";
import { TfConfiguration } from "@/engine/domains/terraform/configuration";
import { TfStructure } from "@/engine/domains/terraform/structure";
import { Mission } from "@/engine/missions";
import { terraformSatisfied } from "@/engine/missions/terraform";
import { Snapshot } from "@/engine/snapshot";
import { Result } from "@/utils/Result";

const execute = (start: Session, ...commands: string[]): Session =>
  commands.reduce((s, command) => {
    const next = run(s, command);
    expect(next.text, command).not.toContain("ERROR:");
    return next;
  }, start);
const base = (s = session()): Session =>
  execute(
    s,
    "sim files load terraform-network",
    "gcloud auth application-default login",
    "terraform init",
    "terraform apply -auto-approve",
  );
const moduleSetup = (s = session()): Session =>
  execute(
    s,
    "sim files load terraform-modules",
    "gcloud auth application-default login",
    "terraform init",
  );
const migratedPlan = (s = base()): Session =>
  execute(
    s,
    "sim files load terraform-modules --force",
    "terraform init",
    "terraform plan -out=migration",
  );
const restore = (s: Session): Session =>
  session(
    Result.unwrap(Snapshot.fromUnknown(JSON.parse(JSON.stringify(Snapshot.create(s.world, Now))))),
  );
const child = `variable "name" { type = string } resource "google_compute_network" "lab" { name = var.name auto_create_subnetworks = false } output "id" { value = google_compute_network.lab.id }`;
const provider = `provider "google" { project = "ace-dev-01" region = "us-central1" }`;

test("moved plans preserve cloud objects, survive snapshots, and apply only after confirmation", () => {
  const old = base();
  const planned = migratedPlan(old);
  expect(planned.text).toContain(
    "google_compute_network.lab has moved to module.network.google_compute_network.lab",
  );
  expect(planned.world.terraform.plans.migration?.changes).toEqual([]);
  expect(planned.world.terraform.plans.migration?.moves).toHaveLength(2);
  expect(planned.world.terraform.resources).toEqual(old.world.terraform.resources);
  expect(planned.world.networks).toEqual(old.world.networks);
  const prompt = execute(planned, "terraform apply");
  expect(prompt.shell.kind).toBe("confirming");
  expect(execute(prompt, "no").world).toEqual(planned.world);
  const applied = execute(restore(planned), "terraform apply migration");
  expect(applied.world.networks).toEqual(old.world.networks);
  expect(applied.world.subnets).toEqual(old.world.subnets);
  expect(applied.world.terraform.resources.map((r) => r.address)).toEqual([
    "module.network.google_compute_network.lab",
    "module.network.google_compute_subnetwork.lab",
  ]);
  expect(applied.world.terraform.outputs.network_id).toBe(old.world.terraform.outputs.network_id);
  expect(restore(applied).world).toEqual(applied.world);
  const again = execute(applied, "terraform plan -out=again");
  expect(again.world.terraform.plans.again?.moves).toEqual([]);
  expect(again.text).toContain("No resource changes");
  const destroyed = execute(again, "terraform destroy -auto-approve");
  expect(destroyed.world.networks).toEqual(initialWorld().networks);
  expect(destroyed.world.subnets).toEqual(initialWorld().subnets);
});

test("fresh module creation ignores absent moved sources; variables and bool outputs remain typed", () => {
  const s = execute(
    moduleSetup(),
    `sim files write terraform.tfvars --content='private_access = true subnet_cidr = "10.44.0.0/24"'`,
    "terraform plan -out=fresh",
  );
  expect(s.world.terraform.plans.fresh?.moves).toEqual([]);
  expect(s.world.terraform.plans.fresh?.changes).toHaveLength(2);
  const applied = execute(s, "terraform apply fresh");
  expect(applied.world.subnets.find((r) => r.name === "tf-lab-subnet")).toMatchObject({
    ipCidrRange: "10.44.0.0/24",
    privateIpGoogleAccess: true,
  });
  expect(applied.world.terraform.outputs.private_access).toBe("true");
  const typed = TfConfiguration.compile({
    "main.tf": `${provider} module "flag" { source = "./flag" } resource "google_compute_network" "n" { name = "typed-net" auto_create_subnetworks = module.flag.disabled }`,
    "flag/main.tf": 'output "disabled" { value = false }',
  });
  expect(typed.resources).toHaveLength(1);
});

test("same local source can be reused with isolated inputs and outputs", () => {
  const config = TfConfiguration.compile({
    "main.tf": `${provider} module "a" { source = "./modules/network" name = "net-a" } module "b" { source = "./modules/network" name = "net-b" } output "a" { value = module.a.id } output "b" { value = module.b.id }`,
    "modules/network/main.tf": child,
    "modules/network/terraform.tfvars": 'name = "must-not-leak"',
  });
  expect(config.resources.map((r) => [r.address, r.name, r.project])).toEqual([
    ["module.a.google_compute_network.lab", "net-a", "ace-dev-01"],
    ["module.b.google_compute_network.lab", "net-b", "ace-dev-01"],
  ]);
  expect(config.outputs.a).toContain("/net-a");
  expect(config.outputs.b).toContain("/net-b");
});

test("nested modules inherit the root provider and resolve sibling sources inside the workspace", () => {
  const config = TfConfiguration.compile({
    "main.tf": `${provider} module "outer" { source = "./modules/outer" } output "id" { value = module.outer.id }`,
    "modules/outer/main.tf":
      'module "inner" { source = "../network" name = "nested-net" } output "id" { value = module.inner.id }',
    "modules/network/main.tf": child,
  });
  expect(config.resources[0]?.address).toBe("module.outer.module.inner.google_compute_network.lab");
  expect(config.outputs.id).toBe("projects/ace-dev-01/global/networks/nested-net");
});

test("module outputs can drive root resources and sibling module inputs", () => {
  const config = TfConfiguration.compile({
    "main.tf": `${provider} module "network" { source = "./net" name = module.naming.name } module "naming" { source = "./naming" } resource "google_compute_subnetwork" "s" { name = "root-subnet" network = module.network.id ip_cidr_range = "10.50.0.0/24" }`,
    "net/main.tf": child,
    "naming/main.tf": 'output "name" { value = "from-module" }',
  });
  expect(config.resources.find((r) => r.type === "google_compute_subnetwork")?.network).toBe(
    "from-module",
  );
});

test("moved declarations chain independently of declaration order and still reflect real updates", () => {
  const s = execute(
    base(),
    `sim files replace main.tf --search='"google_compute_network" "lab"' --replacement='"google_compute_network" "new"'`,
    `sim files replace main.tf --search='network = google_compute_network.lab.id' --replacement='network = google_compute_network.new.id'`,
    `sim files replace main.tf --search='value = google_compute_network.lab.id' --replacement='value = google_compute_network.new.id'`,
    `sim files write moves.tf --content='moved { from = google_compute_network.middle to = google_compute_network.new } moved { from = google_compute_network.lab to = google_compute_network.middle }'`,
    "terraform plan -out=chain",
  );
  expect(s.world.terraform.plans.chain?.moves).toEqual([
    { from: "google_compute_network.lab", to: "google_compute_network.new" },
  ]);
  expect(s.world.terraform.plans.chain?.changes).toEqual([]);
  const moved = execute(s, "terraform apply chain");
  expect(
    moved.world.terraform.resources.some((r) => r.address === "google_compute_network.new"),
  ).toBe(true);
  const changed = execute(
    migratedPlan(),
    `sim files write terraform.tfvars --content='private_access = true'`,
    "terraform plan -out=changed",
  );
  expect(changed.world.terraform.plans.changed?.moves).toHaveLength(2);
  expect(changed.world.terraform.plans.changed?.changes.map((c) => c.action)).toEqual(["update"]);
});

test("without moved blocks, refactoring plans destruction and recreation", () => {
  const s = migratedPlan();
  const source = TerraformModuleExample["main.tf"].replace(/moved \{[^}]*\}\n/g, "");
  const without = execute(
    s,
    `sim files write main.tf --content='${source}'`,
    "terraform plan -out=replace",
  );
  expect(without.world.terraform.plans.replace?.changes.map((c) => c.action)).toEqual([
    "delete",
    "delete",
    "create",
    "create",
  ]);
});

test("state mv/import/rm accept module addresses and stale move plans are rejected", () => {
  const s = execute(
    moduleSetup(),
    "gcloud compute networks create tf-lab-vpc --subnet-mode=custom",
    "terraform import module.network.google_compute_network.lab projects/ace-dev-01/global/networks/tf-lab-vpc",
  );
  expect(
    execute(s, "terraform state show module.network.google_compute_network.lab").text,
  ).toContain("tf-lab-vpc");
  const moved = execute(
    s,
    "terraform state mv module.network.google_compute_network.lab module.other.google_compute_network.lab",
  );
  expect(moved.world.networks).toEqual(s.world.networks);
  expect(restore(moved).world).toEqual(moved.world);
  const removed = execute(moved, "terraform state rm module.other.google_compute_network.lab");
  expect(removed.world.networks).toEqual(s.world.networks);
  const planned = migratedPlan();
  const modified = execute(
    planned,
    "terraform state mv google_compute_network.lab google_compute_network.other",
  );
  expect(run(modified, "terraform apply migration").text).toContain("stale");
  const drifted = execute(
    planned,
    "gcloud compute networks subnets update tf-lab-subnet --region=us-central1 --enable-private-ip-google-access",
  );
  expect(run(drifted, "terraform apply migration").text).toContain("remote resources changed");
});

test("refresh-only observes module output values without changing cloud resources", () => {
  const s = execute(
    moduleSetup(),
    "terraform apply -auto-approve",
    "gcloud compute networks subnets update tf-lab-subnet --region=us-central1 --enable-private-ip-google-access",
  );
  const refreshed = execute(s, "terraform apply -refresh-only -auto-approve");
  expect(refreshed.world.subnets).toEqual(s.world.subnets);
  expect(refreshed.world.terraform.outputs.private_access).toBe("true");
  expect(execute(refreshed, "terraform plan").text).toContain("1 to change");
});

test.each([
  ['module "x" { source = "hashicorp/network/google" }', {}, "Only local"],
  ['module "x" { source = "../outside" }', {}, "escapes"],
  ['module "x" { source = "./absent" }', {}, "no .tf"],
  ['module "x" { source = "./" }', {}, "Invalid local"],
  [
    'module "x" { source = "./modules/x" }',
    { "modules/x/main.tf": 'module "again" { source = "../x" }' },
    "Recursive",
  ],
  ['module "x" { source = "./x" }', { "x/main.tf": child }, "Missing literal value"],
  ['module "x" { source = "./x" name = 1 }', { "x/main.tf": child }, "Wrong type"],
  [
    'module "x" { source = "./x" name = "net" extra = true }',
    { "x/main.tf": child },
    "Undeclared variable",
  ],
  ['module "x" { source = "./x" count = 2 }', { "x/main.tf": "" }, "meta-argument"],
  ['module "x" { source = "./x" }', { "x/main.tf": provider }, "Child provider"],
  [
    'module "x" { source = "./x" } output "bad" { value = module.x.absent }',
    { "x/main.tf": "" },
    "Unknown module output",
  ],
  [
    'module "x" { source = "./x" } output "bad" { value = module.x.constructor }',
    { "x/main.tf": "" },
    "Unknown module output",
  ],
  ['module "x" { source = "./x" name = module.x.id }', { "x/main.tf": child }, "Dependency cycle"],
  [
    'module "x" { source = "./x" }',
    { "x/main.tf": 'output "bad" { value = var.project_id }' },
    "Unknown variable",
  ],
])("invalid modules fail without writing state: %s", (root, children, message) => {
  const files = { "main.tf": `${provider} ${root}`, ...children };
  expect(() => TfConfiguration.compile(files)).toThrow(message);
  const world = { ...initialWorld(), terraform: { ...initialWorld().terraform, files } };
  const result = run(session(world), "terraform init");
  expect(result.text).toContain("ERROR:");
  expect(result.world).toEqual(world);
});

test("moved rejects occupied destinations, cycles, ambiguous mappings, type changes and missing configuration", () => {
  expect(() =>
    TfStructure.remap(
      [{ address: "google_compute_network.a" }, { address: "google_compute_network.b" }],
      [{ from: "google_compute_network.a", to: "google_compute_network.b" }],
    ),
  ).toThrow("already exists");
  for (const moves of [
    [
      { from: "google_compute_network.a", to: "google_compute_network.b" },
      { from: "google_compute_network.b", to: "google_compute_network.a" },
    ],
    [
      { from: "google_compute_network.a", to: "google_compute_network.c" },
      { from: "google_compute_network.b", to: "google_compute_network.c" },
    ],
    [{ from: "google_compute_network.a", to: "google_compute_subnetwork.a" }],
  ])
    expect(() => TfStructure.validateMoves(moves)).toThrow();
  expect(() =>
    TfConfiguration.compile({
      "main.tf": "moved { from = google_compute_network.a to = google_compute_network.b }",
    }),
  ).toThrow("not declared");
  expect(() =>
    TfConfiguration.compile({
      "main.tf": 'moved { from = "google_compute_network.a" to = google_compute_network.b }',
    }),
  ).toThrow("unquoted");
});

test("module recursion and instance limits bound expansion; unsafe files never enter snapshots", () => {
  const files: Record<string, string> = { "main.tf": 'module "next" { source = "./m" }' };
  for (let n = 1; n <= 5; n++)
    files[`${Array(n).fill("m").join("/")}/main.tf`] =
      n === 5 ? "" : 'module "next" { source = "./m" }';
  expect(() => TfConfiguration.compile(files)).toThrow("Module limit");
  expect(() =>
    TfConfiguration.compile({
      "main.tf": Array.from({ length: 33 }, (_, i) => `module "m${i}" { source = "./m" }`).join(
        " ",
      ),
      "m/main.tf": "",
    }),
  ).toThrow("Module limit");
  for (const path of [
    "../bad.tf",
    "modules/../bad.tf",
    "/bad.tf",
    "modules//bad.tf",
    "constructor/bad.tf",
  ]) {
    expect(run(session(), `sim files write ${path} --content=x`).text).toContain("ERROR:");
    const world = initialWorld();
    expect(
      Result.isOk(
        Snapshot.fromUnknown(
          Snapshot.create(
            { ...world, terraform: { ...world.terraform, files: { [path]: "x" } } },
            Now,
          ),
        ),
      ),
    ).toBe(false);
  }
});

test("v4 files, managed state and saved plans migrate without losing the reviewed plan", () => {
  const old = execute(base(), "terraform plan -out=old");
  const plans = Object.fromEntries(
    Object.entries(old.world.terraform.plans).map(([key, { moves: _moves, ...plan }]) => [
      key,
      plan,
    ]),
  );
  const migrated = Result.unwrap(
    Snapshot.fromUnknown({
      schemaVersion: 4,
      exportedAt: Now,
      world: { ...old.world, terraform: { ...old.world.terraform, plans } },
    }),
  );
  expect(migrated.terraform.files).toEqual(old.world.terraform.files);
  expect(migrated.terraform.resources).toEqual(old.world.terraform.resources);
  expect(migrated.terraform.plans.old?.moves).toEqual([]);
  expect(execute(session(migrated), "terraform apply old").world.networks).toEqual(
    old.world.networks,
  );
});

test("module file loading is atomic and recursive fmt only changes requested paths", () => {
  const existing = execute(
    session(),
    `sim files write modules/network/main.tf --content='output "x"{value=true}'`,
  );
  const rejected = run(existing, "sim files load terraform-modules");
  expect(rejected.text).toContain("already exists");
  expect(rejected.world).toEqual(existing.world);
  const rootOnly = execute(existing, "terraform fmt -check");
  expect(rootOnly.world.terraform.files).toEqual(existing.world.terraform.files);
  expect(run(existing, "terraform fmt -recursive -check").text).toContain("need formatting");
  const formatted = execute(
    existing,
    "terraform fmt -recursive",
    "terraform fmt -recursive -check",
  );
  expect(formatted.world.terraform.files["modules/network/main.tf"]).toContain("  value = true");
  const loaded = execute(formatted, "sim files load terraform-modules --force");
  expect(loaded.world.terraform.files).toEqual(TerraformModuleExample);
});

test("moves declared inside a child module are relative to that module", () => {
  const config = TfConfiguration.compile({
    "main.tf": `${provider} module "network" { source = "./net" name = "child-move" }`,
    "net/main.tf": `${child} moved { from = google_compute_network.old to = google_compute_network.lab }`,
  });
  expect(config.moves).toEqual([
    {
      from: "module.network.google_compute_network.old",
      to: "module.network.google_compute_network.lab",
    },
  ]);
});

test("migration mission requires a saved non-destructive move and is independently solvable", () => {
  const mission = Mission.all().find((m) => m.id === "m-terraform-004");
  if (!mission) throw new Error("Missing module mission");
  const start = session(Result.unwrap(Mission.start(initialWorld(), mission)));
  expect(Mission.evaluate(start.world).completed).toEqual([]);
  const fresh = execute(moduleSetup(start), "terraform apply -auto-approve");
  expect(fresh.world.missions.find((m) => m.id === mission.id)?.status).toBe("in_progress");
  const planned = migratedPlan(base(start));
  expect(planned.world.missions.find((m) => m.id === mission.id)?.status).toBe("in_progress");
  const applied = execute(planned, "terraform apply migration");
  expect(applied.world.missions.find((m) => m.id === mission.id)?.status).toBe("completed");
  for (const assertion of mission.assertions) {
    if (assertion.kind !== "terraformMoved") continue;
    expect(terraformSatisfied(applied.world, assertion)).toBe(true);
    expect(
      terraformSatisfied(
        { ...applied.world, terraform: { ...applied.world.terraform, plans: {} } },
        assertion,
      ),
    ).toBe(false);
  }
  expect(Engine.completionCandidates(applied.world, "terraform state show module.net")).toContain(
    "module.network.google_compute_network.lab",
  );
  expect(Engine.completionCandidates(applied.world, "sim files read modules/net")).toContain(
    "modules/network/main.tf",
  );
});
