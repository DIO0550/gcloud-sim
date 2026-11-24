import { type ReactElement, useEffect, useState } from "react";
import { IconButton } from "@/components/IconButton";
import { SecondaryButton } from "@/components/SecondaryButton";
import type { LocalContainer, Recipe } from "@/engine/domains/container-lab";
import type { World } from "@/engine/domains/world";

type CloudShellWebPreviewDialogProps = Readonly<{
  port: number;
  world: World;
  onChangePort: (port: number) => void;
  onClose: () => void;
}>;

const previewBodyFor = (recipe: Recipe | undefined): string => {
  switch (recipe) {
    case "hello-web-v2":
      return "Hello World! (v2)";
    default:
      return "Hello World!";
  }
};

const runningContainers = (world: World): readonly LocalContainer[] =>
  world.containerLab.containers.filter((container) => container.status === "RUNNING");

/** Cloud Shell の「ウェブでプレビュー」を擬似的に表示するダイアログ。 */
export const CloudShellWebPreviewDialog = ({
  port,
  world,
  onChangePort,
  onClose,
}: CloudShellWebPreviewDialogProps): ReactElement => {
  const [portInput, setPortInput] = useState(String(port));
  const [portError, setPortError] = useState("");

  useEffect(() => {
    setPortInput(String(port));
    setPortError("");
  }, [port]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const running = runningContainers(world);
  const matched = running.find((container) => container.hostPort === port);
  const image = matched
    ? world.containerLab.images.find((item) => item.id === matched.imageId)
    : undefined;
  const previewUrl = `https://${port}-cs-sim.cloudshell.dev/`;

  const applyPort = (): void => {
    const parsed = Number(portInput.trim());
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      setPortError("1〜65535 の整数を指定してください。");
      return;
    }
    setPortError("");
    onChangePort(parsed);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      role="presentation"
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label="ウェブでプレビューを閉じる"
        className="fixed inset-0 bg-ink/30"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="ウェブでプレビュー"
        className="relative z-10 flex w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between gap-3 border-line border-b bg-canvas px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="font-semibold text-ink text-sm">ウェブでプレビュー</span>
            <span
              className={`rounded-full px-2 py-0.5 font-mono text-[11px] ${
                matched ? "bg-ok-soft text-ok-ink" : "bg-danger-soft text-danger"
              }`}
            >
              {matched ? "200 OK" : "502 Bad Gateway"}
            </span>
          </div>
          <IconButton ariaLabel="ウェブでプレビューを閉じる" onClick={onClose}>
            ×
          </IconButton>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-line border-b bg-surface px-4 py-2 text-xs">
          <div className="min-w-0 flex-1 truncate rounded border border-line bg-canvas px-3 py-1.5 font-mono text-ink">
            {previewUrl}
          </div>
          <form
            className="flex items-center gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              applyPort();
            }}
          >
            <label className="flex items-center gap-1 text-muted">
              <span>ポート</span>
              <input
                aria-label="プレビューポート番号"
                type="text"
                inputMode="numeric"
                value={portInput}
                onChange={(event) => setPortInput(event.target.value)}
                className="w-20 rounded border border-line bg-surface px-2 py-1 font-mono text-ink text-xs"
              />
            </label>
            <SecondaryButton onClick={applyPort}>変更</SecondaryButton>
          </form>
        </div>

        {portError !== "" && (
          <p
            role="alert"
            className="border-line border-b bg-danger-soft px-4 py-2 text-danger text-xs"
          >
            {portError}
          </p>
        )}

        <div className="min-h-56 bg-surface p-6">
          {matched ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-line bg-canvas p-6 font-mono text-ink text-lg">
                {previewBodyFor(image?.recipe)}
              </div>
              <dl className="grid grid-cols-1 gap-2 rounded-lg border border-line bg-canvas/60 p-3 text-xs sm:grid-cols-3">
                <div>
                  <dt className="text-muted">コンテナ</dt>
                  <dd className="font-mono text-ink">{matched.name}</dd>
                </div>
                <div>
                  <dt className="text-muted">イメージ</dt>
                  <dd className="truncate font-mono text-ink" title={matched.imageRef}>
                    {matched.imageRef}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">ポート転送</dt>
                  <dd className="font-mono text-ink">
                    {matched.hostPort} → {matched.containerPort}
                  </dd>
                </div>
              </dl>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1">
                <p className="font-semibold text-ink text-base">
                  ポート {port} に接続できませんでした
                </p>
                <p className="text-muted text-sm">
                  Cloud Shell 上でポート {port} をリッスンしている実行中コンテナが見つかりません。
                </p>
              </div>
              <p className="rounded-lg border border-line bg-canvas p-3 font-mono text-muted text-xs">
                docker run -d -p {port}:8080 &lt;IMAGE&gt;
              </p>
              {running.length > 0 && (
                <div className="space-y-2">
                  <p className="text-muted text-xs">現在リッスン中のポート:</p>
                  <div className="flex flex-wrap gap-2">
                    {running
                      .filter((container) => container.hostPort > 0)
                      .map((container) => (
                        <SecondaryButton
                          key={container.id}
                          onClick={() => onChangePort(container.hostPort)}
                        >
                          ポート {container.hostPort} ({container.name})
                        </SecondaryButton>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-line border-t bg-canvas px-4 py-2 text-muted text-xs">
          <span>シミュレート表示（実際の HTTP 通信は行いません）</span>
          <SecondaryButton onClick={onClose}>閉じる</SecondaryButton>
        </div>
      </div>
    </div>
  );
};
