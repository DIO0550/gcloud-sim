import { CommandOutput, Flag, ParsedArgs } from "@/engine/cli/command-spec";
import { EffectivePermissions } from "@/engine/domains/effective-permissions";
import { KubeLabels } from "@/engine/domains/kube-labels";
import { collectorStatus } from "@/engine/domains/observability-lab/collectors";
import { type Collector, ObserveCpuMetric } from "@/engine/domains/observability-lab/model";
import { Principal } from "@/engine/domains/principal";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";
import { command, finish, invalid, missing, name, same, save, sf, text } from "./shared";

export const ObserveCollectorCommands = [
  command({
    path: ["sim", "monitoring", "collectors", "configure"],
    permissions: ["monitoring.metricDescriptors.create"],
    named: true,
    flags: [
      Flag.enum("kind", "Bounded collector model.", ["ops-agent", "managed-prometheus"], {
        required: true,
      }),
      sf("resource", true),
      sf("location", true),
      sf("service-account", true),
      Flag.boolean("enabled", "Enable collection."),
      sf("namespace"),
      Flag.keyvalue("selector", "Pod labels."),
      Flag.integer("port", "Fixed teaching endpoint, 8080."),
    ],
    run: (ctx, args) => {
      const projectId = ctx.project.projectId;
      const kind = text(args, "kind") as Collector["kind"];
      const resource = text(args, "resource");
      const location = text(args, "location");
      const serviceAccount = text(args, "service-account");
      const account = ctx.world.serviceAccounts.find(
        (s) => s.projectId === projectId && s.email === serviceAccount,
      );
      const caller = EffectivePermissions.resolve(ctx.world, Principal.toMember(ctx.principal), {
        type: "service-account",
        id: serviceAccount,
      }).permissions;
      if (!account || !caller.has("iam.serviceAccounts.actAs")) {
        return invalid(
          "Configure with an existing same-project service account and caller actAs permission.",
        );
      }
      const vm = ctx.world.instances.find(
        (i) => i.projectId === projectId && i.name === resource && i.zone === location,
      );
      const cluster = ctx.world.clusters.find(
        (c) => c.projectId === projectId && c.name === resource && c.location === location,
      );
      if (kind === "ops-agent" && (!vm || vm.serviceAccount !== serviceAccount)) {
        return invalid("Ops Agent requires this VM's attached service account and exact zone.");
      }
      if (
        kind === "managed-prometheus" &&
        (!cluster || cluster.nodeServiceAccount !== serviceAccount)
      ) {
        return invalid(
          "Managed collection needs a same-location cluster and its explicit node identity.",
        );
      }
      let selector: Readonly<Record<string, string>> = {};
      if (kind === "managed-prometheus") {
        const parsed = KubeLabels.parse(ParsedArgs.keyvalue(args, "selector"), true);
        if (!parsed.ok) {
          return invalid(parsed.error);
        }
        selector = parsed.value;
      }
      if (
        kind === "ops-agent" &&
        ["namespace", "selector", "port"].some((f) => ParsedArgs.has(args, f))
      ) {
        return invalid("PodMonitoring flags are only supported for managed-prometheus.");
      }
      const item: Collector = {
        projectId,
        name: name(args),
        kind,
        resource,
        location,
        serviceAccount,
        enabled: Option.unwrapOr(ParsedArgs.booleanChoice(args, "enabled"), true),
        namespace: text(args, "namespace", "default"),
        selector,
        port: Option.unwrapOr(ParsedArgs.integer(args, "port"), 8080),
      };
      if (item.port !== 8080) {
        return invalid(
          "The managed metrics fixture exposes only port 8080; arbitrary endpoints are unsupported.",
        );
      }
      const world = {
        ...ctx.world,
        observabilityLab: {
          ...ctx.world.observabilityLab,
          collectors: [
            ...ctx.world.observabilityLab.collectors.filter((c) => !same(c, item)),
            item,
          ],
        },
      };
      return save(
        world,
        {},
        {
          ...item,
          selector: { ...selector },
          status: collectorStatus(world, item),
          installedSoftware: false,
        },
      );
    },
  }),
  ...(["describe", "delete", "collect"] as const).map((action) =>
    command({
      path: ["sim", "monitoring", "collectors", action],
      permissions: [
        action === "delete"
          ? "monitoring.metricDescriptors.delete"
          : "monitoring.metricDescriptors.get",
        ...(action === "collect" ? ["monitoring.timeSeries.create"] : []),
      ],
      named: true,
      destructive: action === "delete",
      run: (ctx, args) => {
        const collector = ctx.world.observabilityLab.collectors.find(
          (c) => c.projectId === ctx.project.projectId && c.name === name(args),
        );
        if (!collector) {
          return missing("Collector configuration not found in this project.");
        }
        if (action === "delete") {
          return save(
            ctx.world,
            { collectors: ctx.world.observabilityLab.collectors.filter((c) => c !== collector) },
            { deleted: collector.name, historyPreserved: true },
          );
        }
        const status = collectorStatus(ctx.world, collector);
        if (action === "describe") {
          return finish(ctx.world, {
            ...collector,
            selector: { ...collector.selector },
            status,
            installedSoftware: false,
          });
        }
        if (status !== "READY") {
          return invalid(`Collector is not ready: ${status}.`);
        }
        const metric =
          collector.kind === "ops-agent"
            ? ObserveCpuMetric
            : "custom.googleapis.com/ace/prometheus_requests";
        const resourceType = collector.kind === "ops-agent" ? "gce_instance" : "generic_task";
        const lab = ctx.world.observabilityLab;
        if (
          lab.points.some(
            (p) =>
              p.projectId === collector.projectId &&
              p.resource === collector.resource &&
              p.metric === metric &&
              p.time === lab.clock,
          )
        ) {
          return invalid("Advance virtual time before collecting another fixture sample.");
        }
        const descriptors = [...lab.descriptors];
        if (
          collector.kind === "managed-prometheus" &&
          !descriptors.some((d) => d.projectId === collector.projectId && d.type === metric)
        ) {
          descriptors.push({
            projectId: collector.projectId,
            name: "prometheus_requests",
            type: metric,
            resourceType: "generic_task",
            unit: "1",
          });
        }
        const point = {
          projectId: collector.projectId,
          name: `collector-${collector.name}-${lab.clock}`,
          resource: collector.resource,
          resourceType,
          metric,
          value: collector.kind === "ops-agent" ? 0.9 : 10,
          time: lab.clock,
        };
        return save(
          ctx.world,
          { descriptors, points: [...lab.points, point] },
          {
            ...point,
            simulated: true,
            measured: false,
            message:
              "Fixed teaching sample; no process, agent install, Prometheus scrape or network request.",
          },
        );
      },
    }),
  ),
  command({
    path: ["sim", "monitoring", "collectors", "list"],
    permissions: ["monitoring.metricDescriptors.list"],
    run: (ctx) =>
      Result.ok({
        world: ctx.world,
        output: CommandOutput.yamlList(
          ctx.world.observabilityLab.collectors
            .filter((c) => c.projectId === ctx.project.projectId)
            .map((c) => ({
              ...c,
              selector: { ...c.selector },
              status: collectorStatus(ctx.world, c),
            })),
        ),
      }),
  }),
];
