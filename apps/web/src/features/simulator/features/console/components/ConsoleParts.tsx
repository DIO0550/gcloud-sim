import { type ReactElement, type ReactNode, useEffect, useId, useState } from "react";

import { PrimaryButton } from "@/components/PrimaryButton";
import { RadioGroup } from "@/components/RadioGroup";
import { SecondaryButton } from "@/components/SecondaryButton";
import { TextInput } from "@/components/TextInput";
import { ErrorCodes, type ExecutionStatus } from "@/engine";
import { CommandPart } from "@/features/simulator/features/console/domains/equivalent-command";
import { Option } from "@/utils/Option";

/**
 * Console の画面が共有する部品。ドメイン知識は持たず、見た目だけを揃える
 * （既存のトークンだけで組む。本物の Console の配色は模さない: DJ-011）。
 */

export { PrimaryButton, RadioGroup, SecondaryButton, TextInput };

/** コピー押下後に一時的に「コピーしました」を表示するボタン。 */
export const CopyButton = ({
  text,
  onCopy,
}: Readonly<{ text: string; onCopy: (text: string) => void }>): ReactElement => {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <SecondaryButton
      onClick={() => {
        onCopy(text);
        setCopied(true);
      }}
    >
      {copied ? "コピーしました" : "コピー"}
    </SecondaryButton>
  );
};

export const ScreenTitle = ({
  eyebrow,
  title,
  trailing,
}: Readonly<{ eyebrow: string; title: string; trailing?: ReactNode }>): ReactElement => (
  <div className="-mx-5 -mt-5 mb-5 flex min-h-13 flex-wrap items-center gap-x-5 gap-y-2 border-line border-b bg-surface px-5 py-2.5">
    <div className="flex flex-col">
      <p className="text-[11px] text-muted leading-tight">{eyebrow}</p>
      <h2 className="font-normal text-ink text-xl leading-snug tracking-tight">{title}</h2>
    </div>
    {trailing !== undefined && (
      <div className="flex flex-wrap items-center gap-2 border-line sm:border-l sm:pl-4">
        {trailing}
      </div>
    )}
  </div>
);

/** 稼働状態（RUNNING / READY / ACTIVE 等）に Google Cloud Console 風の緑チェック丸アイコンを添える。 */
export const ConsoleStatus = ({ status }: Readonly<{ status: string }>): ReactElement => {
  const ok = status === "RUNNING" || status === "READY" || status === "ACTIVE" || status === "DONE";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      {ok ? (
        <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-ok">
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          <path
            d="m5 8.2 2 2 4-4.2"
            fill="none"
            stroke="#fff"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full bg-muted" />
      )}
      <span>{status}</span>
    </span>
  );
};

/**
 * フォームの 1 項目。エラーがあれば項目の直下に出す（UC-008 例外フロー）。
 * 入力欄は id を受け取って描く（`htmlFor` で結ぶ）。補足とエラーは `label` の外に置く
 * （label の中に入れると、項目名で引けなくなる）。
 */
export const Field = ({
  label,
  required = false,
  outlined = false,
  error,
  hint,
  children,
}: Readonly<{
  label: string;
  /** 必須の印（` *`）を付けるか。印は見た目だけで、項目名には含めない */
  required?: boolean;
  outlined?: boolean;
  error?: string;
  hint?: string;
  children: (id: string) => ReactNode;
}>): ReactElement => {
  const id = useId();
  return (
    <div className={outlined ? "relative" : ""}>
      <label
        htmlFor={id}
        className={`${outlined ? "absolute -top-2 left-3 z-10 bg-surface px-1 text-muted text-xs" : "mb-1.5 block font-medium text-ink text-xs"} ${required ? "after:text-danger after:content-['_*']" : ""}`}
      >
        {label}
      </label>
      {children(id)}
      {hint !== undefined && <p className="mt-1 text-muted text-xs leading-snug">{hint}</p>}
      {error !== undefined && (
        <p role="alert" className="mt-1 text-danger text-xs">
          {error}
        </p>
      )}
    </div>
  );
};

type Column<T> = Readonly<{ header: string; cell: (row: T) => ReactNode; className?: string }>;

/**
 * リソースの一覧の表。行が無ければ `empty` を出す。`onDelete` を渡すと行の末尾に「削除」を出す
 * （`deletable` が偽の行には出さない: 事前定義ロールなど消せないもの）。
 */
