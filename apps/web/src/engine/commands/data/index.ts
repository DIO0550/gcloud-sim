import { CommandFailure } from "@/engine/cli/command-failure";
import {
  Column,
  CommandContext,
  CommandOutput,
  type CommandResult,
  type CommandSpec,
  Flag,
  OutputMessage,
  ParsedArgs,
  Positional,
  type ProjectContext,
} from "@/engine/cli/command-spec";
import { alreadyExists, Candidates, CommonFlags, projectCommand } from "@/engine/commands/shared";
import {
  SqlDatabaseVersion,
  SqlDatabaseVersions,
  SqlTier,
  SqlTiers,
} from "@/engine/domains/catalog";
import { PubsubSubscription, PubsubTopic, SqlBackup, SqlInstance } from "@/engine/domains/data";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const SqlApi = "sqladmin.googleapis.com" as const;
const PubsubApi = "pubsub.googleapis.com" as const;

const SqlColumns = [
  Column.create("NAME", "name"),
  Column.create("DATABASE_VERSION", "databaseVersion"),
  Column.create("LOCATION", "gceZone"),
  Column.create("TIER", "settings.tier"),
  Column.create("PRIMARY_ADDRESS", "ipAddresses[0].ipAddress"),
  Column.create("PRIVATE_ADDRESS", "privateAddress"),
  Column.create("STATUS", "state"),
];
const BackupColumns = [
  Column.create("ID", "id"),
  Column.create("WINDOW_START_TIME", "windowStartTime"),
  Column.create("ERROR", "error"),
  Column.create("STATUS", "status"),
];
const TopicColumns = [Column.create("NAME", "name")];
const SubscriptionColumns = [
  Column.create("NAME", "name"),
  Column.create("TOPIC", "topic"),
  Column.create("TYPE", "type"),
];

const sqlInstanceArg = (ctx: ProjectContext, name: string): Result<SqlInstance, CommandFailure> =>
  Option.toResult(
    World.findNamed(ctx.world, "sqlInstances", { projectId: ctx.project.projectId, name }),
    () =>
      CommandFailure.notFoundWith(
        `HTTPError 404: The Cloud SQL instance does not exist. (instance: projects/${ctx.project.projectId}/instances/${name})`,
      ),
  );

const createSqlInstance = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const region = CommandContext.resolveRegion(ctx, ParsedArgs.string(args, "region"));
  if (!Result.isOk(region)) return region;
  const rawVersion = Option.unwrapOr(
    ParsedArgs.string(args, "database-version"),
    SqlDatabaseVersions.Mysql80,
  );
  const version = Option.toResult(SqlDatabaseVersion.parse(rawVersion), () =>
    CommandFailure.invalidChoice(
      "--database-version",
      rawVersion,
      Object.values(SqlDatabaseVersions),
    ),
  );
  if (!Result.isOk(version)) return version;
  const rawTier = Option.unwrapOr(ParsedArgs.string(args, "tier"), SqlTiers.F1Micro);
  const tier = Option.toResult(SqlTier.parse(rawTier), () =>
    CommandFailure.invalidChoice("--tier", rawTier, Object.values(SqlTiers)),
  );
  if (!Result.isOk(tier)) return tier;
  const numbered = World.nextNumber(ctx.world);
  const instance = Result.mapErr(
    SqlInstance.create({
      projectId: ctx.project.projectId,
      name: ParsedArgs.requiredPositional(args, 0),
      region: region.value,
      databaseVersion: version.value,
      tier: tier.value,
      ipAddress: `35.243.${(numbered.number >> 8) % 256}.${numbered.number % 256}`,
      createTime: ctx.now,
    }),
    (m) => CommandFailure.invalidValue("INSTANCE", m),
  );
  if (!Result.isOk(instance)) return instance;
  return Result.map(
    Result.mapErr(
      World.withNamed(
        numbered.world,
        "sqlInstances",
        instance.value,
        `projects/${ctx.project.projectId}/instances/${instance.value.name}`,
      ),
      alreadyExists,
    ),
    (world) => ({
      world,
      output: CommandOutput.table([SqlInstance.toRecord(instance.value)], SqlColumns, [
        OutputMessage.plain(
          `Creating Cloud SQL instance for ${instance.value.databaseVersion}...done.`,
        ),
        OutputMessage.plain(
          `Created [https://sqladmin.googleapis.com/sql/v1beta4/projects/${ctx.project.projectId}/instances/${instance.value.name}].`,
        ),
      ]),
    }),
  );
};

