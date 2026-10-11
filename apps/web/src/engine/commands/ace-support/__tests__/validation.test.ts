// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { Now, run, type Session, session } from "@/engine/__tests__/setup";
import { CommandRegistry } from "@/engine/cli/registry";
import { AllCommands } from "@/engine/commands";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import { AiMissions, aceSatisfied, aiSolutions } from "@/engine/missions/ace-support";
import { SchemaVersion, Snapshot } from "@/engine/snapshot";

const deny = (s: Session, line: string, reason = "ERROR:") => {
  const next = run(s, line);
  expect(next.text, line).toContain(reason);
  expect(next.world).toEqual(s.world);
};
const configured = () => run(session(), ...aiSolutions("notebook").slice(0, 7));
const target = "ace-notebook --region=us-central1";
const satisfied = (s: Session) => aceSatisfied(s.world, { kind: "aiLesson", lesson: "notebook" });
const execute = (s: Session, ...lines: readonly string[]) =>
  lines.reduce((current, line) => {
    const next = run(current, line);
    expect(next.text, line).not.toContain("ERROR:");
    return next;
  }, s);
const roundtrip = (s: Session) => {
  const imported = Snapshot.fromUnknown(Snapshot.create(s.world, Now));
  if (!imported.ok) {
    throw new Error(JSON.stringify(imported.error));
  }
  expect(imported.value).toEqual(s.world);
  return session(imported.value);
};
test("unsupported fields, wrong kind/region/project/SA, API and idle setting are rejected atomically", () => {
  const steps = aiSolutions("notebook");
  const ready = run(session(), ...steps.slice(0, 6));
  const create = steps[6] as string;
  for (const line of [
    create.replace("--kind=notebook", "--kind=agent"),
    create.replace("--region=us-central1", "--region=asia-northeast1"),
    create.replace(
      "--service-account=ace-notebook@ace-dev-01.iam.gserviceaccount.com",
      "--service-account=missing@ace-dev-01.iam.gserviceaccount.com",
    ),
    `${create} --model=remote`,
    `${create} --cluster=gke`,
    create.replace("--idle-minutes=60", "--idle-minutes=0"),
    `${create} --project=ace-prod-01`,
  ]) {
    deny(ready, line);
  }
  const disabled = run(ready, "gcloud services disable notebooks.googleapis.com");
  expect(disabled.text).not.toContain("ERROR:");
  deny(disabled, create);
});
test("actAs, role, current configuration and private access are checked before lifecycle mutations", () => {
  const s = configured();
  expect(s.world.aceSupport.resources).toHaveLength(1);
  deny(s, `sim ai resources start ${target} --account=${F.developer}`, "notebooks.instances.start");
  const sa = `ace-notebook@${F.devProjectId}.iam.gserviceaccount.com`;
  const noActAs = run(
    s,
    `gcloud iam service-accounts remove-iam-policy-binding ${sa} --member=user:${F.owner} --role=roles/iam.serviceAccountUser`,
  );
  deny(noActAs, `sim ai resources start ${target}`, "iam.serviceAccounts.actAs");
  const running = run(s, `sim ai resources start ${target}`);
  deny(running, `sim ai resources update ${target} --access=private`);
  deny(running, `sim ai resources delete ${target} --quiet`);
  deny(running, `sim ai resources start ${target}`);
  const stopped = run(running, `sim ai resources stop ${target}`);
  deny(stopped, `sim ai resources stop ${target}`);
  const privateConfig = run(stopped, `sim ai resources update ${target} --access=private`);
  const off = run(
    privateConfig,
    "gcloud compute networks subnets update ace-notebook-subnet --region=us-central1 --no-enable-private-ip-google-access",
  );
  expect(off.text).not.toContain("ERROR:");
  deny(off, `sim ai resources start ${target}`, "Private Google Access");
  const deleted = run(stopped, `sim ai resources delete ${target} --quiet`);
  expect(deleted.world.aceSupport.resources).toHaveLength(0);
});
test("unknown choices, empty explanations and actual AI execution are rejected; decisions stay in their project", () => {
  deny(session(), "sim ace scenarios choose platform-vm --choice=made-up --reason='choice made'");
  deny(session(), "sim ace scenarios choose platform-vm --choice=gce --reason=' '");
  deny(session(), "sim ai resources execute ace-agent --prompt=anything");
  const s = run(
    session(),
    "sim ace scenarios choose platform-vm --choice=gce --reason='Full VM control'",
  );
  expect(s.text).toContain("CORRECT");
  const other = run(s, "sim ace scenarios describe platform-vm --project=ace-prod-01");
  expect(other.text).toContain("decision: null");
  expect(other.world).toEqual(s.world);
});
test("v42 keeps progress; malformed references, lifecycle and settings cannot be imported as a solution", () => {
  const completed = run(session(), ...aiSolutions("notebook"));
  const a = AiMissions[1]?.assertions[0];
  if (a?.kind !== "aiLesson") {
    throw new Error("Missing AI mission");
  }
  expect(aceSatisfied(completed.world, a)).toBe(true);
  const snap = Snapshot.create(completed.world, Now);
  expect(snap.schemaVersion).toBe(SchemaVersion);
  for (const changes of [
    { starts: 1 },
    { revision: 1 },
    { serviceAccount: "missing" },
    { platform: "gce" },
    { idleMinutes: -1 },
  ]) {
    const world = {
      ...completed.world,
      aceSupport: {
        ...completed.world.aceSupport,
        resources: completed.world.aceSupport.resources.map((r) => ({ ...r, ...changes })),
      },
    };
    expect(Snapshot.fromUnknown({ ...snap, world }).ok).toBe(false);
  }
  const started = Engine.startMission(session().world, "m-setup-001");
  if (!started.ok) {
    throw new Error(started.error.reason);
  }
  const old = Snapshot.create(started.value, Now);
  const { aceSupport: _ace, ...legacy } = old.world;
  const migrated = Snapshot.fromUnknown({ ...old, schemaVersion: 42, world: legacy });
  expect(migrated.ok).toBe(true);
  if (migrated.ok) {
    expect(migrated.value.aceSupport).toEqual({ resources: [], decisions: [] });
    expect(migrated.value.missions).toEqual(started.value.missions);
  }
});
test("new paths, flags, scenario names and choices are discoverable", () => {
  const registry = CommandRegistry.create(AllCommands);
  const s = session();
  expect(run(s, "sim ai resources create --help").text).toContain("--platform");
  const values = CommandRegistry.complete(
    registry,
    { tokens: ["sim", "ace", "scenarios", "choose"], partial: "platform-", world: s.world },
    [],
  );
  expect(values).toContain("platform-vm");
  const choices = CommandRegistry.complete(
    registry,
    {
      tokens: ["sim", "ace", "scenarios", "choose", "platform-vm", "--choice"],
      partial: "",
      world: s.world,
    },
    [],
  );
  expect(choices).toContain("gce");
});

