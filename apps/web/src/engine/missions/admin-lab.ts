import { credentialAvailable, poolPath } from "@/engine/domains/admin-lab/federation";
import { effectiveOrgPolicy, papEnforced } from "@/engine/domains/admin-lab/policies";
import { EffectivePermissions } from "@/engine/domains/effective-permissions";
import { storageAllows } from "@/engine/domains/storage-lab/model";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { gkeCompletionSatisfied } from "./gke-completion";

const p = F.devProjectId;
const org = `organizations/${F.organizationId}`;
const folder = `folders/${F.devFolderId}`;
const worker = `admin-worker@${p}.iam.gserviceaccount.com`;
const policy = (scope: string, constraint: string, spec: object) => [
  `sim files write admin-policy.json --content='${JSON.stringify({ name: `${scope}/policies/${constraint}`, spec })}'`,
  "gcloud org-policies set-policy admin-policy.json",
];
const bucket = (lesson: string, flags = "") => [
  `gcloud storage buckets create gs://admin-${lesson} --location=us-central1 ${flags}`,
  `gcloud storage cp ./report.json gs://admin-${lesson}/report.json`,
];
const binding = (lesson: string, member: string, role = "roles/storage.objectViewer") =>
  `gcloud storage buckets add-iam-policy-binding gs://admin-${lesson} --member='${member}' --role=${role}`;
const budget = (name: string) =>
  `gcloud billing budgets create --billing-account=${F.billingAccountId} --display-name=${name} --budget-amount=1000 --threshold-rule=percent=0.8 --filter-projects=${p}`;
