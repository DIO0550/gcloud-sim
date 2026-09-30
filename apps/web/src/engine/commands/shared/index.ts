import { CommandFailure } from "@/engine/cli/command-failure";
import {
  type CommandContext,
  CommandOutput,
  type CommandResult,
  type CommandSpec,
  Flag,
  type FlagSpec,
  OutputMessage,
  ParsedArgs,
  type PositionalSpec,
  type ProjectContext,
  type TargetContext,
} from "@/engine/cli/command-spec";
import type { ApiName, Zone } from "@/engine/domains/catalog";
import { IamMember, IamPolicy, RoleName } from "@/engine/domains/iam-policy";
import { Operation, type OperationType } from "@/engine/domains/operation";
import type { Principal } from "@/engine/domains/principal";
import { PolicyTarget } from "@/engine/domains/resource-hierarchy";
import { RoleCatalog } from "@/engine/domains/role-catalog";
import { type AlreadyExists, type PolicyRejected, World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

/** 複数のサービスが同じ綴りで受けるフラグ。 */
export const CommonFlags = {
  zone: Flag.string("zone", "Zone of the resource. Overrides the default compute/zone property."),
  region: Flag.string(
    "region",
    "Region of the resource. Overrides the default compute/region property.",
  ),
  async: Flag.boolean(
    "async",
    "Return immediately, without waiting for the operation in progress to complete.",
  ),
  member: Flag.string(
    "member",
    "The principal to add the binding for. Should be of the form user|group|serviceAccount:email or domain:domain.",
    { required: true },
  ),
  role: Flag.string("role", "The role name to assign to the principal (e.g. roles/viewer).", {
    required: true,
  }),
} as const;

/** `AlreadyExists` を E-008 に写す。 */
export const alreadyExists = (failure: AlreadyExists): CommandFailure =>
  CommandFailure.alreadyExists(failure.resource);

/** `PolicyRejected` を E-005 / E-012 に写す。 */
const policyRejected = (rejected: PolicyRejected): CommandFailure => {
  switch (rejected.kind) {
    case "not-found":
      return CommandFailure.notFound(PolicyTarget.toPath(rejected.target));
    case "last-owner":
      return CommandFailure.lastOwner();
  }
};

/** `recordOperation` に渡す材料。通し番号は中で払い出す。 */
export type OperationRecordSeed = Readonly<{
  projectId: string;
  operationType: OperationType;
  targetLink: string;
  targetName: string;
  zone: Option<Zone>;
  user: Principal;
  now: string;
}>;

/**
 * オペレーションを履歴に足す（DJ-008: 即座に `DONE`）。
 *
 * @param world 元
 * @param seed 対象・種類・実行者・時刻
 * @returns 足した後の World と、作ったオペレーション
 */
export const recordOperation = (
  world: World,
  seed: OperationRecordSeed,
): Readonly<{ world: World; operation: Operation }> => {
  const numbered = World.nextNumber(world);
  const operation = Operation.create({ ...seed, sequence: numbered.number });
  return { world: World.withOperation(numbered.world, operation), operation };
};

const parseBinding = (
  args: ParsedArgs,
): Result<Readonly<{ member: IamMember; role: RoleName }>, CommandFailure> => {
  const rawMember = Option.unwrapOr(ParsedArgs.string(args, "member"), "");
  const rawRole = Option.unwrapOr(ParsedArgs.string(args, "role"), "");
  const member = Result.mapErr(IamMember.parse(rawMember), CommandFailure.invalidIamArgument);
  if (!Result.isOk(member)) return member;
  const role = RoleName.parse(rawRole);
  const isKnown =
    Option.isSome(role) &&
    (RoleName.isCustom(role.value) || Option.isSome(RoleCatalog.find(role.value)));
  if (!Option.isSome(role) || !isKnown) {
    return Result.err(
      CommandFailure.invalidIamArgument(
        `INVALID_ARGUMENT: Role ${rawRole} is not supported for this resource.`,
      ),
    );
  }
  return Result.ok({ member: member.value, role: role.value });
};

type BindingCommandSeed = Readonly<{
  /** `["gcloud", "projects"]` のようなグループ */
  group: readonly string[];
  positional: PositionalSpec;
  /** `project [ace-dev-01]` のような、メッセージに出す綴り */
  label: (target: PolicyTarget) => string;
  resolveTarget: (ctx: CommandContext, args: ParsedArgs) => Result<PolicyTarget, CommandFailure>;
  permissions: Readonly<{ get: string; set: string }>;
}>;

const requirePolicy = (ctx: TargetContext): Result<IamPolicy, CommandFailure> =>
  Option.toResult(World.findPolicy(ctx.world, ctx.target), () =>
    CommandFailure.notFound(PolicyTarget.toPath(ctx.target)),
  );

const bindingRun =
  (seed: BindingCommandSeed, direction: "add" | "remove") =>
  (ctx: TargetContext, args: ParsedArgs): CommandResult => {
    const binding = parseBinding(args);
    if (!Result.isOk(binding)) return binding;
    const current = requirePolicy(ctx);
    if (!Result.isOk(current)) return current;
    const { member, role } = binding.value;
    const next =
      direction === "add"
        ? Option.some(IamPolicy.addBinding(current.value, role, member))
        : IamPolicy.removeBinding(current.value, role, member);
    if (!Option.isSome(next)) {
      return Result.err(
        CommandFailure.notFoundWith(
          "Policy binding with the specified principal, role, and condition not found!",
        ),
      );
    }
    const world = Result.mapErr(
      World.withPolicy(ctx.world, ctx.target, next.value),
      policyRejected,
    );
    return Result.map(world, (w) => ({
      world: w,
      output: CommandOutput.yaml(IamPolicy.toRecord(next.value), [
        OutputMessage.plain(`Updated IAM policy for ${seed.label(ctx.target)}.`),
      ]),
    }));
  };

/**
 * `get-iam-policy` / `add-iam-policy-binding` / `remove-iam-policy-binding` の 3 つを、
 * 対象（組織・フォルダ・プロジェクト・バケット）ごとに同じ形で作る。
 *
 * @param seed 対象の解決と権限
 * @returns 3 つのコマンド定義
 */
export const iamBindingCommands = (seed: BindingCommandSeed): readonly CommandSpec[] => [
  {
    kind: "target",
    path: [...seed.group, "get-iam-policy"],
    summary: "Get the IAM policy for a resource.",
    positionals: [seed.positional],
    flags: [],
    destructive: false,
    requiredPermissions: [seed.permissions.get],
    resolveTarget: seed.resolveTarget,
    run: (ctx) =>
      Result.map(requirePolicy(ctx), (policy) => ({
        world: ctx.world,
        output: CommandOutput.yaml(IamPolicy.toRecord(policy)),
      })),
  },
  {
    kind: "target",
    path: [...seed.group, "add-iam-policy-binding"],
    summary: "Add an IAM policy binding to a resource.",
    positionals: [seed.positional],
    flags: [CommonFlags.member, CommonFlags.role],
    destructive: false,
    requiredPermissions: [seed.permissions.set],
    resolveTarget: seed.resolveTarget,
    run: bindingRun(seed, "add"),
  },
  {
    kind: "target",
    path: [...seed.group, "remove-iam-policy-binding"],
    summary: "Remove an IAM policy binding from a resource.",
    positionals: [seed.positional],
    flags: [CommonFlags.member, CommonFlags.role],
    destructive: false,
    requiredPermissions: [seed.permissions.set],
    resolveTarget: seed.resolveTarget,
    run: bindingRun(seed, "remove"),
  },
];

/** 未対応コマンドの定義（DJ-005）。 */
export const notImplemented = (path: readonly string[], summary: string): CommandSpec => ({
  kind: "not-implemented",
  path,
  summary,
});

/** `kind: "project"` の定義の材料。省いた項目は「引数なし・フラグなし・API 検証なし・確認なし」。 */
export type ProjectCommandSeed = Readonly<{
  path: readonly string[];
  summary: string;
  positionals?: readonly PositionalSpec[];
  flags?: readonly FlagSpec[];
  permission: string;
  requiredApis?: readonly ApiName[];
  destructive?: boolean;
  run: (ctx: ProjectContext, args: ParsedArgs) => CommandResult;
}>;

/**
 * `kind: "project"` の定義を材料から組む。同じ形の定義を並べるモジュール（storage / compute の list 等）が使う。
 *
 * @param seed 材料
 * @returns コマンド定義
 */
export const projectCommand = (seed: ProjectCommandSeed): CommandSpec => ({
  kind: "project",
  path: seed.path,
  summary: seed.summary,
  positionals: seed.positionals ?? [],
  flags: seed.flags ?? [],
  destructive: seed.destructive ?? false,
  requiredPermissions: [seed.permission],
  requiredApis: seed.requiredApis ?? [],
  run: seed.run,
});
