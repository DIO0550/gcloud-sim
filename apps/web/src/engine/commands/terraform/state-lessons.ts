import { CommandFailure } from "@/engine/cli/command-failure";
import {
  type CommandContext,
  CommandOutput,
  type CommandResult,
  type CommandSpec,
  Flag,
  OutputMessage,
  ParsedArgs,
  Positional,
} from "@/engine/cli/command-spec";
import { plainCommand } from "@/engine/commands/shared";
import { TerraformState } from "@/engine/domains/terraform";
import { TfAccess } from "@/engine/domains/terraform/access";
import { TfBackend } from "@/engine/domains/terraform/backend";
import { TfBackendRuntime } from "@/engine/domains/terraform/backend-runtime";
import { TfResources } from "@/engine/domains/terraform/resources";
import { TfRuntime } from "@/engine/domains/terraform/runtime";
import { TfStructure } from "@/engine/domains/terraform/structure";
import type { World } from "@/engine/domains/world";
import { Decoder as D } from "@/utils/Decoder";
import { Result } from "@/utils/Result";

const fail = (message: string): never => {
  throw new Error(message);
};
const ok = (world: World, text: string): CommandResult =>
  Result.ok({ world, output: CommandOutput.messages(OutputMessage.plain(text)) });
const guarded =
  (run: (ctx: CommandContext, args: ParsedArgs) => CommandResult) =>
  (ctx: CommandContext, args: ParsedArgs): CommandResult => {
    try {
      return run(ctx, args);
    } catch (e) {
      return Result.err(
        CommandFailure.invalidState(
          e instanceof Error ? e.message : "Invalid Terraform lesson operation.",
        ),
      );
    }
  };
const read = (world: World, file: string): string =>
  world.terraform.files[file] ?? world.kubeFiles[file] ?? fail("Virtual file not found.");
