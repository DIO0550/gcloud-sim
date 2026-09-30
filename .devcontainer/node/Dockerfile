FROM ubuntu:24.04

# Node.js バージョン
ARG NODE_VERSION=24
ARG USERNAME=vscode

ENV NODE_VERSION=${NODE_VERSION}
ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8

# 基本パッケージとNode.jsのインストール
# fonts-noto-cjk: ubuntu:24.04 には CJK フォントが無く、playwright-cli での目視確認で
# 日本語が豆腐(□)になる。
# iptables / ipset / dnsutils / aggregate: init-firewall.sh が使う。
RUN apt-get update \
    && apt-get install -y \
        curl \
        ca-certificates \
        fonts-noto-cjk \
        gnupg \
        git \
        jq \
        tmux \
        vim-tiny \
        build-essential \
        file \
        wget \
        zip \
        unzip \
        iptables \
        ipset \
        dnsutils \
        aggregate \
    && useradd -m -s /bin/bash $USERNAME \
    && curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://gist.githubusercontent.com/DIO0550/16c39c3dc4682c7e2fd03c83d0f34b42/raw/install-playwright-deps.sh | bash

USER $USERNAME

SHELL ["/bin/bash", "-l", "-c"]
# NOTE: gist scripts are fetched from the repo owner's gists.
# TODO: Pin to specific gist revisions or vendor scripts locally for supply chain safety.
RUN curl -fsSL https://gist.githubusercontent.com/DIO0550/f5999a0512a369a232b7d4f824f0cc08/raw/install-gh-local.sh | bash
RUN curl -fsSL https://gist.githubusercontent.com/DIO0550/dcc09dc9d2dcefceb9b0cda183e7ef8e/raw/pnpm-safe-chain-setup.sh | sh
RUN curl -fsSL https://gist.githubusercontent.com/DIO0550/148b1392cf435ba3562da0d398bee442/raw/install-ai-tools.sh | bash
RUN curl -fsSL https://gist.githubusercontent.com/DIO0550/356434ec2b182f71d99dc0c467555ba5/raw/tmux-setup.sh | bash
RUN curl -fsSL https://gist.githubusercontent.com/DIO0550/6e5249a1b3682e702c875851756f0373/raw/install-playwright.sh | bash


# 上のスクリプトが入れるグローバルの pnpm は 10 系で、クールタイムの設定は rc 形式で書かれる。
# rc は pnpm 11 以降では pnpm config get で読めるだけで解決に効かないため、11 以降が読む
# config.yaml にも同じ値を書く（リポジトリ内は pnpm-workspace.yaml と packageManager が優先）。
RUN mkdir -p "$HOME/.config/pnpm" \
    && echo "minimumReleaseAge: 10080" >> "$HOME/.config/pnpm/config.yaml"

# 最終 USER は root に戻す。コンテナ本体のプロセス(entrypoint.sh)が iptables を
# 操作するため。開発セッションは devcontainer.json の remoteUser: vscode で動く。
USER root
WORKDIR /workspace
