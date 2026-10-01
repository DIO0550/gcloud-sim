import type { ApiName } from "@/engine/domains/catalog";
import type { ValueOf } from "@/types/ValueOf";
import { Option } from "@/utils/Option";

/** Console ビューの画面（設計書 3.1 の一覧 + ロール）。左ナビの現在地。 */
export const ConsoleScreens = {
  Iam: "iam",
  ServiceAccounts: "service-accounts",
  Roles: "roles",
  Budgets: "budgets",
  VmList: "vm-list",
  VmCreate: "vm-create",
  Firewall: "firewall",
  Subnets: "subnets",
  Buckets: "buckets",
  Clusters: "clusters",
  RunServices: "run-services",
} as const;
export type ConsoleScreen = ValueOf<typeof ConsoleScreens>;

/** 左ナビの見出しの単位（本物の Console のプロダクト）。綴りは表示側が決める。 */
export const ConsoleSections = {
  Iam: "iam",
  Billing: "billing",
  Compute: "compute",
  Vpc: "vpc",
  Storage: "storage",
  Gke: "gke",
  Run: "run",
} as const;
export type ConsoleSection = ValueOf<typeof ConsoleSections>;

/**
 * 画面が属するプロダクト、そのプロダクトが要る API（無ければ「API を有効にする」画面になる）、
 * 左ナビで現在地として光る項目（作成画面はナビ項目ではなく、一覧の項目が光る: UI 案 s1）。
 */
type Placement = Readonly<{
  section: ConsoleSection;
  api: Option<ApiName>;
  navItem: ConsoleScreen;
}>;

const place = (
  section: ConsoleSection,
  api: Option<ApiName>,
  navItem: Option<ConsoleScreen> = Option.none,
) => ({ section, api, navItem });

const Placements: Readonly<Record<ConsoleScreen, ReturnType<typeof place>>> = {
  iam: place("iam", Option.none),
  "service-accounts": place("iam", Option.none),
  roles: place("iam", Option.none),
  budgets: place("billing", Option.none),
  "vm-list": place("compute", Option.some("compute.googleapis.com")),
  "vm-create": place("compute", Option.some("compute.googleapis.com"), Option.some("vm-list")),
  firewall: place("vpc", Option.some("compute.googleapis.com")),
  subnets: place("vpc", Option.some("compute.googleapis.com")),
  buckets: place("storage", Option.none),
  clusters: place("gke", Option.some("container.googleapis.com")),
  "run-services": place("run", Option.some("run.googleapis.com")),
};

const placementOf = (screen: ConsoleScreen): Placement => {
  const p = Placements[screen];
  return { section: p.section, api: p.api, navItem: Option.unwrapOr(p.navItem, screen) };
};

export const ConsoleScreen = {
  section(screen: ConsoleScreen): ConsoleSection {
    return placementOf(screen).section;
  },

  /** 画面のプロダクトが要る API。要らなければ `none`。 */
  requiredApi(screen: ConsoleScreen): Option<ApiName> {
    return placementOf(screen).api;
  },

  /** 左ナビで現在地として光る項目。 */
  navItem(screen: ConsoleScreen): ConsoleScreen {
    return placementOf(screen).navItem;
  },

  /** セクションごとのナビ項目（自分自身がナビ項目である画面だけ）。 */
  inSection(section: ConsoleSection): readonly ConsoleScreen[] {
    return Object.values(ConsoleScreens).filter(
      (s) => placementOf(s).section === section && placementOf(s).navItem === s,
    );
  },

  all(): readonly ConsoleScreen[] {
    return Object.values(ConsoleScreens);
  },
} as const;
