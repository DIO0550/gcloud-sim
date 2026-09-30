import type { NextConfig } from "next";

// public/ 配下を参照する側と値がずれないよう、定義は src/base-path.ts に置いてある。
import { BASE_PATH as basePath } from "./src/base-path";

const nextConfig: NextConfig = {
  // 静的ファイルだけを吐く。`next build` の出力は out/。
  output: "export",
  basePath,

  // 末尾スラッシュを付けて `out/foo/index.html` の形にする。
  // 拡張子なしの URL をどう解決するかは静的ホストによって差があるので、
  // ディレクトリ + index.html に寄せておくほうが素直に動く。
  trailingSlash: true,

  // static export では next/image の最適化サーバが無いので、最適化を切る。
  images: {
    unoptimized: true,
  },

  typescript: {
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
