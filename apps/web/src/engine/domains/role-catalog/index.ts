import type { RoleName } from "@/engine/domains/iam-policy";
import {
  BigtablePermissions,
  FirestorePermissions,
  ManagedDatabasePermissions,
  SpannerPermissions,
} from "@/engine/domains/managed-databases/permissions";
import type { JsonRecord } from "@/types/Json";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

/** 事前定義ロール。含む権限は本物の部分集合（DJ-006, TBD-006）。 */
export type Role = Readonly<{
  name: RoleName;
  title: string;
  includedPermissions: readonly string[];
}>;

const ComputeInstancePermissions = [
  "compute.instances.create",
  "compute.instances.delete",
  "compute.instances.get",
  "compute.instances.list",
  "compute.instances.start",
  "compute.instances.stop",
  "compute.instances.suspend",
  "compute.instances.resume",
  "compute.instances.setMetadata",
  "compute.instances.setTags",
  "compute.instances.setServiceAccount",
  "compute.disks.create",
  "compute.disks.delete",
  "compute.disks.list",
  "compute.disks.createSnapshot",
  "compute.snapshots.create",
  "compute.snapshots.list",
  "compute.snapshots.get",
  "compute.zones.list",
  "compute.regions.list",
  "compute.machineTypes.list",
  "compute.images.list",
  "compute.subnetworks.use",
  "compute.subnetworks.useExternalIp",
  "compute.globalOperations.list",
  "compute.zoneOperations.list",
  "compute.instances.osLogin",
  "compute.instances.attachDisk",
  "compute.instances.setMachineType",
  "compute.disks.get",
  "compute.disks.update",
  "compute.disks.use",
  "compute.instanceTemplates.create",
  "compute.instanceTemplates.list",
  "compute.instanceTemplates.get",
  "compute.instanceGroupManagers.create",
  "compute.instanceGroupManagers.list",
  "compute.instanceGroupManagers.get",
  "compute.instanceGroupManagers.update",
  "compute.instanceGroupManagers.delete",
  "compute.instanceTemplates.delete",
  "compute.instanceGroups.get",
  "compute.instanceGroups.setNamedPorts",
  "compute.instanceGroups.use",
  "compute.autoscalers.create",
  "compute.projects.get",
  "compute.projects.setCommonInstanceMetadata",
] as const;

const LbReadPermissions = [
  ...[
    "healthChecks",
    "regionHealthChecks",
    "backendServices",
    "regionBackendServices",
    "forwardingRules",
    "globalForwardingRules",
    "urlMaps",
    "regionUrlMaps",
    "targetHttpProxies",
    "regionTargetHttpProxies",
    "targetHttpsProxies",
    "regionTargetHttpsProxies",
    "sslCertificates",
    "networkEndpointGroups",
    "backendBuckets",
    "addresses",
    "globalAddresses",
    "instanceGroups",
  ].flatMap((kind) => ["get", "list"].map((verb) => `compute.${kind}.${verb}`)),
] as const;
const ComputeLoadBalancerPermissions = [
  ...LbReadPermissions,
  ...[
    "healthChecks",
    "regionHealthChecks",
    "backendServices",
    "regionBackendServices",
    "forwardingRules",
    "globalForwardingRules",
    "urlMaps",
    "regionUrlMaps",
    "targetHttpProxies",
    "regionTargetHttpProxies",
    "targetHttpsProxies",
    "sslCertificates",
    "networkEndpointGroups",
    "backendBuckets",
    "addresses",
    "globalAddresses",
  ].flatMap((kind) => ["create", "delete"].map((verb) => `compute.${kind}.${verb}`)),
  ...[
    "healthChecks",
    "regionHealthChecks",
    "backendServices",
    "regionBackendServices",
    "urlMaps",
    "regionUrlMaps",
    "backendBuckets",
  ].map((kind) => `compute.${kind}.update`),
  ...[
    "backendServices",
    "regionBackendServices",
    "urlMaps",
    "regionUrlMaps",
    "targetHttpProxies",
    "regionTargetHttpProxies",
    "targetHttpsProxies",
    "networkEndpointGroups",
    "backendBuckets",
    "addresses",
    "globalAddresses",
  ].map((kind) => `compute.${kind}.use`),
  "compute.healthChecks.useReadOnly",
  "compute.regionHealthChecks.useReadOnly",
  "compute.networkEndpointGroups.attachNetworkEndpoints",
  "compute.networkEndpointGroups.detachNetworkEndpoints",
  "compute.targetHttpsProxies.setSslCertificates",
  "compute.instances.use",
  "compute.networks.use",
  "compute.instanceGroups.use",
  "compute.instanceGroups.setNamedPorts",
] as const;

const ComputeNetworkPermissions = [
  "compute.networks.create",
  "compute.networks.delete",
  "compute.networks.get",
  "compute.networks.list",
  "compute.networks.updatePolicy",
  "compute.subnetworks.create",
  "compute.subnetworks.delete",
  "compute.subnetworks.list",
  "compute.subnetworks.get",
  "compute.subnetworks.setPrivateIpGoogleAccess",
  "compute.subnetworks.use",
  "compute.subnetworks.useExternalIp",
  "compute.firewalls.create",
  "compute.firewalls.delete",
  "compute.firewalls.get",
  "compute.firewalls.list",
  "compute.firewalls.update",
  "compute.regions.list",
  "compute.routers.create",
  "compute.routers.list",
  "compute.routers.get",
  "compute.networks.addPeering",
  "compute.networks.updatePeering",
  ...ComputeLoadBalancerPermissions,
] as const;

