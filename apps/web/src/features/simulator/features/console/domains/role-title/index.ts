import type { RoleName } from "@/engine/domains/iam-policy";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";

/**
 * Console（日本語）で出すロールの名前（UI 案 s2: `オーナー` / `Compute インスタンス管理者（v1）`）。
 * 本物の Console の日本語表示に合わせる。ここに無いロールはカタログの英語の title のまま出す。
 */
const JapaneseTitles: Readonly<Partial<Record<RoleName, string>>> = {
  "roles/owner": "オーナー",
  "roles/editor": "編集者",
  "roles/viewer": "閲覧者",
  "roles/browser": "ブラウザ",
  "roles/resourcemanager.projectCreator": "プロジェクト作成者",
  "roles/resourcemanager.projectIamAdmin": "プロジェクト IAM 管理者",
  "roles/resourcemanager.folderAdmin": "フォルダ管理者",
  "roles/resourcemanager.organizationAdmin": "組織の管理者",
  "roles/resourcemanager.organizationViewer": "組織閲覧者",
  "roles/billing.admin": "請求先アカウント管理者",
  "roles/billing.user": "請求先アカウント ユーザー",
  "roles/billing.viewer": "請求先アカウント閲覧者",
  "roles/billing.projectManager": "プロジェクト支払い管理者",
  "roles/compute.admin": "Compute 管理者",
  "roles/compute.instanceAdmin.v1": "Compute インスタンス管理者（v1）",
  "roles/compute.instanceAdmin": "Compute インスタンス管理者（ベータ版）",
  "roles/compute.networkAdmin": "Compute ネットワーク管理者",
  "roles/compute.securityAdmin": "Compute セキュリティ管理者",
  "roles/compute.networkUser": "Compute ネットワーク ユーザー",
  "roles/compute.viewer": "Compute 閲覧者",
  "roles/storage.admin": "Storage 管理者",
  "roles/storage.objectAdmin": "Storage オブジェクト管理者",
  "roles/storage.objectCreator": "Storage オブジェクト作成者",
  "roles/storage.objectViewer": "Storage オブジェクト閲覧者",
  "roles/storage.objectUser": "Storage オブジェクト ユーザー",
  "roles/iam.serviceAccountAdmin": "サービス アカウント管理者",
  "roles/iam.serviceAccountKeyAdmin": "サービス アカウント キー管理者",
  "roles/iam.serviceAccountUser": "サービス アカウント ユーザー",
  "roles/iam.serviceAccountTokenCreator": "サービス アカウント トークン作成者",
  "roles/iam.securityReviewer": "セキュリティ審査担当者",
  "roles/iam.roleAdmin": "ロール管理者",
  "roles/container.admin": "Kubernetes Engine 管理者",
  "roles/container.developer": "Kubernetes Engine デベロッパー",
  "roles/container.viewer": "Kubernetes Engine 閲覧者",
  "roles/run.admin": "Cloud Run 管理者",
  "roles/run.developer": "Cloud Run デベロッパー",
  "roles/run.invoker": "Cloud Run 起動元",
  "roles/logging.viewer": "ログ閲覧者",
  "roles/logging.admin": "Logging 管理者",
  "roles/monitoring.viewer": "モニタリング閲覧者",
};

/**
 * ロールの日本語の名前。日本語の名前を持たないもの（カスタムロール等）はカタログの title、
 * それも無ければロールの綴りそのもの。
 *
 * @param world カスタムロールを引く元
 * @param role ロール
 * @returns 表示する名前
 */
export const roleTitleJa = (world: World, role: RoleName): string =>
  Option.unwrapOr(Option.fromNullable(JapaneseTitles[role]), World.roleTitle(world, role));
