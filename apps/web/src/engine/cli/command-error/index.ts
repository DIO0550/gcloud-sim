import type { MissingPermission } from "@/engine/domains/effective-permissions";
import { PolicyTarget } from "@/engine/domains/resource-hierarchy";
import type { ValueOf } from "@/types/ValueOf";

/**
 * コマンド実行が返しうる失敗の語彙（設計書 10）。
 * E-010（保存）・E-011（import）・E-015（ミッション setup）はコマンドの失敗ではないので、
 * それぞれ `libs/world-storage` / `engine/snapshot` / `engine/missions` が自分の型で持つ。
 */
export const ErrorCodes = {
  UnknownCommand: "E-001",
  NotImplemented: "E-002",
  InvalidFlag: "E-003",
  MissingArgument: "E-004",
  NotFound: "E-005",
  PermissionDenied: "E-006",
  ApiDisabled: "E-007",
  AlreadyExists: "E-008",
  InvalidIamArgument: "E-009",
  LastOwner: "E-012",
  UnsupportedOperation: "E-013",
  InvalidState: "E-014",
  BillingRequired: "E-016",
} as const;
export type ErrorCode = ValueOf<typeof ErrorCodes>;

/**
 * コマンド実行の失敗。`message` は本物準拠の本文、`hints` は `gcloud-sim:` 接頭辞で出す補足。
 * `ERROR: (gcloud.x.y)` の接頭辞はコマンドパスを知っている shell が付ける。
 */
export type CommandFailure = Readonly<{
  code: ErrorCode;
  message: string;
  hints: readonly string[];
}>;

const failure = (
  code: ErrorCode,
  message: string,
  hints: readonly string[] = [],
): CommandFailure => ({
  code,
  message,
  hints,
});

export const CommandFailure = {
  create: failure,

  unknownCommand(choice: string, candidates: readonly string[]): CommandFailure {
    const hint =
      candidates.length === 0
        ? []
        : [`Did you mean: ${candidates.map((c) => `'${c}'`).join(", ")}?`];
    return failure(ErrorCodes.UnknownCommand, `Invalid choice: '${choice}'.`, hint);
  },

  commandExpected(available: readonly string[]): CommandFailure {
    return failure(ErrorCodes.UnknownCommand, "Command name argument expected.", [
      `Available commands: ${available.join(", ")}`,
    ]);
  },

  notImplemented(path: readonly string[]): CommandFailure {
    return failure(ErrorCodes.NotImplemented, `command not implemented yet: ${path.join(" ")}`, [
      "対応コマンドの一覧は docs/COMMANDS.md にあります。",
    ]);
  },

  unrecognizedArguments(args: readonly string[]): CommandFailure {
    return failure(ErrorCodes.InvalidFlag, `unrecognized arguments: ${args.join(" ")}`);
  },

  invalidChoice(flag: string, value: string, choices: readonly string[]): CommandFailure {
    return failure(
      ErrorCodes.InvalidFlag,
      `argument ${flag}: Invalid choice: '${value}'.\n\nValid choices are [${choices.join(", ")}].`,
    );
  },

  invalidValue(flag: string, reason: string): CommandFailure {
    return failure(ErrorCodes.InvalidFlag, `argument ${flag}: ${reason}`);
  },

  expectedOneArgument(flag: string): CommandFailure {
    return failure(ErrorCodes.InvalidFlag, `argument ${flag}: expected one argument`);
  },

  unclosedQuote(quote: string): CommandFailure {
    return failure(ErrorCodes.InvalidFlag, `unclosed quote: ${quote}`);
  },

  mustBeSpecified(argument: string): CommandFailure {
    return failure(ErrorCodes.MissingArgument, `argument ${argument}: Must be specified.`);
  },

  /** zone 未設定（E-004）。本物の対話プロンプトの代わりに指定方法を案内する。 */
  zoneRequired(): CommandFailure {
    return failure(
      ErrorCodes.MissingArgument,
      "argument --zone: Must be specified. gcloud-sim does not prompt for a zone.",
      [
        "--zone=ZONE を付けるか、gcloud config set compute/zone ZONE で既定のゾーンを設定してください。",
      ],
    );
  },

  projectRequired(): CommandFailure {
    return failure(
      ErrorCodes.MissingArgument,
      "The required property [project] is not currently set.\nYou may set it for your current workspace by running:\n\n  $ gcloud config set project VALUE\n\nor it can be set temporarily by the environment variable [CLOUDSDK_CORE_PROJECT]",
    );
  },

  notFound(resource: string): CommandFailure {
    return failure(
      ErrorCodes.NotFound,
      `Could not fetch resource:\n - The resource '${resource}' was not found`,
    );
  },

  notFoundMessage(message: string): CommandFailure {
    return failure(ErrorCodes.NotFound, message);
  },

  permissionDenied(missing: MissingPermission): CommandFailure {
    const roles = missing.rolesIncluding;
    const hint =
      roles.length === 0
        ? [`この権限（${missing.permission}）はロールカタログに収録されていません。`]
        : [`hint: この権限を含むロール: ${roles.join(", ")}`];
    return failure(
      ErrorCodes.PermissionDenied,
      `Could not fetch resource:\n - Required '${missing.permission}' permission for '${PolicyTarget.toPath(missing.target)}'`,
      hint,
    );
  },

  apiDisabled(apiTitle: string, apiName: string, projectId: string): CommandFailure {
    return failure(
      ErrorCodes.ApiDisabled,
      `${apiTitle} has not been used in project ${projectId} before or it is disabled. Enable it by running:\n\n  $ gcloud services enable ${apiName} --project=${projectId}\n\nthen retry.`,
    );
  },

  alreadyExists(resource: string): CommandFailure {
    return failure(ErrorCodes.AlreadyExists, `The resource '${resource}' already exists`);
  },

  invalidIamArgument(message: string): CommandFailure {
    return failure(ErrorCodes.InvalidIamArgument, message);
  },

  lastOwner(): CommandFailure {
    return failure(ErrorCodes.LastOwner, "refusing to remove the last owner of the organization", [
      "組織に roles/owner を持つメンバーが 1 人も居なくなる操作は拒否します（設計書 E-012）。",
    ]);
  },

  unsupportedOperation(message: string): CommandFailure {
    return failure(ErrorCodes.UnsupportedOperation, message);
  },

  invalidState(message: string): CommandFailure {
    return failure(ErrorCodes.InvalidState, message);
  },

  billingRequired(apiName: string, projectId: string): CommandFailure {
    return failure(
      ErrorCodes.BillingRequired,
      `Billing must be enabled for activation of service '${apiName}' in project '${projectId}' to proceed.`,
      [
        `hint: gcloud billing projects link ${projectId} --billing-account=ACCOUNT_ID で請求アカウントをリンクしてください。`,
      ],
    );
  },

  /**
   * gcloud-sim 固有のメッセージか。固有のものは `ERROR: (gcloud...)` ではなく `gcloud-sim:` で出す（DJ-005）。
   *
   * @param failure 失敗
   * @returns E-002 / E-012 なら真
   */
  isSimulatorOwn(failure: CommandFailure): boolean {
    return failure.code === ErrorCodes.NotImplemented || failure.code === ErrorCodes.LastOwner;
  },
} as const;
