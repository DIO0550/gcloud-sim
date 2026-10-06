import { CommandFailure } from "@/engine/cli/command-failure";
import {
  Column,
  CommandContext,
  CommandOutput,
  type CommandResult,
  type CommandSpec,
  Flag,
  ParsedArgs,
  Positional,
  type ProjectContext,
} from "@/engine/cli/command-spec";
import { ComputeApi } from "@/engine/commands/compute/shared";
import { alreadyExists, Candidates, CommonFlags, projectCommand } from "@/engine/commands/shared";
import { ResourceName } from "@/engine/domains/compute";
import { LbScope } from "@/engine/domains/load-balancing";
import {
  CacheModes,
  type LbResource,
  type LbRoute,
  lbLink,
  lbRecord,
  validLbPath,
  validPort,
} from "@/engine/domains/load-balancing/graph";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";
import {
  findResource,
  finish,
  integer,
  invalid,
  ListScopeFlags,
  listScopeAccess,
  replaceResource,
  requireLb,
  resolveBackendTarget,
  resolveScope,
  resourceArg,
  resourceCandidates,
  ScopeFlags,
  value,
} from "./shared";

export const ResourcePaths = {
  urlMaps: "url-maps",
  targetHttpProxies: "target-http-proxies",
  targetHttpsProxies: "target-https-proxies",
  sslCertificates: "ssl-certificates",
  networkEndpointGroups: "network-endpoint-groups",
  backendBuckets: "backend-buckets",
} as const;
export const resourcePermission = (
  kind: LbResource["kind"],
  location: string,
  verb: string,
): string =>
  location.startsWith("regions/")
    ? `compute.region${kind[0]?.toUpperCase()}${kind.slice(1)}.${verb}`
    : `compute.${kind}.${verb}`;
