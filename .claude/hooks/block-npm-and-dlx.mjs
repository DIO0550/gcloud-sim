#!/usr/bin/env node
// =============================================================================
// block-npm-and-dlx.mjs
//
// PreToolUse(Bash) フック。npm / npx / pnpx / bunx / pnpm dlx を拒否する。
//
// npm と npx にはクールタイム（minimumReleaseAge）に相当する設定が無く、公開直後の
// バージョンでも取り込めてしまう。pnpm dlx は一時インストールなのでロックファイルに
// 残らず、何を入れて動かしたかが後から辿れない。
//
// 依存の追加は pnpm add、インストール済みバイナリの実行は pnpm exec を使う。
//
// 判定はコマンド列全体の語を見る。先頭に来たときだけでなく `bash -c "npx foo"` や
// `xargs npx` のように途中へ紛れた形も拾う。取りこぼすと素通りしてしまうので、
// 「読み違えて余分に弾く」側へ倒している（弾かれたら書き方を変えればよい）。
// =============================================================================

/** 語として現れたら拒否するコマンド名 */
const DeniedCommands = new Set(["npm", "npx", "pnpx", "bunx"]);

/** コマンド名より後ろに現れたら拒否するサブコマンド（コマンド名 → サブコマンド） */
const DeniedSubcommands = new Map([["pnpm", "dlx"]]);

const Replacement =
  "依存の追加は `pnpm add`、インストール済みバイナリの実行は `pnpm exec` を使う。";

/**
 * コマンド列を語へ分割し、コマンド名として比較できる形へ揃える。
 * 空白とシェルの区切り記号で切り、`/usr/bin/npm` のようなパス付きは末尾だけを見る。
 * URL（`https://registry.npmjs.org/npm` など）はコマンドではないので除く。
 * @param {string} command
 * @returns {string[]}
 */
const tokenize = (command) =>
  command
    .split(/[\s;|&()<>{}"'`]+/)
    .filter((token) => token.length > 0 && !token.includes("://"))
    .map((token) => token.split("/").pop() ?? token);

/**
 * 拒否する理由。拒否しないなら null。
 * @param {string} command
 * @returns {string | null}
 */
const denialReason = (command) => {
  const tokens = tokenize(command);

  const denied = tokens.find((token) => DeniedCommands.has(token));
  if (denied !== undefined) {
    return `${denied} はこのリポジトリでは使わない。${Replacement}`;
  }

  for (const [name, subcommand] of DeniedSubcommands) {
    const at = tokens.indexOf(name);
    if (at !== -1 && tokens.includes(subcommand, at + 1)) {
      return `${name} ${subcommand} はこのリポジトリでは使わない。${Replacement}`;
    }
  }

  return null;
};

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
};

const payload = await readStdin();

/** @type {string} */
let command = "";
try {
  command = JSON.parse(payload)?.tool_input?.command ?? "";
} catch {
  // 解釈できない入力で Bash を止めない（フックの取りこぼしより誤爆のほうが害が大きい）
  process.exit(0);
}

const reason = denialReason(command);
if (reason !== null) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
}
