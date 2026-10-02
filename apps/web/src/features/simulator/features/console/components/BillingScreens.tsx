import type { ReactElement } from "react";
import { Checkbox } from "@/components/Checkbox";
import { Select } from "@/components/Select";

import { World } from "@/engine/domains/world";
import {
  CreateFormSection,
  Field,
  PrimaryButton,
  ResourceTable,
  ScreenTitle,
  TextInput,
} from "@/features/simulator/features/console/components/ConsoleParts";
import { BudgetCreateForm } from "@/features/simulator/features/console/domains/equivalent-command";
import { useCreateForm } from "@/features/simulator/features/console/hooks/use-create-form";
import type { ScreenProps } from "@/features/simulator/features/console/types/screen-props";
import { Option } from "@/utils/Option";

/** しきい値の選択肢（本物の Console の既定: 50% / 90% / 100%）。 */
const ThresholdChoices = [0.5, 0.9, 1] as const;

const percentText = (ratio: number): string => `${Math.round(ratio * 100)}%`;

/**
 * お支払い › 予算とアラート。対象はプロジェクトにリンクされた請求アカウント
 * （リンクが無ければ作れないので、その案内だけを出す: E-016 と同じ前提）。
 */
export const BudgetsScreen = ({ world, project, handlers }: ScreenProps): ReactElement => {
  const account = Option.flatMap(project.billingAccountId, (id) =>
    World.findBillingAccount(world, id),
  );
  const editor = useCreateForm(BudgetCreateForm, BudgetCreateForm.create);
  const form = Option.unwrapOr(editor.form, BudgetCreateForm.create());
  if (!Option.isSome(account)) {
    return (
      <div>
        <ScreenTitle eyebrow="お支払い" title="予算とアラート" />
        <p className="text-muted text-sm">
          このプロジェクトは請求アカウントにリンクされていません。gcloud billing projects link
          でリンクすると予算を作れます。
        </p>
      </div>
    );
  }
  const accountId = account.value.id;
  const command = BudgetCreateForm.toCommand(form, accountId);
  const create = (): void => {
    const valid = editor.submit();
    if (!Option.isSome(valid)) return;
    handlers.submit({
      line: BudgetCreateForm.toCommand(valid.value, accountId),
      note: `予算を作成 (${valid.value.displayName})`,
      next: Option.none,
    });
    editor.close();
  };
  const toggleThreshold = (ratio: number): void =>
    editor.set(
      "thresholds",
      form.thresholds.includes(ratio)
        ? form.thresholds.filter((t) => t !== ratio)
        : [...form.thresholds, ratio].toSorted((a, b) => a - b),
    );
  return (
    <div>
      <ScreenTitle
        eyebrow={`お支払い › ${account.value.displayName}`}
        title="予算とアラート"
        trailing={<PrimaryButton onClick={editor.open}>予算を作成</PrimaryButton>}
      />
      {Option.isSome(editor.form) && (
        <CreateFormSection
          label="予算を作成"
          columns={2}
          command={command}
          onCopy={handlers.copy}
          onInsert={handlers.insert}
          onSubmit={create}
          onCancel={editor.close}
          submitLabel="作成"
        >
          <Field label="名前" error={editor.errors.displayName}>
            {(id) => (
              <TextInput
                id={id}
                value={form.displayName}
                onChange={(v) => editor.set("displayName", v)}
              />
            )}
          </Field>
          <Field label="予算額（JPY）" error={editor.errors.amount}>
            {(id) => (
              <TextInput id={id} value={form.amount} onChange={(v) => editor.set("amount", v)} />
            )}
          </Field>
          <fieldset>
            <legend className="mb-1 block font-medium text-sm">しきい値</legend>
            <div className="flex gap-4 text-sm">
              {ThresholdChoices.map((ratio) => (
                <Checkbox
                  key={ratio}
                  checked={form.thresholds.includes(ratio)}
                  onChange={() => toggleThreshold(ratio)}
                >
                  {percentText(ratio)}
                </Checkbox>
              ))}
            </div>
          </fieldset>
          <Field label="対象プロジェクト" hint="選ばなければアカウント全体">
            {(id) => (
              <Select
                id={id}
                value={form.projectIds[0] ?? ""}
                onChange={(projectId) =>
                  editor.set("projectIds", projectId === "" ? [] : [projectId])
                }
                options={[
                  { value: "", label: "すべてのプロジェクト" },
                  ...World.activeProjects(world).map((p) => ({
                    value: p.projectId,
                    label: p.projectId,
                  })),
                ]}
              />
            )}
          </Field>
        </CreateFormSection>
      )}
      <ResourceTable
        label="予算"
        rows={World.budgetsOf(world, accountId)}
        keyOf={(b) => b.name}
        empty="予算はまだありません。"
        columns={[
          { header: "名前", cell: (b) => b.displayName },
          { header: "予算額", cell: (b) => `${b.amount.toLocaleString("ja-JP")} JPY` },
          { header: "しきい値", cell: (b) => b.thresholds.map(percentText).join(" / ") },
          {
            header: "対象",
            cell: (b) => (b.projectIds.length === 0 ? "すべて" : b.projectIds.join(", ")),
          },
        ]}
      />
    </div>
  );
};