export const ResourceTable = <T,>({
  label,
  columns,
  rows,
  keyOf,
  empty,
  onDelete,
  deletable,
  nameOf,
  rowActions,
}: Readonly<{
  label: string;
  columns: readonly Column<T>[];
  rows: readonly T[];
  keyOf: (row: T) => string;
  empty: string;
  onDelete?: (row: T) => void;
  deletable?: (row: T) => boolean;
  /** 削除ボタンの読み上げ名に使う名前（既定は `keyOf`） */
  nameOf?: (row: T) => string;
  /** 行の末尾に追加する任意の操作ボタン（接続など） */
  rowActions?: (row: T) => ReactNode;
}>): ReactElement => {
  const hasActions = onDelete !== undefined || rowActions !== undefined;
  const span = columns.length + (hasActions ? 1 : 0);
  return (
    <div className="overflow-x-auto rounded border border-line bg-surface">
      <table className="w-full border-collapse text-[13px]" aria-label={label}>
        <thead className="border-line border-b bg-canvas text-left text-muted text-xs">
          <tr>
            {columns.map((c) => (
              <th
                key={c.header}
                className={`whitespace-nowrap px-3 py-2.5 font-medium ${c.className ?? ""}`}
              >
                {c.header}
              </th>
            ))}
            {hasActions && (
              <th className="px-3 py-2.5 text-right font-medium">
                <span className="sr-only">操作</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={span} className="px-4 py-8 text-center text-muted text-sm">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={keyOf(row)}
                className="border-line border-b transition-colors last:border-b-0 hover:bg-canvas/70"
              >
                {columns.map((c) => (
                  <td key={c.header} className={`px-3 py-2.5 align-middle ${c.className ?? ""}`}>
                    {c.cell(row)}
                  </td>
                ))}
                {hasActions && (
                  <td className="whitespace-nowrap px-3 py-2 text-right align-middle">
                    <div className="inline-flex items-center justify-end gap-1.5">
                      {rowActions?.(row)}
                      {onDelete !== undefined && (deletable === undefined || deletable(row)) && (
                        <SecondaryButton
                          ariaLabel={`${(nameOf ?? keyOf)(row)} を削除`}
                          onClick={() => onDelete(row)}
                        >
                          削除
                        </SecondaryButton>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
};

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
  <section className="rounded border border-line bg-canvas p-3.5" aria-label="同等のコマンドライン">
    <h3 className="mb-2 flex items-center gap-1.5 font-medium text-ink text-xs">
      <span aria-hidden="true" className="font-mono text-accent">
        &gt;_
      </span>
      同等のコマンドライン
    </h3>
    <pre className="whitespace-pre-wrap break-all rounded border border-line bg-surface p-2.5 font-mono text-ink text-xs leading-relaxed">
      {command}
    </pre>
    <div className="mt-3 flex flex-wrap gap-2">
      <CopyButton text={command} onCopy={onCopy} />
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
  <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
    <div>
      {children}
      <div className="mt-5 flex gap-2 border-line border-t pt-4">{actions}</div>
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
  <code className="block break-all font-mono text-[13px] leading-[1.9]">
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

/** VM 作成ページ（UI 案 2c）。設定ナビ・フォーム・構成概要とコマンドを並べる。 */
export const CreatePage = ({
  header,
  navigation,
  navigationOpen,
  summary,
  parts,
  onCopy,
  onInsert,
  actions,
  note,
  children,
}: Readonly<{
  header: ReactNode;
  navigation: ReactNode;
  navigationOpen: boolean;
  summary: ReactNode;
  parts: readonly CommandPart[];
  onCopy: (text: string) => void;
  onInsert: (text: string) => void;
  actions: ReactNode;
  note?: ReactNode;
  children: ReactNode;
}>): ReactElement => {
  const command = CommandPart.join(parts);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-13 shrink-0 items-center gap-4 border-line border-b bg-surface px-5 py-2.5">
        {header}
      </div>
      <div
        className={`grid flex-1 grid-cols-1 xl:min-h-0 ${navigationOpen ? "lg:grid-cols-[13.75rem_minmax(0,1fr)] xl:grid-cols-[13.75rem_minmax(0,1fr)_26rem]" : "xl:grid-cols-[minmax(0,1fr)_26rem]"}`}
      >
        {navigationOpen && (
          <nav
            aria-label="VM 作成の設定"
            className="flex overflow-x-auto border-line border-b bg-surface py-4 lg:block lg:border-r lg:border-b-0 xl:min-h-0 xl:overflow-auto"
          >
            {navigation}
          </nav>
        )}
        <div className="flex min-w-0 flex-col bg-surface px-6 py-7 xl:min-h-0 xl:px-9">
          <div className="pt-2 pb-8 xl:min-h-0 xl:flex-1 xl:overflow-auto">{children}</div>
          <div className="mt-auto flex shrink-0 gap-3 border-line border-t pt-4">{actions}</div>
        </div>
        <section
          className={`flex min-w-0 flex-col border-line border-t bg-canvas px-6 py-6 xl:min-h-0 xl:overflow-auto xl:border-t-0 xl:border-l ${navigationOpen ? "lg:col-span-2 xl:col-span-1" : ""}`}
          aria-label="同等のコマンドライン"
        >
          <div className="mb-7 border-line border-b pb-5">{summary}</div>
          <h3 className="mb-1.5 font-medium text-lg text-ink">同等のコマンドライン</h3>
          <p className="text-muted text-xs">フォームの入力に合わせて更新。変更箇所をハイライト。</p>
          <div className="my-4 border-line border-b">
            <span className="inline-block border-accent border-b-2 px-4 py-2 font-medium text-accent text-sm">
              gcloud
            </span>
          </div>
          <div className="rounded border border-line bg-surface px-4 py-4">
            <CommandLines parts={parts} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <CopyButton text={command} onCopy={onCopy} />
            <SecondaryButton onClick={() => onInsert(command)}>
              ターミナルに貼り付け
            </SecondaryButton>
          </div>
          {note !== undefined && (
            <div className="mt-auto pt-8 text-muted text-xs leading-relaxed">{note}</div>
          )}
        </section>
      </div>
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
  <section
    className="mb-5 overflow-hidden rounded border border-line bg-surface shadow-[0_1px_2px_rgba(60,64,67,0.08)]"
    aria-label={label}
  >
    <div className="flex items-center justify-between border-line border-b bg-canvas px-4 py-2.5">
      <h3 className="font-medium text-ink text-sm">{label}</h3>
    </div>
    <div className="p-4">
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
        <div
          className={
            columns === 2
              ? "grid grid-cols-1 gap-4 sm:grid-cols-2"
              : "grid grid-cols-1 gap-4 sm:grid-cols-3"
          }
        >
          {children}
        </div>
      </FormWithCommand>
    </div>
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
  className = "",
}: Readonly<{
  outcome: Option<ExecutionStatus>;
  onEnableApi: (apiName?: string, apiTitle?: string) => void;
  onDismiss: () => void;
  className?: string;
}>): ReactElement => {
  if (!Option.isSome(outcome) || outcome.value.kind !== "failed")
    return <span className="hidden" />;
  const failure = outcome.value.failure;
  const isApiDisabled = failure.code === ErrorCodes.ApiDisabled;
  return (
    <div
      role="alert"
      className={`mb-4 flex shrink-0 items-start justify-between gap-4 rounded border border-danger/40 bg-danger-soft px-4 py-3 text-sm ${className}`}
    >
      <pre className="whitespace-pre-wrap break-all font-mono text-danger text-xs">
        {failure.message}
      </pre>
      <div className="flex shrink-0 gap-2">
        {isApiDisabled && (
          <PrimaryButton onClick={() => onEnableApi(failure.apiName, failure.apiTitle)}>
            API を有効にする
          </PrimaryButton>
        )}
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
  <div className="mx-auto my-8 max-w-xl rounded border border-line bg-surface p-8 text-center shadow-[0_1px_2px_rgba(60,64,67,0.08)]">
    <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none">
        <path
          d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1m-8.6 8.6-2.1 2.1"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    </div>
    <p className="mb-1.5 font-medium text-base text-ink">{apiTitle} が有効になっていません</p>
    <p className="mb-5 text-muted text-sm leading-relaxed">
      このプロジェクトで使うには API を有効にしてください（
      <code className="rounded bg-code px-1.5 py-0.5 font-mono text-xs">
        gcloud services enable
      </code>{" "}
      と同じです）。
    </p>
    <PrimaryButton onClick={onEnable}>{apiTitle} を有効にする</PrimaryButton>
  </div>
);
