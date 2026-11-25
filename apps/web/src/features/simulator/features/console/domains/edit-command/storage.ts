import type { BucketLocation, StorageClass } from "@/engine/domains/catalog";
import type { Bucket } from "@/engine/domains/storage";
import type { Protection } from "@/engine/domains/storage-lab/model";
import {
  collect,
  type FieldErrors,
  flag,
} from "@/features/simulator/features/console/domains/equivalent-command";
import { Option } from "@/utils/Option";

export type CommandStep = Readonly<{ line: string; note: string }>;

const NoChangesComment = "# 変更された項目がありません";

const Units: Readonly<Record<string, number>> = { s: 1, m: 60, h: 3600, d: 86400 };

/** 秒数を `7d` / `1h` / `30m` / `10s` / `0` のような期間文字列に整える。 */
const formatDuration = (seconds: number, emptyZero: boolean): string => {
  if (seconds === 0) return emptyZero ? "" : "0";
  if (seconds % 86400 === 0) return `${seconds / 86400}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
};

/** 期間文字列（`0`, `7d`, `1h`, `30m`, `60s`）を秒数へ変換する。不正なら `none`。 */
const parseDuration = (raw: string): Option<number> => {
  const trimmed = raw.trim();
  if (trimmed === "0") return Option.some(0);
  const match = /^(\d+)([smhd])$/.exec(trimmed);
  if (match === null) return Option.none;
  const seconds = Number(match[1]) * (Units[match[2] ?? ""] ?? 0);
  return Number.isSafeInteger(seconds) && seconds >= 1 ? Option.some(seconds) : Option.none;
};

/** Cloud Storage バケット編集フォームの値。名前・ロケーションは作成後に変更不可。 */
export type BucketEditForm = Readonly<{
  name: string;
  location: BucketLocation;
  storageClass: StorageClass;
  uniformAccess: boolean;
  publicAccessPrevention: boolean;
  versioning: boolean;
  softDeleteDuration: string;
  retentionPeriod: string;
  retentionLocked: boolean;
  original: Readonly<{
    storageClass: StorageClass;
    uniformAccess: boolean;
    publicAccessPrevention: boolean;
    versioning: boolean;
    softDeleteSeconds: number;
    retentionSeconds: number;
  }>;
}>;

export const BucketEditForm = {
  /** 既存のバケットと保護設定から編集フォームの初期値を作る。 */
  fromBucket(bucket: Bucket, protection: Protection): BucketEditForm {
    return {
      name: bucket.name,
      location: bucket.location,
      storageClass: bucket.storageClass,
      uniformAccess: bucket.uniformBucketLevelAccess,
      publicAccessPrevention: bucket.publicAccessPrevention,
      versioning: bucket.versioning,
      softDeleteDuration: formatDuration(protection.softDelete, false),
      retentionPeriod: formatDuration(protection.retention, true),
      retentionLocked: protection.locked,
      original: {
        storageClass: bucket.storageClass,
        uniformAccess: bucket.uniformBucketLevelAccess,
        publicAccessPrevention: bucket.publicAccessPrevention,
        versioning: bucket.versioning,
        softDeleteSeconds: protection.softDelete,
        retentionSeconds: protection.retention,
      },
    };
  },

  /** 既定の空フォーム（`useCreateForm` の初期ファクトリ用）。 */
  empty(): BucketEditForm {
    return {
      name: "",
      location: "ASIA-NORTHEAST1",
      storageClass: "STANDARD",
      uniformAccess: true,
      publicAccessPrevention: true,
      versioning: false,
      softDeleteDuration: "7d",
      retentionPeriod: "",
      retentionLocked: false,
      original: {
        storageClass: "STANDARD",
        uniformAccess: true,
        publicAccessPrevention: true,
        versioning: false,
        softDeleteSeconds: 604800,
        retentionSeconds: 0,
      },
    };
  },

  /** 論理削除と保持期間の入力を検証する。 */
  collectErrors(form: BucketEditForm): FieldErrors<BucketEditForm> {
    const soft = parseDuration(form.softDeleteDuration);
    const softError: Option<string> = !Option.isSome(soft)
      ? Option.some("0 または 7d〜89d の形式で指定してください（例: 7d, 30d, 0）")
      : soft.value !== 0 && (soft.value < 604800 || soft.value >= 7776000)
        ? Option.some("論理削除の保持期間は 0（無効）または 7d 以上 90d 未満で指定してください")
        : Option.none;

    const trimmedRetention = form.retentionPeriod.trim();
    const retentionError: Option<string> = (() => {
      if (trimmedRetention === "" || trimmedRetention === "0") {
        return form.retentionLocked
          ? Option.some("ロック済みの保持ポリシーは解除できません")
          : Option.none;
      }
      const parsed = parseDuration(trimmedRetention);
      if (!Option.isSome(parsed) || parsed.value === 0) {
        return Option.some("1d, 30d, 1h のような正の期間で指定してください（空欄で解除）");
      }
      if (parsed.value >= 3155760000) {
        return Option.some("保持期間が上限を超えています");
      }
      if (form.retentionLocked && parsed.value < form.original.retentionSeconds) {
        return Option.some("ロック済みの保持ポリシーは短縮できません");
      }
      return Option.none;
    })();

    return collect<BucketEditForm>([
      ["softDeleteDuration", softError],
      ["retentionPeriod", retentionError],
    ]);
  },

  /** 変更された項目だけを含む `gcloud storage buckets update` のステップを返す。 */
  toSteps(form: BucketEditForm, projectId: string): readonly CommandStep[] {
    const flags: string[] = [];
    if (form.storageClass !== form.original.storageClass) {
      flags.push(flag("default-storage-class", form.storageClass));
    }
    if (form.uniformAccess !== form.original.uniformAccess) {
      flags.push(
        form.uniformAccess ? "--uniform-bucket-level-access" : "--no-uniform-bucket-level-access",
      );
    }
    if (form.publicAccessPrevention !== form.original.publicAccessPrevention) {
      flags.push(
        form.publicAccessPrevention
          ? "--public-access-prevention"
          : "--no-public-access-prevention",
      );
    }
    if (form.versioning !== form.original.versioning) {
      flags.push(form.versioning ? "--versioning" : "--no-versioning");
    }
    const soft = parseDuration(form.softDeleteDuration);
    if (!Option.isSome(soft) || soft.value !== form.original.softDeleteSeconds) {
      flags.push(flag("soft-delete-duration", form.softDeleteDuration.trim()));
    }
    const trimmedRetention = form.retentionPeriod.trim();
    if (trimmedRetention === "" || trimmedRetention === "0") {
      if (form.original.retentionSeconds > 0) {
        flags.push("--clear-retention-period");
      }
    } else {
      const parsed = parseDuration(trimmedRetention);
      if (!Option.isSome(parsed) || parsed.value !== form.original.retentionSeconds) {
        flags.push(flag("retention-period", trimmedRetention));
      }
    }
    if (flags.length === 0) return [];
    return [
      {
        line: [
          "gcloud storage buckets update",
          `gs://${form.name}`,
          flag("project", projectId),
          ...flags,
        ].join(" "),
        note: `バケットを更新 (${form.name})`,
      },
    ];
  },

  /** 同等のコマンドライン表示用。変更が無ければ案内コメントを返す。 */
  toCommand(form: BucketEditForm, projectId: string): string {
    const steps = BucketEditForm.toSteps(form, projectId);
    return steps.length === 0 ? NoChangesComment : steps.map((s) => s.line).join("\n");
  },
} as const;

