import { type ReactElement, type ReactNode, useId } from "react";

import { PrimaryButton } from "@/components/PrimaryButton";
import { RadioGroup } from "@/components/RadioGroup";
import { SecondaryButton } from "@/components/SecondaryButton";
import { TextInput } from "@/components/TextInput";
import { ErrorCodes, type ExecutionOutcome } from "@/engine";
import { CommandPart } from "@/features/simulator/features/console/domains/equivalent-command";
import { Option } from "@/utils/Option";

/**
 * Console の画面が共有する部品。ドメイン知識は持たず、見た目だけを揃える
 * （既存のトークンだけで組む。本物の Console の配色は模さない: DJ-011）。
 */

export { PrimaryButton, RadioGroup, SecondaryButton, TextInput };

export const ScreenTitle = ({
  eyebrow,
  title,
  trailing,
}: Readonly<{ eyebrow: string; title: string; trailing?: ReactNode }>): ReactElement => (
  <div className="mb-5 flex items-end justify-between gap-4">
    <div>
      <p className="mb-1 text-muted text-sm">{eyebrow}</p>
      <h2 className="font-bold text-[28px] leading-tight">{title}</h2>
    </div>
    {trailing !== undefined && <div className="flex gap-2">{trailing}</div>}
  </div>
);

/**
 * フォームの 1 項目。エラーがあれば項目の直下に出す（UC-008 例外フロー）。
 * 入力欄は id を受け取って描く（`htmlFor` で結ぶ）。補足とエラーは `label` の外に置く
 * （label の中に入れると、項目名で引けなくなる）。
 */
export const Field = ({
  label,
  required = false,
  error,
  hint,
  children,
}: Readonly<{
  label: string;
  /** 必須の印（` *`）を付けるか。印は見た目だけで、項目名には含めない */
  required?: boolean;
  error?: string;
  hint?: string;
  children: (id: string) => ReactNode;
}>): ReactElement => {
  const id = useId();
  return (
    <div>
      <label
        htmlFor={id}
        className={`mb-2 block font-bold text-sm ${required ? "after:content-['_*']" : ""}`}
      >
        {label}
      </label>
      {children(id)}
      {hint !== undefined && <p className="mt-1.5 text-muted text-xs">{hint}</p>}
      {error !== undefined && (
        <p role="alert" className="mt-1.5 text-danger text-sm">
          {error}
        </p>
      )}
    </div>
  );
};

type Column<T> = Readonly<{ header: string; cell: (row: T) => ReactNode; className?: string }>;

/** リソースの一覧の表。行が無ければ `empty` を出す。 */
export const ResourceTable = <T,>({
  label,
  columns,
  rows,
  keyOf,
  empty,
}: Readonly<{
  label: string;
  columns: readonly Column<T>[];
  rows: readonly T[];
  keyOf: (row: T) => string;
  empty: string;
}>): ReactElement => (
  <table className="w-full text-sm" aria-label={label}>
    <thead className="text-left text-muted text-xs">
      <tr>
        {columns.map((c) => (
          <th
            key={c.header}
            className={`border-line border-b py-2 pr-3 font-medium ${c.className ?? ""}`}
          >
            {c.header}
          </th>
        ))}
      </tr>
    </thead>
    <tbody>
      {rows.length === 0 ? (
        <tr>
          <td colSpan={columns.length} className="py-6 text-center text-muted">
            {empty}
          </td>
        </tr>
      ) : (
        rows.map((row) => (
          <tr key={keyOf(row)} className="border-line border-b">
            {columns.map((c) => (
              <td key={c.header} className={`py-2 pr-3 align-top ${c.className ?? ""}`}>
                {c.cell(row)}
              </td>
            ))}
          </tr>
        ))
      )}
    </tbody>
  </table>
);

