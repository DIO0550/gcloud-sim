import type { Region } from "@/engine/domains/catalog";
import { ResourceName } from "@/engine/domains/compute";
import type { JsonRecord } from "@/types/Json";
import type { ValueOf } from "@/types/ValueOf";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const projectBase = (projectId: string): string =>
  `https://www.googleapis.com/compute/v1/projects/${projectId}`;

export const AddressTypes = {
  External: "EXTERNAL",
  Internal: "INTERNAL",
} as const;
export type AddressType = ValueOf<typeof AddressTypes>;

export const AddressType = {
  /**
   * `--address-type` の綴りを閉じた型にする。
   *
   * @param value ユーザーが打った綴り
   * @returns `EXTERNAL` / `INTERNAL` ならそれ。無ければ `none`
   */
  parse(value: string): Option<AddressType> {
    return Option.fromNullable(Object.values(AddressTypes).find((t) => t === value));
  },
} as const;

/** 予約した IP アドレス（`gcloud compute addresses`）。リージョンが無ければグローバル。 */
export type Address = Readonly<{
  projectId: string;
  name: string;
  region: Option<Region>;
  address: string;
  addressType: AddressType;
  status: "RESERVED" | "IN_USE";
  creationTimestamp: string;
  subnet?: string;
  networkTier?: "PREMIUM" | "STANDARD";
}>;

export type AddressSeed = Readonly<{
  projectId: string;
  name: string;
  region: Option<Region>;
  addressType: AddressType;
  /** 採番済みのアドレス。採番の規則は呼び出し側（通し番号）が持つ */
  address: string;
  creationTimestamp: string;
}>;

export const Address = {
  /**
   * アドレスを `RESERVED` で予約する。名前の形式はここで検証する。
   *
   * @param seed 材料
   * @returns 予約したアドレス。名前の形式が悪ければ理由
   */
  create(seed: AddressSeed): Result<Address, string> {
    return Result.map(ResourceName.parse(seed.name), (name) => ({
      projectId: seed.projectId,
      name,
      region: seed.region,
      address: seed.address,
      addressType: seed.addressType,
      status: "RESERVED",
      creationTimestamp: seed.creationTimestamp,
    }));
  },

  selfLink(address: Address): string {
    const scope = Option.isSome(address.region) ? `regions/${address.region.value}` : "global";
    return `${projectBase(address.projectId)}/${scope}/addresses/${address.name}`;
  },

  toRecord(address: Address): JsonRecord {
    return {
      name: address.name,
      address: address.address,
      addressType: address.addressType,
      region: Option.isSome(address.region)
        ? `${projectBase(address.projectId)}/regions/${address.region.value}`
        : undefined,
      status: address.status,
      networkTier: address.networkTier ?? "PREMIUM",
      subnetwork: address.subnet,
      creationTimestamp: address.creationTimestamp,
      selfLink: Address.selfLink(address),
    };
  },
} as const;

/** Cloud Router（`gcloud compute routers`）。Cloud NAT の土台。 */
export type Router = Readonly<{
  projectId: string;
  name: string;
  region: Region;
  network: string;
  asn: number;
}>;

export const Router = {
  /**
   * ルーターを作る。名前の形式はここで検証し、ASN の既定は 64512（本物と同じ）。
   *
   * @param seed 材料
   * @returns 作ったルーター。名前の形式が悪ければ理由
   */
  create(
    seed: Readonly<{
      projectId: string;
      name: string;
      region: Region;
      network: string;
      asn: Option<number>;
    }>,
  ): Result<Router, string> {
    return Result.map(ResourceName.parse(seed.name), (name) => ({
      projectId: seed.projectId,
      name,
      region: seed.region,
      network: seed.network,
      asn: Option.unwrapOr(seed.asn, 64512),
    }));
  },

  selfLink(router: Router): string {
    return `${projectBase(router.projectId)}/regions/${router.region}/routers/${router.name}`;
  },

  toRecord(router: Router): JsonRecord {
    return {
      name: router.name,
      region: `${projectBase(router.projectId)}/regions/${router.region}`,
      network: `${projectBase(router.projectId)}/global/networks/${router.network}`,
      bgp: { asn: router.asn },
      selfLink: Router.selfLink(router),
    };
  },
} as const;

/** VPC ピアリング（`gcloud compute networks peerings`）。相手側が無いうちは `INACTIVE`。 */
export type NetworkPeering = Readonly<{
  projectId: string;
  name: string;
  network: string;
  peerProjectId: string;
  peerNetwork: string;
  state: "ACTIVE" | "INACTIVE";
  exportCustomRoutes: boolean;
  importCustomRoutes: boolean;
}>;

export type NetworkPeeringSeed = Readonly<{
  projectId: string;
  name: string;
  network: string;
  peerProjectId: string;
  peerNetwork: string;
  /** 相手側のネットワークにこちらを向いたピアリングが既にあるか */
  peerSideExists: boolean;
  exportCustomRoutes: boolean;
  importCustomRoutes: boolean;
}>;

export const NetworkPeering = {
  /**
   * ピアリングを作る。相手側が既にこちらを向いていれば `ACTIVE`、無ければ `INACTIVE`（本物と同じ）。
   *
   * @param seed 材料
   * @returns 作ったピアリング。名前の形式が悪ければ理由
   */
  create(seed: NetworkPeeringSeed): Result<NetworkPeering, string> {
    return Result.map(ResourceName.parse(seed.name), (name) => ({
      projectId: seed.projectId,
      name,
      network: seed.network,
      peerProjectId: seed.peerProjectId,
      peerNetwork: seed.peerNetwork,
      state: seed.peerSideExists ? "ACTIVE" : "INACTIVE",
      exportCustomRoutes: seed.exportCustomRoutes,
      importCustomRoutes: seed.importCustomRoutes,
    }));
  },

  /** 相手側のピアリングがこちらを向いているか。 */
  faces(peering: NetworkPeering, projectId: string, network: string): boolean {
    return peering.peerProjectId === projectId && peering.peerNetwork === network;
  },

  withState(peering: NetworkPeering, state: NetworkPeering["state"]): NetworkPeering {
    return { ...peering, state };
  },

  toRecord(peering: NetworkPeering): JsonRecord {
    return {
      name: peering.name,
      network: `${projectBase(peering.projectId)}/global/networks/${peering.network}`,
      peerNetwork: `${projectBase(peering.peerProjectId)}/global/networks/${peering.peerNetwork}`,
      state: peering.state,
      stateDetails:
        peering.state === "ACTIVE"
          ? "[gcloud-sim] Connected."
          : "[gcloud-sim] Waiting for peer network to connect.",
      exportCustomRoutes: peering.exportCustomRoutes,
      importCustomRoutes: peering.importCustomRoutes,
    };
  },
} as const;
