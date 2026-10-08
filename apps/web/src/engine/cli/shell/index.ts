import { ArgParser } from "@/engine/cli/arg-parser";
import { CommandFailure } from "@/engine/cli/command-failure";
import {
  type AuthorizedContext,
  CommandContext,
  type CommandOutput,
  type CommandResult,
  CommandSpec,
  Flag,
  type FlagSpec,
  type MessageTone,
  type OutputMessage,
  ParsedArgs,
} from "@/engine/cli/command-spec";
import {
  Filter,
  type FilterExpr,
  Formatter,
  type ListOptions,
  OutputFormat,
} from "@/engine/cli/formatter";
import { CommandRegistry } from "@/engine/cli/registry";
import { Tokenizer } from "@/engine/cli/tokenizer";
import { ApiService } from "@/engine/domains/catalog";
import { EffectivePermissions } from "@/engine/domains/effective-permissions";
import { Principal } from "@/engine/domains/principal";
import type { PolicyTarget } from "@/engine/domains/resource-hierarchy";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

/** ターミナルに書く 1 行。`tone` は UI が色に対応させる。 */
export type OutputLine = Readonly<{ text: string; tone: MessageTone | "error" }>;

/**
 * shell の状態。確認プロンプト（`Do you want to continue (Y/n)?`）を出した後は、
 * 次の入力行を答えとして消費する。World には含めない（保存しない）。
 */
export type ShellState =
  | Readonly<{ kind: "ready" }>
  | Readonly<{ kind: "confirming"; tokens: readonly string[]; explicitYes?: boolean }>;

export type ShellInput = Readonly<{
  world: World;
  state: ShellState;
  line: string;
  now: string;
  registry: CommandRegistry;
}>;

/**
 * 1 行の実行がどう終わったか。Console ビューはこれを見て「一覧へ戻る」「赤帯を出す」「API を
 * 有効にするボタンを出す」を決める（出力行の綴りは判定に使わない）。
 */
export type ExecutionOutcome =
  | Readonly<{ kind: "succeeded" }>
  | Readonly<{ kind: "failed"; failure: CommandFailure }>
  | Readonly<{ kind: "confirming" }>
  | Readonly<{ kind: "none" }>;

export type ShellResult = Readonly<{
  world: World;
  state: ShellState;
  lines: readonly OutputLine[];
  /** `clear` が打たれた。UI は画面を消す */
  clearsScreen: boolean;
  outcome: ExecutionOutcome;
}>;

const Ready: ShellState = Object.freeze({ kind: "ready" });

/** すべてのコマンドが受けるフラグ。`--help` は ArgParser が先に見る。 */
const GlobalFlags: readonly FlagSpec[] = [
  Flag.string("project", "The Google Cloud project ID to use for this invocation.", {
    candidates: (world) => World.activeProjects(world).map((p) => p.projectId),
  }),
  Flag.string("account", "Google Cloud user account to use for invocation.", {
    candidates: (world) => world.session.accounts,
  }),
  Flag.string(
    "format",
    "Set the format for printing command output resources (json, yaml, value(FIELDS), table(FIELDS)).",
  ),
  Flag.string("filter", "Apply a Boolean filter EXPRESSION to each resource item to be listed."),
  Flag.integer("limit", "Maximum number of resources to list."),
  Flag.string("sort-by", "A comma-separated list of resource field key names to sort by."),
  Flag.boolean("quiet", "Disable all interactive prompts.", { aliases: ["-q"] }),
  Flag.boolean("help", "Display detailed help.", { aliases: ["-h"] }),
  Flag.enum("verbosity", "Override the default verbosity for this command.", [
    "debug",
    "info",
    "warning",
    "error",
    "critical",
    "none",
  ]),
];

const line = (text: string, tone: OutputLine["tone"]): OutputLine => ({ text, tone });
const lines = (text: string, tone: OutputLine["tone"]): readonly OutputLine[] =>
  text.split("\n").map((t) => line(t, tone));

const messageLines = (messages: readonly OutputMessage[]): readonly OutputLine[] =>
  messages.flatMap((m) => lines(m.text, m.tone));

/** kubectl は `ERROR: (tool.command)` の接頭辞を付けず、本文（`error:` / `Error from server`）をそのまま出す。 */
const failureLines = (
  spec: Option<CommandSpec>,
  failure: CommandFailure,
): readonly OutputLine[] => {
  const prefix = Option.isSome(spec) ? `(${CommandSpec.dottedPath(spec.value)})` : "(gcloud)";
  const isKubectl = Option.isSome(spec) && spec.value.path[0] === "kubectl";
  const head = CommandFailure.isSimulatorOwn(failure)
    ? lines(`gcloud-sim: ${failure.message}`, "error")
    : isKubectl
      ? lines(
          failure.message.replace(/^(?!error:|Error from server|The connection)/, "error: "),
          "error",
        )
      : lines(`ERROR: ${prefix} ${failure.message}`, "error");
  const hints = failure.hints.flatMap((h) => lines(`gcloud-sim: ${h}`, "hint"));
  return [...head, ...hints];
};

