import { CommandFailure } from "@/engine/cli/command-failure";
import { Flag, ParsedArgs, type ProjectContext } from "@/engine/cli/command-spec";
import { instanceArg, resolveServiceAccount } from "@/engine/commands/compute/shared";
import { MachineType, type MachineTypeName, Zone } from "@/engine/domains/catalog";
import { Instance } from "@/engine/domains/compute";
import {
  patchCompute,
  sameRef,
  saveConfig,
  type TpuVm,
  TpuZones,
  type VmConfig,
  validVmConfig,
  vmConfig,
  vmRef,
} from "@/engine/domains/compute-lab/model";
import { allows, attachAccount } from "@/engine/domains/serverless-lab/runtime";
import { ServiceAccount } from "@/engine/domains/service-account";
import { World } from "@/engine/domains/world";
import { Result } from "@/utils/Result";
import {
  command,
  finish,
  integer,
  invalid,
  list,
  missing,
  observed,
  ref,
  sf,
  text,
  zf,
} from "./shared";

export const SchedulingFlags = [
  Flag.enum("maintenance-policy", "Host maintenance behavior.", ["MIGRATE", "TERMINATE"]),
  Flag.boolean("restart-on-failure", "Automatic restart; use --no-restart-on-failure to disable."),
  Flag.enum("instance-termination-action", "Spot termination action.", ["STOP", "DELETE"]),
  Flag.keyvalue("accelerator", "Only type=nvidia-tesla-t4,count=1 in N1 / us-central1-a,b,c."),
];
export const configFromArgs = (
  i: Instance,
  a: ParsedArgs,
  previous: VmConfig,
): Result<VmConfig, CommandFailure> => {
  const gpu = ParsedArgs.keyvalue(a, "accelerator");
  if (Object.keys(gpu).some((k) => !["type", "count"].includes(k))) {
    return invalid("Unsupported accelerator attribute.");
  }
  const config: VmConfig = {
    ...previous,
    ...vmRef(i),
    maintenance: text(a, "maintenance-policy", previous.maintenance) as VmConfig["maintenance"],
    automaticRestart: ParsedArgs.has(a, "restart-on-failure")
      ? ParsedArgs.boolean(a, "restart-on-failure")
      : previous.automaticRestart,
    terminationAction: text(
      a,
      "instance-termination-action",
      previous.terminationAction,
    ) as VmConfig["terminationAction"],
    gpuType: gpu.type ?? previous.gpuType,
    gpuCount: gpu.count === undefined ? previous.gpuCount : Number(gpu.count),
  };
  return validVmConfig(i, config)
    ? Result.ok(config)
    : invalid(
        "Invalid scheduling: Spot/preemptible requires TERMINATE and no automatic restart; T4 requires N1, count=1, supported zone and TERMINATE.",
      );
};
export const resolveCustomMachine = (
  a: ParsedArgs,
  fallback: string,
): Result<MachineTypeName, CommandFailure> => {
  const custom =
    ParsedArgs.has(a, "custom-cpu") ||
    ParsedArgs.has(a, "custom-memory") ||
    ParsedArgs.has(a, "custom-vm-type");
  if (custom && ParsedArgs.has(a, "machine-type")) {
    return invalid("--machine-type cannot be combined with custom flags.");
  }
  let value = text(a, "machine-type", fallback);
  if (custom) {
    const cpu = integer(a, "custom-cpu", 0);
    const memory = /^(\d+(?:\.\d+)?)(GB|MB)$/i.exec(text(a, "custom-memory"));
    if (!memory) {
      return invalid("Custom memory requires MB or GB.");
    }
    const mb = Number(memory[1]) * (memory[2]?.toUpperCase() === "GB" ? 1024 : 1);
    value = `${text(a, "custom-vm-type", "n2")}-custom-${cpu}-${mb}`;
  }
  const shape = MachineType.parse(value);
  return shape.some
    ? Result.ok(shape.value.name)
    : invalid("Unsupported machine / custom CPU-memory combination.");
};
export const CustomFlags = [
  Flag.integer("custom-cpu", "N1/N2 custom vCPUs."),
  sf("custom-memory"),
  Flag.enum("custom-vm-type", "Custom family.", ["n1", "n2"]),
];
export const checkActAs = (ctx: ProjectContext, email: string) => {
  // The original fixture's implicit Compute identity remains available to old exercises.
  // Explicit user-managed identities always require actAs on that identity.
  if (email === ServiceAccount.defaultComputeEmail(ctx.project.projectNumber)) {
    return Result.ok(email);
  }
  return Result.mapErr(
    attachAccount(ctx.world, ctx.project.projectId, ctx.principal, email),
    CommandFailure.invalidArgumentWith,
  );
};
export const runtimeAllowed = (w: World, i: Instance, permission: string, scope: string) => {
  const acceptedScopes = ["https://www.googleapis.com/auth/cloud-platform", scope];
  if (scope.endsWith("devstorage.read_only")) {
    acceptedScopes.push(
      "https://www.googleapis.com/auth/devstorage.read_write",
      "https://www.googleapis.com/auth/devstorage.full_control",
    );
  }
  return (
    allows(w, i.projectId, i.serviceAccount, permission) &&
    i.scopes.some((s) => acceptedScopes.includes(s))
  );
};

