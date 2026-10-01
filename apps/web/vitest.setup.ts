import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom は要素の大きさを持たないので ResizeObserver も無い。大きさが変わることのないフェイクを置く
// （`libs/element-size.ts` が包むプロセス外の境界）。
class StillResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = StillResizeObserver;

// テスト間で DOM を持ち越さない。
// localStorage などに状態を持つストアを作ったら、ここで一緒に捨てる。
afterEach(() => {
  cleanup();
});
