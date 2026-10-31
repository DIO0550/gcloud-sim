import { TerraformInfrastructureExample } from "@/engine/commands/terraform/examples";
import type { TfResource } from "@/engine/domains/terraform";
import { TerraformState } from "@/engine/domains/terraform";
import { TfBackendRuntime } from "@/engine/domains/terraform/backend-runtime";
import { TfConfiguration } from "@/engine/domains/terraform/configuration";
import { TfResourceRuntime } from "@/engine/domains/terraform/resource-runtime";
import { TfResources } from "@/engine/domains/terraform/resources";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { MissionStep } from "@/engine/missions/mission-step";
import { TerraformPreludeSteps } from "@/engine/missions/terraform-lessons";
import { Option } from "@/utils/Option";

export type TerraformAssertion =
  | Readonly<{
      kind: "terraformBackendMigrated";
      bucket: string;
      prefix: string;
      resources: readonly TfResource[];
    }>
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

const run = MissionStep.run;
const applyAll = (what: string, note?: string) =>
  run(what, "terraform apply -auto-approve", note ?? "確認なしで適用します。");

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
    steps: [
      run("VPCとサブネットの構成例をmain.tfとして読み込む", "sim files load terraform-network"),
      run(
        "main.tfのresourceと値を確かめる",
        "sim files read main.tf",
        "既存ファイルがある場合は読み、必要に応じて編集してください。",
      ),
      ...TerraformPreludeSteps,
      run("構成の文法と参照を検証する", "terraform validate"),
      run("変更計画を作ってtfplanに保存する", "terraform plan -out=tfplan"),
      run("保存した計画で作られるリソースを確かめる", "terraform show tfplan"),
      run("保存した計画どおりに適用する", "terraform apply tfplan"),
      run("stateに載ったリソースを一覧する", "terraform state list"),
      run(
        "もう一度planして差分が無いことを確かめる",
        "terraform plan",
        "最後はリソース差分なしになります。",
      ),
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
    steps: [
      run(
        "サブネットのCIDRを変数ファイルで上書きする",
        "sim files write terraform.tfvars --content='subnet_cidr = \"10.43.0.0/24\"'",
      ),
      run(
        "main.tfでPrivate Google Accessを有効にする",
        "sim files replace main.tf --search='private_ip_google_access = false' --replacement='private_ip_google_access = true'",
      ),
      run("変更の差分を確かめる", "terraform plan", "CIDR変更はこのシミュレーターでは置換です。"),
      run("変更を適用する", "terraform apply", "適用してよいか確認を求められます。"),
      run("適用の確認にyesと答える", "yes"),
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
    steps: [
      run(
        "取り込む対象のカスタムVPCをgcloudで作る",
        "gcloud compute networks create tf-import-net --subnet-mode=custom",
        "既に存在すれば再作成は不要です。",
      ),
      run(
        "取り込み先になるresourceをimport.tfに書く",
        'sim files write import.tf --content=\'resource "google_compute_network" "imported" { project = "ace-dev-01" name = "tf-import-net" auto_create_subnetworks = false }\'',
      ),
      ...TerraformPreludeSteps,
      run(
        "既存VPCをstateのgoogle_compute_network.importedに取り込む",
        "terraform import google_compute_network.imported projects/ace-dev-01/global/networks/tf-import-net",
      ),
      run(
        "取り込んだ属性をstateで確かめる",
        "terraform state show google_compute_network.imported",
      ),
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
    steps: [
      run(
        "移行前のVPCとサブネットの構成例を読み込む",
        "sim files load terraform-network",
        "初期状態から始めるときの準備です。既存ファイルやtfvarsがある場合は内容を確認してください。",
      ),
      ...TerraformPreludeSteps,
      applyAll("移行前のVPCとサブネットを作る"),
      run(
        "モジュール版の構成で既存ファイルを置き換える",
        "sim files load terraform-modules --force",
        "main.tfとmodules/network/main.tfを読み込みます。",
      ),
      run("ルート側のmodule呼び出しとmovedを確かめる", "sim files read main.tf"),
      run(
        "モジュール側の入力と出力を確かめる",
        "sim files read modules/network/main.tf",
        "入力・出力・movedの対応を確認してください。",
      ),
      run("モジュールを認識させるため再度初期化する", "terraform init"),
      run(
        "移行計画を作ってmodule-planに保存する",
        "terraform plan -out=module-plan",
        "2つの has moved to があり、追加・変更・削除がないことを確認します。",
      ),
      run("保存した移行計画を適用する", "terraform apply module-plan"),
      run("stateのアドレスがmodule.network配下に移ったことを確かめる", "terraform state list"),
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
    steps: [
      run(
        "VM・firewall・bucketを含む構成例を読み込む",
        "sim files load terraform-infrastructure",
        "既存のmain.tfがあれば内容を確認し、必要に応じて同名ファイルを置き換えて読み込みます。",
      ),
      run("各resourceと参照のつながりを確かめる", "sim files read main.tf"),
      ...TerraformPreludeSteps,
      run("変更計画を作ってinfra-planに保存する", "terraform plan -out=infra-plan"),
      run("保存した計画どおりに5つのリソースを作る", "terraform apply infra-plan"),
      run("stateに5つのリソースが載ったことを確かめる", "terraform state list"),
      run(
        "作られたVMの設定を確かめる",
        "gcloud compute instances describe tf-lab-vm --zone=us-central1-a",
      ),
      run(
        "bucketの版管理と公開アクセス防止を確かめる",
        "gcloud storage buckets describe gs://ace-dev-01-tf-lab-assets",
      ),
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
    steps: [
      run(
        "片付ける対象の構成例を読み込む",
        "sim files load terraform-infrastructure",
        "初期状態から始めるときの準備です。",
      ),
      ...TerraformPreludeSteps,
      applyAll("片付ける対象の5つのリソースを作る"),
      run("削除計画を作ってcleanup-planに保存する", "terraform plan -destroy -out=cleanup-plan"),
      run(
        "削除の順番を確かめる",
        "terraform show cleanup-plan",
        "VM/firewallを先に、subnet/VPCを後に削除する計画を確認します。",
      ),
      run(
        "保存した削除計画を適用する",
        "terraform apply cleanup-plan",
        "bucketが空でない場合はオブジェクトを削除するか、force_destroy = trueを構成に指定して通常のapplyを行ってからdestroy planを作り直します。",
      ),
      run("stateが空になったことを確かめる", "terraform state list"),
    ],
    assertions: [{ kind: "terraformDestroyed", resources: infrastructure }],
  },
  {
    id: "m-terraform-007",
    domain: "運用の維持",
    title: "ローカルstateをGCS backendへ移行する",
    description:
      "tf-lab-vpcとtf-lab-subnetをローカルstateで管理した後、版管理を有効にしたace-dev-01-tf-stateのterraform/labへstateを移します。実リソースを保持した移行が必要です。最初からGCSで作成するだけでは完了しません。",
    setup,
    steps: [
      run("移行前のVPCとサブネットの構成例を読み込む", "sim files load terraform-network"),
      ...TerraformPreludeSteps,
      applyAll("ローカルstateでVPCとサブネットを作る"),
      run(
        "stateを置くbucketを作る",
        "gcloud storage buckets create gs://ace-dev-01-tf-state --location=us-central1 --uniform-bucket-level-access",
        "既に存在するbucketは再作成不要です。",
      ),
      run(
        "bucketの版管理を有効にする",
        "gcloud storage buckets update gs://ace-dev-01-tf-state --versioning",
      ),
      run("GCS backendの設定を読み込む", "sim files load terraform-backend"),
      run("backend.tfの移行先bucketとprefixを確かめる", "sim files read backend.tf"),
      run(
        "backendを切り替えてローカルstateをGCSへ移す",
        "terraform init -migrate-state",
        "既存のstateを新しいbackendへコピーするか確認を求められます。",
      ),
      run("移行の確認にyesと答える", "yes"),
      run("移行後のstateを取り出して中身を確かめる", "terraform state pull"),
      run(
        "bucketにstateのファイルができたことを確かめる",
        "gcloud storage ls gs://ace-dev-01-tf-state/terraform/lab/",
      ),
    ],
    assertions: [
      {
        kind: "terraformBackendMigrated",
        bucket: "ace-dev-01-tf-state",
        prefix: "terraform/lab",
        resources: [network, subnet],
      },
    ],
  },
];

export const terraformSatisfied = (world: World, assertion: TerraformAssertion): boolean => {
  if (assertion.kind === "terraformBackendMigrated") {
    const backend = world.terraform.backend;
    const migration = backend.migration;
    const target = { kind: "gcs", bucket: assertion.bucket, prefix: assertion.prefix };
    if (!world.terraform.initialized || !TfResources.equal(backend.config, target)) return false;
    if (!world.buckets.some((b) => b.name === assertion.bucket && b.versioning)) return false;
    if (
      !Option.isSome(migration) ||
      migration.value.from.kind !== "local" ||
      !TfResources.equal(migration.value.to, target)
    )
      return false;
    try {
      TfBackendRuntime.check(world);
    } catch {
      return false;
    }
    return assertion.resources.every(
      (resource) =>
        migration.value.data.resources.some((old) => TfResources.equal(old, resource)) &&
        terraformSatisfied(world, { kind: "terraformManaged", resource }),
    );
  }
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
        n.projectId === expected.project &&
        n.name === expected.name &&
        n.subnetMode === (expected.autoMode ? "AUTO" : "CUSTOM"),
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
