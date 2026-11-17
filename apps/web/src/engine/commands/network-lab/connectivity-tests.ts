import { CommandFailure } from "@/engine/cli/command-failure";
import {
  type CandidateSource,
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
import { Candidates, projectCommand } from "@/engine/commands/shared";
import { ResourceName } from "@/engine/domains/compute";
import {
  type ConnectivityProtocol,
  type ConnectivitySpec,
  type ConnectivityTest,
  connectivityTestRecord,
  isIpAddress,
  runConnectivityTest,
} from "@/engine/domains/network-lab/connectivity-test";
import { patchNetwork } from "@/engine/domains/network-lab/model";
import type { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const Api = "networkmanagement.googleapis.com" as const;
const group = ["gcloud", "network-management", "connectivity-tests"];

const testsOf = (w: World, projectId: string): readonly ConnectivityTest[] =>
  w.networkLab.connectivityTests.filter((t) => t.projectId === projectId);

const testCandidates: CandidateSource = (w, p) =>
  p.some ? testsOf(w, p.value).map((t) => t.name) : [];

const findTest = (ctx: ProjectContext, name: string): Result<ConnectivityTest, CommandFailure> =>
  Option.toResult(
    Option.fromNullable(testsOf(ctx.world, ctx.project.projectId).find((t) => t.name === name)),
    () =>
      CommandFailure.notFound(
        `projects/${ctx.project.projectId}/locations/global/connectivityTests/${name}`,
      ),
  );

/** `projects/P/zones/Z/instances/NAME` を分ける（別プロジェクトの VM は扱わない）。 */
const parseInstance = (
  ctx: ProjectContext,
  flag: string,
  value: string,
): Result<Readonly<{ zone: string; name: string }>, CommandFailure> => {
  const match = /^projects\/([^/]+)\/zones\/([^/]+)\/instances\/([^/]+)$/.exec(value);
  if (match === null) {
    return Result.err(
      CommandFailure.invalidValue(
        `--${flag}`,
        `Expected a URI like projects/PROJECT/zones/ZONE/instances/INSTANCE: ${value}`,
      ),
    );
  }
  const [, project, zone, name] = match;
  if (project !== ctx.project.projectId) {
    return Result.err(
      CommandFailure.invalidValue(
        `--${flag}`,
        `gcloud-sim models connectivity tests inside project ${ctx.project.projectId} only.`,
      ),
    );
  }
  const exists = ctx.world.instances.some(
    (i) => i.projectId === project && i.zone === zone && i.name === name,
  );
  if (!exists) {
    return Result.err(CommandFailure.notFound(value));
  }
  return Result.ok({ zone: zone ?? "", name: name ?? "" });
};

const protocolOf = (args: ParsedArgs): ConnectivityProtocol =>
  Option.unwrapOr(ParsedArgs.string(args, "protocol"), "TCP") as ConnectivityProtocol;

const specOf = (
  ctx: ProjectContext,
  args: ParsedArgs,
): Result<ConnectivitySpec, CommandFailure> => {
  const name = ParsedArgs.requiredPositional(args, 0);
  if (!ResourceName.parse(name).ok) {
    return Result.err(CommandFailure.invalidValue("NAME", `Invalid test name: ${name}`));
  }
  const source = parseInstance(
    ctx,
    "source-instance",
    ParsedArgs.requiredString(args, "source-instance"),
  );
  if (!Result.isOk(source)) return source;
  const destinationInstance = ParsedArgs.string(args, "destination-instance");
  const destinationIp = ParsedArgs.string(args, "destination-ip-address");
  if (Option.isSome(destinationInstance) === Option.isSome(destinationIp)) {
    return Result.err(
      CommandFailure.mustBeSpecified("(--destination-instance | --destination-ip-address)"),
    );
  }
  const protocol = protocolOf(args);
  const port = Option.unwrapOr(ParsedArgs.integer(args, "destination-port"), 80);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return Result.err(
      CommandFailure.invalidValue("--destination-port", "Expected an integer from 1 to 65535."),
    );
  }
  const base = {
    projectId: ctx.project.projectId,
    name,
    sourceZone: source.value.zone,
    sourceInstance: source.value.name,
    protocol,
    port: protocol === "ICMP" ? 0 : port,
  };
  if (Option.isSome(destinationIp)) {
    if (!isIpAddress(destinationIp.value)) {
      return Result.err(
        CommandFailure.invalidValue(
          "--destination-ip-address",
          `Expected an IPv4 address: ${destinationIp.value}`,
        ),
      );
    }
    return Result.ok({
      ...base,
      destinationKind: "ip",
      destination: destinationIp.value,
      destinationZone: "",
    });
  }
  const destination = parseInstance(
    ctx,
    "destination-instance",
    Option.unwrapOr(destinationInstance, ""),
  );
  if (!Result.isOk(destination)) return destination;
  return Result.ok({
    ...base,
    destinationKind: "instance",
    destination: destination.value.name,
    destinationZone: destination.value.zone,
  });
};

const saved = (
  ctx: ProjectContext,
  test: ConnectivityTest,
  messages: readonly string[],
): CommandResult =>
  Result.ok({
    world: patchNetwork(ctx.world, {
      connectivityTests: [
        ...ctx.world.networkLab.connectivityTests.filter(
          (t) => !(t.projectId === test.projectId && t.name === test.name),
        ),
        test,
      ].slice(-100),
    }),
    output: CommandOutput.withTrailing(
      CommandOutput.yaml(connectivityTestRecord(test)),
      ...messages.map((m) => OutputMessage.plain(m)),
    ),
  });

const create = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const spec = specOf(ctx, args);
  if (!Result.isOk(spec)) return spec;
  if (Result.isOk(findTest(ctx, spec.value.name))) {
    return Result.err(
      CommandFailure.alreadyExists(
        `projects/${ctx.project.projectId}/locations/global/connectivityTests/${spec.value.name}`,
      ),
    );
  }
  const test = runConnectivityTest(ctx.world, spec.value, ctx.now);
  return saved(ctx, test, [`Created connectivity test [${test.name}].`]);
};