const stateFile = (file: string): string => {
  if (!file.endsWith(".tfstate") || !TfStructure.filePath(file)) {
    return fail("Use a safe virtual .tfstate path.");
  }
  return file;
};
const decodeState = (world: World, file: string) => {
  const value: unknown = JSON.parse(read(world, stateFile(file)));
  if (
    typeof value !== "object" ||
    value === null ||
    !("simulator" in value) ||
    value.simulator !== "gcloud-sim" ||
    !("version" in value) ||
    value.version !== 4
  ) {
    return fail("Only this simulator's version 4 state JSON can be pushed.");
  }
  const decoded = TfBackend.dataDecoder(value, "state");
  if (!Result.isOk(decoded)) {
    return fail(decoded.error);
  }
  const checked = TerraformState.validate({
    ...world.terraform,
    ...decoded.value,
    plans: {},
    events: [],
  });
  if (!Result.isOk(checked)) {
    return fail(checked.error);
  }
  return decoded.value;
};
const planJson = (world: World, name: string): string => {
  const plan = world.terraform.plans[name] ?? fail("Saved plan not found.");
  return JSON.stringify({ simulator: "gcloud-sim", plan }, null, 2);
};
const policyDecoder = D.object({
  allowedProjects: D.array(D.string),
  allowedRegions: D.array(D.string),
  requirePrivateVm: D.boolean,
  requireUniformBucket: D.boolean,
  denyPublicIngress: D.boolean,
});
export const TerraformStateLessonCommands: readonly CommandSpec[] = [
  plainCommand({
    path: ["sim", "terraform", "state", "save"],
    summary: "Save a state backup to a virtual .tfstate file (simulator command).",
    positionals: [Positional.required("FILE", "Virtual .tfstate backup name.")],
    run: guarded((ctx, args) => {
      TfBackendRuntime.check(ctx.world);
      if (!ctx.world.terraform.initialized) {
        fail("Run terraform init first.");
      }
      const file = stateFile(ParsedArgs.requiredPositional(args, 0));
      if (
        Object.hasOwn(ctx.world.terraform.files, file) ||
        Object.hasOwn(ctx.world.terraform.plans, file)
      ) {
        fail("Backup file already exists.");
      }
      if (Object.keys(ctx.world.terraform.files).length >= 32) {
        fail("At most 32 virtual Terraform files are supported.");
      }
      const text = JSON.stringify({
        simulator: "gcloud-sim",
        version: 4,
        ...TfBackend.data(ctx.world.terraform),
      });
      if (text.length > 64000) {
        fail("State backup exceeds the virtual file size limit.");
      }
      return ok(
        {
          ...ctx.world,
          terraform: {
            ...ctx.world.terraform,
            files: { ...ctx.world.terraform.files, [file]: text },
          },
        },
        `Saved ${file}. State may contain plaintext sensitive values; restrict access and keep it out of source control.`,
      );
    }),
  }),
  {
    kind: "plain",
    path: ["terraform", "state", "push"],
    summary: "Replace managed state from validated simulator JSON; infrastructure is unchanged.",
    positionals: [
      Positional.required("FILE", "Virtual .tfstate file.", (w) =>
        Object.keys(w.terraform.files).filter((k) => k.endsWith(".tfstate")),
      ),
    ],
    flags: [
      Flag.boolean("force", "Allow an older serial after explicit confirmation.", {
        aliases: ["-force"],
      }),
    ],
    destructive: false,
    confirmation: {
      skip: () => false,
      preview: guarded((ctx, args) => {
        TfBackendRuntime.check(ctx.world, true);
        decodeState(ctx.world, ParsedArgs.requiredPositional(args, 0));
        return ok(
          ctx.world,
          "Replace managed state only? Verify the backup identity and stop other writers before confirming.",
        );
      }),
    },
    run: guarded((ctx, args) => {
      TfBackendRuntime.check(ctx.world, true);
      if (!ctx.world.terraform.initialized) {
        fail("Run terraform init first.");
      }
      const data = decodeState(ctx.world, ParsedArgs.requiredPositional(args, 0));
      if (data.serial < ctx.world.terraform.serial && !ParsedArgs.boolean(args, "force")) {
        fail("Backup serial is older; inspect it before using -force.");
      }
      for (const resource of data.resources) {
        TfAccess.resource(ctx.world, resource, "get");
      }
      const serial = Math.max(data.serial, ctx.world.terraform.serial) + 1;
      if (!Number.isSafeInteger(serial)) {
        fail("State serial limit exceeded.");
      }
      const next = TfBackendRuntime.commit(
        ctx.world,
        {
          ...ctx.world,
          terraform: {
            ...ctx.world.terraform,
            ...data,
            serial,
            events: [
              ...ctx.world.terraform.events,
              { kind: "restore" as const, serial, detail: `file:${args.positionals[0]}` },
            ].slice(-32),
          },
        },
        ctx.now,
      );
      return ok(
        next,
        "State restored. Cloud resources were not changed. Run terraform plan to inspect drift before applying.",
      );
    }),
  },
  {
    kind: "plain",
    path: ["sim", "terraform", "backend", "restore"],
    summary: "Recover a known prior state generation (simulator command).",
    positionals: [Positional.required("GENERATION", "Known prior simulator state generation.")],
    flags: [],
    destructive: false,
    confirmation: {
      skip: () => false,
      preview: guarded((ctx, args) => {
        TfBackendRuntime.restoreGeneration(
          ctx.world,
          Number(ParsedArgs.requiredPositional(args, 0)),
          ctx.now,
        );
        return ok(
          ctx.world,
          "Recover this state generation? Infrastructure stays unchanged; inspect a fresh plan after recovery.",
        );
      }),
    },
    run: guarded((ctx, args) =>
      ok(
        TfBackendRuntime.restoreGeneration(
          ctx.world,
          Number(ParsedArgs.requiredPositional(args, 0)),
          ctx.now,
        ),
        "Recovered state into a new generation and serial. Run terraform plan before further changes.",
      ),
    ),
  },
  plainCommand({
    path: ["sim", "terraform", "plan-json"],
    summary: "Write the equivalent of terraform show -json into a virtual JSON file.",
    positionals: [
      Positional.required("PLAN", "Saved plan.", (w) => Object.keys(w.terraform.plans)),
    ],
    flags: [Flag.string("out", "Virtual JSON output path.", { required: true })],
    run: guarded((ctx, args) => {
      const file = ParsedArgs.requiredString(args, "out");
      if (!/^[A-Za-z0-9_-]+\.json$/.test(file)) {
        fail("Use a simple virtual .json file name.");
      }
      if (
        Object.hasOwn(ctx.world.kubeFiles, file) ||
        Object.hasOwn(ctx.world.terraform.plans, file)
      ) {
        fail("Output file already exists.");
      }
      const json = planJson(ctx.world, ParsedArgs.requiredPositional(args, 0));
      if (Object.keys(ctx.world.kubeFiles).length >= 32 || json.length > 64000) {
        fail("Virtual JSON file limit exceeded.");
      }
      return ok(
        { ...ctx.world, kubeFiles: { ...ctx.world.kubeFiles, [file]: json } },
        `Wrote ${file}. JSON exposes raw sensitive values; this is the simulator plan schema.`,
      );
    }),
  }),
  plainCommand({
    path: ["gcloud", "terraform", "vet"],
    summary: "Validate a simulator JSON plan against a bounded teaching policy library.",
    positionals: [
      Positional.required("PLAN_JSON", "Virtual simulator plan JSON.", (w) =>
        Object.keys(w.kubeFiles).filter((k) => k.endsWith(".json")),
      ),
    ],
    flags: [
      Flag.string("policy-library", "Virtual directory containing policy.json.", {
        required: true,
      }),
    ],
    run: guarded((ctx, args) => {
      const library = ParsedArgs.requiredString(args, "policy-library");
      if (!/^[A-Za-z0-9_-]+$/.test(library)) {
        fail("Use a safe virtual policy library directory.");
      }
      const policyText = read(ctx.world, `${library}/policy.json`);
      const raw: unknown = JSON.parse(policyText);
      if (
        typeof raw !== "object" ||
        raw === null ||
        Object.keys(raw).some(
          (k) =>
            ![
              "allowedProjects",
              "allowedRegions",
              "requirePrivateVm",
              "requireUniformBucket",
              "denyPublicIngress",
            ].includes(k),
        )
      ) {
        fail("Unsupported policy format. Arbitrary Rego is not executed.");
      }
      const policy = policyDecoder(raw, "policy");
      if (!Result.isOk(policy)) {
        fail(policy.error);
      }
      if (!Result.isOk(policy)) {
        return fail("Invalid policy.");
      }
      if (
        policy.value.allowedProjects.length === 0 ||
        policy.value.allowedProjects.length > 20 ||
        policy.value.allowedRegions.length === 0 ||
        policy.value.allowedRegions.length > 20
      ) {
        fail("Teaching policy requires 1 to 20 allowed projects and regions.");
      }
      const json: unknown = JSON.parse(read(ctx.world, ParsedArgs.requiredPositional(args, 0)));
      if (
        typeof json !== "object" ||
        json === null ||
        !("simulator" in json) ||
        json.simulator !== "gcloud-sim" ||
        !("plan" in json)
      ) {
        return fail("Only simulator plan JSON is supported.");
      }
      const decoded = TerraformState.planDecoder(json.plan, "plan");
      if (!Result.isOk(decoded)) {
        return fail(decoded.error);
      }
      const plan = decoded.value;
      const valid = TerraformState.validate({ ...ctx.world.terraform, plans: { vet: plan } });
      if (!Result.isOk(valid)) {
        fail(valid.error);
      }
      if (
        plan.serial !== ctx.world.terraform.serial ||
        plan.backendRevision !== ctx.world.terraform.backend.revision
      ) {
        fail("Plan is stale. Create a fresh plan before vet.");
      }
      if (!Object.values(ctx.world.terraform.plans).some((p) => TfResources.equal(p, plan))) {
        fail("Plan JSON does not match a current saved plan.");
      }
      const violations: string[] = [];
      for (const resource of plan.after) {
        TfAccess.resource(ctx.world, resource, "get");
        if (!policy.value.allowedProjects.includes(resource.project)) {
          violations.push(`${resource.address}: project is not allowed`);
        }
        const region =
          resource.type === "google_compute_instance"
            ? resource.zone.slice(0, -2)
            : resource.type === "google_storage_bucket"
              ? resource.location.toLowerCase()
              : resource.type === "google_compute_subnetwork"
                ? resource.region
                : "";
        if (region && !policy.value.allowedRegions.includes(region)) {
          violations.push(`${resource.address}: location is not allowed`);
        }
        if (
          policy.value.requirePrivateVm &&
          resource.type === "google_compute_instance" &&
          resource.externalIp
        ) {
          violations.push(`${resource.address}: external IP is prohibited`);
        }
        if (
          policy.value.requireUniformBucket &&
          resource.type === "google_storage_bucket" &&
          !resource.uniformAccess
        ) {
          violations.push(`${resource.address}: uniform bucket access is required`);
        }
        if (
          policy.value.denyPublicIngress &&
          resource.type === "google_compute_firewall" &&
          resource.direction === "INGRESS" &&
          !resource.disabled &&
          resource.sourceRanges.includes("0.0.0.0/0") &&
          resource.allowed.length > 0
        ) {
          violations.push(`${resource.address}: public ingress is prohibited`);
        }
      }
      // Also run the same read-only consistency/staleness checks as applying the reviewed plan.
      TfRuntime.checkPlan(ctx.world, plan);
      if (violations.length > 0) {
        return fail(`Policy violations:\n${violations.join("\n")}`);
      }
      const detail = JSON.stringify({
        planName: ParsedArgs.requiredPositional(args, 0),
        plan,
        policy: raw,
      });
      if (detail.length > 64000) {
        fail("Policy validation history exceeds the simulator limit.");
      }
      return ok(
        {
          ...ctx.world,
          terraform: {
            ...ctx.world.terraform,
            events: [
              ...ctx.world.terraform.events,
              { kind: "vet" as const, serial: plan.serial, detail },
            ].slice(-32),
          },
        },
        "Policy validation passed for the supported teaching rules. Infrastructure was not changed; this does not evaluate arbitrary Rego.",
      );
    }),
  }),
];
