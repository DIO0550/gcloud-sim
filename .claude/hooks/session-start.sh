#!/bin/bash
# =============================================================================
# session-start.sh
#
# クラウドのセッション（Claude Code on the web）で、pnpm のクールタイムを
# リポジトリの外にも効かせる。
#
# リポジトリの中での解決は pnpm-workspace.yaml が効くので、ここでは何もしなくてよい。
# 効かないのはリポジトリの外（pnpm dlx など）で、devcontainer ではイメージに入れた
# グローバル設定がそれを担う。クラウドのコンテナはそのイメージを使わないので、
# 同じ設定をここで書く。
#
# 環境変数（PNPM_CONFIG_MINIMUM_RELEASE_AGE）ではなくグローバル設定に書くのは、
# 環境変数がリポジトリの pnpm-workspace.yaml より強く、リポジトリ側の指定を
# 上書きしてしまうため。
#
# グローバル設定の置き場は pnpm のメジャーバージョンで割れているので両方に書く。
# pnpm 11 以降は config.yaml（camelCase）だけが解決に効き、rc 形式
# （pnpm config set --global が書く形式）は pnpm config get で読めても効かない。
# pnpm 10 はその逆で、rc は効くが config.yaml を読まない。クラウドのイメージが
# どちらの pnpm を積んでいるかはこちらで決められないため、両方を置いて揃える。
# =============================================================================
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# pnpm-workspace.yaml と同じ 7 日
MINIMUM_RELEASE_AGE=10080

CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/pnpm"
mkdir -p "$CONFIG_DIR"

# pnpm 11 以降が読む側
YAML_FILE="$CONFIG_DIR/config.yaml"
if grep -q '^minimumReleaseAge:' "$YAML_FILE" 2>/dev/null; then
  sed -i "s/^minimumReleaseAge:.*/minimumReleaseAge: ${MINIMUM_RELEASE_AGE}/" "$YAML_FILE"
else
  echo "minimumReleaseAge: ${MINIMUM_RELEASE_AGE}" >> "$YAML_FILE"
fi

# pnpm 10 が読む側
RC_FILE="$CONFIG_DIR/rc"
if grep -q '^minimum-release-age=' "$RC_FILE" 2>/dev/null; then
  sed -i "s/^minimum-release-age=.*/minimum-release-age=${MINIMUM_RELEASE_AGE}/" "$RC_FILE"
else
  echo "minimum-release-age=${MINIMUM_RELEASE_AGE}" >> "$RC_FILE"
fi

echo "[session-start] pnpm minimumReleaseAge (global) = ${MINIMUM_RELEASE_AGE}"
