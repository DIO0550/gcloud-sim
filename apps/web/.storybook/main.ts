import type { StorybookConfig } from "@storybook/nextjs-vite";

// 共通コンポーネント（src/components）の見た目と状態をカタログで確かめる。
// 各コンポーネントのフォルダに `<Name>.stories.tsx` を置く。
const config: StorybookConfig = {
  framework: "@storybook/nextjs-vite",
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  // 匿名の利用状況を Storybook へ送らない。
  core: { disableTelemetry: true },
};

export default config;