const ComputeViewPermissions = [
  ...LbReadPermissions,
  "compute.instances.get",
  "compute.instances.list",
  "compute.disks.list",
  "compute.disks.get",
  "compute.snapshots.list",
  "compute.snapshots.get",
  "compute.networks.get",
  "compute.subnetworks.get",
  "compute.networks.list",
  "compute.subnetworks.list",
  "compute.firewalls.get",
  "compute.firewalls.list",
  "compute.zones.list",
  "compute.regions.list",
  "compute.machineTypes.list",
  "compute.images.list",
  "compute.globalOperations.list",
  "compute.zoneOperations.list",
] as const;

const StorageObjectViewPermissions = [
  "storage.objects.get",
  "storage.objects.list",
  "storage.buckets.get",
] as const;

const StorageObjectAdminPermissions = [
  ...StorageObjectViewPermissions,
  "storage.objects.create",
  "storage.objects.delete",
  "storage.objects.update",
] as const;

const StorageAdminPermissions = [
  ...StorageObjectAdminPermissions,
  "storage.buckets.create",
  "storage.buckets.delete",
  "storage.buckets.list",
  "storage.buckets.update",
  "storage.buckets.getIamPolicy",
  "storage.buckets.setIamPolicy",
] as const;

const ResourceManagerProjectPermissions = [
  "resourcemanager.projects.get",
  "resourcemanager.projects.list",
  "resourcemanager.projects.create",
  "resourcemanager.projects.delete",
  "resourcemanager.projects.undelete",
  "resourcemanager.projects.update",
  "resourcemanager.projects.getIamPolicy",
  "resourcemanager.projects.setIamPolicy",
] as const;

const ResourceManagerFolderPermissions = [
  "resourcemanager.folders.get",
  "resourcemanager.folders.list",
  "resourcemanager.folders.create",
  "resourcemanager.folders.delete",
  "resourcemanager.folders.getIamPolicy",
  "resourcemanager.folders.setIamPolicy",
] as const;

const ResourceManagerOrganizationPermissions = [
  "resourcemanager.organizations.get",
  "resourcemanager.organizations.getIamPolicy",
  "resourcemanager.organizations.setIamPolicy",
] as const;

const ServiceAccountPermissions = [
  "iam.serviceAccounts.create",
  "iam.serviceAccounts.delete",
  "iam.serviceAccounts.get",
  "iam.serviceAccounts.list",
  "iam.serviceAccounts.update",
  "iam.serviceAccounts.getIamPolicy",
  "iam.serviceAccounts.setIamPolicy",
] as const;

const ServiceAccountKeyPermissions = [
  "iam.serviceAccountKeys.create",
  "iam.serviceAccountKeys.list",
] as const;

const ServiceUsagePermissions = [
  "serviceusage.services.enable",
  "serviceusage.services.disable",
  "serviceusage.services.list",
  "serviceusage.services.get",
] as const;

const BillingPermissions = [
  "billing.accounts.list",
  "billing.accounts.get",
  "billing.resourceAssociations.create",
  "billing.resourceAssociations.delete",
  "billing.resourceAssociations.list",
  "billing.budgets.create",
  "billing.budgets.list",
  "billing.budgets.get",
] as const;

const KubeLessonPermissions = ["serviceAccounts", "thirdPartyObjects"].flatMap((kind) =>
  ["create", "get", "list", "update", "delete"].map((verb) => `container.${kind}.${verb}`),
);
const KubeLessonReadPermissions = ["serviceAccounts", "thirdPartyObjects"].flatMap((kind) =>
  ["get", "list"].map((verb) => `container.${kind}.${verb}`),
);

const HpaPermissions = [
  "container.horizontalPodAutoscalers.create",
  "container.horizontalPodAutoscalers.update",
  "container.horizontalPodAutoscalers.delete",
  "container.horizontalPodAutoscalers.get",
  "container.horizontalPodAutoscalers.list",
] as const;

const KubeConfigPermissions = [
  "container.configMaps.create",
  "container.configMaps.update",
  "container.configMaps.get",
  "container.configMaps.list",
  "container.configMaps.delete",
  "container.secrets.create",
  "container.secrets.update",
  "container.secrets.get",
  "container.secrets.list",
  "container.secrets.delete",
  "container.pods.exec",
] as const;

const NamespacePermissions = [
  "container.namespaces.create",
  "container.namespaces.update",
  "container.namespaces.delete",
  "container.namespaces.get",
  "container.namespaces.list",
] as const;

const KubeIngressPermissions = ["create", "get", "list", "update", "delete"].map(
  (verb) => `container.ingresses.${verb}`,
);
const KubeNetworkPolicyPermissions = ["create", "get", "list", "update", "delete"].map(
  (verb) => `container.networkPolicies.${verb}`,
);

const KubeStoragePermissions = [
  ...["storageClasses", "persistentVolumeClaims", "persistentVolumes"].flatMap((kind) =>
    ["create", "get", "list", "update", "delete"].map((verb) => `container.${kind}.${verb}`),
  ),
] as const;

const ContainerPermissions = [
  ...KubeStoragePermissions,
  ...KubeIngressPermissions,
  ...KubeNetworkPolicyPermissions,
  ...NamespacePermissions,
  ...KubeConfigPermissions,
  ...HpaPermissions,
  ...KubeLessonPermissions,
  "container.clusters.create",
  "container.clusters.delete",
  "container.clusters.get",
  "container.clusters.list",
  "container.clusters.getCredentials",
  "container.clusters.update",
  "container.deployments.create",
  "container.statefulSets.create",
  "container.deployments.delete",
  "container.statefulSets.delete",
  "container.deployments.get",
  "container.statefulSets.get",
  "container.deployments.list",
  "container.statefulSets.list",
  "container.deployments.update",
  "container.statefulSets.update",
  "container.services.create",
  "container.services.update",
  "container.services.delete",
  "container.services.get",
  "container.services.list",
  "container.pods.get",
  "container.pods.list",
] as const;

