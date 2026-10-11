import type { Mission, MissionDomain } from "@/engine/missions";

/** 添付試験ガイドの4分類。操作カテゴリは変更せず、進捗IDも共有する。 */
export const ExamSections = {
  setup: "1. クラウド ソリューション環境の設定",
  implementation: "2. クラウド ソリューションの計画と実装",
  operations: "3. クラウド ソリューションの正常な運用",
  security: "4. アクセスとセキュリティの構成",
} as const;
export type ExamSection = (typeof ExamSections)[keyof typeof ExamSections];
const sectionByDomain: Record<MissionDomain, ExamSection> = {
  環境セットアップ: ExamSections.setup,
  計画と構成: ExamSections.implementation,
  デプロイと実装: ExamSections.implementation,
  運用の維持: ExamSections.operations,
  アクセスとセキュリティ: ExamSections.security,
};
export const examSectionOf = (mission: Mission): ExamSection => {
  // IaC/AI開発ツールの導入判断はガイド2.4。構成設定一般の1章とは区別する。
  if (
    ["m-ace-iac-foundation", "m-ace-assist-terminal", "m-ace-development-ide"].includes(mission.id)
  ) {
    return ExamSections.implementation;
  }
  return sectionByDomain[mission.domain];
};
