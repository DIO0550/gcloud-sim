import { CommandFailure } from "@/engine/cli/command-failure";
import {
  Column,
  CommandOutput,
  type CommandResult,
  type CommandSpec,
  Flag,
  OutputMessage,
  ParsedArgs,
  Positional,
  type ProjectContext,
} from "@/engine/cli/command-spec";
import { alreadyExists, describeNamedCommand, projectCommand } from "@/engine/commands/shared";
import { Region } from "@/engine/domains/catalog";
import { DmDeployment } from "@/engine/domains/deployment-manager";
import { DnsManagedZone } from "@/engine/domains/dns";
import { KmsKeyRing } from "@/engine/domains/kms";
import { validateNetworkLab } from "@/engine/domains/network-lab/model";
import { SampleFile } from "@/engine/domains/sample-files";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

/** Cloud KMS / Cloud DNS / Deployment Manager。それぞれ作成と一覧だけを持つ小さなサービス。 */

const KmsApi = "cloudkms.googleapis.com" as const;
const DnsApi = "dns.googleapis.com" as const;
const DmApi = "deploymentmanager.googleapis.com" as const;

const KeyRingColumns = [Column.create("NAME", "name")];
const ZoneColumns = [
  Column.create("NAME", "name"),
  Column.create("DNS_NAME", "dnsName"),
  Column.create("DESCRIPTION", "description"),
  Column.create("VISIBILITY", "visibility"),
];
const DeploymentColumns = [
  Column.create("NAME", "name"),
  Column.create("LAST_OPERATION_TYPE", "operation.operationType"),
  Column.create("STATUS", "operation.status"),
  Column.create("DESCRIPTION", "description"),
  Column.create("MANIFEST", "manifest"),
  Column.create("ERRORS", "errors"),
];

const createKeyRing = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const rawLocation = ParsedArgs.requiredString(args, "location");
  const location: Result<KmsKeyRing["location"], CommandFailure> =
    rawLocation === "global"
      ? Result.ok("global")
      : Option.toResult(Region.parse(rawLocation), () =>
          CommandFailure.notFound(`projects/${ctx.project.projectId}/locations/${rawLocation}`),
        );
  if (!Result.isOk(location)) return location;
  const ring = Result.mapErr(
    KmsKeyRing.create({
      projectId: ctx.project.projectId,
      name: ParsedArgs.requiredPositional(args, 0),
      location: location.value,
      createTime: ctx.now,
    }),
    (m) => CommandFailure.invalidValue("KEYRING", m),
  );
  if (!Result.isOk(ring)) return ring;
  const taken = World.namedOf(ctx.world, "kmsKeyRings", ctx.project.projectId).some(
    (r) => r.name === ring.value.name && r.location === ring.value.location,
  );
  if (taken) return Result.err(CommandFailure.alreadyExists(KmsKeyRing.fullName(ring.value)));
  return Result.ok({
    world: { ...ctx.world, kmsKeyRings: [...ctx.world.kmsKeyRings, ring.value] },
    output: CommandOutput.messages(OutputMessage.plain(`Created key ring [${ring.value.name}].`)),
  });
};

const createManagedZone = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const zone = Result.mapErr(
    DnsManagedZone.create({
      projectId: ctx.project.projectId,
      name: ParsedArgs.requiredPositional(args, 0),
      dnsName: ParsedArgs.requiredString(args, "dns-name"),
      description: ParsedArgs.requiredString(args, "description"),
      visibility:
        Option.unwrapOr(ParsedArgs.string(args, "visibility"), "public") === "private"
          ? "private"
          : "public",
      createTime: ctx.now,
    }),
    (m) => CommandFailure.invalidValue(m.includes("--dns-name") ? "--dns-name" : "ZONE_NAME", m),
  );
  if (!Result.isOk(zone)) return zone;
  const networks = ParsedArgs.list(args, "networks");
  if (zone.value.visibility === "private" && networks.length === 0) {
    return Result.err(
      CommandFailure.invalidArgumentWith("Private zones require --networks in this bounded model."),
    );
  }
  if (zone.value.visibility === "public" && networks.length > 0) {
    return Result.err(
      CommandFailure.invalidArgumentWith("Public zones cannot authorize private networks."),
    );
  }
  const configuredZone = { ...zone.value, ...(networks.length > 0 ? { networks } : {}) };
  const checked = validateNetworkLab({
    ...ctx.world,
    dnsZones: [...ctx.world.dnsZones, configuredZone],
  });
  if (!checked.ok) {
    return Result.err(CommandFailure.invalidArgumentWith(checked.error));
  }
  return Result.map(
    Result.mapErr(
      World.withNamed(
        ctx.world,
        "dnsZones",
        configuredZone,
        `projects/${ctx.project.projectId}/managedZones/${zone.value.name}`,
      ),
      alreadyExists,
    ),
    (world) => ({
      world,
      output: CommandOutput.messages(
        OutputMessage.plain(
          `Created [https://dns.googleapis.com/dns/v1/projects/${ctx.project.projectId}/managedZones/${zone.value.name}].`,
        ),
      ),
    }),
  );
};

