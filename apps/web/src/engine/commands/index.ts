import type { CommandSpec } from "@/engine/cli/command-spec";
import { BillingCommands, ServiceCommands } from "@/engine/commands/billing-services";
import { ComputeCommands } from "@/engine/commands/compute";
import { AuthCommands, ConfigCommands } from "@/engine/commands/config";
import { ContainerCommands, RunCommands } from "@/engine/commands/container-run";
import { IamCommands } from "@/engine/commands/iam";
import { NotImplementedCommands } from "@/engine/commands/not-implemented";
import {
  FolderCommands,
  OrganizationCommands,
  ProjectCommands,
} from "@/engine/commands/resource-manager";
import { GsutilCommands, StorageCommands } from "@/engine/commands/storage";

const implemented: readonly CommandSpec[] = [
  ...ConfigCommands,
  ...AuthCommands,
  ...ProjectCommands,
  ...OrganizationCommands,
  ...FolderCommands,
  ...BillingCommands,
  ...ServiceCommands,
  ...ComputeCommands,
  ...StorageCommands,
  ...GsutilCommands,
  ...IamCommands,
  ...ContainerCommands,
  ...RunCommands,
];

/** 登録するすべてのコマンド。実装済みが先、未実装のスタブが後。 */
export const AllCommands: readonly CommandSpec[] = [...implemented, ...NotImplementedCommands];