const create =
  (kind: LbResource["kind"]) =>
  (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
    const scope = resolveScope(ctx, args, true);
    if (!Result.isOk(scope)) {
      return scope;
    }
    let location = LbScope.toPath(scope.value);
    if (kind === "networkEndpointGroups") {
      const zone = CommandContext.resolveZone(ctx, ParsedArgs.string(args, "zone"));
      if (!Result.isOk(zone)) {
        return zone;
      }
      location = `zones/${zone.value}`;
    }
    if (["sslCertificates", "backendBuckets"].includes(kind) && location !== "global") {
      return invalid(
        "This lesson models global Google-managed certificates and global backend buckets only.",
      );
    }
    const name = ResourceName.parse(ParsedArgs.requiredPositional(args, 0));
    if (!Result.isOk(name)) {
      return invalid(name.error);
    }
    const allowed = requireLb(ctx, [resourcePermission(kind, location, "create")]);
    if (!Result.isOk(allowed)) {
      return allowed;
    }
    const base = { projectId: ctx.project.projectId, name: name.value, location };
    const save = (resource: LbResource): CommandResult =>
      Result.flatMap(
        Result.mapErr(
          World.withNamed(ctx.world, "lbResources", resource, lbLink(resource)),
          alreadyExists,
        ),
        (world) => finish(world, lbRecord(resource)),
      );
    if (kind === "urlMaps") {
      const service = ParsedArgs.string(args, "default-service");
      const bucket = ParsedArgs.string(args, "default-backend-bucket");
      if (Option.isSome(service) === Option.isSome(bucket)) {
        return invalid("Specify one default backend service or backend bucket.");
      }
      return Result.flatMap(
        resolveBackendTarget(
          ctx,
          location,
          Option.unwrapOr(service, Option.unwrapOr(bucket, "")),
          Option.isSome(bucket),
        ),
        (ref) => save({ ...base, kind, defaultService: ref, routes: [] }),
      );
    }
    if (kind === "targetHttpProxies" || kind === "targetHttpsProxies") {
      if (
        Option.isSome(ParsedArgs.string(args, "url-map-region")) &&
        `regions/${value(args, "url-map-region", "")}` !== location
      ) {
        return invalid("URL map and proxy must have the same scope.");
      }
      const map = findResource(
        ctx,
        location,
        "urlMaps",
        ParsedArgs.requiredString(args, "url-map"),
      );
      if (!Result.isOk(map)) {
        return map;
      }
      const use = requireLb(ctx, [resourcePermission("urlMaps", location, "use")]);
      if (!Result.isOk(use)) {
        return use;
      }
      const refs: string[] = [];
      for (const certName of ParsedArgs.list(args, "ssl-certificates")) {
        const cert = findResource(ctx, location, "sslCertificates", certName);
        if (!Result.isOk(cert)) {
          return cert;
        }
        refs.push(lbLink(cert.value));
      }
      if (
        kind === "targetHttpsProxies" &&
        (location !== "global" || refs.length < 1 || refs.length > 15)
      ) {
        return invalid(
          "HTTPS frontend requires 1-15 global Google-managed certificates; regional/self-managed TLS is unsupported.",
        );
      }
      if (kind === "targetHttpProxies" && refs.length > 0) {
        return invalid("HTTP proxies do not accept SSL certificates.");
      }
      if (refs.length > 0) {
        const certUse = requireLb(ctx, ["compute.sslCertificates.get"]);
        if (!Result.isOk(certUse)) {
          return certUse;
        }
      }
      return save({ ...base, kind, urlMap: lbLink(map.value), sslCertificates: refs });
    }
    if (kind === "sslCertificates") {
      const domains = ParsedArgs.list(args, "domains");
      if (
        domains.length === 0 ||
        domains.some(
          (d) => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(d),
        )
      ) {
        return invalid(
          "Specify literal DNS names in --domains; wildcards/private keys are outside this lesson.",
        );
      }
      return save({ ...base, kind, domains, status: "PROVISIONING" });
    }
    if (kind === "networkEndpointGroups") {
      const network = value(args, "network", "default");
      const subnet = value(args, "subnet", network);
      const region = location.slice(6).replace(/-[a-z]$/, "");
      const s = ctx.world.subnets.find(
        (s) =>
          s.projectId === ctx.project.projectId &&
          s.name === subnet &&
          s.network === network &&
          s.region === region &&
          s.purpose !== "REGIONAL_MANAGED_PROXY",
      );
      const port = integer(args, "default-port", 80);
      if (s === undefined || !validPort(port)) {
        return invalid(
          "NEG requires a regular subnet in its VM zone region and a valid default port.",
        );
      }
      const networkUse = requireLb(ctx, ["compute.networks.use", "compute.subnetworks.use"]);
      if (!Result.isOk(networkUse)) {
        return networkUse;
      }
      return save({ ...base, kind, network, subnet, defaultPort: port, endpoints: [] });
    }
    const bucket = value(args, "gcs-bucket-name", "");
    if (
      !ctx.world.buckets.some((b) => b.projectId === ctx.project.projectId && b.name === bucket)
    ) {
      return Result.err(CommandFailure.notFound(`buckets/${bucket}`));
    }
    const read = requireLb(ctx, ["storage.buckets.get"]);
    if (!Result.isOk(read)) {
      return read;
    }
    return save({
      ...base,
      kind: "backendBuckets",
      bucketName: bucket,
      enableCdn: ParsedArgs.boolean(args, "enable-cdn"),
      cacheMode: value(args, "cache-mode", "CACHE_ALL_STATIC") as (typeof CacheModes)[number],
    });
  };
