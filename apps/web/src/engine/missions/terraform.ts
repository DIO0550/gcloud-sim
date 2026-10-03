import type { TfResource } from "@/engine/domains/terraform";
import { TfConfiguration } from "@/engine/domains/terraform/configuration";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";

export type TerraformAssertion = Readonly<{ kind: "terraformManaged"; resource: TfResource }>;
const network: TfResource = {
  address: "google_compute_network.lab",
  type: "google_compute_network",
  project: F.devProjectId,
  name: "tf-lab-vpc",
  region: "",
  network: "",
  cidr: "",
  privateAccess: false,
};
const subnet: TfResource = {
  address: "google_compute_subnetwork.lab",
  type: "google_compute_subnetwork",
  project: F.devProjectId,
  name: "tf-lab-subnet",
  region: "us-central1",
  network: network.name,
  cidr: "10.42.0.0/24",
  privateAccess: false,
};
const setup = [
  { kind: "setPrincipal", principal: F.owner },
  { kind: "setProject", projectId: F.devProjectId },
] as const;

export const TerraformMissions: readonly Mission[] = [
  {
    id: "m-terraform-001",
    domain: "デプロイと実装",
    title: "TerraformでVPCとサブネットを構築する",
    description:
      "教材のHCL構成を読み込み、ace-dev-01にtf-lab-vpcとus-central1のtf-lab-subnet（10.42.0.0/24）を作成します。構成・state・実リソースの一致が必要です。planだけでは完了しません。",
    setup,
    hints: [
      "sim files load terraform-network でmain.tfを用意し、sim files read main.tfで確認します。既存ファイルがある場合は読み、必要に応じて編集してください。",
      "gcloud auth application-default login → terraform init → terraform validate → terraform plan -out=tfplan",
      "terraform show tfplan → terraform apply tfplan → terraform state list → terraform plan。最後はリソース差分なしになります。",
    ],
    assertions: [
      { kind: "terraformManaged", resource: network },
      { kind: "terraformManaged", resource: subnet },
    ],
  },
  {
    id: "m-terraform-002",
    domain: "運用の維持",
    title: "変数とPrivate Google Accessを変更する",
    description:
      "Terraformのtf-lab-subnetを10.43.0.0/24、Private Google Access有効にします。初期状態からはterraform-networkの例を読み込み、ADCログインとinitを実施してください。変更内容がHCL・state・実リソースで一致すると完了です。",
    setup,
    hints: [
      "sim files write terraform.tfvars --content='subnet_cidr = \"10.43.0.0/24\"' で変数を上書きします。",
      "sim files replace main.tf --search='private_ip_google_access = false' --replacement='private_ip_google_access = true'",
      "terraform planで差分を確認し、terraform apply、yesで適用します。CIDR変更はこのシミュレーターでは置換です。",
    ],
    assertions: [
      { kind: "terraformManaged", resource: network },
      {
        kind: "terraformManaged",
        resource: { ...subnet, cidr: "10.43.0.0/24", privateAccess: true },
      },
    ],
  },
  {
    id: "m-terraform-003",
    domain: "運用の維持",
    title: "既存VPCをTerraformの管理に取り込む",
    description:
      "gcloudで作成したカスタムVPC tf-import-netを、ace-dev-01のgoogle_compute_network.importedとして管理します。対応するHCLとstateが必要です。既存の学習用ファイルがある場合は構成に競合がないことも確認してください。",
    setup,
    hints: [
      "gcloud compute networks create tf-import-net --subnet-mode=custom。既に存在すれば再作成は不要です。",
      'sim files write import.tf --content=\'resource "google_compute_network" "imported" { project = "ace-dev-01" name = "tf-import-net" auto_create_subnetworks = false }\'',
      "gcloud auth application-default login → terraform init → terraform import google_compute_network.imported projects/ace-dev-01/global/networks/tf-import-net。state showで確認します。",
    ],
    assertions: [
      {
        kind: "terraformManaged",
        resource: { ...network, address: "google_compute_network.imported", name: "tf-import-net" },
      },
    ],
  },
];

export const terraformSatisfied = (world: World, assertion: TerraformAssertion): boolean => {
  const expected = assertion.resource;
  const matches = (r: TfResource): boolean =>
    Object.entries(expected).every(([key, value]) => r[key as keyof TfResource] === value);
  if (!world.terraform.initialized || !world.terraform.resources.some(matches)) return false;
  try {
    if (!TfConfiguration.compile(world.terraform.files).resources.some(matches)) return false;
  } catch {
    return false;
  }
  if (expected.type === "google_compute_network")
    return world.networks.some(
      (n) =>
        n.projectId === expected.project && n.name === expected.name && n.subnetMode === "CUSTOM",
    );
  return world.subnets.some(
    (s) =>
      s.projectId === expected.project &&
      s.name === expected.name &&
      s.region === expected.region &&
      s.network === expected.network &&
      s.ipCidrRange === expected.cidr &&
      s.privateIpGoogleAccess === expected.privateAccess,
  );
};
