import type { Metadata } from "next";
import { Noto_Sans_JP } from "next/font/google";
import type { ReactNode } from "react";

import "./globals.css";

// 本文は Noto Sans JP。next/font がビルド時に取り込んで自己ホストするので、
// 表示時に Google Fonts へ取りに行かない。
const notoSansJp = Noto_Sans_JP({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "gcloud-sim",
  // ファビコンを足すときは app/ に icon.svg / apple-icon.png を置く（Next が拾う）。
  // favicon.ico は icons で assetUrl("/favicon.ico") を明示的に指す。プロジェクトページは
  // /gcloud-sim/ 配下なので、ブラウザ任せの「サイト直下の /favicon.ico」には落ちてこない。
};

type RootLayoutProps = {
  children: ReactNode;
};

const RootLayout = ({ children }: RootLayoutProps) => {
  return (
    <html lang="ja" className={notoSansJp.className}>
      <body className="min-h-dvh bg-canvas text-ink antialiased">{children}</body>
    </html>
  );
};

export default RootLayout;
