import type { RoleName } from "@/engine/domains/iam-policy";
import { Option } from "@/utils/Option";

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
  "compute.zones.list",
  "compute.regions.list",
  "compute.machineTypes.list",
  "compute.images.list",
  "compute.subnetworks.use",
  "compute.subnetworks.useExternalIp",
  "compute.globalOperations.list",
  "compute.zoneOperations.list",
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
  "compute.subnetworks.use",
  "compute.subnetworks.useExternalIp",
  "compute.firewalls.create",
  "compute.firewalls.delete",
  "compute.firewalls.get",
  "compute.firewalls.list",
  "compute.firewalls.update",
  "compute.regions.list",
] as const;

const ComputeViewPermissions = [
  "compute.instances.get",
  "compute.instances.list",
  "compute.disks.list",
  "compute.snapshots.list",
  "compute.networks.get",
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
] as const;

const ContainerPermissions = [
  "container.clusters.create",
  "container.clusters.delete",
  "container.clusters.get",
  "container.clusters.list",
  "container.clusters.getCredentials",
  "container.clusters.update",
] as const;

const RunPermissions = [
  "run.services.create",
  "run.services.delete",
  "run.services.get",
  "run.services.list",
  "run.services.update",
  "run.services.setIamPolicy",
] as const;

const ViewerPermissions = [
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
  "monitoring.timeSeries.list",
] as const;

const EditorPermissions = [
  ...ViewerPermissions,
  ...ComputeInstancePermissions,
  ...ComputeNetworkPermissions,
  ...StorageAdminPermissions,
  ...ServiceAccountPermissions,
  ...ServiceUsagePermissions,
  ...ContainerPermissions,
  ...RunPermissions,
  "resourcemanager.projects.update",
] as const;

const OwnerPermissions = [
  ...EditorPermissions,
  ...ResourceManagerProjectPermissions,
  ...ResourceManagerFolderPermissions,
  ...ResourceManagerOrganizationPermissions,
  ...BillingPermissions,
  "iam.roles.create",
  "iam.roles.delete",
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
  role("roles/iam.serviceAccountUser", "Service Account User", [
    "iam.serviceAccounts.actAs",
    "iam.serviceAccounts.get",
    "iam.serviceAccounts.list",
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
  role("roles/container.developer", "Kubernetes Engine Developer", [
    "container.clusters.get",
    "container.clusters.list",
    "container.clusters.getCredentials",
  ]),
  role("roles/container.viewer", "Kubernetes Engine Viewer", [
    "container.clusters.get",
    "container.clusters.list",
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
  role("roles/logging.viewer", "Logs Viewer", ["logging.logEntries.list"]),
  role("roles/logging.admin", "Logging Admin", ["logging.logEntries.list", "logging.sinks.create"]),
  role("roles/monitoring.viewer", "Monitoring Viewer", ["monitoring.timeSeries.list"]),
];

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
