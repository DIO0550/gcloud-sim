import { type ReactElement, useRef, useState } from "react";
import { Checkbox } from "@/components/Checkbox";
import { Select } from "@/components/Select";

import { BucketLocation, StorageClasses } from "@/engine/domains/catalog";
import type { Bucket, StorageObject } from "@/engine/domains/storage";
import { protectionFor } from "@/engine/domains/storage-lab/model";
import { World } from "@/engine/domains/world";
import {
  CreateFormSection,
  Field,
  PrimaryButton,
  ResourceTable,
  ScreenTitle,
  SecondaryButton,
  TextInput,
} from "@/features/simulator/features/console/components/ConsoleParts";
import {
  BucketEditForm,
  BucketIamGrantForm,
  BucketIamRoles,
  deleteObjectCommand,
  guessContentType,
  StorageFolderCreateForm,
  StorageObjectEditForm,
  StorageObjectUploadForm,
} from "@/features/simulator/features/console/domains/edit-command/storage";
import {
  BucketCreateForm,
  DeleteCommand,
} from "@/features/simulator/features/console/domains/equivalent-command";
import { useCreateForm } from "@/features/simulator/features/console/hooks/use-create-form";
import type { ScreenProps } from "@/features/simulator/features/console/types/screen-props";
import { Option } from "@/utils/Option";

const locationLabel = (location: BucketLocation): string => {
  switch (location) {
    case "ASIA":
      return "ASIA（マルチリージョン）";
    case "US":
      return "US（マルチリージョン）";
    case "EU":
      return "EU（マルチリージョン）";
    case "ASIA1":
      return "ASIA1（デュアルリージョン: 東京/大阪）";
    case "NAM4":
      return "NAM4（デュアルリージョン: アイオワ/サウスカロライナ）";
    case "EUR4":
      return "EUR4（デュアルリージョン: フィンランド/オランダ）";
    case "ASIA-NORTHEAST1":
      return "ASIA-NORTHEAST1（リージョン: 東京）";
    case "ASIA-NORTHEAST2":
      return "ASIA-NORTHEAST2（リージョン: 大阪）";
    case "US-CENTRAL1":
      return "US-CENTRAL1（リージョン: アイオワ）";
    case "US-EAST1":
      return "US-EAST1（リージョン: サウスカロライナ）";
    case "EUROPE-WEST1":
      return "EUROPE-WEST1（リージョン: ベルギー）";
  }
};

type BrowserRow =
  | Readonly<{ kind: "folder"; name: string; prefix: string }>
  | Readonly<{ kind: "object"; displayName: string; object: StorageObject }>;

/** 現在のプレフィックス配下の直下フォルダとオブジェクトに整理する。 */
const buildBrowserRows = (
  objects: readonly StorageObject[],
  prefix: string,
): readonly BrowserRow[] => {
  const folderSet = new Set<string>();
  const directObjects: BrowserRow[] = [];
  for (const obj of objects) {
    if (!obj.name.startsWith(prefix)) continue;
    const rest = obj.name.slice(prefix.length);
    if (rest === "") continue;
    const slash = rest.indexOf("/");
    if (slash !== -1) {
      folderSet.add(rest.slice(0, slash + 1));
    } else {
      directObjects.push({ kind: "object", displayName: rest, object: obj });
    }
  }
  const folders: BrowserRow[] = [...folderSet]
    .toSorted()
    .map((name) => ({ kind: "folder", name, prefix: `${prefix}${name}` }));
  return [...folders, ...directObjects];
};

