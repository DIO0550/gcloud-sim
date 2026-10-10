import type { ReactElement } from "react";
import { effectiveOrgPolicy } from "@/engine/domains/admin-lab/policies";
import { adminResources } from "@/engine/domains/admin-lab/resources";
import { NotFound, Section, type SelectionProps } from "./PropertyParts";

const labels: Record<string, string> = {
  scope: "適用先",
  constraint: "制約",
  reset: "既定へリセット",
  enforce: "強制",
  inherit: "親リストを継承",
  allowed: "許可値",
  denied: "拒否値",
  customer: "顧客",
  email: "メール",
  givenName: "名",
  familyName: "姓",
  active: "有効",
  displayName: "表示名",
  members: "メンバー",
  kind: "種類",
  owner: "管理スコープ",
  name: "名前",
  disabled: "無効",
  pool: "pool",
  issuer: "発行元",
  audiences: "audience",
  clientId: "client ID",
  id: "ID",
  projectId: "プロジェクト",
  subject: "実行主体",
  caller: "発行元主体",
  method: "認証方式",
  created: "発行時刻",
  expires: "有効期限",
  service: "サービス",
  quotaId: "クォータ",
  region: "リージョン",
  preferred: "申請値",
  granted: "承認値",
  reconciling: "申請処理中",
  billingAccountId: "請求アカウント",
  dataset: "データセット",
  location: "ロケーション",
  enabled: "有効",
  resource: "対象",
  result: "結果",
  value: "評価値",
};
const displayValue = (value: unknown) => {
  if (typeof value === "boolean") {
    return value ? "はい" : "いいえ";
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
};
const rows = (record: Readonly<Record<string, unknown>>) =>
  Object.entries(record).map(([key, value]) => ({
    label: labels[key] ?? key,
    value: displayValue(value),
  }));
export const AdminLabProperties = ({
  world,
  selection: s,
}: SelectionProps<"admin-lab">): ReactElement => {
  const item = adminResources(world, s.scope).find(
    (r) => r.collection === s.collection && r.name === s.name,
  );
  if (!item) {
    return <NotFound what="管理構成" />;
  }
  return (
    <>
      <Section title={item.label} rows={rows(item.resource)} />
      {s.collection === "policies" && (
        <Section
          title="継承を含む有効な制約"
          rows={rows(effectiveOrgPolicy(world, s.scope, s.name))}
        />
      )}
      {s.collection === "credentials" && (
        <p className="text-muted text-sm">
          教材内だけの認証メタデータです。有効期限と現在の権限を確認できます。
        </p>
      )}
      {s.collection === "quotas" && (
        <p className="text-muted text-sm">
          申請値と承認値は別です。処理中も承認済み容量を適用します。
        </p>
      )}
      {s.collection === "exports" && (
        <p className="text-muted text-sm">実行するとSQL演習用の固定データを保存します。</p>
      )}
    </>
  );
};
