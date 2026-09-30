import { CommandFailure } from "@/engine/cli/command-error";
import {
  type CommandContext,
  CommandOutput,
  type CommandResult,
  type CommandSpec,
  Flag,
  type FlagSpec,
  type JsonRecord,
  OutputMessage,
  ParsedArgs,
  Positional,
  type PositionalSpec,
} from "@/engine/cli/command-spec";
import { IamMember, IamPolicy, RoleName } from "@/engine/domains/iam-policy";
import { Operation, type OperationType } from "@/engine/domains/operation";
import type { PolicyTarget } from "@/engine/domains/resource-hierarchy";
import { RoleCatalog } from "@/engine/domains/role-catalog";
import { type AlreadyExists, World } from "@/engine/domains/world";
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

/**
 * オペレーションを履歴に足す（DJ-008: 即座に `DONE`）。
 *
 * @param world 元
 * @param seed 対象・種類・実行者・時刻
 * @returns 足した後の World と、作ったオペレーション
 */
export const recordOperation = (
  world: World,
  seed: Readonly<{
    projectId: string;
    operationType: OperationType;
    targetLink: string;
    targetName: string;
    zone: string;
    user: string;
    now: string;
  }>,
): Readonly<{ world: World; operation: Operation }> => {
  const numbered = World.nextNumber(world);
  const operation = Operation.create({ ...seed, sequence: numbered.number });
  return { world: World.withOperation(numbered.world, operation), operation };
};

/** ポリシーを `get-iam-policy` / `add-iam-policy-binding` が出す形にする。 */
export const policyRecord = (policy: IamPolicy): JsonRecord => ({
  bindings: policy.bindings.map((b) => ({ members: [...b.members], role: b.role })),
  etag: "BwYEp2z-Xd0=",
  version: 1,
});

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
    (role.value.startsWith("projects/") || Option.isSome(RoleCatalog.find(role.value)));
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
  /** `projects/ace-dev-01` のような、メッセージに出す綴り */
  label: (target: PolicyTarget) => string;
  resolveTarget: (ctx: CommandContext, args: ParsedArgs) => Result<PolicyTarget, CommandFailure>;
  permissions: Readonly<{ get: string; set: string }>;
  /** `gs://` の位置引数など、追加のフラグ */
  extraFlags?: readonly FlagSpec[];
}>;

const bindingRun =
  (seed: BindingCommandSeed, direction: "add" | "remove") =>
  (ctx: CommandContext, args: ParsedArgs): CommandResult => {
    const target = seed.resolveTarget(ctx, args);
    if (!Result.isOk(target)) return target;
    const binding = parseBinding(args);
    if (!Result.isOk(binding)) return binding;
    const current = World.policyOf(ctx.world, target.value);
    if (!Option.isSome(current))
      return Result.err(CommandFailure.notFound(seed.label(target.value)));
    const { member, role } = binding.value;
    const next =
      direction === "add"
        ? Option.some(IamPolicy.addBinding(current.value, role, member))
        : IamPolicy.removeBinding(current.value, role, member);
    if (!Option.isSome(next)) {
      return Result.err(
        CommandFailure.notFoundMessage(
          "Policy binding with the specified principal, role, and condition not found!",
        ),
      );
    }
    const world = World.withPolicy(ctx.world, target.value, next.value);
    if (!Option.isSome(world)) return Result.err(CommandFailure.lastOwner());
    return Result.ok({
      world: world.value,
      output: CommandOutput.yaml(policyRecord(next.value), [
        OutputMessage.plain(`Updated IAM policy for ${seed.label(target.value)}.`),
      ]),
    });
  };

/**
 * `get-iam-policy` / `add-iam-policy-binding` / `remove-iam-policy-binding` の 3 つを、
 * 対象（組織・フォルダ・プロジェクト・バケット）ごとに同じ形で作る。
 *
 * @param seed 対象の解決と権限
 * @returns 3 つのコマンド定義
 */
export const iamBindingCommands = (seed: BindingCommandSeed): readonly CommandSpec[] => {
  const extra = seed.extraFlags ?? [];
  return [
    {
      kind: "target",
      path: [...seed.group, "get-iam-policy"],
      summary: "Get the IAM policy for a resource.",
      positionals: [seed.positional],
      flags: [...extra],
      destructive: false,
      requiredPermissions: [seed.permissions.get],
      resolveTarget: seed.resolveTarget,
      run: (ctx, args) => {
        const target = seed.resolveTarget(ctx, args);
        if (!Result.isOk(target)) return target;
        const policy = World.policyOf(ctx.world, target.value);
        if (!Option.isSome(policy))
          return Result.err(CommandFailure.notFound(seed.label(target.value)));
        return Result.ok({
          world: ctx.world,
          output: CommandOutput.yaml(policyRecord(policy.value)),
        });
      },
    },
    {
      kind: "target",
      path: [...seed.group, "add-iam-policy-binding"],
      summary: "Add an IAM policy binding to a resource.",
      positionals: [seed.positional],
      flags: [CommonFlags.member, CommonFlags.role, ...extra],
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
      flags: [CommonFlags.member, CommonFlags.role, ...extra],
      destructive: false,
      requiredPermissions: [seed.permissions.set],
      resolveTarget: seed.resolveTarget,
      run: bindingRun(seed, "remove"),
    },
  ];
};

/** 未対応コマンドの定義（DJ-005）。 */
export const notImplemented = (path: readonly string[], summary: string): CommandSpec => ({
  kind: "not-implemented",
  path,
  summary,
});

export { Positional };
