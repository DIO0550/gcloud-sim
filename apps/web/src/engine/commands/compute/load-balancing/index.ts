import { CommandFailure } from "@/engine/cli/command-failure";
import {
  Column,
  CommandOutput,
  type CommandResult,
  type CommandSpec,
  Flag,
  ParsedArgs,
  Positional,
  type ProjectContext,
} from "@/engine/cli/command-spec";
import { ComputeApi } from "@/engine/commands/compute/shared";
import { alreadyExists, Candidates, projectCommand } from "@/engine/commands/shared";
import { Zone } from "@/engine/domains/catalog";
import {
  BackendProtocols,
  BackendService,
  HealthCheck,
  HealthCheckProtocols,
  LbScope,
  LoadBalancingSchemes,
} from "@/engine/domains/load-balancing";
import {
  CacheModes,
  groupLink,
  groupRegion,
  lbFind,
  lbHealth,
  lbLink,
  validPort,
} from "@/engine/domains/load-balancing/graph";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";
import { ForwardingCommands } from "./forwarding";
import { LifecycleCommands } from "./lifecycle";
import { GraphCommands } from "./resources";
import {
  finish,
  integer,
  invalid,
  ListScopeFlags,
  listScopeAccess,
  refFor,
  requireLb,
  resolveScope,
  resourceCandidates,
  ScopeFlags,
  scopePermission,
  value,
} from "./shared";
import { SimulationCommands } from "./simulation";

const nameArg = Positional.required("NAME", "Resource name.");
const checks = (
  ctx: ProjectContext,
  args: ParsedArgs,
  scope: LbScope,
): Result<readonly string[], CommandFailure> => {
  const area = ParsedArgs.string(args, "health-checks-region");
  const location = Option.isSome(area) ? `regions/${area.value}` : "global";
  if (location !== LbScope.toPath(scope)) {
    return Result.err(
      CommandFailure.invalidArgumentWith(
        "Health-check scope must match backend; regional backends require --health-checks-region.",
      ),
    );
  }
  const refs = ParsedArgs.list(args, "health-checks").map((name) =>
    refFor(ctx, location, "healthChecks", name),
  );
  if (refs.length !== 1) {
    return Result.err(
      CommandFailure.invalidArgumentWith("This lesson requires exactly one health check."),
    );
  }
  const missing = refs.find(
    (ref) =>
      !ctx.world.healthChecks.some(
        (h) =>
          h.projectId === ctx.project.projectId &&
          HealthCheck.selfLink(h) === ref &&
          LbScope.toPath(h.scope ?? LbScope.Global) === location,
      ),
  );
  if (missing !== undefined) {
    return Result.err(CommandFailure.notFound(missing));
  }
  return Result.map(
    requireLb(ctx, [
      scope.kind === "global"
        ? "compute.healthChecks.useReadOnly"
        : "compute.regionHealthChecks.useReadOnly",
    ]),
    () => refs,
  );
};
const createCheck =
  (protocol?: HealthCheck["protocol"]) =>
  (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
    const selected = Object.values(HealthCheckProtocols).filter((p) =>
      ParsedArgs.boolean(args, p.toLowerCase()),
    );
    if (selected.length > 1) {
      return invalid("Choose one health-check protocol.");
    }
    const scope = resolveScope(ctx, args, true);
    if (!Result.isOk(scope)) {
      return scope;
    }
    const allowed = requireLb(ctx, [
      scope.value.kind === "global"
        ? "compute.healthChecks.create"
        : "compute.regionHealthChecks.create",
    ]);
    if (!Result.isOk(allowed)) {
      return allowed;
    }
    const built = HealthCheck.create({
      projectId: ctx.project.projectId,
      name: ParsedArgs.requiredPositional(args, 0),
      protocol: protocol ?? selected[0] ?? "TCP",
      port: ParsedArgs.integer(args, "port"),
    });
    if (!Result.isOk(built)) {
      return invalid(built.error);
    }
    const check: HealthCheck = {
      ...built.value,
      scope: scope.value,
      requestPath: value(args, "request-path", "/"),
      checkIntervalSec: integer(args, "check-interval", 5),
      timeoutSec: integer(args, "timeout", 5),
    };
    if (
      !validPort(check.port) ||
      check.timeoutSec <= 0 ||
      check.checkIntervalSec < check.timeoutSec ||
      !check.requestPath?.startsWith("/") ||
      (check.protocol === "TCP" && Option.isSome(ParsedArgs.string(args, "request-path")))
    ) {
      return invalid("Invalid health-check port, path or interval/timeout.");
    }
    return Result.flatMap(
      Result.mapErr(
        World.withNamed(ctx.world, "healthChecks", check, HealthCheck.selfLink(check)),
        alreadyExists,
      ),
      (world) => finish(world, HealthCheck.toRecord(check)),
    );
  };
