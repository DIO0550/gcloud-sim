import type { Operation } from "@/engine/domains/operation";
import type { JsonRecord } from "@/types/Json";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

/**
 * 監査ログの 1 件（`gcloud logging read`）。オペレーション履歴から導出し、保存しない
 * （同じ情報を二重に持たない）。
 */
export type LogEntry = Readonly<{
  projectId: string;
  logName: string;
  timestamp: string;
  severity: "NOTICE";
  methodName: string;
  resourceName: string;
  principalEmail: string;
  insertId: string;
}>;

/** 収録しているログ名。`logging logs list` が出す。 */
export const LogNames = {
  Activity: "cloudaudit.googleapis.com/activity",
  DataAccess: "cloudaudit.googleapis.com/data_access",
  SystemEvent: "cloudaudit.googleapis.com/system_event",
  PolicyDenied: "cloudaudit.googleapis.com/policy",
  Flow: "compute.googleapis.com/vpc_flows",
  Firewall: "compute.googleapis.com/firewall",
} as const;

export const LogEntry = {
  /**
   * オペレーションを管理アクティビティ監査ログに写す。
   *
   * @param operation 元
   * @returns `v1.compute.instances.insert` のようなメソッド名を持つログ
   */
  fromOperation(operation: Operation): LogEntry {
    const resourceType = operation.targetLink.includes("/instances/")
      ? "instances"
      : operation.targetLink.includes("/disks/")
        ? "disks"
        : "resources";
    return {
      projectId: operation.projectId,
      logName: `projects/${operation.projectId}/logs/${encodeURIComponent(LogNames.Activity)}`,
      timestamp: operation.insertTime,
      severity: "NOTICE",
      methodName: `v1.compute.${resourceType}.${operation.operationType}`,
      resourceName: operation.targetLink.replace(
        /^https:\/\/www\.googleapis\.com\/compute\/v1\//,
        "",
      ),
      principalEmail: operation.user,
      insertId: operation.id,
    };
  },

  toRecord(entry: LogEntry): JsonRecord {
    return {
      insertId: entry.insertId,
      logName: entry.logName,
      protoPayload: {
        "@type": "type.googleapis.com/google.cloud.audit.AuditLog",
        authenticationInfo: { principalEmail: entry.principalEmail },
        methodName: entry.methodName,
        resourceName: entry.resourceName,
        serviceName: "compute.googleapis.com",
      },
      resource: { type: "gce_instance" },
      severity: entry.severity,
      timestamp: entry.timestamp,
    };
  },
} as const;

/** ログのシンク（`gcloud logging sinks create`）。 */
export type LogSink = Readonly<{
  projectId: string;
  name: string;
  destination: string;
  filter: string;
  writerIdentity: string;
  createTime: string;
}>;

const DestinationPrefixes = [
  "storage.googleapis.com/",
  "bigquery.googleapis.com/",
  "pubsub.googleapis.com/",
  "logging.googleapis.com/",
] as const;

export const LogSink = {
  /**
   * シンクを作る。転送先は Storage / BigQuery / Pub/Sub / Logging バケットの形だけを受ける。
   *
   * @param seed 材料。`writerIdentity` は採番済みのサービスアカウント
   * @returns 作ったシンク。転送先の形が悪ければ理由
   */
  create(seed: Omit<LogSink, "writerIdentity">, sequence: number): Result<LogSink, string> {
    const validDestination = DestinationPrefixes.some((p) => seed.destination.startsWith(p));
    if (!validDestination) {
      return Result.err(
        `Invalid value for [DESTINATION]: ${seed.destination}. Expected storage.googleapis.com/BUCKET, bigquery.googleapis.com/projects/P/datasets/D, or pubsub.googleapis.com/projects/P/topics/T.`,
      );
    }
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,99}$/.test(seed.name)) {
      return Result.err(`Invalid value for [SINK_NAME]: ${seed.name}.`);
    }
    return Result.ok({
      ...seed,
      writerIdentity: `serviceAccount:service-org-${sequence}@gcp-sa-logging.iam.gserviceaccount.com`,
    });
  },

  toRecord(sink: LogSink): JsonRecord {
    return {
      name: sink.name,
      destination: sink.destination,
      filter: sink.filter === "" ? undefined : sink.filter,
      writerIdentity: sink.writerIdentity,
      createTime: sink.createTime,
    };
  },
} as const;

/** `logging read` の `--freshness=1d` のような期間を秒にする。 */
export const Freshness = {
  parse(value: string): Option<number> {
    const match = /^(\d+)([smhd])$/.exec(value.trim());
    if (match === null) return Option.none;
    const amount = Number(match[1]);
    const unit: Readonly<Record<string, number>> = { s: 1, m: 60, h: 3600, d: 86400 };
    return Option.some(amount * (unit[match[2] ?? "s"] ?? 1));
  },
} as const;
