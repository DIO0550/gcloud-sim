# Load Balancing教材モデル（Issue #16）

ロードバランサを部品の作成から接続、障害診断、後片付けまで学ぶための独自演習です。実Cloud API、ネットワーク、課金、任意プログラムの実行は行いません。コマンドはWorldの構成を変更し、probeは保存された構成とアプリ応答状態を評価します。添付資料の本文、図、設問は転載していません。

## 対応する構成

| 構成 | frontendからbackendへの接続 | スコープ・プロトコル | Tier |
| --- | --- | --- | --- |
| グローバル外部Application LB | forwarding rule → HTTP/HTTPS proxy → URL map → backend service → MIGまたはzonal NEG。backend bucketへの経路も対応 | global / EXTERNAL_MANAGED、frontend TCP、backend HTTP/HTTPS | PREMIUM |
| リージョン外部passthrough Network LB | forwarding rule → backend service → MIG。クライアントの送信元IPを保持 | 同一region / EXTERNAL、TCP | PREMIUM / STANDARD |
| リージョン内部Application LB | 内部IPのforwarding rule → HTTP proxy → URL map → backend service → 同じVPC・regionのMIGまたはzonal NEG | region / INTERNAL_MANAGED、backend HTTP/HTTPS | PREMIUM |

Application LBのfrontendは1ポート、passthroughは最大5つのポートまたは範囲です。内部frontendは通常のsubnetに配置し、同じVPC・regionに`REGIONAL_MANAGED_PROXY` / `ACTIVE`のproxy-only subnetが必要です。proxy-only subnetは/26以上の大きさで、VM、NEG、frontend IPの配置先には使えません。ACTIVEとBACKUPはそれぞれ1つまでです。内部probeは同じVPC・regionの通常subnet内のクライアントに限定します。

各backend serviceには同じスコープのhealth checkを1つ指定します。MIGとNEGを同じbackend serviceへ混在させる構成は拒否します。MIGのApplication LBはnamed port、NEGは個別endpointのポートを使います。MIGはUTILIZATION、passthroughはCONNECTION、NEGはRATEと正の`--max-rate-per-endpoint`を指定できます。容量値・timeout・CDN設定は保存しますが、負荷分散の比率や時間経過は実測しません。

## ヘルスチェックと疎通を分けて診断する

VMがRUNNINGであるだけでは応答しません。`sim load-balancing serve`で明示したポート、プロトコル、パス、ステータスを使います。startup-scriptなどのメタデータは実行しません。HTTP/HTTPSのhealth checkは設定ポート・プロトコル・request pathと200応答を、TCPはlistenerへの接続を判定します。`--status-code=0`はlistenerなしを表します。

| 構成 | HC用に許可するIPv4送信元 | データ通信に必要な許可 |
| --- | --- | --- |
| グローバル外部Application LB | `35.191.0.0/16`, `130.211.0.0/22` | GFEの同じ範囲からbackendのserving port |
| リージョン外部passthrough | `35.191.0.0/16`, `209.85.204.0/22` | 元のクライアントIPからfrontendと同じbackendポート |
| リージョン内部Application LB | `35.191.0.0/16` | proxy-only subnetの範囲からbackendのserving port |

Firewallはnetwork、INGRESS、enabled、target tag、宛先、プロトコル、ポート、source CIDR、priorityを評価します。より狭いDENYや同一priorityのDENYも許可判定に含みます。範囲全体が許可されていることを確かめるため、一部のHC送信元だけを許可しても成功しません。

```sh
gcloud compute backend-services get-health web-backend --global
sim load-balancing probe web-front --global --host=example.test --path=/ --port=80 --min-healthy=2
sim load-balancing probe internal-front --region=us-central1 --source-network=internal-net --source-region=us-central1 --source-ip=10.20.0.10 --min-healthy=2
```

`get-health`にはHC由来のhealthState/healthReasonsと、named port・アプリ由来のtrafficReady/trafficReasonsを別々に表示します。例えば固定80番のHCが成功してもnamed portが8080なら通信できません。TCP HCが成功してもHTTPアプリの500応答は成功扱いしません。probeは接続chain、healthy数、アプリ応答可能数、選択先、CDN構成を返します。複数台の応答条件は`--min-healthy`で指定します。probeはread-onlyでWorldを変更しません。

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

## 最小の外部Application LB

初期Worldの`ace-dev-01`、`us-central1-a`、default VPCで実行します。

