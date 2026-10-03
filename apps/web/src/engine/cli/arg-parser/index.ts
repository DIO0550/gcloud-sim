import { CommandFailure } from "@/engine/cli/command-failure";
import type { FlagSpec, FlagValue, ParsedArgs, PositionalSpec } from "@/engine/cli/command-spec";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

type Scan = Readonly<{
  positionals: readonly string[];
  flags: Readonly<Record<string, FlagValue>>;
  unrecognized: readonly string[];
  onlyPositionals: boolean;
}>;

const findSpec = (specs: readonly FlagSpec[], token: string): Option<FlagSpec> =>
  Option.fromNullable(
    specs.find((spec) => `--${spec.name}` === token || spec.aliases.includes(token)),
  );

const convert = (spec: FlagSpec, raw: string): Result<FlagValue, CommandFailure> => {
  const flag = `--${spec.name}`;
  switch (spec.kind) {
    case "string":
      return Result.ok({ kind: "string", value: raw });
    case "boolean": {
      const lowered = raw.toLowerCase();
      if (lowered === "true" || lowered === "false") {
        return Result.ok({ kind: "boolean", value: lowered === "true" });
      }
      return Result.err(CommandFailure.invalidChoice(flag, raw, ["true", "false"]));
    }
    case "enum":
      return spec.choices.includes(raw)
        ? Result.ok({ kind: "string", value: raw })
        : Result.err(CommandFailure.invalidChoice(flag, raw, spec.choices));
    case "list":
      return Result.ok({
        kind: "list",
        value: raw === "" ? [] : raw.split(",").map((v) => v.trim()),
      });
    case "keyvalue": {
      const pairs = raw === "" ? [] : raw.split(",");
      const entries: [string, string][] = [];
      for (const pair of pairs) {
        const eq = pair.indexOf("=");
        if (eq <= 0) {
          return Result.err(
            CommandFailure.invalidValue(flag, `Bad syntax for dict arg: [${pair}]`),
          );
        }
        entries.push([pair.slice(0, eq), pair.slice(eq + 1)]);
      }
      return Result.ok({ kind: "keyvalue", value: Object.fromEntries(entries) });
    }
    case "integer": {
      const number = Number(raw);
      return /^-?\d+$/.test(raw)
        ? Result.ok({ kind: "integer", value: number })
        : Result.err(CommandFailure.invalidValue(flag, `Value [${raw}] must be an integer.`));
    }
  }
};

const withFlag = (scan: Scan, spec: FlagSpec, value: FlagValue): Scan => ({
  ...scan,
  flags: { ...scan.flags, [spec.name]: value },
});

type Step = Readonly<{ scan: Scan; consumed: number }>;

const stepFlag = (
  scan: Scan,
  specs: readonly FlagSpec[],
  token: string,
  next: string | undefined,
): Result<Step, CommandFailure> => {
  const eq = token.indexOf("=");
  const name = eq === -1 ? token : token.slice(0, eq);
  const inline = eq === -1 ? undefined : token.slice(eq + 1);

  if (name.startsWith("--no-")) {
    const negated = Option.filter(
      findSpec(specs, `--${name.slice("--no-".length)}`),
      (spec) => spec.kind === "boolean",
    );
    if (Option.isSome(negated)) {
      return Result.ok({
        scan: withFlag(scan, negated.value, { kind: "boolean", value: false }),
        consumed: 1,
      });
    }
  }

  const found = findSpec(specs, name);
  if (!Option.isSome(found)) {
    return Result.ok({
      scan: { ...scan, unrecognized: [...scan.unrecognized, name] },
      consumed: 1,
    });
  }
  const spec = found.value;
  if (spec.singleUse && Object.hasOwn(scan.flags, spec.name))
    return Result.err(
      CommandFailure.invalidValue(
        `--${spec.name}`,
        "This flag may only be specified once in the simulator.",
      ),
    );
  if (spec.kind === "boolean") {
    const converted =
      inline === undefined
        ? Result.ok<FlagValue>({ kind: "boolean", value: true })
        : convert(spec, inline);
    return Result.map(converted, (value) => ({ scan: withFlag(scan, spec, value), consumed: 1 }));
  }
  const raw = inline ?? next;
  const missingValue = raw === undefined || (inline === undefined && raw.startsWith("--"));
  if (missingValue) return Result.err(CommandFailure.expectedOneArgument(`--${spec.name}`));
  return Result.map(convert(spec, raw), (value) => ({
    scan: withFlag(scan, spec, value),
    consumed: inline === undefined ? 2 : 1,
  }));
};

