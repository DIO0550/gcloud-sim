import { EffectivePermissions } from "@/engine/domains/effective-permissions";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { Option } from "@/utils/Option";
import { NetworkPrelude, NetworkSolutions } from "./network-lab";
import { TerraformMissions } from "./terraform";

const project = F.devProjectId;
const account = `ace-network-app@${project}.iam.gserviceaccount.com`;
const setup = [
  { kind: "setProject", projectId: project },
  { kind: "setPrincipal", principal: F.owner },
] as const;

export type AceChallengeAssertion = Readonly<{ kind: "aceNetworkChallenge" }>;

export const NetworkChallengeSteps: readonly string[] = [
  ...NetworkPrelude,
  "gcloud services enable container.googleapis.com sqladmin.googleapis.com iam.googleapis.com logging.googleapis.com",
  ...NetworkSolutions.dns,
  "gcloud compute firewall-rules create ace-bastion-ssh --network=dns --allow=tcp:22 --source-ranges=35.235.240.0/20 --target-tags=ace-bastion",
  "gcloud compute instances create ace-bastion --zone=us-central1-a --network=dns --subnet=dns-subnet --no-address --tags=ace-bastion",
  "gcloud sql instances create ace-network-db --region=us-central1 --database-version=POSTGRES_16 --network=dns --no-assign-ip",
  "gcloud sql databases create app --instance=ace-network-db",
  "gcloud iam service-accounts create ace-network-app",
  `gcloud projects add-iam-policy-binding ${project} --member=serviceAccount:${account} --role=roles/cloudsql.client`,
  "gcloud container clusters create-auto volume-gke --region=us-central1 --enable-private-nodes --network=dns --subnetwork=dns-subnet --master-ipv4-cidr=172.16.0.0/28",
  "gcloud container clusters get-credentials volume-gke --region=us-central1",
  "sim files load kubernetes-volumes",
  "kubectl apply -f volume-settings.yaml",
  "kubectl apply -f volume-credentials.yaml",
  "sim files replace volume-web.yaml --search='key: missing.conf' --replacement='key: app.conf'",
  "kubectl apply -f volume-web.yaml",
  "kubectl rollout status deployment/volume-web",
  "kubectl exec deployment/volume-web -- cat /etc/credentials/TOKEN",
  "kubectl expose deployment volume-web --type=LoadBalancer --port=80 --target-port=80",
  "gcloud logging metrics create ace_network_errors --description='Error log count' --log-filter='severity>=ERROR'",
];

const imported = TerraformMissions.flatMap((m) => (m.id === "m-terraform-003" ? m.assertions : []));
const moved = TerraformMissions.flatMap((m) => (m.id === "m-terraform-004" ? m.assertions : []));
const moduleResources = moved.flatMap((a) => (a.kind === "terraformMoved" ? [a.resource] : []));
const importedResources = imported.flatMap((a) =>
  a.kind === "terraformManaged" ? [a.resource] : [],
);

export const TerraformChallengeSteps: readonly string[] = [
  "gcloud services enable compute.googleapis.com storage.googleapis.com",
  "sim files load terraform-network",
  "gcloud auth application-default login",
  "terraform init",
  "terraform validate",
  "terraform plan -out=ace-create-plan",
  "terraform show ace-create-plan",
  "terraform apply ace-create-plan",
  "gcloud compute networks create tf-import-net --subnet-mode=custom",
  'sim files write import.tf --content=\'resource "google_compute_network" "imported" { project = "ace-dev-01" name = "tf-import-net" auto_create_subnetworks = false }\'',
  "terraform import google_compute_network.imported projects/ace-dev-01/global/networks/tf-import-net",
  "sim files load terraform-modules --force",
  "terraform init",
  "terraform plan -out=ace-module-plan",
  "terraform show ace-module-plan",
  "terraform apply ace-module-plan",
  "gcloud storage buckets create gs://ace-dev-01-tf-state --location=us-central1 --uniform-bucket-level-access",
  "gcloud storage buckets update gs://ace-dev-01-tf-state --versioning",
  "sim files load terraform-backend",
  "terraform init -migrate-state",
  "yes",
  "terraform state list",
  "terraform state pull",
  "terraform plan",
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
    hints: NetworkChallengeSteps,
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
    hints: TerraformChallengeSteps,
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