/** 「同等のコマンドライン」（UI 案 s1）。コピーはクリップボードへ、貼り付けは端末の入力行へ。 */
export const EquivalentCommandPanel = ({
  command,
  onCopy,
  onInsert,
}: Readonly<{
  command: string;
  onCopy: (text: string) => void;
  onInsert: (text: string) => void;
}>): ReactElement => (
  <section
    className="rounded-lg border border-line bg-canvas p-3"
    aria-label="同等のコマンドライン"
  >
    <h3 className="mb-2 font-semibold text-muted text-xs">同等のコマンドライン</h3>
    <pre className="whitespace-pre-wrap break-all font-mono text-xs">{command}</pre>
    <div className="mt-3 flex flex-wrap gap-2">
      <SecondaryButton onClick={() => onCopy(command)}>コピー</SecondaryButton>
      <SecondaryButton onClick={() => onInsert(command)}>ターミナルに貼り付け</SecondaryButton>
    </div>
  </section>
);

/**
 * 入力項目を左、同等のコマンドラインを右に並べる（入力しながら横目でコマンドの変化を追える）。
 * 右の列は縦に流れても見えるよう上に貼り付ける。
 */
export const FormWithCommand = ({
  command,
  onCopy,
  onInsert,
  actions,
  children,
}: Readonly<{
  command: string;
  onCopy: (text: string) => void;
  onInsert: (text: string) => void;
  /** 作成・キャンセルの並び（項目の下に置く） */
  actions: ReactNode;
  children: ReactNode;
}>): ReactElement => (
  <div className="grid grid-cols-[minmax(0,1fr)_22rem] items-start gap-6">
    <div>
      {children}
      <div className="mt-4 flex gap-2">{actions}</div>
    </div>
    <div className="sticky top-0">
      <EquivalentCommandPanel command={command} onCopy={onCopy} onInsert={onInsert} />
    </div>
  </div>
);

const markClass = (mark: CommandPart["mark"]): string => {
  switch (mark) {
    case "plain":
      return "";
    case "changed":
      return "rounded-sm bg-warn-soft";
    case "invalid":
      return "rounded-sm bg-danger-soft text-danger";
  }
};

/** 同等のコマンドラインを 1 語 1 行で並べる。文字としては空白区切りの 1 行のまま。 */
const CommandLines = ({ parts }: Readonly<{ parts: readonly CommandPart[] }>): ReactElement => (
  <code className="block break-all font-mono text-sm leading-[1.9]">
    {parts.map((part, index) => (
      <span key={part.lead} className={`command-line block ${index === 0 ? "" : "pl-6"}`}>
        {index === 0 ? "" : " "}
        {part.lead}
        {part.value !== "" && (
          <span className={`px-0.5 ${markClass(part.mark)}`}>{part.value}</span>
        )}
      </span>
    ))}
  </code>
);

/**
 * 1 画面を使う作成ページ（UI 案 s1）。左に見出し・項目・作成とキャンセル、右の列に
 * 同等のコマンドライン（変えた値をハイライト）と試験メモを置く。右の列は画面の高さいっぱいに伸ばす。
 */
export const CreatePage = ({
  header,
  parts,
  onCopy,
  onInsert,
  actions,
  note,
  children,
}: Readonly<{
  header: ReactNode;
  parts: readonly CommandPart[];
  onCopy: (text: string) => void;
  onInsert: (text: string) => void;
  actions: ReactNode;
  /** 右の列の下に出す試験メモ */
  note?: ReactNode;
  children: ReactNode;
}>): ReactElement => {
  const command = CommandPart.join(parts);
  return (
    <div className="-mx-8 -my-7 grid min-h-full grid-cols-[minmax(0,1fr)_29rem]">
      <div className="flex flex-col px-8 py-7">
        {header}
        {children}
        <div className="mt-auto flex gap-3 pt-8">{actions}</div>
      </div>
      <section
        className="flex flex-col border-line border-l bg-surface px-6 py-7"
        aria-label="同等のコマンドライン"
      >
        <h3 className="mb-1.5 font-bold text-xl">同等のコマンドライン</h3>
        <p className="mb-5 text-muted text-sm">
          フォームの入力に合わせて更新。変更した箇所をハイライト。
        </p>
        <div className="rounded-lg border border-line bg-[#fafcfe] px-4 py-5">
          <CommandLines parts={parts} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <SecondaryButton onClick={() => onCopy(command)}>コピー</SecondaryButton>
          <SecondaryButton onClick={() => onInsert(command)}>ターミナルに貼り付け</SecondaryButton>
        </div>
        {note !== undefined && (
          <div className="mt-auto rounded-lg bg-code px-4 py-3.5 text-sm leading-relaxed">
            {note}
          </div>
        )}
      </section>
    </div>
  );
};