// --- オブジェクト（アップロード風・フォルダ作成・編集・削除） ---

const ContentTypeByExt: Readonly<Record<string, string>> = {
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  html: "text/html",
  css: "text/css",
  js: "application/javascript",
  json: "application/json",
  xml: "application/xml",
  yaml: "application/yaml",
  yml: "application/yaml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  pdf: "application/pdf",
  zip: "application/zip",
  gz: "application/gzip",
};

/** 拡張子から Content-Type を推定する（不明なら application/octet-stream）。 */
export const guessContentType = (fileName: string): string => {
  const ext = fileName.trim().split(".").at(-1)?.toLowerCase() ?? "";
  return ContentTypeByExt[ext] ?? "application/octet-stream";
};

const normalizeObjectPath = (prefix: string, rawName: string): string => {
  const cleanName = rawName.trim().replace(/^\/+/, "");
  return `${prefix}${cleanName}`;
};

/** 疑似アップロードフォーム（実際の中身は送らず、gcloud storage cp でダミーオブジェクトを登録）。 */
export type StorageObjectUploadForm = Readonly<{
  bucket: string;
  prefix: string;
  fileName: string;
  contentType: string;
}>;

export const StorageObjectUploadForm = {
  create(bucket: string, prefix = ""): StorageObjectUploadForm {
    return { bucket, prefix, fileName: "", contentType: "" };
  },

  collectErrors(form: StorageObjectUploadForm): FieldErrors<StorageObjectUploadForm> {
    const trimmed = form.fileName.trim();
    const error: Option<string> =
      trimmed === ""
        ? Option.some("ファイル名を入力してください（例: index.html, data/sample.csv）")
        : trimmed.endsWith("/")
          ? Option.some("ファイル名は / で終われません（フォルダ作成を使ってください）")
          : /\s/.test(trimmed) || trimmed.includes("..")
            ? Option.some("空白や .. は使えません")
            : Option.none;
    return collect<StorageObjectUploadForm>([["fileName", error]]);
  },

  toSteps(form: StorageObjectUploadForm, projectId: string): readonly CommandStep[] {
    const objectPath = normalizeObjectPath(form.prefix, form.fileName);
    const localName =
      objectPath
        .split("/")
        .filter((s) => s !== "")
        .at(-1) ?? "object";
    const url = `gs://${form.bucket}/${objectPath}`;
    const steps: CommandStep[] = [
      {
        line: `gcloud storage cp ./${localName} ${url} ${flag("project", projectId)}`,
        note: `オブジェクトをアップロード (${objectPath})`,
      },
    ];
    const ct = form.contentType.trim() || guessContentType(localName);
    if (ct !== "application/octet-stream") {
      steps.push({
        line: `gcloud storage objects update ${url} ${flag("content-type", ct)} ${flag("project", projectId)}`,
        note: `Content-Type を設定 (${ct})`,
      });
    }
    return steps;
  },

  toCommand(form: StorageObjectUploadForm, projectId: string): string {
    return StorageObjectUploadForm.toSteps(form, projectId)
      .map((s) => s.line)
      .join("\n");
  },
} as const;

