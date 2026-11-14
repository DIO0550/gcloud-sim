import { type LbRequest, lbFind, lbProbe } from "@/engine/domains/load-balancing/graph";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { MissionStep } from "@/engine/missions/mission-step";
export type LbLesson =
  | "application"
  | "passthrough"
  | "internal"
  | "neg"
  | "tls"
  | "bucket"
  | "cleanup";
export type LbAssertion = Readonly<{ kind: "lbLesson"; lesson: LbLesson }>;
const setup = [
  { kind: "setPrincipal", principal: F.owner },
  { kind: "setProject", projectId: F.devProjectId },
] as const;
const healthFirewall = (line: string) =>
  MissionStep.run(
    "ヘルスチェックの送信元からのTCP:80を許可する",
    line,
    "これが無いと、VMが動いていてもバックエンドはHEALTHYになりません。",
  );
const serve = (target: string, what = "2台のVMにアプリを80番で応答させる") =>
  MissionStep.run(
    what,
    `sim load-balancing serve ${target} --zone=us-central1-a --port=80 --protocol=HTTP`,
    "教材上でVMにHTTP応答を用意します。VMを起動しただけでは応答しません。",
  );
export const applicationSteps = (p = "web"): readonly MissionStep[] => [
  MissionStep.run(
    `タグ${p}-appを付けたインスタンステンプレートを作る`,
    `gcloud compute instance-templates create ${p}-template --tags=${p}-app --network=default`,
  ),
  MissionStep.run(
    "テンプレートから2台のマネージドインスタンスグループを作る",
    `gcloud compute instance-groups managed create ${p}-group --zone=us-central1-a --template=${p}-template --size=2`,
  ),
  MissionStep.run(
    "名前付きポートhttpを80番に対応させる",
    `gcloud compute instance-groups managed set-named-ports ${p}-group --zone=us-central1-a --named-ports=http:80`,
    "バックエンドサービスの--port-name=httpが、この対応から転送先のポートを決めます。",
  ),
  MissionStep.run(
    "80番を確かめるHTTPヘルスチェックを作る",
    `gcloud compute health-checks create http ${p}-hc --global --port=80`,
  ),
  MissionStep.run(
    "グローバルのHTTPバックエンドサービスを作る",
    `gcloud compute backend-services create ${p}-backend --global --protocol=HTTP --load-balancing-scheme=EXTERNAL_MANAGED --health-checks=${p}-hc --port-name=http`,
    "EXTERNAL_MANAGEDはグローバル外部Application LBのスキームです。",
  ),
  MissionStep.run(
    "MIGをバックエンドとして追加する",
    `gcloud compute backend-services add-backend ${p}-backend --global --instance-group=${p}-group --instance-group-zone=us-central1-a`,
  ),
  MissionStep.run(
    "すべてのリクエストをバックエンドへ送るURLマップを作る",
    `gcloud compute url-maps create ${p}-map --global --default-service=${p}-backend`,
  ),
  MissionStep.run(
    "URLマップを使うHTTPプロキシを作る",
    `gcloud compute target-http-proxies create ${p}-proxy --global --url-map=${p}-map`,
  ),
  MissionStep.run(
    "PREMIUM階層のグローバル外部IPを予約する",
    `gcloud compute addresses create ${p}-ip --global --network-tier=PREMIUM`,
  ),
  MissionStep.run(
    "予約したIPの80番でフロントエンドを作る",
    `gcloud compute forwarding-rules create ${p}-front --global --load-balancing-scheme=EXTERNAL_MANAGED --target-http-proxy=${p}-proxy --ports=80 --address=${p}-ip`,
  ),
  healthFirewall(
    `gcloud compute firewall-rules create ${p}-health --network=default --allow=tcp:80 --source-ranges=35.191.0.0/16,130.211.0.0/22 --target-tags=${p}-app`,
  ),
  serve(`${p}-group`),
];
export const applicationLesson = (p = "web"): readonly string[] =>
  MissionStep.lines(applicationSteps(p));
