import { cacheOf } from "@/engine/domains/managed-databases/cache";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { MissionStep } from "@/engine/missions/mission-step";

export type ManagedDatabaseLesson =
  | "document"
  | "index"
  | "firestoreRestore"
  | "spanner"
  | "spannerRestore"
  | "bigtableGc"
  | "bigtableReplication"
  | "bigtableRestore"
  | "redisTtl"
  | "redisHa"
  | "functionsFirestore"
  | "functionsRedis"
  | "vector"
  | "selection";
export type ManagedDatabaseAssertion = Readonly<{
  kind: "managedDatabaseLesson";
  lesson: ManagedDatabaseLesson;
}>;
const ManagedDatabasePreludeSteps = [
  MissionStep.run(
    "データベース関連のAPIをまとめて有効にする",
    "gcloud services enable firestore.googleapis.com spanner.googleapis.com bigtable.googleapis.com bigtableadmin.googleapis.com redis.googleapis.com compute.googleapis.com vpcaccess.googleapis.com cloudfunctions.googleapis.com run.googleapis.com sqladmin.googleapis.com",
  ),
];
export const ManagedDatabasePrelude = MissionStep.lines(ManagedDatabasePreludeSteps);
const fs = (db: string, location = "us-central1") =>
  `gcloud firestore databases create ${db} --location=${location} --type=firestore-native`;
const doc = (db: string, path: string, value: object) =>
  `sim firestore documents write ${path} --database=${db} --data='${JSON.stringify(value)}'`;
const fsQuery = (db: string) => `sim firestore query orders --database=${db}`;
const spanner = (i: string, config = "regional-us-central1") =>
  `gcloud spanner instances create ${i} --config=${config} --processing-units=1000`;
const spDb = (i: string) =>
  `gcloud spanner databases create app --instance=${i} --ddl='CREATE TABLE orders (id INT64 NOT NULL, note STRING(MAX)) PRIMARY KEY (id)'`;
const spSql = (i: string, sql: string, db = "app") =>
  `sim spanner execute ${db} --instance=${i} --sql="${sql}"`;
const spSeed = (i: string) => [
  MissionStep.run("単一リージョンのSpannerインスタンスを作る", spanner(i)),
  MissionStep.run("主キー付きのordersテーブルを持つappデータベースを作る", spDb(i)),
  MissionStep.run("注文を1行書き込む", spSql(i, "INSERT INTO orders VALUES (1, 'before')")),
];
const bt = (i: string) =>
  `gcloud bigtable instances create ${i} --cluster=primary --cluster-zone=us-central1-a --cluster-num-nodes=1`;
const table = (i: string) =>
  `sim bigtable tables create readings --instance=${i} --cluster=primary --column-families=data`;
const cell = (i: string, value: string, timestamp = "2026-10-01T10:00:00Z") =>
  `sim bigtable rows write sensor-1 --instance=${i} --cluster=primary --table=readings --family=data --qualifier=value --value=${value} --timestamp=${timestamp}`;
const btRead = (i: string, table = "readings", cluster = "primary") =>
  `sim bigtable rows read sensor-1 --instance=${i} --cluster=${cluster} --table=${table}`;
/** Bigtable のインスタンスとテーブルを用意する 2 手順。 */
const btSeed = (i: string) => [
  MissionStep.run("1ノードのクラスタprimaryでBigtableインスタンスを作る", bt(i)),
  MissionStep.run("列ファミリーdataを持つreadingsテーブルを作る", table(i)),
];
const redis = (i: string, tier = "BASIC") =>
  `gcloud redis instances create ${i} --region=us-central1 --network=default --size=1 --tier=${tier}`;
const cache = (i: string, operation: string, flags = "") =>
  `sim redis cache ${operation} visits --instance=${i} --region=us-central1 --network=default ${flags}`;