const flagsFor = (kind: LbResource["kind"]) => {
  if (kind === "urlMaps") {
    return [
      ...ScopeFlags,
      Flag.string("default-service", "Default backend service.", {
        candidates: Candidates.backendServices,
      }),
      Flag.string("default-backend-bucket", "Default backend bucket.", {
        candidates: resourceCandidates("backendBuckets"),
      }),
    ];
  }
  if (kind === "targetHttpProxies" || kind === "targetHttpsProxies") {
    return [
      ...ScopeFlags,
      Flag.string("url-map", "URL map.", {
        required: true,
        candidates: resourceCandidates("urlMaps"),
      }),
      Flag.string("url-map-region", "URL map region."),
      Flag.list("ssl-certificates", "Global Google-managed certificate names."),
    ];
  }
  if (kind === "sslCertificates") {
    return [
      ...ScopeFlags,
      Flag.list("domains", "Google-managed certificate domain names.", { required: true }),
    ];
  }
  if (kind === "networkEndpointGroups") {
    return [
      CommonFlags.zone,
      Flag.enum("network-endpoint-type", "Supported zonal endpoint type.", ["GCE_VM_IP_PORT"]),
      Flag.string("network", "VPC network.", { candidates: Candidates.networks }),
      Flag.string("subnet", "VM subnet."),
      Flag.integer("default-port", "Default endpoint port."),
    ];
  }
  return [
    ...ScopeFlags,
    Flag.string("gcs-bucket-name", "Storage bucket name.", { required: true }),
    Flag.boolean("enable-cdn", "Enable CDN configuration."),
    Flag.enum("cache-mode", "CDN cache mode.", CacheModes),
  ];
};
const BasicCommands: readonly CommandSpec[] = Object.entries(ResourcePaths).flatMap(
  ([key, path]) => {
    const kind = key as LbResource["kind"];
    const scopes = kind === "networkEndpointGroups" ? [CommonFlags.zone] : ScopeFlags;
    return [
      projectCommand({
        path: ["gcloud", "compute", path, "create"],
        summary: `Create ${path} and validate scoped references.`,
        positionals: [Positional.required("NAME", "Resource name.")],
        flags: flagsFor(kind),
        permissions: [],
        requiredApis: [ComputeApi],
        run: create(kind),
      }),
      projectCommand({
        path: ["gcloud", "compute", path, "describe"],
        summary: `Describe ${path}.`,
        positionals: [Positional.required("NAME", "Resource name.", resourceCandidates(kind))],
        flags: scopes,
        permissions: [],
        requiredApis: [ComputeApi],
        run: (ctx, args) =>
          Result.flatMap(resourceArg(ctx, args, kind), (r) =>
            Result.flatMap(requireLb(ctx, [resourcePermission(kind, r.location, "get")]), () =>
              finish(ctx.world, lbRecord(r)),
            ),
          ),
      }),
      projectCommand({
        path: ["gcloud", "compute", path, "list"],
        summary: `List ${path}.`,
        flags: kind === "networkEndpointGroups" ? [] : ListScopeFlags,
        permissions: [],
        requiredApis: [ComputeApi],
        run: (ctx, args) =>
          Result.flatMap(
            listScopeAccess(
              ctx,
              args,
              resourcePermission(kind, "global", "list"),
              kind === "urlMaps" || kind === "targetHttpProxies"
                ? resourcePermission(kind, "regions/_", "list")
                : undefined,
            ),
            (includes) =>
              Result.ok({
                world: ctx.world,
                output: CommandOutput.table(
                  ctx.world.lbResources
                    .filter(
                      (r) =>
                        r.projectId === ctx.project.projectId &&
                        r.kind === kind &&
                        includes(r.location),
                    )
                    .map(lbRecord),
                  [Column.create("NAME", "name"), Column.create("LOCATION", "location")],
                ),
              }),
          ),
      }),
    ];
  },
);
export const GraphCommands: readonly CommandSpec[] = [
  ...BasicCommands,
  projectCommand({
    path: ["gcloud", "compute", "url-maps", "add-path-matcher"],
    summary: "Add host and exact/longest prefix path routing.",
    positionals: [Positional.required("NAME", "URL map.")],
    flags: [
      ...ScopeFlags,
      Flag.string("path-matcher-name", "Unique path matcher.", { required: true }),
      Flag.string("default-service", "Matcher default backend service.", { required: true }),
      Flag.list("new-hosts", "Literal hosts or *.", { required: true }),
      Flag.list("path-rules", "PATH=BACKEND mappings."),
    ],
    permissions: [],
    requiredApis: [ComputeApi],
    run: (ctx, args) => {
      const found = resourceArg(ctx, args, "urlMaps");
      if (!Result.isOk(found)) {
        return found;
      }
      const map = found.value;
      if (map.kind !== "urlMaps") {
        return invalid("Expected a URL map.");
      }
      const permission = requireLb(ctx, [resourcePermission(map.kind, map.location, "update")]);
      if (!Result.isOk(permission)) {
        return permission;
      }
      const matcher = ParsedArgs.requiredString(args, "path-matcher-name");
      const hosts = ParsedArgs.list(args, "new-hosts");
      if (
        !Result.isOk(ResourceName.parse(matcher)) ||
        hosts.length === 0 ||
        hosts.some((h) => h !== "*" && !/^[a-z0-9.-]+$/.test(h)) ||
        map.routes.some((r) => r.matcher === matcher || r.hosts.some((h) => hosts.includes(h)))
      ) {
        return invalid("Invalid/duplicate matcher or host.");
      }
      const fallback = resolveBackendTarget(
        ctx,
        map.location,
        ParsedArgs.requiredString(args, "default-service"),
      );
      if (!Result.isOk(fallback)) {
        return fallback;
      }
      const routes: LbRoute[] = [{ hosts, paths: [], service: fallback.value, matcher }];
      const seen = new Set<string>();
      for (const entry of ParsedArgs.list(args, "path-rules")) {
        const [path, target, ...extra] = entry.split("=");
        if (
          path === undefined ||
          target === undefined ||
          extra.length > 0 ||
          !validLbPath(path) ||
          seen.has(path)
        ) {
          return invalid(
            "Path rules require unique exact /path or trailing /* prefixes and a backend service.",
          );
        }
        seen.add(path);
        const ref = resolveBackendTarget(ctx, map.location, target);
        if (!Result.isOk(ref)) {
          return ref;
        }
        routes.push({ hosts, paths: [path], service: ref.value, matcher });
      }
      const next = { ...map, routes: [...map.routes, ...routes] };
      return finish(replaceResource(ctx.world, next), lbRecord(next));
    },
  }),
  projectCommand({
    path: ["gcloud", "compute", "network-endpoint-groups", "update"],
    summary: "Add/remove one GCE_VM_IP_PORT endpoint per call.",
    positionals: [Positional.required("NAME", "NEG name.")],
    flags: [
      CommonFlags.zone,
      Flag.keyvalue("add-endpoint", "instance=VM,ip=IPv4,port=N"),
      Flag.keyvalue("remove-endpoint", "instance=VM,ip=IPv4,port=N"),
    ],
    permissions: [],
    requiredApis: [ComputeApi],
    run: (ctx, args) => {
      const found = resourceArg(ctx, args, "networkEndpointGroups");
      if (!Result.isOk(found)) {
        return found;
      }
      const neg = found.value;
      if (neg.kind !== "networkEndpointGroups") {
        return invalid("Expected a zonal NEG.");
      }
      const add = ParsedArgs.keyvalue(args, "add-endpoint");
      const remove = ParsedArgs.keyvalue(args, "remove-endpoint");
      if ((Object.keys(add).length === 0) === (Object.keys(remove).length === 0)) {
        return invalid("Specify exactly one --add-endpoint or --remove-endpoint.");
      }
      const selected = Object.keys(add).length > 0 ? add : remove;
      if (Object.keys(selected).some((key) => !["instance", "ip", "port"].includes(key))) {
        return invalid("Unknown endpoint property.");
      }
      const vm = ctx.world.instances.find(
        (v) =>
          v.projectId === ctx.project.projectId &&
          v.name === selected.instance &&
          `zones/${v.zone}` === neg.location,
      );
      const ip = selected.ip ?? vm?.networkInterfaces[0]?.networkIP ?? "";
      const port = Number(selected.port ?? neg.defaultPort);
      if (
        vm === undefined ||
        !validPort(port) ||
        !vm.networkInterfaces.some(
          (n) => n.network === neg.network && n.subnetwork === neg.subnet && n.networkIP === ip,
        )
      ) {
        return invalid(
          "Endpoint must reference a VM/IP in the NEG's project, zone, network and subnet.",
        );
      }
      const exists = neg.endpoints.some(
        (e) => e.instance === vm.name && e.ipAddress === ip && e.port === port,
      );
      const adding = Object.keys(add).length > 0;
      const permission = requireLb(ctx, [
        adding
          ? "compute.networkEndpointGroups.attachNetworkEndpoints"
          : "compute.networkEndpointGroups.detachNetworkEndpoints",
        "compute.instances.use",
      ]);
      if (!Result.isOk(permission)) {
        return permission;
      }
      if (adding === exists) {
        return invalid(exists ? "Endpoint already exists." : "Endpoint not found.");
      }
      const next = {
        ...neg,
        endpoints: adding
          ? [...neg.endpoints, { instance: vm.name, ipAddress: ip, port }]
          : neg.endpoints.filter(
              (e) => !(e.instance === vm.name && e.ipAddress === ip && e.port === port),
            ),
      };
      return finish(replaceResource(ctx.world, next), lbRecord(next));
    },
  }),
];
