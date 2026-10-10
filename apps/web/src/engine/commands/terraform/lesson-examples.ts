export const TerraformLessonExamples = {
  "terraform-auto": {
    "main.tf": `terraform {
  required_version = ">= 1.0, < 2.0"
  required_providers { google = { source = "hashicorp/google" version = "~> 5.0" } }
}
provider "google" { project = "ace-dev-01" region = "us-central1" }
variable "vm_count" { type = number default = 1 }
locals { prefix = "tf-auto" }
resource "google_compute_network" "lab" {
  name = local.prefix
  auto_create_subnetworks = true
}
resource "google_compute_firewall" "web" {
  name = "tf-auto-http"
  network = google_compute_network.lab.id
  source_ranges = ["0.0.0.0/0"]
  target_tags = ["web"]
  allow { protocol = "tcp" ports = ["80"] }
}
resource "google_compute_instance" "web" {
  count = var.vm_count
  name = format("%s-%d", local.prefix, count.index + 1)
  zone = "us-central1-a"
  machine_type = "e2-micro"
  tags = ["web"]
  depends_on = [google_compute_firewall.web]
  boot_disk { initialize_params { image = "debian-cloud/debian-12" } }
  network_interface { network = google_compute_network.lab.id }
}
output "first_vm" { value = google_compute_instance.web[0].id }
`,
    "lesson.tfvars": "vm_count = 2\n",
  },
  "terraform-each": {
    "main.tf": `provider "google" { project = "ace-dev-01" }
variable "networks" { type = map(string) default = { blue = "tf-blue" green = "tf-green" } }
resource "google_compute_network" "lab" {
  for_each = var.networks
  name = each.value
  auto_create_subnetworks = false
}
output "blue" { value = google_compute_network.lab["blue"].id }
`,
  },
  "terraform-registry": {
    "main.tf": `terraform { required_providers { google = { source = "hashicorp/google" version = "~> 5.0" } } }
provider "google" { alias = "lab" project = "ace-dev-01" }
module "network" {
  source = "terraform-google-modules/network/google"
  version = "~> 9.0"
  providers = { google = google.lab }
  project_id = "ace-dev-01"
  network_name = "tf-registry"
}
output "network" { value = module.network.network_id }
`,
  },
  "terraform-policy": {
    "main.tf": `provider "google" { project = "ace-dev-01" }
resource "google_storage_bucket" "assets" {
  name = "ace-dev-01-tf-policy"
  location = "US-CENTRAL1"
  uniform_bucket_level_access = false
  public_access_prevention = "enforced"
}
`,
  },
  "terraform-sensitive": {
    "main.tf": `provider "google" { project = "ace-dev-01" }
variable "lesson_token" { type = string default = "teaching-token-only" sensitive = true }
output "lesson_token" { value = var.lesson_token sensitive = true }
`,
  },
} as const;
