import { CommandFailure } from "@/engine/cli/command-failure";
import {
  CommandOutput,
  type CommandResult,
  type CommandSpec,
  Flag,
  type FlagSpec,
  ParsedArgs,
  Positional,
  type ProjectContext,
} from "@/engine/cli/command-spec";
import { Candidates, projectCommand } from "@/engine/commands/shared";
import { AceScenarios, findScenario } from "@/engine/domains/ace-support/catalog";
import {
  type AceDecision,
  AiKinds,
  AiPlatforms,
  AiRegions,
  type AiResource,
  aiIdentity,
  validateAceSupport,
} from "@/engine/domains/ace-support/model";
import { type ApiName, ApiService } from "@/engine/domains/catalog";
import { EffectivePermissions } from "@/engine/domains/effective-permissions";
import { Principal } from "@/engine/domains/principal";
import { World } from "@/engine/domains/world";
import type { JsonRecord } from "@/types/Json";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const invalid = (message: string) => Result.err(CommandFailure.invalidArgumentWith(message));
const missing = (message: string) => Result.err(CommandFailure.notFoundWith(message));
const text = (args: ParsedArgs, key: string, fallback = ""): string =>
  Option.unwrapOr(ParsedArgs.string(args, key), fallback);
const permissions = (ctx: ProjectContext, required: readonly string[]) =>
  Result.mapErr(
    EffectivePermissions.require(
      EffectivePermissions.resolve(ctx.world, Principal.toMember(ctx.principal), {
        type: "project",
        id: ctx.project.projectId,
      }),
      required,
    ),
    CommandFailure.permissionDenied,
  );
const apiFor = (r: Pick<AiResource, "platform">): ApiName =>
  (
    ({
      "vertex-ai": "aiplatform.googleapis.com",
      workbench: "notebooks.googleapis.com",
      workstations: "workstations.googleapis.com",
    }) as const
  )[r.platform];
const permissionFor = (r: Pick<AiResource, "platform">, action: string): string => {
  const prefix = {
    "vertex-ai": "aiplatform.reasoningEngines",
    workbench: "notebooks.instances",
    workstations: "workstations.workstations",
  }[r.platform];
  if (r.platform === "vertex-ai" && ["start", "stop"].includes(action)) {
    return `${prefix}.update`;
  }
  return `${prefix}.${action}`;
};
const guard = (
  ctx: ProjectContext,
  r: AiResource,
  action: string,
): Result<void, CommandFailure> => {
  const api = apiFor(r);
  if (!World.hasApi(ctx.world, ctx.project.projectId, api)) {
    return Result.err(
      CommandFailure.apiDisabled(
        Option.unwrapOr(
          Option.map(ApiService.parse(api), (a) => a.title),
          api,
        ),
        api,
        ctx.project.projectId,
      ),
    );
  }
  const required = permissions(ctx, [permissionFor(r, action)]);
  if (!required.ok) {
    return required;
  }
  if (["create", "update", "start"].includes(action)) {
    const sa = ctx.world.serviceAccounts.find(
      (s) => s.projectId === ctx.project.projectId && s.email === r.serviceAccount,
    );
    if (!sa) {
      return missing("Use a service account from the selected project.");
    }
    const actAs = Result.mapErr(
      EffectivePermissions.require(
        EffectivePermissions.resolve(ctx.world, Principal.toMember(ctx.principal), {
          type: "service-account",
          id: sa.email,
        }),
        ["iam.serviceAccounts.actAs"],
      ),
      CommandFailure.permissionDenied,
    );
    if (!actAs.ok) {
      return actAs;
    }
  }
  if (["create", "update", "start"].includes(action)) {
    const subnet = ctx.world.subnets.find(
      (s) => s.projectId === r.projectId && s.name === r.subnet && s.region === r.region,
    );
    if (!subnet) {
      return missing("Use a subnet from the selected project and region.");
    }
    const use = permissions(ctx, ["compute.subnetworks.use"]);
    if (!use.ok) {
      return use;
    }
    if (action === "start" && r.access === "private" && !subnet.privateIpGoogleAccess) {
      return invalid("Private lesson start requires Private Google Access on the regional subnet.");
    }
  }
  return Result.ok(undefined);
};
const record = (r: AiResource): JsonRecord => ({
  ...r,
  simulation: "configuration/lifecycle only; no AI, VM, notebook execution or billing",
});
const finish = (world: World, output: JsonRecord): CommandResult =>
  Result.map(Result.mapErr(validateAceSupport(world), CommandFailure.invalidState), (next) => ({
    world: next,
    output: CommandOutput.yaml(output),
  }));
