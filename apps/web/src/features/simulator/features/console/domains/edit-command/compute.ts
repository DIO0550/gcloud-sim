import type { MachineTypeName, Zone } from "@/engine/domains/catalog";
import {
  type BootDiskType,
  DiskSizeGb,
  type Instance,
  type InstanceStatus,
  type ProvisioningModel,
  ProvisioningModels,
  ResourceName,
} from "@/engine/domains/compute";
import type { InstanceTemplate, ManagedInstanceGroup } from "@/engine/domains/instance-groups";
import { MigLocation } from "@/engine/domains/resource-location";
import {
  collect,
  errorOf,
  type FieldErrors,
  flag,
  integerOf,
  quote,
} from "@/features/simulator/features/console/domains/equivalent-command";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";
import { StringEx } from "@/utils/StringEx";

/** 1 回の編集保存で順番に流すコマンド 1 行分。 */
export type CommandStep = Readonly<{ line: string; note: string }>;

const NoChangesComment = "# 変更はありません";

const joinSteps = (steps: readonly CommandStep[]): string =>
  steps.length === 0 ? NoChangesComment : steps.map((s) => s.line).join("\n");

/** `key=value` のカンマ・改行区切りを連想配列にする。空文字は空オブジェクト。 */
const parseMetadata = (raw: string): Result<Readonly<Record<string, string>>, string> => {
  const entries: Record<string, string> = {};
  for (const part of raw.split(/[,\n]/)) {
    const trimmed = part.trim();
    if (trimmed === "") continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      return Result.err(`「${trimmed}」は key=value の形式で入力してください`);
    }
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key === "") {
      return Result.err(`「${trimmed}」のキーが空です`);
    }
    entries[key] = value;
  }
  return Result.ok(entries);
};

// --- VM インスタンス編集 ---

export type VmEditForm = Readonly<{
  name: string;
  zone: Zone;
  status: InstanceStatus;
  initialMachineType: MachineTypeName;
  machineType: MachineTypeName;
  initialTags: readonly string[];
  tags: string;
  initialMetadata: Readonly<Record<string, string>>;
  metadata: string;
}>;

export const VmEditForm = {
  /** 既存の VM インスタンスから編集フォームの初期値を作る。 */
  from(instance: Instance): VmEditForm {
    return {
      name: instance.name,
      zone: instance.zone,
      status: instance.status,
      initialMachineType: instance.machineType,
      machineType: instance.machineType,
      initialTags: instance.tags,
      tags: instance.tags.join(", "),
      initialMetadata: instance.metadata,
      metadata: Object.entries(instance.metadata)
        .map(([k, v]) => `${k}=${v}`)
        .join(","),
    };
  },

  collectErrors(form: VmEditForm): FieldErrors<VmEditForm> {
    const machineTypeError =
      form.machineType !== form.initialMachineType && form.status !== "TERMINATED"
        ? Option.some("マシンタイプを変更するにはインスタンスを停止してください")
        : Option.none;
    return collect<VmEditForm>([
      ["machineType", machineTypeError],
      ["metadata", errorOf(parseMetadata(form.metadata))],
    ]);
  },

  /** 変更された項目だけに対応するコマンド列を返す。変更が無ければ空配列。 */
  toSteps(form: VmEditForm, projectId: string): readonly CommandStep[] {
    const steps: CommandStep[] = [];
    const target = `${quote(form.name)} ${flag("project", projectId)} ${flag("zone", form.zone)}`;

    if (form.machineType !== form.initialMachineType && form.status === "TERMINATED") {
      steps.push({
        line: `gcloud compute instances set-machine-type ${target} ${flag("machine-type", form.machineType)}`,
        note: `マシンタイプを変更 (${form.name})`,
      });
    }

    const currentTags = [...new Set(StringEx.splitList(form.tags))];
    const addedTags = currentTags.filter((t) => !form.initialTags.includes(t));
    const removedTags = form.initialTags.filter((t) => !currentTags.includes(t));
    if (addedTags.length > 0) {
      steps.push({
        line: `gcloud compute instances add-tags ${target} ${flag("tags", addedTags.join(","))}`,
        note: `ネットワーク タグを追加 (${form.name})`,
      });
    }
    if (removedTags.length > 0) {
      steps.push({
        line: `gcloud compute instances remove-tags ${target} ${flag("tags", removedTags.join(","))}`,
        note: `ネットワーク タグを削除 (${form.name})`,
      });
    }

    const parsedMeta = parseMetadata(form.metadata);
    if (Result.isOk(parsedMeta)) {
      const nextMeta = parsedMeta.value;
      const upsert = Object.entries(nextMeta).filter(([k, v]) => form.initialMetadata[k] !== v);
      const removedKeys = Object.keys(form.initialMetadata).filter((k) => !(k in nextMeta));
      if (upsert.length > 0) {
        steps.push({
          line: `gcloud compute instances add-metadata ${target} ${flag(
            "metadata",
            upsert.map(([k, v]) => `${k}=${v}`).join(","),
          )}`,
          note: `メタデータを更新 (${form.name})`,
        });
      }
      if (removedKeys.length > 0) {
        steps.push({
          line: `gcloud compute instances remove-metadata ${target} ${flag("keys", removedKeys.join(","))}`,
          note: `メタデータを削除 (${form.name})`,
        });
      }
    }

    return steps;
  },

  toCommand(form: VmEditForm, projectId: string): string {
    return joinSteps(VmEditForm.toSteps(form, projectId));
  },
} as const;