const tpuArg = (c: ProjectContext, a: ParsedArgs) =>
  Result.flatMap(ref(c, a), (r) => {
    const t = c.world.computeLab.tpus.find((v) => sameRef(v, r));
    return t ? Result.ok(t) : missing("TPU VM not found in the selected project / zone.");
  });
const tpuPath = ["gcloud", "compute", "tpus", "tpu-vm"];
export const VmCommands = [
  command(
    ["sim", "compute", "time", "advance"],
    "compute.instances.get",
    (c, a) => {
      const seconds = integer(a, "seconds", 0);
      if (
        seconds < 1 ||
        seconds > 31536000 ||
        c.world.dataProcessing.clock + seconds > 3153600000
      ) {
        return invalid("Advance virtual time by 1..31536000 seconds.");
      }
      const world = {
        ...c.world,
        dataProcessing: {
          ...c.world.dataProcessing,
          clock: c.world.dataProcessing.clock + seconds,
        },
      };
      return finish(world, {
        clock: world.dataProcessing.clock,
        execution: "Virtual time only; schedules and repairs require explicit advance commands.",
      });
    },
    [Flag.integer("seconds", "Virtual seconds.", { required: true })],
    false,
  ),
  command(
    ["sim", "compute", "instances", "os-login-check"],
    ["compute.instances.get", "compute.instances.osLogin"],
    (c, a) =>
      Result.flatMap(instanceArg(c, a), (i) => {
        const enabled =
          i.metadata["enable-oslogin"] ??
          c.world.projectMetadata.find((m) => m.projectId === i.projectId)?.items["enable-oslogin"];
        if (enabled?.toUpperCase() !== "TRUE" || i.status !== "RUNNING") {
          return invalid("Enable OS Login on a running VM first.");
        }
        if (
          ParsedArgs.boolean(a, "admin") &&
          !allows(c.world, i.projectId, c.principal, "compute.instances.osAdminLogin")
        ) {
          return invalid("Admin login requires compute.instances.osAdminLogin.");
        }
        if (c.world.serviceAccounts.some((s) => s.email === i.serviceAccount)) {
          const actAs = checkActAs(c, i.serviceAccount);
          if (!actAs.ok) {
            return actAs;
          }
        }
        return observed(c.world, vmRef(i), "os-login", {
          principal: c.principal,
          admin: ParsedArgs.boolean(a, "admin"),
          allowed: true,
        });
      }),
    [zf, Flag.boolean("admin", "Check administrator OS Login.")],
  ),
  command(
    ["gcloud", "compute", "instances", "detach-disk"],
    "compute.instances.attachDisk",
    (c, a) =>
      Result.flatMap(instanceArg(c, a), (i) => {
        const d = c.world.computeLab.disks.find(
          (d) =>
            d.projectId === i.projectId &&
            d.name === text(a, "disk") &&
            d.users.includes(`${i.zone}/${i.name}`),
        );
        if (!d) {
          return missing(
            "Attached Compute lab disk missing; legacy disks are outside this detach lesson.",
          );
        }
        const next = { ...d, users: [] };
        return finish(
          patchCompute(c.world, {
            disks: c.world.computeLab.disks.map((v) => (sameRef(v, d) ? next : v)),
          }),
          { ...next },
        );
      }),
    [zf, sf("disk", true)],
  ),
  command(
    ["gcloud", "compute", "instances", "set-scheduling"],
    "compute.instances.setScheduling",
    (c, a) =>
      Result.flatMap(instanceArg(c, a), (i) =>
        Result.flatMap(configFromArgs(i, a, vmConfig(c.world, i)), (config) =>
          finish(saveConfig(c.world, config), { ...config }),
        ),
      ),
    [zf, ...SchedulingFlags],
  ),
  command(
    ["gcloud", "compute", "instances", "set-service-account"],
    "compute.instances.setServiceAccount",
    (c, a) =>
      Result.flatMap(instanceArg(c, a), (i) => {
        if (i.status !== "TERMINATED") {
          return invalid("Stop the VM before changing service account / scopes.");
        }
        return Result.flatMap(resolveServiceAccount(c, a), (email) =>
          Result.flatMap(checkActAs(c, email), () => {
            const scopes = ParsedArgs.list(a, "scopes");
            if (
              scopes.length !== 1 ||
              !["cloud-platform", "storage-ro", "storage-rw"].includes(scopes[0] ?? "")
            ) {
              return invalid(
                "This lesson requires exactly one cloud-platform / storage-ro / storage-rw scope.",
              );
            }
            const scopeMap: Readonly<Record<string, string>> = {
              "cloud-platform": "cloud-platform",
              "storage-ro": "devstorage.read_only",
              "storage-rw": "devstorage.read_write",
            };
            const next = {
              ...i,
              serviceAccount: email,
              scopes: [`https://www.googleapis.com/auth/${scopeMap[scopes[0] ?? ""]}`],
            };
            return finish(World.replaceInstance(c.world, next), Instance.toRecord(next));
          }),
        );
      }),
    [
      zf,
      sf("service-account", true),
      Flag.list("scopes", "Runtime OAuth scopes.", { required: true }),
    ],
  ),
  command(
    ["sim", "compute", "instances", "runtime-check"],
    "compute.instances.get",
    (c, a) =>
      Result.flatMap(instanceArg(c, a), (i) => {
        const action = text(a, "operation");
        const operations = {
          "storage-read": ["storage.objects.get", "devstorage.read_only"],
          "storage-write": ["storage.objects.create", "devstorage.read_write"],
        } as const;
        if (!Object.hasOwn(operations, action)) {
          return invalid("Choose storage-read or storage-write; no arbitrary API call.");
        }
        const [permission, scope] = operations[action as keyof typeof operations];
        if (
          i.status !== "RUNNING" ||
          !runtimeAllowed(c.world, i, permission, `https://www.googleapis.com/auth/${scope}`)
        ) {
          return invalid(
            "Runtime needs a RUNNING VM, service account IAM permission AND OAuth scope.",
          );
        }
        return observed(c.world, vmRef(i), action, {
          allowed: true,
          serviceAccount: i.serviceAccount,
          permission,
        });
      }),
    [zf, sf("operation", true)],
  ),
  command(
    ["sim", "compute", "instances", "preempt"],
    "compute.instances.stop",
    (c, a) =>
      Result.flatMap(instanceArg(c, a), (i) => {
        if (!(i.preemptible || i.provisioningModel === "SPOT") || i.status !== "RUNNING") {
          return invalid("Only a running Spot / preemptible VM can be preempted.");
        }
        const config = vmConfig(c.world, i);
        if (
          config.terminationAction === "DELETE" &&
          (c.world.instanceGroups.some(
            (g) => g.projectId === i.projectId && g.instanceNames.includes(i.name),
          ) ||
            c.world.lbResources.some(
              (r) =>
                r.kind === "networkEndpointGroups" &&
                r.projectId === i.projectId &&
                r.location === `zones/${i.zone}` &&
                r.endpoints.some((e) => e.instance === i.name),
            ))
        ) {
          return invalid(
            "DELETE preemption for referenced MIG / NEG members is outside this lesson; use STOP.",
          );
        }
        const w =
          config.terminationAction === "DELETE"
            ? removeVmLab(World.withoutInstance(c.world, i), i)
            : World.replaceInstance(c.world, { ...i, status: "TERMINATED" });
        return observed(w, vmRef(i), "preempt", {
          action: config.terminationAction,
          state: "PREEMPTED",
        });
      }),
    [zf],
  ),
  command(
    [...tpuPath, "create"],
    "tpu.nodes.create",
    (c, a) =>
      Result.flatMap(ref(c, a), (r) => {
        const type = text(a, "accelerator-type") as TpuVm["type"];
        if (
          !Object.hasOwn(TpuZones, type) ||
          !TpuZones[type].includes(r.location) ||
          text(a, "version") !== "tpu-vm-base"
        ) {
          return invalid(
            "Supported TPU: v2-8 in us-central1-b,c or v3-8 in us-central1-a,b; version=tpu-vm-base.",
          );
        }
        const network = text(a, "network", "default");
        if (!c.world.networks.some((n) => n.projectId === r.projectId && n.name === network)) {
          return missing("TPU network missing.");
        }
        return Result.flatMap(resolveServiceAccount(c, a), (serviceAccount) =>
          Result.flatMap(checkActAs(c, serviceAccount), () => {
            if (c.world.computeLab.tpus.some((v) => sameRef(v, r))) {
              return invalid("TPU already exists.");
            }
            const t: TpuVm = {
              ...r,
              type,
              version: "tpu-vm-base",
              network,
              serviceAccount,
              preemptible: ParsedArgs.boolean(a, "preemptible"),
              state: "READY",
            };
            return finish(patchCompute(c.world, { tpus: [...c.world.computeLab.tpus, t] }), {
              ...t,
            });
          }),
        );
      }),
    [
      zf,
      sf("accelerator-type", true),
      sf("version", true),
      sf("network"),
      sf("service-account"),
      Flag.boolean("preemptible", "Interruptible TPU."),
    ],
    true,
    "tpu.googleapis.com",
  ),
  command(
    [...tpuPath, "list"],
    "tpu.nodes.list",
    (c) =>
      list(
        c.world,
        c.world.computeLab.tpus
          .filter((t) => t.projectId === c.project.projectId)
          .map((t) => ({ ...t })),
      ),
    [],
    false,
    "tpu.googleapis.com",
  ),
  command(
    [...tpuPath, "describe"],
    "tpu.nodes.get",
    (c, a) => Result.flatMap(tpuArg(c, a), (t) => finish(c.world, { ...t })),
    [zf],
    true,
    "tpu.googleapis.com",
  ),
  ...(["start", "stop", "delete"] as const).map((op) =>
    command(
      [...tpuPath, op],
      op === "delete" ? "tpu.nodes.delete" : "tpu.nodes.update",
      (c, a) =>
        Result.flatMap(tpuArg(c, a), (t) => {
          const next: TpuVm = { ...t, state: op === "start" ? "READY" : "STOPPED" };
          const tpus = c.world.computeLab.tpus.filter((v) => !sameRef(v, t));
          return finish(patchCompute(c.world, { tpus: op === "delete" ? tpus : [...tpus, next] }), {
            ...next,
            operation: op,
          });
        }),
      [zf],
      true,
      "tpu.googleapis.com",
      op === "delete",
    ),
  ),
  command(
    ["gcloud", "compute", "os-config", "inventories", "describe"],
    "osconfig.inventories.get",
    (c, a) =>
      Result.flatMap(instanceArg(c, a), (i) => {
        if (
          i.metadata["enable-osconfig"] !== "TRUE" ||
          i.status !== "RUNNING" ||
          !i.disks.some((d) => d.boot && d.sourceImage.includes("/debian-12-"))
        ) {
          return invalid(
            "Inventory requires enable-osconfig=TRUE and a running VM; agent execution is simulated.",
          );
        }
        return observed(c.world, vmRef(i), "inventory", {
          os: "debian-12",
          agent: "simulated",
          packages: ["openssl", "curl"],
        });
      }),
    [zf],
    true,
    "osconfig.googleapis.com",
  ),
  command(
    ["gcloud", "compute", "os-config", "os-policy-assignments", "create"],
    "osconfig.osPolicyAssignments.create",
    (c, a) =>
      Result.flatMap(ref(c, a), (r) => {
        const instance = text(a, "instance");
        if (
          !Zone.parse(r.location).some ||
          !c.world.instances.some(
            (i) => i.projectId === r.projectId && i.zone === r.location && i.name === instance,
          )
        ) {
          return missing("OS policy target VM missing in zone.");
        }
        if (
          text(a, "policy") !== "security-updates" ||
          c.world.computeLab.osPolicies.some((v) => sameRef(v, r))
        ) {
          return invalid("Only security-updates is supported; assignment must be new.");
        }
        const policy = {
          ...r,
          instance,
          policy: "security-updates" as const,
          state: "PENDING" as const,
        };
        return finish(
          patchCompute(c.world, { osPolicies: [...c.world.computeLab.osPolicies, policy] }),
          { ...policy },
        );
      }),
    [zf, sf("instance", true), sf("policy", true)],
    true,
    "osconfig.googleapis.com",
  ),
  ...(["describe", "delete", "apply"] as const).map((op) =>
    command(
      [op === "apply" ? "sim" : "gcloud", "compute", "os-config", "os-policy-assignments", op],
      `osconfig.osPolicyAssignments.${({ describe: "get", apply: "update", delete: "delete" } as const)[op]}`,
      (c, a) =>
        Result.flatMap(ref(c, a), (r) => {
          const policy = c.world.computeLab.osPolicies.find((v) => sameRef(v, r));
          if (!policy) {
            return missing("OS policy assignment missing.");
          }
          if (op === "describe") {
            return finish(c.world, { ...policy });
          }
          const kept = c.world.computeLab.osPolicies.filter((v) => !sameRef(v, r));
          if (op === "delete") {
            return finish(patchCompute(c.world, { osPolicies: kept }), { deleted: policy.name });
          }
          const i = c.world.instances.find(
            (i) =>
              i.projectId === r.projectId && i.zone === r.location && i.name === policy.instance,
          );
          if (
            i?.status !== "RUNNING" ||
            i.metadata["enable-osconfig"] !== "TRUE" ||
            !i.serviceAccount ||
            !i.disks.some((d) => d.boot && d.sourceImage.includes("/debian-12-"))
          ) {
            return invalid(
              "OS policy needs a running VM, attached service account and enable-osconfig=TRUE.",
            );
          }
          const next = { ...policy, state: "SUCCEEDED" as const };
          return finish(patchCompute(c.world, { osPolicies: [...kept, next] }), {
            ...next,
            execution: "fixed package policy only",
          });
        }),
      [zf],
      true,
      "osconfig.googleapis.com",
      op === "delete",
    ),
  ),
];
export const removeVmLab = (w: World, i: Instance): World =>
  patchCompute(
    {
      ...w,
      disks: w.disks.map((d) =>
        d.projectId === i.projectId && d.zone === i.zone
          ? { ...d, users: d.users.filter((n) => n !== i.name) }
          : d,
      ),
    },
    {
      configs: w.computeLab.configs.filter((v) => !sameRef(v, vmRef(i))),
      diskData: w.computeLab.diskData.filter(
        (v) => !(sameRef(v, vmRef(i)) && i.disks.some((d) => d.boot && d.deviceName === v.name)),
      ),
      disks: w.computeLab.disks.map((d) => ({
        ...d,
        users: d.users.filter((u) => u !== `${i.zone}/${i.name}` || d.projectId !== i.projectId),
      })),
      osPolicies: w.computeLab.osPolicies.filter(
        (p) => !(p.projectId === i.projectId && p.location === i.zone && p.instance === i.name),
      ),
    },
  );