const createDeployment = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const path = ParsedArgs.requiredString(args, "config");
  const sample = SampleFile.find(path);
  if (!Option.isSome(sample) || sample.value.kind !== "dm-config") {
    return Result.err(
      CommandFailure.notFoundWith(
        `Unable to read file [${path}]: [Errno 2] No such file or directory: '${path}'\ngcloud-sim: 使えるサンプルは config.yaml です（中身は docs/COMMANDS.md）。`,
      ),
    );
  }
  const deployment = Result.mapErr(
    DmDeployment.create({
      projectId: ctx.project.projectId,
      name: ParsedArgs.requiredPositional(args, 0),
      config: sample.value.name,
      resources: sample.value.resources.map((r) => ({ name: r.name, type: r.type })),
      insertTime: ctx.now,
    }),
    (m) => CommandFailure.invalidValue("DEPLOYMENT_NAME", m),
  );
  if (!Result.isOk(deployment)) return deployment;
  const d = deployment.value;
  return Result.map(
    Result.mapErr(
      World.withNamed(
        ctx.world,
        "dmDeployments",
        d,
        `projects/${ctx.project.projectId}/global/deployments/${d.name}`,
      ),
      alreadyExists,
    ),
    (world) => ({
      world,
      output: CommandOutput.withTrailing(
        CommandOutput.table(
          d.resources.map((r) => ({
            name: r.name,
            type: r.type,
            state: "COMPLETED",
            errors: "[]",
          })),
          [
            Column.create("NAME", "name"),
            Column.create("TYPE", "type"),
            Column.create("STATE", "state"),
            Column.create("ERRORS", "errors"),
          ],
          [
            OutputMessage.plain(
              `The fingerprint of the deployment is b'${(0x5d + ctx.world.sequence).toString(16)}=='`,
            ),
            OutputMessage.plain(
              `Waiting for create [operation-${Date.parse(ctx.now)}-${d.name}]...done.`,
            ),
            OutputMessage.plain(
              `Create operation operation-${Date.parse(ctx.now)}-${d.name} completed successfully.`,
            ),
          ],
        ),
        OutputMessage.hint(
          "gcloud-sim: Deployment Manager が作るリソースは記録するだけで、Compute Engine の VM としては作りません。",
        ),
      ),
    }),
  );
};

export const KmsCommands: readonly CommandSpec[] = [
  projectCommand({
    path: ["gcloud", "kms", "keyrings", "create"],
    summary: "Create a new keyring.",
    positionals: [Positional.required("KEYRING", "ID of the keyring to create.")],
    flags: [
      Flag.string("location", "Location of the keyring, e.g. asia-northeast1 or global.", {
        required: true,
      }),
    ],
    permission: "cloudkms.keyRings.create",
    requiredApis: [KmsApi],
    run: createKeyRing,
  }),
  projectCommand({
    path: ["gcloud", "kms", "keyrings", "list"],
    summary: "List keyrings within a location.",
    flags: [Flag.string("location", "Location of the keyrings.", { required: true })],
    permission: "cloudkms.keyRings.list",
    requiredApis: [KmsApi],
    run: (ctx, args) => {
      const location = ParsedArgs.requiredString(args, "location");
      return Result.ok({
        world: ctx.world,
        output: CommandOutput.table(
          World.namedOf(ctx.world, "kmsKeyRings", ctx.project.projectId)
            .filter((r) => r.location === location)
            .map(KmsKeyRing.toRecord),
          KeyRingColumns,
        ),
      });
    },
  }),
  describeNamedCommand({
    path: ["gcloud", "kms", "keyrings", "describe"],
    summary: "Get metadata for a keyring.",
    positional: { name: "KEYRING", description: "ID of the keyring." },
    flags: [Flag.string("location", "Location of the keyring.", { required: true })],
    locate: (_ctx, args) => Result.ok(ParsedArgs.requiredString(args, "location")),
    collection: "kmsKeyRings",
    permission: "cloudkms.keyRings.get",
    requiredApis: [KmsApi],
    resourcePath: (ref) =>
      `projects/${ref.projectId}/locations/${Option.unwrapOr(ref.location, "-")}/keyRings/${ref.name}`,
    record: KmsKeyRing.toRecord,
  }),
];