// --- ディスク編集 ---

export type DiskEditSeed = Readonly<{
  name: string;
  location: string;
  locationScope: "zone" | "region";
  type: string;
  sizeGb: number;
  iops?: number;
  throughput?: number;
}>;

export type DiskEditForm = Readonly<{
  name: string;
  location: string;
  locationScope: "zone" | "region";
  type: string;
  initialSizeGb: number;
  size: string;
  isHyperdisk: boolean;
  initialIops: number;
  iops: string;
  initialThroughput: number;
  throughput: string;
}>;

export const DiskEditForm = {
  from(seed: DiskEditSeed): DiskEditForm {
    const isHyperdisk = seed.type === "hyperdisk-balanced";
    const iops = seed.iops ?? 3000;
    const throughput = seed.throughput ?? 140;
    return {
      name: seed.name,
      location: seed.location,
      locationScope: seed.locationScope,
      type: seed.type,
      initialSizeGb: seed.sizeGb,
      size: `${seed.sizeGb}GB`,
      isHyperdisk,
      initialIops: iops,
      iops: String(iops),
      initialThroughput: throughput,
      throughput: String(throughput),
    };
  },

  collectErrors(form: DiskEditForm): FieldErrors<DiskEditForm> {
    const parsedSize = DiskSizeGb.parse(form.size);
    const sizeError = !Result.isOk(parsedSize)
      ? Option.some(parsedSize.error)
      : parsedSize.value < form.initialSizeGb
        ? Option.some(`ディスクのサイズは現在の ${form.initialSizeGb} GB より小さくできません`)
        : Option.none;

    if (!form.isHyperdisk) {
      return collect<DiskEditForm>([["size", sizeError]]);
    }

    const parsedIops = integerOf(form.iops.trim());
    const iopsError =
      Option.isSome(parsedIops) && parsedIops.value > 0
        ? Option.none
        : Option.some("IOPS は 1 以上の整数で入力してください");

    const parsedThroughput = integerOf(form.throughput.trim());
    const throughputError =
      Option.isSome(parsedThroughput) && parsedThroughput.value > 0
        ? Option.none
        : Option.some("スループットは 1 以上の整数で入力してください");

    return collect<DiskEditForm>([
      ["size", sizeError],
      ["iops", iopsError],
      ["throughput", throughputError],
    ]);
  },

  toSteps(form: DiskEditForm, projectId: string): readonly CommandStep[] {
    const steps: CommandStep[] = [];
    const locFlag =
      form.locationScope === "region" ? flag("region", form.location) : flag("zone", form.location);
    const target = `${quote(form.name)} ${flag("project", projectId)} ${locFlag}`;

    const parsedSize = DiskSizeGb.parse(form.size);
    if (Result.isOk(parsedSize) && parsedSize.value > form.initialSizeGb) {
      steps.push({
        line: `gcloud compute disks resize ${target} ${flag("size", form.size.trim())}`,
        note: `ディスクのサイズを変更 (${form.name})`,
      });
    }

    if (form.isHyperdisk) {
      const parsedIops = integerOf(form.iops.trim());
      const parsedThroughput = integerOf(form.throughput.trim());
      const updateFlags: string[] = [];
      if (Option.isSome(parsedIops) && parsedIops.value !== form.initialIops) {
        updateFlags.push(flag("provisioned-iops", String(parsedIops.value)));
      }
      if (Option.isSome(parsedThroughput) && parsedThroughput.value !== form.initialThroughput) {
        updateFlags.push(flag("provisioned-throughput", String(parsedThroughput.value)));
      }
      if (updateFlags.length > 0) {
        steps.push({
          line: `gcloud compute disks update ${target} ${updateFlags.join(" ")}`,
          note: `ディスクのパフォーマンスを更新 (${form.name})`,
        });
      }
    }

    return steps;
  },

  toCommand(form: DiskEditForm, projectId: string): string {
    return joinSteps(DiskEditForm.toSteps(form, projectId));
  },
} as const;

