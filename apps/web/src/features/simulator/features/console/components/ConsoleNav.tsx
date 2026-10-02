import type { ReactElement } from "react";

import { NavItemButton } from "@/components/NavItemButton";
import {
  ConsoleScreen,
  type ConsoleSection,
  ConsoleSections,
} from "@/features/simulator/features/console/domains/console-screen";

type ConsoleNavProps = Readonly<{
  screen: ConsoleScreen;
  onChange: (screen: ConsoleScreen) => void;
}>;

/** 左ナビの見出し（設計書 3.1 のプロダクト名）。 */
const sectionText = (section: ConsoleSection): string => {
  switch (section) {
    case "iam":
      return "IAM と管理";
    case "billing":
      return "お支払い";
    case "compute":
      return "Compute Engine";
    case "vpc":
      return "VPC ネットワーク";
    case "storage":
      return "Cloud Storage";
    case "gke":
      return "Kubernetes Engine";
    case "run":
      return "Cloud Run";
  }
};

/** 画面の名前（左ナビの項目と画面の見出し）。 */
export const screenText = (screen: ConsoleScreen): string => {
  switch (screen) {
    case "iam":
      return "IAM";
    case "service-accounts":
      return "サービスアカウント";
    case "roles":
      return "ロール";
    case "budgets":
      return "予算とアラート";
    case "vm-list":
      return "VM インスタンス";
    case "vm-create":
      return "インスタンスを作成";
    case "firewall":
      return "ファイアウォール";
    case "subnets":
      return "サブネット";
    case "buckets":
      return "バケット";
    case "clusters":
      return "クラスタ";
    case "run-services":
      return "サービス";
  }
};

export { sectionText };

/**
 * Console の左ナビ（UI 案 2b: プロダクトごとの見出しと画面）。
 * 現在地は `ConsoleScreen.navItem` で引く（作成画面にいる間も一覧の項目が光る: UI 案 s1）。
 */
export const ConsoleNav = ({ screen, onChange }: ConsoleNavProps): ReactElement => {
  const current = ConsoleScreen.navItem(screen);
  return (
    <nav
      aria-label="Console ナビゲーション"
      className="flex min-h-0 flex-col overflow-auto border-line border-r bg-surface px-2.5 py-5"
    >
      {Object.values(ConsoleSections).map((section) => (
        <div key={section} className="mb-3">
          <h3 className="px-2.5 pb-1.5 font-medium text-[14.5px] text-muted">
            {sectionText(section)}
          </h3>
          <ul>
            {ConsoleScreen.inSection(section).map((item) => (
              <li key={item}>
                <NavItemButton
                  current={item === current}
                  currentKind="page"
                  className={`rounded-lg px-4 py-2 text-[15px] ${item === current ? "font-bold text-accent" : ""}`}
                  onClick={() => onChange(item)}
                >
                  {screenText(item)}
                </NavItemButton>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
};
