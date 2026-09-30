#!/bin/bash
# =============================================================================
# entrypoint.sh
#
# コンテナ起動時に root として実行されるエントリポイント。
# 特権が必要な初期化（ネットワークファイアウォール）をここで済ませることで、
# 開発セッションのユーザー（vscode）に sudo 権限を一切付与せずに済むようにする。
# 初期化後は本来のコマンド（sleep infinity）へバトンタッチする。
#
# ファイアウォールの適用に失敗してもコンテナ自体は起動できるよう、警告を出して継続する
# （fail-open）。厳格に遮断したい場合は `|| echo ...` を削除する。
# =============================================================================
set -u

FW=/workspace/.devcontainer/init-firewall.sh
if [ -f "$FW" ]; then
  echo "[entrypoint] Applying network firewall..."
  bash "$FW" || echo "[entrypoint] WARN: init-firewall.sh failed"
fi

# --- 本来のコマンド（compose の command。既定では sleep infinity）を実行 ---
exec "$@"