// --- マネージド インスタンス グループ編集 ---

export type InstanceGroupEditForm = Readonly<{
  name: string;
  location: string;
  locationScope: "zone" | "region";
  initialTemplate: string;
  template: string;
  initialSize: number;
  size: string;
  initialAutoscalingEnabled: boolean;
  autoscalingEnabled: boolean;
  initialMinReplicas: number;
  minReplicas: string;
  initialMaxReplicas: number;
  maxReplicas: string;
  initialTargetCpu: number;
  targetCpu: string;
  initialCoolDownSec: number;
  coolDownSec: string;
}>;

export const InstanceGroupEditForm = {
  from(group: ManagedInstanceGroup): InstanceGroupEditForm {
    const enabled = Option.isSome(group.autoscaling);
    const minReplicas = enabled ? group.autoscaling.value.minReplicas : 1;
    const maxReplicas = enabled
      ? group.autoscaling.value.maxReplicas
      : Math.max(group.targetSize, 5);
    const targetCpu = enabled ? group.autoscaling.value.targetCpuUtilization : 0.6;
    const coolDownSec = enabled ? group.autoscaling.value.coolDownPeriodSec : 60;
    return {
      name: group.name,
      location: MigLocation.name(group.location),
      locationScope: group.location.kind,
      initialTemplate: group.template,
      template: group.template,
      initialSize: group.targetSize,
      size: String(group.targetSize),
      initialAutoscalingEnabled: enabled,
      autoscalingEnabled: enabled,
      initialMinReplicas: minReplicas,
      minReplicas: String(minReplicas),
      initialMaxReplicas: maxReplicas,
      maxReplicas: String(maxReplicas),
      initialTargetCpu: targetCpu,
      targetCpu: String(targetCpu),
      initialCoolDownSec: coolDownSec,
      coolDownSec: String(coolDownSec),
    };
  },

  collectErrors(form: InstanceGroupEditForm): FieldErrors<InstanceGroupEditForm> {
    const size = integerOf(form.size.trim());
    const sizeError =
      Option.isSome(size) && size.value >= 0 && size.value <= 100
        ? Option.none
        : Option.some("インスタンス数は 0〜100 の整数で入力してください");

    const templateError =
      form.template.trim() === ""
        ? Option.some("インスタンス テンプレートを選択してください")
        : Option.none;

    if (!form.autoscalingEnabled) {
      return collect<InstanceGroupEditForm>([
        ["template", templateError],
        ["size", sizeError],
      ]);
    }

    const min = integerOf(form.minReplicas.trim());
    const minError =
      Option.isSome(min) && min.value >= 0 && min.value <= 100
        ? Option.none
        : Option.some("最小インスタンス数は 0〜100 の整数で入力してください");

    const max = integerOf(form.maxReplicas.trim());
    const maxError =
      !Option.isSome(max) || max.value < 1 || max.value > 100
        ? Option.some("最大インスタンス数は 1〜100 の整数で入力してください")
        : Option.isSome(min) && max.value < min.value
          ? Option.some("最大インスタンス数は最小インスタンス数以上にしてください")
          : Option.none;

    const cpu = Number(form.targetCpu.trim());
    const cpuError =
      form.targetCpu.trim() !== "" && Number.isFinite(cpu) && cpu > 0 && cpu <= 1
        ? Option.none
        : Option.some("目標 CPU 使用率は 0 より大きく 1 以下の数値で入力してください");

    const coolDown = integerOf(form.coolDownSec.trim());
    const coolDownError =
      Option.isSome(coolDown) && coolDown.value >= 0
        ? Option.none
        : Option.some("クールダウン期間は 0 以上の整数で入力してください");

    return collect<InstanceGroupEditForm>([
      ["template", templateError],
      ["size", sizeError],
      ["minReplicas", minError],
      ["maxReplicas", maxError],
      ["targetCpu", cpuError],
      ["coolDownSec", coolDownError],
    ]);
  },

  toSteps(form: InstanceGroupEditForm, projectId: string): readonly CommandStep[] {
    const steps: CommandStep[] = [];
    const locFlag =
      form.locationScope === "region" ? flag("region", form.location) : flag("zone", form.location);
    const target = `${quote(form.name)} ${flag("project", projectId)} ${locFlag}`;

    if (form.template !== form.initialTemplate && form.template.trim() !== "") {
      steps.push({
        line: `gcloud compute instance-groups managed set-instance-template ${target} ${flag("template", form.template)}`,
        note: `インスタンス テンプレートを変更 (${form.name})`,
      });
    }

    const size = integerOf(form.size.trim());
    if (Option.isSome(size) && size.value !== form.initialSize) {
      steps.push({
        line: `gcloud compute instance-groups managed resize ${target} ${flag("size", String(size.value))}`,
        note: `インスタンス数を変更 (${form.name})`,
      });
    }

    if (!form.autoscalingEnabled && form.initialAutoscalingEnabled) {
      steps.push({
        line: `gcloud compute instance-groups managed stop-autoscaling ${target}`,
        note: `オートスケーリングを無効化 (${form.name})`,
      });
    } else if (form.autoscalingEnabled) {
      const min = integerOf(form.minReplicas.trim());
      const max = integerOf(form.maxReplicas.trim());
      const cpu = Number(form.targetCpu.trim());
      const coolDown = integerOf(form.coolDownSec.trim());
      const changed =
        !form.initialAutoscalingEnabled ||
        (Option.isSome(min) && min.value !== form.initialMinReplicas) ||
        (Option.isSome(max) && max.value !== form.initialMaxReplicas) ||
        (Number.isFinite(cpu) && cpu !== form.initialTargetCpu) ||
        (Option.isSome(coolDown) && coolDown.value !== form.initialCoolDownSec);

      if (changed && Option.isSome(max)) {
        const flags = [
          flag("max-num-replicas", String(max.value)),
          ...(Option.isSome(min) ? [flag("min-num-replicas", String(min.value))] : []),
          ...(Number.isFinite(cpu) && cpu > 0 && cpu <= 1
            ? [flag("target-cpu-utilization", String(cpu))]
            : []),
          ...(Option.isSome(coolDown) ? [flag("cool-down-period", String(coolDown.value))] : []),
        ];
        steps.push({
          line: `gcloud compute instance-groups managed set-autoscaling ${target} ${flags.join(" ")}`,
          note: `オートスケーリングを更新 (${form.name})`,
        });
      }
    }

    return steps;
  },

  toCommand(form: InstanceGroupEditForm, projectId: string): string {
    return joinSteps(InstanceGroupEditForm.toSteps(form, projectId));
  },
} as const;

