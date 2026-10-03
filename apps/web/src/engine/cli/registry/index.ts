import { CommandFailure } from "@/engine/cli/command-failure";
import {
  type CandidateSource,
  type CommandSpec,
  Flag,
  type FlagSpec,
  type PositionalSpec,
} from "@/engine/cli/command-spec";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

/** 登録済みコマンドの集合。解決・ヘルプ・補完の候補を持つ。 */
export type CommandRegistry = Readonly<{
  specs: readonly CommandSpec[];
}>;

export type Resolved = Readonly<{
  spec: CommandSpec;
  /** コマンドパスの後ろに残ったトークン */
  rest: readonly string[];
  /** `gcloud beta` / `gcloud alpha` を読み飛ばしたか（警告を出す） */
  releaseTrack: Option<"alpha" | "beta">;
}>;

const ReleaseTracks = ["alpha", "beta"] as const;

const startsWith = (path: readonly string[], prefix: readonly string[]): boolean =>
  prefix.length <= path.length && prefix.every((segment, i) => path[i] === segment);

/** Levenshtein 距離。`Did you mean` の候補選びに使う。 */
const distance = (a: string, b: string): number => {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (const [i, charA] of [...a].entries()) {
    const current = [i + 1];
    for (const [j, charB] of [...b].entries()) {
      current.push(
        Math.min(
          (previous[j + 1] ?? 0) + 1,
          (current[j] ?? 0) + 1,
          (previous[j] ?? 0) + (charA === charB ? 0 : 1),
        ),
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
};

const childrenOf = (registry: CommandRegistry, prefix: readonly string[]): readonly string[] => {
  const names = registry.specs
    .filter((spec) => startsWith(spec.path, prefix) && spec.path.length > prefix.length)
    .map((spec) => spec.path[prefix.length] as string);
  return [...new Set(names)].toSorted();
};

const exactSpec = (registry: CommandRegistry, path: readonly string[]): Option<CommandSpec> =>
  Option.fromNullable(
    registry.specs.find((spec) => spec.path.length === path.length && startsWith(spec.path, path)),
  );

/** 補完の依頼。`tokens` は確定した語（ツール名を含む）、`partial` は打ちかけの最後の語。 */
export type CompletionRequest = Readonly<{
  tokens: readonly string[];
  partial: string;
  world: World;
}>;

/** `--name` か別名（`-o` 等）で定義を引く。`token` は `-` を含む打たれたままの綴り。 */
const findFlag = (flags: readonly FlagSpec[], token: string): Option<FlagSpec> =>
  Option.fromNullable(flags.find((f) => `--${f.name}` === token || f.aliases.includes(token)));

/** `--project=P` / `--project P` の値。 */
const flagValueIn = (tokens: readonly string[], name: string): Option<string> => {
  const index = tokens.findIndex((t) => t === `--${name}` || t.startsWith(`--${name}=`));
  const token = tokens[index];
  if (token === undefined) return Option.none;
  return token.includes("=")
    ? Option.some(token.slice(token.indexOf("=") + 1))
    : Option.fromNullable(tokens[index + 1]);
};

/**
 * 確定した引数のうち位置引数の数。`--flag value` の value は数えない
 * （boolean 以外のフラグの直後で `=` の無いものは値）。
 */
const positionalCount = (rest: readonly string[], flags: readonly FlagSpec[]): number => {
  let count = 0;
  let expectsValue = false;
  for (const token of rest) {
    if (expectsValue) {
      expectsValue = false;
      continue;
    }
    if (token.startsWith("-")) {
      const flag = findFlag(flags, token.replace(/=.*$/, ""));
      expectsValue = Option.isSome(flag) && flag.value.kind !== "boolean" && !token.includes("=");
      continue;
    }
    count += 1;
  }
  return count;
};

/** n 番目の位置引数の定義。末尾が可変長ならそれ以降はすべて末尾。 */
const positionalAt = (
  positionals: readonly PositionalSpec[],
  index: number,
): Option<PositionalSpec> => {
  const last = positionals.at(-1);
  if (index < positionals.length) return Option.fromNullable(positionals[index]);
  return last?.variadic === true ? Option.some(last) : Option.none;
};

const flagHelp = (flag: FlagSpec): string => {
  const value =
    flag.kind === "boolean"
      ? ""
      : flag.kind === "enum"
        ? `=${flag.choices.join("|")}`
        : `=${flag.name.toUpperCase().replace(/-/g, "_")}`;
  const required = flag.required ? " (required)" : "";
  const aliases = flag.aliases.length ? ` (aliases: ${flag.aliases.join(", ")})` : "";
  return `  --${flag.name}${value}${required}${aliases}\n      ${flag.description}`;
};

export const CommandRegistry = {
  /**
   * コマンド定義から登録簿を作る。定義は `engine/commands/` が持ち、ここは並びを受け取るだけ
   * （cli → commands の逆流を作らない）。
   *
   * @param specs 登録するコマンド
   * @returns 登録簿
   */
  create(specs: readonly CommandSpec[]): CommandRegistry {
    return { specs };
  },

  /**
   * トークン列からコマンドを最長一致で解決する（UC-001 ステップ 3）。
   * `gcloud beta` / `gcloud alpha` は読み飛ばす。
   *
   * @param registry 登録簿
   * @param tokens ツール名（`gcloud` 等）を含むトークン
   * @returns 解決したコマンドと残りのトークン。解決できなければ E-001
   */
  resolve(registry: CommandRegistry, tokens: readonly string[]): Result<Resolved, CommandFailure> {
    const tool = tokens[0];
    const trackToken = tokens[1];
    const track = ReleaseTracks.find((t) => t === trackToken && tool === "gcloud");
    const stripped = track === undefined ? tokens : [tool as string, ...tokens.slice(2)];
    const releaseTrack: Option<"alpha" | "beta"> = Option.fromNullable(track);

    let path: string[] = [];
    let index = 0;
    while (index < stripped.length) {
      const token = stripped[index] as string;
      const next = [...path, token];
      const continues = registry.specs.some((spec) => startsWith(spec.path, next));
      if (!continues) break;
      path = next;
      index += 1;
    }

    const spec = exactSpec(registry, path);
    if (Option.isSome(spec)) {
      return Result.ok({ spec: spec.value, rest: stripped.slice(index), releaseTrack });
    }
    const children = childrenOf(registry, path);
    const attempted = stripped[index];
    const isFlag = attempted?.startsWith("-") ?? false;
    if (attempted === undefined || isFlag) {
      return Result.err(CommandFailure.commandExpected(children));
    }
    const candidates = children
      .filter(
        (child) => distance(child, attempted) <= Math.max(2, Math.floor(attempted.length / 3)),
      )
      .slice(0, 3);
    return Result.err(CommandFailure.unknownCommand(attempted, candidates));
  },

  /**
   * `--help` の本文を組み立てる。
   *
   * @param spec コマンド
   * @param globalFlags すべてのコマンドが受けるフラグ
   * @returns ヘルプの行
   */
  help(spec: CommandSpec, globalFlags: readonly FlagSpec[]): readonly string[] {
    const name = spec.path.join(" ");
    if (spec.kind === "not-implemented") {
      return [
        `NAME`,
        `    ${name} - ${spec.summary}`,
        "",
        `gcloud-sim: command not implemented yet: ${name}`,
      ];
    }
    const positionals = spec.positionals
      .map((p) => (p.required ? p.name : `[${p.name}]`) + (p.variadic ? " ..." : ""))
      .join(" ");
    const required = spec.flags.filter((f) => f.required);
    const optional = spec.flags.filter((f) => !f.required);
    const section = (title: string, flags: readonly FlagSpec[]): readonly string[] =>
      flags.length === 0 ? [] : ["", title, ...flags.map(flagHelp)];
    return [
      "NAME",
      `    ${name} - ${spec.summary}`,
      "",
      "SYNOPSIS",
      `    ${name} ${positionals} [flags]`.replace(/\s+/g, " ").trimEnd(),
      ...(spec.positionals.length === 0
        ? []
        : [
            "",
            "POSITIONAL ARGUMENTS",
            ...spec.positionals.map((p) => `  ${p.name}\n      ${p.description}`),
          ]),
      ...section("REQUIRED FLAGS", required),
      ...section("OPTIONAL FLAGS", optional),
      ...section(
        ["terraform", "sim", "docker"].includes(spec.path[0] ?? "")
          ? "GENERAL FLAGS"
          : "GCLOUD WIDE FLAGS",
        globalFlags,
      ),
      "",
      "NOTES",
      ...(["terraform", "sim", "docker"].includes(spec.path[0] ?? "")
        ? [
            "    学習用サブセットです。Terraformはdocs/TERRAFORM.md、Dockerはdocs/CONTAINERS.mdを参照。実クラウドやコンテナには接続しません。",
          ]
        : []),
      "    gcloud-sim は本物の一部だけを再現しています。IAM の判定はロールカタログに収録した権限だけで行い、",
      "    収録外の権限は許可として扱います（docs/COMMANDS.md）。",
    ];
  },

  /**
   * 入力途中の行に対する Tab 補完の候補（TBD-009: コマンド名・フラグ名・フラグの値・位置引数）。
   * 値と位置引数の候補は定義が持つ `candidates` を World で評価する。
   *
   * @param registry 登録簿
   * @param request 確定したトークン（ツール名を含む）・打ちかけの最後の語・World
   * @param globalFlags すべてのコマンドが受けるフラグ
   * @returns `partial` で始まる候補（フラグの値なら `--name=値` の形）
   */
  complete(
    registry: CommandRegistry,
    request: CompletionRequest,
    globalFlags: readonly FlagSpec[],
  ): readonly string[] {
    const { tokens, partial, world } = request;
    if (tokens.length === 0) {
      const tools = [...new Set(registry.specs.map((s) => s.path[0] as string))].toSorted();
      return tools.filter((t) => t.startsWith(partial));
    }
    const resolved = CommandRegistry.resolve(registry, tokens);
    if (!Result.isOk(resolved) || resolved.value.spec.kind === "not-implemented") {
      const prefix = tokens.filter((t) => !t.startsWith("-"));
      return childrenOf(registry, prefix).filter((c) => c.startsWith(partial));
    }
    const spec = resolved.value.spec;
    const flags = [...spec.flags, ...globalFlags];
    const projectId = Option.or(flagValueIn(tokens, "project"), World.currentProjectId(world));
    const evaluate = (candidates: Option<CandidateSource>, prefix: string): readonly string[] =>
      Option.isSome(candidates)
        ? candidates
            .value(world, projectId)
            .filter((c) => c.startsWith(prefix))
            .toSorted()
        : [];
    const eq = partial.indexOf("=");
    if (partial.startsWith("-") && eq !== -1) {
      const candidates = Option.flatMap(findFlag(flags, partial.slice(0, eq)), Flag.candidatesOf);
      return evaluate(candidates, partial.slice(eq + 1)).map(
        (c) => `${partial.slice(0, eq + 1)}${c}`,
      );
    }
    if (partial.startsWith("-")) {
      return flags
        .flatMap((f) => [`--${f.name}`, ...f.aliases])
        .filter((f) => f.startsWith(partial))
        .toSorted();
    }
    const previous = resolved.value.rest.at(-1);
    const awaitingValueOf =
      previous?.startsWith("-") && !previous.includes("=")
        ? findFlag(flags, previous)
        : Option.none;
    if (Option.isSome(awaitingValueOf) && awaitingValueOf.value.kind !== "boolean") {
      return evaluate(Flag.candidatesOf(awaitingValueOf.value), partial);
    }
    const index = positionalCount(resolved.value.rest, flags);
    const positional = positionalAt(spec.positionals, index);
    return evaluate(
      Option.flatMap(positional, (p) => p.candidates),
      partial,
    );
  },

  /** 実装済みかどうかに関わらず、登録されているコマンドのパス。docs とテストが数える。 */
  paths(registry: CommandRegistry): readonly (readonly string[])[] {
    return registry.specs.map((s) => s.path);
  },
} as const;