const ContainerDeveloperPermissions = [
  ...KubeStoragePermissions,
  ...KubeIngressPermissions,
  ...KubeNetworkPolicyPermissions,
  ...NamespacePermissions,
  ...KubeConfigPermissions,
  ...HpaPermissions,
  ...KubeLessonPermissions,
  "container.clusters.get",
  "container.clusters.list",
  "container.clusters.getCredentials",
  "container.deployments.create",
  "container.statefulSets.create",
  "container.deployments.delete",
  "container.statefulSets.delete",
  "container.deployments.get",
  "container.statefulSets.get",
  "container.deployments.list",
  "container.statefulSets.list",
  "container.deployments.update",
  "container.statefulSets.update",
  "container.services.create",
  "container.services.update",
  "container.services.delete",
  "container.services.get",
  "container.services.list",
  "container.pods.get",
  "container.pods.list",
] as const;

const ServerlessPermissions = [
  ...FirestorePermissions,
  ...[
    "vpcaccess.connectors",
    "redis.instances",
    "datastore.databases",
    "eventarc.triggers",
    "workflows.workflows",
    "secretmanager.secrets",
    "cloudkms.cryptoKeys",
    "run.jobs",
  ].flatMap((kind) =>
    ["create", "get", "list", "update", "delete", "setIamPolicy", "getIamPolicy"].map(
      (verb) => `${kind}.${verb}`,
    ),
  ),
  "pubsub.topics.publish",
  "run.routes.invoke",
  "run.services.getIamPolicy",
  "run.jobs.run",
  "run.executions.get",
  "run.executions.list",
  "run.executions.cancel",
  "secretmanager.versions.add",
  "secretmanager.versions.access",
  "secretmanager.versions.enable",
  "secretmanager.versions.disable",
  "secretmanager.versions.destroy",
  "cloudkms.cryptoKeyVersions.update",
  "cloudkms.cryptoKeyVersions.useToDecrypt",
  "cloudkms.cryptoKeyVersions.useToEncrypt",
  "datastore.entities.get",
  "datastore.entities.create",
  "datastore.entities.update",
  "datastore.entities.delete",
  "eventarc.events.receiveEvent",
  "workflows.executions.create",
  "workflows.executions.get",
  "cloudfunctions.functions.setIamPolicy",
  "cloudfunctions.functions.getIamPolicy",
] as const;

const RunPermissions = [
  ...ServerlessPermissions.filter((p) => p.startsWith("run.")),
  "run.services.create",
  "run.services.delete",
  "run.services.get",
  "run.services.list",
  "run.services.update",
  "run.services.setIamPolicy",
] as const;

const FunctionsPermissions = [
  "cloudfunctions.functions.setIamPolicy",
  "cloudfunctions.functions.getIamPolicy",
  "cloudfunctions.functions.create",
  "cloudfunctions.functions.update",
  "cloudfunctions.functions.delete",
  "cloudfunctions.functions.get",
  "cloudfunctions.functions.list",
  "cloudfunctions.functions.call",
] as const;

const AppEnginePermissions = [
  "appengine.applications.create",
  "appengine.applications.get",
  "appengine.versions.create",
  "appengine.versions.list",
  "appengine.services.update",
] as const;

const CloudSqlPermissions = [
  "cloudsql.instances.update",
  "cloudsql.instances.connect",
  "cloudsql.instances.failover",
  "cloudsql.instances.restoreBackup",
  "cloudsql.instances.import",
  "cloudsql.instances.export",
  "cloudsql.backupRuns.get",
  "cloudsql.databases.create",
  "cloudsql.databases.get",
  "cloudsql.databases.list",
  "cloudsql.databases.delete",
  "cloudsql.users.create",
  "cloudsql.users.get",
  "cloudsql.users.list",
  "cloudsql.users.delete",

  "cloudsql.instances.create",
  "cloudsql.instances.delete",
  "cloudsql.instances.get",
  "cloudsql.instances.list",
  "cloudsql.backupRuns.create",
] as const;

const AlloyPermissions = [
  "alloydb.clusters.create",
  "alloydb.clusters.get",
  "alloydb.clusters.list",
  "alloydb.clusters.delete",
  "alloydb.instances.create",
  "alloydb.instances.get",
  "alloydb.instances.list",
  "alloydb.instances.delete",
  "alloydb.backups.create",
  "alloydb.backups.get",
  "alloydb.backups.list",
  "alloydb.backups.delete",
  "alloydb.users.create",
  "alloydb.users.get",
  "alloydb.users.list",
  "alloydb.users.delete",
  "alloydb.databases.create",
  "alloydb.databases.get",
  "alloydb.databases.list",
  "alloydb.databases.delete",
  "alloydb.instances.connect",
  "alloydb.clusters.restore",
] as const;
const DmsPermissions = [
  "datamigration.connectionprofiles.create",
  "datamigration.connectionprofiles.get",
  "datamigration.connectionprofiles.list",
  "datamigration.connectionprofiles.delete",
  "datamigration.migrationjobs.create",
  "datamigration.migrationjobs.get",
  "datamigration.migrationjobs.list",
  "datamigration.migrationjobs.delete",
  "datamigration.migrationjobs.verify",
  "datamigration.migrationjobs.start",
  "datamigration.migrationjobs.stop",
  "datamigration.migrationjobs.resume",
  "datamigration.migrationjobs.promote",
  "datamigration.migrationjobs.update",
] as const;

const PubsubPermissions = [
  "pubsub.topics.publish",
  "pubsub.topics.create",
  "pubsub.topics.list",
  "pubsub.topics.get",
  "pubsub.subscriptions.create",
  "pubsub.subscriptions.get",
] as const;

