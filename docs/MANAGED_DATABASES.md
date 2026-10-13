# Firestore・Spanner・Bigtable・Memorystoreの教材

現在の操作手順は公開ミッションと[対応コマンド](COMMANDS.md)を参照してください。アプリ独自の操作に依存した旧手順は削除しました。以下は残しているCLI・ドメインモデルの仕様です。過去のミッション数・実装時点の記録は現在の公開演習数を示しません。

Issue #19の6項目を14件の独立ミッションで学びます。カテゴリ→ミッション→手順の画面から選択できます。インスタンスを作るだけではクリアせず、World内の実データと照会・複製・期限・復旧の結果を評価します。

追加の状態はWorldの`managedDatabases`に保存します。Firestoreのdatabase/documentとRedisの接続先は、Functionsの教材と共通の`serverlessLab`を使います。Snapshot v34はv1–v33を読めます。旧保存のFirestore/Redis・Functions・SQLデータを保持し、新しい索引・コピー・キャッシュデータ等は空で補います。旧RedisのtierはBASICとして扱います。

## 独立ミッション

| 分野 | ミッション | クリア条件 |
|---|---|---|
| Firestore | ドキュメント更新 | `nam5`のNative DB、count=3/version=2、更新後のquery |
| Firestore | 複合索引 | tenant/total索引、aの注文20→10の結果、bを含めない |
| Firestore | 復元 | sourceの削除、コピーから新規DBへ復元、beforeのquery |
| Spanner | 構成・容量 | `nam3`/2000 PU、主キーのある表、committedのquery |
| Spanner | 復元 | sourceの行削除、新規DBへのrestore、beforeのquery |
| Bigtable | 列・GC | 2版のcell、保持時間/版数の評価、最新値のread |
| Bigtable | 複製 | 別zoneのcluster、明示advance、secondaryからの最新read |
| Bigtable | 復元 | backup後に元rowを削除、新しいtableへのrestore/read |
| Redis | TTL | SET/GET、仮想10秒経過、期限後のcache miss |
| Redis | HA | STANDARD_HAのfailover、INCR=2、GET |
| Functions | Firestore | runtime SAのviewer権限、設定先DBの実document read |
| Functions | Redis | 同地域connector/Redis/VPC、固定ハンドラの2回のINCR |
| 検索比較 | Spanner vector | id=3の等価検索とcosine距離でid=1,2になる順位の違い |
| 選定 | ワークロード | モバイルdocument→Firestore、時系列→Bigtable、cache→Redis、広域transaction→Spanner |

全手順はミッションのヒントに収録しています。サービスを有効化し、教材用ownerで進めます。初期World・途中状態・誤設定ではクリアしません。保存から復元した配列でも操作が続くことを検証します。