```sh
gcloud compute instance-templates create web-template --network=default --tags=web-app
gcloud compute instance-groups managed create web-group --zone=us-central1-a --template=web-template --size=2
gcloud compute instance-groups managed set-named-ports web-group --zone=us-central1-a --named-ports=http:80
gcloud compute health-checks create http web-hc --global --port=80
gcloud compute backend-services create web-backend --global --protocol=HTTP --load-balancing-scheme=EXTERNAL_MANAGED --port-name=http --health-checks=web-hc
gcloud compute backend-services add-backend web-backend --global --instance-group=web-group --instance-group-zone=us-central1-a
gcloud compute url-maps create web-map --global --default-service=web-backend
gcloud compute target-http-proxies create web-proxy --global --url-map=web-map
gcloud compute addresses create web-ip --global --network-tier=PREMIUM
gcloud compute forwarding-rules create web-front --global --load-balancing-scheme=EXTERNAL_MANAGED --target-http-proxy=web-proxy --ports=80 --address=web-ip
gcloud compute firewall-rules create web-health --network=default --allow=tcp:80 --source-ranges=35.191.0.0/16,130.211.0.0/22 --target-tags=web-app
sim load-balancing serve web-group --zone=us-central1-a --port=80 --protocol=HTTP
sim load-balancing probe web-front --global --min-healthy=2
```

MIGの1台だけを変更するにはserveに`--instance=VM_NAME`を付けます。停止・誤ポート・誤パス・500応答・FW削除などを行い、HCと疎通の失敗理由を比較できます。

## HTTPS・NEG・CDNと保存

Google-managed証明書はglobal、literal DNS名、proxyごと1〜15枚です。作成直後はPROVISIONINGで、証明書を参照するHTTPS proxyと443番frontendを構成してから`sim load-balancing activate-certificate NAME --global`を実行すると教材用のACTIVEに遷移します。実際のDNS所有確認、証明書発行、鍵処理は行いません。probeはACTIVEとhost一致を検証します。

NEGはzonal `GCE_VM_IP_PORT`、同じzone/network/subnetのVMのprimary IPv4に限定します。endpointのport省略時はdefault-portを使い、1回のupdateで1 endpointを追加/削除します。VM・ポート・IPの参照や重複を検証し、利用中VMの削除を拒否します。

CDNはグローバル外部Application LBのbackend service/backend bucketに設定でき、`CACHE_ALL_STATIC` / `USE_ORIGIN_HEADERS` / `FORCE_CACHE_ALL`を保存します。backend bucketのprobeはCloud Storage bucketの存在、`allUsers`への`roles/storage.objectViewer`、public access preventionを確認します。オブジェクト本文、キャッシュヒット、速度、料金、署名URLの配送は再現しません。

World、CLI、リソースツリー、プロパティ、Snapshot v31に接続構成を保存します。v1〜v30の保存データは新しいLB集合を補完して読み込めます。旧形式の単独backend/forwarding ruleを勝手に接続し直したりhealthyにしたりせず、legacy未接続をprobeで明示します。不正な参照、混在backend、重複proxy role、内部VPC不一致、破損した構成はimportも拒否します。

## 7つの独自ミッション

| ID | 学習目標 | 完了条件の要点 |
| --- | --- | --- |
| m-lb-001 | 外部Application LB | global PREMIUM、HTTP:80、named port、FWと2台の応答 |
| m-lb-002 | 外部passthroughの選定 | regional TCP、STANDARD、HCと元クライアントのFWを別々に許可 |
| m-lb-003 | 内部Application LB | 通常subnetとproxy-only subnet、HC/data FW、内部クライアントから2台の応答 |
| m-lb-004 | URL routingとNEG | default経路はMIG、example.testの/api/*は2つのzonal endpoint |
| m-lb-005 | HTTPSとCDN | ACTIVE証明書、443 frontend、HTTP backend、USE_ORIGIN_HEADERS |
| m-lb-006 | 静的配信の選定 | 公開backend bucket、CDN CACHE_ALL_STATIC、bucket経路 |
| m-lb-007 | 依存順の片付け | 2台の応答をcheckpointへ記録した後、教材の接続構成・VMを削除 |

各ミッションは初期Worldから開始でき、途中の状態や誤設定では完了しません。片付けミッションは最初から空の状態では完了せず、`sim load-balancing checkpoint cleanup-front --global`が自分の教材chainとMIGのVM名を記録します。削除はfront → proxy → map → backend → HC/IP → MIG/template → FWの順で実施します。参照中の資源は削除できません。無関係の資源や似た名前の資源はcheckpointに含めません。

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