const p = F.devProjectId;
const sa = `database-worker@${p}.iam.gserviceaccount.com`;
const worker = [
  MissionStep.run(
    "関数を動かすサービスアカウントを作る",
    "gcloud iam service-accounts create database-worker",
  ),
  MissionStep.run(
    "自分にそのSAを関数へ付ける権限を与える",
    `gcloud iam service-accounts add-iam-policy-binding ${sa} --member=user:${F.owner} --role=roles/iam.serviceAccountUser`,
    "関数に実行SAを指定する人には、そのSAに対するiam.serviceAccountUserが要ります。",
  ),
];
const fn = (n: string, flags: string) =>
  `gcloud functions deploy ${n} --region=us-central1 --runtime=nodejs22 --service-account=${sa} --trigger-http ${flags}`;
const ManagedDatabaseSteps: Readonly<Record<ManagedDatabaseLesson, readonly MissionStep[]>> = {
  document: [
    MissionStep.run(
      "複数リージョンnam5にNative modeのFirestoreを作る",
      fs("doc-app", "nam5"),
      "ロケーションは作成後に変えられません。",
    ),
    MissionStep.run("orders/oneにcount=1の文書を書く", doc("doc-app", "orders/one", { count: 1 })),
    MissionStep.run(
      "版1を前提にcountを2増やす",
      "sim firestore documents increment orders/one --database=doc-app --field=count --amount=2 --expected-version=1",
      "--expected-versionが今の版と違えば更新は拒否されます。",
    ),
    MissionStep.run("ordersを照会してcountが3になったことを確かめる", fsQuery("doc-app")),
  ],
  index: [
    MissionStep.run("index-appデータベースを作る", fs("index-app")),
    MissionStep.run(
      "テナントaの注文（total 10）を書く",
      doc("index-app", "orders/one", { tenant: "a", total: 10 }),
    ),
    MissionStep.run(
      "テナントaの注文（total 20）を書く",
      doc("index-app", "orders/two", { tenant: "a", total: 20 }),
    ),
    MissionStep.run(
      "テナントbの注文（total 30）を書く",
      doc("index-app", "orders/three", { tenant: "b", total: 30 }),
    ),
    MissionStep.run(
      "tenantとtotalの複合索引を作る",
      "sim firestore indexes create tenant-total --database=index-app --collection=orders --fields=tenant,total",
      "等価条件と別フィールドの並べ替えを組み合わせる照会には複合索引が要ります。",
    ),
    MissionStep.run(
      "テナントaの注文をtotalの大きい順に2件照会する",
      `sim firestore query orders --database=index-app --where-field=tenant --equals='"a"' --order-by=total --descending --limit=2`,
      "テナントbの注文は結果に入りません。",
    ),
  ],
  firestoreRestore: [
    MissionStep.run("復元元のsource-docsデータベースを作る", fs("source-docs")),
    MissionStep.run("orders/oneに文書を書く", doc("source-docs", "orders/one", { note: "before" })),
    MissionStep.run(
      "データベースのバックアップを取る",
      "sim firestore backups create docs-copy --database=source-docs",
      "索引はバックアップに含まれません。",
    ),
    MissionStep.run(
      "誤って文書を削除する",
      "sim firestore documents delete orders/one --database=source-docs",
    ),
    MissionStep.run(
      "バックアップを新しいデータベースへ復元する",
      "sim firestore backups restore docs-copy --destination-database=recovered-docs",
      "復元先は既存のデータベースではなく、新しく作るrecovered-docsです。",
    ),
    MissionStep.run("復元先で文書が戻ったことを照会する", fsQuery("recovered-docs")),
  ],
  spanner: [
    MissionStep.run(
      "マルチリージョン構成nam3でSpannerインスタンスを作る",
      spanner("global-app", "nam3"),
      "1000 PU（処理ユニット）は1ノード分です。",
    ),
    MissionStep.run("主キー付きのordersテーブルを持つappデータベースを作る", spDb("global-app")),
    MissionStep.run(
      "注文を1行書き込む",
      spSql("global-app", "INSERT INTO orders VALUES (1, 'committed')"),
    ),
    MissionStep.run(
      "処理容量を2000 PUに増やす",
      "gcloud spanner instances update global-app --processing-units=2000",
    ),
    MissionStep.run(
      "ordersを照会して書き込んだ行を確かめる",
      spSql("global-app", "SELECT * FROM orders"),
    ),
  ],
  spannerRestore: [
    ...spSeed("restore-spanner"),
    MissionStep.run(
      "データベースのバックアップを取る",
      "gcloud spanner backups create spanner-copy --instance=restore-spanner --database=app",
    ),
    MissionStep.run("誤って全行を削除する", spSql("restore-spanner", "DELETE FROM orders")),
    MissionStep.run(
      "バックアップを新しいデータベースrecoveredへ復元する",
      "gcloud spanner databases restore recovered --instance=restore-spanner --backup=spanner-copy",
    ),
    MissionStep.run(
      "復元したデータベースで行が戻ったことを照会する",
      spSql("restore-spanner", "SELECT * FROM orders", "recovered"),
    ),
  ],
  bigtableGc: [
    ...btSeed("telemetry"),
    MissionStep.run("同じセルに10:00の版を書く", cell("telemetry", "old")),
    MissionStep.run(
      "同じセルに10:10の新しい版を書く",
      cell("telemetry", "latest", "2026-10-01T10:10:00Z"),
    ),
    MissionStep.run(
      "最大1版・保持1時間のGCルールを列ファミリーに設定する",
      "sim bigtable families set-gc data --instance=telemetry --cluster=primary --table=readings --max-versions=1 --max-age-seconds=3600",
    ),
    MissionStep.run(
      "10:20の時点でGCを評価する",
      "sim bigtable gc readings --instance=telemetry --cluster=primary --at=2026-10-01T10:20:00Z",
      "実環境のGCは非同期で、ルールを設定してもすぐには消えません。",
    ),
    MissionStep.run("最新の版だけが残ったことを読んで確かめる", btRead("telemetry")),
  ],
  bigtableReplication: [
    ...btSeed("replicated"),
    MissionStep.run(
      "別ゾーンにセカンダリクラスタを追加する",
      "gcloud bigtable clusters create secondary --instance=replicated --zone=us-central1-b --num-nodes=2",
      "クラスタが2つになると、クラスタ間で複製されます。",
    ),
    MissionStep.run("primaryクラスタに値を書く", cell("replicated", "replicated")),
    MissionStep.run(
      "複製を進める",
      "sim bigtable replication advance --instance=replicated",
      "実環境の複製は非同期で、反映までに遅れがあります。",
    ),
    MissionStep.run(
      "セカンダリクラスタから値を読む",
      btRead("replicated", "readings", "secondary"),
    ),
  ],
  bigtableRestore: [
    ...btSeed("restore-bigtable"),
    MissionStep.run("セルに値beforeを書く", cell("restore-bigtable", "before")),
    MissionStep.run(
      "テーブルのバックアップを取る",
      "gcloud bigtable backups create bt-copy --instance=restore-bigtable --cluster=primary --table=readings",
    ),
    MissionStep.run(
      "誤って行を削除する",
      "sim bigtable rows delete sensor-1 --instance=restore-bigtable --cluster=primary --table=readings --quiet",
    ),
    MissionStep.run(
      "バックアップを新しいテーブルrecoveredへ復元する",
      "sim bigtable backups restore bt-copy --instance=restore-bigtable --cluster=primary --table=recovered",
    ),
    MissionStep.run("復元したテーブルから値を読む", btRead("restore-bigtable", "recovered")),
  ],
  redisTtl: [
    MissionStep.run("BASIC tierのRedisインスタンスを作る", redis("ttl-cache")),
    MissionStep.run("期限10秒でキーvisitsを書く", cache("ttl-cache", "set", "--value=1 --ttl=10")),
    MissionStep.run("期限前に値を読めることを確かめる", cache("ttl-cache", "get")),
    MissionStep.run("仮想時計を10秒進める", "sim databases time advance --seconds=10"),
    MissionStep.run(
      "期限切れでcache missになることを確かめる",
      cache("ttl-cache", "get"),
      "キャッシュは永続DBではないため、期限が切れた値は戻りません。",
    ),
  ],
  redisHa: [
    MissionStep.run(
      "STANDARD_HA tierのRedisインスタンスを作る",
      redis("ha-cache", "STANDARD_HA"),
      "別ゾーンにレプリカを持ち、障害時に切り替わる構成です。",
    ),
    MissionStep.run("カウンタvisitsに1を書く", cache("ha-cache", "set", "--value=1")),
    MissionStep.run(
      "手動でフェイルオーバーする",
      "gcloud redis instances failover ha-cache --region=us-central1",
    ),
    MissionStep.run("切替後にカウンタを1増やす", cache("ha-cache", "increment")),
    MissionStep.run("カウンタが2になったことを確かめる", cache("ha-cache", "get")),
  ],
  functionsFirestore: [
    ...worker,
    MissionStep.run("関数が読むfunction-docsデータベースを作る", fs("function-docs")),
    MissionStep.run(
      "読み取り対象の文書を書く",
      doc("function-docs", "orders/one", { note: "runtime-read" }),
    ),
    MissionStep.run(
      "実行SAにFirestoreを読む権限を与える",
      `gcloud projects add-iam-policy-binding ${p} --member=serviceAccount:${sa} --role=roles/datastore.viewer`,
    ),
    MissionStep.run(
      "読むデータベースを環境変数で渡して関数をデプロイする",
      fn("document-reader", "--set-env-vars=FIRESTORE_DATABASE=function-docs"),
    ),
    MissionStep.run(
      "関数を呼んで文書を読ませる",
      "sim functions database read document-reader --region=us-central1 --document=orders/one",
      "関数は実行SAの権限でFirestoreを読みます。",
    ),
  ],
  functionsRedis: [
    ...worker,
    MissionStep.run("関数が使うRedisインスタンスを作る", redis("function-cache")),
    MissionStep.run(
      "Redisと同じVPCにServerless VPC Accessコネクタを作る",
      "gcloud compute networks vpc-access connectors create database-connector --region=us-central1 --network=default --range=10.9.0.0/28",
      "関数はコネクタを通ってRedisのprivate IPへ届きます。",
    ),
    MissionStep.run(
      "コネクタとRedisを指定して関数をデプロイする",
      fn(
        "cache-counter",
        "--vpc-connector=database-connector --set-env-vars=REDIS_INSTANCE=function-cache",
      ),
    ),
    MissionStep.run(
      "関数を呼んでカウンタを1にする",
      "sim functions database increment-cache cache-counter --region=us-central1 --key=visits",
    ),
    MissionStep.run(
      "もう一度呼んでカウンタを2にする",
      "sim functions database increment-cache cache-counter --region=us-central1 --key=visits",
    ),
  ],
  vector: [
    MissionStep.run("単一リージョンのSpannerインスタンスを作る", spanner("vector-spanner")),
    MissionStep.run(
      "ベクトル列を持つitemsテーブルのデータベースを作る",
      "gcloud spanner databases create app --instance=vector-spanner --ddl='CREATE TABLE items (id INT64 NOT NULL, title STRING(MAX), embedding ARRAY<FLOAT64>) PRIMARY KEY (id)'",
    ),
    MissionStep.run(
      "ベクトル[1,0,0]の行eastを書く",
      spSql("vector-spanner", "INSERT INTO items VALUES (1, 'east', [1,0,0])"),
    ),
    MissionStep.run(
      "ベクトル[4,1,0]の行nearを書く",
      spSql("vector-spanner", "INSERT INTO items VALUES (2, 'near', [4,1,0])"),
    ),
    MissionStep.run(
      "ベクトル[0,1,0]の行northを書く",
      spSql("vector-spanner", "INSERT INTO items VALUES (3, 'north', [0,1,0])"),
    ),
    MissionStep.run(
      "idの等価条件で1行を照会する",
      spSql("vector-spanner", "SELECT id, title FROM items WHERE id = 3"),
    ),
    MissionStep.run(
      "[1,0,0]とのcosine距離が近い順に2件照会する",
      spSql(
        "vector-spanner",
        "SELECT id, title, COSINE_DISTANCE(embedding, [1,0,0]) AS distance FROM items ORDER BY distance LIMIT 2",
      ),
      "idで引いた行とは別の、向きが近い行（1と2）が返ります。",
    ),
  ],
  selection: [
    MissionStep.run(
      "モバイル向けのドキュメントDBにFirestoreを選ぶ",
      "sim databases choose mobile-documents --service=firestore",
    ),
    MissionStep.run(
      "大量の時系列データにBigtableを選ぶ",
      "sim databases choose telemetry --service=bigtable",
    ),
    MissionStep.run(
      "一時的なセッションキャッシュにRedisを選ぶ",
      "sim databases choose session-cache --service=redis",
    ),
    MissionStep.run(
      "大域トランザクションにSpannerを選ぶ",
      "sim databases choose global-transactions --service=spanner",
    ),
  ],
};
/** 各レッスンの解答を端末の行だけで並べたもの（テストがそのまま流す）。 */
export const ManagedDatabaseSolutions = Object.fromEntries(
  Object.entries(ManagedDatabaseSteps).map(([lesson, steps]) => [lesson, MissionStep.lines(steps)]),
) as Readonly<Record<ManagedDatabaseLesson, readonly string[]>>;
const definitions: readonly [ManagedDatabaseLesson, string, string][] = [
  [
    "document",
    "Firestoreの整合したドキュメント更新",
    "Native mode・複数リージョンの配置を選び、version付きの単一ドキュメント更新と強整合な照会を確認します。",
  ],
  [
    "index",
    "複合索引でテナントの注文を検索",
    "等価条件と別フィールドのソートに必要な索引を作り、他テナントを含めず上位2件を照会します。",
  ],
  [
    "firestoreRestore",
    "Firestoreの誤削除を別DBへ復元",
    "ドキュメントを保存し、削除後に新しいDBへ復元してデータを照会します。索引はバックアップに含めません。",
  ],
  [
    "spanner",
    "Spannerの構成・容量・主キーを設定",
    "広域トランザクション用構成と2000 PUを選び、GoogleSQLの小さなサブセットで保存・強整合な照会を行います。",
  ],
  [
    "spannerRestore",
    "Spannerのバックアップから別DBへ復元",
    "主キーと保存時点の行を保持したコピーから、削除後に新しいDBへ復元・照会します。",
  ],
  [
    "bigtableGc",
    "Bigtableの列ファミリーとGCを設定",
    "同じセルに2版を書き、版数・保持時間のルールを明示時刻で評価して最新値を読みます。実環境のGCは非同期です。",
  ],
  [
    "bigtableReplication",
    "Bigtableの別クラスタで複製を確認",
    "別ゾーンのクラスタを追加し、更新の複製を明示的に進めてセカンダリから読み取ります。",
  ],
  [
    "bigtableRestore",
    "Bigtableのバックアップを別テーブルへ復元",
    "列ファミリーとセルの保存時点のデータを、同じリージョンの新規テーブルへ復元して読みます。",
  ],
  [
    "redisTtl",
    "Redisのキャッシュ期限を確認",
    "同じVPCから値を読み、仮想時計を10秒進めてTTL後のcache missを確認します。キャッシュは永続DBではありません。",
  ],
  [
    "redisHa",
    "RedisのHA切替後にカウンタを更新",
    "STANDARD_HAを選び、安定した接続先でfailover後のINCRとGETを確認します。実サービスの耐久性は再現しません。",
  ],
  [
    "functionsFirestore",
    "Functionsの実行SAでFirestoreを読む",
    "実行SAにはviewerを与え、固定ハンドラが設定したDBの実データを読み取ることを確認します。",
  ],
  [
    "functionsRedis",
    "FunctionsからVPC経由でキャッシュを更新",
    "同リージョンのconnectorとRedisのVPCをそろえ、固定ハンドラでカウンタを2にします。",
  ],
  [
    "vector",
    "Spannerでキー検索とベクトル距離を比べる",
    "人工3次元データで、idの等価条件とcosine距離の順位が違うことを確認します。AI呼出しやANN・性能測定は行いません。",
  ],
  [
    "selection",
    "データ形・整合性・一時性からDBを選ぶ",
    "ドキュメント、時系列、大域トランザクション、キャッシュの4要件に合うサービスを選びます。",
  ],
];
export const ManagedDatabaseMissions: readonly Mission[] = definitions.map(
  ([lesson, title, description], i) => ({
    id: `m-managed-db-${String(i + 1).padStart(3, "0")}`,
    domain: lesson === "selection" ? "計画と構成" : "運用の維持",
    title,
    description,
    setup: [
      { kind: "setPrincipal", principal: F.owner },
      { kind: "setProject", projectId: p },
    ],
    steps: [...ManagedDatabasePreludeSteps, ...ManagedDatabaseSteps[lesson]],
    assertions: [{ kind: "managedDatabaseLesson", lesson }],
  }),
);
export const managedDatabaseSatisfied = (world: World, lesson: ManagedDatabaseLesson): boolean => {
  const m = world.managedDatabases;
  const observation = (service: string, resource: string, operation: string) => {
    const o = m.observations
      .filter(
        (o) =>
          o.projectId === p &&
          o.service === service &&
          o.resource === resource &&
          o.operation === operation,
      )
      .at(-1);
    if (!o) {
      return "";
    }
    return o.result;
  };
  const docValue = (database: string) =>
    world.serverlessLab.documents.find(
      (d) => d.projectId === p && d.database === database && d.path === "orders/one",
    );
  const queried = (service: string, resource: string, needle: string, operation = "query") =>
    observation(service, resource, operation).includes(needle);
  const recovery = (service: string, target: string) =>
    m.recoveries.some((r) => r.projectId === p && r.service === service && r.target === target);
  if (lesson === "selection") {
    return [
      "mobile-documents:firestore",
      "telemetry:bigtable",
      "session-cache:redis",
      "global-transactions:spanner",
    ].every((pair) => {
      const [key, value] = pair.split(":");
      return world.relational.decisions[`${p}/${key}`] === value;
    });
  }
  if (lesson === "document") {
    const d = docValue("doc-app");
    return (
      world.serverlessLab.databases.some(
        (d) => d.projectId === p && d.name === "doc-app" && d.region === "nam5",
      ) &&
      d?.version === 2 &&
      d.data === '{"count":3}' &&
      queried("firestore", "doc-app", '"count":3')
    );
  }
  if (lesson === "index") {
    return (
      m.indexes.some(
        (i) =>
          i.projectId === p &&
          i.database === "index-app" &&
          i.collection === "orders" &&
          i.fields.join(",") === "tenant,total",
      ) &&
      world.serverlessLab.documents.filter((d) => d.projectId === p && d.database === "index-app")
        .length === 3 &&
      queried("firestore", "index-app", '"total":20') &&
      queried("firestore", "index-app", '"total":10') &&
      !queried("firestore", "index-app", '"total":30')
    );
  }
  if (lesson === "firestoreRestore") {
    return (
      !docValue("source-docs") &&
      docValue("recovered-docs")?.data === '{"note":"before"}' &&
      recovery("firestore", "recovered-docs") &&
      queried("firestore", "recovered-docs", '"note":"before"')
    );
  }
  if (lesson === "functionsFirestore") {
    return (
      docValue("function-docs")?.data === '{"note":"runtime-read"}' &&
      queried("firestore", "function-docs", sa, "function:document-reader")
    );
  }
  if (lesson === "spanner" || lesson === "spannerRestore" || lesson === "vector") {
    const iName = {
      spanner: "global-app",
      spannerRestore: "restore-spanner",
      vector: "vector-spanner",
    }[lesson];
    const i = m.spannerInstances.find((i) => i.projectId === p && i.name === iName);
    const dbName = lesson === "spannerRestore" ? "recovered" : "app";
    const db = m.spannerDatabases.find(
      (d) => d.projectId === p && d.instance === iName && d.name === dbName,
    );
    const rows = db?.tables[0]?.rows ?? [];
    const resource = `${iName}/${dbName}`;
    if (lesson === "spanner") {
      return (
        i?.config === "nam3" &&
        i.processingUnits === 2000 &&
        rows.some((r) => r.note === "committed") &&
        queried("spanner", resource, '"note":"committed"')
      );
    }
    if (lesson === "spannerRestore") {
      const old = m.spannerDatabases.find(
        (d) => d.projectId === p && d.instance === iName && d.name === "app",
      );
      return (
        old?.tables[0]?.rows.length === 0 &&
        rows.some((r) => r.note === "before") &&
        recovery("spanner", resource) &&
        queried("spanner", resource, '"note":"before"')
      );
    }
    const result = observation("spanner", resource, "query");
    return (
      rows.length === 3 &&
      result.includes('"id":1') &&
      result.includes('"id":2') &&
      !result.includes('"id":3') &&
      result.includes('"distance":0') &&
      m.observations.some(
        (o) =>
          o.projectId === p &&
          o.service === "spanner" &&
          o.resource === resource &&
          o.result.includes('"id":3'),
      )
    );
  }
  if (["bigtableGc", "bigtableReplication", "bigtableRestore"].includes(lesson)) {
    const id = {
      bigtableGc: "telemetry",
      bigtableReplication: "replicated",
      bigtableRestore: "restore-bigtable",
    }[lesson as "bigtableGc" | "bigtableReplication" | "bigtableRestore"];
    const i = m.bigtableInstances.find((i) => i.projectId === p && i.name === id);
    const t = i?.tables.find(
      (t) => t.name === (lesson === "bigtableRestore" ? "recovered" : "readings"),
    );
    if (!i || !t) {
      return false;
    }
    const resource = `${i.name}/${t.name}`;
    if (lesson === "bigtableReplication") {
      return (
        i.clusters.length === 2 &&
        i.clusters.every((c) => c.version === i.version) &&
        t.cells.some((c) => c.value === "replicated") &&
        queried("bigtable", resource, '"value":"replicated"', "read:secondary")
      );
    }
    if (lesson === "bigtableRestore") {
      return (
        i.tables.find((t) => t.name === "readings")?.cells.length === 0 &&
        t.cells.some((c) => c.value === "before") &&
        recovery("bigtable", resource) &&
        queried("bigtable", resource, '"value":"before"', "read:primary")
      );
    }
    return (
      t.cells.length === 1 &&
      t.cells[0]?.value === "latest" &&
      t.families[0]?.maxAgeSeconds === 3600 &&
      queried("bigtable", resource, '"value":"latest"', "read:primary") &&
      m.observations.some(
        (o) =>
          o.projectId === p &&
          o.service === "bigtable" &&
          o.resource === resource &&
          o.operation === "gc" &&
          o.result.includes('"removed":1'),
      )
    );
  }
  const id = { redisTtl: "ttl-cache", redisHa: "ha-cache", functionsRedis: "function-cache" }[
    lesson as "redisTtl" | "redisHa" | "functionsRedis"
  ];
  const r = world.serverlessLab.redis.find(
    (r) => r.projectId === p && r.name === id && r.region === "us-central1",
  );
  if (!r) {
    return false;
  }
  const c = cacheOf(world, r);
  const resource = `${r.region}/${r.name}`;
  if (lesson === "redisTtl") {
    return (
      m.clock >= 10 &&
      !c.entries.some((e) => e.key === "visits") &&
      queried("redis", resource, '"value":null', "get") &&
      m.observations.some(
        (o) =>
          o.projectId === p &&
          o.resource === resource &&
          o.operation === "get" &&
          o.result.includes('"value":"1"'),
      )
    );
  }
  if (lesson === "redisHa") {
    return (
      c.tier === "STANDARD_HA" &&
      c.failovers >= 1 &&
      c.entries.some((e) => e.key === "visits" && e.value === "2") &&
      queried("redis", resource, '"value":"2"', "get")
    );
  }
  return (
    c.entries.some((e) => e.key === "visits" && e.value === "2") &&
    queried("redis", resource, sa, "function:cache-counter")
  );
};
