// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { Now, run, type Session, session } from "@/engine/__tests__/setup";
import { emptyComputeLab } from "@/engine/domains/compute-lab/model";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import {
  type ComputeLesson,
  ComputePrelude,
  ComputeSolutions,
  computeSatisfied,
} from "@/engine/missions/compute-lab";
import { Snapshot } from "@/engine/snapshot";

const ready = () => run(session(), ...ComputePrelude);
const reject = (s: Session, line: string) => {
  const result = run(s, line);
  expect(result.text, line).toContain("ERROR:");
  expect(result.world, line).toBe(s.world);
};
const solved = (lesson: ComputeLesson, end?: number) => {
  let s = ready();
  for (const input of ComputeSolutions[lesson].slice(0, end)) {
    const member =
      s.world.instanceGroups.find((g) => g.name === "healing")?.instanceNames[0] ?? "missing";
    s = run(s, input.replace("@member", member));
    expect(s.text, input).not.toContain("ERROR:");
  }
  return s;
};
for (const flags of [
  "--custom-cpu=3 --custom-memory=12GB",
  "--custom-cpu=4 --custom-memory=1025MB",
  "--custom-cpu=4 --custom-memory=100GB",
  "--custom-cpu=4 --custom-memory=12",
  "--custom-cpu=4 --custom-memory=12GB --machine-type=e2-medium",
  "--provisioning-model=SPOT --restart-on-failure",
  "--provisioning-model=SPOT --maintenance-policy=MIGRATE",
  "--machine-type=e2-medium --accelerator=type=nvidia-tesla-t4,count=1 --maintenance-policy=TERMINATE",
  "--machine-type=n1-standard-1 --accelerator=type=nvidia-tesla-t4,count=2 --maintenance-policy=TERMINATE",
  "--machine-type=n1-standard-1 --accelerator=type=nvidia-tesla-t4,count=1",
  "--machine-type=n1-standard-1 --accelerator=type=nvidia-tesla-t4,count=1,other=x --maintenance-policy=TERMINATE",
]) {
  test(`invalid VM configuration is atomic: ${flags}`, () =>
    reject(ready(), `gcloud compute instances create invalid-vm --zone=us-central1-a ${flags}`));
}
test("GPU placement rejects an unsupported zone", () =>
  reject(
    ready(),
    "gcloud compute instances create gpu --zone=asia-northeast1-a --machine-type=n1-standard-1 --accelerator=type=nvidia-tesla-t4,count=1 --maintenance-policy=TERMINATE",
  ));