const createBackup = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const instance = sqlInstanceArg(ctx, Option.unwrapOr(ParsedArgs.string(args, "instance"), ""));
  if (!Result.isOk(instance)) return instance;
  const numbered = World.nextNumber(ctx.world);
  const backup = SqlBackup.create({
    projectId: ctx.project.projectId,
    instance: instance.value.name,
    description: Option.unwrapOr(ParsedArgs.string(args, "description"), ""),
    windowStartTime: ctx.now,
    sequence: numbered.number,
  });
  return Result.ok({
    world: World.withSqlBackup(numbered.world, backup),
    output: CommandOutput.messages(
      OutputMessage.plain(`Backing up Cloud SQL instance...done.`),
      OutputMessage.plain(
        `[https://sqladmin.googleapis.com/sql/v1beta4/projects/${ctx.project.projectId}/instances/${instance.value.name}/backupRuns/${backup.id}] backed up.`,
      ),
    ),
  });
};

const createTopic = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const topic = Result.mapErr(
    PubsubTopic.create({
      projectId: ctx.project.projectId,
      name: ParsedArgs.requiredPositional(args, 0),
      createTime: ctx.now,
    }),
    (m) => CommandFailure.invalidValue("TOPIC", m),
  );
  if (!Result.isOk(topic)) return topic;
  return Result.map(
    Result.mapErr(
      World.withNamed(ctx.world, "pubsubTopics", topic.value, PubsubTopic.fullName(topic.value)),
      alreadyExists,
    ),
    (world) => ({
      world,
      output: CommandOutput.messages(
        OutputMessage.plain(`Created topic [${PubsubTopic.fullName(topic.value)}].`),
      ),
    }),
  );
};

const createSubscription = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const topicName = Option.unwrapOr(ParsedArgs.string(args, "topic"), "");
  const topic = World.findNamed(ctx.world, "pubsubTopics", {
    projectId: ctx.project.projectId,
    name: topicName,
  });
  if (!Option.isSome(topic)) {
    return Result.err(
      CommandFailure.notFoundWith(`NOT_FOUND: Resource not found (resource=${topicName}).`),
    );
  }
  const subscription = Result.mapErr(
    PubsubSubscription.create({
      projectId: ctx.project.projectId,
      name: ParsedArgs.requiredPositional(args, 0),
      topic: topicName,
      ackDeadlineSeconds: ParsedArgs.integer(args, "ack-deadline"),
      pushEndpoint: ParsedArgs.string(args, "push-endpoint"),
      createTime: ctx.now,
    }),
    (m) => CommandFailure.invalidValue("SUBSCRIPTION", m),
  );
  if (!Result.isOk(subscription)) return subscription;
  return Result.map(
    Result.mapErr(
      World.withNamed(
        ctx.world,
        "pubsubSubscriptions",
        subscription.value,
        PubsubSubscription.fullName(subscription.value),
      ),
      alreadyExists,
    ),
    (world) => ({
      world,
      output: CommandOutput.messages(
        OutputMessage.plain(
          `Created subscription [${PubsubSubscription.fullName(subscription.value)}].`,
        ),
      ),
    }),
  );
};

