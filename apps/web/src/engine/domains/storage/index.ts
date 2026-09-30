import type { BucketLocation, StorageClass } from "@/engine/domains/catalog";
import type { IamPolicy } from "@/engine/domains/iam-policy";
import type { JsonRecord } from "@/types/Json";
import { Result } from "@/utils/Result";

export type StorageObject = Readonly<{
  name: string;
  size: number;
  contentType: string;
  updated: string;
}>;

export type Bucket = Readonly<{
  projectId: string;
  name: string;
  location: BucketLocation;
  storageClass: StorageClass;
  uniformBucketLevelAccess: boolean;
  publicAccessPrevention: boolean;
  iamPolicy: IamPolicy;
  objects: readonly StorageObject[];
  timeCreated: string;
}>;

export const BucketName = {
  /**
   * バケット名を検証する（設計書 6.2 Bucket: 3〜63 文字、小文字・数字・ハイフン・ドット、`goog` 始まり不可）。
   *
   * @param value `gs://` を落とした綴り
   * @returns 形式を満たせばそのまま。満たさなければ理由
   */
  parse(value: string): Result<string, string> {
    const validChars = /^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/.test(value);
    if (!validChars) {
      return Result.err(
        `Invalid bucket name: '${value}'. Bucket names must contain only lowercase letters, numbers, dashes (-), underscores (_), and dots (.), be between 3 and 63 characters, and start and end with a number or letter.`,
      );
    }
    if (value.startsWith("goog") || value.includes("google")) {
      return Result.err(
        `Invalid bucket name: '${value}'. Bucket names cannot begin with the "goog" prefix or contain "google".`,
      );
    }
    return Result.ok(value);
  },
} as const;

/** `gs://bucket/path` の分解。 */
export type GsUrl = Readonly<{ bucket: string; object: string }>;

export const GsUrl = {
  /**
   * `gs://` URL を分解する。
   *
   * @param value `gs://bucket` または `gs://bucket/dir/file`
   * @returns バケット名とオブジェクト名（バケットだけなら空文字）。`gs://` で始まらなければ `err`
   */
  parse(value: string): Result<GsUrl, string> {
    if (!value.startsWith("gs://")) {
      return Result.err(`Invalid Cloud Storage URL: ${value}. Expected gs://BUCKET[/OBJECT].`);
    }
    const rest = value.slice("gs://".length);
    const slash = rest.indexOf("/");
    if (slash === -1) return Result.ok({ bucket: rest, object: "" });
    return Result.ok({ bucket: rest.slice(0, slash), object: rest.slice(slash + 1) });
  },

  isGsUrl(value: string): boolean {
    return value.startsWith("gs://");
  },
} as const;

export const Bucket = {
  withObject(bucket: Bucket, object: StorageObject): Bucket {
    const others = bucket.objects.filter((o) => o.name !== object.name);
    return { ...bucket, objects: [...others, object] };
  },

  withoutObject(bucket: Bucket, name: string): Bucket {
    return { ...bucket, objects: bucket.objects.filter((o) => o.name !== name) };
  },

  withPolicy(bucket: Bucket, iamPolicy: IamPolicy): Bucket {
    return { ...bucket, iamPolicy };
  },

  toRecord(bucket: Bucket): JsonRecord {
    return {
      name: bucket.name,
      location: bucket.location,
      storageClass: bucket.storageClass,
      iamConfiguration: {
        uniformBucketLevelAccess: { enabled: bucket.uniformBucketLevelAccess },
        publicAccessPrevention: bucket.publicAccessPrevention ? "enforced" : "inherited",
      },
      timeCreated: bucket.timeCreated,
      projectNumber: bucket.projectId,
      selfLink: `https://www.googleapis.com/storage/v1/b/${bucket.name}`,
    };
  },
} as const;
