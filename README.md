# gcloud-sim

ブラウザだけで動く **gcloud CLI の学習用エミュレータ**。Google Cloud Associate Cloud Engineer（ACE）の
出題範囲に出る `gcloud` / `gcloud storage` / `gsutil` の操作を、課金なし・アカウントなしで
「打ったら結果が返る」形で体験する。

> **Google 非公式の学習用ツールです。** 本物の Google Cloud には一切接続せず、データは
> ブラウザの localStorage にだけ保存し、外部へ送信しません。`gcloud auth login` は疑似で、
> 任意のメールをプリンシパルとして登録するだけです。

**公開ページ: <https://dio0550.github.io/gcloud-sim/>**

`main` へ push すると [`deploy-pages.yml`](.github/workflows/deploy-pages.yml) が static export を
作って上の URL へ出す。PR には**そのブランチのサイトを触れるプレビュー**が
`…/gcloud-sim/pr-preview/pr-<番号>/` に出る（詳しくは「[CI とデプロイ](#ci-とデプロイ)」）。

## できること

- **ターミナル**（xterm.js）: 本物準拠の出力とエラー。Tab 補完（コマンド名・フラグ名・リソース名）、↑↓ 履歴、
  Ctrl+L、`--help`、`--format=json|yaml|value(...)`、`--filter`
- **IAM の継承**: `gcloud config set account` でプリンシパルを切り替え、権限不足の
  `PERMISSION_DENIED` を体験し、組織 / フォルダ / プロジェクトのどこにロールを付ければ通るかを
  試行錯誤できる。エラーの下に `gcloud-sim: hint:` で「その権限を含むロール」を出す
- **リソースツリー**: 組織 → フォルダ → プロジェクト → リソース。クリックでプロパティと
  IAM の継承元、ダブルクリックで `describe` を入力行に挿入
- **ミッション**: 18 本（ACE の 5 ドメイン）。状態に対するアサーションでクリア判定する
  （コマンドの文字列一致ではない）
- **保存**: コマンドごとに localStorage へ自動保存。設定から JSON の export / import / リセット
- **kubectl**: `gcloud container clusters get-credentials` したクラスタに対して、Deployment / Service / Pod を
  `apply` / `expose` / `scale` / `rollout` などで動かせる（設定ファイルは `deployment.yaml` / `service.yaml` のサンプル）
- **Console 風 GUI**（Phase 2）: ヘッダーの CLI / Console で切り替える。IAM・サービスアカウント・ロール・予算・
  VM・ファイアウォール・サブネット・バケット・クラスタ・Cloud Run の画面を持ち、作成フォームには
  「同等のコマンドライン」が出る。送信したものはターミナルにも `# Console:` 付きで残る

対応コマンドの一覧と、基準にした gcloud のバージョン、IAM 判定の範囲（収録外の権限は許可に倒す）は
[`docs/COMMANDS.md`](docs/COMMANDS.md)。設計は [`docs/design.md`](docs/design.md)、UI 案は
[`docs/ui/`](docs/ui/)。

開発の土台（ツール・CI・デプロイ・開発環境）は [exam-prep](https://github.com/DIO0550/exam-prep) から
持ってきたもの。

## 構成

pnpm workspace。アプリは `apps/` 配下、アプリ間で共有するものは `packages/` 配下に置く
（`packages/` はまだ空で、アプリから切り離せるものができたら作る）。

```
apps/web/          Next.js 16（App Router / TypeScript / Tailwind v4）
  src/app/         ルーティングとページ。色トークンは globals.css の @theme
  src/engine/      エミュレータ本体。React・DOM・I/O に依存しない純粋 TS（テストが確かめる）
    domains/       World とリソースのドメインオブジェクト（型 + 同名コンパニオン）
    cli/           tokenizer / 引数の解釈 / フォーマッタ / 登録簿 / shell（確認プロンプト）
    commands/      CommandSpec の定義（サービスごと）
    missions/      ミッション定義とアサーション
    snapshot/      export / import の形と検証
  src/features/simulator/  画面（ヘッダー / ツリー / ターミナル / 右ペイン / 設定）と reducer
    features/console/      Console 風 GUI（simulator の子 feature。画面と同等コマンドの生成）
  src/components/  ドメイン知識を持たない UI 部品（ボタン / 小見出し / 札）
  src/libs/        境界: localStorage・ファイル・時計・xterm.js のラップ
  src/base-path.ts basePath の唯一の定義（next.config.ts と public/ 参照の両方が使う）
  vitest.config.ts テスト設定（jsdom + Testing Library。engine のテストは node 環境）
docs/              設計書・対応コマンド・UI 案
biome.json         lint / format（リポジトリ全体を 1 つの設定で見る）
pnpm-workspace.yaml workspace とクールタイムの設定
```

依存の向きは `app → features → engine(commands → cli → domains) ← libs`。実行時依存は
Next.js / React / Tailwind と xterm.js（`@xterm/xterm` + `@xterm/addon-fit`）だけ。

## コマンド

ルートから実行する。`--filter` で `apps/web` に流すだけなので、アプリの中で直接叩いてもよい。

| コマンド | 内容 |
|---|---|
| `pnpm dev` | dev サーバ（`http://localhost:4200/gcloud-sim/`。`basePath` は dev でも効く） |
| `pnpm build` | static export を作る（出力は `apps/web/out`） |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest（`pnpm --filter @gcloud-sim/web test:watch` で watch） |
| `pnpm check` | Biome で lint / format / import 順を検査 |
| `pnpm fix` | Biome で自動修正 |
| `pnpm visual:capture` | 主要画面のスクリーンショットを撮る（先に `pnpm build`） |
| `pnpm visual:compare` | 撮った画像を baseline と比べ、差分の画像を作る |

依存を足すときは `pnpm --filter @gcloud-sim/web add <pkg>`。`npm` / `npx` / `pnpm dlx` は
フックで拒否される（後述）。

`next dev` は `apps/web/AGENTS.md` と `apps/web/CLAUDE.md` を自動生成して毎回書き戻すので、
追跡している。止めたいときは `next.config.ts` に `agentRules: false` を足す。

## CI とデプロイ

workflow は目的ごとに分けてある。見たいものが違い（「壊れていないか」「出せたか」
「見た目が変わっていないか」「触って確かめられるか」）、必要な権限も違うため。

| workflow | いつ走るか | やること | 権限 |
|---|---|---|---|
| [`ci.yml`](.github/workflows/ci.yml) | PR / `main` への push / 手動 | `pnpm check` / `typecheck` / `test` / `build` | `contents: read` |
| [`deploy-pages.yml`](.github/workflows/deploy-pages.yml) | `main` への push / 手動 | static export を作って `gh-pages` のルートへ出す | `contents: write` と `pages: read`（設定の確認） |
| [`pr-preview.yml`](.github/workflows/pr-preview.yml) | PR | その PR のサイトを `gh-pages/pr-preview/pr-<番号>/` へ出し、URL を PR に貼る | `contents: write` と PR コメント |
| [`visual-regression.yml`](.github/workflows/visual-regression.yml) | PR / 手動 | 主要画面を撮って main と比べ、レポートを `gh-pages` へ出し PR に貼る | `contents: write` と PR コメント |
| [`visual-baseline.yml`](.github/workflows/visual-baseline.yml) | `main` への push / 手動 | 比べる相手（baseline）を撮り直す | `contents: write` |

公開先は <https://dio0550.github.io/gcloud-sim/>。パスが `/gcloud-sim` の分だけ深くなるのは
プロジェクトページだからで、`basePath` をそれに合わせてある（後述）。

**`main` への push では、検査（ci）とデプロイと baseline 撮り直しが並行して走る。**
デプロイ側はテストの成否を待たないので、
検査を通らないものを出したくないなら、**ブランチ保護で CI を必須チェックにする**
（Settings → Branches → `main` → Require status checks to pass → `verify`）。
main へ直接 push せず PR を通す運用であれば、PR の時点で CI が通っている。

**リポジトリ設定が 1 つ要る。** Settings → Pages → Build and deployment → Source を
**Deploy from a branch**、Branch を **`gh-pages` / (root)** にする。ここが "GitHub Actions" の
ままだと、push しても公開内容が変わらないまま古いサイトが出続ける（黙って古いものが出るのが
一番困るので、`deploy-pages.yml` の最後で今の配信元を読んで、違っていれば落とすようにしてある）。
`gh-pages` ブランチは最初の workflow が push したときにできるので、その後に設定する。

ブランチ方式にしてあるのは、**PR のプレビューを同じサイトに同居させる**ため。Pages の配信元は
リポジトリにつき 1 つしか選べないので、Actions から直接デプロイする方式のままでは
`main` のサイトと PR のプレビューを両方出せない。

| gh-pages の中身 | 誰が置くか |
|---|---|
| ルート（`index.html` など） | `deploy-pages.yml`（`main` への push） |
| `pr-preview/pr-<番号>/` | `pr-preview.yml`（PR ごと。閉じたら消す） |
| `visual-regression/pr-<番号>/<SHA>/` | `visual-regression.yml`（見た目の差分のレポートと画像。閉じたら消す） |
| `visual-baseline/` | `visual-baseline.yml`（比べる相手の画像） |

**どの workflow も自分の場所しか触らない。** 出し直すときも、他の 3 つのフォルダはそのまま残す。

Pages のビルドは 1 時間に 10 回までという緩い上限がある。PR に push すると
プレビューと差分レポートで 2 回 push されるので、立て続けに直すと数分待たされることがある。

ブランチは毎回 1 コミットに作り直す（force push）。履歴を積むとリポジトリが太り続けるため。

### workflow の方針

- **Action は GitHub 公式（`actions/*`）だけ**。pnpm 用のサードパーティ Action
  （`pnpm/action-setup` など）は使わず、corepack が `package.json` の `packageManager`
  （ハッシュ付きで固定）から pnpm を入れる
- **すべてコミット SHA で固定**。タグは付け替えられるがコミット SHA は動かない。
  更新するときは SHA と横のコメントのバージョンを一緒に書き換える
- `pnpm install --frozen-lockfile` なので、ロックファイルのズレに加えて
  **クールタイム（7 日）を満たさないバージョンが載っていれば CI で落ちる**
- corepack は Node 24 に同梱されているものを使う。Node 25 以降へ上げるときは
  corepack が外れるので、pnpm の入れ方を別途決める必要がある
- セットアップ（checkout / Node / corepack / キャッシュ / install）は各 workflow に
  同じ内容が並ぶ。まとめるにはローカルの composite action を挟むことになるので、
  1 ファイルを読めば何が動くか分かる状態を優先した。**1 つを直したら他も直す**
- **ビルドだけは 3 回まで試す**（`ci.yml` / `deploy-pages.yml`）。`layout.tsx` の
  `next/font/google` が Google Fonts からフォントを取り込むのはビルド時で、ここが
  一過性で落ちると `@font-face` がまとめて
  `Module not found: @vercel/turbopack-next/internal/font/google/font` になる。
  コードの問題と見分けが付かないまま公開が止まるので、前の試行の残り
  （`.next` と `out`）を捨てて取り直す。`out` まで消すのは、デプロイがここを `cp` で
  マージして公開するため。3 回とも駄目なら本当に壊れているとみなして落とす

### static export の設定

[`apps/web/next.config.ts`](apps/web/next.config.ts) に置いてある。

| 設定 | 理由 |
|---|---|
| `output: 'export'` | 静的ファイルだけを吐く（出力は `apps/web/out`） |
| `basePath` | プロジェクトページはリポジトリ名の分だけパスが深くなる。既定は `/gcloud-sim`。PR プレビューのビルドだけ `NEXT_PUBLIC_BASE_PATH` で差し替える（[`base-path.ts`](apps/web/src/base-path.ts)） |
| `trailingSlash: true` | `out/foo/index.html` の形にする。拡張子なし URL の解決はホストによって差があるため |
| `images.unoptimized: true` | static export には画像最適化サーバが無い |

`public/` 配下のファイルを参照するときは `base-path.ts` の `assetUrl()` を通す
（`basePath` の分だけパスが深くなるため）。ファビコンもまだ無い。足すときは `app/` に
`icon.svg` / `apple-icon.png` を置き、`favicon.ico` は `layout.tsx` の `metadata.icons` で明示的に指す
（プロジェクトページは `/gcloud-sim/` 配下なので、ブラウザ任せの「サイト直下の /favicon.ico」には落ちてこない）。

`public/.nojekyll` を置いてある。ブランチから配信すると Jekyll を通るので、これが無いと
`_next/` のようなアンダースコア始まりが配信されず、JS と CSS が 404 になる
（workflow 側でもルートに `.nojekyll` を作っている）。

`output: 'export'` では `next start` が使えないので、ルートの `start` スクリプトは無い。
ビルド結果を手元で見るときは `apps/web/out` を任意の静的サーバで配る。

## パッケージ取り込みのクールタイム

npm のサプライチェーン攻撃は、乗っ取ったアカウントから新バージョンを publish する形が多く、
発覚と unpublish は数時間〜数日で起きる。その窓を跨いでから取り込むために、公開から 7 日
（10080 分）経っていないバージョンは入れない。設定は [`pnpm-workspace.yaml`](pnpm-workspace.yaml)。

| 設定 | 値 | 意味 |
|---|---|---|
| `minimumReleaseAge` | `10080`（分 = 7 日） | この時間を経ていないバージョンを入れない |
| `minimumReleaseAgeStrict` | `true` | 期限を満たすバージョンが無いとき、古い版へ黙って落とさず解決を失敗させる |
| `minimumReleaseAgeIgnoreMissingTime` | `false` | 公開日を返さないレジストリのパッケージを検査なしで通さない |

効く範囲は解決時（`pnpm add` / `pnpm update`）だけではない。pnpm 11.3.0 以降は `pnpm install`
がロックファイルの各エントリも検査するので（`trustLockfile` の既定が `false`）、期限内の
バージョンが載ったロックファイルは CI の `--frozen-lockfile` でも落ちる。

クールタイムを待たずに入れたいものがあるときだけ、`minimumReleaseAgeExclude` に
パッケージ名 / パターン（`'@myorg/*'`）/ バージョン指定（`'next@16.3.5'`）で例外を足す。

### どこに書くと効くか

同じ設定でも、置き場所によって効いたり効かなかったりする。しかも **pnpm 10 と 11 以降で
逆転している**（exam-prep で `pnpm add next` の解決結果を実測。✅ = 解決に効く）。

| 置き場所 | pnpm 10.33 | pnpm 12.3.4 |
|---|---|---|
| リポジトリの `pnpm-workspace.yaml` | ✅ | ✅ |
| リポジトリの `.npmrc` | ✅ | ❌ |
| グローバルの `~/.config/pnpm/rc`（`pnpm config set --global` が書く形式） | ✅ | ❌ |
| グローバルの `~/.config/pnpm/config.yaml` | ❌ | ✅ |
| 環境変数 `PNPM_CONFIG_MINIMUM_RELEASE_AGE` | - | ✅（リポジトリの設定より強い） |

`pnpm config get minimumReleaseAge` は判定に使えない。rc に書いた値は解決に効かなくても
読めてしまい、config.yaml に書いた値は効いていても `undefined` を返す。確かめるなら
実際に `pnpm add` して入るバージョンを見る。

そのため、このリポジトリでは次のように置いている。

- **リポジトリ内の install**: `pnpm-workspace.yaml`。どのマシン・どの環境でも効くので、
  クラウドのセッションや CI もこれでカバーされる。`.npmrc` は置かない（`packageManager` が
  pnpm 12 なので効かないうえ、10 系へ落としたときだけ効く設定はかえって紛らわしい）
- **リポジトリ外の解決（`pnpm dlx` など）**: devcontainer では
  [Dockerfile](.devcontainer/node/Dockerfile) が `config.yaml` に書く。クラウドのセッションは
  そのイメージを使わないので、[`.claude/hooks/session-start.sh`](.claude/hooks/session-start.sh)
  が rc と config.yaml の両方へ書く（どちらの pnpm が載っているか決められないため）
- 環境変数は使わない。リポジトリの `pnpm-workspace.yaml` より強く、リポジトリ側の指定を
  上書きしてしまうため

npm 側にはクールタイムに相当する設定が無いので、依存の追加は pnpm で行う。

## 開発環境（devcontainer）

VS Code / Cursor で「Reopen in Container」。中身は次の通り。

- Ubuntu 24.04 + Node 24 + CJK フォント。gh / pnpm + safe-chain / AI ツール（Copilot CLI・
  Claude Code）/ tmux / Playwright は exam-prep と同じスクリプトで入れる
- リポジトリの中で動く pnpm は `package.json` の `packageManager`（12.3.4、ハッシュ付きで固定）。
  イメージに入るグローバルの pnpm は 10 系なので、クールタイムは rc と config.yaml の両方に書いてある
- 起動時に [`init-firewall.sh`](.devcontainer/init-firewall.sh) が外向き通信を許可リストへ絞る。
  許可先を足すときは同ファイルの `ALLOWED_DOMAINS`
- ファイアウォールは root の [`entrypoint.sh`](.devcontainer/entrypoint.sh) が適用し、開発ユーザー
  （`vscode`）には sudo を与えない（与えると許可リストを自分で外せてしまうため）
- ポート 4200 を転送。コンテナの中なので `next dev -p 4200 -H 0.0.0.0` で起動する
  （Next.js は HMR も dev サーバと同じポートを使うので、転送は 1 つでよい）。
  exam-prep（4100）と同時に立ち上げてもぶつからないよう、番号をずらしてある
- セットアップスクリプトが `npm config set ignore-scripts true` を入れる（pnpm 10 以降は依存のライフサイクルスクリプトを
  既定で実行せず、必要なものだけ `onlyBuiltDependencies` で許可する）

## Claude Code のフック

`.claude/settings.json` に 2 つ登録してある。

- **PreToolUse / Bash**（[`block-npm-and-dlx.mjs`](.claude/hooks/block-npm-and-dlx.mjs)）—
  `npm` / `npx` / `pnpx` / `bunx` / `pnpm dlx` を拒否する。npm と npx にはクールタイムに
  相当する設定が無く、`pnpm dlx` は一時インストールなのでロックファイルに残らない。
  コマンド列の**どこに現れても**拒否するので、`bash -c "npx …"` や `xargs npx` のように
  途中へ紛れた形も拾う。依存の追加は `pnpm add`、インストール済みバイナリの実行は
  `pnpm exec` を使う
- **SessionStart**（[`session-start.sh`](.claude/hooks/session-start.sh)）—
  クラウドのセッションで、リポジトリ外の解決にもクールタイムが効くようグローバル設定を書く。
  依存のインストールはしない（`pnpm install` は必要なときに手で実行する）

フックは**セッション開始時に読まれる**ので、変更は次のセッションから効く。

## PR のプレビュー

PR を出すと、そのブランチのサイトが
`https://dio0550.github.io/gcloud-sim/pr-preview/pr-<番号>/` に出て、URL が PR にコメントされる
（[`pr-preview.yml`](.github/workflows/pr-preview.yml)）。画像で見る差分と違い、こちらは
**実際に触って確かめる**ためのもの。PR を閉じるとフォルダごと消える。

- `basePath` はビルド時に焼き込まれるので、プレビュー用に `NEXT_PUBLIC_BASE_PATH` を
  与えてビルドする。本番と同じ値のままだと、資材の URL が `/gcloud-sim/...` を指したままになり
  プレビューでは 404 になる
- localStorage などブラウザに保存したものは、**URL（オリジン＋パス）が本番と違うので混ざらない**
- 反映まで 1〜数分かかる。Pages のデプロイは同時に 1 本しか走らないので、`main` への push と
  PR の push が重なると、後から入ったほうはその分待つ

## 見た目の差分（PR で確認する）

コードの差分だけでは画面がどう変わったか分からないので、PR に **前 / 後 / 差分** の画像を貼る。
[`visual-regression.yml`](.github/workflows/visual-regression.yml) が PR のたびに走り、
static export をビルドして主要画面を撮り、main の画像（baseline）と画素で突き合わせる。

撮る画面は [`visual-scenarios.mjs`](.github/scripts/visual-scenarios.mjs) に並べてある。
今はトップ・設定・Console の 5 画面を **PC 幅（1440px）とスマホ幅（430px）**の 2 通りで撮る。
画面を足したいときはこのファイルに 1 つ足すだけでよく、workflow は触らない。
手順はボタンの文字で押す（`click`）、待つ（`wait`）、端末に 1 行打つ（`type`）、入力欄に入れる（`fill`）の 4 つ。画面に固有の操作が要るときは
[`visual-regression.mjs`](.github/scripts/visual-regression.mjs) の `applyStep` に足す。

手元でも同じものが撮れる。

```
pnpm build
pnpm visual:capture -- --out visual-actual
pnpm visual:compare -- --expected visual-baseline --actual visual-actual --out visual-report
```

### 差分が出たとき

チェックは**落ちる**。壊したのか意図して変えたのかは絵を見ないと分からないので、既定では
レビューを止める。PR コメントの画像か、そこからリンクしている**レポートのページ**
（`…/gcloud-sim/visual-regression/pr-<番号>/<SHA>/`）を見て、意図した変更なら
`visual-approved` ラベルを付ける（付けるとチェックが通る）。意図しない変更ならコードを直す。

レポートのページでは、撮ったすべての画像を **差分 / 並べて / 重ねて（境目を動かす）** の
3 通りで見られる。画面名でしぼり込みもできる。コメントに貼る画像は変化の大きいものだけなので、
全部見たいときはこちらを開く。

### 作りと、そう作った理由

- **撮影はブラウザを直に動かす**（CDP）。Playwright などを足していないのは、この検査のために
  依存を増やしたくないため。画素の比較も同じブラウザの canvas でやるので、追加の依存はゼロ
- **撮るたびに同じ絵になるよう、時刻を固定する**。実時刻から作る表示があると毎回差分として出る。
  アニメーションも止めて撮る
- **状態は localStorage に直接置ける**（シナリオの `storage`）。画面の操作だけで作ると時間がかかる状態のため
- **日本語フォントを入れてから撮る**。入っていないと日本語が豆腐（□）になる。豆腐は毎回同じ絵なので
  差分としては出ず、気づかないまま baseline に焼き付く
- **レポートと画像は `gh-pages` の `visual-regression/pr-<番号>/<SHA>/` に置く**。
  一覧は Pages の URL で開き（`index.html` は同じフォルダの画像を相対パスで読む）、
  PR コメントに貼る画像だけは raw.githubusercontent.com を指す。
  Pages のデプロイが終わる前でもコメントの画像が見えるようにするためで、実体は同じファイル
- ブランチは**毎回 1 コミットに作り直す**（force push）。画像を積み上げるとリポジトリが太り続けるため。
  PR ごとの画像は閉じたときに消す