for (const flags of [
  "--region=us-central1 --zone=us-central1-a",
  "--region=us-central1 --replica-zones=us-central1-a,us-central1-a",
  "--region=us-central1 --replica-zones=us-central1-a,asia-northeast1-a",
  "--region=us-central1 --replica-zones=us-central1-a",
  "--zone=us-central1-a --type=hyperdisk-balanced --size=100GB --provisioned-iops=50001",
  "--zone=us-central1-a --type=hyperdisk-balanced --size=100GB --provisioned-throughput=1000 --provisioned-iops=3000",
  "--zone=us-central1-a --source-snapshot=missing",
  "--region=us-central1 --type=hyperdisk-balanced --replica-zones=us-central1-a,us-central1-b",
]) {
  test(`invalid disk configuration is atomic: ${flags}`, () =>
    reject(ready(), `gcloud compute disks create invalid-disk ${flags}`));
}
test("cross-project and cross-zone disk reads cannot fall through", () => {
  const s = solved("restore");
  reject(s, "sim compute disks read recovered-orders --zone=us-central1-b");
  reject(s, "sim compute disks read recovered-orders --zone=us-central1-a --project=ace-prod-01");
});
test("regional attachment requires a replica zone; Hyperdisk requires supported machine", () => {
  const s = run(
    ready(),
    "gcloud compute instances create wrong-machine --zone=us-central1-c",
    "gcloud compute disks create replicated --region=us-central1 --replica-zones=us-central1-a,us-central1-b",
    "gcloud compute disks create hyper --zone=us-central1-c --type=hyperdisk-balanced --size=100GB",
  );
  reject(
    s,
    "gcloud compute instances attach-disk wrong-machine --zone=us-central1-c --disk=replicated --disk-scope=regional",
  );
  reject(s, "gcloud compute instances attach-disk wrong-machine --zone=us-central1-c --disk=hyper");
});
test("restoration preserves copy, enforces source size, and does not reuse corrupted source", () => {
  const s = solved("restore");
  reject(
    s,
    "gcloud compute disks create small --zone=us-central1-a --size=10GB --source-snapshot=orders-safe",
  );
  expect(computeSatisfied(s.world, "restore")).toBe(true);
  const corrupted = run(
    s,
    "sim compute disks write recovered-orders --zone=us-central1-a --data=wrong",
  );
  expect(computeSatisfied(corrupted.world, "restore")).toBe(false);
});
test("snapshot schedule rejects early runs and expires old copies in virtual time", () => {
  const s = solved("schedule");
  reject(s, "sim compute snapshot-schedules run hourly --region=us-central1");
  reject(s, "gcloud compute resource-policies delete hourly --region=us-central1 --quiet");
  const aged = run(
    s,
    "sim compute time advance --seconds=691200",
    "sim compute snapshot-schedules run hourly --region=us-central1",
  );
  expect(aged.text).not.toContain("ERROR:");
  expect(aged.world.computeLab.copies.filter((s) => s.schedule === "hourly")).toHaveLength(1);
});
test("referenced disk cannot be deleted; detachment enables cleanup", () => {
  const s = solved("regional");
  reject(s, "gcloud compute disks delete mirrored --region=us-central1 --quiet");
  const deleted = run(
    s,
    "gcloud compute instances detach-disk ha-worker --zone=us-central1-a --disk=mirrored",
    "gcloud compute disks delete mirrored --region=us-central1 --quiet",
  );
  expect(deleted.text).not.toContain("ERROR:");
  expect(deleted.world.computeLab.disks).toHaveLength(0);
});
test("custom image requires stopped boot source, rejects missing source and survives source deletion", () => {
  const s = solved("image", 2);
  reject(
    s,
    "gcloud compute images create running-image --source-disk=golden --source-disk-zone=us-central1-a",
  );
  reject(s, "gcloud compute images create absent-image --source-snapshot=missing");
  const complete = solved("image");
  const deleted = run(
    complete,
    "gcloud compute instances delete golden --zone=us-central1-a --quiet",
  );
  expect(deleted.text).not.toContain("ERROR:");
  expect(Snapshot.fromUnknown(Snapshot.create(deleted.world, Now)).ok).toBe(true);
  expect(computeSatisfied(deleted.world, "image")).toBe(true);
});
test("explicit runtime SA requires actAs independently from instanceAdmin", () => {
  const s = run(
    ready(),
    "gcloud iam service-accounts create restricted",
    `gcloud projects add-iam-policy-binding ${F.devProjectId} --member=user:${F.developer} --role=roles/compute.instanceAdmin.v1`,
  );
  reject(
    s,
    `gcloud compute instances create restricted-vm --zone=us-central1-a --service-account=restricted@${F.devProjectId}.iam.gserviceaccount.com --account=${F.developer}`,
  );
});
test("OAuth cloud-platform does not grant IAM; read-only scope cannot write even with IAM", () => {
  const s = solved("scopes", -2);
  reject(
    s,
    "sim compute instances runtime-check scoped-worker --zone=us-central1-a --operation=storage-write",
  );
  const granted = solved("scopes");
  const narrow = run(
    granted,
    "gcloud compute instances stop scoped-worker --zone=us-central1-a",
    "gcloud compute instances set-service-account scoped-worker --zone=us-central1-a --service-account=vm-worker@ace-dev-01.iam.gserviceaccount.com --scopes=storage-ro",
    "gcloud compute instances start scoped-worker --zone=us-central1-a",
  );
  reject(
    narrow,
    "sim compute instances runtime-check scoped-worker --zone=us-central1-a --operation=storage-write",
  );
});
test("non-admin OS Login does not confer sudo; disablement prevents login", () => {
  const s = solved("osLogin");
  reject(
    s,
    `sim compute instances os-login-check login-worker --zone=us-central1-a --admin --account=${F.developer}`,
  );
  const disabled = run(
    s,
    "gcloud compute instances add-metadata login-worker --zone=us-central1-a --metadata=enable-oslogin=FALSE",
  );
  reject(
    disabled,
    `sim compute instances os-login-check login-worker --zone=us-central1-a --account=${F.developer}`,
  );
});
test("OS Config inventory and policy cannot run without opt-in / API / permissions", () => {
  const s = run(ready(), "gcloud compute instances create no-agent --zone=us-central1-a");
  reject(s, "gcloud compute os-config inventories describe no-agent --zone=us-central1-a");
  reject(
    s,
    `gcloud compute os-config inventories describe no-agent --zone=us-central1-a --account=${F.developer}`,
  );
});
test("TPU validates zone, version, API, actAs and retention references", () => {
  const s = solved("tpu");
  reject(
    s,
    "gcloud compute tpus tpu-vm create invalid --zone=asia-northeast1-a --accelerator-type=v2-8 --version=tpu-vm-base",
  );
  reject(
    s,
    "gcloud compute tpus tpu-vm create invalid --zone=us-central1-b --accelerator-type=v2-8 --version=arbitrary",
  );
  reject(
    s,
    "gcloud iam service-accounts delete vm-worker@ace-dev-01.iam.gserviceaccount.com --quiet",
  );
  const disabled = run(s, "gcloud services disable tpu.googleapis.com");
  reject(disabled, "gcloud compute tpus tpu-vm describe matrix-worker --zone=us-central1-b");
});
test("MIG partial rollout keeps both versions and protects the old template", () => {
  const partial = solved("rolling", -1);
  expect(computeSatisfied(partial.world, "rolling")).toBe(false);
  expect(new Set(Object.values(partial.world.computeLab.migs[0]?.applied ?? {}))).toEqual(
    new Set(["release-v1", "release-v2"]),
  );
  reject(partial, "gcloud compute instance-templates delete release-v1 --quiet");
  reject(
    partial,
    "gcloud compute instance-groups managed resize release --zone=us-central1-a --size=4",
  );
  const complete = solved("rolling");
  const deleted = run(
    complete,
    "gcloud compute instance-templates delete release-v1 --quiet",
    "gcloud compute instance-groups managed delete release --zone=us-central1-a --quiet",
    "gcloud compute instance-templates delete release-v2 --quiet",
  );
  expect(deleted.text).not.toContain("ERROR:");
  expect(deleted.world.computeLab.migs).toHaveLength(0);
  expect(Snapshot.fromUnknown(Snapshot.create(deleted.world, Now)).ok).toBe(true);
});
test("autohealing waits for virtual delay; member deletion and referenced HC deletion rejected", () => {
  const s = solved("autoheal", -2);
  reject(s, "sim compute instance-groups managed autoheal healing --zone=us-central1-a");
  reject(s, "gcloud compute health-checks delete app-health --global --quiet");
  const member = s.world.instanceGroups[0]?.instanceNames[0] ?? "missing";
  reject(s, `gcloud compute instances delete ${member} --zone=us-central1-a --quiet`);
});
test("autoscaling clamps samples and respects cooldown; NaN target and invalid bounds rejected", () => {
  const s = solved("autoscaling", -2);
  const cooldown = run(
    s,
    "sim compute instance-groups managed evaluate-autoscaling scaling --zone=us-central1-a --cpu-utilization=1 --elapsed-seconds=10",
  );
  expect(cooldown.text).toContain("recommended: 2");
  reject(
    s,
    "gcloud compute instance-groups managed set-autoscaling scaling --zone=us-central1-a --max-num-replicas=4 --target-cpu-utilization=abc",
  );
  reject(
    s,
    "gcloud compute instance-groups managed set-autoscaling scaling --zone=us-central1-a --min-num-replicas=-1 --max-num-replicas=4",
  );
  reject(
    s,
    "sim compute instance-groups managed evaluate-autoscaling scaling --zone=us-central1-a --cpu-utilization=2 --elapsed-seconds=60",
  );
});
test("v35 migration preserves earlier labs and defaults new state; malformed current references rejected", () => {
  const s = solved("rolling");
  const old = {
    ...Snapshot.create(s.world, Now),
    schemaVersion: 35,
    world: { ...s.world, computeLab: undefined },
  };
  const imported = Snapshot.fromUnknown(old);
  expect(imported.ok).toBe(true);
  if (imported.ok) {
    expect(imported.value.computeLab).toEqual(emptyComputeLab());
    expect(imported.value.dataProcessing).toEqual(s.world.dataProcessing);
    expect(imported.value.instances).toEqual(s.world.instances);
  }
  const broken = {
    ...s.world,
    computeLab: {
      ...s.world.computeLab,
      migs: s.world.computeLab.migs.map((m) => ({ ...m, desiredTemplate: "missing" })),
    },
  };
  expect(Snapshot.fromUnknown(Snapshot.create(broken, Now)).ok).toBe(false);
});
test("Compute help and completion expose flags, and tree describe commands execute", () => {
  const s = solved("hyperdisk");
  expect(run(s, "gcloud compute instances create --help").text).toContain("--custom-cpu");
  expect(run(s, "gcloud compute instances create --help").text).toContain("--accelerator");
  expect(
    Engine.completionCandidates(s.world, "gcloud compute instances create vm --custom-"),
  ).toContain("--custom-cpu");
  expect(Engine.completionCandidates(s.world, "sim compute disks read fast-")).toEqual([
    "fast-data",
  ]);
});

test("reserved lookup names are rejected without exceptions", () => {
  const s = solved("scopes");
  reject(
    s,
    "sim compute instances runtime-check scoped-worker --zone=us-central1-a --operation=constructor",
  );
  reject(
    s,
    "gcloud compute tpus tpu-vm create unknown --zone=us-central1-b --accelerator-type=constructor --version=tpu-vm-base",
  );
});
