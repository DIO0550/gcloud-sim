import { CommandFailure } from "@/engine/cli/command-failure";
import {
  CommandOutput,
  type CommandResult,
  type CommandSpec,
  Flag,
  OutputMessage,
  ParsedArgs,
  Positional,
  type ProjectContext,
} from "@/engine/cli/command-spec";
import { kubePermission } from "@/engine/commands/kubectl/configuration";
import {
  type KubectlContext,
  namespaceContext,
  requireNamespace,
} from "@/engine/commands/kubectl/context";
import { Candidates, projectCommand } from "@/engine/commands/shared";
import { observeAdmin } from "@/engine/domains/admin-lab/model";
import {
  AutopilotAdmission,
  KubeIdentity,
  type KubeServiceAccount,
  KubeVpa,
} from "@/engine/domains/gke-completion";
import { KubeContext } from "@/engine/domains/kube-context";
import type { GkeLessonManifest } from "@/engine/domains/kube-manifest/gke-lessons";
import { KubeMulti } from "@/engine/domains/kube-multi";
import { KubeResources } from "@/engine/domains/kube-resources";
import { KubeDeployment, KubePod } from "@/engine/domains/kubernetes";
import type { GkeCluster } from "@/engine/domains/managed-services";
import { World } from "@/engine/domains/world";
import type { JsonRecord } from "@/types/Json";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const invalid = (message: string) => Result.err(CommandFailure.invalidArgumentWith(message));
const finish = (world: World, text: string): CommandResult =>
  Result.ok({ world, output: CommandOutput.messages(OutputMessage.plain(text)) });
const same =
  (c: GkeCluster, namespace: string, name: string) =>
  (r: { projectId: string; cluster: string; namespace: string; name: string }) =>
    r.projectId === c.projectId &&
    r.cluster === c.name &&
    r.namespace === namespace &&
    r.name === name;

export const applyGkeLesson = (
  ctx: KubectlContext,
  c: GkeCluster,
  m: GkeLessonManifest,
  action: "apply" | "create" | "delete",
): CommandResult => {
  const isAccount = m.kind === "serviceaccount";
  const match = same(c, ctx.namespace, m.name);
  const exists = isAccount
    ? ctx.world.kubeServiceAccounts.some(match)
    : ctx.world.kubeVpas.some(match);
  const permission = isAccount ? "container.serviceAccounts" : "container.thirdPartyObjects";
  const applyVerb = exists ? "update" : "create";
  const verbs = action === "apply" ? ["get", applyVerb] : [action];
  for (const verb of verbs) {
    const checked = kubePermission(ctx, `${permission}.${verb}`);
    if (!Result.isOk(checked)) {
      return checked;
    }
  }
  if (action === "create" && exists) {
    return Result.err(CommandFailure.alreadyExistsWith(`${m.kind}/${m.name} already exists`));
  }
  if (action === "delete" && !exists) {
    return Result.err(CommandFailure.notFoundWith(`${m.kind}/${m.name} not found`));
  }
  if (action === "delete") {
    return finish(
      {
        ...ctx.world,
        kubeServiceAccounts: isAccount
          ? ctx.world.kubeServiceAccounts.filter((s) => !match(s))
          : ctx.world.kubeServiceAccounts,
        kubeVpas: isAccount ? ctx.world.kubeVpas : ctx.world.kubeVpas.filter((v) => !match(v)),
      },
      `${m.kind}/${m.name} deleted`,
    );
  }
  if (isAccount) {
    const old = ctx.world.kubeServiceAccounts.find(match);
    const account: KubeServiceAccount = {
      projectId: c.projectId,
      cluster: c.name,
      namespace: ctx.namespace,
      name: m.name,
      gcpServiceAccount: m.gcpServiceAccount,
      createdAt: old?.createdAt ?? ctx.now,
    };
    if (!KubeIdentity.valid(account)) {
      return invalid(
        "Invalid ServiceAccount; the built-in default account is read-only in this lesson.",
      );
    }

    return finish(
      {
        ...ctx.world,
        kubeServiceAccounts: [...ctx.world.kubeServiceAccounts.filter((s) => !match(s)), account],
      },
      `serviceaccount/${m.name} ${exists ? "configured" : "created"}`,
    );
  }
  if (!c.autopilot && !c.verticalPodAutoscaling) {
    return invalid("Enable VPA on the Standard cluster first (--enable-vertical-pod-autoscaling).");
  }
  if (
    m.mode !== "Off" &&
    ctx.world.kubeHpas.some(
      (h) =>
        h.projectId === c.projectId &&
        h.cluster === c.name &&
        h.namespace === ctx.namespace &&
        h.target === m.target,
    )
  ) {
    return invalid(
      "CPU HPA and automatic CPU VPA cannot target the same Deployment in this lesson.",
    );
  }
  const old = ctx.world.kubeVpas.find(match);
  const v: KubeVpa = {
    projectId: c.projectId,
    cluster: c.name,
    namespace: ctx.namespace,
    name: m.name,
    target: m.target,
    container: m.container,
    mode: m.mode,
    createdAt: old?.createdAt ?? ctx.now,
    recommendation:
      old?.target === m.target && old.container === m.container ? old.recommendation : Option.none,
  };
  if (
    ctx.world.kubeVpas.some(
      (v) =>
        v.projectId === c.projectId &&
        v.cluster === c.name &&
        v.namespace === ctx.namespace &&
        v.target === m.target &&
        !match(v),
    )
  ) {
    return invalid("Only one VPA per Deployment is supported.");
  }

  return finish(
    { ...ctx.world, kubeVpas: [...ctx.world.kubeVpas.filter((v) => !match(v)), v] },
    `verticalpodautoscaler/${m.name} ${exists ? "configured" : "created"}`,
  );
};

