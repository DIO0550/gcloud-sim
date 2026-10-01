import type { ReactElement } from "react";

import { StorageClass, StorageClasses } from "@/engine/domains/catalog";
import { World } from "@/engine/domains/world";
import {
  CreateFormSection,
  Field,
  InputClass,
  PrimaryButton,
  ResourceTable,
  ScreenTitle,
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
  /** 選択肢に無い値は無視して今の値を保つ（select は選択肢しか出さないので、届くのは選択肢だけ）。 */
  const setStorageClass = (parsed: Option<StorageClass>): void => {
    if (Option.isSome(parsed)) editor.set("storageClass", parsed.value);
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
              <input
                id={id}
                className={InputClass}
                value={form.name}
                onChange={(e) => editor.set("name", e.target.value)}
              />
            )}
          </Field>
          <Field label="ロケーション" error={editor.errors.location}>
            {(id) => (
              <input
                id={id}
                className={InputClass}
                value={form.location}
                onChange={(e) => editor.set("location", e.target.value.toUpperCase())}
              />
            )}
          </Field>
          <Field label="ストレージクラス">
            {(id) => (
              <select
                id={id}
                className={InputClass}
                value={form.storageClass}
                onChange={(e) => setStorageClass(StorageClass.parse(e.target.value))}
              >
                {Object.values(StorageClasses).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="アクセス制御">
            {(id) => (
              <select
                id={id}
                className={InputClass}
                value={form.uniformAccess ? "uniform" : "fine"}
                onChange={(e) => editor.set("uniformAccess", e.target.value === "uniform")}
              >
                <option value="uniform">均一</option>
                <option value="fine">きめ細かい（ACL）</option>
              </select>
            )}
          </Field>
          <Field label="公開アクセスの防止">
            {(id) => (
              <select
                id={id}
                className={InputClass}
                value={form.publicAccessPrevention ? "on" : "off"}
                onChange={(e) => editor.set("publicAccessPrevention", e.target.value === "on")}
              >
                <option value="on">適用する</option>
                <option value="off">適用しない</option>
              </select>
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
