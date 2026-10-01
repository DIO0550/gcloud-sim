import type { CommandSpec } from "@/engine/cli/command-spec";
import { DiskCommands } from "@/engine/commands/compute/disks";
import { GroupCommands } from "@/engine/commands/compute/groups";
import { InstanceCommands } from "@/engine/commands/compute/instances";
import { LoadBalancingCommands } from "@/engine/commands/compute/load-balancing";
import { NetworkingCommands } from "@/engine/commands/compute/networking";

/** `gcloud compute` の全コマンド。サブフォルダはリソースの種類で分けている。 */
export const ComputeCommands: readonly CommandSpec[] = [
  ...InstanceCommands,
  ...DiskCommands,
  ...NetworkingCommands,
  ...LoadBalancingCommands,
  ...GroupCommands,
];