export const lessonRows = (
  world: World,
  c: GkeCluster,
  namespace: string,
  kind: "serviceaccount" | "vpa",
): readonly (JsonRecord & { name: string })[] => {
  if (kind === "serviceaccount") {
    return KubeIdentity.accounts(world, c, namespace).map((s) => ({
      ...KubeIdentity.record(s),
      name: s.name,
      namespace: s.namespace,
      iamServiceAccount: s.gcpServiceAccount || "unlinked",
    }));
  }

  return world.kubeVpas
    .filter((v) => v.projectId === c.projectId && v.cluster === c.name && v.namespace === namespace)
    .map((v) => ({
      ...KubeVpa.record(v),
      name: v.name,
      namespace: v.namespace,
      target: v.target,
      mode: v.mode,
    }));
};

const scope = (ctx: ProjectContext, args: ParsedArgs) =>
  Result.flatMap(
    Option.toResult(KubeContext.current(ctx.world, ctx.project.projectId), () =>
      CommandFailure.invalidState("No current Kubernetes cluster."),
    ),
    (cluster) =>
      Result.flatMap(namespaceContext(ctx, args), (scoped) =>
        Result.map(requireNamespace(scoped, cluster), (ctx) => ({ ctx, cluster })),
      ),
  );
const flags = [Flag.string("namespace", "Kubernetes namespace.", { aliases: ["-n"] })];
export const GkeLessonCommands: readonly CommandSpec[] = [
  projectCommand({
    path: ["kubectl", "create", "serviceaccount"],
    summary: "Create a Kubernetes ServiceAccount (no key is generated).",
    positionals: [Positional.required("NAME", "ServiceAccount name.")],
    flags,
    permission: "container.serviceAccounts.create",
    requiredApis: ["container.googleapis.com"],
    run: (ctx, args) =>
      Result.flatMap(scope(ctx, args), ({ ctx, cluster }) =>
        applyGkeLesson(
          ctx,
          cluster,
          {
            kind: "serviceaccount",
            name: ParsedArgs.requiredPositional(args, 0),
            namespace: ctx.namespace,
            gcpServiceAccount: "",
          },
          "create",
        ),
      ),
  }),
  projectCommand({
    path: ["kubectl", "annotate"],
    summary: "Link one Kubernetes ServiceAccount to an IAM service account.",
    positionals: [
      Positional.required("TYPE", "serviceaccount or sa."),
      Positional.required("NAME", "Kubernetes ServiceAccount.", Candidates.kubeServiceAccounts),
      Positional.required("ANNOTATION", "iam.gke.io/gcp-service-account=EMAIL or KEY-."),
    ],
    flags: [...flags, Flag.boolean("overwrite", "Allow replacing an existing annotation.")],
    permission: "container.serviceAccounts.update",
    requiredApis: ["container.googleapis.com"],
    run: (ctx, args) =>
      Result.flatMap(scope(ctx, args), ({ ctx, cluster }) => {
        if (
          !["sa", "serviceaccount", "serviceaccounts"].includes(
            ParsedArgs.requiredPositional(args, 0),
          )
        ) {
          return invalid("Only ServiceAccount Workload Identity annotations are supported.");
        }
        const name = ParsedArgs.requiredPositional(args, 1);
        const old = ctx.world.kubeServiceAccounts.find(same(cluster, ctx.namespace, name));
        if (!old) {
          return Result.err(CommandFailure.notFoundWith(`serviceaccount/${name} not found`));
        }
        const text = ParsedArgs.requiredPositional(args, 2);
        const key = "iam.gke.io/gcp-service-account";
        if (!text.startsWith(`${key}=`) && text !== `${key}-`) {
          return invalid("Unsupported ServiceAccount annotation.");
        }
        const email = text === `${key}-` ? "" : text.slice(key.length + 1);
        if (
          email !== old.gcpServiceAccount &&
          old.gcpServiceAccount.length > 0 &&
          email.length > 0 &&
          !ParsedArgs.boolean(args, "overwrite")
        ) {
          return invalid("Annotation already exists; use --overwrite.");
        }

        return applyGkeLesson(
          ctx,
          cluster,
          { kind: "serviceaccount", name, namespace: ctx.namespace, gcpServiceAccount: email },
          "apply",
        );
      }),
  }),
  projectCommand({
    path: ["sim", "kubernetes", "check-access"],
    summary:
      "Evaluate linked Workload Identity access to a bucket, without credentials or cloud requests.",
    positionals: [Positional.required("NAME", "Deployment name.", Candidates.kubeDeployments)],
    flags: [
      ...flags,
      Flag.string(
        "node-pool",
        "Declared Standard pool for metadata access (default default-pool; no scheduling).",
      ),
      Flag.string("bucket", "Target bucket.", { required: true, candidates: Candidates.buckets }),
      Flag.enum(
        "permission",
        "Bucket object permission to evaluate.",
        [
          "storage.objects.list",
          "storage.objects.get",
          "storage.objects.create",
          "storage.objects.delete",
        ],
        { required: true },
      ),
    ],
    permission: "container.deployments.get",
    requiredApis: ["container.googleapis.com"],
    run: (ctx, args) =>
      Result.flatMap(scope(ctx, args), ({ ctx, cluster }) => {
        const d = World.findKubeDeployment(
          ctx.world,
          cluster,
          ParsedArgs.requiredPositional(args, 0),
          ctx.namespace,
        );
        if (!Option.isSome(d)) {
          return Result.err(CommandFailure.notFoundWith("Deployment not found."));
        }
        const result = KubeIdentity.check(
          ctx.world,
          cluster,
          d.value,
          ParsedArgs.requiredString(args, "bucket"),
          ParsedArgs.requiredString(args, "permission"),
          Option.unwrapOr(ParsedArgs.string(args, "node-pool"), "default-pool"),
        );
        return finish(
          observeAdmin(ctx.world, {
            projectId: ctx.project.projectId,
            kind: "gke-identity",
            resource: `${d.value.name}/${ParsedArgs.requiredString(args, "permission")}`,
            result: result.allowed ? "allowed" : "denied",
            value: result.allowed ? 1 : 0,
          }),
          `${result.allowed ? "ALLOW" : "DENY"}: ${result.reason} (${result.principal || "no IAM principal"})`,
        );
      }),
  }),
  projectCommand({
    path: ["sim", "kubernetes", "recommend-vpa"],
    summary:
      "Evaluate VPA from explicit usage plus 20% headroom; Recreate applies requests through Pod recreation.",
    positionals: [Positional.required("NAME", "VPA name.", Candidates.kubeVpas)],
    flags: [
      ...flags,
      Flag.string("cpu", "Measured container CPU, e.g. 250m.", { required: true }),
      Flag.string("memory", "Measured container memory, e.g. 100Mi.", { required: true }),
    ],
    permissions: ["container.thirdPartyObjects.update", "container.deployments.get"],
    requiredApis: ["container.googleapis.com"],
    run: (ctx, args) =>
      Result.flatMap(scope(ctx, args), ({ ctx, cluster }) => {
        if (!cluster.autopilot && !cluster.verticalPodAutoscaling) {
          return invalid("VPA is disabled on this cluster.");
        }
        const v = ctx.world.kubeVpas.find(
          same(cluster, ctx.namespace, ParsedArgs.requiredPositional(args, 0)),
        );
        if (!v) {
          return Result.err(CommandFailure.notFoundWith("VPA not found."));
        }
        const d = World.findKubeDeployment(ctx.world, cluster, v.target, ctx.namespace);
        if (!Option.isSome(d) || !Result.isOk(KubeMulti.select(d.value, v.container))) {
          return invalid("VPA target Deployment/container is missing.");
        }
        const sample = KubeResources.parse({
          requests: {
            cpu: ParsedArgs.requiredString(args, "cpu"),
            memory: ParsedArgs.requiredString(args, "memory"),
          },
        });
        if (!Result.isOk(sample)) {
          return invalid(sample.error);
        }
        const cpuMilli = Math.ceil(KubeResources.cpuMilli(sample.value.requests.cpu) * 1.2);
        const memoryBytes = Math.ceil(
          KubeResources.memoryBytes(sample.value.requests.memory ?? "0") * 1.2,
        );
        const next = {
          ...v,
          recommendation: Option.some({ cpuMilli, memoryBytes, evaluatedAt: ctx.now }),
        };
        if (!KubeVpa.valid(next)) {
          return invalid("VPA sample must be positive and within the lesson's limits.");
        }

        const owner = d.value;
        const base = KubeMulti.spec(owner).find((c) => c.name === v.container);
        if (!base) {
          return invalid("VPA target container not found.");
        }
        const effective = KubeVpa.resources(base.resources, next);
        if (!Result.isOk(effective)) {
          return invalid(`VPA recommendation exceeds the container limit: ${effective.error}`);
        }
        let world: World = {
          ...ctx.world,
          kubeVpas: ctx.world.kubeVpas.map((item) => (item === v ? next : item)),
        };
        let updated = owner;
        if (v.mode === "Recreate") {
          if (
            world.kubeHpas.some(
              (h) =>
                h.projectId === owner.projectId &&
                h.cluster === owner.cluster &&
                h.namespace === owner.namespace &&
                h.target === owner.name,
            )
          ) {
            return invalid("CPU HPA conflicts with automatic CPU VPA.");
          }
          const changed = KubePod.fromDeployment(owner).some((p) => {
            const current =
              owner.podResources?.find(
                (s) => s.podName === p.name && s.containerName === v.container,
              )?.resources ?? base.resources;
            return !KubeResources.equal(current, effective.value);
          });
          if (changed) {
            for (let index = 0; index < owner.replicas; index += 1) {
              updated = KubeDeployment.replacePod(updated, index);
            }
            world = World.replaceKubeDeployment(world, updated);
          }
        }
        return finish(
          world,
          `VPA ${v.name}: cpu=${cpuMilli}m, memory=${memoryBytes} bytes (${v.mode}; replicas=${owner.replicas}, template revision=${owner.revision})`,
        );
      }),
  }),
  projectCommand({
    path: ["sim", "kubernetes", "admit-autopilot"],
    summary:
      "Explicitly evaluate and apply the lesson's Autopilot general-purpose bursting resource profile.",
    positionals: [
      Positional.required("NAME", "Single-container Deployment.", Candidates.kubeDeployments),
    ],
    flags,
    permission: "container.deployments.update",
    requiredApis: ["container.googleapis.com"],
    run: (ctx, args) =>
      Result.flatMap(scope(ctx, args), ({ ctx, cluster }) => {
        if (!cluster.autopilot) {
          return invalid("Autopilot admission requires an Autopilot cluster.");
        }
        const found = World.findKubeDeployment(
          ctx.world,
          cluster,
          ParsedArgs.requiredPositional(args, 0),
          ctx.namespace,
        );
        if (!Option.isSome(found)) {
          return Result.err(CommandFailure.notFoundWith("Deployment not found."));
        }
        const d = found.value;
        const containers = KubeMulti.spec(d);
        const first = containers[0];
        if (containers.length !== 1 || !first) {
          return invalid(
            "Autopilot resource profile supports one ordinary container; multi-container allocation is not simulated.",
          );
        }
        const result = AutopilotAdmission.evaluate(d.resources);
        if (!Result.isOk(result)) {
          return invalid(result.error);
        }
        const next = KubeMulti.update(d, [{ ...first, resources: result.value }]);
        return finish(
          World.replaceKubeDeployment(ctx.world, next),
          `Autopilot admission: requests ${KubeResources.text(result.value.requests)}; limits ${KubeResources.text(result.value.limits)} (explicit lesson cycle)`,
        );
      }),
  }),
];
