import { type ReactElement, useState } from "react";

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
    case "instance-templates":
      return "インスタンス テンプレート";
    case "instance-groups":
      return "インスタンス グループ";
    case "disks":
      return "ディスク";
    case "snapshots":
      return "スナップショット";
    case "images":
      return "イメージ";
    case "operations":
      return "オペレーション";
    case "zones":
      return "ゾーン";
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

/** プロダクト別のナビ（UI 案 2b / 2d）。各項目から対応する一覧画面へ移動する。 */
export const ConsoleNav = ({ screen, onChange }: ConsoleNavProps): ReactElement => {
  const [showProducts, setShowProducts] = useState(false);
  const current = ConsoleScreen.navItem(screen);
  const compute = ConsoleScreen.section(screen) === ConsoleSections.Compute && !showProducts;
  const navigate = (item: ConsoleScreen): void => {
    setShowProducts(false);
    onChange(item);
  };
  const categories: Partial<Record<ConsoleSection, string>> = {
    iam: "管理",
    compute: "コンピューティング",
    storage: "ストレージとネットワーク",
  };
  const groups: readonly Readonly<{ heading: string; screens: readonly ConsoleScreen[] }>[] = [
    { heading: "仮想マシン", screens: ["vm-list", "instance-templates", "instance-groups"] },
    { heading: "ストレージ", screens: ["disks", "snapshots", "images"] },
    { heading: "その他", screens: ["operations", "zones"] },
  ];
  return (
    <nav
      aria-label="Console ナビゲーション"
      className="absolute top-0 bottom-0 left-0 z-30 flex min-h-0 w-64 flex-col overflow-auto border-line border-r bg-surface py-4 md:relative md:w-auto"
    >
      {compute ? (
        <>
          <h3 className="mb-4 flex items-center gap-3 px-5 font-medium text-base">
            <span aria-hidden="true" className="h-6 w-6 rounded bg-accent" />
            Compute Engine
          </h3>
          {groups.map((group) => (
            <div key={group.heading} className="mb-4">
              <h4 className="px-5 pb-2 font-medium text-muted text-xs">{group.heading}</h4>
              <ul className="pr-3">
                {group.screens.map((item) => (
                  <li key={item}>
                    <NavItemButton
                      current={item === current}
                      currentKind="page"
                      className={`rounded-r-full px-6 py-2.5 text-sm ${item === current ? "font-medium text-accent" : ""}`}
                      onClick={() => navigate(item)}
                    >
                      {screenText(item)}
                    </NavItemButton>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <button
            type="button"
            className="mt-2 px-5 py-3 text-left text-accent text-sm hover:bg-canvas"
            onClick={() => setShowProducts(true)}
          >
            すべてのプロダクト
          </button>
        </>
      ) : (
        Object.values(ConsoleSections).map((section) => (
          <div key={section} className="mb-4">
            {categories[section] !== undefined && (
              <p className="mb-2 px-5 text-muted text-xs">{categories[section]}</p>
            )}
            <h3 className="flex items-center gap-3 px-5 pb-1.5 font-medium text-sm">
              <span aria-hidden="true" className="text-muted">
                ◇
              </span>
              {sectionText(section)}
            </h3>
            <ul>
              {ConsoleScreen.inSection(section).map((item) => (
                <li key={item}>
                  <NavItemButton
                    current={item === current}
                    currentKind="page"
                    className={`rounded-r-full py-2.5 pr-3 pl-12 text-sm ${item === current ? "font-medium text-accent" : ""}`}
                    onClick={() => navigate(item)}
                  >
                    {screenText(item)}
                  </NavItemButton>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
      <p className="mt-auto border-line border-t px-5 pt-4 text-muted text-xs leading-relaxed">
        Google 非公式の学習用シミュレータ
        <br />
        実際の Google Cloud には接続しません
      </p>
    </nav>
  );
};
