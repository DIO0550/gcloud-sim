import { CommandFailure } from "@/engine/cli/command-failure";
import { type ApiName, Region, Zone } from "@/engine/domains/catalog";
import { type ConfigProperty, GcloudConfig } from "@/engine/domains/gcloud-config";
import type { Principal } from "@/engine/domains/principal";
import type { PolicyTarget, Project } from "@/engine/domains/resource-hierarchy";
import { World } from "@/engine/domains/world";
import type { JsonRecord } from "@/types/Json";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

export type { JsonRecord, JsonValue } from "@/types/Json";

/**
 * Tab 補完の候補を World から引く関数（TBD-009）。`projectId` は `--project` か `core/project`。
 * 候補が World に依らないもの（ゾーン等）は引数を読まない。
 */
export type CandidateSource = (
  world: World,
  projectId: Option<string>,
  positionals?: readonly string[],
) => readonly string[];

type FlagBase = Readonly<{
  /** Reject repetition where only one value is supported. */
  singleUse?: boolean;
  name: string;
  description: string;
  required: boolean;
  /** `-q` のような短縮形。tokenizer ではなく引数解釈で展開する */
  aliases: readonly string[];
}>;

/** フラグの型。`enum` だけが `choices` を持ち、`boolean` だけが `--no-` を受ける。`string` は補完の候補を持てる。 */
export type FlagSpec =
  | (FlagBase & Readonly<{ kind: "string"; candidates: Option<CandidateSource> }>)
  | (FlagBase & Readonly<{ kind: "boolean" }>)
  | (FlagBase & Readonly<{ kind: "enum"; choices: readonly string[] }>)
  | (FlagBase & Readonly<{ kind: "list"; literalRepeat?: boolean }>)
  | (FlagBase & Readonly<{ kind: "keyvalue" }>)
  | (FlagBase & Readonly<{ kind: "integer" }>);

export type PositionalSpec = Readonly<{
  name: string;
  description: string;
  required: boolean;
  variadic: boolean;
  candidates: Option<CandidateSource>;
}>;

export type FlagValue =
  | Readonly<{ kind: "string"; value: string }>
  | Readonly<{ kind: "boolean"; value: boolean }>
  | Readonly<{ kind: "list"; value: readonly string[] }>
  | Readonly<{ kind: "keyvalue"; value: Readonly<Record<string, string>> }>
  | Readonly<{ kind: "integer"; value: number }>;

/** 検証を通った引数。フラグは `--` を落とした名前で引く。 */
export type ParsedArgs = Readonly<{
  positionals: readonly string[];
  flags: Readonly<Record<string, FlagValue>>;
}>;

type FlagOptions = Readonly<{
  singleUse?: boolean;
  required?: boolean;
  aliases?: readonly string[];
  /** `string` だけが持てる補完の候補 */
  candidates?: CandidateSource;
}>;

const base = (name: string, description: string, options: FlagOptions): FlagBase => ({
  name,
  description,
  singleUse: options.singleUse,
  required: options.required ?? false,
  aliases: options.aliases ?? [],
});

export const Flag = {
  string(name: string, description: string, options: FlagOptions = {}): FlagSpec {
    return {
      kind: "string",
      candidates: Option.fromNullable(options.candidates),
      ...base(name, description, options),
    };
  },
  boolean(name: string, description: string, options: FlagOptions = {}): FlagSpec {
    return { kind: "boolean", ...base(name, description, options) };
  },
  enum(
    name: string,
    description: string,
    choices: readonly string[],
    options: FlagOptions = {},
  ): FlagSpec {
    return { kind: "enum", choices, ...base(name, description, options) };
  },
  list(name: string, description: string, options: FlagOptions = {}): FlagSpec {
    return { kind: "list", ...base(name, description, options) };
  },
  literals(name: string, description: string): FlagSpec {
    return { kind: "list", literalRepeat: true, ...base(name, description, {}) };
  },
  keyvalue(name: string, description: string, options: FlagOptions = {}): FlagSpec {
    return { kind: "keyvalue", ...base(name, description, options) };
  },
  integer(name: string, description: string, options: FlagOptions = {}): FlagSpec {
    return { kind: "integer", ...base(name, description, options) };
  },

  /**
   * Tab 補完に出す値の候補。`enum` は選択肢そのもの、`string` は定義に付けた候補。
   *
   * @param flag フラグの定義
   * @returns 候補の出どころ。語彙が閉じていないフラグは `none`
   */
  candidatesOf(flag: FlagSpec): Option<CandidateSource> {
    switch (flag.kind) {
      case "enum":
        return Option.some(() => flag.choices);
      case "string":
        return flag.candidates;
      case "boolean":
      case "list":
      case "keyvalue":
      case "integer":
        return Option.none;
    }
  },
} as const;

