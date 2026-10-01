import type { CommandSpec } from "@/engine/cli/command-spec";
import {
  BillingCommands,
  BudgetCommands,
  ServiceCommands,
} from "@/engine/commands/billing-services";
import { ComputeCommands } from "@/engine/commands/compute";
import { AuthCommands, ConfigCommands, SdkCommands } from "@/engine/commands/config";
import { ContainerCommands, RunCommands } from "@/engine/commands/container-run";
import { PubsubCommands, SqlCommands } from "@/engine/commands/data";
import { IamCommands } from "@/engine/commands/iam";
import {
  DeploymentManagerCommands,
  DnsCommands,
  KmsCommands,
} from "@/engine/commands/infrastructure-services";
import { KubectlCommands } from "@/engine/commands/kubectl";
import { NotImplementedCommands } from "@/engine/commands/not-implemented";
import { LoggingCommands, MonitoringCommands } from "@/engine/commands/observability";
import {
  FolderCommands,
  OrganizationCommands,
  ProjectCommands,
} from "@/engine/commands/resource-manager";
import { AppCommands, FunctionsCommands } from "@/engine/commands/serverless";
import {
  GsutilCommands,
  GsutilExtraCommands,
  StorageCommands,
  StorageExtraCommands,
} from "@/engine/commands/storage";

const implemented: readonly CommandSpec[] = [
  ...ConfigCommands,
  ...AuthCommands,
  ...SdkCommands,
  ...ProjectCommands,
  ...OrganizationCommands,
  ...FolderCommands,
  ...BillingCommands,
  ...BudgetCommands,
  ...ServiceCommands,
  ...ComputeCommands,
  ...StorageCommands,
  ...StorageExtraCommands,
  ...GsutilCommands,
  ...GsutilExtraCommands,
  ...IamCommands,
  ...ContainerCommands,
  ...KubectlCommands,
  ...RunCommands,
  ...FunctionsCommands,
  ...AppCommands,
  ...SqlCommands,
  ...PubsubCommands,
  ...LoggingCommands,
  ...MonitoringCommands,
  ...KmsCommands,
  ...DnsCommands,
  ...DeploymentManagerCommands,
];

/** 登録するすべてのコマンド。実装済みが先、未実装のスタブが後（今は 0 件。機構は DJ-005 のまま残す）。 */
export const AllCommands: readonly CommandSpec[] = [...implemented, ...NotImplementedCommands];
