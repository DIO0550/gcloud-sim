import type { CommandFailure } from "@/engine/cli/command-failure";
import {
  CommandContext,
  type CommandSpec,
  Flag,
  ParsedArgs,
  Positional,
  type ProjectContext,
} from "@/engine/cli/command-spec";
import { Candidates, projectCommand } from "@/engine/commands/shared";
import { ResourceName } from "@/engine/domains/compute";
import { enqueue } from "@/engine/domains/data-processing/pubsub";
import {
  type EventFilter,
  findDeployment,
  latestRevision,
  putDeployment,
  type ResourceId,
  sameId,
  type Trigger,
} from "@/engine/domains/serverless-lab/model";
import { attachAccount, deliverEvent, publishEvent } from "@/engine/domains/serverless-lab/runtime";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";
import { patchLab } from "./resources";
import { deploymentArg, finish, invalid, labCandidates, regionFlag } from "./shared";

const eventFilterArgs = (
  ctx: ProjectContext,
  args: ParsedArgs,
  id: ResourceId,
): Result<EventFilter, CommandFailure> => {
  const filters = ParsedArgs.keyvalue(args, "event-filters");
  if (
    Object.keys(filters).some((key) => !["type", "bucket", "database", "document"].includes(key))
  ) {
    return invalid("Unsupported Eventarc event filter.");
  }

  if (filters.type === "google.cloud.pubsub.topic.v1.messagePublished") {
    const raw = Option.unwrapOr(ParsedArgs.string(args, "transport-topic"), "");
    const prefix = `projects/${id.projectId}/topics/`;
    const source = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
    if (
      !ctx.world.pubsubTopics.some((t) => t.projectId === id.projectId && t.name === source) ||
      Object.keys(filters).length !== 1
    ) {
      return invalid(
        "Specify an existing same-project transport-topic and only the Pub/Sub type filter.",
      );
    }
    return Result.ok({ kind: "topic", source, eventType: filters.type, document: "" });
  }
  if (filters.type === "google.cloud.storage.object.v1.finalized") {
    if (
      !ctx.world.buckets.some((b) => b.projectId === id.projectId && b.name === filters.bucket) ||
      Object.keys(filters).length !== 2 ||
      ParsedArgs.string(args, "transport-topic").some
    ) {
      return invalid("Specify only type and an existing bucket filter.");
    }
    return Result.ok({
      kind: "storage",
      source: filters.bucket ?? "",
      eventType: filters.type,
      document: "",
    });
  }
  {
    const types = ["created", "updated", "deleted", "written"].map(
      (verb) => `google.cloud.firestore.document.v1.${verb}`,
    );
    if (
      Object.keys(filters).length !== 3 ||
      ParsedArgs.string(args, "transport-topic").some ||
      !types.includes(filters.type ?? "") ||
      !filters.database ||
      !filters.document ||
      !ctx.world.serverlessLab.databases.some(
        (d) =>
          d.projectId === id.projectId &&
          d.name === filters.database &&
          d.mode === "firestore-native",
      )
    ) {
      return invalid("Specify a Firestore Native database and type/document filter.");
    }
    return Result.ok({
      kind: "firestore",
      source: filters.database,
      eventType: filters.type ?? "",
      document: filters.document,
    });
  }
};

