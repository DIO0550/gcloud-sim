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
import type { ApiName } from "@/engine/domains/catalog";
import {
  type ObservabilityLab,
  ObserveCpuMetric,
  validateObservabilityLab,
} from "@/engine/domains/observability-lab/model";
import { observeResources } from "@/engine/domains/observability-lab/resources";
import type { World } from "@/engine/domains/world";
import type { JsonRecord } from "@/types/Json";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

export const invalid = (message: string) => Result.err(CommandFailure.invalidArgumentWith(message));
export const missing = (message: string) => Result.err(CommandFailure.notFoundWith(message));
export const text = (args: ParsedArgs, name: string, fallback = ""): string =>
  Option.unwrapOr(ParsedArgs.string(args, name), fallback);
export const sf = (name: string, required = false, candidates: readonly string[] = []): FlagSpec =>
  Flag.string(name, name, {
    required,
    singleUse: true,
    candidates: (world, project) => {
      if (candidates.length > 0) {
        return candidates;
      }
      const projectId = Option.unwrapOr(project, "");
      if (name === "service-account") {
        return world.serviceAccounts.filter((a) => a.projectId === projectId).map((a) => a.email);
      }
      if (name === "metric" || name === "type") {
        return [
          ObserveCpuMetric,
          ...world.observabilityLab.descriptors
            .filter((d) => d.projectId === projectId)
            .map((d) => d.type),
        ];
      }
      if (name === "bucket") {
        return [
          "_Default",
          "_Required",
          ...world.observabilityLab.buckets
            .filter((b) => b.projectId === projectId)
            .map((b) => b.name),
        ];
      }
      if (name === "sink") {
        return [
          "_Default",
          ...world.logSinks.filter((b) => b.projectId === projectId).map((b) => b.name),
        ];
      }
      if (name === "policy-from-file" || name === "config-from-file") {
        return Object.keys(world.kubeFiles).filter((f) => f.endsWith(".json"));
      }
      return [];
    },
  });
export const command = (
  input: Readonly<{
    path: readonly string[];
    permissions: readonly string[];
    api?: ApiName | null;
    flags?: readonly FlagSpec[];
    named?: boolean;
    candidates?: (world: World, projectId: Option<string>) => readonly string[];
    destructive?: boolean;
    run: (ctx: ProjectContext, args: ParsedArgs) => CommandResult;
  }>,
): CommandSpec =>
  projectCommand({
    path: input.path,
    summary:
      "Configure and evaluate a bounded observability lesson; no network, real alerts or arbitrary code.",
    permissions: input.permissions,
    requiredApis: input.api === null ? [] : [input.api ?? "monitoring.googleapis.com"],
    positionals: input.named
      ? [
          Positional.required(
            "NAME",
            "Lesson resource identity.",
            input.candidates ??
              ((world, project) => {
                const group = input.path[2];
                const keys: Readonly<Record<string, keyof ObservabilityLab>> = {
                  channels: "channels",
                  "metric-descriptors": "descriptors",
                  collectors: "collectors",
                  slos: "objectives",
                  buckets: "buckets",
                  views: "views",
                  exclusions: "exclusions",
                  policies: "policies",
                  resources: "channels",
                };
                if (group === "policies") {
                  return world.alertPolicies
                    .filter((p) => !project.some || p.projectId === project.value)
                    .flatMap((p) => [p.name, p.displayName]);
                }
                if (group === "resources") {
                  return observeResources(world, Option.unwrapOr(project, "")).map((r) => r.name);
                }
                if (group === "metrics-scopes") {
                  return world.projects.map((p) => `projects/${p.projectId}`);
                }
                const key = keys[group ?? ""];
                if (!key || key === "clock") {
                  return [];
                }
                return world.observabilityLab[key]
                  .filter((p) => !project.some || p.projectId === project.value)
                  .map((p) => p.name);
              }),
          ),
        ]
      : [],
    flags: [
      ...(input.flags ?? []),
      ...(input.path[0] === "sim"
        ? [
            Flag.string("project", "Selected project.", { candidates: Candidates.projects }),
            sf("account"),
            Flag.boolean("quiet", "Skip confirmation."),
          ]
        : []),
    ],
    destructive: input.destructive ?? false,
    run: input.run,
  });
export const name = (args: ParsedArgs): string => ParsedArgs.requiredPositional(args, 0);
export const finish = (world: World, record: JsonRecord): CommandResult =>
  Result.ok({ world, output: CommandOutput.yaml(record) });
export const save = (
  world: World,
  patch: Partial<ObservabilityLab>,
  record: JsonRecord,
): CommandResult => {
  const next = { ...world, observabilityLab: { ...world.observabilityLab, ...patch } };
  return Result.flatMap(
    Result.mapErr(validateObservabilityLab(next), CommandFailure.invalidState),
    (checked) => finish(checked, record),
  );
};
export const readJson = (ctx: ProjectContext, path: string): Result<unknown, CommandFailure> => {
  const content = ctx.world.kubeFiles[path] ?? ctx.world.terraform.files[path];
  if (content === undefined) {
    return missing(`Virtual file ${path} is missing. Use sim files write.`);
  }
  try {
    return Result.ok(JSON.parse(content));
  } catch {
    return invalid("This lesson supports JSON configuration only.");
  }
};
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key));
export const same = (
  a: { projectId: string; name: string },
  b: { projectId: string; name: string },
): boolean => a.projectId === b.projectId && a.name === b.name;
