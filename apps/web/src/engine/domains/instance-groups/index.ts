import {
  type MachineTypeName,
  type PublicImage,
  type Region,
  type Zone,
  Zone as ZoneCatalog,
} from "@/engine/domains/catalog";
import {
  type BootDiskType,
  type InstanceSeed,
  type NetworkInterface,
  type ProvisioningModel,
  ResourceName,
} from "@/engine/domains/compute";
import type { JsonRecord } from "@/types/Json";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const projectBase = (projectId: string): string =>
  `https://www.googleapis.com/compute/v1/projects/${projectId}`;

/** インスタンステンプレート（`gcloud compute instance-templates`）。MIG が VM を作る材料。 */
export type InstanceTemplate = Readonly<{
  projectId: string;
  name: string;
  machineType: MachineTypeName;
  image: PublicImage;
  bootDisk: Readonly<{ sizeGb: number; type: BootDiskType }>;
  tags: readonly string[];
  network: string;
  subnet: Option<string>;
  /** 外部 IP を付けるか（`--no-address` なら偽） */
  externalIp: boolean;
  serviceAccount: Option<string>;
  scopes: readonly string[];
  preemptible: boolean;
  provisioningModel: ProvisioningModel;
  metadata: Readonly<Record<string, string>>;
  creationTimestamp: string;
}>;

export const InstanceTemplate = {
  /**
   * テンプレートを作る。名前の形式はここで検証する。
   *
   * @param seed 材料（名前以外はそのまま持つ）
   * @returns 作ったテンプレート。名前の形式が悪ければ理由
   */
  create(seed: InstanceTemplate): Result<InstanceTemplate, string> {
    return Result.map(ResourceName.parse(seed.name), (name) => ({ ...seed, name }));
  },

  selfLink(template: InstanceTemplate): string {
    return `${projectBase(template.projectId)}/global/instanceTemplates/${template.name}`;
  },

  /**
   * テンプレートから 1 台分の `Instance.create` の材料を作る。
   *
   * @param template テンプレート
   * @param placement 名前・ゾーン・NIC・サービスアカウント・時刻・通し番号（テンプレートに無いもの）
   * @returns `Instance.create` に渡す材料
   */
  toInstanceSeed(
    template: InstanceTemplate,
    placement: Readonly<{
      name: string;
      zone: Zone;
      networkInterface: NetworkInterface;
      serviceAccount: string;
      creationTimestamp: string;
      sequence: number;
    }>,
  ): InstanceSeed {
    return {
      projectId: template.projectId,
      name: placement.name,
      zone: placement.zone,
      machineType: template.machineType,
      networkInterface: placement.networkInterface,
      image: template.image,
      bootDisk: template.bootDisk,
      tags: template.tags,
      serviceAccount: placement.serviceAccount,
      scopes: template.scopes,
      preemptible: template.preemptible,
      provisioningModel: template.provisioningModel,
      metadata: template.metadata,
      creationTimestamp: placement.creationTimestamp,
      sequence: placement.sequence,
    };
  },

  toRecord(template: InstanceTemplate): JsonRecord {
    return {
      name: template.name,
      properties: {
        machineType: template.machineType,
        tags: { items: template.tags },
        disks: [
          {
            boot: true,
            autoDelete: true,
            initializeParams: {
              sourceImage: `projects/${template.image.project}/global/images/${template.image.name}`,
              diskSizeGb: String(template.bootDisk.sizeGb),
              diskType: template.bootDisk.type,
            },
          },
        ],
        networkInterfaces: [
          {
            network: template.network,
            subnetwork: Option.unwrapOr(template.subnet, undefined),
            accessConfigs: template.externalIp
              ? [{ type: "ONE_TO_ONE_NAT", name: "external-nat" }]
              : [],
          },
        ],
        scheduling: {
          preemptible: template.preemptible,
          provisioningModel: template.provisioningModel,
        },
        serviceAccounts: [
          { email: Option.unwrapOr(template.serviceAccount, "default"), scopes: template.scopes },
        ],
        metadata: {
          items: Object.entries(template.metadata).map(([key, value]) => ({ key, value })),
        },
      },
      creationTimestamp: template.creationTimestamp,
      selfLink: InstanceTemplate.selfLink(template),
    };
  },
} as const;

/** MIG のオートスケーリング設定（`set-autoscaling`）。 */
export type Autoscaling = Readonly<{
  minReplicas: number;
  maxReplicas: number;
  /** 0〜1 の目標 CPU 使用率 */
  targetCpuUtilization: number;
  coolDownPeriodSec: number;
}>;

export const Autoscaling = {
  /**
   * 設定を検証して作る。`max` は 1 以上で `min` 以上、目標使用率は 0〜1（本物と同じ）。
   *
   * @param seed `--max-num-replicas` / `--min-num-replicas` / `--target-cpu-utilization` / `--cool-down-period`
   * @returns 作った設定。範囲外なら理由
   */
  create(
    seed: Readonly<{
      maxReplicas: number;
      minReplicas: Option<number>;
      targetCpuUtilization: Option<number>;
      coolDownPeriodSec: Option<number>;
    }>,
  ): Result<Autoscaling, string> {
    const minReplicas = Option.unwrapOr(seed.minReplicas, 1);
    const cooldown = Option.unwrapOr(seed.coolDownPeriodSec, 60);
    if (
      !Number.isInteger(minReplicas) ||
      minReplicas < 0 ||
      !Number.isInteger(seed.maxReplicas) ||
      seed.maxReplicas > 100 ||
      !Number.isInteger(cooldown) ||
      cooldown < 0
    ) {
      return Result.err("Replica bounds must be integers 0..100; cooldown must be nonnegative.");
    }
    const target = Option.unwrapOr(seed.targetCpuUtilization, 0.6);
    if (seed.maxReplicas < 1 || seed.maxReplicas < minReplicas) {
      return Result.err(
        `Invalid value for [--max-num-replicas]: ${seed.maxReplicas}. Must be at least 1 and not less than --min-num-replicas (${minReplicas}).`,
      );
    }
    if (!Number.isFinite(target) || target <= 0 || target > 1) {
      return Result.err(
        `Invalid value for [--target-cpu-utilization]: ${target}. Must be a fraction between 0 and 1.`,
      );
    }
    return Result.ok({
      minReplicas,
      maxReplicas: seed.maxReplicas,
      targetCpuUtilization: target,
      coolDownPeriodSec: cooldown,
    });
  },
} as const;