// --- VM ディスク接続・切断 ---

export type VmAttachDiskForm = Readonly<{
  instanceName: string;
  zone: Zone;
  disk: string;
}>;

export const VmAttachDiskForm = {
  create(instanceName: string, zone: Zone, disk = ""): VmAttachDiskForm {
    return { instanceName, zone, disk };
  },

  collectErrors(form: VmAttachDiskForm): FieldErrors<VmAttachDiskForm> {
    return collect<VmAttachDiskForm>([
      [
        "disk",
        form.disk.trim() === "" ? Option.some("接続するディスクを選択してください") : Option.none,
      ],
    ]);
  },

  toCommand(form: VmAttachDiskForm, projectId: string): string {
    return `gcloud compute instances attach-disk ${quote(form.instanceName)} ${flag("disk", form.disk.trim())} ${flag("zone", form.zone)} ${flag("project", projectId)}`;
  },
} as const;

export const VmDiskCommand = {
  detach(instanceName: string, diskName: string, zone: Zone, projectId: string): string {
    return `gcloud compute instances detach-disk ${quote(instanceName)} ${flag("disk", diskName)} ${flag("zone", zone)} ${flag("project", projectId)}`;
  },
} as const;

// --- インスタンス テンプレート複製 ---

export type InstanceTemplateCloneForm = Readonly<{
  name: string;
  machineType: MachineTypeName;
  bootDiskSize: string;
  bootDiskType: BootDiskType;
  network: string;
  sourceNetwork: string;
  subnet: string;
  tags: string;
  serviceAccount: string;
  imageFamily: string;
  imageProject: string;
  customImage: string;
  externalIp: boolean;
  provisioningModel: ProvisioningModel;
  metadata: Readonly<Record<string, string>>;
}>;

