import { CommandFailure } from "@/engine/cli/command-failure";
import {
  Column,
  CommandContext,
  type CommandResult,
  type CommandSpec,
  Flag,
  ParsedArgs,
  Positional,
  type ProjectContext,
} from "@/engine/cli/command-spec";
import {
  ComputeApi,
  createdTable,
  invalidName,
  listCommand,
} from "@/engine/commands/compute/shared";
import {
  alreadyExists,
  Candidates,
  CommonFlags,
  describeNamedCommand,
  type NamedRef,
  projectCommand,
} from "@/engine/commands/shared";
import {
  BackendProtocols,
  BackendService,
  ForwardingRule,
  HealthCheck,
  HealthCheckProtocols,
  LbScope,
  LoadBalancingSchemes,
} from "@/engine/domains/load-balancing";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const HealthCheckColumns = [Column.create("NAME", "name"), Column.create("PROTOCOL", "type")];
const BackendServiceColumns = [
  Column.create("NAME", "name"),
  Column.create("BACKENDS", "backends", "join"),
  Column.create("PROTOCOL", "protocol"),
];
const ForwardingRuleColumns = [
  Column.create("NAME", "name"),
  Column.create("REGION", "region", "basename"),
  Column.create("IP_ADDRESS", "IPAddress"),
  Column.create("IP_PROTOCOL", "IPProtocol"),
  Column.create("TARGET", "target", "basename"),
];

/** `--global` か `--region`。どちらも無ければ `compute/region`、それも無ければ E-004。 */
const resolveScope = (ctx: ProjectContext, args: ParsedArgs): Result<LbScope, CommandFailure> =>
  ParsedArgs.boolean(args, "global")
    ? Result.ok(LbScope.Global)
    : Result.map(
        CommandContext.resolveRegion(ctx, ParsedArgs.string(args, "region")),
        LbScope.region,
      );

const createHealthCheck = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const protocol = Option.unwrapOr(
    Option.fromNullable(
      Object.values(HealthCheckProtocols).find((p) => ParsedArgs.boolean(args, p.toLowerCase())),
    ),
    HealthCheckProtocols.Tcp,
  );
  const check = Result.mapErr(
    HealthCheck.create({
      projectId: ctx.project.projectId,
      name: ParsedArgs.requiredPositional(args, 0),
      protocol,
      port: ParsedArgs.integer(args, "port"),
    }),
    invalidName,
  );
  if (!Result.isOk(check)) return check;
  return Result.map(
    Result.mapErr(
      World.withNamed(ctx.world, "healthChecks", check.value, HealthCheck.selfLink(check.value)),
      alreadyExists,
    ),
    (world) => ({
      world,
      output: createdTable(
        HealthCheck.selfLink(check.value),
        HealthCheck.toRecord(check.value),
        HealthCheckColumns,
      ),
    }),
  );
};

const createBackendService = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const scope = resolveScope(ctx, args);
  if (!Result.isOk(scope)) return scope;
  const checks = ParsedArgs.list(args, "health-checks");
  const missing = checks.find(
    (name) =>
      !Option.isSome(
        World.findNamed(ctx.world, "healthChecks", { projectId: ctx.project.projectId, name }),
      ),
  );
  if (missing !== undefined) {
    return Result.err(
      CommandFailure.notFound(`projects/${ctx.project.projectId}/global/healthChecks/${missing}`),
    );
  }
  const rawProtocol = Option.unwrapOr(ParsedArgs.string(args, "protocol"), BackendProtocols.Http);
  const protocol = Object.values(BackendProtocols).find((p) => p === rawProtocol);
  const rawScheme = Option.unwrapOr(
    ParsedArgs.string(args, "load-balancing-scheme"),
    LoadBalancingSchemes.External,
  );
  const scheme = Object.values(LoadBalancingSchemes).find((s) => s === rawScheme);
  if (protocol === undefined || scheme === undefined) {
    return Result.err(CommandFailure.invalidValue("--protocol", `Invalid value: ${rawProtocol}`));
  }
  const service = Result.mapErr(
    BackendService.create({
      projectId: ctx.project.projectId,
      name: ParsedArgs.requiredPositional(args, 0),
      scope: scope.value,
      protocol,
      loadBalancingScheme: scheme,
      healthChecks: checks,
    }),
    invalidName,
  );
  if (!Result.isOk(service)) return service;
  return Result.map(
    Result.mapErr(
      World.withNamed(
        ctx.world,
        "backendServices",
        service.value,
        BackendService.selfLink(service.value),
      ),
      alreadyExists,
    ),
    (world) => ({
      world,
      output: createdTable(
        BackendService.selfLink(service.value),
        BackendService.toRecord(service.value),
        BackendServiceColumns,
      ),
    }),
  );
};