const formatSize = (bytes: number): string =>
  bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${bytes} B`;

/** バケット詳細（オブジェクト一覧・疑似アップロード・フォルダ作成・オブジェクト編集/削除）。 */
const BucketObjectsView = ({
  bucket,
  projectId,
  handlers,
  outcome,
  onBack,
  onOpenPermissions,
  onEditBucket,
}: Readonly<{
  bucket: Bucket;
  projectId: string;
  handlers: ScreenProps["handlers"];
  outcome: ScreenProps["outcome"];
  onBack: () => void;
  onOpenPermissions: () => void;
  onEditBucket: () => void;
}>): ReactElement => {
  const [prefix, setPrefix] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadSeed = (): StorageObjectUploadForm =>
    StorageObjectUploadForm.create(bucket.name, prefix);
  const folderSeed = (): StorageFolderCreateForm =>
    StorageFolderCreateForm.create(bucket.name, prefix);

  const uploadEditor = useCreateForm(StorageObjectUploadForm, uploadSeed, false, outcome);
  const folderEditor = useCreateForm(StorageFolderCreateForm, folderSeed, false, outcome);
  const objEditEditor = useCreateForm(
    StorageObjectEditForm,
    StorageObjectEditForm.empty,
    false,
    outcome,
  );

  const uploadForm = Option.unwrapOr(uploadEditor.form, uploadSeed());
  const folderForm = Option.unwrapOr(folderEditor.form, folderSeed());
  const objEditForm = Option.unwrapOr(objEditEditor.form, StorageObjectEditForm.empty());
  const uploadSteps = StorageObjectUploadForm.toSteps(uploadForm, projectId);
  const objEditSteps = StorageObjectEditForm.toSteps(objEditForm, projectId);

  const closeAllForms = (): void => {
    uploadEditor.close();
    folderEditor.close();
    objEditEditor.close();
  };

  const openUpload = (): void => {
    closeAllForms();
    uploadEditor.openWith(StorageObjectUploadForm.create(bucket.name, prefix));
  };

  const openFolder = (): void => {
    closeAllForms();
    folderEditor.openWith(StorageFolderCreateForm.create(bucket.name, prefix));
  };

  const openObjectEdit = (obj: StorageObject): void => {
    closeAllForms();
    objEditEditor.openWith(StorageObjectEditForm.fromObject(bucket, obj));
  };

  const submitUpload = (): void => {
    const valid = uploadEditor.submit();
    if (!Option.isSome(valid)) return;
    const [first, ...rest] = StorageObjectUploadForm.toSteps(valid.value, projectId);
    if (first === undefined) return;
    handlers.submit({ ...first, next: Option.none, rest });
    uploadEditor.awaitClose();
  };

  /** PC からファイルを選択したとき（ファイル名のみ取り込み、実際の中身は送信しない）。 */
  const handleFilePick = (files: FileList | null): void => {
    if (files === null || files.length === 0) return;
    const picked = [...files].map((f) => f.name.replace(/\s+/g, "_"));
    if (picked.length === 1) {
      const name = picked[0] ?? "";
      uploadEditor.set("fileName", name);
      uploadEditor.set("contentType", guessContentType(name));
      return;
    }
    const allSteps = picked.flatMap((name) =>
      StorageObjectUploadForm.toSteps(
        { bucket: bucket.name, prefix, fileName: name, contentType: guessContentType(name) },
        projectId,
      ),
    );
    const [first, ...rest] = allSteps;
    if (first === undefined) return;
    handlers.submit({ ...first, next: Option.none, rest });
    uploadEditor.awaitClose();
  };

  const submitFolder = (): void => {
    const valid = folderEditor.submit();
    if (!Option.isSome(valid)) return;
    handlers.submit({
      line: StorageFolderCreateForm.toCommand(valid.value, projectId),
      note: `フォルダを作成 (${valid.value.folderName})`,
      next: Option.none,
    });
    folderEditor.awaitClose();
  };

  const submitObjectEdit = (): void => {
    const valid = objEditEditor.submit();
    if (!Option.isSome(valid)) return;
    const [first, ...rest] = StorageObjectEditForm.toSteps(valid.value, projectId);
    if (first === undefined) {
      objEditEditor.close();
      return;
    }
    handlers.submit({ ...first, next: Option.none, rest });
    objEditEditor.awaitClose();
  };

  const removeObject = (obj: StorageObject): void => {
    if (!handlers.confirm(`オブジェクト gs://${bucket.name}/${obj.name} を削除しますか？`)) return;
    handlers.submit({
      line: deleteObjectCommand(bucket.name, obj.name, projectId),
      note: `オブジェクトを削除 (${obj.name})`,
      next: Option.none,
    });
  };

  const prefixParts = prefix.split("/").filter((p) => p !== "");
  const rows = buildBrowserRows(bucket.objects, prefix);

  return (
    <div>
      <ScreenTitle
        eyebrow="Cloud Storage › バケットの詳細"
        title={bucket.name}
        trailing={
          <>
            <SecondaryButton onClick={onBack}>← バケット一覧</SecondaryButton>
            <PrimaryButton onClick={openUpload}>ファイルをアップロード</PrimaryButton>
            <SecondaryButton onClick={openFolder}>フォルダを作成</SecondaryButton>
            <SecondaryButton onClick={onOpenPermissions}>権限</SecondaryButton>
            <SecondaryButton onClick={onEditBucket}>バケットを編集</SecondaryButton>
          </>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-1.5 rounded border border-line bg-canvas px-3 py-2 text-xs">
        <button
          type="button"
          onClick={() => setPrefix("")}
          className="font-mono text-accent hover:underline"
        >
          gs://{bucket.name}/
        </button>
        {prefixParts.map((part, idx) => {
          const nextPrefix = `${prefixParts.slice(0, idx + 1).join("/")}/`;
          return (
            <span key={nextPrefix} className="inline-flex items-center gap-1.5">
              <span className="text-muted">/</span>
              <button
                type="button"
                onClick={() => setPrefix(nextPrefix)}
                className="font-mono text-accent hover:underline"
              >
                {part}
              </button>
            </span>
          );
        })}
        <span className="ml-auto text-muted">
          {bucket.location} · {bucket.storageClass} · {bucket.objects.length} オブジェクト
        </span>
      </div>

      {Option.isSome(uploadEditor.form) && (
        <CreateFormSection
          label="ファイルをアップロード（疑似）"
          columns={2}
          command={StorageObjectUploadForm.toCommand(uploadForm, projectId)}
          onCopy={handlers.copy}
          onInsert={() => {
            const line = uploadSteps[0]?.line;
            if (line !== undefined) handlers.insert(line);
          }}
          onSubmit={submitUpload}
          onCancel={uploadEditor.close}
          submitLabel="アップロード"
        >
          <div className="flex flex-wrap items-center gap-3 rounded border border-line border-dashed bg-canvas px-3.5 py-2.5 sm:col-span-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                handleFilePick(e.target.files);
                e.target.value = "";
              }}
            />
            <SecondaryButton onClick={() => fileInputRef.current?.click()}>
              PC からファイルを選択…
            </SecondaryButton>
            <p className="text-muted text-xs">
              シミュレータのため実際のファイル中身は保存されず、ダミーのオブジェクト（1
              KiB）として登録されます。下の欄にファイル名を手入力しても作成できます。
            </p>
          </div>
          <Field
            label="ファイル名"
            required
            error={uploadEditor.errors.fileName}
            hint={prefix === "" ? "例: index.html, data/sample.csv" : `配置先: ${prefix}`}
          >
            {(id) => (
              <TextInput
                id={id}
                value={uploadForm.fileName}
                placeholder="sample.txt"
                onChange={(v) => {
                  uploadEditor.set("fileName", v);
                  uploadEditor.set("contentType", guessContentType(v));
                }}
              />
            )}
          </Field>
          <Field label="Content-Type" hint="空欄なら拡張子から自動推定">
            {(id) => (
              <TextInput
                id={id}
                value={uploadForm.contentType}
                placeholder="text/plain"
                onChange={(v) => uploadEditor.set("contentType", v)}
              />
            )}
          </Field>
        </CreateFormSection>
      )}

      {Option.isSome(folderEditor.form) && (
        <CreateFormSection
          label="フォルダを作成"
          columns={2}
          command={StorageFolderCreateForm.toCommand(folderForm, projectId)}
          onCopy={handlers.copy}
          onInsert={handlers.insert}
          onSubmit={submitFolder}
          onCancel={folderEditor.close}
          submitLabel="作成"
        >
          <Field
            label="フォルダ名"
            required
            error={folderEditor.errors.folderName}
            hint="プレースホルダー（.keep）を作成して仮想フォルダを作ります"
          >
            {(id) => (
              <TextInput
                id={id}
                value={folderForm.folderName}
                placeholder="images"
                onChange={(v) => folderEditor.set("folderName", v)}
              />
            )}
          </Field>
        </CreateFormSection>
      )}

      {Option.isSome(objEditEditor.form) && (
        <CreateFormSection
          label={`オブジェクトを編集 (${objEditForm.name})`}
          columns={2}
          command={StorageObjectEditForm.toCommand(objEditForm, projectId)}
          onCopy={handlers.copy}
          onInsert={() => {
            const line = objEditSteps[0]?.line;
            if (line !== undefined) handlers.insert(line);
          }}
          onSubmit={submitObjectEdit}
          onCancel={objEditEditor.close}
          submitLabel="保存"
        >
          <Field label="オブジェクト名（変更不可）">
            {(id) => (
              <p
                id={id}
                className="rounded border border-line bg-canvas px-2.5 py-1.5 font-mono text-muted text-xs"
              >
                gs://{objEditForm.bucket}/{objEditForm.name}
              </p>
            )}
          </Field>
          <Field label="ストレージクラス">
            {(id) => (
              <Select
                id={id}
                value={objEditForm.storageClass}
                onChange={(c) => objEditEditor.set("storageClass", c)}
                options={Object.values(StorageClasses).map((c) => ({ value: c, label: c }))}
              />
            )}
          </Field>
          <Field label="Content-Type" error={objEditEditor.errors.contentType}>
            {(id) => (
              <TextInput
                id={id}
                value={objEditForm.contentType}
                onChange={(v) => objEditEditor.set("contentType", v)}
              />
            )}
          </Field>
        </CreateFormSection>
      )}

      <ResourceTable
        label="オブジェクト"
        rows={rows}
        keyOf={(r) => (r.kind === "folder" ? `dir:${r.prefix}` : `obj:${r.object.name}`)}
        nameOf={(r) => (r.kind === "folder" ? r.name : r.object.name)}
        empty="このフォルダにはオブジェクトがありません。「ファイルをアップロード」または gcloud storage cp で追加できます。"
        onEdit={(r) => {
          if (r.kind === "object") openObjectEdit(r.object);
        }}
        editable={(r) => r.kind === "object"}
        onDelete={(r) => {
          if (r.kind === "object") removeObject(r.object);
        }}
        deletable={(r) => r.kind === "object"}
        columns={[
          {
            header: "名前",
            cell: (r) =>
              r.kind === "folder" ? (
                <button
                  type="button"
                  onClick={() => setPrefix(r.prefix)}
                  className="font-medium font-mono text-accent hover:underline"
                >
                  📁 {r.name}
                </button>
              ) : (
                <span className="font-mono">{r.displayName}</span>
              ),
          },
          {
            header: "サイズ",
            cell: (r) => (r.kind === "folder" ? "-" : formatSize(r.object.size)),
          },
          {
            header: "タイプ",
            cell: (r) =>
              r.kind === "folder" ? (
                "フォルダ"
              ) : (
                <span className="font-mono text-xs">{r.object.contentType}</span>
              ),
          },
          {
            header: "ストレージクラス",
            cell: (r) =>
              r.kind === "folder"
                ? "-"
                : Option.unwrapOr(r.object.storageClass, bucket.storageClass),
          },
          {
            header: "更新日時",
            cell: (r) =>
              r.kind === "folder" ? (
                "-"
              ) : (
                <span className="text-muted text-xs">{r.object.updated}</span>
              ),
          },
        ]}
      />
    </div>
  );
};