const scanTokens = (
  tokens: readonly string[],
  specs: readonly FlagSpec[],
): Result<Scan, CommandFailure> => {
  let scan: Scan = { positionals: [], flags: {}, unrecognized: [], onlyPositionals: false };
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index] as string;
    const isFlag = !scan.onlyPositionals && token.startsWith("-") && token.length > 1;
    if (token === "--" && !scan.onlyPositionals) {
      scan = { ...scan, onlyPositionals: true };
      index += 1;
    } else if (isFlag) {
      const stepped = stepFlag(scan, specs, token, tokens[index + 1]);
      if (!Result.isOk(stepped)) return stepped;
      scan = stepped.value.scan;
      index += stepped.value.consumed;
    } else {
      scan = { ...scan, positionals: [...scan.positionals, token] };
      index += 1;
    }
  }
  return Result.ok(scan);
};

const checkPositionals = (
  scan: Scan,
  positionals: readonly PositionalSpec[],
): Result<Scan, CommandFailure> => {
  const missing = positionals.find((spec, i) => spec.required && scan.positionals[i] === undefined);
  if (missing !== undefined) return Result.err(CommandFailure.mustBeSpecified(missing.name));
  const lastIsVariadic = positionals.at(-1)?.variadic === true;
  const extra = lastIsVariadic ? [] : scan.positionals.slice(positionals.length);
  if (extra.length > 0) return Result.err(CommandFailure.unrecognizedArguments(extra));
  return Result.ok(scan);
};

const checkRequiredFlags = (
  scan: Scan,
  specs: readonly FlagSpec[],
): Result<Scan, CommandFailure> => {
  const missing = specs.find((spec) => spec.required && !(spec.name in scan.flags));
  return missing === undefined
    ? Result.ok(scan)
    : Result.err(CommandFailure.mustBeSpecified(`--${missing.name}`));
};

export const ArgParser = {
  /**
   * コマンドパスの後ろのトークンを、フラグ定義と位置引数定義に照らして解釈する（設計書 9.2）。
   * `--k=v` と `--k v` は同じ、`--no-k` は boolean を false にする。
   *
   * @param tokens コマンドパスを除いたトークン
   * @param flags 受け付けるフラグ（グローバルフラグを含めて渡す）
   * @param positionals 受け付ける位置引数
   * @returns 検証済みの引数。未知フラグ・型不正・choices 外は E-003、必須欠落は E-004
   */
  parse(
    tokens: readonly string[],
    flags: readonly FlagSpec[],
    positionals: readonly PositionalSpec[],
  ): Result<ParsedArgs, CommandFailure> {
    const scanned = scanTokens(tokens, flags);
    if (!Result.isOk(scanned)) return scanned;
    if (scanned.value.unrecognized.length > 0) {
      return Result.err(CommandFailure.unrecognizedArguments(scanned.value.unrecognized));
    }
    const checked = Result.flatMap(checkPositionals(scanned.value, positionals), (scan) =>
      checkRequiredFlags(scan, flags),
    );
    return Result.map(checked, (scan) => ({ positionals: scan.positionals, flags: scan.flags }));
  },

  /**
   * `--help` / `-h` が含まれているか。ヘルプは他の検証より先に見るので、解釈前に確かめる。
   *
   * @param tokens コマンドパスを除いたトークン
   * @returns 含まれていれば真
   */
  asksHelp(tokens: readonly string[]): boolean {
    return tokens.some((t) => t === "--help" || t === "-h");
  },
} as const;