export const Positional = {
  required(name: string, description: string, candidates?: CandidateSource): PositionalSpec {
    return {
      name,
      description,
      required: true,
      variadic: false,
      candidates: Option.fromNullable(candidates),
    };
  },
  optional(name: string, description: string, candidates?: CandidateSource): PositionalSpec {
    return {
      name,
      description,
      required: false,
      variadic: false,
      candidates: Option.fromNullable(candidates),
    };
  },
  variadic(name: string, description: string, candidates?: CandidateSource): PositionalSpec {
    return {
      name,
      description,
      required: true,
      variadic: true,
      candidates: Option.fromNullable(candidates),
    };
  },
} as const;

export const ParsedArgs = {
  string(args: ParsedArgs, name: string): Option<string> {
    const flag = args.flags[name];
    return flag?.kind === "string" ? Option.some(flag.value) : Option.none;
  },

  /** 無指定は `false`。`--no-x` も `false`。 */
  boolean(args: ParsedArgs, name: string): boolean {
    const flag = args.flags[name];
    return flag?.kind === "boolean" ? flag.value : false;
  },

  /** `--x` / `--no-x` のどちらが打たれたか。どちらも無ければ `none`。 */
  booleanChoice(args: ParsedArgs, name: string): Option<boolean> {
    const flag = args.flags[name];
    return flag?.kind === "boolean" ? Option.some(flag.value) : Option.none;
  },

  list(args: ParsedArgs, name: string): readonly string[] {
    const flag = args.flags[name];
    return flag?.kind === "list" ? flag.value : [];
  },

  keyvalue(args: ParsedArgs, name: string): Readonly<Record<string, string>> {
    const flag = args.flags[name];
    return flag?.kind === "keyvalue" ? flag.value : {};
  },

  integer(args: ParsedArgs, name: string): Option<number> {
    const flag = args.flags[name];
    return flag?.kind === "integer" ? Option.some(flag.value) : Option.none;
  },

  positional(args: ParsedArgs, index: number): Option<string> {
    return Option.fromNullable(args.positionals[index]);
  },

  /**
   * `Positional.required` で宣言した位置引数。ArgParser が存在を検証した後の値なので `string` で返す。
   * 宣言していない index を渡すのはプログラミングエラーで、そのときは空文字（ドメインの `parse` が
   * 形式不正として弾く）。
   *
   * @param args 検証済みの引数
   * @param index 位置引数の番号
   * @returns その位置の値
   */
  requiredPositional(args: ParsedArgs, index: number): string {
    return args.positionals[index] ?? "";
  },

  /**
   * `{ required: true }` で宣言した文字列フラグ。ArgParser が存在を検証した後の値なので `string` で返す。
   * 宣言と違う名前を渡すのはプログラミングエラーで、そのときは空文字（`requiredPositional` と同じ扱い）。
   *
   * @param args 検証済みの引数
   * @param name フラグ名
   * @returns その値
   */
  requiredString(args: ParsedArgs, name: string): string {
    return Option.unwrapOr(ParsedArgs.string(args, name), "");
  },

  has(args: ParsedArgs, name: string): boolean {
    return name in args.flags;
  },
} as const;

/** 出力行の調子。UI が色に対応させる。 */
export type MessageTone = "plain" | "success" | "warning" | "hint" | "muted";

export type OutputMessage = Readonly<{ text: string; tone: MessageTone }>;

export const OutputMessage = {
  plain: (text: string): OutputMessage => ({ text, tone: "plain" }),
  success: (text: string): OutputMessage => ({ text, tone: "success" }),
  warning: (text: string): OutputMessage => ({ text, tone: "warning" }),
  hint: (text: string): OutputMessage => ({ text, tone: "hint" }),
  muted: (text: string): OutputMessage => ({ text, tone: "muted" }),
} as const;

