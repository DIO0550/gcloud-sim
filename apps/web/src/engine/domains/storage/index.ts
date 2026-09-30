import type { BucketLocation, StorageClass } from "@/engine/domains/catalog";
import { IamPolicy } from "@/engine/domains/iam-policy";
import type { JsonRecord } from "@/types/Json";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

export type StorageObject = Readonly<{
  name: string;
  size: number;
  contentType: string;
  updated: string;
  /** `objects update --storage-class` で変えたもの。無ければバケットの既定 */
  storageClass: Option<StorageClass>;
}>;

/** ライフサイクルの 1 ルール（`gsutil lifecycle set` / `buckets update --lifecycle-file`）。 */
export type LifecycleRule = Readonly<{
  action: Readonly<{ type: "Delete" } | { type: "SetStorageClass"; storageClass: string }>;
  condition: Readonly<{ age: number }>;
}>;

/** レガシー ACL の 1 件（`gsutil acl ch`）。均一なバケットレベルのアクセスでは持てない（E-013）。 */
export type AclEntry = Readonly<{ entity: string; role: "READER" | "WRITER" | "OWNER" }>;

export type Bucket = Readonly<{
  projectId: string;
  name: string;
  location: BucketLocation;
  storageClass: StorageClass;
  uniformBucketLevelAccess: boolean;
  publicAccessPrevention: boolean;
  versioning: boolean;
  lifecycleRules: readonly LifecycleRule[];
  acl: readonly AclEntry[];
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

/** `Bucket.create` に渡す材料。 */
export type BucketSeed = Readonly<{
  projectId: string;
  name: string;
  location: BucketLocation;
  storageClass: StorageClass;
  uniformBucketLevelAccess: boolean;
  publicAccessPrevention: boolean;
  timeCreated: string;
}>;

export const Bucket = {
  /**
   * 空のバケットを作る。名前の形式はここで検証する。
   *
   * @param seed 材料
   * @returns 空のポリシーとオブジェクト無しのバケット。名前の形式が悪ければ理由
   */
  create(seed: BucketSeed): Result<Bucket, string> {
    return Result.map(BucketName.parse(seed.name), (name) => ({
      ...seed,
      name,
      versioning: false,
      lifecycleRules: [],
      acl: [],
      iamPolicy: IamPolicy.Empty,
      objects: [],
    }));
  },

  withVersioning(bucket: Bucket, versioning: boolean): Bucket {
    return { ...bucket, versioning };
  },

  withLifecycleRules(bucket: Bucket, lifecycleRules: readonly LifecycleRule[]): Bucket {
    return { ...bucket, lifecycleRules };
  },

  withStorageClass(bucket: Bucket, storageClass: StorageClass): Bucket {
    return { ...bucket, storageClass };
  },

  withAccessSettings(
    bucket: Bucket,
    settings: Readonly<{
      uniformBucketLevelAccess: Option<boolean>;
      publicAccessPrevention: Option<boolean>;
    }>,
  ): Bucket {
    return {
      ...bucket,
      uniformBucketLevelAccess: Option.unwrapOr(
        settings.uniformBucketLevelAccess,
        bucket.uniformBucketLevelAccess,
      ),
      publicAccessPrevention: Option.unwrapOr(
        settings.publicAccessPrevention,
        bucket.publicAccessPrevention,
      ),
    };
  },

  /**
   * レガシー ACL を足す。均一なバケットレベルのアクセスが有効なら拒む（設計書 6.2 Bucket / E-013）。
   *
   * @param bucket 元
   * @param entry 足す ACL
   * @returns 足したバケット。UBLA が有効なら理由
   */
  withAcl(bucket: Bucket, entry: AclEntry): Result<Bucket, string> {
    if (bucket.uniformBucketLevelAccess) {
      return Result.err(
        `Cannot use ACLs on bucket gs://${bucket.name}: uniform bucket-level access is enabled. Use IAM (gcloud storage buckets add-iam-policy-binding) instead.`,
      );
    }
    const others = bucket.acl.filter((a) => a.entity !== entry.entity);
    return Result.ok({ ...bucket, acl: [...others, entry] });
  },

  /** オブジェクトの API 表現（`objects describe` / `ls -L`）。 */
  objectRecord(bucket: Bucket, object: StorageObject): JsonRecord {
    return {
      name: object.name,
      bucket: bucket.name,
      size: String(object.size),
      contentType: object.contentType,
      storageClass: Option.unwrapOr(object.storageClass, bucket.storageClass),
      updated: object.updated,
      selfLink: `https://www.googleapis.com/storage/v1/b/${bucket.name}/o/${encodeURIComponent(object.name)}`,
    };
  },

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
      versioning: { enabled: bucket.versioning },
      lifecycle: {
        rule: bucket.lifecycleRules.map((r) => ({ action: r.action, condition: r.condition })),
      },
      timeCreated: bucket.timeCreated,
      projectNumber: bucket.projectId,
      selfLink: `https://www.googleapis.com/storage/v1/b/${bucket.name}`,
    };
  },
} as const;
