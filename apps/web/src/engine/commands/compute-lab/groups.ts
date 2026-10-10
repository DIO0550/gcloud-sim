import { Flag, ParsedArgs, type ProjectContext } from "@/engine/cli/command-spec";
import { addMember } from "@/engine/commands/compute/groups";
import { clock, type MigConfig, sameRef, saveMig } from "@/engine/domains/compute-lab/model";
import { type InstanceTemplate, ManagedInstanceGroup } from "@/engine/domains/instance-groups";
import { World } from "@/engine/domains/world";
import { Result } from "@/utils/Result";
import {
  command,
  finish,
  integer,
  invalid,
  missing,
  observed,
  ref,
  rf,
  sf,
  text,
  zf,
} from "./shared";
import { checkActAs, removeVmLab } from "./vms";

const groupArg = (c: ProjectContext, a: ParsedArgs) =>
  Result.flatMap(ref(c, a), (r) => {
    const g = c.world.instanceGroups.find((g) => sameRef({ ...g, location: g.location }, r));
    return g ? Result.ok(g) : missing("MIG missing in selected project / location.");
  });
const templateArg = (c: ProjectContext, template: string) => {
  const t = c.world.instanceTemplates.find(
    (t) => t.projectId === c.project.projectId && t.name === template,
  );
  if (!t) {
    return missing("Template missing in selected project.");
  }
  if (t.serviceAccount.some) {
    return Result.map(checkActAs(c, t.serviceAccount.value), () => t);
  }
  return Result.ok(t);
};
const config = (w: World, g: ManagedInstanceGroup): MigConfig =>
  w.computeLab.migs.find((m) => sameRef(m, { ...g, location: g.location })) ?? {
    projectId: g.projectId,
    name: g.name,
    location: g.location,
    desiredTemplate: g.template,
    applied: Object.fromEntries(g.instanceNames.map((n) => [n, g.template])),
    pending: [],
    maxSurge: 1,
    maxUnavailable: 0,
    healthCheck: "",
    initialDelay: 0,
    failed: [],
    failedAt: -1,
    repairs: 0,
  };
