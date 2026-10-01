import type { FunctionRuntime, Region } from "@/engine/domains/catalog";
import { ResourceName } from "@/engine/domains/compute";
import type { JsonRecord } from "@/types/Json";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

/** Cloud Functions のトリガー。HTTP か Pub/Sub トピック。 */
export type FunctionTrigger =
  | Readonly<{ kind: "http" }>
  | Readonly<{ kind: "topic"; topic: string }>;

export type CloudFunction = Readonly<{
  projectId: string;
  name: string;
  region: Region;
  runtime: FunctionRuntime;
  entryPoint: string;
  trigger: FunctionTrigger;
  /** HTTP トリガーで未認証呼び出しを許すか */
  allowUnauthenticated: boolean;
  memoryMb: number;
  updateTime: string;
  /** deploy のたびに上がる。`describe` の versionId */
  versionId: number;
}>;

export type CloudFunctionSeed = Readonly<{
  projectId: string;
  name: string;
  region: Region;
  runtime: FunctionRuntime;
  entryPoint: Option<string>;
  trigger: FunctionTrigger;
  allowUnauthenticated: boolean;
  memoryMb: Option<number>;
  updateTime: string;
  /** 再デプロイなら前の定義。versionId を継ぐ */
  previous: Option<CloudFunction>;
}>;

export const CloudFunction = {
  /**
   * 関数をデプロイした状態を作る。エントリポイントの既定は関数名、メモリは 256 MB（本物と同じ）。
   *
   * @param seed 材料
   * @returns 作った関数。名前の形式が悪ければ理由
   */
  create(seed: CloudFunctionSeed): Result<CloudFunction, string> {
    return Result.map(ResourceName.parse(seed.name), (name) => ({
      projectId: seed.projectId,
      name,
      region: seed.region,
      runtime: seed.runtime,
      entryPoint: Option.unwrapOr(seed.entryPoint, name),
      trigger: seed.trigger,
      allowUnauthenticated: seed.allowUnauthenticated,
      memoryMb: Option.unwrapOr(seed.memoryMb, 256),
      updateTime: seed.updateTime,
      versionId: Option.isSome(seed.previous) ? seed.previous.value.versionId + 1 : 1,
    }));
  },

  fullName(fn: CloudFunction): string {
    return `projects/${fn.projectId}/locations/${fn.region}/functions/${fn.name}`;
  },

  /** HTTP トリガーの URL。トピックトリガーは持たない。 */
  url(fn: CloudFunction): Option<string> {
    return fn.trigger.kind === "http"
      ? Option.some(`https://${fn.region}-${fn.projectId}.cloudfunctions.net/${fn.name}`)
      : Option.none;
  },

  toRecord(fn: CloudFunction): JsonRecord {
    const url = CloudFunction.url(fn);
    return {
      name: CloudFunction.fullName(fn),
      state: "ACTIVE",
      environment: "GEN_2",
      buildConfig: { runtime: fn.runtime, entryPoint: fn.entryPoint },
      serviceConfig: {
        availableMemory: `${fn.memoryMb}M`,
        uri: Option.unwrapOr(url, undefined),
        ingressSettings: "ALLOW_ALL",
      },
      eventTrigger:
        fn.trigger.kind === "topic"
          ? {
              eventType: "google.cloud.pubsub.topic.v1.messagePublished",
              pubsubTopic: `projects/${fn.projectId}/topics/${fn.trigger.topic}`,
            }
          : undefined,
      updateTime: fn.updateTime,
      versionId: String(fn.versionId),
    };
  },
} as const;

/** App Engine アプリケーション。プロジェクトに 1 つで、リージョンは変えられない。 */
export type AppEngineApp = Readonly<{
  projectId: string;
  region: Region;
  createTime: string;
}>;

export const AppEngineApp = {
  create(seed: AppEngineApp): AppEngineApp {
    return seed;
  },

  defaultHostname(app: AppEngineApp): string {
    return `${app.projectId}.an.r.appspot.com`;
  },

  toRecord(app: AppEngineApp): JsonRecord {
    return {
      name: `apps/${app.projectId}`,
      id: app.projectId,
      locationId: app.region,
      servingStatus: "SERVING",
      defaultHostname: AppEngineApp.defaultHostname(app),
      codeBucket: `staging.${app.projectId}.appspot.com`,
      createTime: app.createTime,
    };
  },
} as const;

/** App Engine のバージョン。`app deploy` のたびに 1 つ増え、トラフィックの配分を持つ。 */
export type AppVersion = Readonly<{
  projectId: string;
  service: string;
  id: string;
  runtime: string;
  /** 0〜1。サービス内で合計 1 */
  trafficSplit: number;
  createTime: string;
}>;

export const AppVersion = {
  /**
   * バージョン id の綴り。`app deploy` は `--version` が無ければ時刻から作る（本物と同じ形）。
   *
   * @param now デプロイ時刻（ISO）
   * @returns `20260930t140231` の形
   */
  idFromTime(now: string): string {
    const stamp = now
      .replace(/[-:]/g, "")
      .replace(/\.\d+Z$/, "")
      .replace("T", "t");
    return stamp.toLowerCase();
  },

  toRecord(version: AppVersion): JsonRecord {
    return {
      id: version.id,
      service: version.service,
      runtime: version.runtime,
      traffic_split: version.trafficSplit,
      servingStatus: "SERVING",
      createTime: version.createTime,
      versionUrl: `https://${version.id}-dot-${version.service}-dot-${version.projectId}.an.r.appspot.com`,
    };
  },
} as const;

/** `--splits=v1=0.5,v2=0.5` の配分。合計が 1（または 100）でなければ拒む。 */
export const TrafficSplit = {
  /**
   * 配分を解釈する。値は 0〜1 の割合か 0〜100 のパーセント（合計で判定する）。
   *
   * @param raw バージョン id → 値の綴り
   * @returns 割合に正規化した配分。合計が 1 でも 100 でもなければ理由
   */
  parse(raw: Readonly<Record<string, string>>): Result<Readonly<Record<string, number>>, string> {
    const entries = Object.entries(raw).map(([id, value]) => [id, Number(value)] as const);
    const invalid = entries.find(([, v]) => !Number.isFinite(v) || v < 0);
    if (invalid !== undefined) {
      return Result.err(`Invalid value for [--splits]: ${invalid[0]}=${raw[invalid[0]]}.`);
    }
    const total = entries.reduce((sum, [, v]) => sum + v, 0);
    const scale = Math.abs(total - 1) < 1e-9 ? 1 : Math.abs(total - 100) < 1e-9 ? 100 : 0;
    if (scale === 0) {
      return Result.err(
        `Traffic splits must sum to 1 (or 100 as percentages); got ${total}. Example: --splits=v1=0.5,v2=0.5`,
      );
    }
    return Result.ok(Object.fromEntries(entries.map(([id, v]) => [id, v / scale])));
  },
} as const;
