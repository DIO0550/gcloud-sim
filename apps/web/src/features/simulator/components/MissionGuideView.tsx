import type { ReactElement } from "react";
import type { GuideAction, MissionGuide } from "@/engine/missions/learning-guides/model";

const Code = ({ text }: Readonly<{ text: string }>): ReactElement => (
  <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded border border-line bg-code p-3 font-mono text-xs leading-relaxed">
    <code>{text}</code>
  </pre>
);

const Action = ({ action }: Readonly<{ action: GuideAction }>): ReactElement => {
  switch (action.kind) {
    case "command":
      return (
        <div>
          {action.expectFailure && (
            <p className="mb-1 text-warn-ink text-xs">エラーを観察する操作</p>
          )}
          <Code text={action.text} />
        </div>
      );
    case "answer":
      return (
        <div>
          <p className="mb-1 text-muted text-xs">確認プロンプトへの回答</p>
          <Code text={action.text} />
        </div>
      );
    case "load":
      return (
        <p className="rounded border border-line bg-canvas p-3 text-sm">
          「ファイル」タブでテンプレート <code>{action.name}</code> を選び、
          {action.overwrite && "「同名のファイルを置き換える」を有効にして、"}
          「テンプレートを読み込む」を押します。
        </p>
      );
    case "write":
      return (
        <div>
          <p className="mb-2 text-sm">
            「ファイル」タブで <code>{action.name}</code>{" "}
            に次の内容を入力し、「ファイルを保存」を押します。
          </p>
          <Code text={action.content} />
        </div>
      );
    case "replace":
      return (
        <div>
          <p className="mb-2 text-sm">
            「ファイル」タブで <code>{action.name}</code> を開き、次の箇所を変更して保存します。
          </p>
          <p className="mb-1 text-muted text-xs">変更前</p>
          <Code text={action.before} />
          <p className="mt-2 mb-1 text-muted text-xs">変更後</p>
          <Code text={action.after} />
        </div>
      );
  }
};

/** 各段階の目的、操作、構文の意味、結果を一続きで読める教材表示。 */
export const MissionGuideView = ({ guide }: Readonly<{ guide: MissionGuide }>): ReactElement => (
  <div className="space-y-5 text-sm leading-relaxed">
    <p>{guide.introduction}</p>
    <ol className="space-y-5">
      {guide.steps.map((step, index) => (
        <li key={step.title} className="rounded-lg border border-line p-3">
          <h6 className="mb-2 font-semibold text-base">
            {index + 1}. {step.title}
          </h6>
          <p className="mb-3">{step.explanation}</p>
          <div className="space-y-2">
            {step.actions.map((action) => (
              <Action key={JSON.stringify(action)} action={action} />
            ))}
          </div>
          <p className="mt-4 mb-2 font-semibold">コマンド・設定のポイント</p>
          <dl className="space-y-3">
            {step.points.map((point) => (
              <div key={point.term}>
                <dt className="font-medium text-accent">{point.term}</dt>
                <dd className="mt-1">{point.description}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 rounded bg-accent-soft p-3">
            <p className="mb-1 font-semibold">確認する結果</p>
            <p>{step.expected}</p>
          </div>
        </li>
      ))}
    </ol>
    <div className="rounded border border-line bg-canvas p-3">
      <p className="mb-1 font-semibold">この演習で押さえること</p>
      <p>{guide.takeaway}</p>
    </div>
  </div>
);