const Succeeded: ExecutionOutcome = Object.freeze({ kind: "succeeded" as const });
const NoOutcome: ExecutionOutcome = Object.freeze({ kind: "none" as const });
const failed = (failure: CommandFailure): ExecutionOutcome => ({ kind: "failed", failure });

const result = (
  world: World,
  state: ShellState,
  output: readonly OutputLine[],
  outcome: ExecutionOutcome = NoOutcome,
): ShellResult => ({ world, state, lines: output, clearsScreen: false, outcome });

const listOptions = (args: ParsedArgs): Result<ListOptions, CommandFailure> => {
  const format = OutputFormat.parse(ParsedArgs.string(args, "format"));
  if (!Result.isOk(format)) return format;
  const rawFilter = ParsedArgs.string(args, "filter");
  const filter: Result<Option<FilterExpr>, CommandFailure> = Option.isSome(rawFilter)
    ? Result.map(Filter.parse(rawFilter.value), (expr) => Option.some(expr))
    : Result.ok(Option.none);
  if (!Result.isOk(filter)) return filter;
  return Result.ok({
    format: format.value,
    filter: filter.value,
    limit: ParsedArgs.integer(args, "limit"),
    sortBy: ParsedArgs.string(args, "sort-by"),
  });
};

const outputLines = (output: CommandOutput, options: ListOptions): readonly OutputLine[] => [
  ...messageLines(output.messages),
  ...Formatter.render(output.records, output.columns, output.defaultFormat, options).map((t) =>
    line(t, "plain"),
  ),
  ...messageLines(output.trailing),
];

/**
 * 主体を決める（`--account` → `core/account`）。`plain` 以外のコマンドは主体が要るので、
 * 無ければ本物と同じ「アカウントが選ばれていない」失敗にする。
 */
const resolvePrincipal = (world: World, args: ParsedArgs): Result<Principal, CommandFailure> => {
  const flag = ParsedArgs.string(args, "account");
  if (Option.isSome(flag)) {
    return Result.mapErr(Principal.parse(flag.value), (m) =>
      CommandFailure.invalidValue("--account", m),
    );
  }
  return Option.toResult(World.currentPrincipal(world), CommandFailure.noActiveAccount);
};

const authorize = (
  ctx: AuthorizedContext,
  target: PolicyTarget,
  permissions: readonly string[],
): Result<AuthorizedContext, CommandFailure> => {
  const effective = EffectivePermissions.resolve(
    ctx.world,
    Principal.toMember(ctx.principal),
    target,
  );
  return Result.map(
    Result.mapErr(
      EffectivePermissions.require(effective, permissions),
      CommandFailure.permissionDenied,
    ),
    () => ctx,
  );
};

const runSpec = (spec: CommandSpec, ctx: CommandContext, args: ParsedArgs): CommandResult => {
  switch (spec.kind) {
    case "not-implemented":
      return Result.err(CommandFailure.notImplemented(spec.path));
    case "plain":
      return spec.run(ctx, args);
    case "target": {
      const target = spec.resolveTarget(ctx, args);
      if (!Result.isOk(target)) return target;
      const principal = resolvePrincipal(ctx.world, args);
      if (!Result.isOk(principal)) return principal;
      const authorized = authorize(
        { ...ctx, principal: principal.value },
        target.value,
        spec.requiredPermissions,
      );
      return Result.flatMap(authorized, (c) => spec.run({ ...c, target: target.value }, args));
    }
    case "project": {
      const project = CommandContext.requireProject(ctx);
      if (!Result.isOk(project)) return project;
      const disabled = spec.requiredApis.find(
        (api) => !World.hasApi(ctx.world, project.value.projectId, api),
      );
      if (disabled !== undefined) {
        const service = ApiService.parse(disabled);
        const title = Option.isSome(service) ? service.value.title : disabled;
        return Result.err(CommandFailure.apiDisabled(title, disabled, project.value.projectId));
      }
      const principal = resolvePrincipal(ctx.world, args);
      if (!Result.isOk(principal)) return principal;
      const target: PolicyTarget = { type: "project", id: project.value.projectId };
      const authorized = authorize(
        { ...ctx, principal: principal.value },
        target,
        spec.requiredPermissions,
      );
      return Result.flatMap(authorized, (c) => spec.run({ ...c, project: project.value }, args));
    }
  }
};

