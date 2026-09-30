"use client";

import "@xterm/xterm/css/xterm.css";

import { type ReactElement, useEffect, useRef, useState } from "react";

import type { OutputLine } from "@/engine";
import { type DrawnInput, InputLayout } from "@/features/simulator/domains/input-layout";
import { LineEditor } from "@/features/simulator/domains/line-editor";
import type { TranscriptLine } from "@/features/simulator/hooks/use-simulator";
import { ElementSize } from "@/libs/element-size";
import { describeError } from "@/libs/json";
import { Logger } from "@/libs/logger";
import type { TerminalView, TerminalViewFactory } from "@/libs/terminal-view";
import { Option } from "@/utils/Option";

type TerminalProps = Readonly<{
  transcript: readonly TranscriptLine[];
  /** 値が変わったら画面を消す */
  screenClearCount: number;
  /** 入力行に差し込む文字列（ツリーのダブルクリック）。取り込んだら `onInsertConsumed` を呼ぶ */
  pendingInsert: Option<string>;
  onInsertConsumed: () => void;
  onSubmit: (line: string) => void;
  completionCandidates: (line: string) => readonly string[];
  createView: TerminalViewFactory;
  /** 端末の器の見出し。`configuration: default` のように右上に出す */
  caption: string;
}>;

const Banner: readonly OutputLine[] = [
  {
    text: "Welcome to gcloud-sim (Google 非公式の学習用シミュレータ / 本物の Google Cloud には接続しません)",
    tone: "muted",
  },
  {
    text: "対応コマンドは `gcloud --help` / docs/COMMANDS.md、Tab で補完、↑↓ で履歴、Ctrl+L で画面消去。",
    tone: "muted",
  },
  { text: "", tone: "plain" },
];

/**
 * 開いた端末に対する可変の状態。render では読まず、キー入力と出力の effect の中でだけ触る。
 * `drawn` は描いてある入力行の大きさで、折り返した行を消すのに要る。
 */
type TerminalHandle = {
  view: TerminalView;
  editor: LineEditor;
  drawn: Option<DrawnInput>;
};

/** 端末を開けたか。開けなければ器の中に理由を出す（xterm は canvas が要る）。 */
type OpenState =
  | Readonly<{ kind: "opening" }>
  | Readonly<{ kind: "open" }>
  | Readonly<{ kind: "failed"; reason: string }>;

const draw = (handle: TerminalHandle): void => {
  const redraw = InputLayout.redraw(handle.drawn, handle.editor, handle.view.cols());
  handle.view.write(redraw.sequence);
  handle.drawn = Option.some(redraw.rendered);
};

/** 描いてある入力行を消して行頭に戻る。出力を書く前と、Enter の直後に呼ぶ。 */
const eraseInput = (handle: TerminalHandle): void => {
  handle.view.write(InputLayout.erase(handle.drawn, handle.view.cols()));
  handle.drawn = Option.none;
};

const handleData = (handle: TerminalHandle, data: string, callbacks: TerminalProps): void => {
  const stepped = LineEditor.handle(handle.editor, data);
  handle.editor = stepped.editor;
  for (const effect of stepped.effects) {
    switch (effect.kind) {
      case "draw":
        draw(handle);
        break;
      case "submit":
        // 打った行はそのまま残し、次の行から出力を書く。
        handle.view.write("\r\n");
        handle.drawn = Option.none;
        callbacks.onSubmit(effect.line);
        break;
      case "interrupt":
        handle.view.write("^C\r\n");
        handle.drawn = Option.none;
        draw(handle);
        break;
      case "clear":
        handle.view.clear();
        handle.drawn = Option.none;
        draw(handle);
        break;
      case "complete": {
        const candidates = callbacks.completionCandidates(
          LineEditor.lineForCompletion(handle.editor),
        );
        const completed = LineEditor.complete(handle.editor, candidates);
        handle.editor = completed.editor;
        if (completed.listing.length > 0) {
          eraseInput(handle);
          handle.view.write(`${InputLayout.Prompt}${completed.editor.buffer}\r\n`);
          handle.view.write(`${completed.listing.join("  ")}\r\n`);
        }
        draw(handle);
        break;
      }
    }
  }
};

/**
 * xterm.js の端末。行編集は `LineEditor`（純粋）、折り返しの計算は `InputLayout`（純粋）が持ち、
 * ここはキー入力と出力の配線だけを行う。出力は transcript のうち、まだ書いていない id の行を書く。
 * CLI で打った入力行は既に端末に映っているので書き直さない。
 */
