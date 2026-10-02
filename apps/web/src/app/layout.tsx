import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans_JP } from "next/font/google";
import type { ReactNode } from "react";

import "./globals.css";

// 本文は IBM Plex Sans JP、等幅は IBM Plex Mono（モック docs/ui/ の書体）。next/font がビルド時に
// 取り込んで自己ホストするので、表示時に Google Fonts へ取りに行かない。
// 等幅は CSS 変数で渡し、globals.css の --font-mono と端末（xterm）の両方が使う。
const plexSansJp = IBM_Plex_Sans_JP({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
  variable: "--font-plex-mono",
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
    <html lang="ja" className={`${plexSansJp.className} ${plexMono.variable}`}>
      <body className="min-h-dvh bg-canvas text-ink antialiased">{children}</body>
    </html>
  );
};

export default RootLayout;
