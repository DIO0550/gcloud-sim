import { EffectivePermissions } from "@/engine/domains/effective-permissions";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { MissionStep } from "@/engine/missions/mission-step";
import { Option } from "@/utils/Option";
import { NetworkPreludeSteps, NetworkSteps } from "./network-lab";
import { TerraformMissions } from "./terraform";

const project = F.devProjectId;
const account = `ace-network-app@${project}.iam.gserviceaccount.com`;
const setup = [
  { kind: "setProject", projectId: project },
  { kind: "setPrincipal", principal: F.owner },
] as const;

export type AceChallengeAssertion = Readonly<{ kind: "aceNetworkChallenge" }>;

export const NetworkChallengeSteps: readonly MissionStep[] = [
  ...NetworkPreludeSteps,
  MissionStep.run(
    "GKE・Cloud SQL・IAM・Logging の API を有効にする",
    "gcloud services enable container.googleapis.com sqladmin.googleapis.com iam.googleapis.com logging.googleapis.com",
  ),
  ...NetworkSteps.dns,
  MissionStep.run(
    "IAP の範囲から踏み台へ SSH を通す",
    "gcloud compute firewall-rules create ace-bastion-ssh --network=dns --allow=tcp:22 --source-ranges=35.235.240.0/20 --target-tags=ace-bastion",
    "35.235.240.0/20 は IAP の TCP 転送が使う送信元の範囲です。",
  ),
  MissionStep.run(
    "外部 IP なしの踏み台 VM を作る",
    "gcloud compute instances create ace-bastion --zone=us-central1-a --network=dns --subnet=dns-subnet --no-address --tags=ace-bastion",
  ),
  MissionStep.run(
    "dns VPC の内部 IP だけを持つ Cloud SQL を作る",
    "gcloud sql instances create ace-network-db --region=us-central1 --database-version=POSTGRES_16 --network=dns --no-assign-ip",
    "--no-assign-ip でパブリック IP を付けません。",
  ),
  MissionStep.run(
    "アプリ用のデータベース app を作る",
    "gcloud sql databases create app --instance=ace-network-db",
  ),
  MissionStep.run(
    "アプリが Cloud SQL に接続するための SA を作る",
    "gcloud iam service-accounts create ace-network-app",
  ),
  MissionStep.run(
    "SA に Cloud SQL クライアントロールだけを付ける",
    `gcloud projects add-iam-policy-binding ${project} --member=serviceAccount:${account} --role=roles/cloudsql.client`,
    "接続に要る cloudsql.instances.connect 以外の権限は持たせません。",
  ),
  MissionStep.run(
    "dns VPC に限定公開ノードの Autopilot クラスタを作る",
    "gcloud container clusters create-auto volume-gke --region=us-central1 --enable-private-nodes --network=dns --subnetwork=dns-subnet --master-ipv4-cidr=172.16.0.0/28",
  ),
  MissionStep.run(
    "kubectl が volume-gke に接続できるようにする",
    "gcloud container clusters get-credentials volume-gke --region=us-central1",
  ),
  MissionStep.run("ボリューム教材のマニフェストを読み込む", "sim files load kubernetes-volumes"),
  MissionStep.run("設定ファイル用の ConfigMap を作る", "kubectl apply -f volume-settings.yaml"),
  MissionStep.run("トークン用の Secret を作る", "kubectl apply -f volume-credentials.yaml"),
  MissionStep.run(
    "ConfigMap から読むキーを app.conf に直す",
    "sim files replace volume-web.yaml --search='key: missing.conf' --replacement='key: app.conf'",
    "存在しないキーのままだと Pod が FailedMount で起動しません。",
  ),
  MissionStep.run(
    "直したマニフェストで volume-web をデプロイする",
    "kubectl apply -f volume-web.yaml",
  ),
  MissionStep.run(
    "volume-web のロールアウト完了を待つ",
    "kubectl rollout status deployment/volume-web",
  ),
  MissionStep.run(
    "Secret がファイルとしてマウントされたことを確かめる",
    "kubectl exec deployment/volume-web -- cat /etc/credentials/TOKEN",
  ),
  MissionStep.run(
    "volume-web を LoadBalancer の Service で公開する",
    "kubectl expose deployment volume-web --type=LoadBalancer --port=80 --target-port=80",
  ),
  MissionStep.run(
    "ERROR 以上のログを数える指標を作る",
    "gcloud logging metrics create ace_network_errors --description='Error log count' --log-filter='severity>=ERROR'",
  ),
];