/** フォルダ作成フォーム（プレースホルダー `.keep` を配置して仮想フォルダを作る）。 */
export type StorageFolderCreateForm = Readonly<{
  bucket: string;
  prefix: string;
  folderName: string;
}>;

export const StorageFolderCreateForm = {
  create(bucket: string, prefix = ""): StorageFolderCreateForm {
    return { bucket, prefix, folderName: "" };
  },

  collectErrors(form: StorageFolderCreateForm): FieldErrors<StorageFolderCreateForm> {
    const trimmed = form.folderName.trim().replace(/^\/+|\/+$/g, "");
    const error: Option<string> =
      trimmed === ""
        ? Option.some("フォルダ名を入力してください（例: images）")
        : /\s/.test(trimmed) || trimmed.includes("..")
          ? Option.some("空白や .. は使えません")
          : Option.none;
    return collect<StorageFolderCreateForm>([["folderName", error]]);
  },

  toCommand(form: StorageFolderCreateForm, projectId: string): string {
    const folder = form.folderName.trim().replace(/^\/+|\/+$/g, "");
    return `gcloud storage cp .keep gs://${form.bucket}/${form.prefix}${folder}/.keep ${flag("project", projectId)}`;
  },
} as const;

/** オブジェクト編集フォーム（ストレージクラス・Content-Type を gcloud storage objects update で更新）。 */
export type StorageObjectEditForm = Readonly<{
  bucket: string;
  name: string;
  storageClass: StorageClass;
  contentType: string;
  original: Readonly<{
    storageClass: StorageClass;
    contentType: string;
  }>;
}>;

export const StorageObjectEditForm = {
  fromObject(
    bucket: Bucket,
    object: Readonly<{ name: string; contentType: string; storageClass: Option<StorageClass> }>,
  ): StorageObjectEditForm {
    const currentClass = Option.unwrapOr(object.storageClass, bucket.storageClass);
    return {
      bucket: bucket.name,
      name: object.name,
      storageClass: currentClass,
      contentType: object.contentType,
      original: {
        storageClass: currentClass,
        contentType: object.contentType,
      },
    };
  },

  empty(): StorageObjectEditForm {
    return {
      bucket: "",
      name: "",
      storageClass: "STANDARD",
      contentType: "application/octet-stream",
      original: { storageClass: "STANDARD", contentType: "application/octet-stream" },
    };
  },

  collectErrors(form: StorageObjectEditForm): FieldErrors<StorageObjectEditForm> {
    return collect<StorageObjectEditForm>([
      [
        "contentType",
        form.contentType.trim() === ""
          ? Option.some("Content-Type を入力してください（例: text/plain）")
          : Option.none,
      ],
    ]);
  },

  toSteps(form: StorageObjectEditForm, projectId: string): readonly CommandStep[] {
    const flags: string[] = [];
    if (form.storageClass !== form.original.storageClass) {
      flags.push(flag("storage-class", form.storageClass));
    }
    if (form.contentType.trim() !== form.original.contentType) {
      flags.push(flag("content-type", form.contentType.trim()));
    }
    if (flags.length === 0) return [];
    return [
      {
        line: [
          "gcloud storage objects update",
          `gs://${form.bucket}/${form.name}`,
          flag("project", projectId),
          ...flags,
        ].join(" "),
        note: `オブジェクトを更新 (${form.name})`,
      },
    ];
  },

  toCommand(form: StorageObjectEditForm, projectId: string): string {
    const steps = StorageObjectEditForm.toSteps(form, projectId);
    return steps.length === 0 ? NoChangesComment : steps.map((s) => s.line).join("\n");
  },
} as const;

export const deleteObjectCommand = (
  bucket: string,
  objectName: string,
  projectId: string,
): string => `gcloud storage rm gs://${bucket}/${objectName} ${flag("project", projectId)} --quiet`;
