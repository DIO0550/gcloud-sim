# Compute・ディスク・VM管理の教材モデル

Issue #21 の6項目を、既存VM/MIG/ディスク操作と42追加コマンド、独立した15ミッションで扱います。通信・実課金・ゲストプログラム・GPU/TPU計算・実際のHAや容量保証は行いません。結果はWorldの構成、仮想データ、段階更新/修復状態から評価します。

## 配置と設定

| 対象 | 対応範囲と検証 |
|---|---|
| カスタムVM | N1/N2。`--machine-type=n2-custom-4-12288`、または`--custom-vm-type=n2 --custom-cpu=4 --custom-memory=12GB`。CPU数・256 MiB単位・系列ごとのメモリ比率を検証。extended memory/shared-core customは拒否 |
| 可用性・Spot | maintenance-policy、restart-on-failure、termination-action。Spot/preemptibleはTERMINATEかつ自動再起動なし。`sim compute instances preempt`で明示中断。STOPはチェックポイント保持、DELETEはVMとブートデータを削除 |
| GPU | `type=nvidia-tesla-t4,count=1`だけ。N1、us-central1-a/b/c、TERMINATE。E2等との不整合・他GPU/個数/場所・MIGテンプレートへのGPU指定は拒否 |
| TPU VM | Cloud TPU API形式のv2-8（us-central1-b/c）・v3-8（us-central1-a/b）、tpu-vm-base。明示した同一プロジェクトのSA、actAs、VPC参照。create/list/describe/start/stop/delete。学習用の従来API構成で、推論・ソフトウェアインストールや予約確保は行わない |
| regional PD | pd-balanced/pd-ssd、同じregionの異なる2 replica-zones。`attach-disk --disk-scope=regional`は複製ゾーンのVMへ1台rw接続。HA/フェイルオーバー・複数writer・regional標準PD/Hyperdisk HAは対象外 |
| Hyperdisk | zonal hyperdisk-balanced。4 GiB〜64 TiB、サイズ依存のIOPS、IOPS依存のthroughputを検証。接続先は教材カタログのc3-standard-4だけ。provisioned性能と実測性能は区別し、性能更新時刻の実クラウド制限は再現しない |

## バックアップと復旧

`sim compute disks write/read`は最大4,096文字の仮想データで、ゲストのファイルシステムやI/Oではありません。snapshotは作成時の内容をコピーし、元の変更と独立して保存します。`disks create --source-snapshot`はコピーより小さい容量を拒否し、別ディスクへデータを復元します。regional snapshotは`disks snapshot --region`で作ります。

カスタムimageは明示したディスクの場所、またはsnapshotから作成します。ブート元VMは停止が必要です。create/list/describe/deleteを持ち、`instances create --image=NAME`と`disks create --image=NAME`で再利用できます。元の削除後もimageのデータを保持します。image-familyによる最新版解決、OS変換、任意imageのアップロードは行いません。

snapshot-scheduleはregion、1〜24時間の間隔、1〜365日の保持、00〜23時の開始時刻を構成し、拡張ディスクへ接続します。`sim compute snapshot-schedules run`で明示実行し、2回目以降は仮想時計の間隔を検証して期限切れコピーを除去します。開始時刻は設定値として保存しますが、カレンダーによる自動実行は行いません。`sim compute time advance --seconds=N`は共有の仮想時計を進めるだけで、ジョブ/修復/配送を自動実行しません。既存の通常PDには、snapshotから別ディスクを作ることでscheduleを付けられます。

## ID・OS管理

明示したユーザー管理SAにはactAsが必要です。既存演習の暗黙Compute既定IDは従来fixtureを維持し、そのIDのactAs・自動Editor付与は再現しません。`set-service-account`は停止中だけで、cloud-platform/storage-ro/storage-rwの単一scopeを設定します。`runtime-check --operation=storage-read|storage-write`はRUNNING、実行SAのIAM、OAuth scopeを別々に検証します。cloud-platform自体は権限を付与しません。実Storage操作やトークン発行は行いません。

`os-login-check`はenable-oslogin、VM状態、閲覧/OS Login、ユーザー管理SAのactAsを検証し、`--admin`はosAdminLoginも必要です。パスワード・SSHキー認証・sudo実行は行いません。OS Loginの設定はVM metadataがproject metadataに優先します。

VM ManagerはOS Config APIとIAMを要求し、enable-osconfig=TRUEのRUNNING VMについて固定Debian inventoryを表示します。OS policy assignmentは単一VMに対するsecurity-updatesだけで、PENDINGから明示`sim ... apply`でSUCCEEDEDへ進めます。実パッケージ更新・任意スクリプト・patch schedulerは実行しません。

## MIGの更新・修復・オートスケーリング

テンプレートは作成後不変です。`set-instance-template`は将来の作成元を変更し、既存メンバーは更新しません。`rolling-action start-update --version=template=NAME`はdesired/applied版とpendingを保存します。`sim ... advance-update`はsurge+unavailableの台数を1バッチとして、同じ名前のVMを再作成します。実際の一時追加VM・並行更新・canary・regional更新順・ゲスト起動時間は再現しません。旧テンプレートはappliedに残る間、削除を拒否します。

autohealingはhealth-check参照とinitial-delayを設定し、`sim ... fail-instance --instance=NAME`で明示障害、共有仮想時計で待機、`sim ... autoheal`でテンプレートから再作成します。対象名は`list-instances`で確認します（演習ヒントの`@member`を置換）。実health probe・自動コントローラーは動かしません。無関係なVMを修復対象にできません。

CPUオートスケーリングは目標使用率・min/max・cooldownを検証します。明示sampleとelapsed-secondsから`ceil(current × CPU / target)`を上下限へ丸め、待機中は現台数を返します。`evaluate-autoscaling`は推奨を返すだけで、`resize`で実際の教材VMを増減します。LB負荷・custom metric・schedule scaling・実CPU測定は対象外です。1グループ最大100台。更新/障害中のresize、参照中テンプレート/health-check/ディスク/SA/VPCの削除を拒否します。

## 保存・表示・教材

Snapshot v36。v1〜v35からは空のCompute追加状態を補完し、既存リソース/他分野を保持します。現行Snapshotは場所・参照・性能・設定・版を検証します。追加リソースはツリー/プロパティと場所・project付きdescribeを持ち、helpとTab補完へ登録します。

15演習はcustom、Spot復旧、GPU、TPU、regional PD、Hyperdisk、snapshot復元、image再利用、snapshot schedule、OS Login、VM Manager、IAM/scope、rolling update、autohealing、CPU autoscalingです。初期状態・途中未完了・保存復元を各正解経路で確認し、誤配置・不十分な権限・途中版・早すぎる修復等を別途テストします。

## カタログの根拠

2026-10-10、Google Cloud公式資料を確認した限定カタログです。実クラウド全体の配置可能性や在庫を保証しません。既存の汎用リージョン/ゾーンカタログの全サービス対応を主張するものではありません。

- [カスタムVMのCPU/メモリ制約](https://docs.cloud.google.com/compute/docs/instances/creating-instance-with-custom-machine-type)
- [N1+T4の対応ゾーン](https://docs.cloud.google.com/compute/docs/regions-zones/gpu-regions-zones)
- [TPU v2/v3の対応ゾーン](https://docs.cloud.google.com/tpu/docs/regions-zones)
- [Hyperdisk Balancedの容量/IOPS/throughput・C3接続](https://docs.cloud.google.com/compute/docs/disks/hd-types/hyperdisk-balanced)

本教材は独自の構成・障害演習です。添付PDFの本文・図・設問は転載していません。
