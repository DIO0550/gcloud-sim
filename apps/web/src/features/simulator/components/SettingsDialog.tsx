import { type ReactElement, useRef } from "react";

import { SecondaryButton } from "@/components/Button";
import type { World } from "@/engine/domains/world";
import { SchemaVersion, Snapshot } from "@/engine/snapshot";
import { Option } from "@/utils/Option";

/** 直近の保存の結果。E-010 の表示に使う。 */
export type SaveState =
  | Readonly<{ kind: "saved"; bytes: number }>
  | Readonly<{ kind: "failed"; reason: string }>;

type SettingsDialogProps = Readonly<{
  world: World;
  saveState: SaveState;
  capacityBytes: number;
  now: string;
  importError: Option<string>;
  onClose: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onReset: () => void;
}>;

const countResources = (world: World): number =>
  world.projects.length +
  world.instances.length +
  world.networks.length +
  world.subnets.length +
  world.firewallRules.length +
  world.buckets.length +
  world.clusters.length +
  world.runServices.length +
  world.serviceAccounts.length +
  world.diskSnapshots.length;

const kb = (bytes: number): string => `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** 設定ダイアログ（モック s4）: 保存状態・エクスポート・インポート・リセット。 */
export const SettingsDialog = ({
  world,
  saveState,
  capacityBytes,
  now,
  importError,
  onClose,
  onExport,
  onImport,
  onReset,
}: SettingsDialogProps): ReactElement => {
  const fileRef = useRef<HTMLInputElement>(null);
  const bytes = saveState.kind === "saved" ? saveState.bytes : 0;
  const ratio = Math.min(100, Math.round((bytes / capacityBytes) * 100));
  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-ink/30 p-6"
      role="presentation"
    >
      <dialog
        open
        aria-label="設定"
        className="static w-full max-w-3xl rounded-xl border border-line bg-surface p-0 shadow-xl"
      >
        <div className="flex items-center justify-between border-line border-b px-6 py-4">
          <h2 className="font-bold text-xl">設定</h2>
          <button
            type="button"
            className="rounded px-2 py-1 text-lg hover:bg-canvas"
            onClick={onClose}
            aria-label="閉じる"
          >
            ×
          </button>
        </div>
        <div className="px-6 py-5">
          <h3 className="mb-2 font-semibold text-muted text-sm">保存状態</h3>
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={`inline-block h-2.5 w-2.5 rounded-full ${saveState.kind === "saved" ? "bg-ok" : "bg-danger"}`}
              />
              {saveState.kind === "saved"
                ? "ブラウザに自動保存（コマンドごと）"
                : `保存に失敗しています: ${saveState.reason}`}
            </span>
            <span className="font-mono text-muted">schemaVersion {SchemaVersion}</span>
          </div>
          <div className="mt-2 h-1.5 w-full rounded bg-canvas">
            <div className="h-1.5 rounded bg-accent" style={{ width: `${Math.max(1, ratio)}%` }} />
          </div>
          <div className="mt-1 flex justify-between text-muted text-xs">
            <span>
              {kb(bytes)} / {kb(capacityBytes)}
            </span>
            <span>
              リソース {countResources(world)} · オペレーション {world.operations.length}
            </span>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-4">
            <section className="rounded-lg border border-line p-4">
              <h3 className="font-semibold">エクスポート</h3>
              <p className="mt-1 text-muted text-sm">
                World とミッション進捗を JSON で書き出します。
              </p>
              <p className="mt-2 break-all font-mono text-muted text-xs">
                {Snapshot.fileName(now)}
              </p>
              <SecondaryButton className="mt-3" onClick={onExport}>
                ダウンロード
              </SecondaryButton>
            </section>
            <section className="rounded-lg border border-line p-4">
              <h3 className="font-semibold">インポート</h3>
              <p className="mt-1 text-muted text-sm">
                現在の状態は上書きされます。旧バージョンは自動で変換します。
              </p>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                aria-label="JSON を選択"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file !== undefined) onImport(file);
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                className="mt-3 w-full rounded border border-line border-dashed px-3 py-4 text-muted text-sm hover:bg-canvas"
                onClick={() => fileRef.current?.click()}
              >
                JSON をクリックして選択
              </button>
            </section>
          </div>

          {Option.isSome(importError) && (
            <p
              role="alert"
              className="mt-4 rounded-lg bg-danger-soft px-4 py-3 text-danger text-sm"
            >
              <span className="mr-2 font-bold">E-011</span>
              {importError.value}
            </p>
          )}

          <div className="mt-5 flex items-center justify-between border-line border-t pt-5">
            <div>
              <h3 className="font-semibold">初期状態に戻す</h3>
              <p className="text-muted text-sm">
                サンプル組織・フォルダ2・プロジェクト2・請求1・default ネットワークで再生成。
              </p>
            </div>
            <button
              type="button"
              className="rounded border border-danger px-4 py-2 font-semibold text-danger text-sm hover:bg-danger-soft"
              onClick={onReset}
            >
              リセット
            </button>
          </div>
        </div>
        <p className="border-line border-t px-6 py-3 text-muted text-xs">
          Google 非公式の学習用シミュレータです。本物の Google Cloud
          には接続せず、データは外部へ送信しません。
        </p>
      </dialog>
    </div>
  );
};
