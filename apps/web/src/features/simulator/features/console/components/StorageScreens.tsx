import type { ReactElement } from "react";
import { Select } from "@/components/Select";

import { StorageClasses } from "@/engine/domains/catalog";
import { World } from "@/engine/domains/world";
import {
  CreateFormSection,
  Field,
  PrimaryButton,
  ResourceTable,
  ScreenTitle,
  TextInput,
} from "@/features/simulator/features/console/components/ConsoleParts";
import { BucketCreateForm } from "@/features/simulator/features/console/domains/equivalent-command";
import { useCreateForm } from "@/features/simulator/features/console/hooks/use-create-form";
import type { ScreenProps } from "@/features/simulator/features/console/types/screen-props";
import { Option } from "@/utils/Option";

/** Cloud Storage › バケット: 一覧と作成。 */
export const BucketsScreen = ({ world, project, handlers }: ScreenProps): ReactElement => {
  const projectId = project.projectId;
  const editor = useCreateForm(BucketCreateForm, BucketCreateForm.create);
  const form = Option.unwrapOr(editor.form, BucketCreateForm.create());
  const create = (): void => {
    const valid = editor.submit();
    if (!Option.isSome(valid)) return;
    handlers.submit({
      line: BucketCreateForm.toCommand(valid.value, projectId),
      note: `バケットを作成 (${valid.value.name})`,
      next: Option.none,
    });
    editor.close();
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
              <TextInput
                id={id}
                value={form.location}
                onChange={(v) => editor.set("location", v.toUpperCase())}
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