export const backendArg = (
  ctx: ProjectContext,
  args: ParsedArgs,
): Result<BackendService, CommandFailure> =>
  Result.flatMap(resolveScope(ctx, args), (scope) =>
    Option.toResult(
      World.findLocated(ctx.world, "backendServices", {
        projectId: ctx.project.projectId,
        name: ParsedArgs.requiredPositional(args, 0),
        location: LbScope.toPath(scope),
      }),
      () =>
        CommandFailure.notFound(
          refFor(
            ctx,
            LbScope.toPath(scope),
            "backendServices",
            ParsedArgs.requiredPositional(args, 0),
          ),
        ),
    ),
  );
const createBackend = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const scope = resolveScope(ctx, args);
  if (!Result.isOk(scope)) {
    return scope;
  }
  const protocol = value(args, "protocol", "HTTP") as BackendService["protocol"];
  const scheme = value(
    args,
    "load-balancing-scheme",
    "EXTERNAL",
  ) as BackendService["loadBalancingScheme"];
  const application =
    scope.value.kind === "global" &&
    scheme === "EXTERNAL_MANAGED" &&
    ["HTTP", "HTTPS"].includes(protocol);
  const internal =
    scope.value.kind === "region" &&
    scheme === "INTERNAL_MANAGED" &&
    ["HTTP", "HTTPS"].includes(protocol);
  const passthrough = scope.value.kind === "region" && scheme === "EXTERNAL" && protocol === "TCP";
  if (![application, internal, passthrough].some(Boolean)) {
    return invalid(
      "Supported: global EXTERNAL_MANAGED HTTP/HTTPS, regional INTERNAL_MANAGED HTTP/HTTPS, regional EXTERNAL TCP.",
    );
  }
  const hc = checks(ctx, args, scope.value);
  if (!Result.isOk(hc)) {
    return hc;
  }
  const built = BackendService.create({
    projectId: ctx.project.projectId,
    name: ParsedArgs.requiredPositional(args, 0),
    scope: scope.value,
    protocol,
    loadBalancingScheme: scheme,
    healthChecks: hc.value,
  });
  if (!Result.isOk(built)) {
    return invalid(built.error);
  }
  const b: BackendService = {
    ...built.value,
    portName: value(args, "port-name", "http"),
    timeoutSec: integer(args, "timeout", 30),
    enableCdn: ParsedArgs.boolean(args, "enable-cdn"),
    cacheMode: value(args, "cache-mode", "CACHE_ALL_STATIC") as BackendService["cacheMode"],
  };
  if (
    b.timeoutSec < 1 ||
    b.timeoutSec > 86400 ||
    !/^[a-z][a-z0-9-]{0,62}$/.test(b.portName ?? "") ||
    (b.enableCdn && !application)
  ) {
    return invalid("Invalid timeout/port-name, or CDN requires global external Application LB.");
  }
  return Result.flatMap(
    Result.mapErr(
      World.withNamed(ctx.world, "backendServices", b, BackendService.selfLink(b)),
      alreadyExists,
    ),
    (world) => finish(world, BackendService.toRecord(b)),
  );
};
const modifyBackend =
  (action: "add" | "remove") =>
  (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
    const found = backendArg(ctx, args);
    if (!Result.isOk(found)) {
      return found;
    }
    const b = found.value;
    const groupName = ParsedArgs.string(args, "instance-group");
    const negName = ParsedArgs.string(args, "network-endpoint-group");
    if (Option.isSome(groupName) === Option.isSome(negName)) {
      return invalid("Specify exactly one --instance-group or --network-endpoint-group.");
    }
    let ref = "";
    let region = "";
    if (Option.isSome(groupName)) {
      const zone = ParsedArgs.string(args, "instance-group-zone");
      const area = ParsedArgs.string(args, "instance-group-region");
      if (Option.isSome(zone) === Option.isSome(area)) {
        return invalid("Specify exactly one instance-group zone or region.");
      }
      const location = Option.unwrapOr(zone, Option.unwrapOr(area, ""));
      const g = ctx.world.instanceGroups.find(
        (g) =>
          g.projectId === ctx.project.projectId &&
          g.name === groupName.value &&
          g.location === location,
      );
      if (g === undefined) {
        return Result.err(CommandFailure.notFound(`instanceGroups/${groupName.value}/${location}`));
      }
      ref = groupLink(g);
      region = groupRegion(g);
      const permission = requireLb(ctx, ["compute.instanceGroups.use"]);
      if (!Result.isOk(permission)) {
        return permission;
      }
    }
    if (Option.isSome(negName)) {
      const zone = value(args, "network-endpoint-group-zone", "");
      const neg = lbFind(
        ctx.world,
        refFor(ctx, `zones/${zone}`, "networkEndpointGroups", negName.value),
      );
      if (
        neg?.kind !== "networkEndpointGroups" ||
        neg.projectId !== ctx.project.projectId ||
        neg.location !== `zones/${zone}`
      ) {
        return Result.err(
          CommandFailure.notFound(`networkEndpointGroups/${negName.value}/${zone}`),
        );
      }
      const parsed = Zone.parse(zone);
      if (!Option.isSome(parsed) || b.loadBalancingScheme === "EXTERNAL") {
        return invalid("Zonal GCE_VM_IP_PORT NEGs require an Application LB.");
      }
      ref = lbLink(neg);
      region = Zone.region(parsed.value);
      const permission = requireLb(ctx, ["compute.networkEndpointGroups.use"]);
      if (!Result.isOk(permission)) {
        return permission;
      }
    }
    if (b.scope.kind === "region" && b.scope.region !== region) {
      return invalid("Backend group/NEG must be in the backend service region.");
    }
    const defaultMode = Option.isSome(negName) ? "RATE" : "UTILIZATION";
    const mode = value(
      args,
      "balancing-mode",
      b.loadBalancingScheme === "EXTERNAL" ? "CONNECTION" : defaultMode,
    ) as "UTILIZATION" | "CONNECTION" | "RATE";
    const maxRate = ParsedArgs.integer(args, "max-rate-per-endpoint");
    const expected = b.loadBalancingScheme === "EXTERNAL" ? "CONNECTION" : defaultMode;
    if (
      mode !== expected ||
      (Option.isSome(negName) && (!Option.isSome(maxRate) || maxRate.value < 1)) ||
      (!Option.isSome(negName) && Option.isSome(maxRate))
    ) {
      return invalid(
        "Use CONNECTION for passthrough MIG, UTILIZATION for Application MIG, or RATE with positive --max-rate-per-endpoint for a zonal NEG.",
      );
    }
    const exists = b.backends.includes(ref);
    if ((action === "add" && exists) || (action === "remove" && !exists)) {
      return invalid(exists ? "Backend already attached." : "Backend not attached.");
    }
    const options = (b.backendOptions ?? []).filter((o) => o.group !== ref);
    const next = {
      ...b,
      backends: action === "add" ? [...b.backends, ref] : b.backends.filter((r) => r !== ref),
      backendOptions:
        action === "add"
          ? [
              ...options,
              {
                group: ref,
                balancingMode: mode,
                maxRatePerEndpoint: Option.isSome(maxRate) ? maxRate.value : undefined,
              },
            ]
          : options,
    };
    return finish(
      World.replaceNamed(ctx.world, "backendServices", next),
      BackendService.toRecord(next),
    );
  };
