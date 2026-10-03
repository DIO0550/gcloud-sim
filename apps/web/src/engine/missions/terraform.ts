import { TerraformInfrastructureExample } from "@/engine/commands/terraform/examples";
import type { TfResource } from "@/engine/domains/terraform";
import { TerraformState } from "@/engine/domains/terraform";
import { TfConfiguration } from "@/engine/domains/terraform/configuration";
import { TfResourceRuntime } from "@/engine/domains/terraform/resource-runtime";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";

export type TerraformAssertion =
  | Readonly<{ kind: "terraformDestroyed"; resources: readonly TfResource[] }>
  | Readonly<{ kind: "terraformManaged"; resource: TfResource }>
  | Readonly<{ kind: "terraformMoved"; resource: TfResource; from: string }>;
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

const infrastructure = TfConfiguration.compile({
  "main.tf": TerraformInfrastructureExample,
}).resources;

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
  {
    id: "m-terraform-004",
    domain: "運用の維持",
    title: "既存ネットワークを壊さずモジュールへ移す",
    description:
      "tf-lab-vpcとtf-lab-subnet（us-central1、10.42.0.0/24、Private Google Access無効）をルートのlabからmodule.network内のlabへ移します。movedで保存した移行planと、移行後の構成・state・実リソースの一致が必要です。新規にmoduleを作成するだけでは完了しません。",
    setup,
    hints: [
      "初期状態からは sim files load terraform-network → gcloud auth application-default login → terraform init → terraform apply -auto-approve で移行前の環境を用意します。既存ファイルやtfvarsがある場合は内容を確認してください。",
      "sim files load terraform-modules --force でmain.tfとmodules/network/main.tfを読み込みます。sim files readで両方を確認し、入力・出力・movedの対応を確認してください。",
      "terraform init → terraform plan -out=module-plan。2つの has moved to があり、追加・変更・削除がないことを確認して terraform apply module-plan。terraform state listでmodule.networkのアドレスを確認します。",
    ],
    assertions: [
      {
        kind: "terraformMoved",
        from: network.address,
        resource: { ...network, address: `module.network.${network.address}` },
      },
      {
        kind: "terraformMoved",
        from: subnet.address,
        resource: { ...subnet, address: `module.network.${subnet.address}` },
      },
    ],
  },
  {
    id: "m-terraform-005",
    domain: "デプロイと実装",
    title: "TerraformでVM・firewall・bucketをまとめて構築する",
    description:
      "ace-dev-01にVPC/subnet、HTTP/HTTPS用firewall、e2-microのVM、版管理と公開アクセス防止を有効にしたbucketを作成します。5つのリソースの構成・state・実リソースをそろえます。",
    setup,
    hints: [
      "sim files load terraform-infrastructure で例を読み込み、sim files read main.tf で各resourceと参照を確認します。既存main.tfがあれば内容を確認し、必要に応じて --force で置き換えます。",
      "gcloud auth application-default login → terraform init → terraform plan -out=infra-plan → terraform apply infra-plan",
      "terraform state list と gcloud compute instances describe tf-lab-vm --zone=us-central1-a、gcloud storage buckets describe gs://ace-dev-01-tf-lab-assets で確認します。",
    ],
    assertions: infrastructure.map((resource) => ({ kind: "terraformManaged" as const, resource })),
  },
  {
    id: "m-terraform-006",
    domain: "運用の維持",
    title: "Terraformの管理対象を依存順に片付ける",
    description:
      "terraform-infrastructureの5リソースを用意し、destroy planを保存・確認して適用します。初めから空の状態やstate rmだけでは完了しません。",
    setup,
    hints: [
      "初期状態では sim files load terraform-infrastructure → gcloud auth application-default login → terraform init → terraform apply -auto-approve で対象を用意します。",
      "terraform plan -destroy -out=cleanup-plan → terraform show cleanup-plan。VM/firewallを先に、subnet/VPCを後に削除する計画を確認します。",
      "terraform apply cleanup-plan → terraform state list。bucketが空でない場合はオブジェクトを削除するか、force_destroy = trueを構成に指定して通常のapplyを行ってからdestroy planを作り直します。",
    ],
    assertions: [{ kind: "terraformDestroyed", resources: infrastructure }],
  },
];

export const terraformSatisfied = (world: World, assertion: TerraformAssertion): boolean => {
  if (assertion.kind === "terraformDestroyed") {
    if (!world.terraform.initialized || world.terraform.resources.length) return false;
    const planned = Object.values(world.terraform.plans).some(
      (p) =>
        p.mode === "destroy" &&
        p.serial + 1 === world.terraform.serial &&
        !p.after.length &&
        assertion.resources.every((r) =>
          p.before.some(
            (old) => old.address === r.address && TerraformState.id(old) === TerraformState.id(r),
          ),
        ),
    );
    if (!planned) return false;
    return assertion.resources.every((r) => {
      if (r.type === "google_compute_network")
        return !world.networks.some((n) => n.projectId === r.project && n.name === r.name);
      if (r.type === "google_compute_subnetwork")
        return !world.subnets.some(
          (n) => n.projectId === r.project && n.name === r.name && n.region === r.region,
        );
      try {
        return !TfResourceRuntime.read(world, r);
      } catch {
        return false;
      }
    });
  }
  const expected = assertion.resource;
  const matches = (r: TfResource): boolean =>
    Object.entries(expected).every(
      ([key, value]) => JSON.stringify(r[key as keyof TfResource]) === JSON.stringify(value),
    );
  if (!world.terraform.initialized || !world.terraform.resources.some(matches)) return false;
  if (
    assertion.kind === "terraformMoved" &&
    !Object.values(world.terraform.plans).some(
      (p) =>
        p.serial < world.terraform.serial &&
        p.moves.some((m) => m.from === assertion.from && m.to === expected.address) &&
        p.before.some(matches) &&
        p.after.some(matches) &&
        !p.changes.some((c) => c.resource.address === expected.address),
    )
  )
    return false;
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
  if (expected.type !== "google_compute_subnetwork") {
    try {
      const actual = TfResourceRuntime.read(world, expected);
      return actual !== undefined && matches(actual);
    } catch {
      return false;
    }
  }
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
