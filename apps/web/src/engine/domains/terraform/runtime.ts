import { Region } from "@/engine/domains/catalog";
import { EffectivePermissions } from "@/engine/domains/effective-permissions";
import { Principal } from "@/engine/domains/principal";
import {
  TerraformState,
  type TfChange,
  type TfPlan,
  type TfResource,
} from "@/engine/domains/terraform";
import { TfConfiguration } from "@/engine/domains/terraform/configuration";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";

const fail = (message: string): never => {
  throw new Error(message);
};
const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const isNetwork = (r: TfResource): boolean => r.type === "google_compute_network";
const identity = (a: TfResource, b: TfResource): boolean =>
  TerraformState.id(a) === TerraformState.id(b);
const ordered = (rs: readonly TfResource[]): readonly TfResource[] =>
  [...rs].sort((a, b) => a.address.localeCompare(b.address));
const replacing = (a: TfResource, b: TfResource): boolean =>
  !identity(a, b) || a.network !== b.network || a.cidr !== b.cidr;

const authorize = (world: World, r: TfResource, action: string): void => {
  if (!Option.isSome(World.findActiveProject(world, r.project)))
    fail(`Project not found: ${r.project}`);
  if (!World.hasApi(world, r.project, "compute.googleapis.com"))
    fail(`compute.googleapis.com is disabled in ${r.project}.`);
  const adc = world.session.adc;
  if (!Option.isSome(adc))
    throw new Error(
      "Application Default Credentials are missing. Run gcloud auth application-default login.",
    );
  const permission = `compute.${isNetwork(r) ? "networks" : "subnetworks"}.${action}`;
  const effective = EffectivePermissions.resolve(world, Principal.toMember(adc.value), {
    type: "project",
    id: r.project,
  });
  if (!EffectivePermissions.allows(effective, permission))
    fail(`Permission denied: ${permission} for ADC ${adc.value} in ${r.project}.`);
};

const read = (world: World, r: TfResource): TfResource | undefined => {
  authorize(world, r, "get");
  if (isNetwork(r)) {
    const network = world.networks.find((n) => n.projectId === r.project && n.name === r.name);
    if (network?.subnetMode === "AUTO")
      fail("Automatic subnet networks are not supported by this Terraform subset.");
    return network ? { ...r, region: "", network: "", cidr: "", privateAccess: false } : undefined;
  }
  const subnet = world.subnets.find(
    (s) => s.projectId === r.project && s.name === r.name && s.region === r.region,
  );
  return subnet
    ? {
        ...r,
        network: subnet.network,
        cidr: subnet.ipCidrRange,
        privateAccess: subnet.privateIpGoogleAccess,
      }
    : undefined;
};

const diff = (before: readonly TfResource[], after: readonly TfResource[]): readonly TfChange[] => {
  const deletes: TfChange[] = [];
  const writes: TfChange[] = [];
  for (const old of before) {
    const next = after.find((r) => r.address === old.address);
    if (!next || replacing(old, next)) deletes.push({ action: "delete", resource: old });
  }
  for (const next of after) {
    const old = before.find((r) => r.address === next.address);
    if (!old || replacing(old, next)) writes.push({ action: "create", resource: next });
    else if (!equal(old, next)) writes.push({ action: "update", resource: next });
  }
  deletes.sort((a, b) => Number(isNetwork(a.resource)) - Number(isNetwork(b.resource)));
  writes.sort((a, b) => Number(isNetwork(b.resource)) - Number(isNetwork(a.resource)));
  return [...deletes, ...writes];
};

const mutate = (world: World, change: TfChange, checkWrites: boolean): World => {
  const r = change.resource;
  TfConfiguration.validateResource(r);
  if (checkWrites)
    authorize(world, r, change.action === "update" ? "setPrivateIpGoogleAccess" : change.action);
  const matches = (item: { projectId: string; name: string }): boolean =>
    item.projectId === r.project && item.name === r.name;
  if (change.action === "delete") {
    const nics = world.instances
      .filter((i) => i.projectId === r.project)
      .flatMap((i) => i.networkInterfaces);
    if (isNetwork(r)) {
      const dependents = [
        ...world.subnets,
        ...world.firewallRules,
        ...world.routers,
        ...world.peerings,
        ...world.instanceTemplates,
      ];
      if (
        dependents.some((s) => s.projectId === r.project && s.network === r.name) ||
        nics.some((n) => n.network === r.name) ||
        world.peerings.some((p) => p.peerProjectId === r.project && p.peerNetwork === r.name)
      )
        fail(`Network ${r.name} is still in use. Remove dependent resources first.`);
      return { ...world, networks: world.networks.filter((n) => !matches(n)) };
    }
    if (
      world.instances.some(
        (i) =>
          i.projectId === r.project &&
          i.zone.startsWith(`${r.region}-`) &&
          i.networkInterfaces.some((n) => n.subnetwork === r.name),
      ) ||
      world.instanceTemplates.some(
        (t) => t.projectId === r.project && Option.isSome(t.subnet) && t.subnet.value === r.name,
      )
    )
      fail(`Subnetwork ${r.name} is still in use.`);
    return {
      ...world,
      subnets: world.subnets.filter((s) => !(matches(s) && s.region === r.region)),
    };
  }
  if (isNetwork(r)) {
    if (world.networks.some(matches))
      fail(`Network already exists: ${r.name}. Use terraform import.`);
    return {
      ...world,
      networks: [...world.networks, { projectId: r.project, name: r.name, subnetMode: "CUSTOM" }],
    };
  }
  const region = Region.parse(r.region);
  if (!Option.isSome(region)) return fail(`Unknown region: ${r.region}`);
  if (
    !world.networks.some(
      (n) => n.projectId === r.project && n.name === r.network && n.subnetMode === "CUSTOM",
    )
  )
    fail(`Custom network not found: ${r.network}`);
  if (change.action === "create" && world.subnets.some((s) => matches(s) && s.region === r.region))
    fail(`Subnetwork already exists: ${r.name}. Use terraform import.`);
  const range = (cidr: string): readonly [number, number] => {
    const [ip = "", prefix = "32"] = cidr.split("/");
    const start = ip.split(".").reduce((a, b) => a * 256 + Number(b), 0);
    return [start, start + 2 ** (32 - Number(prefix)) - 1];
  };
  const [start, end] = range(r.cidr);
  if (
    world.subnets.some((s) => {
      if (
        s.projectId !== r.project ||
        s.network !== r.network ||
        (matches(s) && s.region === r.region)
      )
        return false;
      const [otherStart, otherEnd] = range(s.ipCidrRange);
      return start <= otherEnd && otherStart <= end;
    })
  )
    fail(`Overlapping subnet CIDR: ${r.cidr}`);
  const subnet = {
    projectId: r.project,
    name: r.name,
    region: region.value,
    network: r.network,
    ipCidrRange: r.cidr,
    privateIpGoogleAccess: r.privateAccess,
  };
  return {
    ...world,
    subnets: [...world.subnets.filter((s) => !(matches(s) && s.region === r.region)), subnet],
  };
};

