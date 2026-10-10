import type { World } from "@/engine/domains/world";
import type { IdentityPool, IdentityProvider } from "./model";
export const poolPath = (
  world: World,
  pool: Pick<IdentityPool, "kind" | "owner" | "name">,
): string => {
  if (pool.kind === "workforce") {
    return `locations/global/workforcePools/${pool.name}`;
  }
  const number = world.projects.find((p) => p.projectId === pool.owner)?.projectNumber ?? "";
  return `projects/${number}/locations/global/workloadIdentityPools/${pool.name}`;
};
export const providerPath = (world: World, provider: IdentityProvider): string =>
  `${poolPath(world, { ...provider, name: provider.pool })}/providers/${provider.name}`;

/** Recheck current resources; history may outlive a deleted provider or service account. */
export const credentialAvailable = (
  world: World,
  credential: import("./model").ShortCredential,
): boolean => {
  const serviceAccount = world.serviceAccounts.some((s) => s.email === credential.subject);
  if (credential.method === "impersonation") {
    return serviceAccount;
  }
  const provider = world.adminLab.providers.find(
    (p) => providerPath(world, p) === credential.caller && !p.disabled,
  );
  const pool =
    provider &&
    world.adminLab.pools.find(
      (p) =>
        p.kind === provider.kind &&
        p.owner === provider.owner &&
        p.name === provider.pool &&
        !p.disabled,
    );
  return Boolean(
    provider && pool && (credential.subject.startsWith("principal://") || serviceAccount),
  );
};
