import { Result } from "@/utils/Result";

/** JSON を読む。`JSON.parse` の例外はここで `Result` にする（例外に触るのは `libs/` だけ）。 */
export const parseJson = (text: string): Result<unknown, string> => {
  try {
    return Result.ok(JSON.parse(text));
  } catch (error) {
    return Result.err(describeError(error));
  }
};

/** ブラウザ API が投げたものを人が読める 1 行にする。 */
export const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
