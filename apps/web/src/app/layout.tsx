import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans_JP } from "next/font/google";
import type { ReactNode } from "react";
import { assetUrl } from "@/base-path";

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
  icons: {
    icon: {
      url: assetUrl("/favicon.ico"),
      type: "image/x-icon",
      sizes: "16x16 32x32 48x48 256x256",
    },
  },
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
