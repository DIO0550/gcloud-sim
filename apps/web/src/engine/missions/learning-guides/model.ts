/** コマンドの列ではなく、目的から結果までを一続きで学ぶための教材。 */
export type GuideAction =
  | Readonly<{
      kind: "command";
      text: string;
      expectFailure?: boolean;
      capture?: Readonly<{ name: string; pattern: string }>;
    }>
  | Readonly<{ kind: "answer"; text: string }>
  | Readonly<{ kind: "load"; name: string; overwrite: boolean }>
  | Readonly<{ kind: "write"; name: string; content: string }>
  | Readonly<{ kind: "replace"; name: string; before: string; after: string }>;

export type GuideStep = Readonly<{
  title: string;
  explanation: string;
  actions: readonly GuideAction[];
  points: readonly Readonly<{ term: string; description: string }>[];
  expected: string;
}>;

export type MissionGuide = Readonly<{
  introduction: string;
  steps: readonly GuideStep[];
  takeaway: string;
}>;