const LoggingPermissions = [
  "logging.logEntries.list",
  "logging.logs.list",
  "logging.sinks.create",
  "logging.sinks.list",
  "logging.sinks.get",
  "logging.sinks.update",
  "logging.sinks.delete",
  "logging.logMetrics.create",
  "logging.logMetrics.update",
  "logging.logMetrics.delete",
  "logging.logMetrics.get",
  "logging.logMetrics.list",
] as const;

const MonitoringViewPermissions = [
  "monitoring.timeSeries.list",
  "monitoring.dashboards.list",
  "monitoring.alertPolicies.list",
  "monitoring.alertPolicies.get",
  "monitoring.dashboards.get",
  "monitoring.uptimeCheckConfigs.list",
  "monitoring.uptimeCheckConfigs.get",
] as const;
const MonitoringPermissions = [
  ...MonitoringViewPermissions,
  "monitoring.dashboards.create",
  "monitoring.dashboards.delete",
  "monitoring.alertPolicies.create",
  "monitoring.alertPolicies.delete",
  "monitoring.uptimeCheckConfigs.create",
  "monitoring.uptimeCheckConfigs.delete",
] as const;

const KmsPermissions = [
  "cloudkms.keyRings.create",
  "cloudkms.keyRings.list",
  "cloudkms.keyRings.get",
] as const;

const DnsPermissions = [
  "dns.managedZones.create",
  "dns.managedZones.list",
  "dns.managedZones.get",
] as const;

const DeploymentManagerPermissions = [
  "deploymentmanager.deployments.create",
  "deploymentmanager.deployments.list",
  "deploymentmanager.deployments.get",
] as const;

const BuildReadPermissions = ["cloudbuild.builds.get", "cloudbuild.builds.list"];
const BuildWritePermissions = [
  ...BuildReadPermissions,
  "cloudbuild.builds.create",
  "cloudbuild.builds.update",
];

const ArtifactReadPermissions = [
  "artifactregistry.tags.list",
  "artifactregistry.repositories.get",
  "artifactregistry.repositories.list",
  "artifactregistry.repositories.downloadArtifacts",
  "artifactregistry.dockerimages.list",
  "artifactregistry.dockerimages.get",
  "artifactregistry.repositories.getIamPolicy",
] as const;
const ArtifactWritePermissions = [
  ...ArtifactReadPermissions,
  "artifactregistry.tags.create",
  "artifactregistry.tags.update",
  "artifactregistry.repositories.uploadArtifacts",
] as const;
const ArtifactRepoAdminPermissions = [
  ...ArtifactWritePermissions,
  "artifactregistry.tags.delete",
  "artifactregistry.versions.delete",
  "artifactregistry.packages.delete",
] as const;
const ArtifactAdminPermissions = [
  ...ArtifactRepoAdminPermissions,
  "artifactregistry.repositories.create",
  "artifactregistry.repositories.delete",
  "artifactregistry.repositories.setIamPolicy",
] as const;

const ViewerPermissions = [
  ...ManagedDatabasePermissions.filter((p) => p.endsWith(".get") || p.endsWith(".list")),
  "spanner.databases.read",
  "bigtable.tables.readRows",
  ...KubeStoragePermissions.filter((p) => p.endsWith(".get") || p.endsWith(".list")),
  ...KubeIngressPermissions.filter((p) => p.endsWith(".get") || p.endsWith(".list")),
  ...KubeNetworkPolicyPermissions.filter((p) => p.endsWith(".get") || p.endsWith(".list")),
  ...BuildReadPermissions,
  ...ArtifactReadPermissions,
  ...MonitoringViewPermissions,
  "logging.logMetrics.get",
  "logging.logMetrics.list",
  ...ComputeViewPermissions,
  ...StorageObjectViewPermissions,
  "storage.buckets.list",
  "resourcemanager.projects.get",
  "resourcemanager.projects.list",
  "resourcemanager.folders.get",
  "resourcemanager.folders.list",
  "resourcemanager.organizations.get",
  "resourcemanager.projects.getIamPolicy",
  "resourcemanager.folders.getIamPolicy",
  "resourcemanager.organizations.getIamPolicy",
  "iam.serviceAccounts.get",
  "iam.serviceAccounts.list",
  "iam.roles.get",
  "iam.roles.list",
  "serviceusage.services.list",
  "serviceusage.services.get",
  "container.clusters.get",
  "container.clusters.list",
  "run.services.get",
  "run.services.list",
  "logging.logEntries.list",
  "logging.logs.list",
  "logging.sinks.list",
  "logging.sinks.get",
  "monitoring.timeSeries.list",
  "monitoring.dashboards.list",
  "monitoring.alertPolicies.list",
  "cloudfunctions.functions.get",
  "cloudfunctions.functions.list",
  "appengine.applications.get",
  "appengine.versions.list",
  "cloudsql.instances.get",
  "cloudsql.instances.list",
  "pubsub.topics.list",
  "pubsub.topics.get",
  "cloudkms.keyRings.list",
  "dns.managedZones.list",
  "deploymentmanager.deployments.list",
  "compute.instanceTemplates.list",
  "compute.instanceGroupManagers.list",
  "compute.addresses.list",
  "compute.routers.list",
  "compute.healthChecks.list",
  "compute.backendServices.list",
  "compute.forwardingRules.list",
  "compute.instanceTemplates.get",
  "compute.instanceGroupManagers.get",
  "compute.addresses.get",
  "compute.routers.get",
  "compute.healthChecks.get",
  "compute.backendServices.get",
  "compute.forwardingRules.get",
  "cloudkms.keyRings.get",
  "dns.managedZones.get",
  "deploymentmanager.deployments.get",
  "pubsub.subscriptions.get",
  "compute.projects.get",
  "compute.disks.get",
  "container.horizontalPodAutoscalers.get",
  "container.horizontalPodAutoscalers.list",
  "container.deployments.get",
  "container.statefulSets.get",
  "container.deployments.list",
  "container.statefulSets.list",
  "container.services.get",
  "container.services.list",
  "container.pods.get",
  "container.pods.list",
] as const;

