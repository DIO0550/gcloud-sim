const ready = [{ type: "gcloud auth application-default login" }, { type: "terraform init" }];
export const TERRAFORM_SCENARIOS = [
  {
    name: "terraform-auto-workspace",
    label: "Terraform: Auto VPC・count・provider lock",
    steps: [
      { wait: 800 },
      { type: "sim files load terraform-auto" },
      ...ready,
      { type: "terraform plan -var-file=lesson.tfvars -out=auto-plan" },
      { type: "terraform apply auto-plan" },
      { click: "作業領域" },
      { wait: 300 },
    ],
  },
  {
    name: "terraform-keyed-state",
    label: "Terraform: for_eachのキー付きstate",
    steps: [
      { wait: 800 },
      { type: "sim files load terraform-each" },
      ...ready,
      { type: "terraform apply -auto-approve" },
      { click: 'State: google_compute_network.lab["blue"]' },
      { wait: 300 },
    ],
  },
  {
    name: "terraform-pending-plan",
    label: "Terraform: 未適用の保存plan",
    steps: [
      { wait: 800 },
      { type: "sim files load terraform-auto" },
      ...ready,
      { type: "terraform plan -var-file=lesson.tfvars -out=auto-plan" },
      { click: "Plan: auto-plan" },
      { wait: 300 },
    ],
  },
  {
    name: "terraform-sensitive-state",
    label: "Terraform: 機密outputのマスクとstate保護",
    steps: [
      { wait: 800 },
      { type: "sim files load terraform-sensitive" },
      ...ready,
      { type: "terraform apply -auto-approve" },
      { type: "sim terraform state save sensitive.tfstate" },
      { click: "作業領域" },
      { wait: 300 },
    ],
  },
];