const imported = TerraformMissions.flatMap((m) => (m.id === "m-terraform-003" ? m.assertions : []));
const moved = TerraformMissions.flatMap((m) => (m.id === "m-terraform-004" ? m.assertions : []));
const moduleResources = moved.flatMap((a) => (a.kind === "terraformMoved" ? [a.resource] : []));
const importedResources = imported.flatMap((a) =>
  a.kind === "terraformManaged" ? [a.resource] : [],
);

export const TerraformChallengeSteps: readonly MissionStep[] = [
  MissionStep.run(
    "Compute Engine と Cloud Storage の API を有効にする",
    "gcloud services enable compute.googleapis.com storage.googleapis.com",
  ),
  MissionStep.run("VPC と subnet の Terraform 構成を読み込む", "sim files load terraform-network"),
  MissionStep.run(
    "Terraform が使う認証情報（ADC）を用意する",
    "gcloud auth application-default login",
  ),
  MissionStep.run("プロバイダを取得して作業ディレクトリを初期化する", "terraform init"),
  MissionStep.run("構成の書き方と整合性を検証する", "terraform validate"),
  MissionStep.run("作成の計画をファイルに保存する", "terraform plan -out=ace-create-plan"),
  MissionStep.run("保存した計画の中身を確かめる", "terraform show ace-create-plan"),
  MissionStep.run(
    "保存した計画どおりに VPC と subnet を作る",
    "terraform apply ace-create-plan",
    "保存した計画を渡すと、確認なしでその計画だけが適用されます。",
  ),
  MissionStep.run(
    "Terraform の外で import 対象の VPC を作る",
    "gcloud compute networks create tf-import-net --subnet-mode=custom",
  ),
  MissionStep.run(
    "既存 VPC に対応する resource ブロックを書く",
    'sim files write import.tf --content=\'resource "google_compute_network" "imported" { project = "ace-dev-01" name = "tf-import-net" auto_create_subnetworks = false }\'',
  ),
  MissionStep.run(
    "既存 VPC を state に取り込む",
    "terraform import google_compute_network.imported projects/ace-dev-01/global/networks/tf-import-net",
    "リソースは作り直さず、state に記録するだけです。",
  ),
  MissionStep.run(
    "moved で module へ移す構成に置き換える",
    "sim files load terraform-modules --force",
  ),
  MissionStep.run("module を取り込むために初期化し直す", "terraform init"),
  MissionStep.run("module へ移す計画をファイルに保存する", "terraform plan -out=ace-module-plan"),
  MissionStep.run(
    "計画に再作成が含まれないことを確かめる",
    "terraform show ace-module-plan",
    "moved があれば、削除と作成ではなく state 上のアドレス変更として計画されます。",
  ),
  MissionStep.run("保存した移動の計画を適用する", "terraform apply ace-module-plan"),
  MissionStep.run(
    "state を置くバケットを作る",
    "gcloud storage buckets create gs://ace-dev-01-tf-state --location=us-central1 --uniform-bucket-level-access",
  ),
  MissionStep.run(
    "state の履歴を残すためにバージョニングを有効にする",
    "gcloud storage buckets update gs://ace-dev-01-tf-state --versioning",
  ),
  MissionStep.run("GCS backend の設定を読み込む", "sim files load terraform-backend"),
  MissionStep.run("ローカルの state を GCS backend へ移す", "terraform init -migrate-state"),
  MissionStep.run("state をコピーしてよいかの確認に答える", "yes"),
  MissionStep.run("移行後の state に 3 リソースがあることを確かめる", "terraform state list"),
  MissionStep.run("GCS 上の state の中身を確かめる", "terraform state pull"),
  MissionStep.run(
    "構成と実リソースに差分が無いことを確かめる",
    "terraform plan",
    "No changes と出れば、移行で何も作り直されていません。",
  ),
];

