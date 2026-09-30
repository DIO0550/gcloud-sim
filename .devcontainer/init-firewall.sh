#!/bin/bash
# =============================================================================
# init-firewall.sh
#
# コンテナからの外向き通信（egress）を許可リスト方式で制限するファイアウォール。
# DNS / localhost / 確立済みコネクション / ホストネットワークを許可したうえで、
# 明示的に許可したドメイン（GitHub / npm / Google Fonts / Anthropic など）以外への
# 通信をすべて DROP します。
#
# コンテナ起動時に entrypoint.sh から root で実行されます。
# 許可先を追加したいときは、下部の ALLOWED_DOMAINS 配列に追記してください。
#
# イメージのビルド時はこのルールが無いので、apt や npm のインストールはここに
# 書かなくても通ります。ここに要るのは「起動後に行う通信」だけです。
# =============================================================================
set -euo pipefail
IFS=$'\n\t'

# 許可するドメイン（HTTPS 等の外向き通信を許可する宛先）。
# プロジェクトで新たに必要になった通信先はここに追記する。
ALLOWED_DOMAINS=(
  # --- npm / pnpm ---
  "registry.npmjs.org"
  # --- Aikido safe-chain（install のたびにマルウェア一覧を取りに行く）---
  "malware-list.aikido.dev"
  # --- GitHub Copilot CLI ---
  "api.githubcopilot.com"
  # --- GitHub（raw / gist は Fastly のため meta の範囲外。個別に許可）---
  "raw.githubusercontent.com"
  "gist.githubusercontent.com"
  "objects.githubusercontent.com"
  "codeload.github.com"
  # --- Google Fonts（next/font/google がビルド時にフォントを取りに行く）---
  "fonts.googleapis.com"
  "fonts.gstatic.com"
  # --- Anthropic / Claude Code（AI ツール）---
  "api.anthropic.com"
  "statsig.anthropic.com"
)

echo "==> Flushing existing firewall rules..."
iptables -F
iptables -X
iptables -t nat -F
iptables -t nat -X
iptables -t mangle -F
iptables -t mangle -X
ipset destroy allowed-domains 2>/dev/null || true

# --- 最初に DNS / localhost を許可（以降のルールで名前解決できるように）---
echo "==> Allowing DNS and localhost..."
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A INPUT  -p udp --sport 53 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT
iptables -A INPUT  -p tcp --sport 53 -m state --state ESTABLISHED -j ACCEPT
iptables -A INPUT  -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT

# --- 許可ドメイン用の ipset を作成 ---
ipset create allowed-domains hash:net

# --- GitHub の公開 IP レンジ（github.com / api.github.com / git など）を許可 ---
echo "==> Fetching GitHub IP ranges..."
gh_ranges=$(curl -s --max-time 20 https://api.github.com/meta || true)
if [ -n "$gh_ranges" ] && echo "$gh_ranges" | jq -e '.web and .api and .git' >/dev/null 2>&1; then
  while read -r cidr; do
    [ -z "$cidr" ] && continue
    echo "    + GitHub range $cidr"
    ipset add allowed-domains "$cidr" 2>/dev/null || true
  done < <(echo "$gh_ranges" | jq -r '(.web + .api + .git + .hooks)[]' | aggregate -q 2>/dev/null || echo "$gh_ranges" | jq -r '(.web + .api + .git + .hooks)[]')
else
  echo "    ! Failed to fetch GitHub meta; skipping GitHub ranges."
fi

# --- 許可ドメインを名前解決して ipset に登録 ---
echo "==> Resolving allowed domains..."
for domain in "${ALLOWED_DOMAINS[@]}"; do
  ips=$(dig +short "$domain" A | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' || true)
  if [ -z "$ips" ]; then
    echo "    ! Could not resolve $domain (skipping)"
    continue
  fi
  while read -r ip; do
    [ -z "$ip" ] && continue
    echo "    + $domain -> $ip"
    ipset add allowed-domains "$ip" 2>/dev/null || true
  done <<< "$ips"
done

# --- ホスト（Docker のデフォルトゲートウェイ）側ネットワークを許可 ---
# ポートフォワードやホストとの通信を維持するため。
HOST_IP=$(ip route | awk '/default/ {print $3; exit}')
if [ -n "${HOST_IP:-}" ]; then
  HOST_NETWORK=$(echo "$HOST_IP" | sed 's/\.[0-9]*$/.0\/24/')
  echo "==> Allowing host network $HOST_NETWORK"
  iptables -A INPUT  -s "$HOST_NETWORK" -j ACCEPT
  iptables -A OUTPUT -d "$HOST_NETWORK" -j ACCEPT
fi

# --- デフォルトポリシーを DROP に（許可されていない通信を遮断）---
echo "==> Setting default policies to DROP..."
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT DROP

# --- 確立済み / 関連コネクションを許可 ---
iptables -A INPUT  -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# --- 許可ドメイン（ipset）宛の通信を許可 ---
iptables -A OUTPUT -m set --match-set allowed-domains dst -j ACCEPT

# --- 動作確認 ---
echo "==> Verifying firewall rules..."
if curl -s --max-time 5 https://example.com >/dev/null 2>&1; then
  echo "    ! ERROR: 許可していない example.com へ到達できました。ファイアウォールが機能していません。"
  exit 1
else
  echo "    OK: 許可外ドメイン (example.com) への通信はブロックされています。"
fi

if curl -s --max-time 20 https://api.github.com/zen >/dev/null 2>&1; then
  echo "    OK: 許可済みドメイン (api.github.com) への通信は成功しました。"
else
  echo "    ! WARNING: api.github.com へ到達できませんでした。許可リストを確認してください。"
fi

echo "==> Firewall configured."
