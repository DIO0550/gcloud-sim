"use client";

import "@xterm/xterm/css/xterm.css";

import { type ReactElement, useEffect, useRef, useState } from "react";

import type { OutputLine } from "@/engine";
import { InputLayout, type InputRender } from "@/features/simulator/domains/input-layout";
import { LineEditor } from "@/features/simulator/domains/line-editor";
import type { TranscriptEntry } from "@/features/simulator/hooks/use-simulator";
import { Logger } from "@/libs/logger";
import type { TerminalView, TerminalViewFactory } from "@/libs/terminal-view";
import { Option } from "@/utils/Option";

type TerminalProps = Readonly<{
  transcript: readonly TranscriptEntry[];
  /** 値が変わったら画面を消す */
  clearEpoch: number;
  /** 入力行に差し込む文字列（ツリーのダブルクリック） */
  pendingInsert: Option<Readonly<{ seq: number; text: string }>>;
  onSubmit: (line: string) => void;
  complete: (line: string) => readonly string[];
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
 * 端末に対する可変の状態。render では読まず、キー入力と出力の effect の中でだけ触る。
 * `rendered` は描いてある入力行の大きさで、折り返した行を消すのに要る。
 */
type Session = {
  view: TerminalView;
  editor: LineEditor;
  rendered: Option<InputRender>;
};

const draw = (session: Session): void => {
  const redraw = InputLayout.redraw(session.rendered, session.editor, session.view.cols());
  session.view.write(redraw.sequence);
  session.rendered = Option.some(redraw.rendered);
};

/** 描いてある入力行を消して行頭に戻る。出力を書く前と、Enter の直後に呼ぶ。 */
const eraseInput = (session: Session): void => {
  session.view.write(InputLayout.erase(session.rendered, session.view.cols()));
  session.rendered = Option.none;
};

const handleData = (session: Session, data: string, callbacks: TerminalProps): void => {
  const stepped = LineEditor.handle(session.editor, data);
  session.editor = stepped.editor;
  for (const effect of stepped.effects) {
    switch (effect.kind) {
      case "render":
        draw(session);
        break;
      case "submit":
        // 打った行はそのまま残し、次の行から出力を書く。
        session.view.write("\r\n");
        session.rendered = Option.none;
        callbacks.onSubmit(effect.line);
        break;
      case "interrupt":
        session.view.write("^C\r\n");
        session.rendered = Option.none;
        draw(session);
        break;
      case "clear":
        session.view.clear();
        session.rendered = Option.none;
        draw(session);
        break;
      case "complete": {
        const candidates = callbacks.complete(LineEditor.lineForCompletion(session.editor));
        const completed = LineEditor.complete(session.editor, candidates);
        session.editor = completed.editor;
        if (completed.listing.length > 0) {
          eraseInput(session);
          session.view.write(`${InputLayout.Prompt}${completed.editor.buffer}\r\n`);
          session.view.write(`${completed.listing.join("  ")}\r\n`);
        }
        draw(session);
        break;
      }
    }
  }
};

/**
 * xterm.js の端末。行編集は `LineEditor`（純粋）、折り返しの計算は `InputLayout`（純粋）が持ち、
 * ここはキー入力と出力の配線だけを行う。出力は transcript の差分を書く。
 * CLI で打った入力行は既に端末に映っているので書き直さない。
 */
export const Terminal = (props: TerminalProps): ReactElement => {
  const { transcript, clearEpoch, pendingInsert, createView, caption } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<Option<Session>>(Option.none);
  const writtenRef = useRef(0);
  const clearEpochRef = useRef(clearEpoch);
  const insertSeqRef = useRef(0);
  const propsRef = useRef(props);
  propsRef.current = props;
  const [isReady, setReady] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    let disposed = false;
    let unsubscribe = (): void => {};
    let opened: Option<TerminalView> = Option.none;
    createView(container).then(
      (view) => {
        if (disposed) {
          view.dispose();
          return;
        }
        opened = Option.some(view);
        const session: Session = { view, editor: LineEditor.create(), rendered: Option.none };
        sessionRef.current = Option.some(session);
        for (const line of Banner) view.writeLine(line);
        draw(session);
        view.focus();
        unsubscribe = view.onData((data) => handleData(session, data, propsRef.current));
        setReady(true);
      },
      (error: unknown) => Logger.error("terminal could not be opened", error),
    );
    const onResize = (): void => {
      if (Option.isSome(sessionRef.current)) sessionRef.current.value.view.fit();
    };
    window.addEventListener("resize", onResize);
    return () => {
      disposed = true;
      unsubscribe();
      window.removeEventListener("resize", onResize);
      if (Option.isSome(opened)) opened.value.dispose();
      sessionRef.current = Option.none;
      writtenRef.current = 0;
    };
  }, [createView]);

  // transcript の差分を端末へ書き、最後に入力行を描き直す（外部システムとの同期）。
  useEffect(() => {
    if (!isReady || !Option.isSome(sessionRef.current)) return;
    const session = sessionRef.current.value;
    const pending = transcript.slice(writtenRef.current);
    if (pending.length === 0) return;
    if (clearEpochRef.current !== clearEpoch) {
      clearEpochRef.current = clearEpoch;
      session.view.clear();
      session.rendered = Option.none;
    }
    eraseInput(session);
    for (const entry of pending) {
      const isEchoedAlready = entry.kind === "input" && entry.origin === "cli";
      if (isEchoedAlready) continue;
      const text = entry.kind === "input" ? `${InputLayout.Prompt}${entry.text}` : entry.text;
      session.view.writeLine({ text, tone: entry.tone });
    }
    writtenRef.current = transcript.length;
    draw(session);
  }, [transcript, clearEpoch, isReady]);

  // ツリーからの挿入。同じ文字列でも seq が変われば入れ直す。
  useEffect(() => {
    if (!isReady || !Option.isSome(pendingInsert) || !Option.isSome(sessionRef.current)) return;
    if (pendingInsert.value.seq === insertSeqRef.current) return;
    insertSeqRef.current = pendingInsert.value.seq;
    const session = sessionRef.current.value;
    session.editor = LineEditor.replace(session.editor, pendingInsert.value.text);
    draw(session);
    session.view.focus();
  }, [pendingInsert, isReady]);

  return (
    <section aria-label="ターミナル" className="flex min-h-0 flex-1 flex-col bg-surface">
      <div className="flex items-center justify-between border-line border-b px-4 py-2 text-muted text-xs">
        <span className="font-mono">bash — gcloud-sim</span>
        <span className="font-mono">{caption}</span>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1 px-3 py-2" data-testid="terminal-host" />
      <div className="flex items-center justify-between border-line border-t px-4 py-1.5 text-muted text-xs">
        <span>↑↓ 履歴　Tab 補完　Ctrl+L クリア</span>
      </div>
    </section>
  );
};