const cloneNameOf = (original: string): string => {
  const suffix = "-copy";
  const maxPrefix = 63 - suffix.length;
  const prefix = original.slice(0, maxPrefix).replace(/-+$/, "");
  return `${prefix}${suffix}`;
};

export const InstanceTemplateCloneForm = {
  from(template: InstanceTemplate): InstanceTemplateCloneForm {
    const isCustomImage =
      template.image.project === template.projectId || template.image.family === "";
    return {
      name: cloneNameOf(template.name),
      machineType: template.machineType,
      bootDiskSize: `${template.bootDisk.sizeGb}GB`,
      bootDiskType: template.bootDisk.type,
      network: template.network,
      sourceNetwork: template.network,
      subnet: Option.unwrapOr(template.subnet, ""),
      tags: template.tags.join(", "),
      serviceAccount: Option.unwrapOr(template.serviceAccount, ""),
      imageFamily: isCustomImage ? "" : template.image.family,
      imageProject: isCustomImage ? "" : template.image.project,
      customImage: isCustomImage ? template.image.name : "",
      externalIp: template.externalIp,
      provisioningModel: template.provisioningModel,
      metadata: template.metadata,
    };
  },

  collectErrors(form: InstanceTemplateCloneForm): FieldErrors<InstanceTemplateCloneForm> {
    return collect<InstanceTemplateCloneForm>([
      ["name", errorOf(ResourceName.parse(form.name))],
      ["bootDiskSize", errorOf(DiskSizeGb.parse(form.bootDiskSize))],
    ]);
  },

  toCommand(form: InstanceTemplateCloneForm, projectId: string): string {
    const tags = [...new Set(StringEx.splitList(form.tags))];
    const metaEntries = Object.entries(form.metadata);
    const flags: string[] = [
      flag("project", projectId),
      flag("machine-type", form.machineType),
      ...(form.provisioningModel !== ProvisioningModels.Standard
        ? [flag("provisioning-model", form.provisioningModel)]
        : []),
      ...(form.serviceAccount.trim() !== ""
        ? [flag("service-account", form.serviceAccount.trim())]
        : []),
      ...(form.network.trim() !== "" ? [flag("network", form.network.trim())] : []),
      ...(form.subnet !== "" && form.network === form.sourceNetwork
        ? [flag("subnet", form.subnet)]
        : []),
      ...(tags.length > 0 ? [flag("tags", tags.join(","))] : []),
      ...(form.externalIp ? [] : ["--no-address"]),
      ...(form.customImage !== ""
        ? [flag("image", form.customImage)]
        : form.imageFamily !== ""
          ? [flag("image-family", form.imageFamily), flag("image-project", form.imageProject)]
          : []),
      flag("boot-disk-size", form.bootDiskSize.trim()),
      flag("boot-disk-type", form.bootDiskType),
      ...(metaEntries.length > 0
        ? [flag("metadata", metaEntries.map(([k, v]) => `${k}=${v}`).join(","))]
        : []),
    ];
    return `gcloud compute instance-templates create ${quote(form.name)} ${flags.join(" ")}`;
  },
} as const;
