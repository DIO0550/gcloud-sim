import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

/**
 * 型の分からない値（`JSON.parse` の結果）を、形を確かめながら型の付いた値にする。
 * `path` は失敗の理由に出す位置（`world.projects[2].projectId`）。
 */
export type Decoder<T> = (value: unknown, path: string) => Result<T, string>;

/** オブジェクトの各キーに対応する decoder。 */
export type FieldDecoders<T> = Readonly<{ [K in keyof T]-?: Decoder<T[K]> }>;

const typeName = (value: unknown): string =>
  value === null ? "null" : Array.isArray(value) ? "array" : typeof value;

const expected = (path: string, what: string, value: unknown): string =>
  `${path} must be ${what} (got ${typeName(value)})`;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const Decoder = {
  string: ((value, path) =>
    typeof value === "string"
      ? Result.ok(value)
      : Result.err(expected(path, "a string", value))) as Decoder<string>,

  number: ((value, path) =>
    typeof value === "number" && Number.isFinite(value)
      ? Result.ok(value)
      : Result.err(expected(path, "a finite number", value))) as Decoder<number>,

  boolean: ((value, path) =>
    typeof value === "boolean"
      ? Result.ok(value)
      : Result.err(expected(path, "a boolean", value))) as Decoder<boolean>,

  /**
   * 決まった綴りのどれか。
   *
   * @param values 許す綴り
   * @returns その綴りに閉じた decoder
   */
  literal<T extends string | number | boolean>(values: readonly T[]): Decoder<T> {
    return (value, path) => {
      const found = values.find((v) => v === value);
      return found !== undefined
        ? Result.ok(found)
        : Result.err(`${path} must be one of ${values.map(String).join(", ")}`);
    };
  },

  /**
   * ドメインの `parse` を decoder にする。
   *
   * @param parse 綴りを閉じた型にする関数（`Zone.parse` 等）
   * @param what 失敗の理由に出す名前
   * @returns 文字列を受けて `parse` に通す decoder
   */
  parsed<T>(parse: (value: string) => Option<T>, what: string): Decoder<T> {
    return (value, path) =>
      Result.flatMap(Decoder.string(value, path), (text) =>
        Option.toResult(parse(text), () => `${path} is not a known ${what}: ${text}`),
      );
  },

  /**
   * `Result` を返すドメインの `parse` を decoder にする。
   *
   * @param parse 綴りを検証する関数（`Principal.parse` 等）
   * @returns 文字列を受けて `parse` に通す decoder
   */
  validated<T>(parse: (value: string) => Result<T, string>): Decoder<T> {
    return (value, path) =>
      Result.flatMap(Decoder.string(value, path), (text) =>
        Result.mapErr(parse(text), (reason) => `${path}: ${reason}`),
      );
  },

  array<T>(item: Decoder<T>): Decoder<readonly T[]> {
    return (value, path) => {
      if (!Array.isArray(value)) return Result.err(expected(path, "an array", value));
      return Result.all(value.map((element, index) => item(element, `${path}[${index}]`)));
    };
  },

  /**
   * 決まったキーを持つオブジェクト。宣言していないキーは捨てる（持ち込まない）。
   *
   * @param fields キーごとの decoder
   * @returns 宣言したキーだけを持つ新しいオブジェクトを返す decoder
   */
  object<T extends object>(fields: FieldDecoders<T>): Decoder<T> {
    return (value, path) => {
      if (!isRecord(value)) return Result.err(expected(path, "an object", value));
      const entries = Object.entries(fields) as readonly [string, Decoder<unknown>][];
      const decoded = Result.all(
        entries.map(([key, decoder]) =>
          Result.map(decoder(value[key], `${path}.${key}`), (v) => [key, v] as const),
        ),
      );
      return Result.map(decoded, (pairs) => Object.fromEntries(pairs) as T);
    };
  },

  /**
   * 文字列キーの辞書。`__proto__` のようなキーは受け付けない。
   *
   * @param item 値の decoder
   * @returns 辞書を返す decoder
   */
  record<T>(item: Decoder<T>): Decoder<Readonly<Record<string, T>>> {
    return (value, path) => {
      if (!isRecord(value)) return Result.err(expected(path, "an object", value));
      const forbidden = Object.keys(value).find((key) =>
        ["__proto__", "constructor", "prototype"].includes(key),
      );
      if (forbidden !== undefined) return Result.err(`${path} has a forbidden key: ${forbidden}`);
      const decoded = Result.all(
        Object.entries(value).map(([key, v]) =>
          Result.map(item(v, `${path}.${key}`), (d) => [key, d] as const),
        ),
      );
      return Result.map(decoded, (pairs) => Object.fromEntries(pairs));
    };
  },

  /**
   * `Option` を書き出した形（`{some: true, value}` / `{some: false}`）。
   *
   * @param item 値の decoder
   * @returns `Option` を返す decoder
   */
  option<T extends NonNullable<unknown>>(item: Decoder<T>): Decoder<Option<T>> {
    return (value, path) => {
      if (!isRecord(value) || typeof value.some !== "boolean")
        return Result.err(expected(path, "an option ({some: boolean})", value));
      if (!value.some) return Result.ok(Option.none);
      return Result.map(item(value.value, `${path}.value`), (v): Option<T> => Option.some(v));
    };
  },

  /**
   * decode した値をさらに検証・変換する。
   *
   * @param decoder 元
   * @param fn 変換。失敗の理由は位置を付けて返す
   * @returns 変換後の値を返す decoder
   */
  map<T, U>(decoder: Decoder<T>, fn: (value: T) => Result<U, string>): Decoder<U> {
    return (value, path) =>
      Result.flatMap(decoder(value, path), (v) => Result.mapErr(fn(v), (r) => `${path}: ${r}`));
  },
} as const;
