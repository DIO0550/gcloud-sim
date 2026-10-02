import type { Preview } from "@storybook/nextjs-vite";

// アプリと同じトークン（色・書体）を効かせる。
import "../src/app/globals.css";

const preview: Preview = {
  parameters: {
    layout: "padded",
    controls: { expanded: true },
  },
};

export default preview;
