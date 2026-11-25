import type { ReactElement } from "react";
import { Checkbox } from "@/components/Checkbox";
import { Select } from "@/components/Select";
import { Budget } from "@/engine/domains/billing-budget";
import { World } from "@/engine/domains/world";
import {
  CreateFormSection,
  Field,
  PrimaryButton,
  ResourceTable,
  ScreenTitle,
  TextInput,
} from "@/features/simulator/features/console/components/ConsoleParts";
import { BudgetEditForm } from "@/features/simulator/features/console/domains/edit-command/billing";
import {
  BudgetCreateForm,
  DeleteCommand,
} from "@/features/simulator/features/console/domains/equivalent-command";
import { useCreateForm } from "@/features/simulator/features/console/hooks/use-create-form";
import type { ScreenProps } from "@/features/simulator/features/console/types/screen-props";
import { Option } from "@/utils/Option";

/** しきい値の選択肢（本物の Console の既定: 50% / 90% / 100%）。 */
const ThresholdChoices = [0.5, 0.9, 1] as const;

const percentText = (ratio: number): string => `${Math.round(ratio * 100)}%`;

/**
 * お支払い › 予算とアラート。対象はプロジェクトにリンクされた請求先アカウント
 * （リンクが無ければ作れないので、その案内だけを出す: E-016 と同じ前提）。
 */
