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
  onClose?: () => void;
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
    case "marketplace":
      return "Marketplace";
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
    case "instance-template-create":
      return "インスタンス テンプレートを作成";
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
    case "vpc-networks":
      return "VPC ネットワーク";
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
    case "marketplace":
      return "プロダクトを検索";
    case "solution-deployments":
      return "ソリューションのデプロイ";
  }
};

export { sectionText };

/** プロダクト別のシンプルなモノクロ / Google Blue 系アイコン。 */
const ProductIcon = ({
  section,
  className = "h-5 w-5",
}: Readonly<{ section: ConsoleSection; className?: string }>): ReactElement => {
  switch (section) {
    case "iam":
      return (
        <svg aria-hidden="true" viewBox="0 0 20 20" className={className} fill="none">
          <path
            d="M10 2.5 4 5v4.5c0 3.7 2.5 6.8 6 8 3.5-1.2 6-4.3 6-8V5l-6-2.5Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <circle cx="10" cy="8.5" r="1.8" fill="currentColor" />
          <path
            d="M7 13c.6-1.3 1.7-2 3-2s2.4.7 3 2"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      );
    case "billing":
      return (
        <svg aria-hidden="true" viewBox="0 0 20 20" className={className} fill="none">
          <rect
            x="2.5"
            y="4.5"
            width="15"
            height="11"
            rx="1.8"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path d="M2.5 8h15M5.5 12h4" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case "compute":
      return (
        <svg aria-hidden="true" viewBox="0 0 20 20" className={className} fill="none">
          <rect
            x="5.5"
            y="5.5"
            width="9"
            height="9"
            rx="1.2"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <rect x="8" y="8" width="4" height="4" fill="currentColor" />
          <path
            d="M8 2.5v3M12 2.5v3M8 14.5v3M12 14.5v3M2.5 8h3M2.5 12h3M14.5 8h3M14.5 12h3"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      );
    case "gke":
      return (
        <svg aria-hidden="true" viewBox="0 0 20 20" className={className} fill="none">
          <path
            d="M10 2.5 16.5 6.25v7.5L10 17.5 3.5 13.75v-7.5L10 2.5Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <circle cx="10" cy="10" r="2.2" fill="currentColor" />
          <path
            d="M10 2.5v5.3M16.5 13.75l-4.5-2.6M3.5 13.75l4.5-2.6"
            stroke="currentColor"
            strokeWidth="1.4"
          />
        </svg>
      );
    case "run":
      return (
        <svg aria-hidden="true" viewBox="0 0 20 20" className={className} fill="none">
          <path
            d="M4 4.5 16 10 4 15.5 7 10 4 4.5Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "storage":
      return (
        <svg aria-hidden="true" viewBox="0 0 20 20" className={className} fill="none">
          <rect
            x="3"
            y="4"
            width="14"
            height="5"
            rx="1.2"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <rect
            x="3"
            y="11"
            width="14"
            height="5"
            rx="1.2"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <circle cx="14" cy="6.5" r="1" fill="currentColor" />
          <circle cx="14" cy="13.5" r="1" fill="currentColor" />
        </svg>
      );
    case "vpc":
      return (
        <svg aria-hidden="true" viewBox="0 0 20 20" className={className} fill="none">
          <circle cx="10" cy="4.5" r="2" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="4.5" cy="15" r="2" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="15.5" cy="15" r="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10 6.5v3.5m0 0-4.2 3.4M10 10l4.2 3.4" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      );
    case "marketplace":
      return (
        <svg aria-hidden="true" viewBox="0 0 20 20" className={className} fill="none">
          <path
            d="M3.5 7.5 5 3.5h10l1.5 4M3.5 7.5h13v8.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V7.5Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path d="M8 11.5h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
  }
};

type NavGroup = Readonly<{ heading?: string; screens: readonly ConsoleScreen[] }>;

const sectionGroups = (section: ConsoleSection): readonly NavGroup[] => {
  if (section === ConsoleSections.Compute) {
    return [
      { heading: "仮想マシン", screens: ["vm-list", "instance-templates", "instance-groups"] },
      { heading: "ストレージ", screens: ["disks", "snapshots", "images"] },
      { heading: "その他", screens: ["operations", "zones"] },
    ];
  }
  return [{ screens: ConsoleScreen.inSection(section) }];
};

/** Google Cloud Console 風のプロダクト別左ナビ。全プロダクトで統一されたサブナビ＋「すべてのプロダクト」導線を持つ。 */
export const ConsoleNav = ({ screen, onChange, onClose }: ConsoleNavProps): ReactElement => {
  const [showProducts, setShowProducts] = useState(false);
  const current = ConsoleScreen.navItem(screen);
  const activeSection = ConsoleScreen.section(screen);
  const navigate = (item: ConsoleScreen): void => {
    setShowProducts(false);
    onChange(item);
  };
  const categories: Partial<Record<ConsoleSection, string>> = {
    iam: "管理",
    compute: "コンピューティング",
    storage: "ストレージ",
    vpc: "ネットワーキング",
    marketplace: "ソリューション",
  };
  const groups = sectionGroups(activeSection);
  return (
    <nav
      aria-label="Console ナビゲーション"
      className="absolute top-0 bottom-0 left-0 z-30 flex min-h-0 w-64 flex-col overflow-auto border-line border-r bg-surface pb-4 md:relative md:w-auto"
    >
      {onClose !== undefined && (
        <div className="flex justify-end border-line border-b px-3 py-2 md:hidden">
          <button
            type="button"
            aria-label="ナビゲーションを閉じる"
            className="rounded px-2 py-1 text-muted text-xs hover:bg-canvas hover:text-ink"
            onClick={onClose}
          >
            ✕ 閉じる
          </button>
        </div>
      )}
      {!showProducts ? (
        <>
          <div className="mb-3 border-line border-b px-4 py-3">
            <h3 className="flex items-center gap-2.5 font-medium text-[15px] text-ink">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-accent-soft text-accent">
                <ProductIcon section={activeSection} className="h-4 w-4" />
              </span>
              <span className="truncate">{sectionText(activeSection)}</span>
            </h3>
            <button
              type="button"
              className="mt-2 inline-flex items-center gap-1 rounded px-1 py-0.5 text-left text-accent text-xs hover:bg-accent-soft"
              onClick={() => setShowProducts(true)}
            >
              <span aria-hidden="true">←</span>
              すべてのプロダクト
            </button>
          </div>
          {groups.map((group, index) => (
            <div key={group.heading ?? `group-${index}`} className="mb-3">
              {group.heading !== undefined && (
                <h4 className="px-4 pb-1.5 font-medium text-[11px] text-muted uppercase tracking-wider">
                  {group.heading}
                </h4>
              )}
              <ul className="pr-2.5">
                {group.screens.map((item) => (
                  <li key={item}>
                    <NavItemButton
                      current={item === current}
                      currentKind="page"
                      className={`rounded-r-full px-5 py-2 text-[13px] transition-colors ${item === current ? "font-medium text-accent" : "text-ink"}`}
                      onClick={() => navigate(item)}
                    >
                      {screenText(item)}
                    </NavItemButton>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      ) : (
        <div className="pt-3">
          <div className="mb-3 flex items-center justify-between border-line border-b px-4 pb-2.5">
            <span className="font-medium text-ink text-xs">すべてのプロダクト</span>
            <button
              type="button"
              className="rounded px-1.5 py-0.5 text-accent text-xs hover:bg-accent-soft"
              onClick={() => setShowProducts(false)}
            >
              戻る
            </button>
          </div>
          {Object.values(ConsoleSections).map((section) => (
            <div key={section} className="mb-3">
              {categories[section] !== undefined && (
                <p className="mb-1 px-4 font-medium text-[11px] text-muted uppercase tracking-wider">
                  {categories[section]}
                </p>
              )}
              <h3 className="flex items-center gap-2.5 px-4 py-1 font-medium text-ink text-xs">
                <span className="text-muted">
                  <ProductIcon section={section} className="h-4 w-4" />
                </span>
                {sectionText(section)}
              </h3>
              <ul className="pr-2.5">
                {ConsoleScreen.inSection(section).map((item) => (
                  <li key={item}>
                    <NavItemButton
                      current={item === current}
                      currentKind="page"
                      className={`rounded-r-full py-1.5 pr-3 pl-10 text-[13px] transition-colors ${item === current ? "font-medium text-accent" : "text-ink"}`}
                      onClick={() => navigate(item)}
                    >
                      {screenText(item)}
                    </NavItemButton>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      <p className="mt-auto border-line border-t px-4 pt-3 text-[11px] text-muted leading-relaxed">
        Google 非公式の学習用シミュレータ
        <br />
        実際の Google Cloud には接続しません
      </p>
    </nav>
  );
};
