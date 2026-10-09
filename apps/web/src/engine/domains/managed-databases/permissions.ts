export const FirestorePermissions = [
  ...["datastore.indexes", "datastore.backups"].flatMap((kind) =>
    ["create", "get", "list", "delete"].map((verb) => `${kind}.${verb}`),
  ),
  "datastore.entities.list",
];
export const SpannerPermissions = [
  ...["spanner.instances", "spanner.databases", "spanner.backups"].flatMap((kind) =>
    ["create", "get", "list", "delete", "update"].map((verb) => `${kind}.${verb}`),
  ),
  "spanner.databases.read",
  "spanner.databases.write",
  "spanner.databases.updateDdl",
];
export const BigtablePermissions = [
  ...["bigtable.instances", "bigtable.clusters", "bigtable.tables", "bigtable.backups"].flatMap(
    (kind) => ["create", "get", "list", "delete", "update"].map((verb) => `${kind}.${verb}`),
  ),
  "bigtable.tables.readRows",
  "bigtable.tables.mutateRows",
];
export const ManagedDatabasePermissions = [
  ...FirestorePermissions,
  ...SpannerPermissions,
  ...BigtablePermissions,
];
