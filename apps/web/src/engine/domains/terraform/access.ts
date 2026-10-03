import { EffectivePermissions } from "@/engine/domains/effective-permissions";
import { Principal } from "@/engine/domains/principal";
import type { PolicyTarget } from "@/engine/domains/resource-hierarchy";
import type { TfResource } from "@/engine/domains/terraform/resources";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";

export const TfAccess = {
  check(world: World, r: TfResource, permission: string, target?: PolicyTarget): void {
    if (!Option.isSome(World.findActiveProject(world, r.project)))
      throw new Error(`Project not found: ${r.project}`);
    const api =
      r.type === "google_storage_bucket" ? "storage.googleapis.com" : "compute.googleapis.com";
    if (!World.hasApi(world, r.project, api))
      throw new Error(`${api} is disabled in ${r.project}.`);
    const adc = world.session.adc;
    if (!Option.isSome(adc))
      throw new Error(
        "Application Default Credentials are missing. Run gcloud auth application-default login.",
      );
    const bucketExists =
      r.type === "google_storage_bucket" &&
      world.buckets.some((b) => b.name === r.name && b.projectId === r.project);
    const scope: PolicyTarget =
      target ??
      (bucketExists && permission !== "storage.buckets.create"
        ? { type: "bucket", id: r.name }
        : { type: "project", id: r.project });
    const effective = EffectivePermissions.resolve(world, Principal.toMember(adc.value), scope);
    if (!EffectivePermissions.allows(effective, permission))
      throw new Error(`Permission denied: ${permission} for ADC ${adc.value} in ${r.project}.`);
  },
  resource(world: World, r: TfResource, action: string): void {
    const collection = {
      google_compute_network: "compute.networks",
      google_compute_subnetwork: "compute.subnetworks",
      google_compute_instance: "compute.instances",
      google_compute_firewall: "compute.firewalls",
      google_storage_bucket: "storage.buckets",
    }[r.type];
    TfAccess.check(world, r, `${collection}.${action}`);
  },
} as const;