const createForwardingRule = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const scope = resolveScope(ctx, args);
  if (!Result.isOk(scope)) return scope;
  const backendName = ParsedArgs.requiredString(args, "backend-service");
  const backend = Option.filter(
    World.findNamed(ctx.world, "backendServices", {
      projectId: ctx.project.projectId,
      name: backendName,
    }),
    (b) => LbScope.equals(b.scope, scope.value),
  );
  if (!Option.isSome(backend)) {
    return Result.err(
      CommandFailure.notFound(
        `projects/${ctx.project.projectId}/${LbScope.toPath(scope.value)}/backendServices/${backendName}`,
      ),
    );
  }
  const addressName = ParsedArgs.string(args, "address");
  const reserved = Option.flatMap(addressName, (name) =>
    World.findNamed(ctx.world, "addresses", { projectId: ctx.project.projectId, name }),
  );
  if (Option.isSome(addressName) && !Option.isSome(reserved)) {
    return Result.err(
      CommandFailure.notFound(
        `projects/${ctx.project.projectId}/${LbScope.toPath(scope.value)}/addresses/${addressName.value}`,
      ),
    );
  }
  const rawScheme = Option.unwrapOr(
    ParsedArgs.string(args, "load-balancing-scheme"),
    backend.value.loadBalancingScheme,
  );
  const scheme = Object.values(LoadBalancingSchemes).find((s) => s === rawScheme);
  if (scheme === undefined) {
    return Result.err(
      CommandFailure.invalidValue("--load-balancing-scheme", `Invalid value: ${rawScheme}`),
    );
  }
  const numbered = World.nextNumber(ctx.world);
  const rule = Result.mapErr(
    ForwardingRule.create({
      projectId: ctx.project.projectId,
      name: ParsedArgs.requiredPositional(args, 0),
      scope: scope.value,
      ipAddress: Option.unwrapOr(
        Option.map(reserved, (a) => a.address),
        `34.110.${(numbered.number >> 8) % 256}.${numbered.number % 256}`,
      ),
      ipProtocol: backend.value.protocol === BackendProtocols.Udp ? "UDP" : "TCP",
      portRange: Option.unwrapOr(ParsedArgs.string(args, "ports"), "80"),
      loadBalancingScheme: scheme,
      backendService: backend.value.name,
      creationTimestamp: ctx.now,
    }),
    invalidName,
  );
  if (!Result.isOk(rule)) return rule;
  const withAddressInUse = Option.isSome(reserved)
    ? World.replaceNamed(numbered.world, "addresses", { ...reserved.value, status: "IN_USE" })
    : numbered.world;
  return Result.map(
    Result.mapErr(
      World.withNamed(
        withAddressInUse,
        "forwardingRules",
        rule.value,
        ForwardingRule.selfLink(rule.value),
      ),
      alreadyExists,
    ),
    (world) => ({
      world,
      output: createdTable(
        ForwardingRule.selfLink(rule.value),
        ForwardingRule.toRecord(rule.value),
        ForwardingRuleColumns,
      ),
    }),
  );
};

/** `describe` が引く置き場（`global` / `regions/R`）。 */
const scopePath = (ctx: ProjectContext, args: ParsedArgs): Result<string, CommandFailure> =>
  Result.map(resolveScope(ctx, args), LbScope.toPath);

/** E-005 の綴り。置き場は `scopePath` が解決した `global` / `regions/R`。 */
const locatedPath = (ref: NamedRef, kind: "backendServices" | "forwardingRules"): string =>
  `projects/${ref.projectId}/${Option.unwrapOr(ref.location, "-")}/${kind}/${ref.name}`;

const ScopeFlags = [
  Flag.boolean("global", "If provided, the resource is global."),
  CommonFlags.region,
];