export const BudgetsScreen = ({ world, project, handlers, outcome }: ScreenProps): ReactElement => {
  const account = Option.flatMap(project.billingAccountId, (id) =>
    World.findBillingAccount(world, id),
  );
  const editor = useCreateForm(BudgetCreateForm, BudgetCreateForm.create, false, outcome);
  const updater = useCreateForm(BudgetEditForm, BudgetEditForm.create, false, outcome);
  const form = Option.unwrapOr(editor.form, BudgetCreateForm.create());
  const editForm = Option.unwrapOr(updater.form, BudgetEditForm.create());
  if (!Option.isSome(account)) {
    return (
      <div>
        <ScreenTitle eyebrow="お支払い" title="予算とアラート" />
        <p className="text-muted text-sm">
          このプロジェクトは請求先アカウントにリンクされていません。gcloud billing projects link
          でリンクすると予算を作れます。
        </p>
      </div>
    );
  }
  const accountId = account.value.id;
  const linkedProjects = World.activeProjects(world).filter(
    (p) => Option.isSome(p.billingAccountId) && p.billingAccountId.value === accountId,
  );
  const command = BudgetCreateForm.toCommand(form, accountId);
  const editCommand = BudgetEditForm.toCommand(editForm, accountId, project.projectId);
  const create = (): void => {
    const valid = editor.submit();
    if (!Option.isSome(valid)) return;
    handlers.submit({
      line: BudgetCreateForm.toCommand(valid.value, accountId),
      note: `予算を作成 (${valid.value.displayName})`,
      next: Option.none,
    });
    editor.awaitClose();
  };
  const update = (): void => {
    const valid = updater.submit();
    if (!Option.isSome(valid)) return;
    handlers.submit({
      line: BudgetEditForm.toCommand(valid.value, accountId, project.projectId),
      note: `予算を編集 (${valid.value.displayName})`,
      next: Option.none,
    });
    updater.awaitClose();
  };
  const remove = (budget: Budget): void => {
    if (!handlers.confirm(`予算「${budget.displayName}」を削除しますか？`)) return;
    handlers.submit({
      line: DeleteCommand.budget(Budget.id(budget), accountId, project.projectId),
      note: `予算を削除 (${budget.displayName})`,
      next: Option.none,
    });
  };
  const toggleThreshold = (ratio: number): void =>
    editor.set(
      "thresholds",
      form.thresholds.includes(ratio)
        ? form.thresholds.filter((t) => t !== ratio)
        : [...form.thresholds, ratio].toSorted((a, b) => a - b),
    );
  const toggleEditThreshold = (ratio: number): void =>
    updater.set(
      "thresholds",
      editForm.thresholds.includes(ratio)
        ? editForm.thresholds.filter((t) => t !== ratio)
        : [...editForm.thresholds, ratio].toSorted((a, b) => a - b),
    );
  const projectOptions = [
    { value: "", label: "すべてのプロジェクト" },
    ...linkedProjects.map((p) => ({
      value: p.projectId,
      label: p.projectId,
    })),
  ];
  return (
    <div>
      <ScreenTitle
        eyebrow={`お支払い › ${account.value.displayName}`}
        title="予算とアラート"
        trailing={
          <PrimaryButton
            onClick={() => {
              updater.close();
              editor.open();
            }}
          >
            予算を作成
          </PrimaryButton>
        }
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
            {editor.errors.thresholds !== undefined && (
              <p role="alert" className="mt-1 text-danger text-xs">
                {editor.errors.thresholds}
              </p>
            )}
          </fieldset>
          <Field label="対象プロジェクト" hint="選ばなければ請求先アカウント全体">
            {(id) => (
              <Select
                id={id}
                value={form.projectIds[0] ?? ""}
                onChange={(projectId) =>
                  editor.set("projectIds", projectId === "" ? [] : [projectId])
                }
                options={projectOptions}
              />
            )}
          </Field>
        </CreateFormSection>
      )}
      {Option.isSome(updater.form) && (
        <CreateFormSection
          label="予算を編集"
          columns={2}
          command={editCommand}
          onCopy={handlers.copy}
          onInsert={handlers.insert}
          onSubmit={update}
          onCancel={updater.close}
          submitLabel="保存"
        >
          <Field label="予算 ID">
            {(id) => (
              <input
                id={id}
                type="text"
                value={editForm.budgetId}
                disabled
                className="h-9 w-full cursor-not-allowed rounded-md border border-line bg-canvas px-3 font-mono text-[15px] text-muted"
              />
            )}
          </Field>
          <Field label="名前" error={updater.errors.displayName}>
            {(id) => (
              <TextInput
                id={id}
                value={editForm.displayName}
                onChange={(v) => updater.set("displayName", v)}
              />
            )}
          </Field>
          <Field label="予算額（JPY）" error={updater.errors.amount}>
            {(id) => (
              <TextInput
                id={id}
                value={editForm.amount}
                onChange={(v) => updater.set("amount", v)}
              />
            )}
          </Field>
          <Field label="対象プロジェクト" hint="選ばなければ請求先アカウント全体">
            {(id) => (
              <Select
                id={id}
                value={editForm.projectIds[0] ?? ""}
                onChange={(projectId) =>
                  updater.set("projectIds", projectId === "" ? [] : [projectId])
                }
                options={projectOptions}
              />
            )}
          </Field>
          <fieldset className="sm:col-span-2">
            <legend className="mb-1 block font-medium text-sm">しきい値</legend>
            <div className="flex gap-4 text-sm">
              {ThresholdChoices.map((ratio) => (
                <Checkbox
                  key={ratio}
                  checked={editForm.thresholds.includes(ratio)}
                  onChange={() => toggleEditThreshold(ratio)}
                >
                  {percentText(ratio)}
                </Checkbox>
              ))}
            </div>
            {updater.errors.thresholds !== undefined && (
              <p role="alert" className="mt-1 text-danger text-xs">
                {updater.errors.thresholds}
              </p>
            )}
          </fieldset>
        </CreateFormSection>
      )}
      <ResourceTable
        label="予算"
        rows={World.budgetsOf(world, accountId)}
        keyOf={(b) => b.name}
        empty="予算はまだありません。"
        nameOf={(b) => b.displayName}
        onEdit={(b) => {
          editor.close();
          updater.openWith(BudgetEditForm.fromBudget(b));
        }}
        onDelete={remove}
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