const replaceMembers = (
  c: ProjectContext,
  w: World,
  g: ManagedInstanceGroup,
  template: InstanceTemplate,
  names: readonly string[],
) => {
  let next = w;
  for (const n of names) {
    const i = next.instances.find(
      (i) =>
        i.projectId === g.projectId &&
        i.name === n &&
        i.zone === ManagedInstanceGroup.zoneFor(g.location, g.instanceNames.indexOf(n)),
    );
    if (!i) {
      return missing("MIG member missing; repair group membership first.");
    }
    const replaced = addMember(c, removeVmLab(World.withoutInstance(next, i), i), template, {
      name: n,
      zone: i.zone,
    });
    if (!replaced.ok) {
      return replaced;
    }
    next = replaced.value;
  }
  return Result.ok(next);
};
const path = ["gcloud", "compute", "instance-groups", "managed"];
const simPath = ["sim", "compute", "instance-groups", "managed"];
export const MigCommands = [
  command(
    [...path, "set-instance-template"],
    "compute.instanceGroupManagers.update",
    (c, a) =>
      Result.flatMap(groupArg(c, a), (g) =>
        Result.flatMap(templateArg(c, text(a, "template")), (t) => {
          const old = config(c.world, g);
          const next = { ...old, desiredTemplate: t.name };
          return finish(
            saveMig(
              World.replaceNamed(c.world, "instanceGroups", { ...g, template: t.name }),
              next,
            ),
            { ...next },
          );
        }),
      ),
    [zf, rf, sf("template", true)],
  ),
  command(
    [...path, "rolling-action", "start-update"],
    "compute.instanceGroupManagers.update",
    (c, a) =>
      Result.flatMap(groupArg(c, a), (g) => {
        const version = ParsedArgs.keyvalue(a, "version");
        if (Object.keys(version).some((k) => k !== "template") || !version.template) {
          return invalid(
            "Only --version=template=<name> is supported; canary is outside this model.",
          );
        }
        return Result.flatMap(templateArg(c, version.template), (t) => {
          const old = config(c.world, g);
          if (old.pending.length) {
            return invalid("Finish the current rollout before starting another.");
          }
          const next = {
            ...old,
            desiredTemplate: t.name,
            pending: g.instanceNames.filter((n) => old.applied[n] !== t.name),
            maxSurge: integer(a, "max-surge", 1),
            maxUnavailable: integer(a, "max-unavailable", 0),
          };
          return finish(
            saveMig(
              World.replaceNamed(c.world, "instanceGroups", { ...g, template: t.name }),
              next,
            ),
            { ...next, state: "UPDATING" },
          );
        });
      }),
    [
      zf,
      rf,
      Flag.keyvalue("version", "Single template version.", { required: true }),
      Flag.integer("max-surge", "Batch surge budget."),
      Flag.integer("max-unavailable", "Batch unavailable budget."),
    ],
  ),
  command(
    [...simPath, "advance-update"],
    [
      "compute.instanceGroupManagers.update",
      "compute.instances.create",
      "compute.instances.delete",
    ],
    (c, a) =>
      Result.flatMap(groupArg(c, a), (g) => {
        const old = config(c.world, g);
        if (!old.pending.length) {
          return invalid(
            "No pending rollout; starting an update does not replace members until advanced.",
          );
        }
        return Result.flatMap(templateArg(c, old.desiredTemplate), (t) => {
          const names = old.pending.slice(0, old.maxSurge + old.maxUnavailable);
          return Result.flatMap(replaceMembers(c, c.world, g, t, names), (w) => {
            const next = {
              ...old,
              pending: old.pending.filter((n) => !names.includes(n)),
              applied: { ...old.applied, ...Object.fromEntries(names.map((n) => [n, t.name])) },
            };
            return observed(saveMig(w, next), next, "rollout", {
              updated: names,
              pending: next.pending,
              state: next.pending.length ? "UPDATING" : "STABLE",
              template: t.name,
            });
          });
        });
      }),
    [zf, rf],
  ),
  command(
    [...path, "update"],
    "compute.instanceGroupManagers.update",
    (c, a) =>
      Result.flatMap(groupArg(c, a), (g) => {
        const healthCheck = text(a, "health-check");
        const h = c.world.healthChecks.find(
          (h) => h.projectId === g.projectId && h.name === healthCheck,
        );
        const region = g.location.includes("-") ? g.location.replace(/-[a-z]$/, "") : g.location;
        if (!h || (h.scope?.kind === "region" && h.scope.region !== region)) {
          return missing("Autohealing health check missing / scope mismatch.");
        }
        const next = {
          ...config(c.world, g),
          healthCheck,
          initialDelay: integer(a, "initial-delay", 0),
        };
        return finish(saveMig(c.world, next), { ...next });
      }),
    [
      zf,
      rf,
      sf("health-check", true),
      Flag.integer("initial-delay", "Seconds in virtual time before repair."),
    ],
  ),
  command(
    [...simPath, "fail-instance"],
    "compute.instanceGroupManagers.update",
    (c, a) =>
      Result.flatMap(groupArg(c, a), (g) => {
        const n = text(a, "instance");
        const m = config(c.world, g);
        const i = c.world.instances.find(
          (i) =>
            i.projectId === g.projectId &&
            i.name === n &&
            i.zone === ManagedInstanceGroup.zoneFor(g.location, g.instanceNames.indexOf(n)),
        );
        if (!i || !g.instanceNames.includes(n) || !m.healthCheck) {
          return invalid("Autohealing must be configured and target must be a member of this MIG.");
        }
        const next = { ...m, failed: [...new Set([...m.failed, n])], failedAt: clock(c.world) };
        return finish(
          saveMig(World.replaceInstance(c.world, { ...i, status: "TERMINATED" }), next),
          { ...next, state: "UNHEALTHY" },
        );
      }),
    [zf, rf, sf("instance", true)],
  ),
  command(
    [...simPath, "autoheal"],
    [
      "compute.instanceGroupManagers.update",
      "compute.instances.create",
      "compute.instances.delete",
    ],
    (c, a) =>
      Result.flatMap(groupArg(c, a), (g) => {
        const m = config(c.world, g);
        if (!m.healthCheck || !m.failed.length || clock(c.world) - m.failedAt < m.initialDelay) {
          return invalid("No failed members or autohealing initial delay has not elapsed.");
        }
        return Result.flatMap(templateArg(c, m.desiredTemplate), (t) =>
          Result.flatMap(replaceMembers(c, c.world, g, t, m.failed), (w) => {
            const next = {
              ...m,
              failed: [],
              failedAt: -1,
              repairs: m.repairs + m.failed.length,
              pending: m.pending.filter((n) => !m.failed.includes(n)),
              applied: { ...m.applied, ...Object.fromEntries(m.failed.map((n) => [n, t.name])) },
            };
            return observed(saveMig(w, next), next, "autoheal", {
              repaired: m.failed,
              repairs: next.repairs,
            });
          }),
        );
      }),
    [zf, rf],
  ),
  command(
    [...simPath, "evaluate-autoscaling"],
    "compute.instanceGroupManagers.get",
    (c, a) =>
      Result.flatMap(groupArg(c, a), (g) => {
        if (!g.autoscaling.some) {
          return invalid("Set autoscaling first.");
        }
        const cpu = Number(text(a, "cpu-utilization"));
        const elapsed = integer(a, "elapsed-seconds", 0);
        if (!Number.isFinite(cpu) || cpu < 0 || cpu > 1 || elapsed < 0) {
          return invalid("CPU sample must be finite 0..1; elapsed time must be nonnegative.");
        }
        const autoscaling = g.autoscaling.value;
        const desired = Math.max(
          autoscaling.minReplicas,
          Math.min(
            autoscaling.maxReplicas,
            Math.ceil((g.targetSize * cpu) / autoscaling.targetCpuUtilization),
          ),
        );
        const recommended = elapsed < autoscaling.coolDownPeriodSec ? g.targetSize : desired;
        return observed(
          c.world,
          { projectId: g.projectId, name: g.name, location: g.location },
          "autoscaling",
          {
            cpu,
            elapsed,
            recommended,
            current: g.targetSize,
            cooldown: elapsed < autoscaling.coolDownPeriodSec,
          },
        );
      }),
    [
      zf,
      rf,
      sf("cpu-utilization", true),
      Flag.integer("elapsed-seconds", "Time since last change.", { required: true }),
    ],
  ),
  command(
    [...path, "resize"],
    [
      "compute.instanceGroupManagers.update",
      "compute.instances.create",
      "compute.instances.delete",
    ],
    (c, a) =>
      Result.flatMap(groupArg(c, a), (g) => {
        const size = integer(a, "size", -1);
        const m = config(c.world, g);
        if (size < 0 || size > 100 || m.pending.length || m.failed.length) {
          return invalid("Size must be 0..100; finish update / repair before resize.");
        }
        return Result.flatMap(templateArg(c, g.template), (t) => {
          let world = c.world;
          const names = [...g.instanceNames.slice(0, size)];
          for (const n of g.instanceNames.slice(size)) {
            const i = world.instances.find(
              (i) =>
                i.projectId === g.projectId &&
                i.name === n &&
                i.zone === ManagedInstanceGroup.zoneFor(g.location, g.instanceNames.indexOf(n)),
            );
            if (i) {
              world = removeVmLab(World.withoutInstance(world, i), i);
            }
          }
          for (const n of ManagedInstanceGroup.memberNames(
            g.baseInstanceName,
            world.sequence + 1,
            Math.max(0, size - g.targetSize),
          )) {
            const added = addMember(c, world, t, {
              name: n,
              zone: ManagedInstanceGroup.zoneFor(g.location, names.length),
            });
            if (!added.ok) {
              return added;
            }
            world = added.value;
            names.push(n);
          }
          const next = { ...g, targetSize: size, instanceNames: names };
          const applied = Object.fromEntries(names.map((n) => [n, m.applied[n] ?? g.template]));
          return finish(
            saveMig(World.replaceNamed(world, "instanceGroups", next), { ...m, applied }),
            { name: g.name, size, members: names },
          );
        });
      }),
    [zf, rf, Flag.integer("size", "Target 0..100.", { required: true })],
  ),
  command(
    [...simPath, "describe"],
    "compute.instanceGroupManagers.get",
    (c, a) =>
      Result.flatMap(groupArg(c, a), (g) =>
        finish(c.world, { ...config(c.world, g), targetSize: g.targetSize }),
      ),
    [zf, rf],
  ),
];
