/** JSON として表せる値。コマンドの出力レコードと Snapshot の解釈で使う。 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly JsonValue[]
  | Readonly<{ [key: string]: JsonValue }>;

/** JSON のオブジェクト。`--format=json` に出す API 表現の形。 */
export type JsonRecord = Readonly<Record<string, JsonValue>>;
