/** 値がある状態。 */
export type Some<T> = Readonly<{
  some: true;
  value: T;
}>;

/** 値が無い状態。 */
export type None = Readonly<{
  some: false;
}>;

/**
 * 値が無いことがありうる処理の戻り値。`undefined` / `null` の代わりにこれを返す。
 * `Option.isSome` で分岐すると、ある場合だけ `value` が読める。
 */
export type Option<T> = Some<T> | None;

/** 不在は状態を持たないので、生成せず 1 つを共有する。 */
const none: None = Object.freeze({ some: false as const });

/** `Option` の生成と連鎖。 */
export const Option = {
  none,

  /**
   * 値を持つ `Option` を作る。
   *
   * @param value 持たせる値。`null` / `undefined` は型で受けない（不在は `none` で表す）
   * @returns `value` を持つ `some`。凍結してあるので後から書き換えられない
   */
  some<T>(value: NonNullable<T>): Some<NonNullable<T>> {
    return Object.freeze({ some: true as const, value });
  },

  /**
   * `null` / `undefined` を不在とみなして `Option` にする。
   *
   * @param value 不在を `null` / `undefined` で表している値
   * @returns `null` / `undefined` なら `none`。それ以外（`0`・空文字・`false` を含む）は `some`
   */
  fromNullable<T>(value: T | null | undefined): Option<NonNullable<T>> {
    return value != null ? Option.some(value) : none;
  },

  /**
   * 値があれば変換する。
   *
   * @param option 変換元
   * @param fn 値があるときだけ呼ぶ変換
   * @returns `fn` の戻り値の `some`。`option` が `none` のときと、`fn` が `null` / `undefined`
   *   を返したときは `none`
   */
  map<T, U>(option: Option<T>, fn: (value: T) => U): Option<NonNullable<U>> {
    return option.some ? Option.fromNullable(fn(option.value)) : none;
  },

  /**
   * 値があれば、不在になりうる次の処理へ渡す。
   *
   * @param option 渡す元
   * @param fn 値があるときだけ呼ぶ次の処理
   * @returns `option` が `none` なら `none`。値があれば `fn` の戻り値そのもの
   */
  flatMap<T, U>(option: Option<T>, fn: (value: T) => Option<U>): Option<U> {
    return option.some ? fn(option.value) : none;
  },

  /**
   * 値があればそれ、無ければ代わりの値。
   *
   * @param option 先に見るほう
   * @param defaultValue `option` が `none` のときに返す値
   * @returns `option` の値。`none` なら `defaultValue`
   */
  unwrapOr<T>(option: Option<T>, defaultValue: T): T {
    return option.some ? option.value : defaultValue;
  },

  /**
   * 値があればそれ、無ければ代わりの `Option`。
   *
   * @param option 先に見るほう
   * @param fallback `option` が `none` のときに答えるほう
   * @returns `option` が値を持てばそれ。持たなければ `fallback` をそのまま返す
   */
  or<T>(option: Option<T>, fallback: Option<T>): Option<T> {
    return option.some ? option : fallback;
  },

  /**
   * 値を持っているか。
   * 在／不在の判定はすべてここを通す。判別子（`some`）を直接読むのはこのファイルの中だけ。
   *
   * @param option 中身を見る `Option`
   * @returns 値を持っていれば `true`。`none` なら `false`
   */
  isSome<T>(option: Option<T>): option is Some<T> {
    return option.some;
  },

  /**
   * Some の値を取り出す。None の場合は例外を投げる。
   * 失敗をそのままテストの失敗にしたいテストコードだけが使う。
   *
   * @param option 値を持っているはずの `Option`
   * @returns `option` の値
   * @throws `option` が `none` のとき
   */
  unwrap<T>(option: Option<T>): T {
    if (!option.some) {
      throw new Error("cannot unwrap a None option");
    }
    return option.value;
  },
} as const;