const workloadPath = "projects/481200000001/locations/global/workloadIdentityPools/admin-workload";
const workforcePath = "locations/global/workforcePools/admin-workforce";
export const AdminPrelude = [
  "gcloud services enable orgpolicy.googleapis.com cloudidentity.googleapis.com cloudidentityscim.googleapis.com iam.googleapis.com iamcredentials.googleapis.com cloudquotas.googleapis.com cloudasset.googleapis.com billingbudgets.googleapis.com bigquery.googleapis.com compute.googleapis.com storage.googleapis.com container.googleapis.com",
];
export const AdminSolutions = {
  orgPap: [
    ...bucket("pap"),
    binding("pap", "allUsers"),
    ...policy(org, "storage.publicAccessPrevention", { rules: [{ enforce: true }] }),
    "sim storage access check gs://admin-pap/report.json --principal=anonymous",
  ],
  locations: [
    ...policy(folder, "gcp.resourceLocations", {
      rules: [{ values: { allowedValues: ["is:us-central1"] } }],
    }),
    "gcloud storage buckets create gs://admin-locations --location=us-central1",
  ],
  group: [
    "sim identity users create student@example.com --customer=C01simulator --given-name=Cloud --family-name=Student",
    "gcloud identity groups create admin-readers@example.com --customer=C01simulator",
    "gcloud identity groups memberships add --group-email=admin-readers@example.com --member-email=student@example.com",
    ...bucket("group", "--uniform-bucket-level-access"),
    "gcloud iam roles create AdminObjectReader --permissions=storage.objects.get --title=Reader",
    binding("group", "group:admin-readers@example.com", `projects/${p}/roles/AdminObjectReader`),
    "sim storage access check gs://admin-group/report.json --principal=student@example.com",
  ],
  impersonation: [
    "gcloud iam service-accounts create admin-worker",
    ...policy(org, "iam.disableServiceAccountKeyCreation", { rules: [{ enforce: true }] }),
    `gcloud iam service-accounts add-iam-policy-binding ${worker} --member=user:${F.developer} --role=roles/iam.serviceAccountTokenCreator`,
    "gcloud auth print-access-token --impersonate-service-account=admin-worker@ace-dev-01.iam.gserviceaccount.com --account=dev@example.com --lifetime=60s",
    "sim auth credentials check SIMULATED-credential-11",
    "sim storage time advance --seconds=61",
    "sim auth credentials check SIMULATED-credential-11",
  ],
  runtime: [
    "gcloud iam service-accounts create admin-worker",
    `gcloud iam service-accounts add-iam-policy-binding ${worker} --member=user:${F.developer} --role=roles/iam.serviceAccountUser`,
    `sim iam runtime check --service-account=${worker} --operation=attach --account=${F.developer}`,
    `sim iam runtime check --service-account=${worker} --operation=token --account=${F.developer}`,
  ],
  workload: [
    "gcloud iam workload-identity-pools create admin-workload --location=global",
    "gcloud iam workload-identity-pools providers create-oidc admin-provider --workload-identity-pool=admin-workload --location=global --issuer-uri=https://id.example.com --allowed-audiences=admin-app --attribute-mapping=google.subject=assertion.sub",
    "gcloud iam service-accounts create admin-worker",
    `gcloud iam service-accounts add-iam-policy-binding ${worker} --member='principalSet://iam.googleapis.com/${workloadPath}/*' --role=roles/iam.workloadIdentityUser`,
    ...bucket("workload", "--uniform-bucket-level-access --public-access-prevention"),
    binding("workload", `serviceAccount:${worker}`),
    `sim identity federation exchange --kind=workload --pool=admin-workload --provider=admin-provider --issuer=https://id.example.com --audience=admin-app --subject=build-agent --service-account=${worker}`,
    "sim identity federation access gs://admin-workload/report.json --token=SIMULATED-credential-11",
  ],
  workforce: [
    `gcloud iam workforce-pools create admin-workforce --organization=${F.organizationId} --location=global`,
    "gcloud iam workforce-pools providers create-oidc admin-provider --workforce-pool=admin-workforce --location=global --issuer-uri=https://id.example.com --client-id=admin-console --attribute-mapping=google.subject=assertion.sub --web-sso-response-type=id-token --web-sso-assertion-claims-behavior=only-id-token-claims",
    ...bucket("workforce", "--uniform-bucket-level-access --public-access-prevention"),
    binding("workforce", `principal://iam.googleapis.com/${workforcePath}/subject/student`),
    "sim identity federation exchange --kind=workforce --pool=admin-workforce --provider=admin-provider --issuer=https://id.example.com --audience=admin-console --subject=student",
    "sim identity federation access gs://admin-workforce/report.json --token=SIMULATED-credential-10",
  ],
  quota: [
    "gcloud quotas preferences create --preference-id=admin-cpus --service=compute.googleapis.com --quota-id=CpusPerProjectPerRegion --preferred-value=32 --dimensions=region=us-central1 --email=owner@example.com",
    "sim quotas evaluate --region=us-central1 --additional-cpus=30",
    "sim quotas resolve admin-cpus --granted-value=32",
    "sim quotas evaluate --region=us-central1 --additional-cpus=30",
  ],
  assets: [
    "gcloud storage buckets create gs://admin-assets --location=us-central1",
    `gcloud asset search-all-resources --scope=${org} --query=name:admin-assets`,
  ],
  export: [
    "bq mk --dataset --location=us-central1 admin_costs",
    `sim billing export configure --billing-account=${F.billingAccountId} --dataset=admin_costs --location=us-central1`,
    `sim billing export run --billing-account=${F.billingAccountId}`,
  ],
  budget: [
    budget("admin-budget"),
    `gcloud billing budgets update 7a35-budget --billing-account=${F.billingAccountId} --budget-amount=2000 --add-threshold-rule=percent=50,basis=current-spend`,
    `sim billing budgets evaluate 7a35-budget --billing-account=${F.billingAccountId} --spend=1200`,
  ],
  placement: [
    "gcloud storage buckets create gs://admin-placement --location=us-central1 --default-storage-class=NEARLINE",
    budget("admin-placement"),
    "sim billing placement evaluate --bucket=admin-placement --data-region=us-central1 --access-pattern=infrequent --budget-id=7a35-budget",
  ],
  hierarchy: [
    ...bucket("hierarchy", "--uniform-bucket-level-access"),
    "gcloud iam roles create AdminHierarchyReader --permissions=storage.objects.get --title=Reader",
    `gcloud resource-manager folders add-iam-policy-binding ${F.devFolderId} --member=user:student@example.com --role=projects/${p}/roles/AdminHierarchyReader`,
    "sim storage access check gs://admin-hierarchy/report.json --principal=student@example.com",
  ],
  apiBilling: [
    `gcloud billing projects link ${F.prodProjectId} --billing-account=${F.billingAccountId}`,
    `gcloud services enable compute.googleapis.com --project=${F.prodProjectId}`,
    `gcloud compute instances create admin-prod --project=${F.prodProjectId} --zone=us-central1-a`,
  ],
  gkeIdentity: [
    ...policy(org, "iam.disableServiceAccountKeyCreation", { rules: [{ enforce: true }] }),
    "gcloud iam service-accounts create lesson-reader",
    "gcloud storage buckets create gs://ace-workload-data --location=us-central1",
    "gcloud container clusters create-auto identity-gke --region=us-central1",
    "sim files load kubernetes-gke-final",
    "kubectl apply -f identity-account.json",
    "kubectl apply -f identity-app.json",
    `gcloud iam service-accounts add-iam-policy-binding lesson-reader@${p}.iam.gserviceaccount.com --role=roles/iam.workloadIdentityUser --member='serviceAccount:${p}.svc.id.goog[default/bucket-reader]'`,
    `kubectl annotate serviceaccount bucket-reader iam.gke.io/gcp-service-account=lesson-reader@${p}.iam.gserviceaccount.com`,
    `gcloud storage buckets add-iam-policy-binding gs://ace-workload-data --member=serviceAccount:lesson-reader@${p}.iam.gserviceaccount.com --role=roles/storage.objectViewer`,
    "sim kubernetes check-access identity-app --bucket=ace-workload-data --permission=storage.objects.list",
    "sim kubernetes check-access identity-app --bucket=ace-workload-data --permission=storage.objects.delete",
  ],
} as const;
export type AdminLesson = keyof typeof AdminSolutions;
export type AdminAssertion = Readonly<{ kind: "adminLesson"; lesson: AdminLesson }>;
const titles: Record<AdminLesson, readonly [string, string, Mission["domain"]]> = {
  orgPap: [
    "組織の公開防止をプロジェクトへ継承する",
    "公開IAMが残るバケットも、組織のPAPで匿名読み取りを拒否してください。",
    "アクセスとセキュリティ",
  ],
  locations: [
    "フォルダで保存先リージョンを制限する",
    "明示的なis:us-central1のリスト制約を設定し、子プロジェクトにバケットを作ります。",
    "環境セットアップ",
  ],
  group: [
    "Cloud Identityグループへ読み取りだけを許可する",
    "教材ユーザーをグループへ登録し、オブジェクトgetのみのカスタムロールで読み取りを確認します。",
    "アクセスとセキュリティ",
  ],
  impersonation: [
    "外部キーを禁止して短期認証の期限を確認する",
    "Token Creatorで60秒の認証メタデータを発行し、仮想時間を進めて期限切れを確認します。",
    "アクセスとセキュリティ",
  ],
  runtime: [
    "runtime SAのactAsとToken Creatorを区別する",
    "開発者にSA Userを付け、attachは許可、token発行は拒否と確認してください。",
    "アクセスとセキュリティ",
  ],
  workload: [
    "外部ワークロードを鍵なしでSAへ連携する",
    "OIDC providerとpoolの主体へWorkload Identity Userを付け、専用SAで非公開オブジェクトを読みます。",
    "アクセスとセキュリティ",
  ],
  workforce: [
    "外部の人のIDをWorkforceで連携する",
    "Workforce poolのsubjectへ直接Object Viewerを付け、認証メタデータで読み取りを確認します。",
    "アクセスとセキュリティ",
  ],
  quota: [
    "CPUクォータの申請と承認を分けて評価する",
    "32 CPUを申請した直後は24の承認値を維持します。明示的な教材承認後に30 CPUを再評価します。",
    "計画と構成",
  ],
  assets: [
    "組織スコープでCloud Asset Inventoryを検索する",
    "子プロジェクトのadmin-assetsを名前検索し、階層情報と一致件数を確認します。",
    "運用の維持",
  ],
  export: [
    "課金エクスポートの教材データをBigQueryへ保存する",
    "既存データセットへ固定の合成コスト行を出力します。実際の料金や請求ではありません。",
    "環境セットアップ",
  ],
  budget: [
    "予算を更新して通知と課金停止を区別する",
    "予算を2,000円、追加通知を50%に更新し、1,200円の教材支出で通知を確認します。",
    "運用の維持",
  ],
  placement: [
    "アクセス頻度とデータの場所から保存先を選ぶ",
    "同じリージョンのNEARLINEバケットと対象プロジェクトの予算を用意し、低頻度アクセス用途を評価します。",
    "計画と構成",
  ],
  hierarchy: [
    "フォルダから最小権限を継承する",
    "オブジェクトgetのみのカスタムロールをフォルダへ付け、子バケットの閲覧を確認します。",
    "アクセスとセキュリティ",
  ],
  apiBilling: [
    "課金リンクとAPIを復旧してVMを作る",
    "初期の本番プロジェクトへ課金アカウントをリンクし、Compute APIを有効にしてVMを作成します。",
    "環境セットアップ",
  ],
  gkeIdentity: [
    "キー作成禁止下でGKEのID連携を完成させる",
    "組織で外部キーを禁止し、Kubernetes SAとIAM SAを連携します。閲覧を許可し削除は拒否してください。",
    "アクセスとセキュリティ",
  ],
};
export const AdminMissions: readonly Mission[] = Object.keys(AdminSolutions).map((key) => {
  const lesson = key as AdminLesson;
  return {
    id: `admin-${lesson.toLowerCase()}`,
    domain: titles[lesson][2],
    title: titles[lesson][0],
    description: titles[lesson][1],
    setup: [
      { kind: "setProject", projectId: p },
      { kind: "setPrincipal", principal: F.owner },
    ],
    hints: [...AdminPrelude, ...AdminSolutions[lesson]],
    assertions: [{ kind: "adminLesson", lesson }],
  };
});
export const adminSatisfied = (w: World, lesson: AdminLesson): boolean => {
  const l = w.adminLab;
  const observed = (kind: string, resource: string, result: string, value?: number) =>
    l.observations.some(
      (o) =>
        o.projectId === p &&
        o.kind === kind &&
        o.resource === resource &&
        o.result === result &&
        (value === undefined || o.value === value),
    );
  const stored = w.buckets.find(
    (b) => b.name === `admin-${lesson.toLowerCase()}` && b.projectId === p,
  );
  const noKeys = w.serviceAccountKeys.length === 0;
  if (lesson === "orgPap") {
    const b = w.buckets.find((b) => b.name === "admin-pap");
    return Boolean(
      b &&
        papEnforced(w, b) &&
        l.policies.some((c) => c.scope === org && c.enforce) &&
        w.storageLab.decisions.some(
          (d) => d.name === "access:admin-pap:anonymous" && d.service === "denied",
        ),
    );
  }
  if (lesson === "locations") {
    return Boolean(
      stored &&
        stored.location.toLowerCase() === "us-central1" &&
        effectiveOrgPolicy(w, `projects/${p}`, "gcp.resourceLocations")?.allowed.includes(
          "is:us-central1",
        ),
    );
  }
  if (lesson === "group" || lesson === "hierarchy") {
    return Boolean(
      stored &&
        storageAllows(w, stored, "student@example.com", "storage.objects.get") &&
        !storageAllows(w, stored, "student@example.com", "storage.objects.create") &&
        w.storageLab.decisions.some(
          (d) => d.name === `access:${stored.name}:student@example.com` && d.service === "allowed",
        ) &&
        (lesson === "hierarchy" ||
          l.groups.some(
            (g) =>
              g.email === "admin-readers@example.com" && g.members.includes("student@example.com"),
          )),
    );
  }
  if (lesson === "impersonation") {
    return (
      noKeys &&
      l.credentials.some(
        (c) =>
          c.method === "impersonation" &&
          c.subject === worker &&
          c.caller === F.developer &&
          observed("credential", c.id, "expired", 0),
      ) &&
      effectiveOrgPolicy(w, `projects/${p}`, "iam.disableServiceAccountKeyCreation")?.enforce ===
        true
    );
  }
  if (lesson === "runtime") {
    const target = { type: "service-account", id: worker } as const;
    const effective = EffectivePermissions.resolve(w, `user:${F.developer}`, target);
    return (
      effective.permissions.has("iam.serviceAccounts.actAs") &&
      !effective.permissions.has("iam.serviceAccounts.getAccessToken") &&
      observed("runtime", `${worker}/attach/${F.developer}`, "allowed", 1) &&
      observed("runtime", `${worker}/token/${F.developer}`, "denied", 0)
    );
  }
  if (lesson === "workload" || lesson === "workforce") {
    const c = l.credentials.find((c) => c.method === lesson);
    return Boolean(
      noKeys &&
        stored &&
        c &&
        Date.parse(c.expires) >
          Date.parse(w.projects.find((p) => p.projectId === c.projectId)?.createTime ?? "") +
            w.dataProcessing.clock * 1000 &&
        credentialAvailable(w, c) &&
        l.pools.some(
          (pool) => pool.kind === lesson && poolPath(w, pool).includes(`admin-${lesson}`),
        ) &&
        storageAllows(w, stored, c.subject, "storage.objects.get") &&
        !storageAllows(w, stored, c.subject, "storage.objects.create") &&
        observed("federation", `gs://${stored.name}/report.json`, lesson, 1),
    );
  }
  if (lesson === "quota") {
    return (
      l.quotas.some(
        (q) =>
          q.scope === `projects/${p}` &&
          q.name === "admin-cpus" &&
          q.preferred === 32 &&
          q.granted === 32 &&
          !q.reconciling,
      ) && observed("quota", `projects/${p}/us-central1`, "allowed", 30)
    );
  }
  if (lesson === "assets") {
    return Boolean(stored && observed("assets", org, "name:admin-assets", 1));
  }
  if (lesson === "export") {
    return (
      l.exports.some((e) => e.projectId === p && e.dataset === "admin_costs" && e.enabled) &&
      w.dataProcessing.tables.some(
        (t) =>
          t.projectId === p &&
          t.dataset === "admin_costs" &&
          t.name === "gcp_billing_export_v1_simulated" &&
          t.rows.length === 2,
      ) &&
      observed("billing-export", "admin_costs", "written", 120)
    );
  }
  if (lesson === "budget") {
    return (
      w.budgets.some(
        (b) =>
          b.displayName === "admin-budget" &&
          b.amount === 2000 &&
          b.thresholds.includes(0.5) &&
          observed("budget", b.name, "notification", 1200),
      ) && w.projects.some((project) => project.projectId === p && project.billingAccountId.some)
    );
  }
  if (lesson === "placement") {
    return Boolean(
      stored &&
        stored.storageClass === "NEARLINE" &&
        stored.location.toLowerCase() === "us-central1" &&
        observed("placement", stored.name, "fit", 1000),
    );
  }
  if (lesson === "apiBilling") {
    return (
      w.projects.some(
        (project) =>
          project.projectId === F.prodProjectId &&
          project.billingAccountId.some &&
          project.enabledApis.includes("compute.googleapis.com"),
      ) &&
      w.instances.some(
        (vm) =>
          vm.projectId === F.prodProjectId && vm.name === "admin-prod" && vm.status === "RUNNING",
      )
    );
  }
  return (
    noKeys &&
    effectiveOrgPolicy(w, `projects/${p}`, "iam.disableServiceAccountKeyCreation")?.enforce ===
      true &&
    gkeCompletionSatisfied(w, "identity") &&
    observed("gke-identity", "identity-app/storage.objects.delete", "denied", 0)
  );
};
