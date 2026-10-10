const enableApis = {
  type: "gcloud services enable orgpolicy.googleapis.com cloudidentity.googleapis.com cloudidentityscim.googleapis.com cloudquotas.googleapis.com billingbudgets.googleapis.com bigquery.googleapis.com",
};

const quotaRequest = {
  type: "gcloud quotas preferences create --preference-id=admin-cpus --service=compute.googleapis.com --quota-id=CpusPerProjectPerRegion --preferred-value=32 --dimensions=region=us-central1 --email=owner@example.com",
};

export const ADMIN_SCENARIOS = [
  {
    name: "admin-organization-policy",
    label: "組織: 公開防止の継承と有効な制約",
    steps: [
      { wait: 800 },
      enableApis,
      {
        type: `sim files write admin-policy.json --content='{"name":"organizations/123456789012/policies/storage.publicAccessPrevention","spec":{"rules":[{"enforce":true}]}}'`,
      },
      { type: "gcloud org-policies set-policy admin-policy.json" },
      { click: "組織ポリシー: storage.publicAccessPrevention" },
      { wait: 300 },
    ],
  },
  {
    name: "admin-identity-group",
    label: "Cloud Identity: 有効なユーザーとグループ所属",
    steps: [
      { wait: 800 },
      enableApis,
      {
        type: "sim identity users create student@example.com --customer=C01simulator --given-name=Cloud --family-name=Student",
      },
      { type: "gcloud identity groups create admin-readers@example.com --customer=C01simulator" },
      {
        type: "gcloud identity groups memberships add --group-email=admin-readers@example.com --member-email=student@example.com",
      },
      { click: "グループ: admin-readers@example.com" },
      { wait: 300 },
    ],
  },
  {
    name: "admin-quota-pending",
    label: "クォータ: 申請値32と承認値24を分けて表示",
    steps: [
      { wait: 800 },
      enableApis,
      quotaRequest,
      { click: "CPUクォータ: us-central1" },
      { wait: 300 },
    ],
  },
  {
    name: "admin-billing-export",
    label: "課金: BigQueryへ出力する教材構成",
    steps: [
      { wait: 800 },
      enableApis,
      { type: "bq mk --dataset --location=us-central1 admin_costs" },
      {
        type: "sim billing export configure --billing-account=01AB2C-DEF345-6789AB --dataset=admin_costs --location=us-central1",
      },
      { type: "sim billing export run --billing-account=01AB2C-DEF345-6789AB" },
      { click: "課金エクスポート: admin_costs" },
      { wait: 300 },
    ],
  },
];