const EditorPermissions = [
  ...ManagedDatabasePermissions,
  ...ServerlessPermissions,
  ...BuildWritePermissions,
  ...ArtifactRepoAdminPermissions,
  "artifactregistry.repositories.create",
  "artifactregistry.repositories.delete",
  ...ViewerPermissions,
  ...ComputeInstancePermissions,
  ...ComputeNetworkPermissions,
  ...StorageAdminPermissions,
  ...ServiceAccountPermissions,
  ...ServiceAccountKeyPermissions,
  ...ServiceUsagePermissions,
  ...ContainerPermissions,
  ...RunPermissions,
  ...FunctionsPermissions,
  ...AppEnginePermissions,
  ...CloudSqlPermissions,
  ...AlloyPermissions,
  ...DmsPermissions,
  ...PubsubPermissions,
  ...LoggingPermissions,
  ...MonitoringPermissions,
  ...KmsPermissions,
  ...DnsPermissions,
  ...DeploymentManagerPermissions,
  "resourcemanager.projects.update",
] as const;

const OwnerPermissions = [
  ...ArtifactAdminPermissions,
  ...EditorPermissions,
  ...ResourceManagerProjectPermissions,
  ...ResourceManagerFolderPermissions,
  ...ResourceManagerOrganizationPermissions,
  ...BillingPermissions,
  "iam.roles.create",
  "iam.roles.delete",
  "iam.roles.update",
  "storage.buckets.setIamPolicy",
] as const;

const unique = (permissions: readonly string[]): readonly string[] => [...new Set(permissions)];

const role = (name: RoleName, title: string, permissions: readonly string[]): Role => ({
  name,
  title,
  includedPermissions: unique(permissions),
});

