import type { JsonRecord } from "@/types/Json";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

/** サービスアカウントの鍵（`keys create`）。秘密鍵の中身は持たず、書き出したファイル名で指す。 */
export type ServiceAccountKey = Readonly<{
  serviceAccountEmail: string;
  keyId: string;
  /** `keys create OUTPUT-FILE` の OUTPUT-FILE。`auth activate-service-account --key-file` で引く */
  file: string;
  keyType: "USER_MANAGED";
  validAfterTime: string;
}>;

export const ServiceAccountKey = {
  /**
   * 鍵を作る。id は通し番号から採番する。
   *
   * @param seed 対象・書き出し先・時刻・通し番号
   * @returns ユーザー管理の鍵
   */
  create(
    seed: Readonly<{
      serviceAccountEmail: string;
      file: string;
      validAfterTime: string;
      sequence: number;
    }>,
  ): ServiceAccountKey {
    const id = (0x9a3e5c1d + seed.sequence * 0x1f3d).toString(16).padStart(40, "0");
    return {
      serviceAccountEmail: seed.serviceAccountEmail,
      keyId: id,
      file: seed.file,
      keyType: "USER_MANAGED",
      validAfterTime: seed.validAfterTime,
    };
  },

  toRecord(key: ServiceAccountKey): JsonRecord {
    return {
      name: `projects/-/serviceAccounts/${key.serviceAccountEmail}/keys/${key.keyId}`,
      keyType: key.keyType,
      keyAlgorithm: "KEY_ALG_RSA_2048",
      validAfterTime: key.validAfterTime,
      validBeforeTime: "9999-12-31T23:59:59Z",
    };
  },
} as const;

/** OS Login プロファイルに登録した SSH 公開鍵。主体ごとに持つ。 */
export type OsLoginSshKey = Readonly<{
  account: string;
  key: string;
  fingerprint: string;
  expireTime: Option<string>;
}>;

export const OsLoginSshKey = {
  /**
   * 公開鍵を登録する。`ssh-ed25519 AAAA...` / `ssh-rsa AAAA...` の形だけを受ける。
   *
   * @param seed 主体と鍵と期限
   * @returns 指紋を付けた鍵。形が悪ければ理由
   */
  create(
    seed: Readonly<{ account: string; key: string; expireTime: Option<string> }>,
  ): Result<OsLoginSshKey, string> {
    const valid = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256) [A-Za-z0-9+/=]{16,}( .*)?$/.test(
      seed.key.trim(),
    );
    if (!valid) {
      return Result.err(
        `Invalid value for [--key]: ${seed.key}. Expected an OpenSSH public key such as "ssh-ed25519 AAAA...".`,
      );
    }
    const digest = [...seed.key].reduce((acc, ch) => (acc * 33 + ch.charCodeAt(0)) >>> 0, 5381);
    return Result.ok({
      account: seed.account,
      key: seed.key.trim(),
      fingerprint: digest.toString(16).padStart(32, "0"),
      expireTime: seed.expireTime,
    });
  },

  toRecord(key: OsLoginSshKey): JsonRecord {
    return {
      key: key.key,
      fingerprint: key.fingerprint,
      expirationTimeUsec: Option.unwrapOr(
        Option.map(key.expireTime, (t) => String(Date.parse(t) * 1000)),
        undefined,
      ),
    };
  },
} as const;
