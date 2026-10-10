import { Flag } from "@/engine/cli/command-spec";
import { Candidates } from "@/engine/commands/shared";
import { ResourceName } from "@/engine/domains/compute";
import { patch } from "@/engine/domains/data-processing/model";
import { apiEnabled } from "@/engine/domains/serverless-lab/runtime";
import {
  candidates,
  command,
  finish,
  integer,
  invalid,
  name,
  observed,
  regionFlag,
  sf,
  text,
  validRegion,
} from "./shared";

export const Workloads = {
  "warehouse-sql": "bigquery",
  "stream-transform": "dataflow",
  "spark-batch": "dataproc",
  "async-events": "pubsub",
  "kafka-protocol": "kafka",
} as const;
export const KafkaCommands = [
  ...(["create", "list", "describe", "delete"] as const).map((action) =>
    command(
      ["gcloud", "managed-kafka", "clusters", action],
      "managedkafka.googleapis.com",
      `managedkafka.clusters.${action === "describe" ? "get" : action}`,
      (ctx, a) => {
        const region = text(a, "region");
        if (!validRegion(region)) {
          return invalid("Invalid region.");
        }
        const items = ctx.world.dataProcessing.kafkaClusters.filter(
          (c) => c.projectId === ctx.project.projectId && c.region === region,
        );
        if (action === "list") {
          return finish(ctx.world, { clusters: items });
        }
        const item = items.find((c) => c.name === name(a));
        if (action === "create") {
          const subnet = ctx.world.subnets.find(
            (s) =>
              s.projectId === ctx.project.projectId &&
              s.region === region &&
              s.name === text(a, "subnet"),
          );
          const vcpu = integer(a, "cpu", 3);
          const memory = integer(a, "memory", 3221225472);
          if (
            item ||
            !ResourceName.parse(name(a)).ok ||
            !subnet ||
            !apiEnabled(ctx.world, ctx.project.projectId, "compute.googleapis.com") ||
            vcpu < 3 ||
            vcpu > 24 ||
            memory < vcpu * 1073741824 ||
            memory > vcpu * 4294967296
          ) {
            return invalid("Invalid Kafka cluster, subnet, capacity or Compute API.");
          }
          const cluster = {
            projectId: ctx.project.projectId,
            name: name(a),
            region,
            subnet: subnet.name,
            vcpu,
            memory,
          };
          return finish(
            patch(ctx.world, {
              kafkaClusters: [...ctx.world.dataProcessing.kafkaClusters, cluster],
            }),
            cluster,
          );
        }
        if (!item) {
          return invalid("Kafka cluster does not exist in this project/region.");
        }
        if (action === "delete") {
          if (
            ctx.world.dataProcessing.kafkaTopics.some(
              (t) =>
                t.projectId === item.projectId && t.region === region && t.cluster === item.name,
            )
          ) {
            return invalid("Delete Kafka topics first.");
          }
          return finish(
            patch(ctx.world, {
              kafkaClusters: ctx.world.dataProcessing.kafkaClusters.filter((c) => c !== item),
            }),
            { deleted: item.name },
          );
        }
        return finish(ctx.world, { ...item });
      },
      [
        regionFlag,
        ...(action === "create"
          ? [
              sf("subnet", true, Candidates.subnets),
              Flag.integer("cpu", "3..24 vCPU."),
              Flag.integer("memory", "Bytes; 1..4 GiB/vCPU."),
            ]
          : []),
      ],
      action !== "list",
      candidates("kafkaClusters"),
      action === "delete",
    ),
  ),
  ...(["create", "list", "describe", "delete"] as const).map((action) =>
    command(
      ["gcloud", "managed-kafka", "topics", action],
      "managedkafka.googleapis.com",
      `managedkafka.topics.${action === "describe" ? "get" : action}`,
      (ctx, a) => {
        const region = text(a, "region");
        const cluster = ctx.world.dataProcessing.kafkaClusters.find(
          (c) =>
            c.projectId === ctx.project.projectId &&
            c.region === region &&
            c.name === text(a, "cluster"),
        );
        if (!cluster) {
          return invalid("Kafka cluster does not exist in this project/region.");
        }
        const items = ctx.world.dataProcessing.kafkaTopics.filter(
          (t) =>
            t.projectId === cluster.projectId && t.region === region && t.cluster === cluster.name,
        );
        if (action === "list") {
          return finish(ctx.world, { topics: items });
        }
        const item = items.find((t) => t.name === name(a));
        if (action === "create") {
          const partitions = integer(a, "partitions", 1);
          const replication = integer(a, "replication-factor", 3);
          if (
            item ||
            !ResourceName.parse(name(a)).ok ||
            partitions < 1 ||
            partitions > 100 ||
            replication !== 3
          ) {
            return invalid("Invalid topic (1..100 partitions, replication factor 3).");
          }
          const topic = {
            projectId: cluster.projectId,
            name: name(a),
            region,
            cluster: cluster.name,
            partitions,
            replication,
          };
          return finish(
            patch(ctx.world, { kafkaTopics: [...ctx.world.dataProcessing.kafkaTopics, topic] }),
            topic,
          );
        }
        if (!item) {
          return invalid("Topic does not exist in the cluster.");
        }
        if (action === "delete") {
          return finish(
            patch(ctx.world, {
              kafkaTopics: ctx.world.dataProcessing.kafkaTopics.filter((t) => t !== item),
            }),
            { deleted: item.name },
          );
        }
        return finish(ctx.world, { ...item });
      },
      [
        regionFlag,
        sf("cluster", true, candidates("kafkaClusters")),
        ...(action === "create"
          ? [
              Flag.integer("partitions", "1..100 partitions."),
              Flag.integer("replication-factor", "Replication factor 3."),
            ]
          : []),
      ],
      action !== "list",
      candidates("kafkaTopics"),
      action === "delete",
    ),
  ),
  command(
    ["sim", "kafka", "connect"],
    "managedkafka.googleapis.com",
    "managedkafka.clusters.connect",
    (ctx, a) => {
      const cluster = ctx.world.dataProcessing.kafkaClusters.find(
        (c) =>
          c.projectId === ctx.project.projectId &&
          c.region === text(a, "region") &&
          c.name === name(a),
      );
      const subnet = ctx.world.subnets.find(
        (s) =>
          s.projectId === ctx.project.projectId &&
          s.region === cluster?.region &&
          s.name === cluster?.subnet,
      );
      if (
        !cluster ||
        !subnet ||
        subnet.network !== text(a, "network") ||
        text(a, "auth") !== "SASL_IAM" ||
        !apiEnabled(ctx.world, ctx.project.projectId, "compute.googleapis.com")
      ) {
        return invalid("Private connection requires the cluster VPC, Compute API and SASL_IAM.");
      }
      return observed(ctx.world, ctx, cluster.name, "kafka-connect", {
        network: subnet.network,
        auth: "SASL_IAM",
        tls: true,
        connected: true,
      });
    },
    [regionFlag, sf("network", true, Candidates.networks), sf("auth", true, () => ["SASL_IAM"])],
    true,
    candidates("kafkaClusters"),
  ),
  command(
    ["sim", "data-services", "choose"],
    "bigquery.googleapis.com",
    "bigquery.datasets.get",
    (ctx, a) => {
      const workload = name(a);
      if (
        !Object.hasOwn(Workloads, workload) ||
        !["bigquery", "dataflow", "dataproc", "pubsub", "kafka"].includes(text(a, "service"))
      ) {
        return invalid("Unsupported workload/service.");
      }
      return observed(ctx.world, ctx, workload, "data-choice", {
        service: text(a, "service"),
        appropriate: Workloads[workload as keyof typeof Workloads] === text(a, "service"),
      });
    },
    [sf("service", true, () => Object.values(Workloads))],
    true,
    () => Object.keys(Workloads),
  ),
];