/** ACE 頻出の事前定義ロール（TBD-006: 約 30 個から開始）。 */
const Roles: readonly Role[] = [
  role(
    "roles/secretmanager.admin",
    "Secret Manager Admin",
    ServerlessPermissions.filter((p) => p.startsWith("secretmanager.")),
  ),
  role("roles/secretmanager.secretAccessor", "Secret Accessor", ["secretmanager.versions.access"]),
  role("roles/cloudkms.cryptoKeyEncrypterDecrypter", "CryptoKey Encrypter/Decrypter", [
    "cloudkms.cryptoKeyVersions.useToEncrypt",
    "cloudkms.cryptoKeyVersions.useToDecrypt",
  ]),
  role("roles/datastore.user", "Firestore Data User", [
    "datastore.entities.get",
    "datastore.entities.list",
    "datastore.entities.create",
    "datastore.entities.update",
    "datastore.entities.delete",
  ]),
  role(
    "roles/datastore.owner",
    "Firestore Owner",
    ServerlessPermissions.filter((p) => p.startsWith("datastore.")),
  ),
  role(
    "roles/vpcaccess.admin",
    "VPC Access Admin",
    ServerlessPermissions.filter((p) => p.startsWith("vpcaccess.")),
  ),
  role(
    "roles/redis.admin",
    "Redis Admin",
    ServerlessPermissions.filter((p) => p.startsWith("redis.")),
  ),
  role(
    "roles/eventarc.admin",
    "Eventarc Admin",
    ServerlessPermissions.filter((p) => p.startsWith("eventarc.")),
  ),
  role("roles/eventarc.eventReceiver", "Eventarc Event Receiver", ["eventarc.events.receiveEvent"]),
  role(
    "roles/workflows.admin",
    "Workflows Admin",
    ServerlessPermissions.filter((p) => p.startsWith("workflows.")),
  ),
  role("roles/workflows.invoker", "Workflows Invoker", [
    "workflows.executions.create",
    "workflows.executions.get",
  ]),

  role("roles/cloudbuild.builds.viewer", "Cloud Build Viewer", BuildReadPermissions),
  role("roles/cloudbuild.builds.editor", "Cloud Build Editor", BuildWritePermissions),
  role("roles/artifactregistry.reader", "Artifact Registry Reader", ArtifactReadPermissions),
  role("roles/artifactregistry.writer", "Artifact Registry Writer", ArtifactWritePermissions),
  role(
    "roles/artifactregistry.repoAdmin",
    "Artifact Registry Repository Administrator",
    ArtifactRepoAdminPermissions,
  ),
  role("roles/artifactregistry.admin", "Artifact Registry Administrator", ArtifactAdminPermissions),
  role("roles/owner", "Owner", OwnerPermissions),
  role("roles/editor", "Editor", EditorPermissions),
  role("roles/viewer", "Viewer", ViewerPermissions),
  role("roles/browser", "Browser", [
    "resourcemanager.projects.get",
    "resourcemanager.projects.list",
    "resourcemanager.folders.get",
    "resourcemanager.folders.list",
    "resourcemanager.organizations.get",
  ]),
  role("roles/resourcemanager.projectCreator", "Project Creator", [
    "resourcemanager.projects.create",
    "resourcemanager.organizations.get",
    "resourcemanager.folders.get",
  ]),
  role("roles/resourcemanager.projectDeleter", "Project Deleter", [
    "resourcemanager.projects.delete",
    "resourcemanager.projects.get",
  ]),
  role("roles/resourcemanager.projectIamAdmin", "Project IAM Admin", [
    "resourcemanager.projects.get",
    "resourcemanager.projects.getIamPolicy",
    "resourcemanager.projects.setIamPolicy",
  ]),
  role("roles/resourcemanager.folderAdmin", "Folder Admin", [
    ...ResourceManagerFolderPermissions,
    "resourcemanager.projects.get",
    "resourcemanager.projects.list",
  ]),
  role("roles/resourcemanager.folderCreator", "Folder Creator", [
    "resourcemanager.folders.create",
    "resourcemanager.folders.get",
    "resourcemanager.folders.list",
  ]),
  role("roles/resourcemanager.organizationAdmin", "Organization Administrator", [
    ...ResourceManagerOrganizationPermissions,
    ...ResourceManagerFolderPermissions,
    "resourcemanager.projects.get",
    "resourcemanager.projects.list",
    "resourcemanager.projects.getIamPolicy",
    "resourcemanager.projects.setIamPolicy",
  ]),
  role("roles/resourcemanager.organizationViewer", "Organization Viewer", [
    "resourcemanager.organizations.get",
  ]),
  role("roles/billing.admin", "Billing Account Administrator", BillingPermissions),
  role("roles/billing.user", "Billing Account User", [
    "billing.accounts.get",
    "billing.accounts.list",
    "billing.resourceAssociations.create",
  ]),
  role("roles/billing.viewer", "Billing Account Viewer", [
    "billing.accounts.get",
    "billing.accounts.list",
    "billing.resourceAssociations.list",
  ]),
  role("roles/billing.projectManager", "Project Billing Manager", [
    "billing.resourceAssociations.create",
    "billing.resourceAssociations.delete",
    "billing.resourceAssociations.list",
  ]),
  role("roles/serviceusage.serviceUsageAdmin", "Service Usage Admin", ServiceUsagePermissions),
  role("roles/serviceusage.serviceUsageViewer", "Service Usage Viewer", [
    "serviceusage.services.list",
    "serviceusage.services.get",
  ]),
  role("roles/compute.admin", "Compute Admin", [
    ...ComputeInstancePermissions,
    ...ComputeNetworkPermissions,
  ]),
  role("roles/compute.instanceAdmin.v1", "Compute Instance Admin (v1)", ComputeInstancePermissions),
  role("roles/compute.instanceAdmin", "Compute Instance Admin (beta)", ComputeInstancePermissions),
  role("roles/compute.networkAdmin", "Compute Network Admin", ComputeNetworkPermissions),
  role("roles/compute.securityAdmin", "Compute Security Admin", [
    "compute.firewalls.create",
    "compute.firewalls.delete",
    "compute.firewalls.get",
    "compute.firewalls.list",
    "compute.firewalls.update",
    "compute.networks.list",
  ]),
  role("roles/compute.networkUser", "Compute Network User", [
    "compute.subnetworks.use",
    "compute.subnetworks.useExternalIp",
    "compute.networks.list",
    "compute.subnetworks.list",
  ]),
  role("roles/compute.viewer", "Compute Viewer", ComputeViewPermissions),
  role("roles/compute.osLogin", "Compute OS Login", ["compute.instances.osLogin"]),
  role("roles/compute.osAdminLogin", "Compute OS Admin Login", ["compute.instances.osAdminLogin"]),
  role("roles/storage.admin", "Storage Admin", StorageAdminPermissions),
  role("roles/storage.objectAdmin", "Storage Object Admin", StorageObjectAdminPermissions),
  role("roles/storage.objectCreator", "Storage Object Creator", ["storage.objects.create"]),
  role("roles/storage.objectViewer", "Storage Object Viewer", StorageObjectViewPermissions),
  role("roles/storage.objectUser", "Storage Object User", StorageObjectAdminPermissions),
  role("roles/iam.serviceAccountAdmin", "Service Account Admin", ServiceAccountPermissions),
  role("roles/iam.serviceAccountKeyAdmin", "Service Account Key Admin", [
    ...ServiceAccountKeyPermissions,
    "iam.serviceAccounts.get",
    "iam.serviceAccounts.list",
  ]),
  role("roles/iam.serviceAccountUser", "Service Account User", [
    "iam.serviceAccounts.actAs",
    "iam.serviceAccounts.get",
    "iam.serviceAccounts.list",
  ]),
  role("roles/iam.workloadIdentityUser", "Workload Identity User", [
    "iam.serviceAccounts.getAccessToken",
    "iam.serviceAccounts.getOpenIdToken",
  ]),
  role("roles/iam.serviceAccountTokenCreator", "Service Account Token Creator", [
    "iam.serviceAccounts.getAccessToken",
    "iam.serviceAccounts.signBlob",
  ]),
  role("roles/iam.securityReviewer", "Security Reviewer", [
    "resourcemanager.projects.getIamPolicy",
    "resourcemanager.folders.getIamPolicy",
    "resourcemanager.organizations.getIamPolicy",
    "iam.roles.get",
    "iam.roles.list",
    "iam.serviceAccounts.list",
  ]),
  role("roles/iam.roleAdmin", "Role Administrator", [
    "iam.roles.create",
    "iam.roles.delete",
    "iam.roles.get",
    "iam.roles.list",
    "iam.roles.update",
  ]),
  role("roles/container.admin", "Kubernetes Engine Admin", ContainerPermissions),
  role("roles/container.developer", "Kubernetes Engine Developer", ContainerDeveloperPermissions),
  role("roles/container.viewer", "Kubernetes Engine Viewer", [
    ...KubeLessonReadPermissions,
    ...KubeStoragePermissions.filter((p) => p.endsWith(".get") || p.endsWith(".list")),
    ...KubeIngressPermissions.filter((p) => p.endsWith(".get") || p.endsWith(".list")),
    ...KubeNetworkPolicyPermissions.filter((p) => p.endsWith(".get") || p.endsWith(".list")),
    "container.namespaces.get",
    "container.namespaces.list",
    "container.configMaps.get",
    "container.configMaps.list",
    "container.clusters.get",
    "container.clusters.list",
    "container.horizontalPodAutoscalers.get",
    "container.horizontalPodAutoscalers.list",
    "container.deployments.get",
    "container.statefulSets.get",
    "container.deployments.list",
    "container.statefulSets.list",
    "container.pods.get",
    "container.pods.list",
    "container.services.get",
    "container.services.list",
  ]),
  role("roles/run.admin", "Cloud Run Admin", RunPermissions),
  role("roles/run.developer", "Cloud Run Developer", [
    "run.services.create",
    "run.services.delete",
    "run.services.get",
    "run.services.list",
    "run.services.update",
  ]),
  role("roles/run.invoker", "Cloud Run Invoker", ["run.routes.invoke"]),
  role("roles/logging.viewer", "Logs Viewer", ["logging.logEntries.list", "logging.logs.list"]),
  role("roles/logging.admin", "Logging Admin", LoggingPermissions),
  role("roles/logging.configWriter", "Logs Configuration Writer", [
    "logging.sinks.update",
    "logging.sinks.delete",
    "logging.logMetrics.create",
    "logging.logMetrics.update",
    "logging.logMetrics.delete",
    "logging.logMetrics.get",
    "logging.logMetrics.list",
    "logging.sinks.create",
    "logging.sinks.list",
    "logging.sinks.get",
  ]),
  role("roles/monitoring.viewer", "Monitoring Viewer", MonitoringViewPermissions),
  role("roles/monitoring.editor", "Monitoring Editor", MonitoringPermissions),
  role("roles/monitoring.admin", "Monitoring Admin", MonitoringPermissions),
  role("roles/cloudfunctions.developer", "Cloud Functions Developer", FunctionsPermissions),
  role("roles/cloudfunctions.invoker", "Cloud Functions Invoker", [
    "cloudfunctions.functions.call",
  ]),
  role("roles/cloudfunctions.viewer", "Cloud Functions Viewer", [
    "cloudfunctions.functions.get",
    "cloudfunctions.functions.list",
  ]),
  role("roles/appengine.appAdmin", "App Engine Admin", AppEnginePermissions),
  role("roles/appengine.deployer", "App Engine Deployer", [
    "appengine.applications.get",
    "appengine.versions.create",
    "appengine.versions.list",
  ]),
  role("roles/spanner.admin", "Spanner Admin", SpannerPermissions),
  role("roles/spanner.databaseUser", "Spanner Database User", [
    "spanner.databases.read",
    "spanner.databases.write",
  ]),
  role("roles/spanner.databaseReader", "Spanner Database Reader", ["spanner.databases.read"]),
  role("roles/bigtable.admin", "Bigtable Admin", BigtablePermissions),
  role("roles/bigtable.user", "Bigtable User", [
    "bigtable.tables.get",
    "bigtable.tables.readRows",
    "bigtable.tables.mutateRows",
  ]),
  role("roles/bigtable.reader", "Bigtable Reader", [
    "bigtable.tables.get",
    "bigtable.tables.readRows",
  ]),
  role("roles/redis.viewer", "Redis Viewer", ["redis.instances.get", "redis.instances.list"]),
  role("roles/datastore.viewer", "Firestore Viewer", [
    "datastore.entities.get",
    "datastore.entities.list",
    "datastore.databases.get",
    "datastore.databases.list",
  ]),
  role("roles/alloydb.admin", "AlloyDB Admin", AlloyPermissions),
  role("roles/alloydb.client", "AlloyDB Client", ["alloydb.instances.connect"]),
  role("roles/datamigration.admin", "Database Migration Admin", DmsPermissions),
  role("roles/cloudsql.client", "Cloud SQL Client", ["cloudsql.instances.connect"]),
  role("roles/cloudsql.admin", "Cloud SQL Admin", CloudSqlPermissions),
  role("roles/cloudsql.editor", "Cloud SQL Editor", [
    "cloudsql.instances.get",
    "cloudsql.instances.list",
    "cloudsql.backupRuns.create",
  ]),
  role("roles/cloudsql.viewer", "Cloud SQL Viewer", [
    "cloudsql.instances.get",
    "cloudsql.instances.list",
  ]),
  role("roles/pubsub.publisher", "Pub/Sub Publisher", ["pubsub.topics.publish"]),
  role("roles/pubsub.admin", "Pub/Sub Admin", PubsubPermissions),
  role("roles/pubsub.editor", "Pub/Sub Editor", PubsubPermissions),
  role("roles/pubsub.viewer", "Pub/Sub Viewer", [
    "pubsub.topics.list",
    "pubsub.topics.get",
    "pubsub.subscriptions.get",
  ]),
  role("roles/cloudkms.admin", "Cloud KMS Admin", [
    ...KmsPermissions,
    ...ServerlessPermissions.filter((p) => p.startsWith("cloudkms.") && !p.includes("useTo")),
  ]),
  role("roles/dns.admin", "DNS Administrator", DnsPermissions),
  role("roles/deploymentmanager.editor", "Deployment Manager Editor", DeploymentManagerPermissions),
  role("roles/billing.costsManager", "Billing Account Costs Manager", [
    "billing.accounts.get",
    "billing.accounts.list",
    "billing.budgets.create",
    "billing.budgets.list",
    "billing.budgets.get",
  ]),
  role("roles/compute.loadBalancerAdmin", "Compute Load Balancer Admin", [
    ...ComputeLoadBalancerPermissions,
    "compute.instanceGroupManagers.list",
  ]),
];

