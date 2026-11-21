import type { ReactElement } from "react";
import { Select } from "@/components/Select";

import { BucketLocation, StorageClasses } from "@/engine/domains/catalog";
import { World } from "@/engine/domains/world";
import {
  CreateFormSection,
  Field,
  PrimaryButton,
  ResourceTable,
  ScreenTitle,
  TextInput,
} from "@/features/simulator/features/console/components/ConsoleParts";
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

/** Cloud Storage › バケット: 一覧と作成。 */
export const BucketsScreen = ({ world, project, handlers, outcome }: ScreenProps): ReactElement => {
  const projectId = project.projectId;
  const editor = useCreateForm(BucketCreateForm, BucketCreateForm.create, false, outcome);
  const form = Option.unwrapOr(editor.form, BucketCreateForm.create());
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
        trailing={<PrimaryButton onClick={editor.open}>作成</PrimaryButton>}
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
      <ResourceTable
        label="バケット"
        rows={World.bucketsOf(world, projectId)}
        keyOf={(b) => b.name}
        empty="バケットはまだありません。"
        onDelete={remove}
        columns={[
          { header: "名前", cell: (b) => <span className="font-mono">{b.name}</span> },
          { header: "ロケーション", cell: (b) => b.location },
          { header: "デフォルトのストレージクラス", cell: (b) => b.storageClass },
          {
            header: "アクセス制御",
            cell: (b) => (b.uniformBucketLevelAccess ? "均一" : "きめ細かい"),
          },
          { header: "オブジェクト", cell: (b) => String(b.objects.length) },
        ]}
      />
    </div>
  );
};
