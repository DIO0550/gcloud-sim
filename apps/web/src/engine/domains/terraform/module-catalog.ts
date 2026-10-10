/** Independently authored offline teaching projection; never download or execute a module. */
export const TfModuleCatalog: Readonly<
  Record<string, Readonly<{ version: string; files: Readonly<Record<string, string>> }>>
> = {
  "terraform-google-modules/network/google": {
    version: "9.0.0",
    files: {
      "main.tf": `variable "project_id" { type = string }
variable "network_name" { type = string }
variable "auto_create_subnetworks" { type = bool default = false }
terraform { required_providers { google = { source = "hashicorp/google" version = ">= 4.0" } } }
resource "google_compute_network" "network" {
  project = var.project_id
  name = var.network_name
  auto_create_subnetworks = var.auto_create_subnetworks
}
output "network_name" { value = google_compute_network.network.name }
output "network_id" { value = google_compute_network.network.id }
`,
    },
  },
};
