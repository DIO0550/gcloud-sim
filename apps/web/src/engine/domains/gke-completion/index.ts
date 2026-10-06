import { Region, Zone } from "@/engine/domains/catalog";
import { EffectivePermissions } from "@/engine/domains/effective-permissions";
import { KubeMulti } from "@/engine/domains/kube-multi";
import { KubeNamespace } from "@/engine/domains/kube-namespace";
import { KubeResources } from "@/engine/domains/kube-resources";
import { type KubeDeployment, KubeName, KubePod } from "@/engine/domains/kubernetes";
import type { GkeCluster } from "@/engine/domains/managed-services";
import { World } from "@/engine/domains/world";
import type { JsonRecord } from "@/types/Json";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

export type KubeServiceAccount = Readonly<{
  projectId: string;
  cluster: string;
  namespace: string;
  name: string;
  gcpServiceAccount: string;
  createdAt: string;
}>;
export type KubeVpa = Readonly<{
  projectId: string;
  cluster: string;
  namespace: string;
  name: string;
  target: string;
  container: string;
  mode: "Off" | "Initial" | "Recreate";
  createdAt: string;
  recommendation: Option<Readonly<{ cpuMilli: number; memoryBytes: number; evaluatedAt: string }>>;
}>;

export const GkePlacement = {
  zones(c: GkeCluster): readonly Zone[] {
    if (c.nodeLocations) {
      return c.nodeLocations;
    }
    if (Option.isSome(Zone.parse(c.location))) {
      return [c.location as Zone];
    }

    return Zone.all().filter((z) => Zone.region(z) === c.location);
  },

  parse(location: string, value: string | undefined): Result<readonly Zone[], string> {
    const regional = Option.isSome(Region.parse(location));
    const region = regional ? location : location.slice(0, -2);
    const input =
      value === undefined
        ? Zone.all().filter((z) => (regional ? Zone.region(z) === region : z === location))
        : value.split(",");
    if (input.length < 1 || input.length > 3 || new Set(input).size !== input.length) {
      return Result.err("node-locations requires one to three unique zones.");
    }
    const parsed = input.map(Zone.parse);
    if (parsed.some((z) => !Option.isSome(z))) {
      return Result.err("Unknown node location.");
    }
    const zones = parsed.flatMap((z) => (Option.isSome(z) ? [z.value] : []));
    if (zones.some((z) => Zone.region(z) !== region)) {
      return Result.err("All node locations must be in the cluster region.");
    }

    return Result.ok(zones);
  },
} as const;

export const KubeIdentity = {
  accounts(world: World, c: GkeCluster, namespace: string): readonly KubeServiceAccount[] {
    return [
      {
        projectId: c.projectId,
        cluster: c.name,
        namespace,
        name: "default",
        gcpServiceAccount: "",
        createdAt: "",
      },
      ...world.kubeServiceAccounts.filter(
        (s) => s.projectId === c.projectId && s.cluster === c.name && s.namespace === namespace,
      ),
    ];
  },

  valid(s: KubeServiceAccount): boolean {
    return (
      KubeNamespace.valid(s.namespace) &&
      Result.isOk(KubeName.parse(s.name)) &&
      s.name !== "default" &&
      Number.isFinite(Date.parse(s.createdAt)) &&
      (s.gcpServiceAccount === "" ||
        /^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(s.gcpServiceAccount))
    );
  },

  record(s: KubeServiceAccount): JsonRecord {
    return {
      apiVersion: "v1",
      kind: "ServiceAccount",
      metadata: {
        name: s.name,
        namespace: s.namespace,
        annotations:
          s.gcpServiceAccount.length > 0
            ? { "iam.gke.io/gcp-service-account": s.gcpServiceAccount }
            : {},
      },
    };
  },

  check(
    world: World,
    c: GkeCluster,
    d: KubeDeployment,
    bucket: string,
    permission: string,
    nodePool = "default-pool",
  ): Readonly<{ allowed: boolean; reason: string; principal: string }> {
    const denied = (reason: string) => ({ allowed: false, reason, principal: "" });
    if (!c.autopilot && c.workloadPool !== `${c.projectId}.svc.id.goog`) {
      return denied("WorkloadIdentityDisabled");
    }
    const pool = World.nodePoolsOf(world, c).find((p) => p.name === nodePool);
    if (
      !c.autopilot &&
      (!pool || pool.nodeCount === 0 || pool.workloadMetadata !== "GKE_METADATA")
    ) {
      return denied("GkeMetadataServerDisabled");
    }
    const account = KubeIdentity.accounts(world, c, d.namespace).find(
      (s) => s.name === (d.serviceAccountName ?? "default"),
    );
    if (!account) {
      return denied("KubernetesServiceAccountMissing");
    }
    const sa = world.serviceAccounts.find((s) => s.email === account.gcpServiceAccount);
    if (!sa || !Option.isSome(World.findActiveProject(world, sa.projectId))) {
      return denied("IamServiceAccountMissing");
    }
    if (!World.hasApi(world, sa.projectId, "iamcredentials.googleapis.com")) {
      return denied("IamCredentialsApiDisabled");
    }
    const member = `serviceAccount:${c.projectId}.svc.id.goog[${d.namespace}/${account.name}]`;
    const linked = sa.iamPolicy.bindings.some(
      (b) => b.role === "roles/iam.workloadIdentityUser" && b.members.some((m) => m === member),
    );
    if (!linked) {
      return denied("WorkloadIdentityBindingMissing");
    }
    const target = world.buckets.find((b) => b.name === bucket);
    if (!target || !Option.isSome(World.findActiveProject(world, target.projectId))) {
      return denied("BucketMissing");
    }
    const principal = `serviceAccount:${sa.email}` as const;
    const allowed = EffectivePermissions.resolve(world, principal, {
      type: "bucket",
      id: bucket,
    }).permissions.has(permission);
    return { allowed, reason: allowed ? "Allowed" : "ResourcePermissionDenied", principal };
  },
} as const;

