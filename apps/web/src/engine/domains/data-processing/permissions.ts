export const BigQueryPermissions = [
  "bigquery.datasets.create",
  "bigquery.datasets.get",
  "bigquery.datasets.delete",
  "bigquery.tables.create",
  "bigquery.tables.get",
  "bigquery.tables.list",
  "bigquery.tables.delete",
  "bigquery.tables.getData",
  "bigquery.tables.updateData",
  "bigquery.jobs.create",
  "bigquery.jobs.get",
  "bigquery.jobs.list",
] as const;
export const PubsubDataPermissions = [
  "pubsub.subscriptions.list",
  "pubsub.subscriptions.update",
  "pubsub.subscriptions.delete",
  "pubsub.subscriptions.consume",
  "pubsub.topics.delete",
] as const;
export const DataflowPermissions = [
  "dataflow.jobs.create",
  "dataflow.jobs.get",
  "dataflow.jobs.list",
  "dataflow.jobs.update",
  "dataflow.jobs.cancel",
] as const;
export const DataprocPermissions = [
  "dataproc.clusters.create",
  "dataproc.clusters.get",
  "dataproc.clusters.list",
  "dataproc.clusters.update",
  "dataproc.clusters.delete",
  "dataproc.jobs.create",
  "dataproc.jobs.get",
  "dataproc.jobs.list",
  "dataproc.jobs.update",
  "dataproc.jobs.cancel",
] as const;
export const KafkaPermissions = [
  "managedkafka.clusters.create",
  "managedkafka.clusters.get",
  "managedkafka.clusters.list",
  "managedkafka.clusters.delete",
  "managedkafka.clusters.connect",
  "managedkafka.topics.create",
  "managedkafka.topics.get",
  "managedkafka.topics.list",
  "managedkafka.topics.delete",
] as const;
export const DataProcessingPermissions = [
  ...BigQueryPermissions,
  ...PubsubDataPermissions,
  ...DataflowPermissions,
  ...DataprocPermissions,
  ...KafkaPermissions,
] as const;
