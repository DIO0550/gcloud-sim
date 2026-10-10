import type { CommandSpec } from "@/engine/cli/command-spec";
import { ArtifactCommands, DockerCommands } from "@/engine/commands/artifacts";
import {
  BillingCommands,
  BudgetCommands,
  ServiceCommands,
} from "@/engine/commands/billing-services";
import { BuildCommands } from "@/engine/commands/builds";
import { ComputeCommands } from "@/engine/commands/compute";
import { DiskLabCommands, MigCommands, VmCommands } from "@/engine/commands/compute-lab";
import { AuthCommands, ConfigCommands, SdkCommands } from "@/engine/commands/config";
import { ContainerCommands } from "@/engine/commands/container-run";
import { PubsubCommands } from "@/engine/commands/data";
import {
  BigQueryCommands,
  ExportCommands,
  KafkaCommands,
  ProcessingCommands,
  PubsubDataCommands,
} from "@/engine/commands/data-processing";
import { GkeLessonCommands } from "@/engine/commands/gke-lessons";
import { IamCommands } from "@/engine/commands/iam";
import {
  DeploymentManagerCommands,
  DnsCommands,
  KmsCommands,
} from "@/engine/commands/infrastructure-services";
import { KubectlCommands } from "@/engine/commands/kubectl";
import {
  BigtableCommands,
  FirestoreLessonCommands,
  RedisLessonCommands,
  SpannerCommands,
} from "@/engine/commands/managed-databases";
import { LogMetricCommands, MonitoringResourceCommands } from "@/engine/commands/monitoring";
import {
  HybridCommands,
  NetworkCommands,
  SecurityDnsCommands,
} from "@/engine/commands/network-lab";
import { NotImplementedCommands } from "@/engine/commands/not-implemented";
import { LoggingCommands } from "@/engine/commands/observability";
import {
  AlloyCommands,
  ConnectCommands,
  DatabaseCommands,
  DmsCommands,
  SelectionCommands,
  SqlInstanceCommands,
  TransferCommands,
} from "@/engine/commands/relational";
import {
  FolderCommands,
  OrganizationCommands,
  ProjectCommands,
} from "@/engine/commands/resource-manager";
import { AppCommands } from "@/engine/commands/serverless";
import {
  EventCommands,
  ExtendedFunctionCommands,
  ExtendedRunCommands,
  JobCommands,
  ServerlessResourceCommands,
  WorkflowCommands,
} from "@/engine/commands/serverless-lab";
import {
  GsutilCommands,
  GsutilExtraCommands,
  StorageCommands,
  StorageExtraCommands,
} from "@/engine/commands/storage";
import { TerraformCommands } from "@/engine/commands/terraform";

const implemented: readonly CommandSpec[] = [
  ...DiskLabCommands,
  ...MigCommands,
  ...VmCommands,
  ...HybridCommands,
  ...NetworkCommands,
  ...SecurityDnsCommands,
  ...BigQueryCommands,
  ...PubsubDataCommands,
  ...ProcessingCommands,
  ...KafkaCommands,
  ...ExportCommands,
  ...TerraformCommands,
  ...ArtifactCommands,
  ...DockerCommands,
  ...BuildCommands,
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
  ...GkeLessonCommands,
  ...KubectlCommands,
  ...ExtendedRunCommands,
  ...ExtendedFunctionCommands,
  ...JobCommands,
  ...EventCommands,
  ...ServerlessResourceCommands,
  ...WorkflowCommands,
  ...AppCommands,
  ...SqlInstanceCommands,
  ...DatabaseCommands,
  ...ConnectCommands,
  ...TransferCommands,
  ...AlloyCommands,
  ...DmsCommands,
  ...SelectionCommands,
  ...BigtableCommands,
  ...FirestoreLessonCommands,
  ...RedisLessonCommands,
  ...SpannerCommands,
  ...PubsubCommands,
  ...LoggingCommands,
  ...LogMetricCommands,
  ...MonitoringResourceCommands,
  ...KmsCommands,
  ...DnsCommands,
  ...DeploymentManagerCommands,
];

/** 登録するすべてのコマンド。実装済みが先、未実装のスタブが後（今は 0 件。機構は DJ-005 のまま残す）。 */
export const AllCommands: readonly CommandSpec[] = [...implemented, ...NotImplementedCommands];