test("completion requires public start/stop followed by private update/restart, including saved history", () => {
  const steps = aiSolutions("notebook");
  const wrongOrder = execute(
    configured(),
    steps[9] as string,
    steps[7] as string,
    steps[8] as string,
    steps[10] as string,
  );
  expect(satisfied(roundtrip(wrongOrder))).toBe(false);
  const privateOnly = execute(
    session(),
    ...steps.slice(0, 6),
    (steps[6] as string).replace("--access=public", "--access=private"),
    ...steps.slice(7),
  );
  expect(satisfied(roundtrip(privateOnly))).toBe(false);
  const corrected = execute(
    wrongOrder,
    `sim ai resources stop ${target}`,
    `sim ai resources update ${target} --access=public`,
    `sim ai resources start ${target}`,
    `sim ai resources stop ${target}`,
    `sim ai resources update ${target} --access=private`,
    `sim ai resources start ${target}`,
  );
  expect(satisfied(roundtrip(corrected))).toBe(true);
});

test("runtime SA must have only Storage read permissions, including inherited and custom roles", () => {
  const completed = execute(session(), ...aiSolutions("notebook"));
  expect(satisfied(completed)).toBe(true);
  const member = "serviceAccount:ace-notebook@ace-dev-01.iam.gserviceaccount.com";
  for (const role of ["roles/storage.admin", "roles/storage.objectAdmin", "roles/owner"]) {
    const broad = execute(
      completed,
      `gcloud projects add-iam-policy-binding ace-dev-01 --member=${member} --role=${role}`,
    );
    expect(satisfied(roundtrip(broad)), role).toBe(false);
  }
  const custom = execute(
    completed,
    "gcloud iam roles create DataWriter --permissions=storage.objects.create --title=Writer",
    `gcloud projects add-iam-policy-binding ace-dev-01 --member=${member} --role=projects/ace-dev-01/roles/DataWriter`,
  );
  expect(satisfied(custom)).toBe(false);
  const inherited = execute(
    completed,
    `gcloud organizations add-iam-policy-binding ${F.organizationId} --member=${member} --role=roles/viewer`,
  );
  expect(satisfied(roundtrip(inherited))).toBe(false);
});

