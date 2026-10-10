import { MachineType, Zone } from "@/engine/domains/catalog";
import type { World } from "@/engine/domains/world";
import { scopeChain } from "./policies";
export const QuotaRegions = ["us-central1", "us-east1", "asia-northeast1"] as const;
export const quotaUsage = (world: World, scope: string, region: string): number =>
  world.instances
    .filter(
      (r) =>
        r.status === "RUNNING" &&
        Zone.region(r.zone) === region &&
        scopeChain(world, `projects/${r.projectId}`).includes(scope),
    )
    .reduce((sum, r) => {
      const machine = MachineType.parse(r.machineType);
      return sum + (machine.some ? machine.value.guestCpus : 0);
    }, 0);
export const quotaViolation = (before: World, after: World): string => {
  for (const quota of after.adminLab.quotas) {
    const usage = quotaUsage(after, quota.scope, quota.region);
    if (usage > quota.granted && usage > quotaUsage(before, quota.scope, quota.region)) {
      return `CPU teaching quota exceeded: ${usage} requested, ${quota.granted} granted in ${quota.region}. A preference request does not itself grant additional quota.`;
    }
  }
  return "";
};