const sf = (key: string, required = false): FlagSpec =>
  Flag.string(key, key, {
    required,
    singleUse: true,
    candidates: (
      { "service-account": Candidates.serviceAccounts, subnet: Candidates.subnets } as Record<
        string,
        typeof Candidates.serviceAccounts
      >
    )[key],
  });
const command = (
  path: readonly string[],
  flags: readonly FlagSpec[],
  named: boolean,
  run: (ctx: ProjectContext, args: ParsedArgs) => CommandResult,
  destructive = false,
): CommandSpec =>
  projectCommand({
    path,
    summary: "Bounded ACE decision or AI configuration lesson; no real cloud/AI/code execution.",
    permissions: ["resourcemanager.projects.get"],
    flags: [
      ...flags,
      Flag.string("project", "Selected project.", { candidates: Candidates.projects }),
      Flag.string("account", "Authenticated lesson account.", { candidates: Candidates.accounts }),
      Flag.boolean("quiet", "Skip confirmation."),
    ],
    positionals: named
      ? [
          Positional.required("NAME", "Lesson identity.", (world, project) =>
            path[1] === "ace"
              ? AceScenarios.map((s) => s.id)
              : world.aceSupport.resources
                  .filter((r) => !project.some || r.projectId === project.value)
                  .map((r) => r.name),
          ),
        ]
      : [],
    destructive,
    run,
  });