test("AI references prevent SA and subnet deletion until the lesson resource is removed", () => {
  const s = roundtrip(configured());
  const saDelete =
    "gcloud iam service-accounts delete ace-notebook@ace-dev-01.iam.gserviceaccount.com --quiet";
  const subnetDelete =
    "gcloud compute networks subnets delete ace-notebook-subnet --region=us-central1 --quiet";
  deny(s, saDelete, "AI lesson");
  deny(s, subnetDelete, "AI lesson");
  const removed = execute(s, `sim ai resources delete ${target} --quiet`, saDelete, subnetDelete);
  expect(removed.world.aceSupport.resources).toHaveLength(0);
  roundtrip(removed);
});

test("Terraform cannot destroy a referenced subnet, but cleanup succeeds after AI removal", () => {
  const source =
    'resource "google_compute_subnetwork" "lab" { project = "ace-dev-01" name = "ace-notebook-subnet" region = "us-central1" network = "ace-notebook-net" ip_cidr_range = "10.60.0.0/24" private_ip_google_access = true }';
  const imported = execute(
    configured(),
    `sim files write main.tf --content='${source}'`,
    "gcloud auth application-default login",
    "terraform init",
    "terraform import google_compute_subnetwork.lab projects/ace-dev-01/regions/us-central1/subnetworks/ace-notebook-subnet",
  );
  deny(imported, "terraform destroy -auto-approve", "still in use");
  const cleared = execute(
    imported,
    `sim ai resources delete ${target} --quiet`,
    "terraform destroy -auto-approve",
  );
  expect(cleared.world.subnets.some((s) => s.name === "ace-notebook-subnet")).toBe(false);
  roundtrip(cleared);
});

test("Terraform auto-mode VPC deletion also protects the AI's automatically created subnet", () => {
  const steps = aiSolutions("notebook");
  const ready = execute(
    session(),
    steps[0] as string,
    (steps[1] as string).replace("--subnet-mode=custom", "--subnet-mode=auto"),
    ...steps.slice(3, 6),
    (steps[6] as string).replace("--subnet=ace-notebook-subnet", "--subnet=ace-notebook-net"),
  );
  const imported = execute(
    ready,
    `sim files write main.tf --content='resource "google_compute_network" "lab" { project = "ace-dev-01" name = "ace-notebook-net" auto_create_subnetworks = true }'`,
    "gcloud auth application-default login",
    "terraform init",
    "terraform import google_compute_network.lab projects/ace-dev-01/global/networks/ace-notebook-net",
  );
  deny(imported, "terraform destroy -auto-approve", "still in use");
  const cleared = execute(
    imported,
    `sim ai resources delete ${target} --quiet`,
    "terraform destroy -auto-approve",
  );
  expect(cleared.world.networks.some((n) => n.name === "ace-notebook-net")).toBe(false);
  roundtrip(cleared);
});

test("AI resource creation respects the inherited resource location organization policy", () => {
  const ready = execute(
    session(),
    ...aiSolutions("notebook").slice(0, 6),
    "gcloud services enable orgpolicy.googleapis.com",
    `sim files write policy.json --content='${JSON.stringify({ name: `organizations/${F.organizationId}/policies/gcp.resourceLocations`, spec: { rules: [{ values: { deniedValues: ["is:us-central1"] } }] } })}'`,
    "gcloud org-policies set-policy policy.json",
  );
  deny(ready, aiSolutions("notebook")[6] as string, "gcp.resourceLocations");
  roundtrip(ready);
});

test("oversized ACE arrays are rejected before decoding their elements", () => {
  const snapshot = Snapshot.create(session().world, Now);
  for (const [field, max] of [
    ["resources", 50],
    ["decisions", 400],
  ] as const) {
    const result = Snapshot.fromUnknown({
      ...snapshot,
      world: {
        ...snapshot.world,
        aceSupport: { ...snapshot.world.aceSupport, [field]: Array(max + 1).fill(null) },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(JSON.stringify(result.error)).toContain(`exceeds the ${max} item lesson limit`);
    }
  }
});
