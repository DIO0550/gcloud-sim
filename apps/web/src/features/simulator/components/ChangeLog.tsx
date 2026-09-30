import type { ReactElement } from "react";

import type { World } from "@/engine/domains/world";
import type { TranscriptLine } from "@/features/simulator/hooks/use-simulator";

type ChangeLogProps = Readonly<{
  world: World;
  transcript: readonly TranscriptLine[];
}>;

const time = (iso: string): string => iso.slice(11, 19);

/** 右ペイン「変更ログ」: オペレーション履歴（新しい順）と、打ったコマンド。 */
export const ChangeLog = ({ world, transcript }: ChangeLogProps): ReactElement => {
  const operations = world.operations.toReversed().slice(0, 100);
  const inputs = transcript
    .filter((e) => e.kind === "input" && e.text.trim() !== "")
    .toReversed()
    .slice(0, 50);
  return (
    <div className="p-4">
      <h4 className="mb-2 font-semibold text-muted text-xs">
        オペレーション（{world.operations.length} 件）
      </h4>
      {operations.length === 0 ? (
        <p className="mb-4 text-muted text-sm">
          まだありません。VM を作成・停止するとここに残ります。
        </p>
      ) : (
        <ul className="mb-4 space-y-1 font-mono text-xs">
          {operations.map((o) => (
            <li key={o.id} className="flex gap-2">
              <span className="text-muted">{time(o.insertTime)}</span>
              <span className="w-24">{o.operationType}</span>
              <span className="flex-1 truncate">{o.targetName}</span>
              <span className="text-ok-ink">{o.status}</span>
            </li>
          ))}
        </ul>
      )}
      <h4 className="mb-2 font-semibold text-muted text-xs">コマンド履歴</h4>
      {inputs.length === 0 ? (
        <p className="text-muted text-sm">まだありません。</p>
      ) : (
        <ul className="space-y-1 font-mono text-xs">
          {inputs.map((e) => (
            <li key={e.id} className={e.origin === "ui" ? "text-muted" : ""}>
              {e.origin === "ui" ? "# UI: " : "$ "}
              {e.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