const hcFlags = [
  ...ScopeFlags,
  Flag.integer("port", "Probe port (1-65535)."),
  Flag.string("request-path", "HTTP/HTTPS health-check path."),
  Flag.integer("check-interval", "Probe interval seconds."),
  Flag.integer("timeout", "Probe timeout seconds."),
];
const backendFlags = [
  ...ScopeFlags,
  Flag.enum("protocol", "Backend protocol.", Object.values(BackendProtocols)),
  Flag.list("health-checks", "Health-check names."),
  Flag.string("health-checks-region", "Regional health-check region."),
  Flag.enum("load-balancing-scheme", "LB scheme.", Object.values(LoadBalancingSchemes)),
  Flag.string("port-name", "MIG named port."),
  Flag.integer("timeout", "Backend timeout seconds."),
  Flag.boolean("enable-cdn", "Enable simulated CDN configuration."),
  Flag.enum("cache-mode", "CDN cache mode.", CacheModes),
];
const attachmentFlags = [
  ...ScopeFlags,
  Flag.string("instance-group", "MIG name.", { candidates: Candidates.named("instanceGroups") }),
  Flag.string("instance-group-zone", "MIG zone."),
  Flag.string("instance-group-region", "MIG region."),
  Flag.string("network-endpoint-group", "Zonal NEG name.", {
    candidates: resourceCandidates("networkEndpointGroups"),
  }),
  Flag.string("network-endpoint-group-zone", "NEG zone."),
  Flag.enum("balancing-mode", "Capacity model.", ["UTILIZATION", "CONNECTION", "RATE"]),
  Flag.integer(
    "max-rate-per-endpoint",
    "Stored RATE capacity for zonal NEG; actual throughput is not simulated.",
  ),
];
const CoreCommands: readonly CommandSpec[] = [
  ...Object.values(HealthCheckProtocols).map((protocol) =>
    projectCommand({
      path: ["gcloud", "compute", "health-checks", "create", protocol.toLowerCase()],
      summary: `Create a ${protocol} health check.`,
      positionals: [nameArg],
      flags: hcFlags,
      permissions: [],
      requiredApis: [ComputeApi],
      run: createCheck(protocol),
    }),
  ),
  projectCommand({
    path: ["gcloud", "compute", "health-checks", "create"],
    summary: "Legacy simulator alias; prefer create http/tcp/https NAME.",
    positionals: [nameArg],
    flags: [
      ...hcFlags,
      ...["http", "https", "tcp"].map((p) => Flag.boolean(p, "Legacy protocol alias.")),
    ],
    permissions: [],
    requiredApis: [ComputeApi],
    run: createCheck(),
  }),
  projectCommand({
    path: ["gcloud", "compute", "health-checks", "describe"],
    summary: "Describe a scoped health check.",
    positionals: [
      Positional.required("NAME", "Health-check name.", Candidates.named("healthChecks")),
    ],
    flags: ScopeFlags,
    permissions: [],
    requiredApis: [ComputeApi],
    run: (ctx, args) => {
      const scope = resolveScope(ctx, args, true);
      if (!Result.isOk(scope)) {
        return scope;
      }
      const allowed = requireLb(ctx, [
        scope.value.kind === "global"
          ? "compute.healthChecks.get"
          : "compute.regionHealthChecks.get",
      ]);
      if (!Result.isOk(allowed)) {
        return allowed;
      }
      const h = ctx.world.healthChecks.find(
        (h) =>
          h.projectId === ctx.project.projectId &&
          h.name === ParsedArgs.requiredPositional(args, 0) &&
          LbScope.equals(h.scope ?? LbScope.Global, scope.value),
      );
      return h === undefined
        ? Result.err(
            CommandFailure.notFound(`healthChecks/${ParsedArgs.requiredPositional(args, 0)}`),
          )
        : finish(ctx.world, HealthCheck.toRecord(h));
    },
  }),
  projectCommand({
    path: ["gcloud", "compute", "backend-services", "create"],
    summary: "Create a backend service for the three modeled LB architectures.",
    positionals: [nameArg],
    flags: backendFlags,
    permission: "compute.backendServices.create",
    requiredApis: [ComputeApi],
    run: createBackend,
  }),
  projectCommand({
    path: ["gcloud", "compute", "backend-services", "update"],
    summary: "Update named port, timeout, health check and CDN configuration.",
    positionals: [nameArg],
    flags: backendFlags,
    permission: "compute.backendServices.update",
    requiredApis: [ComputeApi],
    run: (ctx, args) => {
      const found = backendArg(ctx, args);
      if (!Result.isOk(found)) {
        return found;
      }
      const b = found.value;
      if (
        Option.isSome(ParsedArgs.string(args, "protocol")) ||
        Option.isSome(ParsedArgs.string(args, "load-balancing-scheme"))
      ) {
        return invalid("Protocol/scheme changes are outside this lesson. Recreate the backend.");
      }
      const hc =
        ParsedArgs.list(args, "health-checks").length === 0
          ? Result.ok(b.healthChecks)
          : checks(ctx, args, b.scope);
      if (!Result.isOk(hc)) {
        return hc;
      }
      const next = {
        ...b,
        healthChecks: hc.value,
        portName: value(args, "port-name", b.portName ?? "http"),
        timeoutSec: integer(args, "timeout", b.timeoutSec),
        enableCdn: Option.unwrapOr(
          ParsedArgs.booleanChoice(args, "enable-cdn"),
          b.enableCdn ?? false,
        ),
        cacheMode: value(
          args,
          "cache-mode",
          b.cacheMode ?? "CACHE_ALL_STATIC",
        ) as BackendService["cacheMode"],
      };
      if (
        next.timeoutSec < 1 ||
        next.timeoutSec > 86400 ||
        (next.enableCdn && b.loadBalancingScheme !== "EXTERNAL_MANAGED")
      ) {
        return invalid("Invalid timeout/CDN combination.");
      }
      return finish(
        World.replaceNamed(ctx.world, "backendServices", next),
        BackendService.toRecord(next),
      );
    },
  }),
  ...(["add", "remove"] as const).map((action) =>
    projectCommand({
      path: ["gcloud", "compute", "backend-services", `${action}-backend`],
      summary: `${action} a scoped MIG or zonal NEG backend.`,
      positionals: [nameArg],
      flags:
        action === "add"
          ? attachmentFlags
          : attachmentFlags.filter(
              (f) => !["balancing-mode", "max-rate-per-endpoint"].includes(f.name),
            ),
      permission: "compute.backendServices.update",
      requiredApis: [ComputeApi],
      run: modifyBackend(action),
    }),
  ),
  projectCommand({
    path: ["gcloud", "compute", "backend-services", "get-health"],
    summary: "Diagnose VM, app response, named port and health-check firewall independently.",
    positionals: [nameArg],
    flags: ScopeFlags,
    permission: "compute.backendServices.get",
    requiredApis: [ComputeApi],
    run: (ctx, args) =>
      Result.flatMap(backendArg(ctx, args), (b) =>
        finish(ctx.world, { name: b.name, healthStatus: lbHealth(ctx.world, b) }),
      ),
  }),
  projectCommand({
    path: ["gcloud", "compute", "backend-services", "describe"],
    summary: "Describe a scoped backend service.",
    positionals: [Positional.required("NAME", "Backend name.", Candidates.backendServices)],
    flags: ScopeFlags,
    permission: "compute.backendServices.get",
    requiredApis: [ComputeApi],
    run: (ctx, args) =>
      Result.flatMap(backendArg(ctx, args), (b) => finish(ctx.world, BackendService.toRecord(b))),
  }),
  ...(["healthChecks", "backendServices"] as const).map((collection) =>
    projectCommand({
      path: [
        "gcloud",
        "compute",
        collection === "healthChecks" ? "health-checks" : "backend-services",
        "list",
      ],
      summary: "List selected global/regional resources with scoped read permissions.",
      flags: ListScopeFlags,
      permissions: [],
      requiredApis: [ComputeApi],
      run: (ctx, args) =>
        Result.flatMap(
          listScopeAccess(
            ctx,
            args,
            `compute.${collection}.list`,
            `compute.region${collection[0]?.toUpperCase()}${collection.slice(1)}.list`,
          ),
          (includes) =>
            Result.ok({
              world: ctx.world,
              output: CommandOutput.table(
                collection === "healthChecks"
                  ? ctx.world.healthChecks
                      .filter(
                        (h) =>
                          h.projectId === ctx.project.projectId &&
                          includes(LbScope.toPath(h.scope ?? LbScope.Global)),
                      )
                      .map(HealthCheck.toRecord)
                  : ctx.world.backendServices
                      .filter(
                        (b) =>
                          b.projectId === ctx.project.projectId &&
                          includes(LbScope.toPath(b.scope)),
                      )
                      .map(BackendService.toRecord),
                [Column.create("NAME", "name")],
              ),
            }),
        ),
    }),
  ),
  ...GraphCommands,
  ...ForwardingCommands,
  ...LifecycleCommands,
  ...SimulationCommands,
];

export const LoadBalancingCommands: readonly CommandSpec[] = CoreCommands.map((spec) => {
  if (spec.kind !== "project" || spec.path[0] !== "gcloud") {
    return spec;
  }
  const path = spec.path[2];
  const kinds: Readonly<Record<string, "backendServices" | "forwardingRules" | "addresses">> = {
    "backend-services": "backendServices",
    "forwarding-rules": "forwardingRules",
    addresses: "addresses",
  };
  const kind = kinds[path ?? ""];
  if (kind === undefined || spec.path[3] === "list") {
    return spec;
  }
  const action = spec.path[3] ?? "";
  const verbs: Readonly<Record<string, string>> = {
    describe: "get",
    "get-health": "get",
    "add-backend": "update",
    "remove-backend": "update",
  };
  return {
    ...spec,
    requiredPermissions: [],
    run: scopePermission(kind, verbs[action] ?? action, spec.run),
  };
});