/**
 * プロジェクトのカスタムロール（`gcloud iam roles create --project`）。World に保存し、
 * `EffectivePermissions` はカタログとこれの両方から権限を展開する。
 */
export type CustomRole = Readonly<{
  projectId: string;
  /** `projects/P/roles/ID` の ID 部分 */
  roleId: string;
  title: string;
  description: string;
  includedPermissions: readonly string[];
  stage: "GA" | "BETA" | "ALPHA" | "DISABLED";
  etag: string;
}>;

export const CustomRole = {
  /**
   * カスタムロールを作る。ID は `[a-zA-Z0-9_.]{3,64}`、権限はカタログに載っているものだけ
   * （収録外は判定できず許可に倒れるので、載っていない綴りは本物と同じく INVALID_ARGUMENT にする）。
   *
   * @param seed 材料
   * @returns 作ったロール。ID の形式か権限の綴りが悪ければ理由
   */
  create(
    seed: Readonly<{
      projectId: string;
      roleId: string;
      title: Option<string>;
      description: Option<string>;
      includedPermissions: readonly string[];
      stage: Option<CustomRole["stage"]>;
    }>,
  ): Result<CustomRole, string> {
    const roleId = CustomRole.parseRoleId(seed.roleId);
    if (!Result.isOk(roleId)) return roleId;
    const unknown = seed.includedPermissions.find((p) => !KnownPermissions.has(p));
    if (unknown !== undefined) {
      return Result.err(
        `INVALID_ARGUMENT: Permission ${unknown} is not valid for this resource (gcloud-sim knows only the permissions in its role catalog).`,
      );
    }
    return Result.ok({
      projectId: seed.projectId,
      roleId: seed.roleId,
      title: Option.unwrapOr(seed.title, seed.roleId),
      description: Option.unwrapOr(seed.description, "Created on gcloud-sim"),
      includedPermissions: unique(seed.includedPermissions),
      stage: Option.unwrapOr(seed.stage, "GA"),
      etag: "BwYCustom0=",
    });
  },

  /**
   * ロール ID の形式を確かめる。`create` と Console のフォームが同じ規則を使う。
   *
   * @param roleId ユーザーが打った ID
   * @returns `[a-zA-Z0-9_.]{3,64}` ならそのまま。それ以外は INVALID_ARGUMENT の理由
   */
  parseRoleId(roleId: string): Result<string, string> {
    return /^[A-Za-z0-9_.]{3,64}$/.test(roleId)
      ? Result.ok(roleId)
      : Result.err(
          `INVALID_ARGUMENT: The role id ${roleId} is invalid. Role IDs must be 3-64 characters of [a-zA-Z0-9_.].`,
        );
  },

  /** `projects/P/roles/ID` の綴り。バインディングの `role` に入る。 */
  name(role: CustomRole): RoleName {
    return `projects/${role.projectId}/roles/${role.roleId}`;
  },

  /**
   * 名前からプロジェクトと ID を取り出す。
   *
   * @param name `projects/P/roles/ID`
   * @returns プロジェクトと ID。事前定義ロールの綴りなら `none`
   */
  parseName(name: RoleName): Option<Readonly<{ projectId: string; roleId: string }>> {
    const match = /^projects\/([^/]+)\/roles\/([^/]+)$/.exec(name);
    return match === null
      ? Option.none
      : Option.some({ projectId: match[1] ?? "", roleId: match[2] ?? "" });
  },

  /**
   * 事前定義ロールを写して作る（`roles copy`）。権限はそのまま、タイトルに元の名前を付ける。
   *
   * @param source 元のロール
   * @param destination 写し先のプロジェクトと ID
   * @returns 作ったロール。ID の形式が悪ければ理由
   */
  fromRole(
    source: Role,
    destination: Readonly<{ projectId: string; roleId: string }>,
  ): Result<CustomRole, string> {
    return CustomRole.create({
      projectId: destination.projectId,
      roleId: destination.roleId,
      title: Option.some(source.title),
      description: Option.some(`Copied from ${source.name}`),
      includedPermissions: source.includedPermissions,
      stage: Option.none,
    });
  },

  toRecord(role: CustomRole): JsonRecord {
    return {
      name: CustomRole.name(role),
      title: role.title,
      description: role.description,
      includedPermissions: [...role.includedPermissions],
      stage: role.stage,
      etag: role.etag,
    };
  },
} as const;