/**
 * 一覧の上に開く作成フォームの器（UI 案 s1 の作成ページを、一覧の上の区画に畳んだ形）。
 * 項目・同等のコマンドライン・作成とキャンセルの並びを 1 つにする。
 */
export const CreateFormSection = ({
  label,
  columns,
  command,
  onCopy,
  onInsert,
  onSubmit,
  onCancel,
  submitLabel,
  children,
}: Readonly<{
  label: string;
  columns: 2 | 3;
  command: string;
  onCopy: (text: string) => void;
  onInsert: (text: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel: string;
  children: ReactNode;
}>): ReactElement => (
  <section className="mb-4 rounded-lg border border-line bg-surface p-4" aria-label={label}>
    <FormWithCommand
      command={command}
      onCopy={onCopy}
      onInsert={onInsert}
      actions={
        <>
          <PrimaryButton onClick={onSubmit}>{submitLabel}</PrimaryButton>
          <SecondaryButton onClick={onCancel}>キャンセル</SecondaryButton>
        </>
      }
    >
      <div className={columns === 2 ? "grid grid-cols-2 gap-4" : "grid grid-cols-3 gap-4"}>
        {children}
      </div>
    </FormWithCommand>
  </section>
);

/**
 * フォームの送信が失敗したときの赤帯（UC-008 例外フロー）。E-007 なら「API を有効にする」ボタンを添える。
 * 成功は一覧へ戻るので帯は出さない。失敗でないときも要素を返すのは、コンポーネントの戻り値を
 * `ReactElement` に固定しているため（`undefined` を返せる型にすると、画面の出し分けで case の抜けが通る）。
 */
export const FailureBanner = ({
  outcome,
  onEnableApi,
  onDismiss,
}: Readonly<{
  outcome: Option<ExecutionOutcome>;
  onEnableApi: () => void;
  onDismiss: () => void;
}>): ReactElement => {
  if (!Option.isSome(outcome) || outcome.value.kind !== "failed")
    return <span className="hidden" />;
  const failure = outcome.value.failure;
  const isApiDisabled = failure.code === ErrorCodes.ApiDisabled;
  return (
    <div
      role="alert"
      className="mb-4 flex items-start justify-between gap-4 rounded-lg border border-danger bg-danger-soft px-4 py-3 text-sm"
    >
      <pre className="whitespace-pre-wrap break-all font-mono text-xs">{failure.message}</pre>
      <div className="flex shrink-0 gap-2">
        {isApiDisabled && <PrimaryButton onClick={onEnableApi}>API を有効にする</PrimaryButton>}
        <SecondaryButton onClick={onDismiss}>閉じる</SecondaryButton>
      </div>
    </div>
  );
};

/** その画面のプロダクトの API が無効なときの案内（本物の Console の「API を有効にする」画面）。 */
export const EnableApiPrompt = ({
  apiTitle,
  onEnable,
}: Readonly<{ apiTitle: string; onEnable: () => void }>): ReactElement => (
  <div className="rounded-lg border border-line bg-surface p-8 text-center">
    <p className="mb-1 font-semibold">{apiTitle} が有効になっていません</p>
    <p className="mb-4 text-muted text-sm">
      このプロジェクトで使うには API を有効にしてください（`gcloud services enable` と同じです）。
    </p>
    <PrimaryButton onClick={onEnable}>{apiTitle} を有効にする</PrimaryButton>
  </div>
);
