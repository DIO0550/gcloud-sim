import { CommandFailure } from "@/engine/cli/command-failure";
import {
  Column,
  CommandOutput,
  type CommandSpec,
  Flag,
  OutputMessage,
  ParsedArgs,
  Positional,
} from "@/engine/cli/command-spec";
import { plainCommand } from "@/engine/commands/shared";
import { Principal } from "@/engine/domains/principal";
import { SampleFile } from "@/engine/domains/sample-files";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

/** `--key-file` の鍵。この World で `keys create` した鍵か、サンプルの `key.json`。 */
const keyFileAccount = (world: World, file: string): Result<Principal, CommandFailure> => {
  const created = World.findKeyByFile(world, file);
  if (Option.isSome(created)) {
    return Result.mapErr(Principal.parse(created.value.serviceAccountEmail), (m) =>
      CommandFailure.invalidValue("--key-file", m),
    );
  }
  const sample = SampleFile.find(file);
  if (Option.isSome(sample) && sample.value.kind === "sa-key") {
    return Result.mapErr(Principal.parse(sample.value.clientEmail), (m) =>
      CommandFailure.invalidValue("--key-file", m),
    );
  }
  return Result.err(
    CommandFailure.notFoundWith(
      `Unable to read file [${file}]: [Errno 2] No such file or directory: '${file}'\ngcloud-sim: 使えるのは gcloud iam service-accounts keys create で書き出した名前か、サンプルの key.json です。`,
    ),
  );
};

export const AuthCommands: readonly CommandSpec[] = [
  plainCommand({
    path: ["gcloud", "auth", "activate-service-account"],
    summary: "Authorize access to Google Cloud with a service account credential file.",
    positionals: [
      Positional.optional(
        "ACCOUNT",
        "The service account email (must match the key file if given).",
      ),
    ],
    flags: [
      Flag.string("key-file", "Path to the private key file, e.g. key.json.", { required: true }),
    ],
    run: (ctx, args) => {
      const account = keyFileAccount(ctx.world, ParsedArgs.requiredString(args, "key-file"));
      if (!Result.isOk(account)) return account;
      const given = ParsedArgs.positional(args, 0);
      if (Option.isSome(given) && given.value !== account.value) {
        return Result.err(
          CommandFailure.invalidValue(
            "ACCOUNT",
            `The given account name [${given.value}] does not match the account in the key file [${account.value}].`,
          ),
        );
      }
      return Result.ok({
        world: World.withPrincipal(ctx.world, account.value),
        output: CommandOutput.messages(
          OutputMessage.plain(`Activated service account credentials for: [${account.value}]`),
        ),
      });
    },
  }),
  plainCommand({
    path: ["gcloud", "auth", "application-default", "login"],
    summary:
      "Acquire new user credentials to use for Application Default Credentials (simulated: uses the active account).",
    flags: [Flag.boolean("no-launch-browser", "Do not launch a browser.")],
    run: (ctx) => {
      const principal = Option.toResult(
        World.currentPrincipal(ctx.world),
        CommandFailure.noActiveAccount,
      );
      return Result.map(principal, (p) => ({
        world: World.withAdc(ctx.world, p),
        output: CommandOutput.messages(
          OutputMessage.plain(""),
          OutputMessage.plain(
            "Credentials saved to file: [~/.config/gcloud/application_default_credentials.json]",
          ),
          OutputMessage.plain(""),
          OutputMessage.plain(
            "These credentials will be used by any library that requests Application Default Credentials (ADC).",
          ),
          OutputMessage.hint(`gcloud-sim: ADC の主体を ${p} として記録しました（疑似認証）。`),
        ),
      }));
    },
  }),
  plainCommand({
    path: ["gcloud", "auth", "login"],
    summary:
      "Authorize gcloud to access Google Cloud (simulated: registers ACCOUNT as the active principal).",
    positionals: [
      Positional.required(
        "ACCOUNT",
        "User account to authorize. gcloud-sim has no browser flow, so the account is required.",
      ),
    ],
    flags: [
      Flag.boolean("brief", "Minimal user output."),
      Flag.boolean("no-launch-browser", "Do not launch a browser."),
    ],
    run: (ctx, args) => {
      const raw = ParsedArgs.requiredPositional(args, 0);
      const principal = Result.mapErr(Principal.parse(raw), (m) =>
        CommandFailure.invalidValue("ACCOUNT", m),
      );
      return Result.map(principal, (p) => ({
        world: World.withPrincipal(ctx.world, p),
        output: CommandOutput.messages(
          OutputMessage.plain(`You are now logged in as [${p}].`),
          OutputMessage.plain(
            `Your current project is [${Option.unwrapOr(World.currentProjectId(ctx.world), "None")}].  You can change this setting by running:`,
          ),
          OutputMessage.plain("  $ gcloud config set project PROJECT_ID"),
          OutputMessage.hint(
            "gcloud-sim: 認証は疑似です。任意のメールをプリンシパルとして登録するだけで、実在の認証情報は扱いません。",
          ),
        ),
      }));
    },
  }),
  plainCommand({
    path: ["gcloud", "auth", "list"],
    summary: "Lists credentialed accounts.",
    run: (ctx) => {
      const current = World.currentPrincipal(ctx.world);
      const rows = ctx.world.session.accounts.map((account) => ({
        active: Option.isSome(current) && current.value === account ? "*" : "",
        account,
      }));
      return Result.ok({
        world: ctx.world,
        output: CommandOutput.withTrailing(
          CommandOutput.table(
            rows,
            [Column.create("ACTIVE", "active"), Column.create("ACCOUNT", "account")],
            [OutputMessage.plain("                 Credentialed Accounts")],
          ),
          OutputMessage.plain(""),
          OutputMessage.plain("To set the active account, run:"),
          OutputMessage.plain("    $ gcloud config set account `ACCOUNT`"),
        ),
      });
    },
  }),
  plainCommand({
    path: ["gcloud", "auth", "revoke"],
    summary: "Revoke access credentials for an account (simulated).",
    positionals: [
      Positional.optional("ACCOUNT", "Account to revoke. Defaults to the active account."),
    ],
    run: (ctx, args) => {
      const account = Option.or(ParsedArgs.positional(args, 0), World.currentPrincipal(ctx.world));
      if (!Option.isSome(account)) return Result.err(CommandFailure.noActiveAccount());
      const isCredentialed = ctx.world.session.accounts.some((a) => a === account.value);
      if (!isCredentialed) {
        return Result.err(
          CommandFailure.notFoundWith(
            `Account [${account.value}] is not among the credentialed accounts.`,
          ),
        );
      }
      return Result.ok({
        world: ctx.world,
        output: CommandOutput.messages(
          OutputMessage.plain(`Revoked credentials:`),
          OutputMessage.plain(` - ${account.value}`),
          OutputMessage.hint(
            "gcloud-sim: 疑似認証なので、アカウント一覧からは外しません（再ログインは不要）。",
          ),
        ),
      });
    },
  }),
];
