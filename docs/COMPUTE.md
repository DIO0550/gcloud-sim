# Compute・ディスク・VM管理の教材モデル

現在の操作手順は公開ミッションと[対応コマンド](COMMANDS.md)を参照してください。アプリ独自の操作に依存した旧手順は削除しました。以下は残しているCLI・ドメインモデルの仕様です。過去のミッション数・実装時点の記録は現在の公開演習数を示しません。

Issue #21 の6項目を、既存VM/MIG/ディスク操作と42追加コマンド、独立した15ミッションで扱います。通信・実課金・ゲストプログラム・GPU/TPU計算・実際のHAや容量保証は行いません。結果はWorldの構成、仮想データ、段階更新/修復状態から評価します。

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
