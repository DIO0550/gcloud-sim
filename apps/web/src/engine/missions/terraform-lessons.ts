import { TfResources } from "@/engine/domains/terraform/resources";
import { TfRuntime } from "@/engine/domains/terraform/runtime";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";

export const TerraformPrelude = ["gcloud auth application-default login", "terraform init"];
export const TerraformLessonSteps = {
  auto: [
    "sim files load terraform-auto",
    ...TerraformPrelude,
    "terraform plan -var-file=lesson.tfvars -out=auto-plan",
    "terraform show auto-plan",
    "terraform apply auto-plan",
    "terraform plan -var-file=lesson.tfvars",
  ],
  each: [
    "sim files load terraform-each",
    ...TerraformPrelude,
    "terraform apply -auto-approve",
    'terraform plan -var=\'networks={ blue="tf-blue", green="tf-green", red="tf-red" }\' -out=each-plan',
    "terraform apply each-plan",
  ],
  registry: [
    "sim files load terraform-registry",
    ...TerraformPrelude,
    "terraform plan -out=registry-plan",
    "terraform apply registry-plan",
    "terraform output",
  ],
  policy: [
    "sim files load terraform-policy",
    ...TerraformPrelude,
    'sim files write policies/policy.json --content=\'{"requireUniformBucket":true,"allowedProjects":["ace-dev-01"],"allowedRegions":["us-central1"],"requirePrivateVm":false,"denyPublicIngress":false}\'',
    "sim files replace main.tf --search='uniform_bucket_level_access = false' --replacement='uniform_bucket_level_access = true'",
    "terraform plan -out=secure-plan",
    "sim terraform plan-json secure-plan --out=secure.json",
    "gcloud beta terraform vet secure.json --policy-library=policies",
    "terraform apply secure-plan",
  ],
  restore: [
    "sim files load terraform-network",
    ...TerraformPrelude,
    "terraform apply -auto-approve",
    "gcloud storage buckets create gs://ace-dev-01-tf-state --location=us-central1 --uniform-bucket-level-access",
    "gcloud storage buckets update gs://ace-dev-01-tf-state --versioning",
    "sim files load terraform-backend",
    "terraform init -force-copy",
    "sim terraform state save backup.tfstate",
    "terraform state rm google_compute_subnetwork.lab",
    "sim terraform backend restore 1",
    "yes",
    "terraform plan -out=restored-plan",
  ],
  sensitive: [
    "sim files load terraform-sensitive",
    ...TerraformPrelude,
    "terraform plan -out=sensitive-plan",
    "terraform apply sensitive-plan",
    "terraform output",
    "sim terraform state save sensitive.tfstate",
  ],
  drift: [
    "sim files load terraform-network",
    ...TerraformPrelude,
    "terraform apply -auto-approve",
    "gcloud compute networks subnets update tf-lab-subnet --region=us-central1 --enable-private-ip-google-access",
    "terraform plan -refresh-only -out=drift-plan",
    "terraform apply drift-plan",
    "terraform plan -out=repair-plan",
    "terraform apply repair-plan",
  ],
} as const;
export type TerraformLesson = keyof typeof TerraformLessonSteps;
export type TerraformLessonAssertion = Readonly<{
  kind: "terraformLesson";
  lesson: TerraformLesson;
}>;

const lessons: readonly Readonly<{
  lesson: TerraformLesson;
  title: string;
  description: string;
  domain: Mission["domain"];
}>[] = [
  {
    lesson: "auto",
    title: "Auto VPCにcountで2台のVMを作る",
    description:
      "terraform-autoの例を読み、lesson.tfvarsでvm_countを2に上書きして保存planを適用します。Auto subnetの内部IP、HTTP firewall、2台のVMを確認します。",
    domain: "デプロイと実装",
  },
  {
    lesson: "each",
    title: "for_eachのキーを保ってネットワークを追加する",
    description:
      "terraform-eachでblue/greenを構築した後、-varでredを追加します。既存2つを削除・再作成せず、キー付きstateを3つにします。",
    domain: "デプロイと実装",
  },
  {
    lesson: "registry",
    title: "バージョン制約とprovider別名でmoduleを使う",
    description:
      "terraform-registryでgoogle provider 5.45.0を固定し、別名labをmoduleへ渡します。公開module名を使ったアプリ内の限定例です。外部moduleはダウンロードしません。",
    domain: "デプロイと実装",
  },
  {
    lesson: "policy",
    title: "plan JSONのポリシー違反を修正して適用する",
    description:
      "terraform-policyのuniform bucket設定を修正し、保存planをJSON化します。policies/policy.jsonでrequireUniformBucket=trueを指定し、vet成功後に同じplanを適用します。",
    domain: "アクセスとセキュリティ",
  },
  {
    lesson: "restore",
    title: "版管理したGCS stateを復旧する",
    description:
      "ネットワークを構築しGCSへstateを移行します。バックアップ後にsubnetをstateから外し、世代1を復旧します。復旧は実リソースを変更しません。新しいplanで差分なしを確認します。",
    domain: "運用の維持",
  },
  {
    lesson: "sensitive",
    title: "機密outputとstateの保存内容を比較する",
    description:
      "terraform-sensitiveの教材用トークンを適用します。output表示はマスクされますが、仮想sensitive.tfstateには値が残ります。stateのアクセス保護とGitへの秘密情報の混入を避ける理由を確認します。",
    domain: "アクセスとセキュリティ",
  },
  {
    lesson: "drift",
    title: "外部変更をrefreshして構成へ戻す",
    description:
      "gcloudでsubnetのPrivate Google Accessを有効にします。保存したrefresh-only planを適用し、通常planでHCLのfalseへ戻します。refreshと修復の違いを実行します。",
    domain: "運用の維持",
  },
];
export const TerraformLessonMissions: readonly Mission[] = lessons.map((item, index) => ({
  id: `m-terraform-${String(index + 8).padStart(3, "0")}`,
  domain: item.domain,
  title: item.title,
  description: item.description,
  setup: [
    { kind: "setPrincipal", principal: F.owner },
    { kind: "setProject", projectId: F.devProjectId },
  ],
  hints: [...TerraformLessonSteps[item.lesson]],
  assertions: [{ kind: "terraformLesson", lesson: item.lesson }],
}));

