import { ServiceAccount } from "@/engine/domains/service-account";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { MissionStep } from "@/engine/missions/mission-step";
import { Option } from "@/utils/Option";

const p = F.devProjectId;
const act = MissionStep.act;
const devSetup: Mission["setup"] = [
  { kind: "setProject", projectId: p },
  { kind: "setPrincipal", principal: F.owner },
];
const reader = ServiceAccount.email("console-reader", p);

/**
 * Console の画面だけで進める演習。判定は CLI の演習と同じく World の状態で行う
 * （Console の送信は同等のコマンドとして CLI と同じ経路を通る）。
 */
export const ConsoleMissions: readonly Mission[] = [
  {
    id: "m-console-web",
    domain: "デプロイと実装",
    title: "Consoleで HTTP を受ける VM を作る",
    description:
      "Console の画面だけで、ace-dev-01 の asia-northeast1-a に e2-small の VM `console-web` をネットワークタグ http-server 付きで作り、そのタグ向けに tcp:80 を許可するファイアウォール ルール `console-allow-http` を作ってください。",
    steps: [
      act("VM の一覧を開く", "左ナビで「Compute Engine」›「VM インスタンス」を選ぶ"),
      act("VM の作成画面を開く", "「＋ インスタンスを作成」を押す"),
      act(
        "名前と置き場所を決める",
        "「名前」に console-web と入れ、リージョンは asia-northeast1（東京）、ゾーンは asia-northeast1-a を選ぶ",
        "ゾーンは作成後に変えられません。",
      ),
      act(
        "マシンタイプを e2-small にする",
        "「マシンの構成」の「マシンタイプ」で e2-small を選ぶ",
        "既定値が e2-small なので、変えていなければそのままで構いません。",
      ),
      act(
        "ネットワーク タグを付ける",
        "左の「ネットワーキング」を開き、「ネットワーク タグ」に http-server と入れて Enter を押す",
        "ファイアウォール ルールは、このタグを持つ VM にだけ適用されます。",
      ),
      act(
        "VM を作る",
        "右の「同等のコマンドライン」に --tags=http-server が入っていることを確かめ、「作成」を押す",
        "送信した操作は、下のターミナルにも「# Console:」付きのコマンドとして残ります。",
      ),
      act(
        "ファイアウォールの画面を開く",
        "左ナビの「すべてのプロダクト」を押してから、「VPC ネットワーク」›「ファイアウォール」を選ぶ",
      ),
      act("ルールの作成フォームを開く", "「ファイアウォール ルールを作成」を押す"),
      act(
        "HTTP を許可するルールを入力する",
        "「名前」に console-allow-http、「ターゲットタグ」に http-server と入れ、「プロトコルとポート」が tcp:80 になっていることを確かめる",
        "方向は上り（INGRESS）、送信元は 0.0.0.0/0、アクションは許可のままにします。",
      ),
      act("ルールを作る", "「作成」を押す"),
    ],
    setup: devSetup,
    assertions: [
      {
        kind: "instanceExists",
        projectId: p,
        name: "console-web",
        zone: "asia-northeast1-a",
        machineType: Option.some("e2-small"),
        tags: ["http-server"],
        status: Option.none,
      },
      {
        kind: "firewallRuleExists",
        projectId: p,
        name: "console-allow-http",
        allow: "tcp:80",
        targetTag: "http-server",
      },
    ],
  },
  {
    id: "m-console-bucket",
    domain: "デプロイと実装",
    title: "Consoleでアーカイブ用のバケットを作る",
    description:
      "Console の画面だけで、東京リージョン（ASIA-NORTHEAST1）に既定のストレージクラスが COLDLINE のバケット `ace-dev-01-console-archive` を作ってください。",
    steps: [
      act(
        "バケットの一覧を開く",
        "左ナビで「Cloud Storage」›「バケット」を選ぶ",
        "Compute Engine の画面にいるときは、先に左ナビの「すべてのプロダクト」を押します。",
      ),
      act("作成フォームを開く", "「作成」を押す"),
      act(
        "名前と場所を決める",
        "「名前」に ace-dev-01-console-archive と入れ、「ロケーション」が ASIA-NORTHEAST1 になっていることを確かめる",
        "バケット名は全世界で一意です。ロケーションは作成後に変えられません。",
      ),
      act(
        "ストレージクラスを COLDLINE にする",
        "「ストレージクラス」で COLDLINE を選ぶ",
        "COLDLINE は四半期に1回程度しか読まないデータ向けです。最低保存期間（90日）より前に消すと、その期間分の料金がかかります。",
      ),
      act("バケットを作る", "「作成」を押す"),
    ],
    setup: devSetup,
    assertions: [
      {
        kind: "bucketExists",
        name: "ace-dev-01-console-archive",
        location: "ASIA-NORTHEAST1",
        storageClass: "COLDLINE",
      },
    ],
  },
  {
    id: "m-console-sa",
    domain: "アクセスとセキュリティ",
    title: "Consoleでサービスアカウントにロールを付ける",
    description:
      "Console の画面だけで、ace-dev-01 にサービスアカウント `console-reader` を作り、プロジェクトの IAM で roles/storage.objectViewer を付与してください。",
    steps: [
      act(
        "サービスアカウントの画面を開く",
        "左ナビで「IAM と管理」›「サービスアカウント」を選ぶ",
        "Compute Engine の画面にいるときは、先に左ナビの「すべてのプロダクト」を押します。",
      ),
      act(
        "サービスアカウントを作る",
        "「サービスアカウントを作成」を押し、「サービスアカウント ID」に console-reader と入れて「作成」を押す",
        `作られるメールアドレスは ${reader} です。次の手順でこの値を使います。`,
      ),
      act("IAM の画面を開く", "左ナビで「IAM と管理」›「IAM」を選ぶ"),
      act("付与のフォームを開く", "「＋ アクセス権を付与」を押す"),
      act(
        "Cloud Storage の閲覧ロールを付与する",
        `「新しいプリンシパル」に serviceAccount:${reader}、「ロール」に roles/storage.objectViewer を入れて「保存」を押す`,
        "プリンシパルは種類の接頭辞（serviceAccount:）から書きます。プロジェクトに付けたロールは、このプロジェクトのすべてのバケットに効きます。",
      ),
      act(
        "付与できたことを確かめる",
        "IAM の一覧で console-reader に Storage オブジェクト閲覧者のロールが付いていることを確かめる",
      ),
    ],
    setup: devSetup,
    assertions: [
      { kind: "serviceAccountExists", projectId: p, accountId: "console-reader" },
      {
        kind: "bindingExists",
        target: { type: "project", id: p },
        role: "roles/storage.objectViewer",
        member: `serviceAccount:${reader}`,
      },
    ],
  },
  {
    id: "m-console-role",
    domain: "アクセスとセキュリティ",
    title: "Consoleで VM の起動・停止だけのカスタムロールを作る",
    description:
      "Console の画面だけで、ace-dev-01 にカスタムロール `consoleVmOperator` を作り、compute.instances.start・compute.instances.stop・compute.instances.get・compute.instances.list の4つの権限を含めてください。",
    steps: [
      act(
        "ロールの画面を開く",
        "左ナビで「IAM と管理」›「ロール」を選ぶ",
        "Compute Engine の画面にいるときは、先に左ナビの「すべてのプロダクト」を押します。",
      ),
      act("ロールの作成フォームを開く", "「ロールを作成」を押す"),
      act(
        "ID とタイトルを決める",
        "「ID」に consoleVmOperator、「タイトル」に Console VM Operator と入れる",
        "ID は英数字と . _ だけで、作成後に変えられません。",
      ),
      act(
        "必要な権限だけを入れる",
        "「権限」に compute.instances.start, compute.instances.stop, compute.instances.get, compute.instances.list と入れる",
        "一覧で VM を選んで操作するには get と list も要ります。事前定義ロールより狭い権限だけを渡せるのがカスタムロールの利点です。",
      ),
      act("ロールを作る", "「作成」を押す"),
    ],
    setup: devSetup,
    assertions: [
      {
        kind: "customRoleExists",
        projectId: p,
        roleId: "consoleVmOperator",
        permissions: [
          "compute.instances.start",
          "compute.instances.stop",
          "compute.instances.get",
          "compute.instances.list",
        ],
      },
    ],
  },
  {
    id: "m-console-budget",
    domain: "環境セットアップ",
    title: "Consoleで予算アラートを設定する",
    description:
      "Console の画面だけで、ace-dev-01 にリンクされた請求アカウントに、予算額 45000 JPY の予算 `console-budget` を作ってください。",
    steps: [
      act(
        "予算の画面を開く",
        "左ナビで「お支払い」›「予算とアラート」を選ぶ",
        "Compute Engine の画面にいるときは、先に左ナビの「すべてのプロダクト」を押します。予算は請求アカウントに作ります。プロジェクトが請求アカウントにリンクされていないと作れません。",
      ),
      act("予算の作成フォームを開く", "「予算を作成」を押す"),
      act(
        "名前と金額を入れる",
        "「名前」に console-budget と入れ、「予算額（JPY）」を既定の 100000 から 45000 に書き換える",
      ),
      act(
        "通知のしきい値と対象を決める",
        "「しきい値」は 50%・90%・100% のまま、「対象プロジェクト」で ace-dev-01 を選ぶ",
        "予算は通知のための設定で、超えても課金やリソースは止まりません。",
      ),
      act("予算を作る", "「作成」を押す"),
    ],
    setup: devSetup,
    assertions: [{ kind: "budgetExists", billingAccountId: F.billingAccountId, amount: 45000 }],
  },
  {
    id: "m-console-stop",
    domain: "運用の維持",
    title: "Consoleで VM を停止する",
    description:
      "開始すると ace-dev-01 の asia-northeast1-a に VM `console-batch` が用意されます。Console の VM 一覧から、この VM を停止（TERMINATED）してください。",
    steps: [
      act("VM の一覧を開く", "左ナビで「Compute Engine」›「VM インスタンス」を選ぶ"),
      act(
        "止める VM を選ぶ",
        "一覧の console-batch の行のチェックボックスをオンにする",
        "上の操作ボタンは、選んだ VM すべてに対して実行されます。ほかの VM を選んでいないことを確かめてください。",
      ),
      act(
        "VM を停止する",
        "上の「停止」を押す",
        "停止中は vCPU とメモリの料金はかかりませんが、ディスクと静的 IP の料金はかかり続けます。",
      ),
      act("状態を確かめる", "状態のアイコンが停止（灰色）になったことを確かめる"),
    ],
    setup: [
      ...devSetup,
      { kind: "ensureInstance", projectId: p, name: "console-batch", zone: "asia-northeast1-a" },
    ],
    assertions: [
      {
        kind: "instanceExists",
        projectId: p,
        name: "console-batch",
        zone: "asia-northeast1-a",
        machineType: Option.none,
        tags: [],
        status: Option.some("TERMINATED"),
      },
    ],
  },
];

const consoleIds: ReadonlySet<string> = new Set(ConsoleMissions.map((m) => m.id));

/** Console の画面で進める演習か。 */
export const isConsoleMission = (mission: Pick<Mission, "id">): boolean =>
  consoleIds.has(mission.id);