export const Terminal = (props: TerminalProps): ReactElement => {
  const { transcript, screenClearCount, pendingInsert, onInsertConsumed, createView, caption } =
    props;
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<Option<TerminalHandle>>(Option.none);
  const lastWrittenIdRef = useRef(0);
  const screenClearCountRef = useRef(screenClearCount);
  const propsRef = useRef(props);
  const [openState, setOpenState] = useState<OpenState>({ kind: "opening" });

  useEffect(() => {
    propsRef.current = props;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    let disposed = false;
    let unsubscribe = (): void => {};
    let opened: Option<TerminalView> = Option.none;
    let resizeFrame = 0;
    createView(container).then(
      (view) => {
        if (disposed) {
          view.dispose();
          return;
        }
        opened = Option.some(view);
        const handle: TerminalHandle = { view, editor: LineEditor.create(), drawn: Option.none };
        handleRef.current = Option.some(handle);
        for (const line of Banner) view.writeLine(line);
        draw(handle);
        view.focus();
        unsubscribe = view.onData((data) => handleData(handle, data, propsRef.current));
        setOpenState({ kind: "open" });
      },
      (error: unknown) => {
        Logger.error("terminal could not be opened", error);
        setOpenState({ kind: "failed", reason: describeError(error) });
      },
    );
    // 大きさの変化は連続して来るので、1 フレームに 1 回だけ列数を計算し直して入力行を描き直す。
    // 見張るのは window ではなく置き場の要素。Console へ切り替えると window はそのままで置き場だけが縮む。
    const onResize = (): void => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        if (!Option.isSome(handleRef.current)) return;
        handleRef.current.value.view.fit();
        draw(handleRef.current.value);
      });
    };
    const unobserve = ElementSize.observe(container, onResize);
    return () => {
      disposed = true;
      unsubscribe();
      cancelAnimationFrame(resizeFrame);
      unobserve();
      if (Option.isSome(opened)) opened.value.dispose();
      handleRef.current = Option.none;
      lastWrittenIdRef.current = 0;
    };
  }, [createView]);

  const isOpen = openState.kind === "open";

  // transcript のうち未書き込みの行を端末へ書き、最後に入力行を描き直す（外部システムとの同期）。
  useEffect(() => {
    if (!isOpen || !Option.isSome(handleRef.current)) return;
    const handle = handleRef.current.value;
    const pending = transcript.filter((line) => line.id > lastWrittenIdRef.current);
    if (pending.length === 0) return;
    if (screenClearCountRef.current !== screenClearCount) {
      screenClearCountRef.current = screenClearCount;
      handle.view.clear();
      handle.drawn = Option.none;
    }
    eraseInput(handle);
    for (const line of pending) {
      const isEchoedAlready = line.kind === "input" && line.origin === "cli";
      if (isEchoedAlready) continue;
      const text = line.kind === "input" ? `${InputLayout.Prompt}${line.text}` : line.text;
      handle.view.writeLine({ text, tone: line.tone });
    }
    lastWrittenIdRef.current = pending.at(-1)?.id ?? lastWrittenIdRef.current;
    draw(handle);
  }, [transcript, screenClearCount, isOpen]);

  // ツリーからの挿入。取り込んだら消してもらう。消さないと、`isOpen` が変わって effect が
  // 走り直したときに古い文字列を入力行へ入れ直してしまう。
  useEffect(() => {
    if (!isOpen || !Option.isSome(pendingInsert) || !Option.isSome(handleRef.current)) return;
    const handle = handleRef.current.value;
    handle.editor = LineEditor.replace(handle.editor, pendingInsert.value);
    draw(handle);
    handle.view.focus();
    onInsertConsumed();
  }, [pendingInsert, isOpen, onInsertConsumed]);

  return (
    <section aria-label="ターミナル" className="flex min-h-0 flex-1 flex-col bg-surface">
      <div className="flex items-center justify-between border-line border-b px-4 py-2 text-muted text-xs">
        <span className="font-mono">bash — gcloud-sim</span>
        <span className="font-mono">{caption}</span>
      </div>
      {/* overflow-hidden: xterm は入力用の textarea をカーソル行の位置に絶対配置で置く。置き場が縮んだ直後は
          前の行数の位置に残るので、はみ出しを切らないと文書の高さが伸びて画面全体がスクロールする。 */}
      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-hidden px-3 py-2"
        data-testid="terminal-host"
      >
        {openState.kind === "failed" && (
          <p role="alert" className="p-4 text-danger text-sm">
            ターミナルを開けませんでした（{openState.reason}）。ブラウザを再読み込みしてください。
          </p>
        )}
      </div>
      <div className="flex items-center justify-between border-line border-t px-4 py-1.5 text-muted text-xs">
        <span>↑↓ 履歴　Tab 補完　Ctrl+L クリア</span>
      </div>
    </section>
  );
};
