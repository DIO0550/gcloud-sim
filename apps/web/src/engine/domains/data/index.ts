import type { Region, SqlDatabaseVersion, SqlTier } from "@/engine/domains/catalog";
import { ResourceName } from "@/engine/domains/compute";
import type { JsonRecord } from "@/types/Json";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

/** Cloud SQL インスタンス（`gcloud sql instances`）。 */
export type SqlInstance = Readonly<{
  projectId: string;
  name: string;
  region: Region;
  databaseVersion: SqlDatabaseVersion;
  tier: SqlTier;
  /** Cloud SQL のゾーンは `region-a` 等。作成時に決めて変えない */
  gceZone: string;
  ipAddress: string;
  state: "RUNNABLE";
  createTime: string;
}>;

export const SqlInstance = {
  /**
   * インスタンスを `RUNNABLE` で作る。名前の形式はここで検証する。
   *
   * @param seed 材料。IP は採番済み
   * @returns 作ったインスタンス。名前の形式が悪ければ理由
   */
  create(
    seed: Readonly<{
      projectId: string;
      name: string;
      region: Region;
      databaseVersion: SqlDatabaseVersion;
      tier: SqlTier;
      ipAddress: string;
      createTime: string;
    }>,
  ): Result<SqlInstance, string> {
    return Result.map(ResourceName.parse(seed.name), (name) => ({
      projectId: seed.projectId,
      name,
      region: seed.region,
      databaseVersion: seed.databaseVersion,
      tier: seed.tier,
      gceZone: `${seed.region}-a`,
      ipAddress: seed.ipAddress,
      state: "RUNNABLE",
      createTime: seed.createTime,
    }));
  },

  toRecord(instance: SqlInstance): JsonRecord {
    return {
      name: instance.name,
      project: instance.projectId,
      region: instance.region,
      gceZone: instance.gceZone,
      databaseVersion: instance.databaseVersion,
      settings: { tier: instance.tier, availabilityType: "ZONAL" },
      ipAddresses: [{ type: "PRIMARY", ipAddress: instance.ipAddress }],
      state: instance.state,
      createTime: instance.createTime,
      connectionName: `${instance.projectId}:${instance.region}:${instance.name}`,
    };
  },
} as const;

export type SqlBackup = Readonly<{
  projectId: string;
  instance: string;
  id: string;
  description: string;
  status: "SUCCESSFUL";
  windowStartTime: string;
}>;

export const SqlBackup = {
  /**
   * オンデマンドのバックアップを作る。id は通し番号から採番する。
   *
   * @param seed 対象・説明・時刻・通し番号
   * @returns 完了済みのバックアップ
   */
  create(
    seed: Readonly<{
      projectId: string;
      instance: string;
      description: string;
      windowStartTime: string;
      sequence: number;
    }>,
  ): SqlBackup {
    return {
      projectId: seed.projectId,
      instance: seed.instance,
      id: String(1700000000000 + seed.sequence),
      description: seed.description,
      status: "SUCCESSFUL",
      windowStartTime: seed.windowStartTime,
    };
  },

  toRecord(backup: SqlBackup): JsonRecord {
    return {
      id: backup.id,
      instance: backup.instance,
      type: "ON_DEMAND",
      status: backup.status,
      description: backup.description,
      windowStartTime: backup.windowStartTime,
      location: "asia",
    };
  },
} as const;

/** Pub/Sub のトピック・サブスクリプション名（3〜255 文字、英字始まり、`goog` 始まり不可）。 */
export const PubsubName = {
  parse(value: string): Result<string, string> {
    const valid = /^[A-Za-z][A-Za-z0-9\-_.~+%]{2,254}$/.test(value) && !value.startsWith("goog");
    return valid
      ? Result.ok(value)
      : Result.err(
          `Invalid resource name given (name=${value}). Refer to https://cloud.google.com/pubsub/docs/admin#resource_names for more information.`,
        );
  },
} as const;

export type PubsubTopic = Readonly<{
  projectId: string;
  name: string;
  /** `functions deploy --trigger-topic` が使う */
  createTime: string;
}>;

export const PubsubTopic = {
  create(seed: PubsubTopic): Result<PubsubTopic, string> {
    return Result.map(PubsubName.parse(seed.name), (name) => ({ ...seed, name }));
  },

  fullName(topic: PubsubTopic): string {
    return `projects/${topic.projectId}/topics/${topic.name}`;
  },

  toRecord(topic: PubsubTopic): JsonRecord {
    return { name: PubsubTopic.fullName(topic), messageStoragePolicy: {} };
  },
} as const;

export type PubsubSubscription = Readonly<{
  projectId: string;
  name: string;
  topic: string;
  ackDeadlineSeconds: number;
  /** push なら URL */
  pushEndpoint: Option<string>;
  createTime: string;
}>;

export const PubsubSubscription = {
  /**
   * サブスクリプションを作る。ack 期限の既定は 10 秒（本物と同じ）。
   *
   * @param seed 材料。トピックが存在することは呼び出し側が確かめる
   * @returns 作ったサブスクリプション。名前の形式が悪ければ理由
   */
  create(
    seed: Readonly<{
      projectId: string;
      name: string;
      topic: string;
      ackDeadlineSeconds: Option<number>;
      pushEndpoint: Option<string>;
      createTime: string;
    }>,
  ): Result<PubsubSubscription, string> {
    const deadline = Option.unwrapOr(seed.ackDeadlineSeconds, 10);
    if (!Number.isSafeInteger(deadline) || deadline < 10 || deadline > 600) {
      return Result.err("ACK deadline must be 10..600 seconds.");
    }
    if (
      seed.pushEndpoint.some &&
      !/^https:\/\/[a-z0-9.-]+(?:\/[^\s]*)?$/i.test(seed.pushEndpoint.value)
    ) {
      return Result.err("Push endpoint must be an HTTPS URL.");
    }
    return Result.map(PubsubName.parse(seed.name), (name) => ({
      projectId: seed.projectId,
      name,
      topic: seed.topic,
      ackDeadlineSeconds: Option.unwrapOr(seed.ackDeadlineSeconds, 10),
      pushEndpoint: seed.pushEndpoint,
      createTime: seed.createTime,
    }));
  },

  fullName(subscription: PubsubSubscription): string {
    return `projects/${subscription.projectId}/subscriptions/${subscription.name}`;
  },

  toRecord(subscription: PubsubSubscription): JsonRecord {
    return {
      name: PubsubSubscription.fullName(subscription),
      topic: `projects/${subscription.projectId}/topics/${subscription.topic}`,
      ackDeadlineSeconds: subscription.ackDeadlineSeconds,
      pushConfig: Option.isSome(subscription.pushEndpoint)
        ? { pushEndpoint: subscription.pushEndpoint.value }
        : {},
      messageRetentionDuration: "604800s",
      state: "ACTIVE",
    };
  },
} as const;
