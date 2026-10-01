import type { ImportFailure } from "@/engine/snapshot";

/** E-011 のダイアログと起動時の注意に出す文言。綴りは画面の関心事なのでエンジンには置かない。 */
export const describeImportFailure = (failure: ImportFailure): string => {
  switch (failure.kind) {
    case "malformed":
      return `JSON の形が不正です（${failure.reason}）。現在の状態は変更していません。`;
    case "unsupportedVersion":
      return `schemaVersion ${failure.version} は未対応です。現在の状態は変更していません。`;
    case "invariant":
      return `不変条件に違反しています（${failure.reason}）。現在の状態は変更していません。`;
  }
};
