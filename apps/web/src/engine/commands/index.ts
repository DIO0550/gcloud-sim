import type { CommandSpec } from "@/engine/cli/command-spec";
import { AssetCommands } from "@/engine/commands/admin-lab/assets";
import { BillingLabCommands } from "@/engine/commands/admin-lab/billing";
import { CredentialCommands } from "@/engine/commands/admin-lab/credentials";
import { FederationCommands } from "@/engine/commands/admin-lab/federation";
import { IdentityCommands } from "@/engine/commands/admin-lab/identity";
import { OrgPolicyCommands } from "@/engine/commands/admin-lab/policies";
import { QuotaCommands } from "@/engine/commands/admin-lab/quotas";
import { ArtifactCommands, DockerCommands } from "@/engine/commands/artifacts";
import { ContainerReleaseCommands } from "@/engine/commands/artifacts/release";
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
import { ObserveBucketCommands } from "@/engine/commands/observability-lab/buckets";
import { ObserveChannelCommands } from "@/engine/commands/observability-lab/channels";
import { ObserveCollectorCommands } from "@/engine/commands/observability-lab/collectors";
import { ObserveLifecycleCommands } from "@/engine/commands/observability-lab/lifecycle";
import { ObserveLogCommands } from "@/engine/commands/observability-lab/logs";
import { ObserveMetricCommands } from "@/engine/commands/observability-lab/metrics";
import { ObservePolicyCommands } from "@/engine/commands/observability-lab/policies";
import { ObserveUpdateCommands } from "@/engine/commands/observability-lab/updates";
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
import { FileStorageCommands, StorageSelectionCommands } from "@/engine/commands/storage-lab/files";
import { StorageKeyCommands } from "@/engine/commands/storage-lab/keys";
import { ObjectStorageCommands } from "@/engine/commands/storage-lab/objects";
import { StorageTransferCommands } from "@/engine/commands/storage-lab/transfers";
import { TerraformCommands } from "@/engine/commands/terraform";
import { TerraformStateLessonCommands } from "@/engine/commands/terraform/state-lessons";
import { AceSupportCommands } from "./ace-support";
import { ObserveResourceCommands } from "./observability-lab/resources";

const implemented: readonly CommandSpec[] = [
  ...AceSupportCommands,
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
  ...TerraformStateLessonCommands,
  ...ArtifactCommands,
  ...DockerCommands,
  ...ContainerReleaseCommands,
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
  ...FileStorageCommands,
  ...StorageSelectionCommands,
  ...StorageKeyCommands,
  ...ObjectStorageCommands,
  ...StorageTransferCommands,
  ...OrgPolicyCommands,
  ...IdentityCommands,
  ...CredentialCommands,
  ...FederationCommands,
  ...QuotaCommands,
  ...AssetCommands,
  ...BillingLabCommands,
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
  ...ObserveChannelCommands,
  ...ObserveMetricCommands,
  ...ObservePolicyCommands,
  ...ObserveUpdateCommands,
  ...ObserveBucketCommands,
  ...ObserveLogCommands,
  ...ObserveCollectorCommands,
  ...ObserveLifecycleCommands,
  ...ObserveResourceCommands,
  ...LogMetricCommands,
  ...MonitoringResourceCommands,
  ...KmsCommands,
  ...DnsCommands,
  ...DeploymentManagerCommands,
];

/** 登録するすべてのコマンド。実装済みが先、未実装のスタブが後（今は 0 件。機構は DJ-005 のまま残す）。 */
export const AllCommands: readonly CommandSpec[] = [...implemented, ...NotImplementedCommands];