export const TfRuntime = {
  read,
  plan(world: World, mode: TfPlan["mode"]): TfPlan {
    if (!world.terraform.initialized) fail("Run terraform init first.");
    const config = TfConfiguration.compile(world.terraform.files);
    const before = ordered(
      world.terraform.resources.flatMap((r) => {
        const actual = read(world, r);
        return actual ? [actual] : [];
      }),
    );
    const after =
      mode === "destroy" ? [] : mode === "refresh-only" ? before : ordered(config.resources);
    for (const r of after) {
      authorize(world, r, "get");
      const owned = before.some((old) => identity(old, r));
      if (!owned && read(world, r))
        fail(`Resource already exists: ${TerraformState.id(r)}. Use terraform import.`);
    }
    const changes = mode === "refresh-only" ? [] : diff(before, after);
    // Validate references, collisions and deletion dependencies without committing changes.
    changes.reduce((next, change) => mutate(next, change, false), world);
    const outputs = mode === "destroy" ? {} : config.outputs;
    const refreshedOutputs =
      mode === "refresh-only" ? TfRuntime.refreshOutputs(world, before) : outputs;
    return {
      serial: world.terraform.serial,
      mode,
      before,
      after,
      changes,
      drift: diff(ordered(world.terraform.resources), before),
      outputs: refreshedOutputs,
    };
  },
  refreshOutputs(world: World, actual: readonly TfResource[]): Readonly<Record<string, string>> {
    // Compile an equivalent configuration from actual resources while preserving output blocks.
    // Missing referenced objects cannot yield an invented value; report the unsupported refresh.
    const configured = TfConfiguration.compile(world.terraform.files);
    const outputs = { ...configured.outputs };
    for (const r of configured.resources) {
      const found = actual.find((a) => a.address === r.address);
      if (!found && Object.keys(outputs).length)
        fail(
          "Refresh outputs referencing deleted resources is not supported yet; remove those outputs first.",
        );
    }
    // Values that depend on mutable attributes require evaluation against the observed values.
    return TfConfiguration.outputsFrom(world.terraform.files, actual);
  },
  apply(world: World, plan: TfPlan): World {
    if (plan.serial !== world.terraform.serial)
      fail("Saved plan is stale: state serial changed. Run terraform plan again.");
    const actual = ordered(
      world.terraform.resources.flatMap((r) => {
        const observed = read(world, r);
        return observed ? [observed] : [];
      }),
    );
    if (!equal(actual, plan.before))
      fail("Saved plan is stale: remote resources changed. Run terraform plan again.");
    for (const r of plan.after) TfConfiguration.validateResource(r);
    const changes = plan.mode === "refresh-only" ? [] : diff(plan.before, plan.after);
    if (!equal(changes, plan.changes)) fail("Invalid saved plan changes.");
    if (plan.mode === "refresh-only" && !equal(plan.after, plan.before))
      fail("Invalid refresh-only plan.");
    if (plan.mode === "destroy" && plan.after.length) fail("Invalid destroy plan.");
    const next = changes.reduce((w, c) => mutate(w, c, true), world);
    return {
      ...next,
      terraform: {
        ...world.terraform,
        resources: plan.after,
        outputs: plan.outputs,
        serial: world.terraform.serial + 1,
      },
    };
  },
  summary(plan: TfPlan): string {
    const entries = plan.changes.map(
      (c) =>
        `${c.action === "create" ? "+" : c.action === "delete" ? "-" : "~"} ${c.resource.address} (${TerraformState.id(c.resource)})${c.action === "update" ? ` private_ip_google_access = ${c.resource.privateAccess}` : ""}`,
    );
    const count = (action: TfChange["action"]): number =>
      plan.changes.filter((c) => c.action === action).length;
    const summary =
      plan.mode === "refresh-only"
        ? "Refresh-only: state and outputs only; infrastructure will not be changed."
        : plan.changes.length
          ? `Plan: ${count("create")} to add, ${count("update")} to change, ${count("delete")} to destroy.`
          : "No resource changes. Infrastructure matches the configuration.";
    const drift = plan.drift.map(
      (c) =>
        `Detected drift: ${c.action} ${c.resource.address} ${JSON.stringify(TerraformState.record(c.resource))}`,
    );
    return [...drift, ...entries, summary, `Outputs: ${JSON.stringify(plan.outputs)}`].join("\n");
  },
} as const;