export const passthroughSteps: readonly MissionStep[] = [
  MissionStep.run(
    "タグnlb-appを付けたインスタンステンプレートを作る",
    "gcloud compute instance-templates create nlb-template --network=default --tags=nlb-app",
  ),
  MissionStep.run(
    "テンプレートから2台のマネージドインスタンスグループを作る",
    "gcloud compute instance-groups managed create nlb-group --zone=us-central1-a --template=nlb-template --size=2",
  ),
  MissionStep.run(
    "us-central1にTCPヘルスチェックを作る",
    "gcloud compute health-checks create tcp nlb-hc --region=us-central1 --port=80",
  ),
  MissionStep.run(
    "リージョンのTCPバックエンドサービスを作る",
    "gcloud compute backend-services create nlb-backend --region=us-central1 --protocol=TCP --load-balancing-scheme=EXTERNAL --health-checks=nlb-hc --health-checks-region=us-central1",
    "EXTERNALはパススルーのネットワークLBです。プロキシを通らないので送信元IPが保たれます。",
  ),
  MissionStep.run(
    "MIGをバックエンドとして追加する",
    "gcloud compute backend-services add-backend nlb-backend --region=us-central1 --instance-group=nlb-group --instance-group-zone=us-central1-a",
  ),
  MissionStep.run(
    "STANDARD階層のリージョン外部IPを予約する",
    "gcloud compute addresses create nlb-ip --region=us-central1 --network-tier=STANDARD",
  ),
  MissionStep.run(
    "バックエンドサービスへ直接つなぐフロントエンドを作る",
    "gcloud compute forwarding-rules create nlb-front --region=us-central1 --load-balancing-scheme=EXTERNAL --backend-service=nlb-backend --ip-protocol=TCP --ports=80 --address=nlb-ip --network-tier=STANDARD",
    "パススルーLBではURLマップもプロキシも使いません。",
  ),
  healthFirewall(
    "gcloud compute firewall-rules create nlb-health --network=default --allow=tcp:80 --source-ranges=35.191.0.0/16,209.85.204.0/22 --target-tags=nlb-app",
  ),
  MissionStep.run(
    "クライアント198.51.100.0/24からのTCP:80を許可する",
    "gcloud compute firewall-rules create nlb-clients --network=default --allow=tcp:80 --source-ranges=198.51.100.0/24 --target-tags=nlb-app",
    "クライアントの送信元IPがそのままVMに届くため、その範囲もファイアウォールで許可します。",
  ),
  serve("nlb-group"),
];
export const passthroughLesson: readonly string[] = MissionStep.lines(passthroughSteps);
export const internalSteps: readonly MissionStep[] = [
  MissionStep.run(
    "カスタムモードのinternal-netを作る",
    "gcloud compute networks create internal-net --subnet-mode=custom",
  ),
  MissionStep.run(
    "VMとフロントエンドを置くinternal-dataサブネットを作る",
    "gcloud compute networks subnets create internal-data --network=internal-net --region=us-central1 --range=10.20.0.0/24",
  ),
  MissionStep.run(
    "プロキシ専用サブネットを作る",
    "gcloud compute networks subnets create internal-proxy --network=internal-net --region=us-central1 --range=10.21.0.0/23 --purpose=REGIONAL_MANAGED_PROXY --role=ACTIVE",
    "LBのプロキシが使う範囲で、VMは置けません。",
  ),
  MissionStep.run(
    "外部IPなしでinternal-dataに置くテンプレートを作る",
    "gcloud compute instance-templates create internal-template --network=internal-net --subnet=internal-data --tags=internal-app --no-address",
  ),
  MissionStep.run(
    "テンプレートから2台のマネージドインスタンスグループを作る",
    "gcloud compute instance-groups managed create internal-group --zone=us-central1-a --template=internal-template --size=2",
  ),
  MissionStep.run(
    "名前付きポートhttpを80番に対応させる",
    "gcloud compute instance-groups managed set-named-ports internal-group --zone=us-central1-a --named-ports=http:80",
  ),
  MissionStep.run(
    "us-central1にHTTPヘルスチェックを作る",
    "gcloud compute health-checks create http internal-hc --region=us-central1 --port=80",
  ),
  MissionStep.run(
    "内部Application LBのバックエンドサービスを作る",
    "gcloud compute backend-services create internal-backend --region=us-central1 --protocol=HTTP --load-balancing-scheme=INTERNAL_MANAGED --port-name=http --health-checks=internal-hc --health-checks-region=us-central1",
  ),
  MissionStep.run(
    "MIGをバックエンドとして追加する",
    "gcloud compute backend-services add-backend internal-backend --region=us-central1 --instance-group=internal-group --instance-group-zone=us-central1-a",
  ),
  MissionStep.run(
    "リージョンのURLマップを作る",
    "gcloud compute url-maps create internal-map --region=us-central1 --default-service=internal-backend",
  ),
  MissionStep.run(
    "リージョンのHTTPプロキシを作る",
    "gcloud compute target-http-proxies create internal-http --region=us-central1 --url-map=internal-map --url-map-region=us-central1",
  ),
  MissionStep.run(
    "内部IP 10.20.0.50を予約する",
    "gcloud compute addresses create internal-ip --region=us-central1 --subnet=internal-data --addresses=10.20.0.50",
  ),
  MissionStep.run(
    "内部IPの80番でフロントエンドを作る",
    "gcloud compute forwarding-rules create internal-front --region=us-central1 --load-balancing-scheme=INTERNAL_MANAGED --network=internal-net --subnet=internal-data --address=internal-ip --ports=80 --target-http-proxy=internal-http --target-http-proxy-region=us-central1",
  ),
  healthFirewall(
    "gcloud compute firewall-rules create internal-health --network=internal-net --allow=tcp:80 --source-ranges=35.191.0.0/16 --target-tags=internal-app",
  ),
  MissionStep.run(
    "プロキシ専用サブネットからのTCP:80を許可する",
    "gcloud compute firewall-rules create internal-traffic --network=internal-net --allow=tcp:80 --source-ranges=10.21.0.0/23 --target-tags=internal-app",
    "VMに届く通信の送信元はクライアントではなくプロキシです。ヘルスチェックの許可だけでは疎通しません。",
  ),
  serve("internal-group"),
];
export const internalLesson: readonly string[] = MissionStep.lines(internalSteps);
export const negSteps: readonly MissionStep[] = [
  ...applicationSteps("neg"),
  MissionStep.run(
    "API用のneg-api-aを作る",
    "gcloud compute instances create neg-api-a --zone=us-central1-a --tags=neg-app",
  ),
  MissionStep.run(
    "API用のneg-api-bを作る",
    "gcloud compute instances create neg-api-b --zone=us-central1-a --tags=neg-app",
  ),
  serve("neg-api-a", "neg-api-aにアプリを80番で応答させる"),
  serve("neg-api-b", "neg-api-bにアプリを80番で応答させる"),
  MissionStep.run(
    "GCE_VM_IP_PORTのゾーンNEGを作る",
    "gcloud compute network-endpoint-groups create neg-endpoints --zone=us-central1-a --network=default --subnet=default --network-endpoint-type=GCE_VM_IP_PORT --default-port=80",
    "エンドポイントはVMとポートの組で登録します。名前付きポートは使いません。",
  ),
  MissionStep.run(
    "neg-api-aの80番をNEGに登録する",
    "gcloud compute network-endpoint-groups update neg-endpoints --zone=us-central1-a --add-endpoint=instance=neg-api-a,port=80",
  ),
  MissionStep.run(
    "neg-api-bの80番をNEGに登録する",
    "gcloud compute network-endpoint-groups update neg-endpoints --zone=us-central1-a --add-endpoint=instance=neg-api-b,port=80",
  ),
  MissionStep.run(
    "API用のバックエンドサービスを作る",
    "gcloud compute backend-services create neg-api --global --protocol=HTTP --load-balancing-scheme=EXTERNAL_MANAGED --health-checks=neg-hc",
    "ヘルスチェックはMIG用に作ったneg-hcを使い回します。",
  ),
  MissionStep.run(
    "NEGをエンドポイントあたり50 RPSで追加する",
    "gcloud compute backend-services add-backend neg-api --global --network-endpoint-group=neg-endpoints --network-endpoint-group-zone=us-central1-a --balancing-mode=RATE --max-rate-per-endpoint=50",
    "RATEモードでは--max-rate-per-endpointで容量を決めます。",
  ),
  MissionStep.run(
    "/api/*だけをneg-apiへ送るパスルールを足す",
    "gcloud compute url-maps add-path-matcher neg-map --global --path-matcher-name=api --default-service=neg-backend --new-hosts=example.test --path-rules='/api/*=neg-api'",
    "example.testの/api/*はNEGへ、それ以外はMIGのneg-backendへ送られます。",
  ),
];
export const negLesson: readonly string[] = MissionStep.lines(negSteps);
export const tlsSteps: readonly MissionStep[] = [
  ...applicationSteps("tls"),
  MissionStep.run(
    "バックエンドでCloud CDNを有効にする",
    "gcloud compute backend-services update tls-backend --global --enable-cdn --cache-mode=USE_ORIGIN_HEADERS",
    "USE_ORIGIN_HEADERSは、オリジンが返すCache-Controlに従ってキャッシュします。",
  ),
  MissionStep.run(
    "example.testのGoogleマネージド証明書を作る",
    "gcloud compute ssl-certificates create tls-cert --global --domains=example.test",
    "ドメインの検証が済むまではACTIVEになりません。",
  ),
  MissionStep.run(
    "証明書を付けたHTTPSプロキシを作る",
    "gcloud compute target-https-proxies create tls-https --global --url-map=tls-map --ssl-certificates=tls-cert",
  ),
  MissionStep.run(
    "HTTPのフロントエンドを削除する",
    "gcloud compute forwarding-rules delete tls-front --global --quiet",
    "同じ名前とIPを、443番のフロントエンドで使い直すためです。",
  ),
  MissionStep.run(
    "同じIPの443番でHTTPSのフロントエンドを作る",
    "gcloud compute forwarding-rules create tls-front --global --load-balancing-scheme=EXTERNAL_MANAGED --target-https-proxy=tls-https --ports=443 --address=tls-ip",
  ),
  MissionStep.run(
    "証明書をACTIVEにする",
    "sim load-balancing activate-certificate tls-cert --global",
    "教材上でドメインの検証が済んだことにします。",
  ),
];
export const tlsLesson: readonly string[] = MissionStep.lines(tlsSteps);
export const bucketSteps: readonly MissionStep[] = [
  MissionStep.run(
    "静的コンテンツ用のバケットを作る",
    "gcloud storage buckets create gs://lb-static-data --location=us-central1",
  ),
  MissionStep.run(
    "バケットのオブジェクトを誰でも読めるようにする",
    "gcloud storage buckets add-iam-policy-binding gs://lb-static-data --member=allUsers --role=roles/storage.objectViewer",
    "LBは匿名でバケットを読むため、公開閲覧が必要です。",
  ),
  MissionStep.run(
    "バケットを参照するバックエンドバケットをCDN付きで作る",
    "gcloud compute backend-buckets create static-backend --global --gcs-bucket-name=lb-static-data --enable-cdn --cache-mode=CACHE_ALL_STATIC",
    "CACHE_ALL_STATICは静的なコンテンツを自動でキャッシュします。",
  ),
  MissionStep.run(
    "すべてをバックエンドバケットへ送るURLマップを作る",
    "gcloud compute url-maps create static-map --global --default-backend-bucket=static-backend",
  ),
  MissionStep.run(
    "URLマップを使うHTTPプロキシを作る",
    "gcloud compute target-http-proxies create static-proxy --global --url-map=static-map",
  ),
  MissionStep.run(
    "80番でフロントエンドを作る",
    "gcloud compute forwarding-rules create static-front --global --load-balancing-scheme=EXTERNAL_MANAGED --target-http-proxy=static-proxy --ports=80 --network-tier=PREMIUM",
    "--addressを省いたので、エフェメラルな外部IPが割り当てられます。",
  ),
];
export const bucketLesson: readonly string[] = MissionStep.lines(bucketSteps);
const cleanupBuild = applicationSteps("cleanup");
const cleanupTeardown: readonly MissionStep[] = [
  MissionStep.run(
    "動いている構成を記録する",
    "sim load-balancing checkpoint cleanup-front --global",
    "ここで記録したリソースが、片付けで消す対象になります。",
  ),
  MissionStep.run(
    "フロントエンドを削除する",
    "gcloud compute forwarding-rules delete cleanup-front --global --quiet",
    "ほかのリソースから参照されているものは消せないので、上流から順に消します。",
  ),
  MissionStep.run(
    "HTTPプロキシを削除する",
    "gcloud compute target-http-proxies delete cleanup-proxy --global --quiet",
  ),
  MissionStep.run(
    "URLマップを削除する",
    "gcloud compute url-maps delete cleanup-map --global --quiet",
  ),
  MissionStep.run(
    "バックエンドサービスを削除する",
    "gcloud compute backend-services delete cleanup-backend --global --quiet",
  ),
  MissionStep.run(
    "ヘルスチェックを削除する",
    "gcloud compute health-checks delete cleanup-hc --global --quiet",
  ),
  MissionStep.run(
    "予約した外部IPを解放する",
    "gcloud compute addresses delete cleanup-ip --global --quiet",
  ),
  MissionStep.run(
    "マネージドインスタンスグループを削除する",
    "gcloud compute instance-groups managed delete cleanup-group --zone=us-central1-a --quiet",
    "グループのVMも一緒に削除されます。",
  ),
  MissionStep.run(
    "インスタンステンプレートを削除する",
    "gcloud compute instance-templates delete cleanup-template --quiet",
  ),
  MissionStep.run(
    "ヘルスチェック用のファイアウォールルールを削除する",
    "gcloud compute firewall-rules delete cleanup-health --quiet",
  ),
];
export const cleanupSteps: readonly MissionStep[] = [...cleanupBuild, ...cleanupTeardown];
export const cleanupLesson: readonly string[] = MissionStep.lines(cleanupSteps);
/** バックエンドの状態とフロントエンドからの到達を確かめる手順（プレースホルダ付き）。 */
const verify = (lesson: LbLesson): readonly MissionStep[] => {
  const regional = lesson === "passthrough" || lesson === "internal";
  const scope = regional ? "--region=us-central1" : "--global";
  const source =
    lesson === "internal"
      ? " --source-network=internal-net --source-region=us-central1 --source-ip=10.20.0.10"
      : "";
  const prefix = {
    application: "web",
    passthrough: "nlb",
    internal: "internal",
    neg: "neg",
    tls: "tls",
    bucket: "static",
    cleanup: "cleanup",
  }[lesson];
  const health = MissionStep.run(
    "バックエンドの2台がHEALTHYか確かめる",
    `gcloud compute backend-services get-health BACKEND ${scope}`,
    `BACKENDにはバックエンドサービス名（${prefix}-backend など）を入れます。リージョンのLBは--region=us-central1、グローバルのLBは--globalを付けます。`,
  );
  const probe = MissionStep.run(
    "フロントエンドから2台に届くか確かめる",
    `sim load-balancing probe FRONT ${scope} --min-healthy=2${source}`,
    `FRONTには転送ルール名（${prefix}-front）を入れます。内部LBでは--source-network=internal-net --source-region=us-central1 --source-ip=10.20.0.10を付け、同じVPCの10.20.0.10から試します。`,
  );
  return lesson === "bucket" ? [probe] : [health, probe];
};
const definitions: readonly Readonly<{
  lesson: LbLesson;
  title: string;
  description: string;
  steps: readonly MissionStep[];
}>[] = [
  {
    lesson: "application",
    title: "外部Application LBをつなぎ、2台の応答を確認する",
    description:
      "web-frontをグローバルEXTERNAL_MANAGED・PREMIUMで構築します。HTTP:80、named port http:80、HC用FWと2つのアプリ応答をそろえます。VM起動だけではhealthyになりません。",
    steps: [...applicationSteps(), ...verify("application")],
  },
  {
    lesson: "passthrough",
    title: "送信元IPを保つpassthrough LBを構成する",
    description:
      "nlb-frontをus-central1のEXTERNAL TCP:80・STANDARDで構築します。2台のHCと198.51.100.0/24のクライアント許可が必要です。URL map/proxyは使いません。",
    steps: [...passthroughSteps, ...verify("passthrough")],
  },
  {
    lesson: "internal",
    title: "内部Application LBのproxy subnetとFWを分ける",
    description:
      "internal-frontをus-central1のINTERNAL_MANAGEDで構築します。frontendはinternal-data、proxy-onlyは10.21.0.0/23です。HC許可だけでは疎通しません。同じVPC/regionの10.20.0.10から2台に通信できる状態にします。",
    steps: [...internalSteps, ...verify("internal")],
  },
  {
    lesson: "neg",
    title: "URLのパスでzonal NEGへ振り分ける",
    description:
      "neg-frontの通常パスはMIG、example.test/api/itemsはneg-apiの2つのGCE_VM_IP_PORTエンドポイントへ送ります。NEGはus-central1-a、RATE capacityは50です。named portとendpoint portの役割を区別します。",
    steps: [...negSteps, ...verify("neg")],
  },
  {
    lesson: "tls",
    title: "HTTPS frontendとCDN構成を確認する",
    description:
      "tls-frontはHTTPS:443、証明書はexample.testのACTIVEです。2台のHTTP backendを維持し、CDNをUSE_ORIGIN_HEADERSで有効にします。証明書は明示的な教材評価で有効化します。",
    steps: [...tlsSteps, ...verify("tls")],
  },
  {
    lesson: "bucket",
    title: "静的コンテンツをbackend bucketとCDNへ送る",
    description:
      "static-frontはグローバルPREMIUMの外部Application LBです。公開閲覧を許可したlb-static-dataをstatic-backendで参照し、CACHE_ALL_STATICのCDN構成を有効にします。実キャッシュやオブジェクト配信は再現しません。",
    steps: [...bucketSteps, ...verify("bucket")],
  },
  {
    lesson: "cleanup",
    title: "動作するLBを記録し、依存順に片付ける",
    description:
      "cleanup-frontを2台の応答まで構築しcheckpointを記録します。その後front→proxy→map→backend→HC/IP→MIG/template→FWの順で自分の教材資源を削除します。最初から空のWorldでは完了しません。",
    steps: [...cleanupBuild, ...verify("cleanup"), ...cleanupTeardown],
  },
];
export const LoadBalancingMissions: readonly Mission[] = definitions.map((d, i) => ({
  id: `m-lb-00${i + 1}`,
  domain: i === 6 ? "運用の維持" : "計画と構成",
  title: d.title,
  description: d.description,
  setup,
  steps: d.steps,
  assertions: [{ kind: "lbLesson", lesson: d.lesson }],
}));
const request: LbRequest = {
  host: "example.test",
  path: "/",
  port: 80,
  sourceIp: "198.51.100.10",
  network: "",
  region: "",
  minHealthy: 2,
};
export const lbSatisfied = (world: World, lesson: LbLesson): boolean => {
  if (lesson === "cleanup") {
    const raw = world.projectMetadata.find((m) => m.projectId === F.devProjectId)?.items[
      "sim-lb-cleanup/cleanup-front"
    ];
    if (raw === undefined) {
      return false;
    }
    try {
      const names: unknown = JSON.parse(raw);
      const required = [
        "cleanup-front",
        "cleanup-proxy",
        "cleanup-map",
        "cleanup-backend",
        "cleanup-hc",
        "cleanup-ip",
        "cleanup-group",
        "cleanup-template",
        "cleanup-health",
      ];
      if (!Array.isArray(names) || !required.every((n) => names.includes(n))) {
        return false;
      }
      const remaining = [
        ...world.lbResources,
        ...world.forwardingRules,
        ...world.backendServices,
        ...world.healthChecks,
        ...world.addresses,
        ...world.instanceGroups,
        ...world.instanceTemplates,
        ...world.firewallRules,
        ...world.instances,
      ].filter((r) => r.projectId === F.devProjectId);
      return !remaining.some((r) => names.includes(r.name));
    } catch {
      return false;
    }
  }
  const prefix = {
    application: "web",
    passthrough: "nlb",
    internal: "internal",
    neg: "neg",
    tls: "tls",
    bucket: "static",
  }[lesson];
  const f = world.forwardingRules.find(
    (f) => f.projectId === F.devProjectId && f.name === `${prefix}-front`,
  );
  if (f === undefined) {
    return false;
  }
  const test =
    lesson === "internal"
      ? { ...request, network: "internal-net", region: "us-central1", sourceIp: "10.20.0.10" }
      : request;
  let evaluationRequest = test;
  if (lesson === "tls") {
    evaluationRequest = { ...test, port: 443 };
  }
  if (lesson === "bucket") {
    evaluationRequest = { ...test, minHealthy: 1 };
  }
  const evaluated = lbProbe(world, f, evaluationRequest);
  if (!evaluated.success) {
    return false;
  }
  if (lesson === "passthrough") {
    return (
      f.scope.kind === "region" &&
      f.scope.region === "us-central1" &&
      f.loadBalancingScheme === "EXTERNAL" &&
      f.networkTier === "STANDARD" &&
      f.backendService === "nlb-backend" &&
      f.portRange === "80"
    );
  }
  if (lesson === "internal") {
    return (
      f.scope.kind === "region" &&
      f.scope.region === "us-central1" &&
      f.loadBalancingScheme === "INTERNAL_MANAGED" &&
      f.network === "internal-net" &&
      f.subnet === "internal-data" &&
      f.ipAddress === "10.20.0.50" &&
      !lbProbe(world, f, request).success
    );
  }
  if (
    f.scope.kind !== "global" ||
    f.loadBalancingScheme !== "EXTERNAL_MANAGED" ||
    f.networkTier !== "PREMIUM"
  ) {
    return false;
  }
  if (lesson === "neg") {
    const api = lbProbe(world, f, { ...request, path: "/api/items" });
    return (
      evaluated.chain.includes("neg-backend") &&
      api.success &&
      api.chain.includes("neg-api") &&
      world.backendServices.some(
        (b) =>
          b.projectId === F.devProjectId &&
          b.name === "neg-api" &&
          b.backends.length === 1 &&
          b.backends.every((r) => lbFind(world, r)?.kind === "networkEndpointGroups") &&
          b.backendOptions?.[0]?.maxRatePerEndpoint === 50,
      )
    );
  }
  if (lesson === "tls") {
    return (
      f.portRange === "443" &&
      evaluated.cdn &&
      world.backendServices.some(
        (b) =>
          b.projectId === F.devProjectId &&
          b.name === "tls-backend" &&
          b.cacheMode === "USE_ORIGIN_HEADERS",
      )
    );
  }
  if (lesson === "bucket") {
    const bucket = world.lbResources.find(
      (b) =>
        b.projectId === F.devProjectId &&
        b.kind === "backendBuckets" &&
        b.name === "static-backend",
    );
    return (
      bucket?.kind === "backendBuckets" &&
      bucket.bucketName === "lb-static-data" &&
      bucket.cacheMode === "CACHE_ALL_STATIC" &&
      bucket.enableCdn &&
      evaluated.selected === "lb-static-data"
    );
  }
  return evaluated.chain.includes("web-backend") && f.portRange === "80";
};
