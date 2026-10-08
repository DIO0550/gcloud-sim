import {
  CommandContext,
  type CommandSpec,
  Flag,
  ParsedArgs,
  Positional,
} from "@/engine/cli/command-spec";
import { Candidates, projectCommand } from "@/engine/commands/shared";
import { ResourceName } from "@/engine/domains/compute";
import {
  findDeployment,
  type Invocation,
  sameId,
  type Workflow,
} from "@/engine/domains/serverless-lab/model";
import { attachAccount, invoke } from "@/engine/domains/serverless-lab/runtime";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";
import { patchLab } from "./resources";
import { finish, finishInvocation, invalid, labCandidates, regionFlag } from "./shared";

/** Fixed workflow source: no YAML expressions or user code are evaluated. */
export const WorkflowSteps = ["run:workflow-api", "function:workflow-function"] as const;
export const WorkflowCommands: readonly CommandSpec[] = [
  projectCommand({
    path: ["gcloud", "workflows", "deploy"],
    summary: "Deploy the built-in workflow.yaml (run:workflow-api → function:workflow-function).",
    positionals: [Positional.required("NAME", "Workflow name.")],
    flags: [
      regionFlag,
      Flag.string("location", "Workflow region."),
      Flag.string("source", "Built-in workflow.yaml only.", { required: true }),
      Flag.string("service-account", "Execution SA.", {
        required: true,
        candidates: Candidates.serviceAccounts,
      }),
    ],
    permission: "workflows.workflows.create",
    requiredApis: ["workflows.googleapis.com"],
    run: (ctx, args) => {
      if (ParsedArgs.requiredString(args, "source") !== "workflow.yaml") {
        return invalid(
          "Only the built-in workflow.yaml is supported; arbitrary YAML/code is not evaluated.",
        );
      }
      const name = ParsedArgs.requiredPositional(args, 0);
      if (!Result.isOk(ResourceName.parse(name))) {
        return invalid("Invalid workflow name.");
      }
      const region = CommandContext.resolveRegion(
        ctx,
        Option.or(ParsedArgs.string(args, "location"), ParsedArgs.string(args, "region")),
        "run/region",
      );
      if (!Result.isOk(region)) {
        return region;
      }
      const serviceAccount = ParsedArgs.requiredString(args, "service-account");
      const attached = attachAccount(
        ctx.world,
        ctx.project.projectId,
        ctx.principal,
        serviceAccount,
      );
      if (!Result.isOk(attached)) {
        return invalid(attached.error);
      }
      const workflow: Workflow = {
        projectId: ctx.project.projectId,
        region: region.value,
        name,
        serviceAccount,
        steps: WorkflowSteps,
        executions: [],
      };
      const previous = ctx.world.serverlessLab.workflows.find((w) => sameId(w, workflow));
      if (previous) {
        return invalid(
          "Workflow already exists; delete it before redeploying in this fixed lesson.",
        );
      }
      return finish(
        patchLab(ctx.world, { workflows: [...ctx.world.serverlessLab.workflows, workflow] }),
        { ...workflow },
      );
    },
  }),
  ...(["list", "describe", "delete", "run"] as const).map((action) =>
    projectCommand({
      path: ["gcloud", "workflows", action],
      summary: `${action} a fixed workflow lesson.`,
      positionals:
        action === "list"
          ? []
          : [Positional.required("NAME", "Workflow name.", labCandidates("workflows"))],
      flags: [regionFlag, Flag.string("location", "Workflow region.")],
      permission: {
        list: "workflows.workflows.list",
        describe: "workflows.workflows.get",
        delete: "workflows.workflows.delete",
        run: "workflows.executions.create",
      }[action],
      requiredApis: ["workflows.googleapis.com"],
      destructive: action === "delete",
      run: (ctx, args) => {
        const region = CommandContext.resolveRegion(
          ctx,
          Option.or(ParsedArgs.string(args, "location"), ParsedArgs.string(args, "region")),
          "run/region",
        );
        if (!Result.isOk(region)) {
          return region;
        }
        const items = ctx.world.serverlessLab.workflows.filter(
          (w) => w.projectId === ctx.project.projectId && w.region === region.value,
        );
        if (action === "list") {
          return finish(ctx.world, { workflows: items });
        }
        const workflow = items.find((w) => w.name === ParsedArgs.requiredPositional(args, 0));
        if (!workflow) {
          return invalid("Workflow does not exist in this region.");
        }
        if (action === "describe") {
          return finish(ctx.world, { ...workflow });
        }
        if (action === "delete") {
          return finish(
            patchLab(ctx.world, {
              workflows: ctx.world.serverlessLab.workflows.filter((w) => !sameId(w, workflow)),
            }),
            { deleted: workflow.name },
          );
        }
        let world = ctx.world;
        const executionId = `workflow-execution-${world.sequence + 1}`;
        let invocation: Invocation = {
          principal: workflow.serviceAccount,
          source: "workflow",
          status: "SUCCEEDED",
          reason: "All fixed workflow steps completed.",
          revision: "",
          eventId: executionId,
        };
        for (const step of workflow.steps) {
          const [kind, name] = step.split(":");
          const d = findDeployment(
            world,
            { ...workflow, name: name ?? "" },
            kind as "run" | "function",
          );
          if (!d) {
            invocation = {
              ...invocation,
              status: "FAILED",
              reason: `Step target ${step} is missing.`,
            };
            break;
          }
          if (d.trigger.kind !== "http") {
            invocation = {
              ...invocation,
              status: "FAILED",
              reason: "Workflow steps require HTTP targets.",
            };
            break;
          }
          const result = invoke(world, d, workflow.serviceAccount, "internal", "", executionId);
          world = result.world;
          if (result.invocation.status === "FAILED") {
            invocation = result.invocation;
            break;
          }
        }
        world = { ...world, sequence: world.sequence + 1 };
        world = patchLab(world, {
          workflows: world.serverlessLab.workflows.map((w) =>
            sameId(w, workflow)
              ? { ...w, executions: [...w.executions.slice(-99), invocation] }
              : w,
          ),
        });
        return finishInvocation(world, invocation);
      },
    }),
  ),
];
