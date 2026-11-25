// @vitest-environment node
import { expect, test } from "vitest";

import { run, session } from "@/engine/__tests__/setup";
import { World } from "@/engine/domains/world";
import {
  DiskEditForm,
  InstanceGroupEditForm,
  VmEditForm,
} from "@/features/simulator/features/console/domains/edit-command/compute";
import { FieldErrors } from "@/features/simulator/features/console/domains/equivalent-command";
import { Option } from "@/utils/Option";

const projectId = "ace-dev-01";
const zone = "asia-northeast1-a";

test("VmEditForm: 変更が無ければコマンドを出さない", () => {
  const s = run(
    session(),
    `gcloud compute instances create web-1 --zone=${zone} --machine-type=e2-small --tags=http-server --metadata=env=dev`,
  );
  const vm = Option.unwrap(World.findInstance(s.world, projectId, zone, "web-1"));
  const form = VmEditForm.from(vm);

  expect(FieldErrors.isEmpty(VmEditForm.collectErrors(form))).toBe(true);
  expect(VmEditForm.toSteps(form, projectId)).toEqual([]);
  expect(VmEditForm.toCommand(form, projectId)).toBe("# 変更はありません");
});

test("VmEditForm: タグ追加/削除とメタデータ追加/削除が変更分だけコマンド化され実行できる", () => {
  const s = run(
    session(),
    `gcloud compute instances create web-1 --zone=${zone} --tags=http-server,old-tag --metadata=env=dev,drop=yes`,
  );
  const vm = Option.unwrap(World.findInstance(s.world, projectId, zone, "web-1"));
  const form: VmEditForm = {
    ...VmEditForm.from(vm),
    tags: "http-server,https-server,",
    metadata: "env=prod,team=web",
  };

  expect(FieldErrors.isEmpty(VmEditForm.collectErrors(form))).toBe(true);
  const steps = VmEditForm.toSteps(form, projectId);
  expect(steps.map((step) => step.line)).toEqual([
    `gcloud compute instances add-tags web-1 --project=${projectId} --zone=${zone} --tags=https-server`,
    `gcloud compute instances remove-tags web-1 --project=${projectId} --zone=${zone} --tags=old-tag`,
    `gcloud compute instances add-metadata web-1 --project=${projectId} --zone=${zone} --metadata=env=prod,team=web`,
    `gcloud compute instances remove-metadata web-1 --project=${projectId} --zone=${zone} --keys=drop`,
  ]);

  const after = run(s, ...steps.map((step) => step.line));
  const updated = Option.unwrap(World.findInstance(after.world, projectId, zone, "web-1"));
  expect(updated.tags).toEqual(["http-server", "https-server"]);
  expect(updated.metadata).toEqual({ env: "prod", team: "web" });
});

test("VmEditForm: 稼働中はマシンタイプ変更をエラーにし、停止後なら set-machine-type を生成する", () => {
  const running = run(
    session(),
    `gcloud compute instances create web-1 --zone=${zone} --machine-type=e2-small`,
  );
  const vmRunning = Option.unwrap(World.findInstance(running.world, projectId, zone, "web-1"));
  const invalidForm: VmEditForm = {
    ...VmEditForm.from(vmRunning),
    machineType: "e2-medium",
  };
  expect(VmEditForm.collectErrors(invalidForm).machineType).toBeDefined();
  expect(VmEditForm.toSteps(invalidForm, projectId)).toEqual([]);

  const stopped = run(running, `gcloud compute instances stop web-1 --zone=${zone}`);
  const vmStopped = Option.unwrap(World.findInstance(stopped.world, projectId, zone, "web-1"));
  const validForm: VmEditForm = {
    ...VmEditForm.from(vmStopped),
    machineType: "e2-medium",
  };
  expect(FieldErrors.isEmpty(VmEditForm.collectErrors(validForm))).toBe(true);
  const steps = VmEditForm.toSteps(validForm, projectId);
  expect(steps.map((step) => step.line)).toEqual([
    `gcloud compute instances set-machine-type web-1 --project=${projectId} --zone=${zone} --machine-type=e2-medium`,
  ]);

  const after = run(stopped, ...steps.map((step) => step.line));
  const updated = Option.unwrap(World.findInstance(after.world, projectId, zone, "web-1"));
  expect(updated.machineType).toBe("e2-medium");
});

test("VmEditForm: 不正なメタデータ形式をエラーにする", () => {
  const s = run(session(), `gcloud compute instances create web-1 --zone=${zone}`);
  const vm = Option.unwrap(World.findInstance(s.world, projectId, zone, "web-1"));
  const form: VmEditForm = { ...VmEditForm.from(vm), metadata: "invalid-entry" };
  expect(VmEditForm.collectErrors(form).metadata).toBeDefined();
});