export const EventCommands: readonly CommandSpec[] = [
  projectCommand({
    path: ["gcloud", "eventarc", "triggers", "create"],
    summary: "Connect a supported source event to a Cloud Run lesson.",
    positionals: [Positional.required("NAME", "Trigger name.")],
    flags: [
      Flag.string("location", "Trigger region.", {
        required: true,
        candidates: Candidates.regions,
      }),
      Flag.string("destination-run-service", "Existing Cloud Run service.", {
        required: true,
        candidates: Candidates.runServices,
      }),
      Flag.string("service-account", "Trigger authentication SA.", {
        required: true,
        candidates: Candidates.serviceAccounts,
      }),
      Flag.keyvalue("event-filters", "type plus bucket or database/document filters."),
      Flag.string(
        "transport-topic",
        "Existing Pub/Sub topic (bare ID or same-project full name).",
        { candidates: Candidates.pubsubTopics },
      ),
    ],
    permission: "eventarc.triggers.create",
    requiredApis: ["eventarc.googleapis.com"],
    run: (ctx, args) => {
      const region = CommandContext.resolveRegion(ctx, ParsedArgs.string(args, "location"));
      if (!Result.isOk(region)) {
        return region;
      }
      const name = ParsedArgs.requiredPositional(args, 0);
      if (!Result.isOk(ResourceName.parse(name))) {
        return invalid("Invalid trigger name.");
      }
      const id = { projectId: ctx.project.projectId, region: region.value, name };
      if (ctx.world.serverlessLab.triggers.some((t) => sameId(t, id))) {
        return invalid("Trigger already exists.");
      }
      const target = ParsedArgs.requiredString(args, "destination-run-service");
      if (!findDeployment(ctx.world, { ...id, name: target }, "run")) {
        return invalid("Destination service must exist in the trigger region.");
      }
      const serviceAccount = ParsedArgs.requiredString(args, "service-account");
      const attached = attachAccount(ctx.world, id.projectId, ctx.principal, serviceAccount);
      if (!Result.isOk(attached)) {
        return invalid(attached.error);
      }
      const parsedFilter = eventFilterArgs(ctx, args, id);
      if (!Result.isOk(parsedFilter)) {
        return parsedFilter;
      }
      const filter = parsedFilter.value;
      const trigger: Trigger = { ...id, target, targetKind: "run", serviceAccount, filter };
      return finish(
        patchLab(ctx.world, { triggers: [...ctx.world.serverlessLab.triggers, trigger] }),
        { ...trigger },
      );
    },
  }),
  ...["list", "describe", "delete"].map((action) =>
    projectCommand({
      path: ["gcloud", "eventarc", "triggers", action],
      summary: `${action} Eventarc lesson triggers.`,
      positionals:
        action === "list"
          ? []
          : [Positional.required("NAME", "Trigger name.", labCandidates("triggers"))],
      flags: [Flag.string("location", "Trigger region.", { required: true })],
      permission: `eventarc.triggers.${action === "describe" ? "get" : action}`,
      requiredApis: ["eventarc.googleapis.com"],
      destructive: action === "delete",
      run: (ctx, args) => {
        const region = CommandContext.resolveRegion(ctx, ParsedArgs.string(args, "location"));
        if (!Result.isOk(region)) {
          return region;
        }
        const items = ctx.world.serverlessLab.triggers.filter(
          (t) => t.projectId === ctx.project.projectId && t.region === region.value,
        );
        if (action === "list") {
          return finish(ctx.world, { triggers: items });
        }
        const item = items.find((t) => t.name === ParsedArgs.requiredPositional(args, 0));
        if (!item) {
          return invalid("Trigger does not exist in this location.");
        }
        const world =
          action === "delete"
            ? patchLab(ctx.world, {
                triggers: ctx.world.serverlessLab.triggers.filter((t) => !sameId(t, item)),
              })
            : ctx.world;
        return finish(world, { ...item });
      },
    }),
  ),
  projectCommand({
    path: ["gcloud", "pubsub", "topics", "publish"],
    summary: "Publish a lesson message and deliver matching function/Eventarc events.",
    positionals: [Positional.required("TOPIC", "Existing topic.", Candidates.pubsubTopics)],
    flags: [Flag.string("message", "Lesson message.", { required: true })],
    permission: "pubsub.topics.publish",
    requiredApis: ["pubsub.googleapis.com"],
    run: (ctx, args) => {
      const source = ParsedArgs.requiredPositional(args, 0);
      if (
        !ctx.world.pubsubTopics.some(
          (t) => t.projectId === ctx.project.projectId && t.name === source,
        )
      ) {
        return invalid("Topic does not exist.");
      }
      const world = publishEvent(ctx.world, {
        projectId: ctx.project.projectId,
        kind: "topic",
        source,
        eventType: "google.cloud.pubsub.topic.v1.messagePublished",
        document: "",
      });
      const eventId = world.serverlessLab.events.at(-1)?.id ?? "";
      const queued = enqueue(
        world,
        ctx.project.projectId,
        source,
        ParsedArgs.requiredString(args, "message"),
        eventId,
      );
      if (!queued.ok) {
        return invalid(queued.error);
      }
      return finish(queued.value.world, {
        messageIds: [eventId],
        deliveries: world.serverlessLab.deliveries.filter((d) => d.eventId === eventId),
      });
    },
  }),
  projectCommand({
    path: ["sim", "events", "list"],
    summary: "Inspect retained lesson events and delivery attempts.",
    permission: "eventarc.triggers.get",
    run: (ctx) =>
      finish(ctx.world, {
        events: ctx.world.serverlessLab.events.filter((e) => e.projectId === ctx.project.projectId),
        deliveries: ctx.world.serverlessLab.deliveries.filter((d) =>
          d.target.startsWith(`${ctx.project.projectId}/`),
        ),
      }),
  }),
  ...["retry", "replay"].map((action) =>
    projectCommand({
      path: ["sim", "events", action],
      summary:
        action === "retry"
          ? "Retry pending deliveries after repairing their cause."
          : "Redeliver a retained event ID to inspect idempotency.",
      positionals: [Positional.required("EVENT_ID", "Retained event ID.")],
      permission: "eventarc.triggers.update",
      run: (ctx, args) => {
        const id = ParsedArgs.requiredPositional(args, 0);
        const event = ctx.world.serverlessLab.events.find(
          (e) => e.id === id && e.projectId === ctx.project.projectId,
        );
        if (!event) {
          return invalid("Event does not exist in this project.");
        }
        if (
          action === "retry" &&
          !ctx.world.serverlessLab.deliveries.some(
            (d) => d.eventId === id && d.status === "PENDING",
          )
        ) {
          return invalid("This event has no pending retry delivery.");
        }
        const world = deliverEvent(ctx.world, event, action as "retry" | "replay");
        return finish(world, {
          deliveries: world.serverlessLab.deliveries.filter((d) => d.eventId === id),
          eventId: id,
        });
      },
    }),
  ),
  projectCommand({
    path: ["sim", "serverless", "handler"],
    summary: "Choose whether the fixed lesson handler deduplicates repeated event IDs.",
    positionals: [
      Positional.required("NAME", "Function or service name.", labCandidates("deployments")),
    ],
    flags: [
      regionFlag,
      Flag.enum("kind", "Target kind.", ["run", "function"], { required: true }),
      Flag.boolean("idempotent", "Deduplicate successful event IDs."),
    ],
    permission: "eventarc.triggers.update",
    run: (ctx, args) => {
      const kind = ParsedArgs.requiredString(args, "kind") as "run" | "function";
      const found = deploymentArg(ctx, args, kind);
      if (!Result.isOk(found)) {
        return found;
      }
      const d = found.value;
      const idempotent = ParsedArgs.boolean(args, "idempotent");
      if (d.revisions.length >= 100) {
        return invalid("The revision history is full (100 revisions). Reset the simulator.");
      }
      const revision = {
        ...latestRevision(d),
        name: `${d.name}-${String(d.revisions.length + 1).padStart(5, "0")}-abc`,
        config: { ...latestRevision(d).config, idempotent },
      };
      return finish(
        putDeployment(ctx.world, {
          ...d,
          revisions: [...d.revisions, revision],
          traffic: { [revision.name]: 100 },
        }),
        {
          idempotent,
          simulation: "Fixed handler choice only; application code is not interpreted.",
        },
      );
    },
  }),
];