const decisionCommands = (["list", "describe", "choose"] as const).map((action) =>
  command(
    ["sim", "ace", "scenarios", action],
    action === "choose"
      ? [
          Flag.enum(
            "choice",
            "Choose an option from the selected scenario.",
            [...new Set(AceScenarios.flatMap((item) => item.choices))],
            { required: true },
          ),
          sf("reason", true),
        ]
      : [],
    action !== "list",
    (ctx, args) => {
      if (action === "list") {
        return Result.ok({
          world: ctx.world,
          output: CommandOutput.yamlList(
            AceScenarios.map((s) => ({
              id: s.id,
              title: s.title,
              axis: s.axis,
              choices: [...s.choices],
            })),
          ),
        });
      }
      const scenario = findScenario(ParsedArgs.requiredPositional(args, 0));
      if (!scenario) {
        return missing("Unknown ACE scenario. Use sim ace scenarios list.");
      }
      const previous = ctx.world.aceSupport.decisions.find(
        (d) => d.projectId === ctx.project.projectId && d.scenario === scenario.id,
      );
      if (action === "describe") {
        return finish(ctx.world, {
          ...scenario,
          choices: [...scenario.choices],
          decision: previous ? { ...previous, correct: previous.choice === scenario.answer } : null,
          grading:
            "Choice is graded against fixed requirements. Your explanation is saved, not semantically graded.",
        });
      }
      const choice = text(args, "choice");
      const reason = text(args, "reason");
      if (!scenario.choices.includes(choice)) {
        return invalid(`Supported choices: ${scenario.choices.join(", ")}`);
      }
      if (reason.trim().length < 4 || reason.length > 500) {
        return invalid("--reason must contain 4..500 characters.");
      }
      const decision: AceDecision = {
        projectId: ctx.project.projectId,
        scenario: scenario.id,
        choice,
        reason,
        attempts: (previous?.attempts ?? 0) + 1,
      };
      const world = {
        ...ctx.world,
        aceSupport: {
          ...ctx.world.aceSupport,
          decisions: [
            ...ctx.world.aceSupport.decisions.filter(
              (d) => d.projectId !== decision.projectId || d.scenario !== decision.scenario,
            ),
            decision,
          ],
        },
      };
      return finish(world, {
        ...decision,
        verdict: choice === scenario.answer ? "CORRECT" : "INCORRECT",
        requirements: scenario.requirements,
        feedback: scenario.reason,
        grading: "Fixed choice only; your explanation is saved.",
      });
    },
  ),
);
const locationFlags = [
  Flag.enum("region", "Lesson region; not a live availability catalog.", AiRegions, {
    required: true,
  }),
];
const configFlags = (required: boolean): readonly FlagSpec[] => [
  ...(required
    ? [
        Flag.enum("kind", "Lesson resource type.", AiKinds, { required: true }),
        Flag.enum("platform", "Lesson platform.", AiPlatforms, { required: true }),
      ]
    : []),
  sf("service-account", required),
  sf("subnet", required),
  Flag.enum("access", "Lesson access scope.", ["private", "public"]),
  sf("idle-minutes"),
];
const changeResource = (r: AiResource, action: string, args: ParsedArgs): AiResource => {
  switch (action) {
    case "update": {
      const access = text(args, "access", r.access) as AiResource["access"];
      const securesStoppedPublic =
        r.access === "public" &&
        access === "private" &&
        r.status === "STOPPED" &&
        r.publicStoppedRevision > 0 &&
        r.lastStartedRevision === r.publicStoppedRevision;
      return {
        ...r,
        serviceAccount: text(args, "service-account", r.serviceAccount),
        subnet: text(args, "subnet", r.subnet),
        access,
        idleMinutes: Number(text(args, "idle-minutes", String(r.idleMinutes))),
        revision: r.revision + 1,
        securedFromRevision:
          access === "public"
            ? 0
            : securesStoppedPublic
              ? r.publicStoppedRevision
              : r.securedFromRevision,
      };
    }
    case "start":
      return { ...r, status: "RUNNING", starts: r.starts + 1, lastStartedRevision: r.revision };
    case "stop":
      return {
        ...r,
        status: "STOPPED",
        stops: r.stops + 1,
        publicStoppedRevision: r.access === "public" ? r.revision : r.publicStoppedRevision,
      };
    default:
      return r;
  }
};
const resourceCommands = (
  ["create", "update", "start", "stop", "delete", "describe", "list"] as const
).map((action) =>
  command(
    ["sim", "ai", "resources", action],
    [
      ...(action === "list" ? [] : locationFlags),
      ...(action === "create" || action === "update" ? configFlags(action === "create") : []),
    ],
    action !== "list",
    (ctx, args) => {
      const items = ctx.world.aceSupport.resources.filter(
        (r) => r.projectId === ctx.project.projectId,
      );
      if (action === "list") {
        for (const item of items) {
          const checked = guard(ctx, item, "list");
          if (!checked.ok) {
            return checked;
          }
        }
        return Result.ok({ world: ctx.world, output: CommandOutput.yamlList(items.map(record)) });
      }
      const name = ParsedArgs.requiredPositional(args, 0);
      const region = text(args, "region") as AiResource["region"];
      const existing = items.find((r) => r.name === name && r.region === region);
      if (action === "create" && existing) {
        return invalid("This regional lesson resource already exists.");
      }
      if (action !== "create" && !existing) {
        return missing("No AI lesson resource in this project/region.");
      }
      const r: AiResource = existing ?? {
        projectId: ctx.project.projectId,
        name,
        region,
        kind: text(args, "kind") as AiResource["kind"],
        platform: text(args, "platform") as AiResource["platform"],
        serviceAccount: text(args, "service-account"),
        subnet: text(args, "subnet"),
        access: text(args, "access", "private") as AiResource["access"],
        idleMinutes: Number(
          text(args, "idle-minutes", text(args, "kind") === "agent" ? "0" : "30"),
        ),
        status: "CONFIGURED",
        revision: 1,
        lastStartedRevision: 0,
        publicStoppedRevision: 0,
        securedFromRevision: 0,
        starts: 0,
        stops: 0,
      };
      if (action === "describe") {
        const checked = guard(ctx, r, "get");
        return checked.ok ? finish(ctx.world, record(r)) : checked;
      }
      if ((action === "update" || action === "delete") && r.status === "RUNNING") {
        return invalid("Stop the lesson resource before changing or deleting its configuration.");
      }
      if (action === "start" && r.status === "RUNNING") {
        return invalid("Lesson resource is already running.");
      }
      if (action === "stop" && r.status !== "RUNNING") {
        return invalid("Only a running lesson resource can be stopped.");
      }
      const next = changeResource(r, action, args);
      if (
        action === "update" &&
        !["service-account", "subnet", "access", "idle-minutes"].some(
          (key) => ParsedArgs.string(args, key).some,
        )
      ) {
        return invalid("Supply at least one supported configuration field.");
      }
      const checked = guard(ctx, next, action);
      if (!checked.ok) {
        return checked;
      }
      const resources = ctx.world.aceSupport.resources.filter(
        (item) => aiIdentity(item) !== aiIdentity(r),
      );
      return finish(
        {
          ...ctx.world,
          aceSupport: {
            ...ctx.world.aceSupport,
            resources: action === "delete" ? resources : [...resources, next],
          },
        },
        { ...record(next), action, deleted: action === "delete" },
      );
    },
    action === "delete",
  ),
);
export const AceSupportCommands: readonly CommandSpec[] = [
  ...decisionCommands,
  ...resourceCommands,
];
