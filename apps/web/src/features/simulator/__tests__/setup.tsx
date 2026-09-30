import { render } from "@testing-library/react";

import { Engine, type OutputLine } from "@/engine";
import type { World } from "@/engine/domains/world";
import { Simulator, type SimulatorIo } from "@/features/simulator";
import type { TerminalView } from "@/libs/terminal-view";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

export const Now = "2026-09-30T14:02:31.000Z";

/**
 * xterm の代わりに、書かれた行を配列に溜め、キー入力を外から流し込めるフェイク。
 * 外部ライブラリ（プロセス外の境界）の代替なので、テストではこれを注入する。
 */
export type FakeTerminal = Readonly<{
  view: TerminalView;
  written: string[];
  /** ユーザーの打鍵として流す */
  type: (data: string) => void;
}>;

export const fakeTerminal = (): FakeTerminal => {
  const written: string[] = [];
  const handlers: ((data: string) => void)[] = [];
  const view: TerminalView = {
    write: (text) => {
      written.push(text);
    },
    writeLine: (line: OutputLine) => {
      written.push(`${line.text}\n`);
    },
    onData: (handler) => {
      handlers.push(handler);
      return () => handlers.splice(handlers.indexOf(handler), 1);
    },
    fit: () => {},
    cols: () => 120,
    clear: () => {
      written.push("<clear>");
    },
    focus: () => {},
    dispose: () => {},
  };
  const type = (data: string): void => {
    for (const handler of handlers) handler(data);
  };
  return { view, written, type };
};

export type Harness = Readonly<{
  terminal: FakeTerminal;
  saved: World[];
  downloads: string[];
  copied: string[];
  io: SimulatorIo;
}>;

type HarnessOptions = Readonly<{
  saveFails?: string;
  confirmAnswer?: boolean;
  readResult?: SimulatorIo["readFile"];
}>;

export const harness = (options: HarnessOptions = {}): Harness => {
  const terminal = fakeTerminal();
  const saved: World[] = [];
  const downloads: string[] = [];
  const copied: string[] = [];
  const io: SimulatorIo = {
    now: () => Now,
    save: (world) => {
      if (options.saveFails !== undefined) return Result.err({ reason: options.saveFails });
      saved.push(world);
      return Result.ok(JSON.stringify(world).length);
    },
    download: (_world, now) => {
      downloads.push(now);
    },
    readFile:
      options.readResult ?? (async () => Result.err({ kind: "malformed", reason: "not used" })),
    confirm: () => options.confirmAnswer ?? true,
    copy: (text) => {
      copied.push(text);
    },
    createTerminalView: async () => terminal.view,
    capacityBytes: 5 * 1024 * 1024,
  };
  return { terminal, saved, downloads, copied, io };
};

export const renderSimulator = (
  options: HarnessOptions = {},
  world: World = Engine.initialWorld(Now),
) => {
  const h = harness(options);
  const rendered = render(<Simulator start={{ world, warning: Option.none }} io={h.io} />);
  return { ...h, ...rendered };
};

/** 端末に書かれたものを 1 つの文字列にする。 */
export const screenText = (terminal: FakeTerminal): string => terminal.written.join("");