const execute = (
  input: ShellInput,
  tokens: readonly string[],
  forceQuiet: boolean,
): ShellResult => {
  const { world, registry } = input;
  const resolved = CommandRegistry.resolve(registry, tokens);
  if (!Result.isOk(resolved))
    return result(world, Ready, failureLines(Option.none, resolved.error), failed(resolved.error));
  const { spec, rest, releaseTrack } = resolved.value;
  const globals = globalsFor(spec.path[0]);
  const trackWarning = Option.isSome(releaseTrack)
    ? [
        line(
          `WARNING: gcloud-sim treats 'gcloud ${releaseTrack.value}' as 'gcloud' (release tracks are not simulated).`,
          "warning",
        ),
      ]
    : [];

  if (ArgParser.asksHelp(rest)) {
    return result(world, Ready, [
      ...trackWarning,
      ...CommandRegistry.help(spec, globals).map((t) => line(t, "plain")),
    ]);
  }
  if (spec.kind === "not-implemented") {
    const failure = CommandFailure.notImplemented(spec.path);
    return result(
      world,
      Ready,
      [...trackWarning, ...failureLines(Option.some(spec), failure)],
      failed(failure),
    );
  }

  const args = ArgParser.parse(rest, [...spec.flags, ...globals], spec.positionals);
  if (!Result.isOk(args))
    return result(
      world,
      Ready,
      [...trackWarning, ...failureLines(Option.some(spec), args.error)],
      failed(args.error),
    );

  const options = listOptions(args.value);
  if (!Result.isOk(options))
    return result(
      world,
      Ready,
      [...trackWarning, ...failureLines(Option.some(spec), options.error)],
      failed(options.error),
    );

  const projectFlag = ParsedArgs.string(args.value, "project");
  const ctx: CommandContext = {
    world,
    now: input.now,
    projectId: Option.or(projectFlag, World.currentProjectId(world)),
    projectFlag,
  };
  if (spec.confirmation && !forceQuiet && !spec.confirmation.skip(args.value)) {
    const preview = spec.confirmation.preview(ctx, args.value);
    if (!Result.isOk(preview))
      return result(
        world,
        Ready,
        failureLines(Option.some(spec), preview.error),
        failed(preview.error),
      );
    return result(
      world,
      { kind: "confirming", tokens, explicitYes: true },
      [
        ...outputLines(preview.value.output, options.value),
        line("Enter 'yes' to apply these changes, or 'no' to cancel:", "plain"),
      ],
      { kind: "confirming" },
    );
  }
  const quiet = forceQuiet || ParsedArgs.boolean(args.value, "quiet");
  if (spec.destructive && !quiet) {
    return result(
      world,
      { kind: "confirming", tokens },
      [...trackWarning, line("Do you want to continue (Y/n)?", "plain")],
      { kind: "confirming" },
    );
  }

  const outcome = runSpec(spec, ctx, args.value);
  if (!Result.isOk(outcome))
    return result(
      world,
      Ready,
      [...trackWarning, ...failureLines(Option.some(spec), outcome.error)],
      failed(outcome.error),
    );
  return result(
    outcome.value.world,
    Ready,
    [
      ...trackWarning,
      ...outputLines(outcome.value.output, options.value),
      ...(outcome.value.failure ? failureLines(Option.some(spec), outcome.value.failure) : []),
    ],
    outcome.value.failure ? failed(outcome.value.failure) : Succeeded,
  );
};

const answerConfirmation = (input: ShellInput, tokens: readonly string[]): ShellResult => {
  const answer = input.line.trim().toLowerCase();
  if (input.state.kind === "confirming" && input.state.explicitYes) {
    if (answer === "yes") return execute(input, tokens, true);
    if (answer === "no" || answer === "n" || answer === "")
      return result(input.world, Ready, [line("Apply cancelled.", "plain")]);
    return result(input.world, input.state, [line("Please enter 'yes' or 'no':", "plain")], {
      kind: "confirming",
    });
  }
  if (answer === "" || answer === "y" || answer === "yes") return execute(input, tokens, true);
  if (answer === "n" || answer === "no")
    return result(input.world, Ready, [line("ERROR: (gcloud) Aborted by user.", "error")]);
  return result(input.world, input.state, [line("Please enter 'y' or 'n':  ", "plain")], {
    kind: "confirming",
  });
};

const globalsFor = (tool: string | undefined): readonly FlagSpec[] =>
  tool === "terraform" || tool === "sim" || tool === "docker"
    ? GlobalFlags.filter((flag) => flag.name === "help")
    : GlobalFlags;

export const Shell = {
  Ready,
  GlobalFlags,
  globalsFor,

  /**
   * 1 行を受け取り、World と shell の状態を進めて出力行を返す（UC-001 のステップ 1〜8）。
   * 保存（ステップ 9）とミッション評価（ステップ 10）は呼び出し側（`engine/index.ts`）が行う。
   *
   * @param input World・状態・入力行・時刻・登録簿
   * @returns 新しい World・状態・出力行
   */
  submit(input: ShellInput): ShellResult {
    if (input.state.kind === "confirming") return answerConfirmation(input, input.state.tokens);

    const tokens = Tokenizer.tokenize(input.line);
    if (!Result.isOk(tokens)) {
      return result(
        input.world,
        Ready,
        failureLines(Option.none, CommandFailure.unclosedQuote(tokens.error.quote)),
      );
    }
    const first = tokens.value[0];
    if (first === undefined) return result(input.world, Ready, []);
    if (first === "clear") return { ...result(input.world, Ready, []), clearsScreen: true };
    const knownTools = new Set(input.registry.specs.map((s) => s.path[0]));
    if (!knownTools.has(first)) {
      return result(input.world, Ready, [line(`bash: ${first}: command not found`, "error")]);
    }
    return execute(input, tokens.value, false);
  },
} as const;
