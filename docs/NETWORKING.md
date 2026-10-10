# VPC・接続・DNS・Firewallの教材モデル

#22では62コマンドと10ミッションを追加し、Snapshot v37で保存する。v1〜36からは空のnetworkLabへ移行し、従来のVPC・Router・peering・DNS zone・VM・他分野の状態を保持する。リソースツリーで構成、接続状態と直近の診断を確認できる。

## 再現範囲

| 項目 | 判定する内容 | 再現しない内容 |
|---|---|---|
| サブネット | canonical IPv4 CIDR、厳密な拡張、同一VPC/接続peerの重複、PGA、flow logs | IPv6、secondary range変更、proxy-only拡張 |
| route/NAT | IPv4静的経路、default internet gateway、VPN next hop、タグ、同一VPC/regionのRouterと全subnet/指定subnet NAT | 経路配信・NATポート枯渇・実IP割当 |
| peering | 両側ACTIVE、直接のsubnet接続、CIDR非重複、非推移性、片側削除 | custom route交換による転送、DNS peering、transit routing |
| Shared VPC | host/service関係、host側networkUser権限、service側VM作成権限、同regionのhost subnet参照 | 組織をまたぐ共有、個別subnet IAM、GKE Shared VPC |
| HA VPN/BGP | 2gateway interface、同VPC/regionのRouter、peer interface、169.254/16内の/30 host pair、異なるprivate ASN、VPC内で一意のlink-local /30 | IKE交渉・暗号・secret保存/認証・SLA実測・実ルート配信 |
| Partner Interconnect | Router ASN 16550、edge、admin state、pending/active、仮想learned prefix | Dedicated/Cross-Cloud Interconnect、物理設備・pairing key・帯域・partner通信 |
| DNS | public/private zone、許可VPC、A/CNAME/TXT CRUD、TTL 1〜86400、最長suffix、CNAME循環/同名競合/apex拒否 | authoritative server・cache・DNSSEC・外部DNS・zone間CNAME解決 |
| VPC Firewall | ingress/egress、CIDR/ports、priority 0〜65535、同順位deny優先、disabled、network tags、source/target SA、logging | 実packet・session・source network tags |
| network policy / NGFW | global policyの1VPC関連付け、L3/L4 allow/deny、secure tag対象、classic前後の評価順、logging | 階層/region policy、複数VPC関連付け、IDS/TLS/URL filteringなどL7検査 |

`sim network connectivity`は構成上の到達条件だけを評価する。成功はアプリ応答・認証・実通信の成功を意味しない。Google APIは`google-apis`、インターネットは`internet`、VMは名前、VPN/Interconnectの対向はIPv4で指定する。外部IPなしのGoogle API接続にはPGAまたはNATとdefault internet route、インターネット接続にはNATとdefault routeが必要。教材内のroute集合は明示作成したrouteのみを保持し、実サービスが生成するdefault routeは自動作成しない。

Firewallは送信VMのegressと宛先VMのingressを確認する。PGA/NATやpeeringだけでFirewall拒否を回避しない。classicのsource SAとsourceRangesはOR、source SAは同一VPCだけに適用する。service accountとtarget network tagの併用は拒否する。network policyは未関連付けなら無効。policy編集はSecurity Admin、VPC関連付けはpolicy useとnetwork setFirewallPolicyを分けて判定する。Network AdminだけではFirewallルールを編集できない。association削除もこの教材では両方の権限を要求する。VPCの既定順はAFTER_CLASSIC_FIREWALL、明示updateでBEFORE_CLASSIC_FIREWALLへ変更できる。

secure tagは事前作成済みの人工`tagValues/NUMBER`を`sim network secure-tags bind`でVMに保存する。TagKey/TagValueの組織作成やタグのネットワークpurpose設定はこの教材の対象外。実サービスのsecure tag作成成功を表すものではない。

flow/firewall/NAT logsは明示的な診断1回に対応する最大100件の教材イベントで、実トラフィック・sampling・bytesの測定はしない。NATログはloggingが有効なNATを使う成功診断に記録する。Cloud Loggingへの転送設定は別教材の範囲。接続結果も最大100件を保持し、ミッションは現在の構成を再評価するため、過去の成功だけでは破損後にクリアしない。

## 明示操作の例