export const DnsCommands: readonly CommandSpec[] = [
  projectCommand({
    path: ["gcloud", "dns", "managed-zones", "create"],
    summary: "Create a Cloud DNS managed-zone.",
    positionals: [Positional.required("ZONE_NAME", "Name of the managed-zone to be created.")],
    flags: [
      Flag.string(
        "dns-name",
        "The DNS name suffix that will be managed with the created zone, e.g. example.com.",
        { required: true },
      ),
      Flag.string("description", "Short description for the managed-zone.", { required: true }),
      Flag.enum("visibility", "Visibility of the zone.", ["public", "private"]),
      Flag.list("networks", "Authorized VPC names in this project; required for private zones."),
    ],
    permission: "dns.managedZones.create",
    requiredApis: [DnsApi],
    run: createManagedZone,
  }),
  projectCommand({
    path: ["gcloud", "dns", "managed-zones", "list"],
    summary: "View the list of all your managed-zones.",
    permission: "dns.managedZones.list",
    requiredApis: [DnsApi],
    run: (ctx) =>
      Result.ok({
        world: ctx.world,
        output: CommandOutput.table(
          World.namedOf(ctx.world, "dnsZones", ctx.project.projectId).map(DnsManagedZone.toRecord),
          ZoneColumns,
        ),
      }),
  }),
  describeNamedCommand({
    path: ["gcloud", "dns", "managed-zones", "describe"],
    summary: "View the details of a Cloud DNS managed-zone.",
    positional: { name: "ZONE_NAME", description: "Name of the managed-zone." },
    collection: "dnsZones",
    permission: "dns.managedZones.get",
    requiredApis: [DnsApi],
    resourcePath: (ref) => `projects/${ref.projectId}/managedZones/${ref.name}`,
    record: DnsManagedZone.toRecord,
  }),
];

export const DeploymentManagerCommands: readonly CommandSpec[] = [
  projectCommand({
    path: ["gcloud", "deployment-manager", "deployments", "create"],
    summary: "Create a deployment (sample config.yaml only).",
    positionals: [Positional.required("DEPLOYMENT_NAME", "Deployment name.")],
    flags: [
      Flag.string("config", "Filename of config that specifies resources to deploy.", {
        required: true,
      }),
      Flag.boolean(
        "preview",
        "Preview the requested update without making any changes (accepted, not simulated).",
      ),
    ],
    permission: "deploymentmanager.deployments.create",
    requiredApis: [DmApi],
    run: createDeployment,
  }),
  projectCommand({
    path: ["gcloud", "deployment-manager", "deployments", "list"],
    summary: "List deployments in a project.",
    permission: "deploymentmanager.deployments.list",
    requiredApis: [DmApi],
    run: (ctx) =>
      Result.ok({
        world: ctx.world,
        output: CommandOutput.table(
          World.namedOf(ctx.world, "dmDeployments", ctx.project.projectId).map((d) => ({
            ...DmDeployment.toRecord(d),
            description: "",
            manifest: `manifest-${Date.parse(d.insertTime)}`,
            errors: "[]",
          })),
          DeploymentColumns,
        ),
      }),
  }),
  describeNamedCommand({
    path: ["gcloud", "deployment-manager", "deployments", "describe"],
    summary: "Provide information about a deployment.",
    positional: { name: "DEPLOYMENT_NAME", description: "Deployment name." },
    collection: "dmDeployments",
    permission: "deploymentmanager.deployments.get",
    requiredApis: [DmApi],
    resourcePath: (ref) => `projects/${ref.projectId}/global/deployments/${ref.name}`,
    record: DmDeployment.toRecord,
  }),
];
