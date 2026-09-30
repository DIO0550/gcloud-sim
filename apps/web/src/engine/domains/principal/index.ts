import type { IamMember } from "@/engine/domains/iam-policy";
import { Result } from "@/utils/Result";

/**
 * コマンドを実行しているとみなす主体のメール（設計書 4「プリンシパル」）。
 * `@` を含む形を型に出し、素の `string` をそのまま主体として流せないようにする。
 */
export type Principal = `${string}@${string}`;

const ServiceAccountSuffixes = [
  ".iam.gserviceaccount.com",
  "developer.gserviceaccount.com",
] as const;

const isEmail = (value: string): value is Principal => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export const Principal = {
  /**
   * `gcloud auth login` / `config set account` / `--account` に渡された綴りを検証する。
   *
   * @param value メールアドレス
   * @returns `@` を含み空白が無ければ主体。それ以外は `err`
   */
  parse(value: string): Result<Principal, string> {
    return isEmail(value)
      ? Result.ok(value)
      : Result.err(`Invalid account [${value}]. Expected an email address.`);
  },

  /**
   * サービスアカウントのメールか。
   *
   * @param principal メール
   * @returns Google のサービスアカウントのドメインで終われば真
   */
  isServiceAccount(principal: Principal): boolean {
    return ServiceAccountSuffixes.some((suffix) => principal.endsWith(suffix));
  },

  /**
   * IAM バインディングで照合するときのメンバー表現。
   *
   * @param principal メール
   * @returns サービスアカウントなら `serviceAccount:`、それ以外は `user:` を付けた綴り
   */
  toMember(principal: Principal): IamMember {
    return Principal.isServiceAccount(principal)
      ? `serviceAccount:${principal}`
      : `user:${principal}`;
  },
} as const;