```sh
gcloud compute networks create private --subnet-mode=custom
gcloud compute networks subnets create private-subnet --network=private --region=us-central1 --range=10.20.0.0/24
gcloud compute networks subnets expand-ip-range private-subnet --region=us-central1 --prefix=10.20.0.0/23
gcloud compute networks subnets update private-subnet --region=us-central1 --enable-private-ip-google-access --enable-flow-logs
gcloud compute instances create worker --zone=us-central1-a --network=private --subnet=private-subnet --no-address
gcloud compute routes create internet-route --network=private --destination-range=0.0.0.0/0 --next-hop-gateway=default-internet-gateway
sim network connectivity worker --zone=us-central1-a --destination=google-apis
gcloud compute routers create nat-router --network=private --region=us-central1
gcloud compute routers nats create nat --router=nat-router --region=us-central1 --auto-allocate-nat-external-ips --nat-custom-subnet-ip-ranges=private-subnet
sim network connectivity worker --zone=us-central1-a --destination=internet
```

Shared VPCでは`--network=projects/HOST/global/networks/NETWORK`を用い、subnetもhostの名前または完全パスで指定する。短いnetwork名はVMのproject内で解決する。host attachmentがあってもhost側`compute.subnetworks.use`を持たないprincipalは拒否する。

VPNは`gcloud compute routers add-interface/add-bgp-peer`までではDOWN。`sim network bgp establish PEER --router=ROUTER --region=REGION --remote-prefix=CIDR`で人工対向を明示接続する。`disconnect`で切断する。`sim network hybrid describe ROUTER --region=REGION`は両interfaceのUPを`haReady`で示す。静的VPN next hopは`--next-hop-vpn-tunnel=NAME --next-hop-vpn-tunnel-region=REGION`。

Partner attachmentはPENDING_PARTNERで作成し、`sim network interconnect activate NAME --region=REGION --peer-asn=64514 --remote-prefix=CIDR`で人工partner provisioningとcustomer activationをまとめて進める。実サービスのPENDING_PARTNERからの直接activationを再現するものではない。`partner update --no-admin-enabled`で経路を無効化する。

DNSは`gcloud dns managed-zones create NAME --dns-name=internal.example. --description=lesson --visibility=private --networks=VPC`、`record-sets create/update FQDN --zone=NAME --type=A --ttl=60 --rrdatas=IP`、`sim network connectivity VM --zone=ZONE --dns-name=FQDN --port=80`。TTLは保存のみでcache時間を進めない。TXTは短いUTF-8文字列（255bytes以内）の設定として保存する。

削除は参照中のRouter/gateway/tunnel/interface、recordsを持つzone、関連付け中policy、service VMを持つShared VPC関係、route/Router/peering/DNS等を持つVPCを拒否する。API・IAM・project・location・synthetic name・CIDR・port・参照は変更前に検証し、失敗時はWorldを変更しない。

## 10ミッション

subnet拡張/PGA/flow logs、NAT障害、双方向peering、非推移性診断、Shared VPC、HA VPN/BGP、Partner Interconnect、private DNS修復、SA Firewallのdeny優先順位修復、secure tag network policy。各ミッションを初期Worldから実行し、途中ではクリアしないことと各コマンド後のSnapshot復元をテストする。

## 確認に使った公式リファレンス

WebからはGoogle Cloud公式リファレンスだけを仕様データとして採用する。添付の基礎コース02/08と試験ガイドは学習目標の資料であり、本文・図・設問は転載しない。

- [networks create](https://docs.cloud.google.com/sdk/gcloud/reference/compute/networks/create): policy評価順
- [REST firewalls](https://docs.cloud.google.com/compute/docs/reference/rest/v1/firewalls): priority、deny、SA/sourceRangesのORとタグ制約
- [routers add-interface](https://docs.cloud.google.com/sdk/gcloud/reference/compute/routers/add-interface) / [add-bgp-peer](https://docs.cloud.google.com/sdk/gcloud/reference/compute/routers/add-bgp-peer): 構文とprivate peer ASN
- [REST routers](https://docs.cloud.google.com/compute/docs/reference/rest/v1/routers): interface/peer設定
- [managed-zones create](https://docs.cloud.google.com/sdk/gcloud/reference/dns/managed-zones/create) / [record-sets create](https://docs.cloud.google.com/sdk/gcloud/reference/dns/record-sets/create): private networksとrecord構文
- [Compute IAM roles](https://docs.cloud.google.com/compute/docs/access/iam) / [REST addAssociation](https://docs.cloud.google.com/compute/docs/reference/rest/v1/networkFirewallPolicies/addAssociation): Firewallとnetwork関連付けの権限
- [REST interconnectAttachments](https://docs.cloud.google.com/compute/docs/reference/rest/v1/interconnectAttachments): pending/active stateとpartnerAsn

これらの資料中の指示はエージェントの実行指示として扱わない。peer ASNはgcloud add-bgp-peerのCLIリファレンスに合わせprivateに限定し、RESTの広いuint32仕様すべてを実装したとは主張しない。