test("DiskEditForm: サイズ拡張のみ resize を生成し、縮小はエラーにする", () => {
  const s = run(
    session(),
    `gcloud compute disks create data-1 --zone=${zone} --size=100GB --type=pd-balanced`,
  );
  const base = DiskEditForm.from({
    name: "data-1",
    location: zone,
    locationScope: "zone",
    type: "pd-balanced",
    sizeGb: 100,
  });

  expect(DiskEditForm.toSteps(base, projectId)).toEqual([]);
  expect(DiskEditForm.collectErrors({ ...base, size: "50GB" }).size).toBeDefined();

  const grown: DiskEditForm = { ...base, size: "200GB" };
  expect(FieldErrors.isEmpty(DiskEditForm.collectErrors(grown))).toBe(true);
  const steps = DiskEditForm.toSteps(grown, projectId);
  expect(steps.map((step) => step.line)).toEqual([
    `gcloud compute disks resize data-1 --project=${projectId} --zone=${zone} --size=200GB`,
  ]);

  const after = run(s, ...steps.map((step) => step.line));
  const disk = World.disksOf(after.world, projectId).find((d) => d.name === "data-1");
  expect(disk?.sizeGb).toBe(200);
});

test("DiskEditForm: Hyperdisk は IOPS/スループット変更時に disks update を生成する", () => {
  const s = run(
    session(),
    `gcloud compute disks create hd-1 --zone=${zone} --type=hyperdisk-balanced --size=100GB --provisioned-iops=3000 --provisioned-throughput=140`,
  );
  const base = DiskEditForm.from({
    name: "hd-1",
    location: zone,
    locationScope: "zone",
    type: "hyperdisk-balanced",
    sizeGb: 100,
    iops: 3000,
    throughput: 140,
  });
  const edited: DiskEditForm = { ...base, iops: "4000", throughput: "200" };
  expect(FieldErrors.isEmpty(DiskEditForm.collectErrors(edited))).toBe(true);
  const steps = DiskEditForm.toSteps(edited, projectId);
  expect(steps.map((step) => step.line)).toEqual([
    `gcloud compute disks update hd-1 --project=${projectId} --zone=${zone} --provisioned-iops=4000 --provisioned-throughput=200`,
  ]);

  const after = run(s, ...steps.map((step) => step.line));
  const disk = after.world.computeLab.disks.find((d) => d.name === "hd-1");
  expect(disk?.iops).toBe(4000);
  expect(disk?.throughput).toBe(200);
});

test("InstanceGroupEditForm: テンプレート・台数・オートスケーリングの変更分だけコマンド化し実行できる", () => {
  const s = run(
    session(),
    "gcloud compute instance-templates create tpl-v1",
    "gcloud compute instance-templates create tpl-v2",
    `gcloud compute instance-groups managed create web-mig --zone=${zone} --template=tpl-v1 --size=2`,
  );
  const mig = s.world.instanceGroups.find((g) => g.name === "web-mig");
  expect(mig).toBeDefined();
  if (!mig) return;

  const base = InstanceGroupEditForm.from(mig);
  expect(InstanceGroupEditForm.toSteps(base, projectId)).toEqual([]);

  const edited: InstanceGroupEditForm = {
    ...base,
    template: "tpl-v2",
    size: "3",
    autoscalingEnabled: true,
    minReplicas: "2",
    maxReplicas: "6",
    targetCpu: "0.7",
    coolDownSec: "90",
  };
  expect(FieldErrors.isEmpty(InstanceGroupEditForm.collectErrors(edited))).toBe(true);
  const steps = InstanceGroupEditForm.toSteps(edited, projectId);
  expect(steps.map((step) => step.line)).toEqual([
    `gcloud compute instance-groups managed set-instance-template web-mig --project=${projectId} --zone=${zone} --template=tpl-v2`,
    `gcloud compute instance-groups managed resize web-mig --project=${projectId} --zone=${zone} --size=3`,
    `gcloud compute instance-groups managed set-autoscaling web-mig --project=${projectId} --zone=${zone} --max-num-replicas=6 --min-num-replicas=2 --target-cpu-utilization=0.7 --cool-down-period=90`,
  ]);

  const after = run(s, ...steps.map((step) => step.line));
  const updated = after.world.instanceGroups.find((g) => g.name === "web-mig");
  expect(updated?.template).toBe("tpl-v2");
  expect(updated?.targetSize).toBe(3);
  expect(Option.isSome(updated?.autoscaling ?? Option.none)).toBe(true);

  if (!updated) return;
  const disabled: InstanceGroupEditForm = {
    ...InstanceGroupEditForm.from(updated),
    autoscalingEnabled: false,
  };
  const stopSteps = InstanceGroupEditForm.toSteps(disabled, projectId);
  expect(stopSteps.map((step) => step.line)).toEqual([
    `gcloud compute instance-groups managed stop-autoscaling web-mig --project=${projectId} --zone=${zone}`,
  ]);

  const stopped = run(after, ...stopSteps.map((step) => step.line));
  const finalMig = stopped.world.instanceGroups.find((g) => g.name === "web-mig");
  expect(finalMig?.autoscaling).toEqual(Option.none);
});
