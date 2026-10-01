"use client";

import { type ReactElement, useEffect, useState } from "react";

import { Engine } from "@/engine";
import {
  describeImportFailure,
  Simulator,
  type SimulatorIo,
  type SimulatorStart,
} from "@/features/simulator";
import { Clipboard } from "@/libs/clipboard";
import { Clock } from "@/libs/clock";
import { SnapshotFile } from "@/libs/snapshot-file";
import { createXtermView } from "@/libs/terminal-view";
import { StorageCapacityBytes, WorldStorage } from "@/libs/world-storage";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const io: SimulatorIo = {
  now: Clock.now,
  save: WorldStorage.save,
  download: SnapshotFile.download,
  readFile: SnapshotFile.read,
  confirm: (message) => window.confirm(message),
  copy: Clipboard.copy,
  createTerminalView: createXtermView,
  capacityBytes: StorageCapacityBytes,
};

/**
 * 保存があればそれ、無ければ初期 World。読めなければ退避先を添えた注意と一緒に初期 World から始める
 * （黙ってリセットせず、端末の先頭で知らせる）。
 */
const loadStart = (): SimulatorStart => {
  const loaded = WorldStorage.load();
  if (Result.isOk(loaded)) {
    return {
      world: Option.unwrapOr(loaded.value, Engine.initialWorld(Clock.now())),
      warning: Option.none,
    };
  }
  const backedUp = Option.isSome(loaded.error.backupKey)
    ? `読めなかった中身は localStorage の ${loaded.error.backupKey.value} に退避しました。`
    : "読めなかった中身は退避できませんでした（次の保存で上書きされます）。";
  return {
    world: Engine.initialWorld(Clock.now()),
    warning: Option.some(
      `gcloud-sim: warning: 保存されていた状態を読めなかったので初期状態から始めます。${describeImportFailure(loaded.error.failure)} ${backedUp}`,
    ),
  };
};

/**
 * ブラウザでだけ描く入口。World は localStorage にあるので、prerender と最初の描画では
 * プレースホルダーを出し、マウント後に読んでから本体を描く（hydration の食い違いを作らない）。
 */
export const SimulatorLoader = (): ReactElement => {
  const [start, setStart] = useState<Option<SimulatorStart>>(Option.none);
  useEffect(() => {
    setStart(Option.some(loadStart()));
  }, []);
  if (!Option.isSome(start)) {
    return (
      <main className="flex h-dvh items-center justify-center text-muted">
        <p>gcloud-sim を読み込んでいます…</p>
      </main>
    );
  }
  return <Simulator start={start.value} io={io} />;
};
