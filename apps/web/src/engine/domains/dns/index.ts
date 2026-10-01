import { ResourceName } from "@/engine/domains/compute";
import type { JsonRecord } from "@/types/Json";
import { Result } from "@/utils/Result";

export type DnsManagedZone = Readonly<{
  projectId: string;
  name: string;
  dnsName: string;
  description: string;
  visibility: "public" | "private";
  nameServers: readonly string[];
  createTime: string;
}>;

export const DnsManagedZone = {
  /**
   * マネージドゾーンを作る。名前は RFC1035、DNS 名は末尾がドット。
   *
   * @param seed 材料
   * @returns 作ったゾーン。名前か DNS 名の形式が悪ければ理由
   */
  create(seed: Omit<DnsManagedZone, "nameServers">): Result<DnsManagedZone, string> {
    if (!/^([a-z0-9-]+\.)+$/.test(seed.dnsName)) {
      return Result.err(
        `Invalid value for [--dns-name]: ${seed.dnsName}. The DNS name must be a fully qualified domain name ending with a dot, e.g. example.com.`,
      );
    }
    return Result.map(ResourceName.parse(seed.name), (name) => ({
      ...seed,
      name,
      nameServers: [
        "ns-cloud-a1.googledomains.com.",
        "ns-cloud-a2.googledomains.com.",
        "ns-cloud-a3.googledomains.com.",
        "ns-cloud-a4.googledomains.com.",
      ],
    }));
  },

  toRecord(zone: DnsManagedZone): JsonRecord {
    return {
      name: zone.name,
      dnsName: zone.dnsName,
      description: zone.description,
      visibility: zone.visibility,
      nameServers: zone.visibility === "public" ? [...zone.nameServers] : [],
      creationTime: zone.createTime,
    };
  },
} as const;