/** 個別演習だけでは確認しにくい、分野をまたぐ構成とstateの整合性を評価する。 */
export const AceChallengeMissions: readonly Mission[] = [
  {
    id: "m-ace-challenge-network",
    domain: "デプロイと実装",
    title: "総合演習: VPC・GKE・Cloud SQL・IAM・ログを構築する",
    description:
      "dns VPCの名前解決を修復し、外部IPなしの踏み台、同じVPCのprivate GKEとCloud SQLを構築します。GKEでConfigMapとSecretのマウントを直し、アプリ公開・SQL接続用SAの最小権限・エラーログ指標をそろえます。独自の総合課題です。実SSH・SQL接続・アプリからDBへの通信、Private Service Accessの構築と公式ラボの採点は再現しません。",
    setup,
    steps: NetworkChallengeSteps,
    assertions: [
      { kind: "networkLesson", lesson: "dns" },
      { kind: "kubeVolumesReady" },
      { kind: "aceNetworkChallenge" },
      {
        kind: "logMetricConfigured",
        projectId: project,
        name: "ace_network_errors",
        filter: "severity>=ERROR",
      },
    ],
  },
  {
    id: "m-ace-challenge-terraform",
    domain: "デプロイと実装",
    title: "総合演習: Terraformの構築・import・module・state移行",
    description:
      "VPCとsubnetを保存planで構築し、既存VPCをimportします。既存の2リソースはmovedでmoduleへ移し、3リソースのstateを版管理したGCS backendへ移行してください。構成・state・現在のリソースと、再作成しない移行の履歴を評価します。独自の総合課題です。sim filesは仮想ファイルの準備・編集に使う専用操作です。",
    setup,
    steps: TerraformChallengeSteps,
    assertions: [
      ...imported,
      ...moved,
      {
        kind: "terraformBackendMigrated",
        bucket: "ace-dev-01-tf-state",
        prefix: "terraform/lab",
        resources: [...moduleResources, ...importedResources],
      },
    ],
  },
];

export const aceNetworkChallengeSatisfied = (world: World): boolean => {
  const cluster = world.clusters.find((c) => c.projectId === project && c.name === "volume-gke");
  const network = cluster?.controlPlane.privateNetwork;
  if (!network || !Option.isSome(network)) {
    return false;
  }
  if (network.value.network !== "dns" || network.value.subnetwork !== "dns-subnet") {
    return false;
  }

  const sql = world.relational.servers.find(
    (s) => s.projectId === project && s.kind === "sql" && s.name === "ace-network-db",
  );
  if (sql?.network !== "dns") {
    return false;
  }
  if (sql.publicIp || sql.engine !== "POSTGRES_16") {
    return false;
  }
  if (
    !world.relational.databases.some(
      (d) => d.projectId === project && d.server === sql.name && d.name === "app",
    )
  ) {
    return false;
  }

  const bastion = world.instances.find(
    (i) => i.projectId === project && i.name === "ace-bastion" && i.zone === "us-central1-a",
  );
  if (!bastion?.tags.includes("ace-bastion")) {
    return false;
  }
  if (
    !bastion.networkInterfaces.some(
      (nic) =>
        nic.network === "dns" && nic.subnetwork === "dns-subnet" && nic.externalIP.kind === "none",
    )
  ) {
    return false;
  }
  if (
    !world.firewallRules.some(
      (rule) =>
        rule.projectId === project &&
        rule.name === "ace-bastion-ssh" &&
        rule.network === "dns" &&
        !rule.disabled &&
        rule.direction === "INGRESS" &&
        rule.allowed.some((r) => r.protocol === "tcp" && r.ports.includes("22")) &&
        rule.targetTags.includes("ace-bastion") &&
        rule.sourceRanges.length === 1 &&
        rule.sourceRanges[0] === "35.235.240.0/20",
    )
  ) {
    return false;
  }
  if (
    !world.kubeServices.some(
      (s) =>
        s.projectId === project &&
        s.cluster === "volume-gke" &&
        s.name === "volume-web" &&
        s.type === "LoadBalancer" &&
        s.port === 80 &&
        s.targetPort === 80,
    )
  ) {
    return false;
  }

  if (!world.serviceAccounts.some((s) => s.projectId === project && s.email === account)) {
    return false;
  }
  const permissions = EffectivePermissions.resolve(world, `serviceAccount:${account}`, {
    type: "project",
    id: project,
  }).permissions;
  return permissions.has("cloudsql.instances.connect") && permissions.size === 1;
};
