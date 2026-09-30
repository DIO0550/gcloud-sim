import { type ReactElement, type ReactNode, useId } from "react";

import type { ExecutionOutcome } from "@/engine";
import { ErrorCodes } from "@/engine/cli/command-failure";
import { Option } from "@/utils/Option";

/**
 * Console の画面が共有する部品。ドメイン知識は持たず、見た目だけを揃える
 * （既存のトークンだけで組む。本物の Console の配色は模さない: DJ-011）。
 */

export const ScreenTitle = ({
  eyebrow,
  title,
  actions,
}: Readonly<{ eyebrow: string; title: string; actions?: ReactNode }>): ReactElement => (
  <div className="mb-4 flex items-end justify-between gap-4">
    <div>
      <p className="text-muted text-xs">{eyebrow}</p>
      <h2 className="font-bold text-xl">{title}</h2>
    </div>
    {actions !== undefined && <div className="flex gap-2">{actions}</div>}
  </div>
);

export const PrimaryButton = (
  props: Readonly<{ children: ReactNode; onClick: () => void; disabled?: boolean }>,
): ReactElement => (
  <button
    type="button"
    className="rounded-lg bg-accent px-4 py-2 font-semibold text-sm text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
    onClick={props.onClick}
    disabled={props.disabled ?? false}
  >
    {props.children}
  </button>
);

export const SecondaryButton = (
  props: Readonly<{ children: ReactNode; onClick: () => void; disabled?: boolean }>,
): ReactElement => (
  <button
    type="button"
    className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50"
    onClick={props.onClick}
    disabled={props.disabled ?? false}
  >
    {props.children}
  </button>
);

/**
 * フォームの 1 項目。エラーがあれば項目の直下に出す（UC-008 例外フロー）。
 * 入力欄は id を受け取って描く（`htmlFor` で結ぶ）。補足とエラーは `label` の外に置く
 * （label の中に入れると、項目名で引けなくなる）。
 */
export const Field = ({
  label,
  error,
  hint,
  children,
}: Readonly<{
  label: string;
  error?: string;
  hint?: string;
  children: (id: string) => ReactNode;
}>): ReactElement => {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block font-medium text-sm">
        {label}
      </label>
      {children(id)}
      {hint !== undefined && <p className="mt-1 text-muted text-xs">{hint}</p>}
      {error !== undefined && (
        <p role="alert" className="mt-1 text-danger text-xs">
          {error}
        </p>
      )}
    </div>
  );
};

export const inputClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none";

type Column<T> = Readonly<{ header: string; cell: (row: T) => ReactNode; className?: string }>;

/** 一覧の表。行が無ければ `empty` を出す。 */
export const DataTable = <T,>({
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

/** 「同等のコマンドライン」（UI 案 2c / s1）。コピーはクリップボードへ、貼り付けは端末の入力行へ。 */
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
    className="mt-6 rounded-lg border border-line bg-canvas p-3"
    aria-label="同等のコマンドライン"
  >
    <div className="mb-2 flex items-center justify-between">
      <h3 className="font-semibold text-muted text-xs">同等のコマンドライン</h3>
      <div className="flex gap-2">
        <SecondaryButton onClick={() => onCopy(command)}>コピー</SecondaryButton>
        <SecondaryButton onClick={() => onInsert(command)}>ターミナルへ</SecondaryButton>
      </div>
    </div>
    <pre className="whitespace-pre-wrap break-all font-mono text-xs">{command}</pre>
  </section>
);

/**
 * フォームの送信結果の赤帯（UC-008 例外フロー）。E-007 なら「API を有効にする」ボタンを添える。
 * 成功は一覧へ戻るので帯は出さない。
 */
export const OutcomeBanner = ({
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