export const LoadBalancingCommands: readonly CommandSpec[] = [
  projectCommand({
    path: ["gcloud", "compute", "health-checks", "create"],
    summary: "Create a health check (TCP by default; pass --http or --https for the protocol).",
    positionals: [Positional.required("NAME", "Name of the health check to create.")],
    flags: [
      Flag.boolean("tcp", "Create a TCP health check."),
      Flag.boolean("http", "Create an HTTP health check."),
      Flag.boolean("https", "Create an HTTPS health check."),
      Flag.integer("port", "The TCP port number the health check uses."),
      Flag.boolean("global", "If provided, the health check is global (default)."),
    ],
    permission: "compute.healthChecks.create",
    requiredApis: [ComputeApi],
    run: createHealthCheck,
  }),
  listCommand({
    path: ["gcloud", "compute", "health-checks", "list"],
    summary: "List health checks.",
    permission: "compute.healthChecks.list",
    columns: HealthCheckColumns,
    records: (ctx) =>
      World.namedOf(ctx.world, "healthChecks", ctx.project.projectId).map(HealthCheck.toRecord),
  }),
  describeNamedCommand({
    path: ["gcloud", "compute", "health-checks", "describe"],
    summary: "Display detailed information about a health check.",
    positional: { name: "NAME", description: "Name of the health check." },
    flags: [Flag.boolean("global", "If provided, the health check is global (default).")],
    collection: "healthChecks",
    permission: "compute.healthChecks.get",
    requiredApis: [ComputeApi],
    resourcePath: (ref) => `projects/${ref.projectId}/global/healthChecks/${ref.name}`,
    record: HealthCheck.toRecord,
  }),
  projectCommand({
    path: ["gcloud", "compute", "backend-services", "create"],
    summary: "Create a backend service.",
    positionals: [Positional.required("NAME", "Name of the backend service to create.")],
    flags: [
      ...ScopeFlags,
      Flag.enum("protocol", "The protocol for incoming requests.", Object.values(BackendProtocols)),
      Flag.list("health-checks", "The names of health checks to use."),
      Flag.enum(
        "load-balancing-scheme",
        "Specifies the load balancer type.",
        Object.values(LoadBalancingSchemes),
      ),
      Flag.integer("timeout", "Backend response timeout in seconds (accepted, not simulated)."),
    ],
    permission: "compute.backendServices.create",
    requiredApis: [ComputeApi],
    run: createBackendService,
  }),
  listCommand({
    path: ["gcloud", "compute", "backend-services", "list"],
    summary: "List backend services.",
    permission: "compute.backendServices.list",
    columns: BackendServiceColumns,
    records: (ctx) =>
      World.namedOf(ctx.world, "backendServices", ctx.project.projectId).map(
        BackendService.toRecord,
      ),
  }),
  describeNamedCommand({
    path: ["gcloud", "compute", "backend-services", "describe"],
    summary: "Display detailed information about a backend service.",
    positional: { name: "NAME", description: "Name of the backend service." },
    flags: ScopeFlags,
    locate: scopePath,
    collection: "backendServices",
    permission: "compute.backendServices.get",
    requiredApis: [ComputeApi],
    resourcePath: (ref) => locatedPath(ref, "backendServices"),
    record: BackendService.toRecord,
  }),
  projectCommand({
    path: ["gcloud", "compute", "forwarding-rules", "create"],
    summary: "Create a forwarding rule.",
    positionals: [Positional.required("NAME", "Name of the forwarding rule to create.")],
    flags: [
      ...ScopeFlags,
      Flag.string("backend-service", "The target backend service that receives the traffic.", {
        required: true,
        candidates: Candidates.backendServices,
      }),
      Flag.string("address", "The name of a reserved address to use (ephemeral if omitted).", {
        candidates: Candidates.addresses,
      }),
      Flag.string("ports", "The ports or port range, e.g. 80 or 8080-8090 (default 80)."),
      Flag.enum(
        "load-balancing-scheme",
        "Specifies the load balancer type.",
        Object.values(LoadBalancingSchemes),
      ),
    ],
    permission: "compute.forwardingRules.create",
    requiredApis: [ComputeApi],
    run: createForwardingRule,
  }),
  listCommand({
    path: ["gcloud", "compute", "forwarding-rules", "list"],
    summary: "List forwarding rules.",
    permission: "compute.forwardingRules.list",
    columns: ForwardingRuleColumns,
    records: (ctx) =>
      World.namedOf(ctx.world, "forwardingRules", ctx.project.projectId).map(
        ForwardingRule.toRecord,
      ),
  }),
  describeNamedCommand({
    path: ["gcloud", "compute", "forwarding-rules", "describe"],
    summary: "Display detailed information about a forwarding rule.",
    positional: { name: "NAME", description: "Name of the forwarding rule." },
    flags: ScopeFlags,
    locate: scopePath,
    collection: "forwardingRules",
    permission: "compute.forwardingRules.get",
    requiredApis: [ComputeApi],
    resourcePath: (ref) => locatedPath(ref, "forwardingRules"),
    record: ForwardingRule.toRecord,
  }),
];
