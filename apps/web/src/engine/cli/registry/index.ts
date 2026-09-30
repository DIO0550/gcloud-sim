import { CommandFailure } from "@/engine/cli/command-failure";
import type { CommandSpec, FlagSpec } from "@/engine/cli/command-spec";
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

const flagHelp = (flag: FlagSpec): string => {
  const value =
    flag.kind === "boolean"
      ? ""
      : flag.kind === "enum"
        ? `=${flag.choices.join("|")}`
        : `=${flag.name.toUpperCase().replace(/-/g, "_")}`;
  const required = flag.required ? " (required)" : "";
  return `  --${flag.name}${value}${required}\n      ${flag.description}`;
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
      ...section("GCLOUD WIDE FLAGS", globalFlags),
      "",
      "NOTES",
      "    gcloud-sim は本物の一部だけを再現しています。IAM の判定はロールカタログに収録した権限だけで行い、",
      "    収録外の権限は許可として扱います（docs/COMMANDS.md）。",
    ];
  },

  /**
   * 入力途中の行に対する Tab 補完の候補（TBD-009: コマンド名とフラグ名まで）。
   *
   * @param registry 登録簿
   * @param tokens 確定したトークン（ツール名を含む）
   * @param partial 打ちかけの最後の語
   * @param globalFlags すべてのコマンドが受けるフラグ
   * @returns `partial` で始まる候補
   */
  complete(
    registry: CommandRegistry,
    tokens: readonly string[],
    partial: string,
    globalFlags: readonly FlagSpec[],
  ): readonly string[] {
    if (tokens.length === 0) {
      const tools = [...new Set(registry.specs.map((s) => s.path[0] as string))].toSorted();
      return tools.filter((t) => t.startsWith(partial));
    }
    const resolved = CommandRegistry.resolve(registry, tokens);
    if (Result.isOk(resolved) && partial.startsWith("-")) {
      const spec = resolved.value.spec;
      const own = spec.kind === "not-implemented" ? [] : spec.flags;
      return [...own, ...globalFlags]
        .map((f) => `--${f.name}`)
        .filter((f) => f.startsWith(partial))
        .toSorted();
    }
    const prefix = tokens.filter((t) => !t.startsWith("-"));
    return childrenOf(registry, prefix).filter((c) => c.startsWith(partial));
  },

  /** 実装済みかどうかに関わらず、登録されているコマンドのパス。docs とテストが数える。 */
  paths(registry: CommandRegistry): readonly (readonly string[])[] {
    return registry.specs.map((s) => s.path);
  },
} as const;