const KnownPermissions: ReadonlySet<string> = new Set(Roles.flatMap((r) => r.includedPermissions));

export const RoleCatalog = {
  /**
   * ロール名からカタログの定義を引く。
   *
   * @param name ロール名
   * @returns カタログにあればその定義。無ければ `none`
   */
  find(name: RoleName): Option<Role> {
    return Option.fromNullable(Roles.find((r) => r.name === name));
  },

  /**
   * ある権限を含むロール。E-006 のヒントに使う。
   * 最小権限を促すため、含む権限が少ないロールから並べ、基本ロール（owner / editor / viewer）は末尾に回す。
   *
   * @param permission `compute.instances.create` のような権限
   * @returns その権限を含むロール名
   */
  rolesIncluding(permission: string): readonly RoleName[] {
    const isBasic = (role: Role) =>
      ["roles/owner", "roles/editor", "roles/viewer"].includes(role.name);
    const matched = Roles.filter((r) => r.includedPermissions.includes(permission));
    const specific = matched
      .filter((r) => !isBasic(r))
      .toSorted((a, b) => a.includedPermissions.length - b.includedPermissions.length);
    const basic = matched
      .filter(isBasic)
      .toSorted((a, b) => a.includedPermissions.length - b.includedPermissions.length);
    return [...specific, ...basic].map((r) => r.name);
  },

  /**
   * その権限がカタログに収録されているか。収録外の権限は判定せず許可に倒す（DJ-006）。
   *
   * @param permission 権限
   * @returns どれかのロールが含んでいれば真
   */
  isKnownPermission(permission: string): boolean {
    return KnownPermissions.has(permission);
  },

  all(): readonly Role[] {
    return Roles;
  },
} as const;
