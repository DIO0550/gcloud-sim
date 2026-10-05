import { CommandFailure } from "@/engine/cli/command-failure";
import { ParsedArgs as Args, Flag, type ParsedArgs } from "@/engine/cli/command-spec";
import { Candidates } from "@/engine/commands/shared";
import { GkeControlPlane, Ipv4 } from "@/engine/domains/gke-control-plane";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

export const ControlPlaneFlags = [
  Flag.boolean(
    "enable-private-endpoint",
    "Disable the public endpoint (requires a private cluster in this simulator).",
  ),
  Flag.boolean(
    "enable-master-authorized-networks",
    "Restrict control plane sources to the saved CIDRs.",
  ),
  Flag.list(
    "master-authorized-networks",
    "Canonical IPv4 CIDRs; requires --enable-master-authorized-networks.",
  ),
  Flag.boolean(
    "enable-authorized-networks-on-private-endpoint",
    "Apply authorized CIDRs to the private endpoint too.",
  ),
];
export const PrivateNetworkFlags = [
  ...ControlPlaneFlags,
  Flag.boolean(
    "enable-private-nodes",
    "Create nodes without public IPs (network settings only; no real nodes).",
  ),
  Flag.string(
    "master-ipv4-cidr",
    "Non-overlapping canonical IPv4 /28 (required for private clusters here).",
  ),
  Flag.string(
    "network",
    "Existing cluster VPC name (private clusters only here; default default).",
    { candidates: Candidates.networks },
  ),
  Flag.string(
    "subnetwork",
    "Existing regional subnet name (private clusters only here; default default).",
    { candidates: Candidates.subnets },
  ),
];

export const controlPlaneArgs = (
  args: ParsedArgs,
  current: GkeControlPlane,
): Result<GkeControlPlane, CommandFailure> => {
  const enabled = Args.booleanChoice(args, "enable-master-authorized-networks");
  const supplied = Args.has(args, "master-authorized-networks");
  if (supplied && (!Option.isSome(enabled) || !enabled.value))
    return Result.err(
      CommandFailure.invalidState(
        "master-authorized-networks requires --enable-master-authorized-networks.",
      ),
    );
  const ranges = supplied
    ? Args.list(args, "master-authorized-networks")
    : Option.unwrapOr(current.authorizedNetworks, []);
  if (ranges.some((cidr) => !Option.isSome(Ipv4.range(cidr))))
    return Result.err(
      CommandFailure.invalidState(
        "Authorized networks must be canonical IPv4 CIDRs (no host bits).",
      ),
    );
  if (new Set(ranges).size !== ranges.length)
    return Result.err(CommandFailure.invalidState("Duplicate authorized network CIDR."));
  const config: GkeControlPlane = {
    ...current,
    privateEndpoint: Option.unwrapOr(
      Args.booleanChoice(args, "enable-private-endpoint"),
      current.privateEndpoint,
    ),
    authorizedNetworks: Option.isSome(enabled)
      ? enabled.value
        ? Option.some(ranges)
        : Option.none
      : current.authorizedNetworks,
    enforcePrivateEndpoint: Option.unwrapOr(
      Args.booleanChoice(args, "enable-authorized-networks-on-private-endpoint"),
      current.enforcePrivateEndpoint,
    ),
    lastCheck: Option.none,
  };
  if (!GkeControlPlane.valid(config))
    return Result.err(
      CommandFailure.invalidState(
        "Private endpoint requires a private cluster; private CIDR enforcement requires enabled authorized networks; CIDR count limit is 100 private / 50 public.",
      ),
    );
  return Result.ok(config);
};
export const createControlPlane = (
  args: ParsedArgs,
  autopilot: boolean,
): Result<GkeControlPlane, CommandFailure> => {
  const enabled = Args.boolean(args, "enable-private-nodes");
  if (
    !enabled &&
    ["network", "subnetwork", "master-ipv4-cidr", "enable-ip-alias"].some((flag) =>
      Args.has(args, flag),
    )
  )
    return Result.err(
      CommandFailure.invalidState(
        "Network/CIDR/ip-alias flags require --enable-private-nodes on gcloud-sim.",
      ),
    );
  const base = GkeControlPlane.public();
  if (!enabled) return controlPlaneArgs(args, base);
  if (!autopilot && !Args.boolean(args, "enable-ip-alias"))
    return Result.err(
      CommandFailure.invalidState(
        "Private Standard clusters require --enable-ip-alias on gcloud-sim.",
      ),
    );
  const cidr = Args.string(args, "master-ipv4-cidr");
  if (!Option.isSome(cidr) || !Option.isSome(Ipv4.range(cidr.value)) || !cidr.value.endsWith("/28"))
    return Result.err(
      CommandFailure.invalidState(
        "master-ipv4-cidr requires a canonical IPv4 /28 with --enable-private-nodes.",
      ),
    );
  return controlPlaneArgs(args, {
    ...base,
    privateNetwork: Option.some({
      network: Option.unwrapOr(Args.string(args, "network"), "default"),
      subnetwork: Option.unwrapOr(Args.string(args, "subnetwork"), "default"),
      masterIpv4Cidr: cidr.value,
    }),
  });
};