/**
 * 既定の table の 1 列。`path` はレコードのドット区切りパス、`transform` は表示前の加工
 * （`basename`: URL の末尾、`join`: 配列を `,` で結ぶ、`flag`: 真なら `true`・偽なら空欄）。
 */
export type Column = Readonly<{
  header: string;
  path: string;
  transform: "none" | "basename" | "join" | "flag";
}>;

export const Column = {
  create(header: string, path: string, transform: Column["transform"] = "none"): Column {
    return { header, path, transform };
  },
} as const;

/**
 * コマンドが返す結果（設計書 DJ-009: 文字列ではなく結果オブジェクトを返し、Formatter が整形する）。
 * `defaultFormat` が `none` のレコードは `--format` を付けたときだけ出す。
 */
export type CommandOutput = Readonly<{
  messages: readonly OutputMessage[];
  records: readonly JsonRecord[];
  columns: readonly Column[];
  defaultFormat: "table" | "yaml" | "json" | "none";
  trailing: readonly OutputMessage[];
}>;

export const CommandOutput = {
  messages(...messages: readonly OutputMessage[]): CommandOutput {
    return { messages, records: [], columns: [], defaultFormat: "none", trailing: [] };
  },

  table(
    records: readonly JsonRecord[],
    columns: readonly Column[],
    messages: readonly OutputMessage[] = [],
  ): CommandOutput {
    return { messages, records, columns, defaultFormat: "table", trailing: [] };
  },

  yaml(record: JsonRecord, messages: readonly OutputMessage[] = []): CommandOutput {
    return { messages, records: [record], columns: [], defaultFormat: "yaml", trailing: [] };
  },

  /** 複数レコードを `---` 区切りの YAML で出す（`gcloud storage buckets list` の既定）。 */
  yamlList(records: readonly JsonRecord[]): CommandOutput {
    return { messages: [], records, columns: [], defaultFormat: "yaml", trailing: [] };
  },

  withTrailing(output: CommandOutput, ...trailing: readonly OutputMessage[]): CommandOutput {
    return { ...output, trailing: [...output.trailing, ...trailing] };
  },
} as const;

export type CommandOutcome = Readonly<{
  /** Failure with retained diagnostic state (e.g. a failed job execution). */
  failure?: CommandFailure;
  world: World;
  output: CommandOutput;
}>;
export type CommandResult = Result<CommandOutcome, CommandFailure>;

/**
 * 実行時の文脈。`projectId` は `--project` か `core/project`。
 * 主体は持たない。`plain` のコマンド（`auth login` / `config set account`）はアカウント未選択でも
 * 動くので、主体が要るのは権限を検証した文脈（`AuthorizedContext`）だけ。
 */
export type CommandContext = Readonly<{
  world: World;
  now: string;
  projectId: Option<string>;
  /** `--project` で明示されたか（`core/project` からの解決と区別したいコマンドが読む） */
  projectFlag: Option<string>;
}>;

/** 権限の検証を通った文脈。`principal` は `--account` か `core/account`。 */
export type AuthorizedContext = CommandContext & Readonly<{ principal: Principal }>;

/** プロジェクトの解決と API・権限の検証を通った文脈。`kind: "project"` の `run` だけが受け取る。 */
export type ProjectContext = AuthorizedContext & Readonly<{ project: Project }>;

/** ポリシー対象の解決と権限の検証を通った文脈。`kind: "target"` の `run` だけが受け取る。 */
export type TargetContext = AuthorizedContext & Readonly<{ target: PolicyTarget }>;

/** `--region` の既定を読むプロパティ。Compute / Cloud Run / Functions で別のセクションを見る。 */
export type RegionProperty = Extract<
  ConfigProperty,
  "compute/region" | "run/region" | "functions/region"
>;

/** `kind: "target"` のコマンドが引数からポリシー対象を決める関数。 */
export type TargetResolver = (
  ctx: CommandContext,
  args: ParsedArgs,
) => Result<PolicyTarget, CommandFailure>;

