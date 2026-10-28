import { credentialAvailable, poolPath } from "@/engine/domains/admin-lab/federation";
import { effectiveOrgPolicy, papEnforced } from "@/engine/domains/admin-lab/policies";
import { EffectivePermissions } from "@/engine/domains/effective-permissions";
import { storageAllows } from "@/engine/domains/storage-lab/model";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { MissionStep } from "@/engine/missions/mission-step";
import { gkeCompletionSatisfied } from "./gke-completion";

const p = F.devProjectId;
const org = `organizations/${F.organizationId}`;
const folder = `folders/${F.devFolderId}`;
const worker = `admin-worker@${p}.iam.gserviceaccount.com`;
const policy = (what: string, scope: string, constraint: string, spec: object) => [
  MissionStep.run(
    "ポリシーの定義をファイルに書く",
    `sim files write admin-policy.json --content='${JSON.stringify({ name: `${scope}/policies/${constraint}`, spec })}'`,
    `admin-policy.json に制約 ${constraint} と適用先 ${scope} を書きます。`,
  ),
  MissionStep.run(what, "gcloud org-policies set-policy admin-policy.json"),
];
const bucket = (lesson: string, flags = "", what = "教材用のバケットを作る") => [
  MissionStep.run(
    what,
    `gcloud storage buckets create gs://admin-${lesson} --location=us-central1 ${flags}`,
  ),
  MissionStep.run(
    "確認用のreport.jsonをバケットに置く",
    `gcloud storage cp ./report.json gs://admin-${lesson}/report.json`,
  ),
];
const binding = (lesson: string, member: string, role = "roles/storage.objectViewer") =>
  `gcloud storage buckets add-iam-policy-binding gs://admin-${lesson} --member='${member}' --role=${role}`;
const budget = (name: string) =>
  `gcloud billing budgets create --billing-account=${F.billingAccountId} --display-name=${name} --budget-amount=1000 --threshold-rule=percent=0.8 --filter-projects=${p}`;
