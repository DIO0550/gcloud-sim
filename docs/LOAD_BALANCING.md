# Load Balancing教材モデル（Issue #16）

現在の操作手順は公開ミッションと[対応コマンド](COMMANDS.md)を参照してください。アプリ独自の操作に依存した旧手順は削除しました。以下は残しているCLI・ドメインモデルの仕様です。過去のミッション数・実装時点の記録は現在の公開演習数を示しません。

ロードバランサを部品の作成から接続、障害診断、後片付けまで学ぶための独自演習です。実Cloud API、ネットワーク、課金、任意プログラムの実行は行いません。コマンドはWorldの構成を変更し、probeは保存された構成とアプリ応答状態を評価します。添付資料の本文、図、設問は転載していません。

## 対応する構成

| 構成 | frontendからbackendへの接続 | スコープ・プロトコル | Tier |
| --- | --- | --- | --- |
| グローバル外部Application LB | forwarding rule → HTTP/HTTPS proxy → URL map → backend service → MIGまたはzonal NEG。backend bucketへの経路も対応 | global / EXTERNAL_MANAGED、frontend TCP、backend HTTP/HTTPS | PREMIUM |
| リージョン外部passthrough Network LB | forwarding rule → backend service → MIG。クライアントの送信元IPを保持 | 同一region / EXTERNAL、TCP | PREMIUM / STANDARD |
| リージョン内部Application LB | 内部IPのforwarding rule → HTTP proxy → URL map → backend service → 同じVPC・regionのMIGまたはzonal NEG | region / INTERNAL_MANAGED、backend HTTP/HTTPS | PREMIUM |

Application LBのfrontendは1ポート、passthroughは最大5つのポートまたは範囲です。内部frontendは通常のsubnetに配置し、同じVPC・regionに`REGIONAL_MANAGED_PROXY` / `ACTIVE`のproxy-only subnetが必要です。proxy-only subnetは/26以上の大きさで、VM、NEG、frontend IPの配置先には使えません。ACTIVEとBACKUPはそれぞれ1つまでです。内部probeは同じVPC・regionの通常subnet内のクライアントに限定します。

各backend serviceには同じスコープのhealth checkを1つ指定します。MIGとNEGを同じbackend serviceへ混在させる構成は拒否します。MIGのApplication LBはnamed port、NEGは個別endpointのポートを使います。MIGはUTILIZATION、passthroughはCONNECTION、NEGはRATEと正の`--max-rate-per-endpoint`を指定できます。容量値・timeout・CDN設定は保存しますが、負荷分散の比率や時間経過は実測しません。

## CLI・IAM・参照

正式な`health-checks create http|https|tcp NAME`構文とglobal/regionalスコープに対応します。既存の`create NAME --http|--https|--tcp`は互換用の別名として残します。HTTP/HTTPSは`--request-path`、全形式は`--port`、`--check-interval`、`--timeout`を指定できます。TCPにrequest pathを指定することや、未対応の`--use-serving-port`は拒否します。

`backend-services add-backend/remove-backend/get-health/update`、MIGの`set-named-ports/get-named-ports/list-instances`、URL map/proxy/certificate/NEG/backend bucketのcreate/list/describe/deleteに対応します。URL mapの`add-path-matcher`はliteral hostまたは`*`、完全一致パスまたは末尾`/*`を扱い、host完全一致と最長パスを優先します。matcher内のdefault serviceへのfallbackも評価します。

名前には現在projectと指定スコープを使います。完全なcompute URLまたは`projects/PROJECT/...`参照も使えますが、別project、種別違い、場所違い、存在しない接続先は拒否します。`--global`と`--region`を同時に指定できません。global/regionalリソースのlistは`--global`または`--regions=us-central1,us-east1`で絞り込み、無指定では両スコープのlist権限が必要です。NEGのlistは現在projectのzonal集合です。

| 操作 | 権限の判定例 |
| --- | --- |
| global / regional backend service | `compute.backendServices.*` / `compute.regionBackendServices.*` |
| global / regional forwarding rule | `compute.globalForwardingRules.*` / `compute.forwardingRules.*` |
| global / regional health check | `compute.healthChecks.*` / `compute.regionHealthChecks.*` |
| global / regional HTTP proxy・URL map | スコープに応じて`targetHttpProxies` / `regionTargetHttpProxies`、`urlMaps` / `regionUrlMaps` |
| backend/HC/map/proxy/addressの参照 | 対応する`use`、HCは`useReadOnly`を追加検証 |
| NEG endpoint追加・削除 | `compute.networkEndpointGroups.attachNetworkEndpoints` / `detachNetworkEndpoints`とVMの`use` |
| 証明書の教材用activation | `compute.sslCertificates.get`と`compute.targetHttpsProxies.setSslCertificates` |
| serve / probe | VMの`setMetadata` / forwarding ruleと参照先のread権限 |

Compute APIの有効化とEffectivePermissionsによる拒否を変更前に検証します。viewerによる変更、API未有効、参照権限不足、誤設定はWorldを部分変更しません。全コマンド・フラグは[COMMANDS.md](COMMANDS.md)を参照してください。

## 明示的な対応範囲

IPv4と上記3構成に限定しています。UDP/IPv6、target pool、proxy Network LB、classic/リージョン外部Application LB、内部HTTPS、self-managed鍵、Certificate Manager、serverless/internet/hybrid NEG、unmanaged group、Shared VPC/cross-project、private/signed backend bucket、高度なURL rewrite/header/redirect、任意のアプリ実行、DNS解決、実scheduler、HA、通信遅延、キャッシュ、継続的health probeは対象外です。named portは1つの名前につき1ポートです。未対応フラグ・組合せは成功と表示しません。一般コマンドの既存CRUDをCloud全機能の互換実装とは扱いません。

## 技術的な参照先

実装の構成・スコープ・制約は次のGoogle Cloud公式ドキュメントと照合しています。教材の省略範囲は上記のとおりです。

- [Backend services overview](https://cloud.google.com/load-balancing/docs/backend-service)
- [Health checks overview](https://cloud.google.com/load-balancing/docs/health-check-concepts)
- [Load balancing firewall rules](https://cloud.google.com/load-balancing/docs/firewall-rules)
- [Proxy-only subnets](https://cloud.google.com/load-balancing/docs/proxy-only-subnets)
- [Google-managed SSL certificates](https://cloud.google.com/load-balancing/docs/ssl-certificates/google-managed-certs)
- [Zonal NEGs](https://cloud.google.com/load-balancing/docs/negs/zonal-neg-concepts)
- [Global forwarding rules insert](https://cloud.google.com/compute/docs/reference/rest/v1/globalForwardingRules/insert)
- [NEG attachNetworkEndpoints](https://cloud.google.com/compute/docs/reference/rest/v1/networkEndpointGroups/attachNetworkEndpoints)
- [HTTPS proxy setSslCertificates](https://cloud.google.com/compute/docs/reference/rest/v1/targetHttpsProxies/setSslCertificates)