export const SqlCommands: readonly CommandSpec[] = [
  projectCommand({
    path: ["gcloud", "sql", "instances", "create"],
    summary: "Create a new Cloud SQL instance.",
    positionals: [
      Positional.required("INSTANCE", "Cloud SQL instance ID.", Candidates.sqlInstances),
    ],
    flags: [
      Flag.enum(
        "database-version",
        "The database engine type and version (default MYSQL_8_0).",
        Object.values(SqlDatabaseVersions),
      ),
      Flag.enum(
        "tier",
        "Machine type for a shared-core instance (default db-f1-micro).",
        Object.values(SqlTiers),
      ),
      Flag.string("region", "Regional location, e.g. asia-northeast1. Overrides compute/region."),
      Flag.string("root-password", "Root Cloud SQL user's password (accepted, not stored)."),
      Flag.string(
        "storage-size",
        "Amount of storage allocated to the instance (accepted, not simulated).",
      ),
      Flag.enum("availability-type", "Availability type (accepted, always ZONAL).", [
        "zonal",
        "regional",
      ]),
    ],
    permission: "cloudsql.instances.create",
    requiredApis: [SqlApi],
    run: createSqlInstance,
  }),
  projectCommand({
    path: ["gcloud", "sql", "instances", "list"],
    summary: "List Cloud SQL instances in a given project.",
    permission: "cloudsql.instances.list",
    requiredApis: [SqlApi],
    run: (ctx) =>
      Result.ok({
        world: ctx.world,
        output: CommandOutput.table(
          World.namedOf(ctx.world, "sqlInstances", ctx.project.projectId).map((i) => ({
            ...SqlInstance.toRecord(i),
            privateAddress: "-",
          })),
          SqlColumns,
        ),
      }),
  }),
  projectCommand({
    path: ["gcloud", "sql", "instances", "describe"],
    summary: "Display configuration and metadata about a Cloud SQL instance.",
    positionals: [
      Positional.required("INSTANCE", "Cloud SQL instance ID.", Candidates.sqlInstances),
    ],
    permission: "cloudsql.instances.get",
    requiredApis: [SqlApi],
    run: (ctx, args) =>
      Result.map(sqlInstanceArg(ctx, ParsedArgs.requiredPositional(args, 0)), (instance) => ({
        world: ctx.world,
        output: CommandOutput.yaml(SqlInstance.toRecord(instance)),
      })),
  }),
  projectCommand({
    path: ["gcloud", "sql", "instances", "delete"],
    summary: "Delete a Cloud SQL instance.",
    positionals: [
      Positional.required("INSTANCE", "Cloud SQL instance ID.", Candidates.sqlInstances),
    ],
    destructive: true,
    permission: "cloudsql.instances.delete",
    requiredApis: [SqlApi],
    run: (ctx, args) =>
      Result.map(sqlInstanceArg(ctx, ParsedArgs.requiredPositional(args, 0)), (instance) => ({
        world: World.withoutSqlInstance(ctx.world, instance),
        output: CommandOutput.messages(
          OutputMessage.plain(
            `Deleted [https://sqladmin.googleapis.com/sql/v1beta4/projects/${ctx.project.projectId}/instances/${instance.name}].`,
          ),
        ),
      })),
  }),
  projectCommand({
    path: ["gcloud", "sql", "backups", "create"],
    summary: "Create a backup of a Cloud SQL instance.",
    flags: [
      Flag.string("instance", "Cloud SQL instance ID.", { required: true, aliases: ["-i"] }),
      Flag.string("description", "A friendly description of the backup."),
      CommonFlags.async,
    ],
    permission: "cloudsql.backupRuns.create",
    requiredApis: [SqlApi],
    run: createBackup,
  }),
  projectCommand({
    path: ["gcloud", "sql", "backups", "list"],
    summary: "List all backups associated with the instance.",
    flags: [Flag.string("instance", "Cloud SQL instance ID.", { required: true, aliases: ["-i"] })],
    permission: "cloudsql.instances.get",
    requiredApis: [SqlApi],
    run: (ctx, args) =>
      Result.map(
        sqlInstanceArg(ctx, Option.unwrapOr(ParsedArgs.string(args, "instance"), "")),
        (instance) => ({
          world: ctx.world,
          output: CommandOutput.table(
            World.sqlBackupsOf(ctx.world, ctx.project.projectId, instance.name).map((b) => ({
              ...SqlBackup.toRecord(b),
              error: "-",
            })),
            BackupColumns,
          ),
        }),
      ),
  }),
];

export const PubsubCommands: readonly CommandSpec[] = [
  projectCommand({
    path: ["gcloud", "pubsub", "topics", "create"],
    summary: "Create one or more Cloud Pub/Sub topics.",
    positionals: [Positional.required("TOPIC", "ID of the topic to create.")],
    permission: "pubsub.topics.create",
    requiredApis: [PubsubApi],
    run: createTopic,
  }),
  projectCommand({
    path: ["gcloud", "pubsub", "topics", "list"],
    summary: "List Cloud Pub/Sub topics.",
    permission: "pubsub.topics.list",
    requiredApis: [PubsubApi],
    run: (ctx) =>
      Result.ok({
        world: ctx.world,
        output: CommandOutput.table(
          World.namedOf(ctx.world, "pubsubTopics", ctx.project.projectId).map(PubsubTopic.toRecord),
          TopicColumns,
        ),
      }),
  }),
  projectCommand({
    path: ["gcloud", "pubsub", "subscriptions", "create"],
    summary: "Create one or more Cloud Pub/Sub subscriptions.",
    positionals: [Positional.required("SUBSCRIPTION", "ID of the subscription to create.")],
    flags: [
      Flag.string(
        "topic",
        "The name of the topic from which this subscription is receiving messages.",
        { required: true, candidates: Candidates.topics },
      ),
      Flag.integer(
        "ack-deadline",
        "The number of seconds the system will wait for a subscriber to acknowledge (default 10).",
      ),
      Flag.string(
        "push-endpoint",
        "A URL to use as the endpoint for this subscription (push delivery).",
      ),
    ],
    permission: "pubsub.subscriptions.create",
    requiredApis: [PubsubApi],
    run: createSubscription,
  }),
  projectCommand({
    path: ["gcloud", "pubsub", "subscriptions", "list"],
    summary: "List Cloud Pub/Sub subscriptions.",
    permission: "pubsub.topics.list",
    requiredApis: [PubsubApi],
    run: (ctx) =>
      Result.ok({
        world: ctx.world,
        output: CommandOutput.table(
          World.namedOf(ctx.world, "pubsubSubscriptions", ctx.project.projectId).map((s) => ({
            ...PubsubSubscription.toRecord(s),
            type: Option.isSome(s.pushEndpoint) ? "PUSH" : "PULL",
          })),
          SubscriptionColumns,
        ),
      }),
  }),
];
