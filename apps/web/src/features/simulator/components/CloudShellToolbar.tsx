import { type ReactElement, type ReactNode, useEffect, useRef, useState } from "react";
import { GhostButton } from "@/components/GhostButton";
import { SecondaryButton } from "@/components/SecondaryButton";
import { ToggleButton } from "@/components/ToggleButton";

type CloudShellToolbarProps = Readonly<{
  projectId: string;
  principal: string;
  editorOpen: boolean;
  onEditorToggle: () => void;
  previewPort: number;
  runningPorts: readonly number[];
  onOpenPreview: (port: number) => void;
  isMaximized: boolean;
  onMaximizeToggle: () => void;
  onClose: () => void;
  status?: ReactNode;
}>;

/** Console 下部ドロワーの Cloud Shell ツールバー（エディタを開く・ウェブでプレビュー・拡大・閉じる）。 */
export const CloudShellToolbar = ({
  projectId,
  principal,
  editorOpen,
  onEditorToggle,
  previewPort,
  runningPorts,
  onOpenPreview,
  isMaximized,
  onMaximizeToggle,
  onClose,
  status,
}: CloudShellToolbarProps): ReactElement => {
  const [previewMenuOpen, setPreviewMenuOpen] = useState(false);
  const [portInput, setPortInput] = useState(String(previewPort));
  const [portError, setPortError] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPortInput(String(previewPort));
  }, [previewPort]);

  useEffect(() => {
    if (!previewMenuOpen) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setPreviewMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setPreviewMenuOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [previewMenuOpen]);

  const extraPorts = runningPorts.filter((port) => port > 0 && port !== previewPort);

  const submitCustomPort = (): void => {
    const parsed = Number(portInput.trim());
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      setPortError("1〜65535 の整数を指定してください。");
      return;
    }
    setPortError("");
    setPreviewMenuOpen(false);
    onOpenPreview(parsed);
  };

  return (
    <div className="shrink-0 border-line border-b bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-muted text-sm">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-mono font-semibold text-accent">&gt;_</span>
          <span className="font-semibold text-ink">Cloud Shell</span>
          <span className="truncate font-mono text-xs text-muted">({projectId})</span>
          <span className="hidden rounded-full border border-line bg-canvas px-2 py-0.5 text-[11px] text-muted md:inline">
            5 GB 永続ディスク
          </span>
        </div>
        <div className="flex items-center gap-1 text-xs">
          <ToggleButton
            variant="ghost"
            pressed={editorOpen}
            onClick={onEditorToggle}
            title={editorOpen ? "Cloud Shell エディタを閉じる" : "Cloud Shell エディタを開く"}
            className="px-2.5 py-1 text-xs"
          >
            {editorOpen ? "エディタを閉じる" : "エディタを開く"}
          </ToggleButton>

          <div ref={menuRef} className="relative">
            <GhostButton
              ariaLabel="ウェブでプレビュー"
              ariaExpanded={previewMenuOpen}
              onClick={() => setPreviewMenuOpen((open) => !open)}
              className="px-2.5 py-1 text-xs"
            >
              ウェブでプレビュー ▾
            </GhostButton>
            {previewMenuOpen && (
              <div
                role="menu"
                aria-label="ウェブでプレビューメニュー"
                className="absolute right-0 bottom-full z-40 mb-1 w-64 rounded-lg border border-line bg-surface p-2 shadow-lg"
              >
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-ink text-xs hover:bg-canvas"
                  onClick={() => {
                    setPreviewMenuOpen(false);
                    onOpenPreview(previewPort);
                  }}
                >
                  <span>ポート {previewPort} でプレビュー</span>
                  {runningPorts.includes(previewPort) && (
                    <span className="rounded bg-ok-soft px-1.5 py-0.5 text-[10px] text-ok-ink">
                      実行中
                    </span>
                  )}
                </button>
                {extraPorts.map((port) => (
                  <button
                    key={port}
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-ink text-xs hover:bg-canvas"
                    onClick={() => {
                      setPreviewMenuOpen(false);
                      onOpenPreview(port);
                    }}
                  >
                    <span>ポート {port} でプレビュー</span>
                    <span className="rounded bg-ok-soft px-1.5 py-0.5 text-[10px] text-ok-ink">
                      実行中
                    </span>
                  </button>
                ))}
                <div className="my-1.5 border-line border-t" />
                <form
                  className="space-y-1.5 px-1 py-1"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitCustomPort();
                  }}
                >
                  <label className="block text-[11px] text-muted">
                    ポートを変更
                    <div className="mt-1 flex items-center gap-1.5">
                      <input
                        aria-label="プレビューするポート"
                        type="text"
                        inputMode="numeric"
                        value={portInput}
                        onChange={(event) => {
                          setPortInput(event.target.value);
                          setPortError("");
                        }}
                        className="w-full rounded border border-line bg-surface px-2 py-1 font-mono text-ink text-xs"
                      />
                      <SecondaryButton onClick={submitCustomPort}>変更</SecondaryButton>
                    </div>
                  </label>
                  {portError !== "" && (
                    <p role="alert" className="text-[11px] text-danger">
                      {portError}
                    </p>
                  )}
                </form>
              </div>
            )}
          </div>

          <span className="mx-1 hidden h-4 w-px bg-line sm:inline-block" aria-hidden="true" />
          <span className="hidden sm:inline">{status}</span>
          <GhostButton
            ariaLabel={isMaximized ? "Cloud Shell を元のサイズに戻す" : "Cloud Shell を拡大"}
            onClick={onMaximizeToggle}
            className="px-2 py-1"
          >
            {isMaximized ? "↙" : "↗"}
          </GhostButton>
          <GhostButton ariaLabel="Cloud Shell を閉じる" onClick={onClose} className="px-2 py-1">
            ×
          </GhostButton>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 border-line border-t bg-canvas px-3 py-1 text-[11px] text-muted">
        <span className="truncate">
          接続済み · アカウント: <span className="font-mono text-ink">{principal}</span> ·
          プロジェクト: <span className="font-mono text-ink">{projectId}</span>
        </span>
        <span className="shrink-0 font-mono">GOOGLE_CLOUD_PROJECT={projectId}</span>
      </div>
    </div>
  );
};
