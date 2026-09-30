"use client";

import { type ReactElement, useEffect, useState } from "react";

import { Engine } from "@/engine";
import type { World } from "@/engine/domains/world";
import { Simulator, type SimulatorIo } from "@/features/simulator";
import { Clock } from "@/libs/clock";
import { Logger } from "@/libs/logger";
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
  createTerminalView: createXtermView,
  capacityBytes: StorageCapacityBytes,
};

/** 保存があればそれ、無ければ初期 World。壊れていれば理由をログに残して初期 World から始める。 */
const loadWorld = (): World => {
  const loaded = WorldStorage.load();
  if (Result.isOk(loaded)) {
    return Option.unwrapOr(loaded.value, Engine.initialWorld(Clock.now()));
  }
  Logger.error("saved world could not be loaded; starting from the initial world", loaded.error);
  return Engine.initialWorld(Clock.now());
};

/**
 * ブラウザでだけ描く入口。World は localStorage にあるので、prerender と最初の描画では
 * プレースホルダーを出し、マウント後に読んでから本体を描く（hydration の食い違いを作らない）。
 */
export const SimulatorLoader = (): ReactElement => {
  const [world, setWorld] = useState<Option<World>>(Option.none);
  useEffect(() => {
    setWorld(Option.some(loadWorld()));
  }, []);
  if (!Option.isSome(world)) {
    return (
      <main className="flex h-dvh items-center justify-center text-muted">
        <p>gcloud-sim を読み込んでいます…</p>
      </main>
    );
  }
  return <Simulator initialWorld={world.value} io={io} />;
};