/** マネージド インスタンス グループ（`gcloud compute instance-groups managed`）。 */
export type ManagedInstanceGroup = Readonly<{
  projectId: string;
  name: string;
  location: Zone | Region;
  template: string;
  targetSize: number;
  baseInstanceName: string;
  /** グループが作った VM の名前。ゾーンは `location`（リージョンならそのゾーンに分散） */
  instanceNames: readonly string[];
  namedPorts?: readonly Readonly<{ name: string; port: number }>[];
  autoscaling: Option<Autoscaling>;
  creationTimestamp: string;
}>;

export const ManagedInstanceGroup = {
  /**
   * グループを作る。名前の形式はここで検証し、ベース名の既定はグループ名。
   *
   * @param seed 材料。`instanceNames` は作った VM の名前（`memberNames` で決める）
   * @returns 作ったグループ。名前の形式が悪ければ理由
   */
  create(
    seed: Readonly<{
      projectId: string;
      name: string;
      location: Zone | Region;
      template: string;
      targetSize: number;
      baseInstanceName: Option<string>;
      instanceNames: readonly string[];
      creationTimestamp: string;
    }>,
  ): Result<ManagedInstanceGroup, string> {
    return Result.map(ResourceName.parse(seed.name), (name) => ({
      projectId: seed.projectId,
      name,
      location: seed.location,
      template: seed.template,
      targetSize: seed.targetSize,
      baseInstanceName: Option.unwrapOr(seed.baseInstanceName, name),
      instanceNames: seed.instanceNames,
      autoscaling: Option.none,
      creationTimestamp: seed.creationTimestamp,
    }));
  },

  /**
   * グループが作る VM の名前（`ベース名-xxxx`）。通し番号から決めるので衝突しない。
   *
   * @param baseInstanceName ベース名
   * @param sequence World の通し番号
   * @param count 台数
   * @returns `count` 個の名前
   */
  memberNames(baseInstanceName: string, sequence: number, count: number): readonly string[] {
    return Array.from({ length: count }, (_, i) => {
      const suffix = (sequence * 7 + i).toString(36).padStart(4, "0").slice(-4);
      return `${baseInstanceName}-${suffix}`;
    });
  },

  /**
   * i 台目を置くゾーン。ゾーングループはそのゾーン、リージョングループはゾーンを順に回す。
   *
   * @param location グループの場所
   * @param index 0 始まり
   * @returns ゾーン
   */
  zoneFor(location: Zone | Region, index: number): Zone {
    const zones = ZoneCatalog.all().filter((z) => ZoneCatalog.region(z) === location);
    const zoned = ZoneCatalog.parse(location);
    if (Option.isSome(zoned)) return zoned.value;
    return zones[index % zones.length] ?? (location as Zone);
  },

  withAutoscaling(group: ManagedInstanceGroup, autoscaling: Autoscaling): ManagedInstanceGroup {
    return { ...group, autoscaling: Option.some(autoscaling) };
  },

  selfLink(group: ManagedInstanceGroup): string {
    const zoned = Option.isSome(ZoneCatalog.parse(group.location));
    const scope = zoned ? `zones/${group.location}` : `regions/${group.location}`;
    return `${projectBase(group.projectId)}/${scope}/instanceGroupManagers/${group.name}`;
  },

  toRecord(group: ManagedInstanceGroup): JsonRecord {
    const base = projectBase(group.projectId);
    const zoned = Option.isSome(ZoneCatalog.parse(group.location));
    return {
      name: group.name,
      baseInstanceName: group.baseInstanceName,
      instanceTemplate: `${base}/global/instanceTemplates/${group.template}`,
      targetSize: group.targetSize,
      namedPorts: group.namedPorts ?? [],
      zone: zoned ? `${base}/zones/${group.location}` : undefined,
      region: zoned ? undefined : `${base}/regions/${group.location}`,
      instanceGroup: `${base}/${zoned ? "zones" : "regions"}/${group.location}/instanceGroups/${group.name}`,
      autoscaled: Option.isSome(group.autoscaling) ? "yes" : "no",
      autoscaling: Option.isSome(group.autoscaling)
        ? {
            minNumReplicas: group.autoscaling.value.minReplicas,
            maxNumReplicas: group.autoscaling.value.maxReplicas,
            cpuUtilization: { utilizationTarget: group.autoscaling.value.targetCpuUtilization },
            coolDownPeriodSec: group.autoscaling.value.coolDownPeriodSec,
          }
        : undefined,
      status: { isStable: true },
      creationTimestamp: group.creationTimestamp,
      selfLink: ManagedInstanceGroup.selfLink(group),
    };
  },
} as const;