const rerun = (ctx: ProjectContext, args: ParsedArgs): CommandResult =>
  Result.flatMap(findTest(ctx, ParsedArgs.requiredPositional(args, 0)), (existing) =>
    saved(ctx, runConnectivityTest(ctx.world, existing, ctx.now), [
      `Reran connectivity test [${existing.name}].`,
    ]),
  );

const nameArg = Positional.required("TEST", "ID of the connectivity test.", testCandidates);

export const ConnectivityTestCommands: readonly CommandSpec[] = [
  projectCommand({
    path: [...group, "create"],
    summary: "Create a connectivity test (configuration analysis only; no packets are sent).",
    positionals: [Positional.required("TEST", "ID of the connectivity test.")],
    flags: [
      Flag.string(
        "source-instance",
        "The URI of the source VM: projects/PROJECT/zones/ZONE/instances/INSTANCE.",
        { required: true, candidates: Candidates.instances },
      ),
      Flag.string(
        "destination-instance",
        "The URI of the destination VM: projects/PROJECT/zones/ZONE/instances/INSTANCE.",
      ),
      Flag.string("destination-ip-address", "The IP address of the destination."),
      Flag.integer("destination-port", "The destination port (TCP/UDP only; default 80)."),
      Flag.enum("protocol", "The IP protocol of the test (default TCP).", ["TCP", "UDP", "ICMP"]),
    ],
    permission: "networkmanagement.connectivitytests.create",
    requiredApis: [Api],
    run: create,
  }),
  projectCommand({
    path: [...group, "describe"],
    summary: "Describe a connectivity test and its reachability result.",
    positionals: [nameArg],
    flags: [],
    permission: "networkmanagement.connectivitytests.get",
    requiredApis: [Api],
    run: (ctx, args) =>
      Result.map(findTest(ctx, ParsedArgs.requiredPositional(args, 0)), (test) => ({
        world: ctx.world,
        output: CommandOutput.yaml(connectivityTestRecord(test)),
      })),
  }),
  projectCommand({
    path: [...group, "list"],
    summary: "List connectivity tests.",
    flags: [],
    permission: "networkmanagement.connectivitytests.list",
    requiredApis: [Api],
    run: (ctx) =>
      Result.ok({
        world: ctx.world,
        output: CommandOutput.table(
          testsOf(ctx.world, ctx.project.projectId).map((t) => ({
            name: t.name,
            protocol: t.protocol,
            result: t.result,
            cause: t.cause,
          })),
          [
            Column.create("NAME", "name"),
            Column.create("PROTOCOL", "protocol"),
            Column.create("RESULT", "result"),
            Column.create("CAUSE", "cause"),
          ],
        ),
      }),
  }),
  projectCommand({
    path: [...group, "rerun"],
    summary: "Rerun a connectivity test against the current configuration.",
    positionals: [nameArg],
    flags: [],
    permission: "networkmanagement.connectivitytests.rerun",
    requiredApis: [Api],
    run: rerun,
  }),
  projectCommand({
    path: [...group, "delete"],
    summary: "Delete a connectivity test.",
    positionals: [nameArg],
    flags: [],
    destructive: true,
    permission: "networkmanagement.connectivitytests.delete",
    requiredApis: [Api],
    run: (ctx, args) =>
      Result.map(findTest(ctx, ParsedArgs.requiredPositional(args, 0)), (test) => ({
        world: patchNetwork(ctx.world, {
          connectivityTests: ctx.world.networkLab.connectivityTests.filter((t) => t !== test),
        }),
        output: CommandOutput.messages(
          OutputMessage.plain(`Deleted connectivity test [${test.name}].`),
        ),
      })),
  }),
];
