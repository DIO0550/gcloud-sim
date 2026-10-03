export const TerraformNetworkExample = `provider "google" {
  project = var.project_id
  region = var.region
}
variable "project_id" {
  type = string
  default = "ace-dev-01"
}
variable "region" {
  type = string
  default = "us-central1"
}
variable "subnet_cidr" {
  type = string
  default = "10.42.0.0/24"
}
resource "google_compute_network" "lab" {
  name = "tf-lab-vpc"
  auto_create_subnetworks = false
}
resource "google_compute_subnetwork" "lab" {
  name = "tf-lab-subnet"
  ip_cidr_range = var.subnet_cidr
  network = google_compute_network.lab.id
  private_ip_google_access = false
}
output "network_id" {
  value = google_compute_network.lab.id
}
output "subnet_id" {
  value = google_compute_subnetwork.lab.id
}
`;

export const TerraformModuleExample = {
  "main.tf": `provider "google" {
  project = var.project_id
  region = var.region
}
variable "project_id" {
  type = string
  default = "ace-dev-01"
}
variable "region" {
  type = string
  default = "us-central1"
}
variable "subnet_cidr" {
  type = string
  default = "10.42.0.0/24"
}
variable "private_access" {
  type = bool
  default = false
}
module "network" {
  source = "./modules/network"
  region = var.region
  subnet_cidr = var.subnet_cidr
  private_access = var.private_access
}
moved {
  from = google_compute_network.lab
  to = module.network.google_compute_network.lab
}
moved {
  from = google_compute_subnetwork.lab
  to = module.network.google_compute_subnetwork.lab
}
output "network_id" {
  value = module.network.network_id
}
output "subnet_id" {
  value = module.network.subnet_id
}
output "private_access" {
  value = module.network.private_access
}
`,
  "modules/network/main.tf": `variable "region" {
  type = string
}
variable "subnet_cidr" {
  type = string
}
variable "private_access" {
  type = bool
  default = false
}
resource "google_compute_network" "lab" {
  name = "tf-lab-vpc"
  auto_create_subnetworks = false
}
resource "google_compute_subnetwork" "lab" {
  name = "tf-lab-subnet"
  region = var.region
  network = google_compute_network.lab.id
  ip_cidr_range = var.subnet_cidr
  private_ip_google_access = var.private_access
}
output "network_id" {
  value = google_compute_network.lab.id
}
output "subnet_id" {
  value = google_compute_subnetwork.lab.id
}
output "private_access" {
  value = google_compute_subnetwork.lab.private_ip_google_access
}
`,
} as const;

export const TerraformExamples: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "terraform-network": { "main.tf": TerraformNetworkExample },
  "terraform-modules": TerraformModuleExample,
};