export const KubeVpa = {
  valid(v: KubeVpa): boolean {
    const names = [v.name, v.target, v.container];
    if (!["Off", "Initial", "Recreate"].includes(v.mode)) {
      return false;
    }
    if (
      !names.every((n) => Result.isOk(KubeName.parse(n))) ||
      !KubeNamespace.valid(v.namespace) ||
      !Number.isFinite(Date.parse(v.createdAt))
    ) {
      return false;
    }
    if (!Option.isSome(v.recommendation)) {
      return true;
    }
    const r = v.recommendation.value;
    return (
      [r.cpuMilli, r.memoryBytes].every((n) => Number.isSafeInteger(n) && n > 0) &&
      r.cpuMilli <= 1_000_000_000 &&
      r.memoryBytes <= 1_099_511_627_776 &&
      Number.isFinite(Date.parse(r.evaluatedAt))
    );
  },

  resources(base: KubeResources, v: KubeVpa): Result<KubeResources, string> {
    if (!Option.isSome(v.recommendation)) {
      return Result.ok(base);
    }
    const r = v.recommendation.value;
    return KubeResources.parse({
      requests: { cpu: `${r.cpuMilli}m`, memory: String(r.memoryBytes) },
      limits: base.limits,
    });
  },

  admit(world: World, d: KubeDeployment): KubeDeployment {
    const cluster = world.clusters.find((c) => c.projectId === d.projectId && c.name === d.cluster);
    const v = world.kubeVpas.find(
      (v) =>
        v.projectId === d.projectId &&
        v.cluster === d.cluster &&
        v.namespace === d.namespace &&
        v.target === d.name,
    );
    const enabled = cluster?.autopilot === true || cluster?.verticalPodAutoscaling === true;
    const podResources = KubePod.fromDeployment(d).flatMap((p) =>
      KubeMulti.spec(d).map((c) => {
        const saved = d.podResources?.find(
          (s) => s.podName === p.name && s.containerName === c.name,
        );
        if (saved) {
          return saved;
        }
        if (!enabled || !v || v.mode === "Off" || v.container !== c.name) {
          return { podName: p.name, containerName: c.name, resources: c.resources };
        }
        const applied = KubeVpa.resources(c.resources, v);
        if (!Result.isOk(applied)) {
          return {
            podName: p.name,
            containerName: c.name,
            resources: c.resources,
            admissionError: `VpaAdmissionError: ${applied.error}`,
          };
        }

        return { podName: p.name, containerName: c.name, resources: applied.value };
      }),
    );

    return { ...d, podResources };
  },

  record(v: KubeVpa): JsonRecord {
    return {
      apiVersion: "autoscaling.k8s.io/v1",
      kind: "VerticalPodAutoscaler",
      metadata: { name: v.name, namespace: v.namespace },
      spec: {
        targetRef: { apiVersion: "apps/v1", kind: "Deployment", name: v.target },
        updatePolicy: { updateMode: v.mode },
        resourcePolicy: {
          containerPolicies: [{ containerName: v.container, controlledValues: "RequestsOnly" }],
        },
      },
      status: Option.isSome(v.recommendation)
        ? {
            recommendation: {
              containerRecommendations: [
                {
                  containerName: v.container,
                  target: {
                    cpu: `${v.recommendation.value.cpuMilli}m`,
                    memory: String(v.recommendation.value.memoryBytes),
                  },
                },
              ],
            },
          }
        : {},
      simulator: {
        model:
          "Explicit sample plus 20% headroom; Initial admission / Recreate cycle, no historical recommender, timers or node scheduling.",
      },
    };
  },
} as const;

/** General-purpose bursting profile, one container; explicit lesson admission cycle. */
export const AutopilotAdmission = {
  evaluate(resources: KubeResources): Result<KubeResources, string> {
    const gib = 1_073_741_824;
    const memory = resources.requests.memory;
    const cpuRequest = resources.requests.cpu;
    const bothMissing = memory === undefined && cpuRequest === undefined;
    let cpu = cpuRequest === undefined ? 0 : KubeResources.cpuMilli(cpuRequest);
    let bytes = memory === undefined ? 0 : KubeResources.memoryBytes(memory);
    if (bothMissing) {
      cpu = 500;
      bytes = 2 * gib;
    }
    cpu = Math.max(cpu, 50);
    bytes = Math.max(bytes, 52 * 1_048_576);
    bytes = Math.max(bytes, Math.ceil((cpu * gib) / 1000));
    cpu = Math.max(cpu, Math.ceil((bytes * 1000) / (6.5 * gib)));
    if (cpu > 30_000 || bytes > 110 * gib) {
      return Result.err("Autopilot general-purpose profile exceeds 30 vCPU or 110 GiB.");
    }
    const limits = { ...resources.limits };
    if (limits.cpu !== undefined && KubeResources.cpuMilli(limits.cpu) < cpu) {
      limits.cpu = `${cpu}m`;
    }
    if (limits.memory !== undefined && KubeResources.memoryBytes(limits.memory) < bytes) {
      limits.memory = String(bytes);
    }

    return KubeResources.parse({ requests: { cpu: `${cpu}m`, memory: String(bytes) }, limits });
  },
} as const;
