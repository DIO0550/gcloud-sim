import { Region } from "@/engine/domains/catalog";
import { Network, Subnet, SubnetModes } from "@/engine/domains/compute";
import type { TfResource } from "@/engine/domains/terraform";
import { compileTerraform, type TfCompileOptions } from "@/engine/domains/terraform/compiler";
import { TfResources } from "@/engine/domains/terraform/resources";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const fail = (message: string): never => {
  throw new Error(message);
};
export type TfConfiguration = ReturnType<typeof compileTerraform>;
export const TfConfiguration = {
  compile(
    files: Readonly<Record<string, string>>,
    observed: readonly TfResource[] = [],
    options: TfCompileOptions = {},
  ): TfConfiguration {
    return compileTerraform(files, observed, options, TfConfiguration.validateResource);
  },
  outputsFrom(
    files: Readonly<Record<string, string>>,
    observed: readonly TfResource[],
  ): Readonly<Record<string, string>> {
    return TfConfiguration.compile(files, observed).outputs;
  },
  validateResource(r: TfResource): void {
    TfResources.validate(r);
    if (r.type !== "google_compute_network" && r.type !== "google_compute_subnetwork") return;
    const checked = Network.create({
      projectId: r.project,
      name: r.name,
      subnetMode: SubnetModes.Custom,
    });
    if (!Result.isOk(checked)) fail(checked.error);
    if (r.type !== "google_compute_subnetwork") return;
    const region = Region.parse(r.region);
    if (!Option.isSome(region)) fail(`Unknown region: ${r.region}`);
    const parts = r.cidr.split("/");
    const octets = (parts[0] ?? "").split(".").map(Number);
    const prefix = Number(parts[1]);
    if (
      parts.length !== 2 ||
      octets.length !== 4 ||
      octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255) ||
      !Number.isInteger(prefix) ||
      prefix < 8 ||
      prefix > 29 ||
      !/^\d+\.\d+\.\d+\.\d+\/\d+$/.test(r.cidr)
    )
      fail(`Invalid subnet IPv4 CIDR (supported prefix /8–/29): ${r.cidr}`);
    const ip = octets.reduce((a, b) => a * 256 + b, 0);
    if (ip % 2 ** (32 - prefix) !== 0) fail(`CIDR must use its network address: ${r.cidr}`);
    if (Option.isSome(region)) {
      const subnet = Subnet.create({
        projectId: r.project,
        name: r.name,
        region: region.value,
        network: r.network,
        ipCidrRange: r.cidr,
        privateIpGoogleAccess: r.privateAccess,
      });
      if (!Result.isOk(subnet)) fail(subnet.error);
    }
  },
} as const;
