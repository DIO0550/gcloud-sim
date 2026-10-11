import { Region, Zone } from "@/engine/domains/catalog";
import { Option } from "@/utils/Option";

export type ZoneLocation = Readonly<{ kind: "zone"; zone: Zone }>;
export type RegionLocation = Readonly<{ kind: "region"; region: Region }>;
export type GlobalLocation = Readonly<{ kind: "global" }>;
export type ResourceLocation = ZoneLocation | RegionLocation | GlobalLocation;
export type MigLocation = ZoneLocation | RegionLocation;
export type RegionalScope = GlobalLocation | RegionLocation;

/** リソースの場所。識別用の名前とRESTパスを混同せず、同じ語彙で組み立てる。 */
export const ResourceLocation = {
  Global: Object.freeze({ kind: "global" as const }),
  zone: (zone: Zone): ZoneLocation => ({ kind: "zone", zone }),
  region: (region: Region): RegionLocation => ({ kind: "region", region }),

  name(location: ResourceLocation): string {
    switch (location.kind) {
      case "global":
        return "global";
      case "region":
        return location.region;
      case "zone":
        return location.zone;
    }
  },

  toPath(location: ResourceLocation): string {
    switch (location.kind) {
      case "global":
        return "global";
      case "region":
        return `regions/${location.region}`;
      case "zone":
        return `zones/${location.zone}`;
    }
  },

  equals(a: ResourceLocation, b: ResourceLocation): boolean {
    return a.kind === b.kind && ResourceLocation.name(a) === ResourceLocation.name(b);
  },
} as const;

export const MigLocation = {
  ...ResourceLocation,
  name(location: MigLocation): Zone | Region {
    return location.kind === "zone" ? location.zone : location.region;
  },
  parse(value: string): Option<MigLocation> {
    const zone = Zone.parse(value);
    if (zone.some) {
      return Option.some(ResourceLocation.zone(zone.value));
    }
    return Option.map(Region.parse(value), ResourceLocation.region);
  },
} as const;