/** バケット権限（IAM バインディング一覧・付与・削除）。 */
const BucketPermissionsView = ({
  bucket,
  projectId,
  handlers,
  outcome,
  onBack,
  onOpenObjects,
  onEditBucket,
}: Readonly<{
  bucket: Bucket;
  projectId: string;
  handlers: ScreenProps["handlers"];
  outcome: ScreenProps["outcome"];
  onBack: () => void;
  onOpenObjects: () => void;
  onEditBucket: () => void;
}>): ReactElement => {
  const seed = (): BucketIamGrantForm => BucketIamGrantForm.create(bucket.name);
  const grantEditor = useCreateForm(BucketIamGrantForm, seed, false, outcome);
  const grantForm = Option.unwrapOr(grantEditor.form, seed());

  const bindings = bucket.iamPolicy.bindings.flatMap((b) =>
    b.members.map((member) => ({ member, role: b.role })),
  );

  const submitGrant = (): void => {
    const valid = grantEditor.submit();
    if (!Option.isSome(valid)) return;
    const normalizedMember = BucketIamGrantForm.normalizeMember(valid.value.member);
    handlers.submit({
      line: BucketIamGrantForm.toCommand(valid.value, projectId),
      note: `バケットのアクセス権を付与 (${normalizedMember}: ${valid.value.role})`,
      next: Option.none,
    });
    grantEditor.awaitClose();
  };

  const removeBinding = (binding: Readonly<{ member: string; role: string }>): void => {
    if (
      !handlers.confirm(
        `バケット gs://${bucket.name} から ${binding.member} の ${binding.role} を削除しますか？`,
      )
    )
      return;
    handlers.submit({
      line: BucketIamGrantForm.removeCommand(bucket.name, binding, projectId),
      note: `バケットのアクセス権を削除 (${binding.member}: ${binding.role})`,
      next: Option.none,
    });
  };

  return (
    <div>
      <ScreenTitle
        eyebrow="Cloud Storage › バケットの権限"
        title={bucket.name}
        trailing={
          <>
            <SecondaryButton onClick={onBack}>← バケット一覧</SecondaryButton>
            <SecondaryButton onClick={onOpenObjects}>オブジェクト一覧</SecondaryButton>
            <PrimaryButton onClick={() => grantEditor.openWith(seed())}>
              アクセス権を付与
            </PrimaryButton>
            <SecondaryButton onClick={onEditBucket}>バケットを編集</SecondaryButton>
          </>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-3 rounded border border-line bg-canvas px-3 py-2 text-muted text-xs">
        <span className="font-mono text-ink">gs://{bucket.name}/</span>
        <span>アクセス制御: {bucket.uniformBucketLevelAccess ? "均一" : "きめ細かい"}</span>
        <span>公開アクセスの防止: {bucket.publicAccessPrevention ? "適用中" : "未適用"}</span>
        <span className="ml-auto">{bindings.length} 件のバインディング</span>
      </div>

      {Option.isSome(grantEditor.form) && (
        <CreateFormSection
          label="アクセス権を付与"
          columns={2}
          command={BucketIamGrantForm.toCommand(grantForm, projectId)}
          onCopy={handlers.copy}
          onInsert={handlers.insert}
          onSubmit={submitGrant}
          onCancel={grantEditor.close}
          submitLabel="付与"
        >
          <Field
            label="プリンシパル（メンバー）"
            required
            error={grantEditor.errors.member}
            hint="メールアドレス（user: / serviceAccount: は自動補完）、allUsers、allAuthenticatedUsers"
          >
            {(id) => (
              <TextInput
                id={id}
                value={grantForm.member}
                placeholder="user@example.com / allUsers"
                onChange={(v) => grantEditor.set("member", v)}
              />
            )}
          </Field>
          <Field label="ロール" required error={grantEditor.errors.role}>
            {(id) => (
              <Select
                id={id}
                value={grantForm.role}
                onChange={(r) => grantEditor.set("role", r)}
                options={BucketIamRoles}
              />
            )}
          </Field>
        </CreateFormSection>
      )}

      <ResourceTable
        label="バケットの権限"
        rows={bindings}
        keyOf={(r) => `${r.role}::${r.member}`}
        nameOf={(r) => `${r.member} (${r.role})`}
        empty="このバケットに直接付与された IAM 権限はありません。「アクセス権を付与」または gcloud storage buckets add-iam-policy-binding で追加できます。"
        onDelete={removeBinding}
        columns={[
          {
            header: "プリンシパル",
            cell: (r) => <span className="font-mono text-xs">{r.member}</span>,
          },
          {
            header: "ロール",
            cell: (r) => <span className="font-mono text-xs">{r.role}</span>,
          },
        ]}
      />
    </div>
  );
};

type BucketDetailView = Readonly<{ name: string; tab: "objects" | "permissions" }>;

/** Cloud Storage › バケット: 一覧・作成・編集・削除・バケット内オブジェクト/権限管理。 */
export const BucketsScreen = ({ world, project, handlers, outcome }: ScreenProps): ReactElement => {
  const projectId = project.projectId;
  const buckets = World.bucketsOf(world, projectId);
  const [bucketView, setBucketView] = useState<Option<BucketDetailView>>(Option.none);
  const editor = useCreateForm(BucketCreateForm, BucketCreateForm.create, false, outcome);
  const editEditor = useCreateForm(BucketEditForm, BucketEditForm.empty, false, outcome);
  const form = Option.unwrapOr(editor.form, BucketCreateForm.create());
  const editForm = Option.unwrapOr(editEditor.form, BucketEditForm.empty());
  const editSteps = BucketEditForm.toSteps(editForm, projectId);

  const activeBucket = Option.isSome(bucketView)
    ? buckets.find((b) => b.name === bucketView.value.name)
    : undefined;

  const openCreate = (): void => {
    editEditor.close();
    editor.open();
  };
  const startEdit = (bucket: Bucket): void => {
    editor.close();
    setBucketView(Option.none);
    editEditor.openWith(BucketEditForm.fromBucket(bucket, protectionFor(world, bucket.name)));
  };
  const create = (): void => {
    const valid = editor.submit();
    if (!Option.isSome(valid)) return;
    handlers.submit({
      line: BucketCreateForm.toCommand(valid.value, projectId),
      note: `バケットを作成 (${valid.value.name})`,
      next: Option.none,
    });
    editor.awaitClose();
  };
  const saveEdit = (): void => {
    const valid = editEditor.submit();
    if (!Option.isSome(valid)) return;
    const [first, ...rest] = BucketEditForm.toSteps(valid.value, projectId);
    if (first === undefined) {
      editEditor.close();
      return;
    }
    handlers.submit({ ...first, next: Option.none, rest });
    editEditor.awaitClose();
  };
  const remove = (bucket: Readonly<{ name: string; objects: readonly unknown[] }>): void => {
    const noncurrentCount = world.storageLab.versions.filter(
      (v) => v.bucket === bucket.name && v.state === "NONCURRENT",
    ).length;
    const total = bucket.objects.length + noncurrentCount;
    const contents = total > 0 ? `（中のオブジェクト ${total} 件も消えます）` : "";
    if (!handlers.confirm(`バケット gs://${bucket.name} を削除しますか？${contents}`)) return;
    handlers.submit({
      line: DeleteCommand.bucket(
        { name: bucket.name, objectCount: bucket.objects.length, noncurrentCount },
        projectId,
      ),
      note: `バケットを削除 (${bucket.name})`,
      next: Option.none,
    });
  };

  if (activeBucket !== undefined && Option.isSome(bucketView)) {
    if (bucketView.value.tab === "permissions") {
      return (
        <BucketPermissionsView
          bucket={activeBucket}
          projectId={projectId}
          handlers={handlers}
          outcome={outcome}
          onBack={() => setBucketView(Option.none)}
          onOpenObjects={() =>
            setBucketView(Option.some({ name: activeBucket.name, tab: "objects" }))
          }
          onEditBucket={() => startEdit(activeBucket)}
        />
      );
    }
    return (
      <BucketObjectsView
        bucket={activeBucket}
        projectId={projectId}
        handlers={handlers}
        outcome={outcome}
        onBack={() => setBucketView(Option.none)}
        onOpenPermissions={() =>
          setBucketView(Option.some({ name: activeBucket.name, tab: "permissions" }))
        }
        onEditBucket={() => startEdit(activeBucket)}
      />
    );
  }

  return (
    <div>
      <ScreenTitle
        eyebrow="Cloud Storage"
        title="バケット"
        trailing={<PrimaryButton onClick={openCreate}>作成</PrimaryButton>}
      />
      {Option.isSome(editor.form) && (
        <CreateFormSection
          label="バケットを作成"
          columns={3}
          command={BucketCreateForm.toCommand(form, projectId)}
          onCopy={handlers.copy}
          onInsert={handlers.insert}
          onSubmit={create}
          onCancel={editor.close}
          submitLabel="作成"
        >
          <Field label="名前" error={editor.errors.name} hint="全世界で一意">
            {(id) => (
              <TextInput id={id} value={form.name} onChange={(v) => editor.set("name", v)} />
            )}
          </Field>
          <Field label="ロケーション" error={editor.errors.location}>
            {(id) => (
              <Select
                id={id}
                value={form.location}
                onChange={(v) => editor.set("location", v)}
                options={BucketLocation.all().map((loc) => ({
                  value: loc,
                  label: locationLabel(loc),
                }))}
              />
            )}
          </Field>
          <Field label="ストレージクラス">
            {(id) => (
              <Select
                id={id}
                value={form.storageClass}
                onChange={(c) => editor.set("storageClass", c)}
                options={Object.values(StorageClasses).map((c) => ({ value: c, label: c }))}
              />
            )}
          </Field>
          <Field label="アクセス制御">
            {(id) => (
              <Select
                id={id}
                value={form.uniformAccess ? "uniform" : "fine"}
                onChange={(v) => editor.set("uniformAccess", v === "uniform")}
                options={[
                  { value: "uniform", label: "均一" },
                  { value: "fine", label: "きめ細かい（ACL）" },
                ]}
              />
            )}
          </Field>
          <Field label="公開アクセスの防止">
            {(id) => (
              <Select
                id={id}
                value={form.publicAccessPrevention ? "on" : "off"}
                onChange={(v) => editor.set("publicAccessPrevention", v === "on")}
                options={[
                  { value: "on", label: "適用する" },
                  { value: "off", label: "適用しない" },
                ]}
              />
            )}
          </Field>
        </CreateFormSection>
      )}
      {Option.isSome(editEditor.form) && (
        <CreateFormSection
          label={`バケットを編集 (${editForm.name})`}
          columns={3}
          command={BucketEditForm.toCommand(editForm, projectId)}
          onCopy={handlers.copy}
          onInsert={() => {
            const line = editSteps[0]?.line;
            if (line !== undefined) handlers.insert(line);
          }}
          onSubmit={saveEdit}
          onCancel={editEditor.close}
          submitLabel="保存"
        >
          <Field label="名前" hint="作成後に変更できません">
            {(id) => (
              <p
                id={id}
                className="rounded border border-line bg-canvas px-2.5 py-1.5 font-mono text-ink text-sm"
              >
                {editForm.name}
              </p>
            )}
          </Field>
          <Field label="ロケーション" hint="作成後に変更できません">
            {(id) => (
              <p
                id={id}
                className="rounded border border-line bg-canvas px-2.5 py-1.5 text-ink text-sm"
              >
                {locationLabel(editForm.location)}
              </p>
            )}
          </Field>
          <Field label="デフォルトのストレージクラス">
            {(id) => (
              <Select
                id={id}
                value={editForm.storageClass}
                onChange={(c) => editEditor.set("storageClass", c)}
                options={Object.values(StorageClasses).map((c) => ({ value: c, label: c }))}
              />
            )}
          </Field>
          <Field label="アクセス制御">
            {(id) => (
              <Select
                id={id}
                value={editForm.uniformAccess ? "uniform" : "fine"}
                onChange={(v) => editEditor.set("uniformAccess", v === "uniform")}
                options={[
                  { value: "uniform", label: "均一" },
                  { value: "fine", label: "きめ細かい（ACL）" },
                ]}
              />
            )}
          </Field>
          <Field label="公開アクセスの防止">
            {(id) => (
              <Select
                id={id}
                value={editForm.publicAccessPrevention ? "on" : "off"}
                onChange={(v) => editEditor.set("publicAccessPrevention", v === "on")}
                options={[
                  { value: "on", label: "適用する" },
                  { value: "off", label: "適用しない" },
                ]}
              />
            )}
          </Field>
          <Field
            label="論理削除の保持期間"
            error={editEditor.errors.softDeleteDuration}
            hint="0（無効）または 7d〜89d"
          >
            {(id) => (
              <TextInput
                id={id}
                value={editForm.softDeleteDuration}
                onChange={(v) => editEditor.set("softDeleteDuration", v)}
              />
            )}
          </Field>
          <Field
            label="オブジェクト保持期間"
            error={editEditor.errors.retentionPeriod}
            hint={
              editForm.retentionLocked
                ? "ロック済み（短縮・解除不可）"
                : "空欄で解除（例: 1d, 30d）"
            }
          >
            {(id) => (
              <TextInput
                id={id}
                value={editForm.retentionPeriod}
                placeholder="未設定"
                onChange={(v) => editEditor.set("retentionPeriod", v)}
              />
            )}
          </Field>
          <div className="flex items-center sm:col-span-2">
            <Checkbox
              checked={editForm.versioning}
              onChange={(v) => editEditor.set("versioning", v)}
            >
              オブジェクトのバージョニングを有効にする（--versioning）
            </Checkbox>
          </div>
        </CreateFormSection>
      )}
      <ResourceTable
        label="バケット"
        rows={buckets}
        keyOf={(b) => b.name}
        empty="バケットはまだありません。"
        rowActions={(b) => (
          <>
            <SecondaryButton
              onClick={() => setBucketView(Option.some({ name: b.name, tab: "objects" }))}
            >
              開く
            </SecondaryButton>
            <SecondaryButton
              onClick={() => setBucketView(Option.some({ name: b.name, tab: "permissions" }))}
            >
              権限
            </SecondaryButton>
          </>
        )}
        onEdit={startEdit}
        onDelete={remove}
        columns={[
          {
            header: "名前",
            cell: (b) => (
              <button
                type="button"
                onClick={() => setBucketView(Option.some({ name: b.name, tab: "objects" }))}
                className="font-medium font-mono text-accent hover:underline"
              >
                {b.name}
              </button>
            ),
          },
          { header: "ロケーション", cell: (b) => b.location },
          { header: "デフォルトのストレージクラス", cell: (b) => b.storageClass },
          {
            header: "アクセス制御",
            cell: (b) => (b.uniformBucketLevelAccess ? "均一" : "きめ細かい"),
          },
          {
            header: "バージョニング",
            cell: (b) => (b.versioning ? "有効" : "無効"),
          },
          { header: "オブジェクト", cell: (b) => String(b.objects.length) },
        ]}
      />
    </div>
  );
};