const consistent = (world: World): boolean => {
  try {
    return world.terraform.resources.every((r) => TfResources.equal(r, TfRuntime.read(world, r)));
  } catch {
    return false;
  }
};
const reviewedPlanMatches = (
  detail: string,
  plan: World["terraform"]["plans"][string],
): boolean => {
  try {
    const reviewed: unknown = JSON.parse(detail);
    return (
      typeof reviewed === "object" &&
      reviewed !== null &&
      "plan" in reviewed &&
      TfResources.equal(reviewed.plan, plan)
    );
  } catch {
    return false;
  }
};
export const terraformLessonSatisfied = (
  world: World,
  assertion: TerraformLessonAssertion,
): boolean => {
  const state = world.terraform;
  if (!state.initialized || !consistent(world)) {
    return false;
  }
  const applied = Object.values(state.plans).filter(
    (p) => p.serial + 1 === state.serial && TfResources.equal(p.after, state.resources),
  );
  switch (assertion.lesson) {
    case "auto":
      return (
        state.resources.length === 4 &&
        state.resources.some(
          (r) => r.name === "tf-auto" && r.type === "google_compute_network" && r.autoMode === true,
        ) &&
        [0, 1].every((i) =>
          state.resources.some(
            (r) =>
              r.address === `google_compute_instance.web[${i}]` && r.name === `tf-auto-${i + 1}`,
          ),
        ) &&
        applied.length > 0
      );
    case "each":
      return (
        ["blue", "green", "red"].every((key) =>
          state.resources.some(
            (r) => r.address === `google_compute_network.lab["${key}"]` && r.name === `tf-${key}`,
          ),
        ) &&
        applied.some(
          (p) =>
            p.before.length === 2 &&
            p.changes.length === 1 &&
            p.changes[0]?.action === "create" &&
            p.changes[0].resource.name === "tf-red",
        )
      );
    case "registry":
      return (
        state.providerVersion === "5.45.0" &&
        state.files["main.tf"]?.includes("terraform-google-modules/network/google") === true &&
        state.files["main.tf"].includes("providers = { google = google.lab }") &&
        state.resources.some(
          (r) =>
            r.address === "module.network.google_compute_network.network" &&
            r.name === "tf-registry",
        ) &&
        applied.length > 0
      );
    case "policy":
      return applied.some(
        (p) =>
          p.after.some(
            (r) =>
              r.type === "google_storage_bucket" &&
              r.name === "ace-dev-01-tf-policy" &&
              r.uniformAccess,
          ) &&
          state.events.some(
            (e) =>
              e.kind === "vet" &&
              e.serial === p.serial &&
              e.detail.includes('"requireUniformBucket":true') &&
              e.detail.includes('"planName":"secure.json"') &&
              reviewedPlanMatches(e.detail, p),
          ),
      );
    case "restore":
      return (
        state.backend.config.kind === "gcs" &&
        state.backend.config.bucket === "ace-dev-01-tf-state" &&
        state.events.some((e) => e.kind === "restore" && e.detail.includes("generation:1")) &&
        state.files["backup.tfstate"] !== undefined &&
        state.resources.some((r) => r.address === "google_compute_subnetwork.lab") &&
        Object.values(state.plans).some(
          (p) =>
            p.serial === state.serial &&
            p.mode === "normal" &&
            p.changes.length === 0 &&
            p.after.length === 2,
        )
      );
    case "sensitive":
      return (
        state.sensitiveOutputs.includes("lesson_token") &&
        state.outputs.lesson_token === "teaching-token-only" &&
        state.files["sensitive.tfstate"]?.includes("teaching-token-only") === true &&
        applied.length > 0
      );
    case "drift":
      return (
        state.resources.some(
          (r) =>
            r.type === "google_compute_subnetwork" &&
            r.name === "tf-lab-subnet" &&
            !r.privateAccess,
        ) &&
        Object.values(state.plans).some(
          (p) =>
            p.mode === "refresh-only" &&
            p.serial + 2 === state.serial &&
            p.drift.some(
              (d) => d.resource.type === "google_compute_subnetwork" && d.resource.privateAccess,
            ),
        ) &&
        applied.some((p) =>
          p.changes.some(
            (c) =>
              c.action === "update" &&
              c.resource.type === "google_compute_subnetwork" &&
              !c.resource.privateAccess,
          ),
        )
      );
  }
};
