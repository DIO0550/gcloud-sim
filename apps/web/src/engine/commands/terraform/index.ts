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
import { TerraformExamples } from "@/engine/commands/terraform/examples";
import { TerraformState, type TfPlan } from "@/engine/domains/terraform";
import { TfConfiguration } from "@/engine/domains/terraform/configuration";
import { Hcl } from "@/engine/domains/terraform/hcl";
import { TfRuntime } from "@/engine/domains/terraform/runtime";
import { TfStructure } from "@/engine/domains/terraform/structure";
import type { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

export { TerraformNetworkExample } from "@/engine/commands/terraform/examples";

const fail = (message: string): never => {
  throw new Error(message);
};
const ok = (world: World, message: string): CommandResult =>
  Result.ok({ world, output: CommandOutput.messages(OutputMessage.plain(message)) });
const guarded =
  (run: (ctx: CommandContext, args: ParsedArgs) => CommandResult) =>
  (ctx: CommandContext, args: ParsedArgs): CommandResult => {
    try {
      return run(ctx, args);
    } catch (e) {
      return Result.err(
        CommandFailure.invalidState(
          e instanceof Error ? e.message : "Invalid Terraform operation.",
        ),
      );
    }
  };
const fileName = (name: string): string =>
  /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(name) &&
  !["constructor", "prototype", "__proto__"].includes(name)
    ? name
    : fail("Use a simple file name in the simulator root directory (no paths).");
const configName = (name: string): string =>
  TfStructure.filePath(name)
    ? name
    : fail(
        "Use a relative .tf or .tfvars file path; no paths with .., absolute paths, or unsafe segments.",
      );
const requireInit = (world: World): void => {
  if (!world.terraform.initialized) fail("Run terraform init first.");
};
const fileCandidates = (world: World): readonly string[] => Object.keys(world.terraform.files);
const stateCandidates = (world: World): readonly string[] =>
  world.terraform.resources.map((r) => r.address);
const modeFlags = [
  Flag.boolean("destroy", "Plan destruction of managed resources.", { aliases: ["-destroy"] }),
  Flag.boolean("refresh-only", "Update only Terraform state and outputs.", {
    aliases: ["-refresh-only"],
  }),
];
const planMode = (args: ParsedArgs, destroy = false): TfPlan["mode"] => {
  if ((destroy || ParsedArgs.boolean(args, "destroy")) && ParsedArgs.boolean(args, "refresh-only"))
    fail("-destroy and -refresh-only are mutually exclusive.");
  return destroy || ParsedArgs.boolean(args, "destroy")
    ? "destroy"
    : ParsedArgs.boolean(args, "refresh-only")
      ? "refresh-only"
      : "normal";
};
const savedPlan = (world: World, args: ParsedArgs): TfPlan | undefined => {
  const name = args.positionals[0];
  if (name === undefined) return undefined;
  if (ParsedArgs.has(args, "destroy") || ParsedArgs.has(args, "refresh-only"))
    fail("Planning options cannot be used with a saved plan.");
  return world.terraform.plans[fileName(name)] ?? fail(`Saved plan not found: ${name}`);
};
const applyCommand = (destroy: boolean): CommandSpec => ({
  kind: "plain",
  path: ["terraform", destroy ? "destroy" : "apply"],
  summary: destroy
    ? "Destroy the resources managed by this simulator state."
    : "Apply a new or saved execution plan.",
  positionals: destroy
    ? []
    : [Positional.optional("PLAN", "Saved plan file.", (w) => Object.keys(w.terraform.plans))],
  flags: [
    ...modeFlags,
    Flag.boolean("auto-approve", "Skip interactive approval.", { aliases: ["-auto-approve"] }),
  ],
  destructive: false,
  confirmation: {
    skip: (args) =>
      ParsedArgs.boolean(args, "auto-approve") || (!destroy && args.positionals.length > 0),
    preview: guarded((ctx, args) =>
      ok(ctx.world, TfRuntime.summary(TfRuntime.plan(ctx.world, planMode(args, destroy)))),
    ),
  },
  run: guarded((ctx, args) => {
    requireInit(ctx.world);
    const plan =
      (!destroy && savedPlan(ctx.world, args)) ||
      TfRuntime.plan(ctx.world, planMode(args, destroy));
    return ok(
      TfRuntime.apply(ctx.world, plan),
      `${TfRuntime.summary(plan)}\nApply complete (simulated).`,
    );
  }),
});

export const TerraformCommands: readonly CommandSpec[] = [
  plainCommand({
    path: ["sim", "files", "list"],
    summary: "List in-memory Terraform configuration files (simulator command).",
    run: (ctx) => ok(ctx.world, fileCandidates(ctx.world).join("\n") || "No configuration files."),
  }),
  plainCommand({
    path: ["sim", "files", "read"],
    summary: "Read an in-memory configuration file.",
    positionals: [Positional.required("FILE", "File name.", fileCandidates)],
    run: guarded((ctx, args) =>
      ok(
        ctx.world,
        ctx.world.terraform.files[configName(ParsedArgs.requiredPositional(args, 0))] ??
          fail("File not found."),
      ),
    ),
  }),
  plainCommand({
    path: ["sim", "files", "write"],
    summary: "Write HCL to an in-memory file; quote the content.",
    positionals: [Positional.required("FILE", "File name.", fileCandidates)],
    flags: [
      Flag.string("content", "HCL source (single-quote the full value).", { required: true }),
    ],
    run: guarded((ctx, args) => {
      const name = configName(ParsedArgs.requiredPositional(args, 0));
      const content = ParsedArgs.requiredString(args, "content");
      if (Object.hasOwn(ctx.world.terraform.plans, name))
        fail("File name collides with a saved plan.");
      if (
        content.length > 64000 ||
        (!Object.hasOwn(ctx.world.terraform.files, name) && fileCandidates(ctx.world).length >= 32)
      )
        fail("Limit: 32 files, 64,000 characters each.");
      return ok(
        {
          ...ctx.world,
          terraform: {
            ...ctx.world.terraform,
            files: { ...ctx.world.terraform.files, [name]: content },
          },
        },
        `Wrote ${name}.`,
      );
    }),
  }),
  plainCommand({
    path: ["sim", "files", "replace"],
    summary: "Replace exactly one text occurrence in an in-memory file.",
    positionals: [Positional.required("FILE", "File name.", fileCandidates)],
    flags: [
      Flag.string("search", "Text to replace.", { required: true }),
      Flag.string("replacement", "Replacement text.", { required: true }),
    ],
    run: guarded((ctx, args) => {
      const name = configName(ParsedArgs.requiredPositional(args, 0));
      const content = ctx.world.terraform.files[name] ?? fail("File not found.");
      const search = ParsedArgs.requiredString(args, "search");
      if (!search || content.split(search).length !== 2)
        fail("Search text must occur exactly once.");
      const next = content.replace(search, () => ParsedArgs.requiredString(args, "replacement"));
      if (next.length > 64000) fail("File exceeds 64,000 characters.");
      return ok(
        {
          ...ctx.world,
          terraform: {
            ...ctx.world.terraform,
            files: { ...ctx.world.terraform.files, [name]: next },
          },
        },
        `Updated ${name}.`,
      );
    }),
  }),
  plainCommand({
    path: ["sim", "files", "delete"],
    summary: "Remove a configuration file; managed resources remain until apply/destroy.",
    positionals: [Positional.required("FILE", "File name.", fileCandidates)],
    run: guarded((ctx, args) => {
      const name = configName(ParsedArgs.requiredPositional(args, 0));
      if (!Object.hasOwn(ctx.world.terraform.files, name)) fail("File not found.");
      const files = Object.fromEntries(
        Object.entries(ctx.world.terraform.files).filter(([key]) => key !== name),
      );
      return ok({ ...ctx.world, terraform: { ...ctx.world.terraform, files } }, `Removed ${name}.`);
    }),
  }),
  plainCommand({
    path: ["sim", "files", "load"],
    summary: "Load a Terraform network or local-module lesson into virtual files.",
    positionals: [
      Positional.required("EXAMPLE", "Lesson name.", () => Object.keys(TerraformExamples)),
    ],
    flags: [Flag.boolean("force", "Replace existing files belonging to the selected example.")],
    run: guarded((ctx, args) => {
      const name = ParsedArgs.requiredPositional(args, 0);
      if (!Object.hasOwn(TerraformExamples, name))
        fail(`Available examples: ${Object.keys(TerraformExamples).join(", ")}`);
      const example = TerraformExamples[name] ?? {};
      for (const path of Object.keys(example)) {
        if (Object.hasOwn(ctx.world.terraform.plans, path))
          fail(`${path} collides with a saved plan.`);
        if (Object.hasOwn(ctx.world.terraform.files, path) && !ParsedArgs.boolean(args, "force"))
          fail(`${path} already exists. Read it first or use --force.`);
      }
      const files = { ...ctx.world.terraform.files, ...example };
      if (Object.keys(files).length > 32) fail("Limit: 32 configuration files.");
      return ok(
        {
          ...ctx.world,
          terraform: {
            ...ctx.world.terraform,
            files,
          },
        },
        `Loaded ${Object.keys(example).join(", ")}. Use sim files read FILE. This is a simulator-only file system.`,
      );
    }),
  }),
  plainCommand({
    path: ["terraform", "init"],
    summary: "Initialize the simulated local backend; no provider download or cloud access.",
    run: guarded((ctx) => {
      TfConfiguration.compile(ctx.world.terraform.files);
      return ok(
        { ...ctx.world, terraform: { ...ctx.world.terraform, initialized: true } },
        "Terraform has been initialized (simulated local backend, network/subnetwork subset). No real provider was installed.",
      );
    }),
  }),
  plainCommand({
    path: ["terraform", "validate"],
    summary: "Validate the supported HCL subset and configured variable values.",
    run: guarded((ctx) => {
      requireInit(ctx.world);
      TfConfiguration.compile(ctx.world.terraform.files);
      return ok(ctx.world, "Success! The configuration is valid for the simulator subset.");
    }),
  }),
  plainCommand({
    path: ["terraform", "fmt"],
    summary: "Format supported HCL files.",
    flags: [
      Flag.boolean("check", "Check formatting without writing files.", { aliases: ["-check"] }),
      Flag.boolean("recursive", "Include local module subdirectories.", {
        aliases: ["-recursive"],
      }),
    ],
    run: guarded((ctx, args) => {
      const files = Object.fromEntries(
        Object.entries(ctx.world.terraform.files).map(([name, text]) => [
          name,
          name.includes("/") && !ParsedArgs.boolean(args, "recursive")
            ? text
            : Hcl.format(Hcl.parse(text)),
        ]),
      );
      const changed = Object.keys(files).filter(
        (name) => files[name] !== ctx.world.terraform.files[name],
      );
      if (ParsedArgs.boolean(args, "check") && changed.length)
        fail(`Files need formatting: ${changed.join(", ")}`);
      return ok(
        ParsedArgs.boolean(args, "check")
          ? ctx.world
          : { ...ctx.world, terraform: { ...ctx.world.terraform, files } },
        changed.join("\n") || "All files are formatted.",
      );
    }),
  }),
  plainCommand({
    path: ["terraform", "plan"],
    summary: "Preview changes without mutating cloud resources or managed state.",
    flags: [
      ...modeFlags,
      Flag.string("out", "Save the plan under this name.", { aliases: ["-out"] }),
    ],
    run: guarded((ctx, args) => {
      const plan = TfRuntime.plan(ctx.world, planMode(args));
      const out = ParsedArgs.string(args, "out");
      if (!Option.isSome(out)) return ok(ctx.world, TfRuntime.summary(plan));
      const name = fileName(out.value);
      if (Object.hasOwn(ctx.world.terraform.files, name))
        fail("Plan name collides with a configuration file.");
      if (
        Object.keys(ctx.world.terraform.plans).length >= 16 &&
        !Object.hasOwn(ctx.world.terraform.plans, name)
      )
        fail("Limit: 16 saved plans.");
      return ok(
        {
          ...ctx.world,
          terraform: {
            ...ctx.world.terraform,
            plans: { ...ctx.world.terraform.plans, [name]: plan },
          },
        },
        `${TfRuntime.summary(plan)}\nSaved plan: ${name}`,
      );
    }),
  }),
  applyCommand(false),
  applyCommand(true),
  plainCommand({
    path: ["terraform", "show"],
    summary: "Show a saved plan or current Terraform state.",
    positionals: [
      Positional.optional("PLAN", "Saved plan.", (w) => Object.keys(w.terraform.plans)),
    ],
    run: guarded((ctx, args) => {
      const plan = savedPlan(ctx.world, args);
      return ok(
        ctx.world,
        plan
          ? TfRuntime.summary(plan)
          : JSON.stringify(
              { resources: ctx.world.terraform.resources, outputs: ctx.world.terraform.outputs },
              null,
              2,
            ),
      );
    }),
  }),
  plainCommand({
    path: ["terraform", "output"],
    summary: "Read outputs recorded by the last apply.",
    positionals: [
      Positional.optional("NAME", "Output name.", (w) => Object.keys(w.terraform.outputs)),
    ],
    run: guarded((ctx, args) =>
      ok(
        ctx.world,
        args.positionals[0]
          ? (ctx.world.terraform.outputs[args.positionals[0]] ??
              fail("Output not found. Apply the configuration first."))
          : JSON.stringify(ctx.world.terraform.outputs, null, 2),
      ),
    ),
  }),
  plainCommand({
    path: ["terraform", "state", "list"],
    summary: "List managed resource addresses.",
    run: (ctx) =>
      ok(ctx.world, [...stateCandidates(ctx.world)].sort().join("\n") || "No managed resources."),
  }),
  plainCommand({
    path: ["terraform", "state", "show"],
    summary: "Show a managed resource from state (does not refresh).",
    positionals: [Positional.required("ADDRESS", "Managed address.", stateCandidates)],
    run: guarded((ctx, args) => {
      const resource =
        ctx.world.terraform.resources.find((r) => r.address === args.positionals[0]) ??
        fail("Address not found in state.");
      return ok(ctx.world, JSON.stringify(TerraformState.record(resource), null, 2));
    }),
  }),
  plainCommand({
    path: ["terraform", "state", "rm"],
    summary: "Forget an address without deleting its remote resource.",
    positionals: [Positional.required("ADDRESS", "Managed address.", stateCandidates)],
    run: guarded((ctx, args) => {
      requireInit(ctx.world);
      if (!stateCandidates(ctx.world).includes(ParsedArgs.requiredPositional(args, 0)))
        fail("Address not found in state.");
      return ok(
        {
          ...ctx.world,
          terraform: {
            ...ctx.world.terraform,
            resources: ctx.world.terraform.resources.filter(
              (r) => r.address !== args.positionals[0],
            ),
            serial: ctx.world.terraform.serial + 1,
          },
        },
        "Removed address from state. The remote resource still exists.",
      );
    }),
  }),
  plainCommand({
    path: ["terraform", "state", "mv"],
    summary: "Rename a state address; update HCL separately to avoid recreation.",
    positionals: [
      Positional.required("SOURCE", "Managed source.", stateCandidates),
      Positional.required("DESTINATION", "Same-type destination address."),
    ],
    run: guarded((ctx, args) => {
      requireInit(ctx.world);
      const source =
        ctx.world.terraform.resources.find((r) => r.address === args.positionals[0]) ??
        fail("Source not found in state.");
      const dest = ParsedArgs.requiredPositional(args, 1);
      if (TfStructure.resourceType(dest) !== source.type)
        fail("Destination must be a root or module address of the same resource type.");
      if (stateCandidates(ctx.world).includes(dest)) fail("Destination already exists in state.");
      return ok(
        {
          ...ctx.world,
          terraform: {
            ...ctx.world.terraform,
            resources: ctx.world.terraform.resources.map((r) =>
              r.address === source.address ? { ...r, address: dest } : r,
            ),
            serial: ctx.world.terraform.serial + 1,
          },
        },
        `Moved ${source.address} to ${dest}; cloud resources are unchanged.`,
      );
    }),
  }),
  plainCommand({
    path: ["terraform", "import"],
    summary: "Import an existing custom network/subnetwork into a configured address.",
    positionals: [
      Positional.required("ADDRESS", "Address declared in HCL."),
      Positional.required("ID", "Full projects/... resource ID."),
    ],
    run: guarded((ctx, args) => {
      requireInit(ctx.world);
      const config = TfConfiguration.compile(ctx.world.terraform.files);
      const target =
        config.resources.find((r) => r.address === args.positionals[0]) ??
        fail("Address is not declared in configuration.");
      if (args.positionals[1] !== TerraformState.id(target))
        fail(`Use the full ID matching this configuration: ${TerraformState.id(target)}`);
      if (
        ctx.world.terraform.resources.some(
          (r) => r.address === target.address || TerraformState.id(r) === TerraformState.id(target),
        )
      )
        fail("Address or remote object is already managed.");
      const actual = TfRuntime.read(ctx.world, target) ?? fail("Remote resource not found.");
      return ok(
        {
          ...ctx.world,
          terraform: {
            ...ctx.world.terraform,
            resources: [...ctx.world.terraform.resources, actual],
            serial: ctx.world.terraform.serial + 1,
          },
        },
        `Imported ${target.address}. Configuration and remote resource were not changed.`,
      );
    }),
  }),
];
