import type { ReactElement } from "react";
import { Checkbox } from "@/components/Checkbox";
import { Select } from "@/components/Select";

import { BucketLocation, StorageClasses } from "@/engine/domains/catalog";
import type { Bucket } from "@/engine/domains/storage";
import { protectionFor } from "@/engine/domains/storage-lab/model";
import { World } from "@/engine/domains/world";
import {
  CreateFormSection,
  Field,
  PrimaryButton,
  ResourceTable,
  ScreenTitle,
  TextInput,
} from "@/features/simulator/features/console/components/ConsoleParts";
import { BucketEditForm } from "@/features/simulator/features/console/domains/edit-command/storage";
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

/** Cloud Storage › バケット: 一覧・作成・編集・削除。 */
export const BucketsScreen = ({ world, project, handlers, outcome }: ScreenProps): ReactElement => {
  const projectId = project.projectId;
  const editor = useCreateForm(BucketCreateForm, BucketCreateForm.create, false, outcome);
  const editEditor = useCreateForm(BucketEditForm, BucketEditForm.empty, false, outcome);
  const form = Option.unwrapOr(editor.form, BucketCreateForm.create());
  const editForm = Option.unwrapOr(editEditor.form, BucketEditForm.empty());
  const editSteps = BucketEditForm.toSteps(editForm, projectId);

  const openCreate = (): void => {
    editEditor.close();
    editor.open();
  };
  const startEdit = (bucket: Bucket): void => {
    editor.close();
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
        rows={World.bucketsOf(world, projectId)}
        keyOf={(b) => b.name}
        empty="バケットはまだありません。"
        onEdit={startEdit}
        onDelete={remove}
        columns={[
          { header: "名前", cell: (b) => <span className="font-mono">{b.name}</span> },
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