const workloadPath = "projects/481200000001/locations/global/workloadIdentityPools/admin-workload";
const workforcePath = "locations/global/workforcePools/admin-workforce";
const noKeyPolicy = policy(
  "組織でサービスアカウントキーの作成を禁止する",
  org,
  "iam.disableServiceAccountKeyCreation",
  { rules: [{ enforce: true }] },
);
const createWorker = MissionStep.run(
  "処理用のサービスアカウントを作る",
  "gcloud iam service-accounts create admin-worker",
);
const privateBucket = "非公開（均一アクセス・公開防止）のバケットを作る";
const preludeStep = MissionStep.run(
  "管理系の演習で使うAPIをまとめて有効にする",
  "gcloud services enable orgpolicy.googleapis.com cloudidentity.googleapis.com cloudidentityscim.googleapis.com iam.googleapis.com iamcredentials.googleapis.com cloudquotas.googleapis.com cloudasset.googleapis.com billingbudgets.googleapis.com bigquery.googleapis.com compute.googleapis.com storage.googleapis.com container.googleapis.com",
  "組織ポリシー・Cloud Identity・IAM・Quotas・Asset Inventory・予算などのAPIです。",
);
/** 全レッスンの前に流す行（テスト・Storybook 用）。 */
export const AdminPrelude = MissionStep.lines([preludeStep]);
/** レッスンごとの解き方の手順。 */
export const AdminSteps = {
  orgPap: [
    ...bucket("pap"),
    MissionStep.run(
      "あえてallUsersに読み取りを公開する",
      binding("pap", "allUsers"),
      "公開IAMが残ったバケットの状態を作ります。",
    ),
    ...policy("組織全体で公開アクセス防止を強制する", org, "storage.publicAccessPrevention", {
      rules: [{ enforce: true }],
    }),
    MissionStep.run(
      "匿名の読み取りが拒否されるか確かめる",
      "sim storage access check gs://admin-pap/report.json --principal=anonymous",
      "組織の制約はプロジェクトとバケットへ継承され、公開IAMより優先されます。",
    ),
  ],
  locations: [
    ...policy("フォルダで保存先をus-central1に限定する", folder, "gcp.resourceLocations", {
      rules: [{ values: { allowedValues: ["is:us-central1"] } }],
    }),
    MissionStep.run(
      "子プロジェクトの許可リージョンにバケットを作る",
      "gcloud storage buckets create gs://admin-locations --location=us-central1",
      "フォルダの制約は配下のプロジェクトへ継承されます。",
    ),
  ],
  group: [
    MissionStep.run(
      "教材用のユーザーを作る",
      "sim identity users create student@example.com --customer=C01simulator --given-name=Cloud --family-name=Student",
    ),
    MissionStep.run(
      "読み取り用のグループを作る",
      "gcloud identity groups create admin-readers@example.com --customer=C01simulator",
    ),
    MissionStep.run(
      "ユーザーをグループに加える",
      "gcloud identity groups memberships add --group-email=admin-readers@example.com --member-email=student@example.com",
    ),
    ...bucket("group", "--uniform-bucket-level-access", "均一アクセスのバケットを作る"),
    MissionStep.run(
      "オブジェクト取得だけのカスタムロールを作る",
      "gcloud iam roles create AdminObjectReader --permissions=storage.objects.get --title=Reader",
      "storage.objects.get だけなので、書き込みはできません。",
    ),
    MissionStep.run(
      "グループにカスタムロールを付ける",
      binding("group", "group:admin-readers@example.com", `projects/${p}/roles/AdminObjectReader`),
    ),
    MissionStep.run(
      "グループのユーザーで読み取れるか確かめる",
      "sim storage access check gs://admin-group/report.json --principal=student@example.com",
    ),
  ],
  impersonation: [
    createWorker,
    ...noKeyPolicy,
    MissionStep.run(
      "開発者にSAのToken Creatorを付ける",
      `gcloud iam service-accounts add-iam-policy-binding ${worker} --member=user:${F.developer} --role=roles/iam.serviceAccountTokenCreator`,
      "SAになりすまして短期のトークンを発行できるようになります。",
    ),
    MissionStep.run(
      "SAになりすまして60秒のトークンを発行する",
      "gcloud auth print-access-token --impersonate-service-account=admin-worker@ace-dev-01.iam.gserviceaccount.com --account=dev@example.com --lifetime=60s",
    ),
    MissionStep.run(
      "発行した認証情報が有効か確かめる",
      "sim auth credentials check SIMULATED-credential-11",
      "SIMULATED-credential-11 は直前の発行で返るIDです。",
    ),
    MissionStep.run("仮想時間を61秒進める", "sim storage time advance --seconds=61"),
    MissionStep.run(
      "認証情報が期限切れになったか確かめる",
      "sim auth credentials check SIMULATED-credential-11",
    ),
  ],
  runtime: [
    createWorker,
    MissionStep.run(
      "開発者にSAのService Account Userを付ける",
      `gcloud iam service-accounts add-iam-policy-binding ${worker} --member=user:${F.developer} --role=roles/iam.serviceAccountUser`,
      "SAをリソースへ割り当てる actAs は付きますが、トークン発行の権限は付きません。",
    ),
    MissionStep.run(
      "SAをリソースへ割り当てられるか確かめる",
      `sim iam runtime check --service-account=${worker} --operation=attach --account=${F.developer}`,
      "allowed になります。",
    ),
    MissionStep.run(
      "SAのトークンを発行できないか確かめる",
      `sim iam runtime check --service-account=${worker} --operation=token --account=${F.developer}`,
      "denied になります。",
    ),
  ],
  workload: [
    MissionStep.run(
      "外部ワークロード用のプールを作る",
      "gcloud iam workload-identity-pools create admin-workload --location=global",
    ),
    MissionStep.run(
      "プールにOIDCプロバイダを登録する",
      "gcloud iam workload-identity-pools providers create-oidc admin-provider --workload-identity-pool=admin-workload --location=global --issuer-uri=https://id.example.com --allowed-audiences=admin-app --attribute-mapping=google.subject=assertion.sub",
      "issuer と audience が一致するトークンだけを受け付けます。",
    ),
    createWorker,
    MissionStep.run(
      "プール内の主体にSAの利用を許可する",
      `gcloud iam service-accounts add-iam-policy-binding ${worker} --member='principalSet://iam.googleapis.com/${workloadPath}/*' --role=roles/iam.workloadIdentityUser`,
      "principalSet の * はプール内のすべての主体を指します。",
    ),
    ...bucket(
      "workload",
      "--uniform-bucket-level-access --public-access-prevention",
      privateBucket,
    ),
    MissionStep.run(
      "SAにバケットの閲覧を許可する",
      binding("workload", `serviceAccount:${worker}`),
    ),
    MissionStep.run(
      "外部トークンを交換してSAの認証情報を得る",
      `sim identity federation exchange --kind=workload --pool=admin-workload --provider=admin-provider --issuer=https://id.example.com --audience=admin-app --subject=build-agent --service-account=${worker}`,
    ),
    MissionStep.run(
      "得た認証情報で非公開オブジェクトを読む",
      "sim identity federation access gs://admin-workload/report.json --token=SIMULATED-credential-11",
      "SIMULATED-credential-11 は直前の交換で返る値です。",
    ),
  ],
  workforce: [
    MissionStep.run(
      "社外の人用のWorkforceプールを作る",
      `gcloud iam workforce-pools create admin-workforce --organization=${F.organizationId} --location=global`,
    ),
    MissionStep.run(
      "Web SSO付きのOIDCプロバイダを登録する",
      "gcloud iam workforce-pools providers create-oidc admin-provider --workforce-pool=admin-workforce --location=global --issuer-uri=https://id.example.com --client-id=admin-console --attribute-mapping=google.subject=assertion.sub --web-sso-response-type=id-token --web-sso-assertion-claims-behavior=only-id-token-claims",
    ),
    ...bucket(
      "workforce",
      "--uniform-bucket-level-access --public-access-prevention",
      privateBucket,
    ),
    MissionStep.run(
      "外部IDのstudentに直接閲覧を許可する",
      binding("workforce", `principal://iam.googleapis.com/${workforcePath}/subject/student`),
      "サービスアカウントを介さず、外部IDの主体そのものにIAMを付けます。",
    ),
    MissionStep.run(
      "外部IDのトークンを交換する",
      "sim identity federation exchange --kind=workforce --pool=admin-workforce --provider=admin-provider --issuer=https://id.example.com --audience=admin-console --subject=student",
    ),
    MissionStep.run(
      "得た認証情報で非公開オブジェクトを読む",
      "sim identity federation access gs://admin-workforce/report.json --token=SIMULATED-credential-10",
      "SIMULATED-credential-10 は直前の交換で返る値です。",
    ),
  ],
  quota: [
    MissionStep.run(
      "CPUクォータを32に増やすよう申請する",
      "gcloud quotas preferences create --preference-id=admin-cpus --service=compute.googleapis.com --quota-id=CpusPerProjectPerRegion --preferred-value=32 --dimensions=region=us-central1 --email=owner@example.com",
      "申請中は承認値が24のまま変わりません。",
    ),
    MissionStep.run(
      "承認前に30 CPUを追加できるか評価する",
      "sim quotas evaluate --region=us-central1 --additional-cpus=30",
      "まだ承認されていないので拒否されます。",
    ),
    MissionStep.run(
      "教材として申請を32で承認する",
      "sim quotas resolve admin-cpus --granted-value=32",
    ),
    MissionStep.run(
      "承認後に30 CPUを再評価する",
      "sim quotas evaluate --region=us-central1 --additional-cpus=30",
    ),
  ],
  assets: [
    MissionStep.run(
      "検索対象のバケットを作る",
      "gcloud storage buckets create gs://admin-assets --location=us-central1",
    ),
    MissionStep.run(
      "組織全体からバケットを名前で検索する",
      `gcloud asset search-all-resources --scope=${org} --query=name:admin-assets`,
      "組織スコープで検索すると、子プロジェクトのリソースも見つかります。",
    ),
  ],
  export: [
    MissionStep.run(
      "エクスポート先のデータセットを作る",
      "bq mk --dataset --location=us-central1 admin_costs",
    ),
    MissionStep.run(
      "課金エクスポートの出力先を設定する",
      `sim billing export configure --billing-account=${F.billingAccountId} --dataset=admin_costs --location=us-central1`,
      "データセットと同じロケーションを指定します。",
    ),
    MissionStep.run(
      "合成のコスト行を書き出す",
      `sim billing export run --billing-account=${F.billingAccountId}`,
      "実際の料金ではなく教材用の固定データです。",
    ),
  ],
  budget: [
    MissionStep.run("80%で通知する予算を作る", budget("admin-budget")),
    MissionStep.run(
      "予算を2,000に上げて50%通知を足す",
      `gcloud billing budgets update 7a35-budget --billing-account=${F.billingAccountId} --budget-amount=2000 --add-threshold-rule=percent=50,basis=current-spend`,
      "7a35-budget は作成時に返る予算IDです。",
    ),
    MissionStep.run(
      "1,200の支出で通知が出るか確かめる",
      `sim billing budgets evaluate 7a35-budget --billing-account=${F.billingAccountId} --spend=1200`,
      "予算の通知はアラートだけで、課金やリソースは止まりません。",
    ),
  ],
  placement: [
    MissionStep.run(
      "低頻度アクセス向けのバケットを作る",
      "gcloud storage buckets create gs://admin-placement --location=us-central1 --default-storage-class=NEARLINE",
      "NEARLINE は月1回程度のアクセスを想定したクラスです。",
    ),
    MissionStep.run("対象プロジェクトの予算を作る", budget("admin-placement")),
    MissionStep.run(
      "場所とアクセス頻度から保存先を評価する",
      "sim billing placement evaluate --bucket=admin-placement --data-region=us-central1 --access-pattern=infrequent --budget-id=7a35-budget",
      "7a35-budget は作成した予算のIDです。",
    ),
  ],
  hierarchy: [
    ...bucket("hierarchy", "--uniform-bucket-level-access", "均一アクセスのバケットを作る"),
    MissionStep.run(
      "オブジェクト取得だけのカスタムロールを作る",
      "gcloud iam roles create AdminHierarchyReader --permissions=storage.objects.get --title=Reader",
    ),
    MissionStep.run(
      "フォルダでstudentにカスタムロールを付ける",
      `gcloud resource-manager folders add-iam-policy-binding ${F.devFolderId} --member=user:student@example.com --role=projects/${p}/roles/AdminHierarchyReader`,
      "フォルダに付けたロールは子プロジェクトのバケットへ継承されます。",
    ),
    MissionStep.run(
      "子プロジェクトのバケットを読めるか確かめる",
      "sim storage access check gs://admin-hierarchy/report.json --principal=student@example.com",
    ),
  ],
  apiBilling: [
    MissionStep.run(
      "本番プロジェクトに課金アカウントをリンクする",
      `gcloud billing projects link ${F.prodProjectId} --billing-account=${F.billingAccountId}`,
    ),
    MissionStep.run(
      "本番プロジェクトでCompute APIを有効にする",
      `gcloud services enable compute.googleapis.com --project=${F.prodProjectId}`,
      "課金がリンクされていないとCompute APIを有効にできません。",
    ),
    MissionStep.run(
      "本番プロジェクトにVMを作る",
      `gcloud compute instances create admin-prod --project=${F.prodProjectId} --zone=us-central1-a`,
    ),
  ],
  gkeIdentity: [
    ...noKeyPolicy,
    MissionStep.run(
      "Podが使うIAMサービスアカウントを作る",
      "gcloud iam service-accounts create lesson-reader",
    ),
    MissionStep.run(
      "Podが読むバケットを作る",
      "gcloud storage buckets create gs://ace-workload-data --location=us-central1",
    ),
    MissionStep.run(
      "Autopilotクラスタを作る",
      "gcloud container clusters create-auto identity-gke --region=us-central1",
    ),
    MissionStep.run("Kubernetesのマニフェストを読み込む", "sim files load kubernetes-gke-final"),
    MissionStep.run("KubernetesのServiceAccountを作る", "kubectl apply -f identity-account.json"),
    MissionStep.run("アプリをデプロイする", "kubectl apply -f identity-app.json"),
    MissionStep.run(
      "KSAにIAM SAの利用を許可する",
      `gcloud iam service-accounts add-iam-policy-binding lesson-reader@${p}.iam.gserviceaccount.com --role=roles/iam.workloadIdentityUser --member='serviceAccount:${p}.svc.id.goog[default/bucket-reader]'`,
      "[default/bucket-reader] は名前空間とKubernetes SAの名前です。",
    ),
    MissionStep.run(
      "KSAに対応するIAM SAを注釈で結び付ける",
      `kubectl annotate serviceaccount bucket-reader iam.gke.io/gcp-service-account=lesson-reader@${p}.iam.gserviceaccount.com`,
    ),
    MissionStep.run(
      "IAM SAにバケットの閲覧を許可する",
      `gcloud storage buckets add-iam-policy-binding gs://ace-workload-data --member=serviceAccount:lesson-reader@${p}.iam.gserviceaccount.com --role=roles/storage.objectViewer`,
    ),
    MissionStep.run(
      "アプリから一覧が許可されるか確かめる",
      "sim kubernetes check-access identity-app --bucket=ace-workload-data --permission=storage.objects.list",
    ),
    MissionStep.run(
      "アプリから削除が拒否されるか確かめる",
      "sim kubernetes check-access identity-app --bucket=ace-workload-data --permission=storage.objects.delete",
    ),
  ],
} as const satisfies Record<string, readonly MissionStep[]>;
export type AdminLesson = keyof typeof AdminSteps;
/** レッスンごとに端末へ流す行（テスト・Storybook 用）。 */
export const AdminSolutions = Object.fromEntries(
  Object.entries(AdminSteps).map(([lesson, steps]) => [lesson, MissionStep.lines(steps)]),
) as Record<AdminLesson, readonly string[]>;
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
export const AdminMissions: readonly Mission[] = Object.keys(AdminSteps).map((key) => {
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
    steps: [preludeStep, ...AdminSteps[lesson]],
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
