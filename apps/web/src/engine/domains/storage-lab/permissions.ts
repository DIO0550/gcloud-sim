export const StorageLabPermissions = [
  "storage.objects.restore",
  "storagetransfer.projects.getServiceAccount",
  ...["create", "get", "list", "update", "delete", "run"].map((op) => `storagetransfer.jobs.${op}`),
  ...["file.instances", "netapp.storagePools", "netapp.volumes", "lustre.instances"].flatMap((p) =>
    ["create", "get", "list", "delete"].map((op) => `${p}.${op}`),
  ),
] as const;
