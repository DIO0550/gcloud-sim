import { type ReactElement, useRef } from "react";

import { DangerButton } from "@/components/DangerButton";
import { IconButton } from "@/components/IconButton";
import { SecondaryButton } from "@/components/SecondaryButton";
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

const Mebibyte = 1024 * 1024;

/** 容量の綴り。1 MB 未満は KB、それ以上は MB（モック s4: `142 KB / 5 MB`）。 */
const size = (bytes: number): string =>
  bytes < Mebibyte
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${Number((bytes / Mebibyte).toFixed(1))} MB`;

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
        className="static w-full max-w-[45rem] rounded-2xl border border-line bg-surface p-0 text-ink shadow-xl"
      >
        <div className="flex items-center justify-between border-line border-b px-7 py-5">
          <h2 className="font-bold text-[22px]">設定</h2>
          <IconButton className="text-2xl" ariaLabel="閉じる" onClick={onClose}>
            ×
          </IconButton>
        </div>
        <div className="px-7 py-6">
          <h3 className="mb-3 font-bold text-muted">保存状態</h3>
          <div className="flex items-center justify-between text-base">
            <span className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className={`inline-block h-3 w-3 rounded-full ${saveState.kind === "saved" ? "bg-ok" : "bg-danger"}`}
              />
              {saveState.kind === "saved"
                ? "ブラウザに自動保存（コマンドごと）"
                : `保存に失敗しています: ${saveState.reason}`}
            </span>
            <span className="font-mono text-muted">schemaVersion {SchemaVersion}</span>
          </div>
          <div className="mt-4 h-1.5 w-full rounded-full bg-line/60">
            <div
              className="h-1.5 rounded-l-full bg-accent"
              style={{ width: `${Math.max(4, ratio)}%` }}
            />
          </div>
          <div className="mt-3 flex justify-between text-muted">
            <span>
              {size(bytes)} / {size(capacityBytes)}
            </span>
            <span>
              リソース {countResources(world)} · オペレーション {world.operations.length}
            </span>
          </div>

          <div className="mt-8 grid grid-cols-2 gap-4">
            <section className="rounded-lg border border-line px-4 py-5">
              <h3 className="font-bold text-lg">エクスポート</h3>
              <p className="mt-3 leading-relaxed">World とミッション進捗を JSON で書き出します。</p>
              <p className="mt-3 break-all font-mono text-muted">{Snapshot.fileName(now)}</p>
              <SecondaryButton className="mt-4" onClick={onExport}>
                ダウンロード
              </SecondaryButton>
            </section>
            <section className="rounded-lg border border-line px-4 py-5">
              <h3 className="font-bold text-lg">インポート</h3>
              <p className="mt-3 leading-relaxed">
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
                className="mt-4 w-full rounded-md border border-line border-dashed px-3 py-5 text-muted leading-relaxed hover:bg-canvas"
                onClick={() => fileRef.current?.click()}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const file = event.dataTransfer.files[0];
                  if (file !== undefined) onImport(file);
                }}
              >
                JSON をドロップ、またはクリックして選択
              </button>
            </section>
          </div>

          {Option.isSome(importError) && (
            <p role="alert" className="mt-6 rounded-lg bg-danger-soft px-4 py-3 text-danger">
              <span className="mr-2 font-bold">E-011</span>
              {importError.value}
            </p>
          )}

          <div className="mt-6 flex items-center justify-between gap-4 border-line border-t pt-5">
            <div>
              <h3 className="font-bold text-lg">初期状態に戻す</h3>
              <p className="mt-1 text-muted">
                サンプル組織・フォルダ2・プロジェクト2・請求1・default ネットワークで再生成。
              </p>
            </div>
            <DangerButton className="shrink-0" onClick={onReset}>
              リセット
            </DangerButton>
          </div>
        </div>
        <p className="border-line border-t px-7 py-4 text-muted text-sm">
          Google 非公式の学習用シミュレータです。本物の Google Cloud
          には接続せず、データは外部へ送信しません。
        </p>
      </dialog>
    </div>
  );
};