type SpecBase = Readonly<{
  path: readonly string[];
  summary: string;
  positionals: readonly PositionalSpec[];
  flags: readonly FlagSpec[];
  /** delete 等。`--quiet` が無ければ確認プロンプトを挟む（UC-001 代替フロー） */
  destructive: boolean;
  /** Commands such as Terraform preview their changes and require an explicit yes. */
  confirmation?: Readonly<{
    preview: (ctx: CommandContext, args: ParsedArgs) => CommandResult;
    skip: (args: ParsedArgs) => boolean;
  }>;
}>;

/**
 * コマンド定義（設計書 6.2 CommandSpec）。認可の形で直和にする。
 * - `project`: 現在のプロジェクトで API と権限を検証してから `run`
 * - `target`: 引数からポリシー対象を解決して権限を検証してから `run`
 * - `plain`: 検証なし（config / auth など）
 * - `not-implemented`: 解決はできるが E-002 を返す（DJ-005）
 */
export type CommandSpec =
  | (SpecBase &
      Readonly<{
        kind: "project";
        requiredPermissions: readonly string[];
        requiredApis: readonly ApiName[];
        run: (ctx: ProjectContext, args: ParsedArgs) => CommandResult;
      }>)
  | (SpecBase &
      Readonly<{
        kind: "target";
        requiredPermissions: readonly string[];
        resolveTarget: TargetResolver;
        run: (ctx: TargetContext, args: ParsedArgs) => CommandResult;
      }>)
  | (SpecBase &
      Readonly<{ kind: "plain"; run: (ctx: CommandContext, args: ParsedArgs) => CommandResult }>)
  | Readonly<{ kind: "not-implemented"; path: readonly string[]; summary: string }>;

export const CommandSpec = {
  /** `gcloud.compute.instances.create` のような、エラー接頭辞に出す綴り。 */
  dottedPath(spec: CommandSpec): string {
    return spec.path.join(".");
  },
} as const;

export const CommandContext = {
  /**
   * 対象プロジェクトを引く。`--project` / `core/project` が無ければ E-004、無い ID や
   * 削除要求済みなら E-005。
   *
   * @param ctx 文脈
   * @returns 操作できるプロジェクト
   */
  requireProject(ctx: CommandContext): Result<Project, CommandFailure> {
    if (!Option.isSome(ctx.projectId)) return Result.err(CommandFailure.projectRequired());
    const project = World.findActiveProject(ctx.world, ctx.projectId.value);
    return Option.isSome(project)
      ? Result.ok(project.value)
      : Result.err(CommandFailure.notFound(`projects/${ctx.projectId.value}`));
  },

  /**
   * ゾーンを決める（UC-003: フラグ → `compute/zone` → 無ければ E-004）。
   *
   * @param ctx 文脈
   * @param flag `--zone` の値
   * @returns 決まったゾーン。カタログに無ければ E-005
   */
  resolveZone(ctx: CommandContext, flag: Option<string>): Result<Zone, CommandFailure> {
    const configured = GcloudConfig.get(ctx.world.config, "compute/zone");
    const chosen = Option.or(flag, configured);
    if (!Option.isSome(chosen)) return Result.err(CommandFailure.zoneRequired());
    return Option.toResult(Zone.parse(chosen.value), () =>
      CommandFailure.notFound(
        `projects/${Option.unwrapOr(ctx.projectId, "-")}/zones/${chosen.value}`,
      ),
    );
  },

  /**
   * リージョンを決める（フラグ → 設定のプロパティ → 無ければ E-004）。
   *
   * @param ctx 文脈
   * @param flag `--region` の値
   * @param property フラグが無いときに読むプロパティ（`compute/region` / `run/region` / `functions/region`）
   * @returns 決まったリージョン。カタログに無ければ E-005
   */
  resolveRegion(
    ctx: CommandContext,
    flag: Option<string>,
    property: RegionProperty = "compute/region",
  ): Result<Region, CommandFailure> {
    const configured = GcloudConfig.get(ctx.world.config, property);
    const chosen = Option.or(flag, configured);
    if (!Option.isSome(chosen)) return Result.err(CommandFailure.regionRequired(property));
    return Option.toResult(Region.parse(chosen.value), () =>
      CommandFailure.notFound(
        `projects/${Option.unwrapOr(ctx.projectId, "-")}/regions/${chosen.value}`,
      ),
    );
  },
} as const;
