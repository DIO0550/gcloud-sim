import type { ValueOf } from "@/types/ValueOf";

/** Console ビューの画面（設計書 3.1 の一覧）。左ナビの現在地。 */
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

/** 画面が属するプロダクトと、そのプロダクトが要る API（無ければ「API を有効にする」画面になる）。 */
const Placement: Readonly<
  Record<ConsoleScreen, Readonly<{ section: ConsoleSection; api: ApiRequirement }>>
> = {
  iam: { section: "iam", api: "none" },
  "service-accounts": { section: "iam", api: "none" },
  roles: { section: "iam", api: "none" },
  budgets: { section: "billing", api: "none" },
  "vm-list": { section: "compute", api: "compute.googleapis.com" },
  "vm-create": { section: "compute", api: "compute.googleapis.com" },
  firewall: { section: "vpc", api: "compute.googleapis.com" },
  subnets: { section: "vpc", api: "compute.googleapis.com" },
  buckets: { section: "storage", api: "none" },
  clusters: { section: "gke", api: "container.googleapis.com" },
  "run-services": { section: "run", api: "run.googleapis.com" },
};

/** 画面が要る API。`none` は API の有効化を要らない画面。 */
export type ApiRequirement =
  | "none"
  | "compute.googleapis.com"
  | "container.googleapis.com"
  | "run.googleapis.com";

export const ConsoleScreen = {
  section(screen: ConsoleScreen): ConsoleSection {
    return Placement[screen].section;
  },

  requiredApi(screen: ConsoleScreen): ApiRequirement {
    return Placement[screen].api;
  },

  /** セクションごとの画面（ナビの並び）。 */
  inSection(section: ConsoleSection): readonly ConsoleScreen[] {
    return Object.values(ConsoleScreens).filter((s) => Placement[s].section === section);
  },

  all(): readonly ConsoleScreen[] {
    return Object.values(ConsoleScreens);
  },
} as const;
